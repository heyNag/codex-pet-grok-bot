import sharp from "sharp";
import { advanceActivationSpring } from "../src/grok-motion.mjs";
import {
  SOURCE_MOTION_ACTIVE_SECONDS,
  SOURCE_MOTION_FRAME_HEIGHT,
  SOURCE_MOTION_FRAME_RATE,
  SOURCE_MOTION_FRAME_WIDTH,
  SOURCE_MOTION_RASTER_SCALE,
} from "../src/source-motion-timing.mjs";

const ANALYSIS_WIDTH = SOURCE_MOTION_FRAME_WIDTH / SOURCE_MOTION_RASTER_SCALE;
const ANALYSIS_HEIGHT = SOURCE_MOTION_FRAME_HEIGHT / SOURCE_MOTION_RASTER_SCALE;
const PIXEL_COUNT = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
const CHANNELS = 4;
const FRAME_STRIDE = PIXEL_COUNT * CHANNELS;
const PERCEPTUAL_HISTOGRAM_STEP = 0.25;
const PERCEPTUAL_HISTOGRAM_BINS = Math.ceil(110 / PERCEPTUAL_HISTOGRAM_STEP) + 1;

// The motion gate is evaluated at the character's canonical 192 x 208 logical
// cell. Each encoded WebP page is first composited on its intended surface,
// then compared with the next page using a luma-weighted YCbCr distance. This
// keeps transparent-edge changes honest without treating equal-energy hue
// shifts as invisible. A value of 100 is a full black/white replacement.
//
// The limits describe what can change within one 16-17 ms display interval:
// - no more than one eighth of the full cell may strongly replace at once;
// - alpha variation is capped at one tenth of the cell;
// - an isolated transition may not carry 2.5x its two-neighbour energy;
// - monochrome eye ink must take at least five equal-sized steps to fade;
// - a loop seam is held close to perceptual identity.
export const SOURCE_MOTION_TEMPORAL_GATE = Object.freeze({
  schemaVersion: 1,
  analysisWidth: ANALYSIS_WIDTH,
  analysisHeight: ANALYSIS_HEIGHT,
  perceptualModel: "intended-surface sRGB alpha composite; luma-weighted YCbCr distance (0-100)",
  visibleDifferenceThreshold: 2,
  strongDifferenceThreshold: 8,
  hardInteriorDifferenceThreshold: 24,
  opaqueAlphaThreshold: 250 / 255,
  maximumPerceptualRms: 35,
  maximumStronglyChangedCellFraction: 0.125,
  maximumAlphaVariationCellFraction: 0.10,
  maximumCentroidStepPx: 18,
  isolatedSnapMinimumPerceptualRms: 2,
  maximumLocalEnergyRatio: 2.5,
  maximumEyeInkStepFraction: 0.20,
  loop: Object.freeze({
    maximumPerceptualRms: 0.25,
    maximumStronglyChangedCellFraction: 0.0005,
    maximumAlphaVariationCellFraction: 0.0002,
    maximumCentroidStepPx: 0.25,
    maximumEyeInkStepFraction: 0.01,
  }),
});

const THEME_SURFACES = Object.freeze({
  dark: Object.freeze({ background: Object.freeze([8, 11, 12]), body: 255, eye: 0 }),
  light: Object.freeze({ background: Object.freeze([243, 241, 233]), body: 0, eye: 255 }),
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, places = 6) => Number(value.toFixed(places));

function perceptualDelta(red, green, blue) {
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const blueDifference = -0.1146 * red - 0.3854 * green + 0.5 * blue;
  const redDifference = 0.5 * red - 0.4542 * green - 0.0458 * blue;
  return Math.sqrt(
    luminance ** 2
      + 0.25 * blueDifference ** 2
      + 0.25 * redDifference ** 2,
  ) / 255 * 100;
}

function histogramPercentile(histogram, sampleCount, percentile) {
  const target = Math.max(1, Math.ceil(sampleCount * percentile));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) return index * PERCEPTUAL_HISTOGRAM_STEP;
  }
  return (histogram.length - 1) * PERCEPTUAL_HISTOGRAM_STEP;
}

function frameFeatures(rgba, pageIndex, surface) {
  const offset = pageIndex * FRAME_STRIDE;
  let alphaMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let eyeInkMass = 0;

  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    const source = offset + pixelIndex * CHANNELS;
    const alpha = rgba[source + 3] / 255;
    if (alpha <= 0) continue;
    const x = pixelIndex % ANALYSIS_WIDTH;
    const y = Math.floor(pixelIndex / ANALYSIS_WIDTH);
    alphaMass += alpha;
    weightedX += x * alpha;
    weightedY += y * alpha;

    const red = rgba[source];
    const green = rgba[source + 1];
    const blue = rgba[source + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const neutralWeight = 1 - clamp((maximum - minimum) / 24, 0, 1);
    const tone = (red + green + blue) / (3 * 255);
    const eyeTone = surface.eye === 0 ? 1 - tone : tone;
    eyeInkMass += alpha * neutralWeight * eyeTone;
  }

  return Object.freeze({
    alphaMass,
    centroidX: alphaMass > 0 ? weightedX / alphaMass : 0,
    centroidY: alphaMass > 0 ? weightedY / alphaMass : 0,
    eyeInkMass,
  });
}

function compareFrames({ rgba, fromPage, toPage, surface, fromFeatures, toFeatures }) {
  const fromOffset = fromPage * FRAME_STRIDE;
  const toOffset = toPage * FRAME_STRIDE;
  const histogram = new Uint32Array(PERCEPTUAL_HISTOGRAM_BINS);
  let perceptualSum = 0;
  let perceptualSquareSum = 0;
  let maximumPerceptualDelta = 0;
  let visiblyChangedPixels = 0;
  let stronglyChangedPixels = 0;
  let visibleUnionPixels = 0;
  let hardOpaqueChangedPixels = 0;
  let alphaVariation = 0;
  let alphaIntersection = 0;
  let alphaUnion = 0;

  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    const from = fromOffset + pixelIndex * CHANNELS;
    const to = toOffset + pixelIndex * CHANNELS;
    const fromAlpha = rgba[from + 3] / 255;
    const toAlpha = rgba[to + 3] / 255;
    if (Math.max(fromAlpha, toAlpha) > 0) visibleUnionPixels += 1;
    alphaVariation += Math.abs(fromAlpha - toAlpha);
    alphaIntersection += Math.min(fromAlpha, toAlpha);
    alphaUnion += Math.max(fromAlpha, toAlpha);

    const fromRed = rgba[from] * fromAlpha + surface.background[0] * (1 - fromAlpha);
    const fromGreen = rgba[from + 1] * fromAlpha + surface.background[1] * (1 - fromAlpha);
    const fromBlue = rgba[from + 2] * fromAlpha + surface.background[2] * (1 - fromAlpha);
    const toRed = rgba[to] * toAlpha + surface.background[0] * (1 - toAlpha);
    const toGreen = rgba[to + 1] * toAlpha + surface.background[1] * (1 - toAlpha);
    const toBlue = rgba[to + 2] * toAlpha + surface.background[2] * (1 - toAlpha);
    const delta = perceptualDelta(
      toRed - fromRed,
      toGreen - fromGreen,
      toBlue - fromBlue,
    );
    perceptualSum += delta;
    perceptualSquareSum += delta ** 2;
    maximumPerceptualDelta = Math.max(maximumPerceptualDelta, delta);
    if (delta >= SOURCE_MOTION_TEMPORAL_GATE.visibleDifferenceThreshold) visiblyChangedPixels += 1;
    if (delta >= SOURCE_MOTION_TEMPORAL_GATE.strongDifferenceThreshold) stronglyChangedPixels += 1;
    if (
      fromAlpha >= SOURCE_MOTION_TEMPORAL_GATE.opaqueAlphaThreshold
      && toAlpha >= SOURCE_MOTION_TEMPORAL_GATE.opaqueAlphaThreshold
      && delta >= SOURCE_MOTION_TEMPORAL_GATE.hardInteriorDifferenceThreshold
    ) {
      hardOpaqueChangedPixels += 1;
    }
    const histogramIndex = Math.min(
      histogram.length - 1,
      Math.floor(delta / PERCEPTUAL_HISTOGRAM_STEP),
    );
    histogram[histogramIndex] += 1;
  }

  const alphaMassMaximum = Math.max(fromFeatures.alphaMass, toFeatures.alphaMass, 1);
  return {
    perceptualMean: perceptualSum / PIXEL_COUNT,
    perceptualRms: Math.sqrt(perceptualSquareSum / PIXEL_COUNT),
    perceptualP95: histogramPercentile(histogram, PIXEL_COUNT, 0.95),
    perceptualP99: histogramPercentile(histogram, PIXEL_COUNT, 0.99),
    maximumPerceptualDelta,
    visiblyChangedCellFraction: visiblyChangedPixels / PIXEL_COUNT,
    visiblyChangedUnionFraction: visiblyChangedPixels / Math.max(visibleUnionPixels, 1),
    stronglyChangedCellFraction: stronglyChangedPixels / PIXEL_COUNT,
    hardOpaqueChangedCellFraction: hardOpaqueChangedPixels / PIXEL_COUNT,
    hardOpaqueChangedPixels,
    alphaVariationCellFraction: alphaVariation / PIXEL_COUNT,
    alphaIntersectionOverUnion: alphaUnion > 0 ? alphaIntersection / alphaUnion : 1,
    alphaMassStepFraction: Math.abs(toFeatures.alphaMass - fromFeatures.alphaMass) / alphaMassMaximum,
    centroidStepPx: Math.hypot(
      toFeatures.centroidX - fromFeatures.centroidX,
      toFeatures.centroidY - fromFeatures.centroidY,
    ),
  };
}

function activationSamples(frameCount) {
  const spring = { position: 0, velocity: 0 };
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const elapsedSeconds = frameIndex / SOURCE_MOTION_FRAME_RATE;
    const activation = spring.position;
    const target = elapsedSeconds < SOURCE_MOTION_ACTIVE_SECONDS ? 1 : 0;
    advanceActivationSpring(spring, target, 1 / SOURCE_MOTION_FRAME_RATE);
    return activation;
  });
}

function activationAtTimelineMs(samples, timelineMs) {
  const nominalIndex = clamp(
    Math.round(timelineMs * SOURCE_MOTION_FRAME_RATE / 1000),
    0,
    samples.length - 1,
  );
  return samples[nominalIndex];
}

function transitionFlags(transition, eyeInkPeak) {
  const flags = [];
  const gate = transition.seam ? SOURCE_MOTION_TEMPORAL_GATE.loop : SOURCE_MOTION_TEMPORAL_GATE;
  if (transition.perceptualRms > gate.maximumPerceptualRms) flags.push("perceptual-rms");
  if (transition.stronglyChangedCellFraction > gate.maximumStronglyChangedCellFraction) {
    flags.push("strongly-changed-cell-fraction");
  }
  if (transition.alphaVariationCellFraction > gate.maximumAlphaVariationCellFraction) {
    flags.push("alpha-variation-cell-fraction");
  }
  if (transition.centroidStepPx > gate.maximumCentroidStepPx) flags.push("centroid-step");
  const normalizedEyeInkStep = Math.abs(transition.eyeInkStep) / Math.max(eyeInkPeak, 1);
  if (normalizedEyeInkStep > gate.maximumEyeInkStepFraction) flags.push("eye-ink-step");
  if (
    !transition.seam
    && transition.perceptualRms >= SOURCE_MOTION_TEMPORAL_GATE.isolatedSnapMinimumPerceptualRms
    && transition.localEnergyRatio > SOURCE_MOTION_TEMPORAL_GATE.maximumLocalEnergyRatio
  ) {
    flags.push("isolated-perceptual-snap");
  }
  return { flags, normalizedEyeInkStep };
}

function roundedTransition(transition) {
  return {
    fromPage: transition.fromPage,
    toPage: transition.toPage,
    seam: transition.seam,
    fromStartMs: transition.fromStartMs,
    toStartMs: transition.toStartMs,
    displayIntervalMs: transition.displayIntervalMs,
    activationBefore: round(transition.activationBefore),
    activationAfter: round(transition.activationAfter),
    eyeTransitionLandmark: transition.eyeTransitionLandmark,
    eyeInkBefore: round(transition.eyeInkBefore, 3),
    eyeInkAfter: round(transition.eyeInkAfter, 3),
    eyeInkStep: round(transition.eyeInkStep, 3),
    normalizedEyeInkStep: round(transition.normalizedEyeInkStep),
    perceptualMean: round(transition.perceptualMean),
    perceptualRms: round(transition.perceptualRms),
    perceptualP95: round(transition.perceptualP95),
    perceptualP99: round(transition.perceptualP99),
    maximumPerceptualDelta: round(transition.maximumPerceptualDelta),
    visiblyChangedCellFraction: round(transition.visiblyChangedCellFraction),
    visiblyChangedUnionFraction: round(transition.visiblyChangedUnionFraction),
    stronglyChangedCellFraction: round(transition.stronglyChangedCellFraction),
    hardOpaqueChangedCellFraction: round(transition.hardOpaqueChangedCellFraction),
    hardOpaqueChangedPixels: transition.hardOpaqueChangedPixels,
    alphaVariationCellFraction: round(transition.alphaVariationCellFraction),
    alphaIntersectionOverUnion: round(transition.alphaIntersectionOverUnion),
    alphaMassStepFraction: round(transition.alphaMassStepFraction),
    centroidStepPx: round(transition.centroidStepPx),
    localEnergyRatio: round(transition.localEnergyRatio),
    flags: transition.flags,
  };
}

function worstCaseSeverity(transition) {
  const gate = transition.seam ? SOURCE_MOTION_TEMPORAL_GATE.loop : SOURCE_MOTION_TEMPORAL_GATE;
  return Math.max(
    transition.perceptualRms / gate.maximumPerceptualRms,
    transition.stronglyChangedCellFraction / gate.maximumStronglyChangedCellFraction,
    transition.alphaVariationCellFraction / gate.maximumAlphaVariationCellFraction,
    transition.centroidStepPx / gate.maximumCentroidStepPx,
    transition.normalizedEyeInkStep / gate.maximumEyeInkStepFraction,
    transition.seam ? 0 : transition.localEnergyRatio / SOURCE_MOTION_TEMPORAL_GATE.maximumLocalEnergyRatio,
  );
}

export async function analyzeSourceMotionTemporalAsset({ bytes, delays, effect, theme }) {
  const surface = THEME_SURFACES[theme];
  if (!surface) throw new Error(`Unknown source-motion QA theme: ${theme}`);
  const decoded = await sharp(bytes, { animated: true, failOn: "error" })
    .resize(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pageCount = decoded.info.pages ?? 1;
  if (decoded.info.width !== ANALYSIS_WIDTH || decoded.info.pageHeight !== ANALYSIS_HEIGHT) {
    throw new Error(`${theme}/${effect} temporal decode dimensions are not ${ANALYSIS_WIDTH}x${ANALYSIS_HEIGHT}`);
  }
  if (delays.length !== pageCount) {
    throw new Error(`${theme}/${effect} has ${pageCount} displayed pages but ${delays.length} delays`);
  }

  const features = Array.from(
    { length: pageCount },
    (_, pageIndex) => frameFeatures(decoded.data, pageIndex, surface),
  );
  const eyeInkPeak = Math.max(0, ...features.map(({ eyeInkMass }) => eyeInkMass));
  const totalDurationMs = delays.reduce((total, delay) => total + delay, 0);
  const nominalSamples = activationSamples(Math.round(
    totalDurationMs * SOURCE_MOTION_FRAME_RATE / 1000,
  ));
  const starts = [];
  let timelineMs = 0;
  for (const delay of delays) {
    starts.push(timelineMs);
    timelineMs += delay;
  }

  const transitions = Array.from({ length: pageCount }, (_, fromPage) => {
    const toPage = (fromPage + 1) % pageCount;
    const seam = toPage === 0;
    const activationBefore = activationAtTimelineMs(nominalSamples, starts[fromPage]);
    const activationAfter = seam
      ? activationAtTimelineMs(nominalSamples, 0)
      : activationAtTimelineMs(nominalSamples, starts[toPage]);
    const metrics = compareFrames({
      rgba: decoded.data,
      fromPage,
      toPage,
      surface,
      fromFeatures: features[fromPage],
      toFeatures: features[toPage],
    });
    return {
      fromPage,
      toPage,
      seam,
      fromStartMs: starts[fromPage],
      toStartMs: seam ? 0 : starts[toPage],
      displayIntervalMs: delays[fromPage],
      activationBefore,
      activationAfter,
      eyeTransitionLandmark: !seam && activationBefore < 0.5 && activationAfter >= 0.5
        ? "activation-rising-through-0.50"
        : !seam && activationBefore >= 0.5 && activationAfter < 0.5
          ? "activation-falling-through-0.50"
          : null,
      eyeInkBefore: features[fromPage].eyeInkMass,
      eyeInkAfter: features[toPage].eyeInkMass,
      eyeInkStep: features[toPage].eyeInkMass - features[fromPage].eyeInkMass,
      ...metrics,
      localEnergyRatio: 0,
      normalizedEyeInkStep: 0,
      flags: [],
    };
  });

  for (let index = 0; index < transitions.length - 1; index += 1) {
    const previous = transitions[(index - 1 + transitions.length) % transitions.length].perceptualRms;
    const next = transitions[index + 1].perceptualRms;
    transitions[index].localEnergyRatio = transitions[index].perceptualRms
      / Math.max(0.25, (previous + next) / 2);
  }
  for (const transition of transitions) {
    Object.assign(transition, transitionFlags(transition, eyeInkPeak));
  }

  const eyeTransitionLandmarks = transitions.filter(
    ({ eyeTransitionLandmark }) => eyeTransitionLandmark != null,
  );
  const failingTransitions = transitions.filter(({ flags }) => flags.length > 0);
  const worstCase = transitions.reduce((worst, candidate) => (
    worst == null || worstCaseSeverity(candidate) > worstCaseSeverity(worst) ? candidate : worst
  ), null);
  const maximumBy = (property) => transitions.reduce((worst, candidate) => (
    worst == null || candidate[property] > worst[property] ? candidate : worst
  ), null);

  return {
    report: {
      pages: pageCount,
      adjacentTransitions: pageCount - 1,
      loopSeams: 1,
      intendedSurfaceRgb: surface.background,
      eyeInkPeak: round(eyeInkPeak, 3),
      eyeTransitionLandmarks: eyeTransitionLandmarks.map((transition) => ({
        landmark: transition.eyeTransitionLandmark,
        fromPage: transition.fromPage,
        toPage: transition.toPage,
        fromStartMs: transition.fromStartMs,
        toStartMs: transition.toStartMs,
        activationBefore: round(transition.activationBefore),
        activationAfter: round(transition.activationAfter),
        eyeInkBefore: round(transition.eyeInkBefore, 3),
        eyeInkAfter: round(transition.eyeInkAfter, 3),
        normalizedEyeInkStep: round(transition.normalizedEyeInkStep),
        perceptualRms: round(transition.perceptualRms),
        visiblyChangedCellFraction: round(transition.visiblyChangedCellFraction),
        hardOpaqueChangedPixels: transition.hardOpaqueChangedPixels,
        transitionFlags: transition.flags,
        flags: transition.flags.filter((flag) => flag === "eye-ink-step"),
        passes: !transition.flags.includes("eye-ink-step"),
      })),
      maxima: Object.fromEntries([
        "perceptualRms",
        "visiblyChangedCellFraction",
        "stronglyChangedCellFraction",
        "alphaVariationCellFraction",
        "alphaMassStepFraction",
        "centroidStepPx",
        "localEnergyRatio",
        "normalizedEyeInkStep",
      ].map((property) => {
        const transition = maximumBy(property);
        return [property, {
          value: round(transition[property]),
          fromPage: transition.fromPage,
          toPage: transition.toPage,
          seam: transition.seam,
        }];
      })),
      failingTransitionCount: failingTransitions.length,
      transitions: transitions.map(roundedTransition),
    },
    worstCase: {
      theme,
      effect,
      transition: worstCase,
      rgba: decoded.data,
      surface,
    },
  };
}

function compositePanel(rgba, pageIndex, surface) {
  const panel = Buffer.alloc(FRAME_STRIDE);
  const sourceOffset = pageIndex * FRAME_STRIDE;
  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    const source = sourceOffset + pixelIndex * CHANNELS;
    const target = pixelIndex * CHANNELS;
    const alpha = rgba[source + 3] / 255;
    panel[target] = Math.round(rgba[source] * alpha + surface.background[0] * (1 - alpha));
    panel[target + 1] = Math.round(rgba[source + 1] * alpha + surface.background[1] * (1 - alpha));
    panel[target + 2] = Math.round(rgba[source + 2] * alpha + surface.background[2] * (1 - alpha));
    panel[target + 3] = 255;
  }
  return panel;
}

function differencePanel(rgba, transition, surface) {
  const panel = Buffer.alloc(FRAME_STRIDE);
  const fromOffset = transition.fromPage * FRAME_STRIDE;
  const toOffset = transition.toPage * FRAME_STRIDE;
  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    const from = fromOffset + pixelIndex * CHANNELS;
    const to = toOffset + pixelIndex * CHANNELS;
    const target = pixelIndex * CHANNELS;
    const fromAlpha = rgba[from + 3] / 255;
    const toAlpha = rgba[to + 3] / 255;
    const delta = perceptualDelta(
      rgba[to] * toAlpha + surface.background[0] * (1 - toAlpha)
        - rgba[from] * fromAlpha - surface.background[0] * (1 - fromAlpha),
      rgba[to + 1] * toAlpha + surface.background[1] * (1 - toAlpha)
        - rgba[from + 1] * fromAlpha - surface.background[1] * (1 - fromAlpha),
      rgba[to + 2] * toAlpha + surface.background[2] * (1 - toAlpha)
        - rgba[from + 2] * fromAlpha - surface.background[2] * (1 - fromAlpha),
    );
    const heat = clamp(delta / 50, 0, 1);
    panel[target] = Math.round(255 * Math.min(1, heat * 2.1));
    panel[target + 1] = Math.round(255 * clamp((heat - 0.38) / 0.62, 0, 1));
    panel[target + 2] = Math.round(255 * clamp((heat - 0.78) / 0.22, 0, 1));
    panel[target + 3] = 255;
  }
  return panel;
}

function textSvg(width, height, lines, options = {}) {
  const escaped = lines.map((line) => String(line)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;"));
  const fill = options.fill ?? "#f4f7f7";
  const background = options.background ?? "#111516";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    ${escaped.map((line, index) => `<text x="12" y="${28 + index * 22}" fill="${index === 0 ? fill : "#9eabad"}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${index === 0 ? 14 : 12}" font-weight="${index === 0 ? 700 : 500}">${line}</text>`).join("")}
  </svg>`);
}

export async function buildSourceMotionWorstCaseSheet(rows) {
  const labelWidth = 144;
  const headerHeight = 36;
  const width = labelWidth + ANALYSIS_WIDTH * 3;
  const height = headerHeight + ANALYSIS_HEIGHT * rows.length;
  const composites = [{
    input: textSvg(width, headerHeight, ["SOURCE MOTION TEMPORAL WORST CASES"], {
      background: "#0b0e0f",
    }),
    left: 0,
    top: 0,
  }];
  const headerLabels = ["BEFORE", "AFTER", "PERCEPTUAL DELTA"];
  for (let index = 0; index < headerLabels.length; index += 1) {
    composites.push({
      input: textSvg(ANALYSIS_WIDTH, headerHeight, [headerLabels[index]], { background: "#0b0e0f" }),
      left: labelWidth + index * ANALYSIS_WIDTH,
      top: 0,
    });
  }

  rows.forEach((row, rowIndex) => {
    const top = headerHeight + rowIndex * ANALYSIS_HEIGHT;
    const transition = row.transition;
    const status = transition.flags.length === 0 ? "PASS" : `FAIL ${transition.flags.join("+")}`;
    composites.push({
      input: textSvg(labelWidth, ANALYSIS_HEIGHT, [
        `${row.theme}/${row.effect}`,
        `f${String(transition.fromPage).padStart(3, "0")} -> f${String(transition.toPage).padStart(3, "0")}`,
        status,
        `eye ${round(transition.normalizedEyeInkStep, 3)}`,
        `rms ${round(transition.perceptualRms, 3)}`,
      ]),
      left: 0,
      top,
    });
    const panels = [
      compositePanel(row.rgba, transition.fromPage, row.surface),
      compositePanel(row.rgba, transition.toPage, row.surface),
      differencePanel(row.rgba, transition, row.surface),
    ];
    panels.forEach((panel, panelIndex) => composites.push({
      input: panel,
      raw: { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT, channels: 4 },
      left: labelWidth + panelIndex * ANALYSIS_WIDTH,
      top,
    }));
  });

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 11, g: 14, b: 15, alpha: 1 },
    },
  }).composite(composites).png({ compressionLevel: 9, palette: false }).toBuffer();
}

function allFrameTraceRow(row, maximumPages, thumbnailWidth, thumbnailHeight) {
  const pageCount = row.rgba.length / FRAME_STRIDE;
  const outputWidth = maximumPages * thumbnailWidth;
  const output = Buffer.alloc(outputWidth * thumbnailHeight * CHANNELS);
  for (let pixel = 0; pixel < outputWidth * thumbnailHeight; pixel += 1) {
    output[pixel * CHANNELS] = 11;
    output[pixel * CHANNELS + 1] = 14;
    output[pixel * CHANNELS + 2] = 15;
    output[pixel * CHANNELS + 3] = 255;
  }

  const sampleStepX = ANALYSIS_WIDTH / thumbnailWidth;
  const sampleStepY = ANALYSIS_HEIGHT / thumbnailHeight;
  for (let page = 0; page < pageCount; page += 1) {
    const sourceOffset = page * FRAME_STRIDE;
    for (let y = 0; y < thumbnailHeight; y += 1) {
      const sourceY = Math.min(ANALYSIS_HEIGHT - 1, Math.floor((y + 0.5) * sampleStepY));
      for (let x = 0; x < thumbnailWidth; x += 1) {
        const sourceX = Math.min(ANALYSIS_WIDTH - 1, Math.floor((x + 0.5) * sampleStepX));
        const source = sourceOffset + (sourceY * ANALYSIS_WIDTH + sourceX) * CHANNELS;
        const targetX = page * thumbnailWidth + x;
        const target = (y * outputWidth + targetX) * CHANNELS;
        const alpha = row.rgba[source + 3] / 255;
        output[target] = Math.round(
          row.rgba[source] * alpha + row.surface.background[0] * (1 - alpha),
        );
        output[target + 1] = Math.round(
          row.rgba[source + 1] * alpha + row.surface.background[1] * (1 - alpha),
        );
        output[target + 2] = Math.round(
          row.rgba[source + 2] * alpha + row.surface.background[2] * (1 - alpha),
        );
      }
    }
  }
  return output;
}

function allFrameHeaderSvg(width, height, labelWidth, maximumPages, thumbnailWidth) {
  const ticks = Array.from({ length: Math.ceil(maximumPages / 10) }, (_, index) => index * 10);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#0b0e0f"/>
    <text x="12" y="25" fill="#f4f7f7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">ALL DISPLAYED FRAMES</text>
    ${ticks.map((page) => `<text x="${labelWidth + page * thumbnailWidth + 3}" y="25" fill="#9eabad" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${page}</text>`).join("")}
  </svg>`);
}

export async function buildSourceMotionAllFrameSheet(rows) {
  const labelWidth = 144;
  const headerHeight = 36;
  const thumbnailWidth = 48;
  const thumbnailHeight = 52;
  const maximumPages = Math.max(...rows.map((row) => row.rgba.length / FRAME_STRIDE));
  const width = labelWidth + maximumPages * thumbnailWidth;
  const height = headerHeight + rows.length * thumbnailHeight;
  const composites = [{
    input: allFrameHeaderSvg(width, headerHeight, labelWidth, maximumPages, thumbnailWidth),
    left: 0,
    top: 0,
  }];

  rows.forEach((row, rowIndex) => {
    const pageCount = row.rgba.length / FRAME_STRIDE;
    const top = headerHeight + rowIndex * thumbnailHeight;
    composites.push({
      input: textSvg(labelWidth, thumbnailHeight, [`${row.theme}/${row.effect}  ${pageCount}p`]),
      left: 0,
      top,
    });
    composites.push({
      input: allFrameTraceRow(row, maximumPages, thumbnailWidth, thumbnailHeight),
      raw: {
        width: maximumPages * thumbnailWidth,
        height: thumbnailHeight,
        channels: 4,
      },
      left: labelWidth,
      top,
    });
  });

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 11, g: 14, b: 15, alpha: 1 },
    },
  }).composite(composites).png({ compressionLevel: 9, palette: false }).toBuffer();
}
