import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ANIMATED_TEMPORAL_ADJACENCY_GATE,
  ANIMATED_TEMPORAL_ROW_GATES,
  ANIMATED_112_TEMPORAL_GATE,
  ANIMATED_112_TEMPORAL_ROW_GATES,
  DISPLAYED_112_HOST_BOUNDARY_GATES,
  DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
  DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
  GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
  GAZE_BODY_PHASE_STABILITY_GATE,
  SHIPPING_112_DISPLAY,
  TEMPORAL_MOTION_GATE,
  analyzeGazeBodyPhaseTransitions,
  analyzeDisplayed112RgbaSequence,
  analyzeDisplayed112HostBoundaryRgba,
  analyzeSourceHostBoundaryRgba,
  analyzeTemporalRgbaSequence,
  summarizeHostTransitionTrace,
} from "../scripts/animated-atlas-qa.mjs";
import { renderShippingHostFrame } from "../scripts/exhaustive-edge-qa.mjs";
import { codexDefaultDpr2CellMap } from "../scripts/codex-default-dpr2-oracle.mjs";
import { FLUID_ATLAS_FRAME_COUNT } from "../src/fluid-atlas.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 192;
const HEIGHT = 208;
const FRAMES = FLUID_ATLAS_FRAME_COUNT;
const VARIANT_COUNT = 2;
const REQUIRED_CELL_COUNT = 73;
const HOST_CORE_PAIRS_PER_PHASE = 36 + 48 + 96 + 16 + 72 + 32 + 48 + 96 + 48;
const HOST_CORE_TRANSITIONS_PER_VARIANT = HOST_CORE_PAIRS_PER_PHASE * FRAMES;
const SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT = 104 * FRAMES;
const CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT = 208 * FRAMES;
const TOTAL_HOST_TRANSITIONS_PER_VARIANT = HOST_CORE_TRANSITIONS_PER_VARIANT
  + SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT
  + CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT;
const ATLAS_WIDTH = 1536;
const ATLAS_HEIGHT = 2288;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function assertCompactTrace(trace, expectedCount) {
  assert.equal(trace.recordCount, expectedCount);
  assert.match(trace.orderedIdsSha256, /^[a-f0-9]{64}$/);
  assert.match(trace.orderedFullRecordSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(trace.metricNames) && trace.metricNames.length > 0);
  assert.deepEqual([...trace.metricNames].sort(), trace.metricNames);
  assert.match(trace.metricNamesSha256, /^[a-f0-9]{64}$/);
  assert.equal(trace.worstPerMetric, 5);
  assert.deepEqual(trace.failingTransitionIds, []);
  for (const metric of trace.metricNames) {
    const extrema = trace.metricExtrema[metric];
    if (extrema.minimum == null || extrema.maximum == null) {
      assert.equal(extrema.minimum, null);
      assert.equal(extrema.maximum, null);
      assert.deepEqual(trace.worstByMetric[metric], []);
      continue;
    }
    assert.ok(extrema.minimum.id);
    assert.ok(extrema.maximum.id);
    assert.ok(trace.worstByMetric[metric].length > 0);
    assert.ok(trace.worstByMetric[metric].length <= trace.worstPerMetric);
    assert.equal(
      new Set(trace.worstByMetric[metric].map(({ id }) => id)).size,
      trace.worstByMetric[metric].length,
    );
  }
}

function syntheticFrame({ eyeX = 116, eyeTone = 32, arm = false } = {}) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const fill = (minX, minY, maxX, maxY, red, green, blue, alpha = 255) => {
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        rgba[offset] = red;
        rgba[offset + 1] = green;
        rgba[offset + 2] = blue;
        rgba[offset + 3] = alpha;
      }
    }
  };
  fill(28, 24, 172, 162, 255, 255, 255);
  fill(96, 56, 108, 80, 32, 32, 32);
  fill(eyeX, 56, eyeX + 12, 80, eyeTone, eyeTone, eyeTone);
  if (arm) fill(174, 92, 186, 147, 249, 112, 92);
  return rgba;
}

function smoothSequence() {
  return Array.from({ length: FRAMES }, (_, frame) => syntheticFrame({
    eyeTone: 32 + Math.round(2 * Math.sin(frame / FRAMES * Math.PI * 2)),
  }));
}

function extractCell(page, row, column) {
  const cell = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    const source = ((row * HEIGHT + y) * ATLAS_WIDTH + column * WIDTH) * 4;
    page.copy(cell, y * WIDTH * 4, source, source + WIDTH * 4);
  }
  return cell;
}

let shippingFixturePromise;
function darkShippingFixtures() {
  shippingFixturePromise ??= (async () => {
    const atlasPath = path.join(root, "pet/grok-bot-dark/spritesheet.webp");
    const idle = [];
    const waving = [];
    const gaze = [];
    for (let page = 0; page < FRAMES; page += 1) {
      const decoded = await sharp(atlasPath, {
        animated: true,
        failOn: "error",
        page,
        pages: 1,
        sequentialRead: true,
      }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(decoded.info.width, ATLAS_WIDTH);
      assert.equal(decoded.info.height, ATLAS_HEIGHT);
      idle.push(extractCell(decoded.data, 0, 0));
      waving.push(extractCell(decoded.data, 3, 0));
      gaze.push(extractCell(decoded.data, 9, 0));
    }
    return { gaze, idle, waving };
  })();
  return shippingFixturePromise;
}

function shiftNeutralFaceInk(frame, distance) {
  const output = Buffer.from(frame);
  const featurePixels = [];
  for (let y = 20; y < 160; y += 1) {
    for (let x = 20; x < 175 - distance; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      if (
        frame[offset + 3] >= 180
        && Math.max(frame[offset], frame[offset + 1], frame[offset + 2]) < 75
      ) {
        featurePixels.push({ x, y, rgba: Buffer.from(frame.subarray(offset, offset + 4)) });
        output[offset] = 255;
        output[offset + 1] = 255;
        output[offset + 2] = 255;
        output[offset + 3] = 255;
      }
    }
  }
  for (const pixel of featurePixels) {
    const offset = (pixel.y * WIDTH + pixel.x + distance) * 4;
    pixel.rgba.copy(output, offset);
  }
  return output;
}

function addOpaqueArmPatch(frame) {
  const output = Buffer.from(frame);
  for (let y = 112; y < 142; y += 1) {
    for (let x = 174; x < 186; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      output[offset] = 255;
      output[offset + 1] = 255;
      output[offset + 2] = 255;
      output[offset + 3] = 255;
    }
  }
  return output;
}

function alphaRampSequence() {
  return Array.from({ length: FRAMES }, (_, page) => {
    const frame = syntheticFrame();
    for (let y = 168; y < 200; y += 1) {
      for (let x = 8; x < 40; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        frame[offset] = 255;
        frame[offset + 1] = 255;
        frame[offset + 2] = 255;
        frame[offset + 3] = 80 + page * 2;
      }
    }
    return frame;
  });
}

function movingDotSequence() {
  return Array.from({ length: FRAMES }, (_, page) => {
    const frame = syntheticFrame();
    // A 16x14 rectangle has a 60-pixel perimeter, so the production 60-phase
    // fixture advances exactly one source pixel on every edge, including the
    // loop seam. That keeps this guard independent of trigonometric rounding.
    const horizontal = 16;
    const vertical = 14;
    let left;
    let top;
    if (page < horizontal) {
      left = 84 + page;
      top = 150;
    } else if (page < horizontal + vertical) {
      left = 84 + horizontal;
      top = 150 + page - horizontal;
    } else if (page < horizontal * 2 + vertical) {
      left = 84 + horizontal - (page - horizontal - vertical);
      top = 150 + vertical;
    } else {
      left = 84;
      top = 150 + vertical - (page - horizontal * 2 - vertical);
    }
    for (let y = top; y < top + 24; y += 1) {
      for (let x = left; x < left + 24; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        frame[offset] = 249;
        frame[offset + 1] = 112;
        frame[offset + 2] = 92;
        frame[offset + 3] = 255;
      }
    }
    return frame;
  });
}

function addAlphaOnlyPop(frame) {
  const output = Buffer.from(frame);
  for (let y = 90; y < 150; y += 1) {
    for (let x = 170; x < 190; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 255;
    }
  }
  return output;
}

function lowFeatureFrame({ featureX = 110, featureVisible = true } = {}) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 24; y < 162; y += 1) {
    for (let x = 28; x < 172; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      frame[offset] = 255;
      frame[offset + 1] = 255;
      frame[offset + 2] = 255;
      frame[offset + 3] = 255;
    }
  }
  if (featureVisible) {
    for (let y = 66; y < 72; y += 1) {
      for (let x = featureX; x < featureX + 6; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        frame[offset] = 0;
        frame[offset + 1] = 0;
        frame[offset + 2] = 0;
      }
    }
  }
  return frame;
}

function stableGazeBodyTransitions() {
  return Array.from({ length: 16 }, (_, fromDirection) => (
    Array.from({ length: 16 - fromDirection - 1 }, (_, offset) => (
      fromDirection + offset + 1
    )).flatMap((toDirection) => (
      Array.from({ length: FRAMES }, (_, page) => {
        const phase = page / FRAMES * Math.PI * 2;
        return {
          page,
          from: { angleDegrees: fromDirection * 22.5 },
          to: { angleDegrees: toDirection * 22.5 },
          metrics: {
            silhouetteIou: 0.94 + Math.sin(phase) * 0.00005,
            silhouetteCentroidDistancePx: 4 + Math.sin(phase) * 0.002,
            normalizedAlphaDiff: 0.03 + Math.sin(phase) * 0.00001,
            alphaAreaRatioSymmetric: 1.005 + Math.sin(phase) * 0.00005,
          },
        };
      })
    ))
  )).flat();
}

function stableCrossPhaseGazeBodyTransitions() {
  return Array.from({ length: 16 }, (_, fromDirection) => (
    Array.from({ length: 16 }, (_, toDirection) => toDirection)
      .filter((toDirection) => {
        const distance = Math.abs(fromDirection - toDirection);
        const circularDistance = Math.min(distance, 16 - distance);
        return circularDistance > 1;
      })
      .flatMap((toDirection) => (
        Array.from({ length: FRAMES }, (_, page) => {
          const phase = page / FRAMES * Math.PI * 2;
          return {
            page,
            from: { angleDegrees: fromDirection * 22.5 },
            to: { angleDegrees: toDirection * 22.5 },
            metrics: {
              silhouetteIou: 0.9 + Math.sin(phase) * 0.00005,
              silhouetteCentroidDistancePx: 7 + Math.sin(phase) * 0.002,
              normalizedAlphaDiff: 0.05 + Math.sin(phase) * 0.00001,
              alphaAreaRatioSymmetric: 1.01 + Math.sin(phase) * 0.00005,
            },
          };
        })
      ))
  )).flat();
}

function renderCellSequenceAt112(frames, row = 9, column = 0) {
  const atlas = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  return frames.map((frame) => {
    for (let y = 0; y < HEIGHT; y += 1) {
      const target = ((row * HEIGHT + y) * ATLAS_WIDTH + column * WIDTH) * 4;
      frame.copy(atlas, target, y * WIDTH * 4, (y + 1) * WIDTH * 4);
    }
    return renderShippingHostFrame(atlas, row, column, SHIPPING_112_DISPLAY);
  });
}

function exactBrowserSourceMultiplicities(row = 9, column = 0) {
  const map = codexDefaultDpr2CellMap(row, column);
  const multiplicities = new Uint16Array(WIDTH * HEIGHT);
  for (let targetPixel = 0; targetPixel < map.length / 2; targetPixel += 1) {
    const sourceX = map[targetPixel * 2];
    const sourceY = map[targetPixel * 2 + 1];
    multiplicities[sourceY * WIDTH + sourceX] += 1;
  }
  return multiplicities;
}

function addAliasedChromaticPixels(frame, count = 3) {
  const output = Buffer.from(frame);
  const multiplicities = exactBrowserSourceMultiplicities();
  const candidates = [];
  for (let y = 112; y < 140; y += 1) {
    for (let x = 60; x < 100; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      if (
        multiplicities[y * WIDTH + x] === 4
        && frame[offset] === 255
        && frame[offset + 1] === 255
        && frame[offset + 2] === 255
        && frame[offset + 3] === 255
      ) candidates.push({ offset, x, y });
    }
  }
  assert.ok(candidates.length >= count);
  for (const { offset } of candidates.slice(0, count)) {
    output[offset] = 255;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
  }
  return output;
}

function addAliasedAlphaHoles(frame, { count = 550, parity = 0 } = {}) {
  const output = Buffer.from(frame);
  const multiplicities = exactBrowserSourceMultiplicities();
  const candidates = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (multiplicities[y * WIDTH + x] === 4) candidates.push({ x, y });
    }
  }
  assert.ok(candidates.length >= count);
  const selected = candidates.filter((_, index) => index % 2 === parity).slice(0, count);
  assert.equal(selected.length, count);
  assert.equal(new Set(selected.map(({ x, y }) => `${x},${y}`)).size, count);
  for (const { x, y } of selected) {
    const offset = (y * WIDTH + x) * 4;
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
  }
  return output;
}

test("a smooth low-amplitude feature cycle passes every adjacency and circular excursion gate", () => {
  const result = analyzeTemporalRgbaSequence({ frames: smoothSequence(), row: 9, variant: "dark" });
  assert.equal(result.cell.temporalAdjacency.transitionCount, FRAMES);
  assert.equal(result.cell.temporalAdjacency.failingTransitionCount, 0);
  assert.equal(result.cell.isolatedFrameExcursions.frameCount, FRAMES);
  assert.equal(result.cell.isolatedFrameExcursions.failingFrameCount, 0);
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, true);
});

test("a one-frame opaque eye teleport fails with wide local and feature margin", () => {
  const frames = smoothSequence();
  frames[15] = syntheticFrame({ eyeX: 140, eyeTone: 32 });
  const result = analyzeTemporalRgbaSequence({ frames, row: 9, variant: "dark" });
  const failedTransitions = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failedTransitions.length >= 2, "both edges of the one-frame eye teleport must fail");
  assert.ok(failedTransitions.some(({ validation }) => (
    validation.flags.includes("rowFeatureInkVariationFraction")
      || validation.flags.includes("rowFeatureInkCentroidStepPx")
      || validation.flags.includes("rowPerceptualRms")
  )));
  assert.ok(
    Math.max(...failedTransitions.map(({ metrics }) => metrics.perceptualRms))
      > ANIMATED_TEMPORAL_ROW_GATES[9].maximumPerceptualRms * 4,
    "the injected eye snap should exceed the quiet gaze-row perceptual limit by a meaningful margin",
  );
  assert.ok(result.cell.isolatedFrameExcursions.failingFrameCount >= 1);
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, false);
});

test("a one-frame opaque arm appearance fails even though it occupies little of the full cell", () => {
  const frames = smoothSequence();
  frames[15] = syntheticFrame({ arm: true });
  const result = analyzeTemporalRgbaSequence({ frames, row: 0, variant: "dark" });
  const failedTransitions = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failedTransitions.length >= 2);
  assert.ok(failedTransitions.some(({ validation }) => (
    validation.flags.includes("rowNormalizedAlphaDiff")
      || validation.flags.includes("rowChangedAlphaPixelFraction")
  )));
  assert.ok(result.cell.isolatedFrameExcursions.failingFrameCount >= 1);
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, false);
});

test("a one-phase gaze-body mutation fails the pair-specific circular stability invariant", () => {
  const baselineTransitions = stableGazeBodyTransitions();
  const baseline = analyzeGazeBodyPhaseTransitions(baselineTransitions);
  assert.equal(baseline.ok, true);
  assert.equal(baseline.pairCount, GAZE_BODY_PHASE_STABILITY_GATE.requiredPairs);
  assert.equal(baseline.transitionCount, 120 * FRAMES);

  const mutatedTransitions = baselineTransitions.map((transition) => ({
    ...transition,
    metrics: { ...transition.metrics },
  }));
  const mutation = mutatedTransitions.find((transition) => (
    transition.from.angleDegrees === 0
      && transition.to.angleDegrees === 45
      && transition.page === 15
  ));
  mutation.metrics.normalizedAlphaDiff += 0.01;
  const result = analyzeGazeBodyPhaseTransitions(mutatedTransitions);
  assert.equal(result.ok, false);
  const failed = result.pairs.find(({ key }) => key === "0->45");
  assert.equal(failed.ok, false);
  assert.ok(failed.flags.includes("normalizedAlphaDiff:adjacent-step"));
  assert.ok(failed.flags.includes("normalizedAlphaDiff:second-difference"));
  assert.ok(failed.flags.includes("normalizedAlphaDiff:pair-range"));

  const crossBaselineTransitions = stableCrossPhaseGazeBodyTransitions();
  const crossBaseline = analyzeGazeBodyPhaseTransitions(crossBaselineTransitions, {
    gate: GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
  });
  assert.equal(crossBaseline.ok, true);
  assert.equal(crossBaseline.pairCount, GAZE_BODY_CROSS_PHASE_STABILITY_GATE.requiredPairs);
  assert.equal(crossBaseline.transitionCount, 208 * FRAMES);
  const crossMutated = crossBaselineTransitions.map((transition) => ({
    ...transition,
    metrics: { ...transition.metrics },
  }));
  const crossMutation = crossMutated.find((transition) => (
    transition.from.angleDegrees === 0
      && transition.to.angleDegrees === 45
      && transition.page === 15
  ));
  crossMutation.metrics.silhouetteCentroidDistancePx += 1;
  const crossResult = analyzeGazeBodyPhaseTransitions(crossMutated, {
    gate: GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
  });
  assert.equal(crossResult.ok, false);
  const crossFailed = crossResult.pairs.find(({ key }) => key === "0->45");
  assert.ok(crossFailed.flags.includes("silhouetteCentroidDistancePx:adjacent-step"));
  assert.ok(crossFailed.flags.includes("silhouetteCentroidDistancePx:second-difference"));
  assert.ok(crossFailed.flags.includes("silhouetteCentroidDistancePx:pair-range"));

  const displayed112BaselineTransitions = baselineTransitions.filter((transition) => {
    const distance = Math.abs(
      transition.from.angleDegrees - transition.to.angleDegrees,
    );
    return Math.min(distance, 360 - distance) > 22.5;
  });
  const displayed112Baseline = analyzeGazeBodyPhaseTransitions(
    displayed112BaselineTransitions,
    { gate: DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE },
  );
  assert.equal(displayed112Baseline.ok, true);
  assert.equal(
    displayed112Baseline.pairCount,
    DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE.requiredPairs,
  );
  assert.equal(displayed112Baseline.transitionCount, 104 * FRAMES);
  const displayed112Mutated = displayed112BaselineTransitions.map((transition) => ({
    ...transition,
    metrics: { ...transition.metrics },
  }));
  const displayed112Mutation = displayed112Mutated.find((transition) => (
    transition.from.angleDegrees === 0
      && transition.to.angleDegrees === 45
      && transition.page === 15
  ));
  displayed112Mutation.metrics.normalizedAlphaDiff += 0.01;
  const displayed112Result = analyzeGazeBodyPhaseTransitions(displayed112Mutated, {
    gate: DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
  });
  assert.equal(displayed112Result.ok, false);
  assert.ok(displayed112Result.pairs.find(({ key }) => key === "0->45").flags.includes(
    "normalizedAlphaDiff:second-difference",
  ));

  const displayed112CrossBaseline = analyzeGazeBodyPhaseTransitions(
    crossBaselineTransitions,
    { gate: DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE },
  );
  assert.equal(displayed112CrossBaseline.ok, true);
  assert.equal(
    displayed112CrossBaseline.pairCount,
    DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE.requiredPairs,
  );
  assert.equal(displayed112CrossBaseline.transitionCount, 208 * FRAMES);
  const displayed112CrossMutated = crossBaselineTransitions.map((transition) => ({
    ...transition,
    metrics: { ...transition.metrics },
  }));
  const displayed112CrossMutation = displayed112CrossMutated.find((transition) => (
    transition.from.angleDegrees === 0
      && transition.to.angleDegrees === 45
      && transition.page === 15
  ));
  displayed112CrossMutation.metrics.silhouetteCentroidDistancePx += 1;
  const displayed112CrossResult = analyzeGazeBodyPhaseTransitions(
    displayed112CrossMutated,
    { gate: DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE },
  );
  assert.equal(displayed112CrossResult.ok, false);
  assert.ok(displayed112CrossResult.pairs.find(({ key }) => key === "0->45").flags.includes(
    "silhouetteCentroidDistancePx:pair-range",
  ));
});

test("a loop-seam-only alpha drift fails the dedicated seam ceiling", () => {
  const result = analyzeTemporalRgbaSequence({
    frames: alphaRampSequence(),
    row: 4,
    variant: "dark",
  });
  const internal = result.cell.temporalAdjacency.transitions.filter(({ seam }) => !seam);
  const seam = result.cell.temporalAdjacency.transitions.find(({ seam: isSeam }) => isSeam);
  assert.ok(internal.every(({ validation }) => validation.ok));
  assert.equal(seam.validation.ok, false);
  assert.ok(seam.validation.flags.some((flag) => flag.startsWith("loop")));
  assert.ok(seam.validation.flags.every((flag) => (
    flag.startsWith("loop") || flag === "localEnergyRatio"
  )));
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, false);
});

test("a frozen frame followed by decoder catch-up is rejected", () => {
  const baselineFrames = movingDotSequence();
  const baseline = analyzeTemporalRgbaSequence({ frames: baselineFrames, row: 4, variant: "dark" });
  assert.equal(baseline.cell.motionExists, true, JSON.stringify({
    errors: baseline.errors,
    minimumRgba: baseline.cell.internalAdjacency.minimumNormalizedRgbaDiff,
    minimumChanged: baseline.cell.internalAdjacency.minimumChangedPixelFraction,
  }));
  assert.equal(baseline.cell.temporalAdjacency.upperBoundSafe, true, JSON.stringify({
    errors: baseline.errors,
    failing: baseline.cell.temporalAdjacency.transitions
      .filter(({ validation }) => !validation.ok)
      .map(({ fromPage, toPage, validation }) => ({ fromPage, toPage, flags: validation.flags })),
    isolated: baseline.cell.isolatedFrameExcursions.frames
      .filter(({ validation }) => !validation.ok),
  }));

  const frozen = baselineFrames.map((frame) => Buffer.from(frame));
  frozen[15] = Buffer.from(frozen[14]);
  const result = analyzeTemporalRgbaSequence({ frames: frozen, row: 4, variant: "dark" });
  assert.equal(result.cell.motionExists, false);
  assert.ok(result.errors.some((error) => error.includes("no temporal pixel motion")));
  const freezeEdge = result.cell.temporalAdjacency.transitions[14];
  assert.equal(freezeEdge.metrics.normalizedRgbaDiff, 0);
  assert.equal(freezeEdge.metrics.changedPixelFraction, 0);
});

test("a quantized shipping gaze passes the full-cycle motion proof but a frozen cycle fails", async () => {
  const { gaze } = await darkShippingFixtures();
  const baseline = analyzeTemporalRgbaSequence({ frames: gaze, row: 9, variant: "dark" });
  assert.equal(baseline.cell.motionExists, true);
  assert.equal(baseline.cell.fullCycleMotion.mode, "gaze-full-cycle");
  assert.ok(
    baseline.cell.fullCycleMotion.activeInternalTransitionCount < FRAMES - 1,
    "the fixture must exercise the quantized sub-threshold-edge allowance",
  );
  assert.ok(
    baseline.cell.fullCycleMotion.activeInternalTransitionFraction
      >= TEMPORAL_MOTION_GATE.gazeFullCycle.minimumActiveInternalTransitionFraction,
  );
  assert.ok(
    baseline.cell.fullCycleMotion.totalNormalizedRgbaDiff
      >= TEMPORAL_MOTION_GATE.gazeFullCycle.minimumTotalNormalizedRgbaDiff,
  );
  assert.ok(
    baseline.cell.fullCycleMotion.totalChangedPixelFraction
      >= TEMPORAL_MOTION_GATE.gazeFullCycle.minimumTotalChangedPixelFraction,
  );

  const frozen = gaze.map(() => Buffer.from(gaze[0]));
  const result = analyzeTemporalRgbaSequence({ frames: frozen, row: 9, variant: "dark" });
  assert.equal(result.cell.motionExists, false);
  assert.equal(result.cell.fullCycleMotion.passesSelectedGate, false);
  assert.ok(result.errors.some((error) => error.includes("no temporal pixel motion")));
});

test("a localized alpha-only one-frame pop fails alpha and excursion gates", () => {
  const frames = movingDotSequence();
  frames[15] = addAlphaOnlyPop(frames[15]);
  const result = analyzeTemporalRgbaSequence({ frames, row: 3, variant: "dark" });
  const failures = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failures.length >= 2);
  assert.ok(failures.some(({ validation }) => (
    validation.flags.includes("rowNormalizedAlphaDiff")
      || validation.flags.includes("rowChangedAlphaPixelFraction")
  )));
  assert.ok(result.cell.isolatedFrameExcursions.failingFrameCount >= 1);
});

test("low feature mass disables centroid noise but not a visible feature teleport", () => {
  const frames = Array.from({ length: FRAMES }, () => lowFeatureFrame());
  frames[15] = lowFeatureFrame({ featureX: 145 });
  const result = analyzeTemporalRgbaSequence({ frames, row: 9, variant: "dark" });
  const failures = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failures.length >= 2);
  assert.ok(failures.every(({ metrics }) => (
    metrics.featureInkMaterial === false && metrics.featureInkCentroidMaterial === false
  )));
  assert.ok(failures.every(({ validation }) => (
    !validation.flags.includes("rowFeatureInkCentroidStepPx")
      && !validation.flags.includes("rowFeatureInkMassStepFraction")
      && !validation.flags.includes("rowFeatureInkVariationFraction")
  )));
  assert.ok(failures.some(({ validation }) => (
    validation.flags.includes("rowPerceptualRms")
      || validation.flags.includes("rowStronglyChangedCellFraction")
  )));
});

test("an alias-specific stitch passes source limits but fails the exact 7.04rem DPR2 gate", () => {
  const sourceFrames = Array.from({ length: FRAMES }, () => syntheticFrame());
  sourceFrames[15] = addAliasedChromaticPixels(sourceFrames[15]);
  const source = analyzeTemporalRgbaSequence({ frames: sourceFrames, row: 9, variant: "dark" });
  assert.equal(source.cell.temporalAdjacency.upperBoundSafe, true, JSON.stringify(source.errors));
  assert.ok(Math.max(...source.cell.temporalAdjacency.transitions.map(
    ({ metrics }) => metrics.perceptualRms,
  )) < ANIMATED_TEMPORAL_ROW_GATES[9].maximumPerceptualRms);

  const displayedBaseline = renderCellSequenceAt112(
    Array.from({ length: FRAMES }, () => syntheticFrame()),
  );
  const displayedBaselineResult = analyzeDisplayed112RgbaSequence({
    frames: displayedBaseline,
    row: 9,
    variant: "dark",
  });
  assert.equal(displayedBaselineResult.cell.upperBoundSafe, true);

  const displayedFrames = renderCellSequenceAt112(sourceFrames);
  const displayed = analyzeDisplayed112RgbaSequence({
    frames: displayedFrames,
    row: 9,
    variant: "dark",
  });
  assert.equal(displayed.cell.upperBoundSafe, false);
  const failures = displayed.cell.transitions.filter(({ validation }) => !validation.ok);
  assert.ok(failures.length >= 2);
  assert.ok(failures.some(({ validation }) => (
    validation.flags.includes("rowPerceptualRms")
      || validation.flags.includes("localEnergyRatio")
  )));
  assert.ok(
    Math.max(...failures.map(({ metrics }) => metrics.perceptualRms))
      > ANIMATED_112_TEMPORAL_ROW_GATES[9].maximumPerceptualRms * 1.15,
    "authoritative scaling must amplify the source-safe defect beyond the row gate by at least 15%",
  );
  assert.ok(
    Math.max(...displayed.cell.isolatedFrames.map(({ excursionRatio }) => excursionRatio))
      > ANIMATED_112_TEMPORAL_GATE.maximumIsolatedFrameExcursionRatio * 1.4,
    "the scaled one-frame excursion must retain at least 40% margin over the global gate",
  );
});

test("a host-boundary alias passes the source host gate but fails the exact 7.04rem DPR2 host gate", () => {
  const opaqueSource = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  const sourceFrom = addAliasedAlphaHoles(opaqueSource, { parity: 0 });
  const sourceTo = addAliasedAlphaHoles(opaqueSource, { parity: 1 });
  const source = analyzeSourceHostBoundaryRgba({
    from: sourceFrom,
    to: sourceTo,
    gateKind: "adjacentGazeSector",
  });
  assert.equal(source.validation.ok, true, JSON.stringify(source));
  assert.ok(
    source.metrics.normalizedAlphaDiff
      < source.validation.gate.maximumNormalizedAlphaDiff * 0.8,
    "the source transition must retain at least 20% margin below its alpha ceiling",
  );
  assert.ok(source.metrics.silhouetteIou > source.validation.gate.minimumSilhouetteIou);

  const [displayedFrom, displayedTo] = renderCellSequenceAt112([sourceFrom, sourceTo]);
  const displayed = analyzeDisplayed112HostBoundaryRgba({
    from: displayedFrom,
    to: displayedTo,
    variant: "dark",
    gateKind: "samePhaseAdjacentGaze",
  });
  assert.equal(displayed.validation.ok, false);
  assert.ok(displayed.validation.flags.includes("normalizedAlphaDiff"));
  assert.ok(
    displayed.metrics.normalizedAlphaDiff
      > DISPLAYED_112_HOST_BOUNDARY_GATES.samePhaseAdjacentGaze
        .maximumNormalizedAlphaDiff * 1.5,
    "nearest-neighbor sampling must amplify the source-safe alpha defect by at least 50%",
  );
});

test("compact traces retain every failure beyond their bounded worst-case review set", () => {
  const transitions = Array.from({ length: 12 }, (_, index) => ({
    id: `synthetic-failure-${index}`,
    kind: "synthetic-red-path",
    gateKind: "synthetic",
    page: index,
    fromPage: index,
    toPage: (index + 1) % 12,
    seam: index === 11,
    from: { row: 0, column: 0 },
    to: { row: 0, column: 0 },
    metrics: { normalizedRgbaDiff: (index + 1) / 100 },
    validation: {
      ok: false,
      checks: { normalizedRgbaDiff: false },
      flags: ["normalizedRgbaDiff"],
    },
  }));
  const trace = summarizeHostTransitionTrace(transitions);
  assert.equal(trace.recordCount, 12);
  assert.equal(trace.worstByMetric.normalizedRgbaDiff.length, 5);
  assert.deepEqual(
    trace.worstByMetric.normalizedRgbaDiff.map(({ id }) => id),
    [11, 10, 9, 8, 7].map((index) => `synthetic-failure-${index}`),
  );
  assert.deepEqual(
    trace.failingTransitionIds,
    transitions.map(({ id }) => id),
    "all failures must survive compaction even when only five worst records remain reviewable",
  );
});

test("the approved blink trace passes but a one-frame face-ink stitch injected into it fails", async () => {
  const { idle } = await darkShippingFixtures();
  const baseline = analyzeTemporalRgbaSequence({ frames: idle, row: 0, variant: "dark" });
  assert.equal(baseline.cell.temporalAdjacency.upperBoundSafe, true);

  const mutated = idle.map((frame) => Buffer.from(frame));
  mutated[12] = shiftNeutralFaceInk(mutated[12], 16);
  const result = analyzeTemporalRgbaSequence({ frames: mutated, row: 0, variant: "dark" });
  const failures = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failures.length >= 1);
  assert.ok(failures.some(({ validation }) => (
    validation.flags.includes("rowFeatureInkVariationFraction")
      || validation.flags.includes("rowFeatureInkCentroidStepPx")
      || validation.flags.includes("localEnergyRatio")
  )));
  assert.ok(failures.some(({ metrics }) => (
    metrics.featureInkCentroidStepPx
      > ANIMATED_TEMPORAL_ROW_GATES[0].maximumFeatureInkCentroidStepPx * 1.5
      || metrics.localEnergyRatio
        > ANIMATED_TEMPORAL_ROW_GATES[0].maximumLocalEnergyRatio * 1.15
  )), "the real blink-neighborhood defect must fail with meaningful local margin");
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, false);
});

test("the approved waving trace passes but a small one-frame arm pop injected into it fails", async () => {
  const { waving } = await darkShippingFixtures();
  const baseline = analyzeTemporalRgbaSequence({ frames: waving, row: 3, variant: "dark" });
  assert.equal(baseline.cell.temporalAdjacency.upperBoundSafe, true);

  const mutated = waving.map((frame) => Buffer.from(frame));
  mutated[17] = addOpaqueArmPatch(mutated[17]);
  const result = analyzeTemporalRgbaSequence({ frames: mutated, row: 3, variant: "dark" });
  const failures = result.cell.temporalAdjacency.transitions.filter(
    ({ validation }) => !validation.ok,
  );
  assert.ok(failures.length >= 2);
  assert.ok(failures.some(({ validation }) => (
    validation.flags.includes("rowNormalizedAlphaDiff")
      || validation.flags.includes("rowPerceptualRms")
      || validation.flags.includes("localEnergyRatio")
  )));
  assert.ok(failures.some(({ metrics }) => (
    metrics.normalizedAlphaDiff
      > ANIMATED_TEMPORAL_ROW_GATES[3].maximumNormalizedAlphaDiff * 2
      || metrics.perceptualRms
        > ANIMATED_TEMPORAL_ROW_GATES[3].maximumPerceptualRms * 2
  )), "the real waving-neighborhood defect must fail with meaningful local margin");
  assert.ok(result.cell.isolatedFrameExcursions.failingFrameCount >= 1);
  assert.equal(result.cell.temporalAdjacency.upperBoundSafe, false);
});

test("shipping reports trace every temporal and host-boundary edge with no omissions", async () => {
  const reports = await Promise.all(["dark", "light"].map(async (variant) => (
    JSON.parse(await readFile(path.join(root, `qa/animated-atlas-${variant}.json`), "utf8"))
  )));
  for (const report of reports) {
    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.deepEqual(report.contract.temporalMotion, TEMPORAL_MOTION_GATE);
    assert.deepEqual(report.contract.temporalAdjacencyUpperBounds, ANIMATED_TEMPORAL_ADJACENCY_GATE);
    assert.deepEqual(report.contract.temporalRowUpperBounds, ANIMATED_TEMPORAL_ROW_GATES);
    assert.deepEqual(report.contract.displayed112TemporalUpperBounds, ANIMATED_112_TEMPORAL_GATE);
    assert.deepEqual(
      report.contract.displayed112TemporalRowUpperBounds,
      ANIMATED_112_TEMPORAL_ROW_GATES,
    );
    assert.deepEqual(report.contract.displayed112Sampling, SHIPPING_112_DISPLAY);
    assert.deepEqual(
      report.contract.displayed112HostBoundaryGates,
      DISPLAYED_112_HOST_BOUNDARY_GATES,
    );
    assert.deepEqual(
      report.contract.displayed112HostGazeBodyPhaseStabilityGate,
      DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
    );
    assert.deepEqual(
      report.contract.displayed112HostGazeBodyCrossPhaseStabilityGate,
      DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
    );
    assert.deepEqual(report.contract.gazeBodyPhaseStabilityGate, GAZE_BODY_PHASE_STABILITY_GATE);
    assert.deepEqual(
      report.contract.gazeBodyCrossPhaseStabilityGate,
      GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
    );
    assert.equal(report.temporal.transitionCount, 73 * FRAMES);
    assert.equal(report.temporal.internalTransitionCount, 73 * (FRAMES - 1));
    assert.equal(report.temporal.loopSeamCount, 73);
    assert.equal(report.temporal.isolatedFrameCount, 73 * FRAMES);
    assert.equal(report.temporal.upperBoundSafeCellCount, 73);
    assert.equal(report.temporal.adjacencyUpperBounds.failingTransitionCount, 0);
    assert.equal(report.temporal.adjacencyUpperBounds.failingIsolatedFrameCount, 0);
    assert.deepEqual(report.displayedTemporal112.display, SHIPPING_112_DISPLAY);
    assert.equal(report.displayedTemporal112.requiredCellCount, 73);
    assert.equal(report.displayedTemporal112.frameCount, FRAMES);
    assert.equal(report.displayedTemporal112.transitionCount, 73 * FRAMES);
    assert.equal(report.displayedTemporal112.internalTransitionCount, 73 * (FRAMES - 1));
    assert.equal(report.displayedTemporal112.loopSeamCount, 73);
    assert.equal(report.displayedTemporal112.isolatedFrameCount, 73 * FRAMES);
    assert.equal(report.displayedTemporal112.upperBoundSafeCellCount, 73);
    assert.equal(report.displayedTemporal112.failingTransitionCount, 0);
    assert.equal(report.displayedTemporal112.failingIsolatedFrameCount, 0);
    assert.equal(report.displayedTemporal112.completeCoverage, true);
    assert.ok(
      report.displayedTemporal112.maximumObservedMaterialLocalEnergyRatio.value
        <= ANIMATED_112_TEMPORAL_GATE.maximumLocalEnergyRatio,
    );
    assert.ok(
      report.displayedTemporal112.maximumObservedMaterialIsolatedFrameExcursion.value
        <= ANIMATED_112_TEMPORAL_GATE.maximumIsolatedFrameExcursionRatio,
    );
    for (let row = 0; row < 11; row += 1) {
      const materialLocal = report.displayedTemporal112
        .rowMaximumObservedMaterialLocalEnergyRatio[row];
      const materialIsolated = report.displayedTemporal112
        .rowMaximumObservedMaterialIsolatedFrameExcursionRatio[row];
      if (materialLocal != null) {
        assert.ok(materialLocal <= ANIMATED_112_TEMPORAL_ROW_GATES[row].maximumLocalEnergyRatio);
      } else {
        assert.ok(
          report.displayedTemporal112.rowMaximumObserved[row].perceptualRms
            < ANIMATED_112_TEMPORAL_GATE.localEnergyMaterialPerceptualRms,
        );
      }
      if (materialIsolated != null) {
        assert.ok(
          materialIsolated
            <= ANIMATED_112_TEMPORAL_ROW_GATES[row].maximumIsolatedFrameExcursionRatio,
        );
      }
    }
    const host112 = report.displayed112HostBoundaries;
    assert.equal(host112.ok, true);
    assert.deepEqual(host112.display, SHIPPING_112_DISPLAY);
    assert.deepEqual(host112.gates, DISPLAYED_112_HOST_BOUNDARY_GATES);
    assert.equal(host112.core.transitionCount, HOST_CORE_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.core.passingTransitionCount, HOST_CORE_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.core.failingTransitionCount, 0);
    assert.equal(host112.totalUniqueTransitionCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.expectedTotalUniqueTransitionCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.membership.ok, true);
    assert.equal(host112.membership.expectedCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.membership.actualCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(host112.membership.orderedExactly, true);
    assert.match(host112.canonicalAlphaSilhouetteSequenceSha256, /^[a-f0-9]{64}$/);
    const expectedHost112GroupCounts = {
      samePhaseTimedRowPairs: 36 * FRAMES,
      samePhaseEligibleTimedToGaze: 48 * FRAMES,
      samePhaseOtherTimedToGaze: 96 * FRAMES,
      samePhaseAdjacentGaze: 16 * FRAMES,
      crossPhaseTimedRowChanges: 72 * FRAMES,
      crossPhaseAdjacentGaze: 32 * FRAMES,
      crossPhaseGazeToEligibleTimed: 48 * FRAMES,
      crossPhaseGazeToOtherTimed: 96 * FRAMES,
      crossPhaseEligibleTimedToGaze: 48 * FRAMES,
    };
    for (const [key, expectedCount] of Object.entries(expectedHost112GroupCounts)) {
      const group = host112.core.groups[key];
      assert.equal(group.count, expectedCount);
      assert.equal(group.passing, expectedCount);
      assert.equal(group.failing, 0);
      assert.equal(group.membership.ok, true);
      assert.equal(group.membership.actualCount, expectedCount);
      assert.match(group.canonicalAlphaSilhouetteSequenceSha256, /^[a-f0-9]{64}$/);
      assertCompactTrace(group.trace, expectedCount);
      assert.deepEqual(group.trace.failingTransitionIds, group.failingTransitionIds);
    }
    const host112SamePair = host112.supplemental.samePhaseNonNeighborGaze;
    assert.equal(host112SamePair.transitionCount, SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(host112SamePair.membership.ok, true);
    assert.equal(host112SamePair.phaseStability.ok, true);
    assert.equal(host112SamePair.phaseStability.pairCount, 104);
    assert.equal(host112SamePair.phaseStability.transitionCount, SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(host112SamePair.phaseStability.failingPairCount, 0);
    assertCompactTrace(host112SamePair.trace, SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    const host112CrossPair = host112.supplemental.crossPhaseNonNeighborGaze;
    assert.equal(host112CrossPair.transitionCount, CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(host112CrossPair.membership.ok, true);
    assert.equal(host112CrossPair.phaseStability.ok, true);
    assert.equal(host112CrossPair.phaseStability.pairCount, 208);
    assert.equal(host112CrossPair.phaseStability.transitionCount, CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(host112CrossPair.phaseStability.failingPairCount, 0);
    assertCompactTrace(host112CrossPair.trace, CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assertCompactTrace(host112.orderedFullRecordTrace, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.deepEqual(
      host112.orderedFullRecordTrace.failingTransitionIds,
      host112.failingTransitionIds,
    );

    const sourceHost = report.sourceHostBoundaries;
    assert.equal(sourceHost.ok, true);
    assert.equal(sourceHost.core.transitionCount, HOST_CORE_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.core.passingTransitionCount, HOST_CORE_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.core.failingTransitionCount, 0);
    assert.equal(sourceHost.totalUniqueTransitionCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.expectedTotalUniqueTransitionCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.membership.ok, true);
    assert.equal(sourceHost.membership.expectedCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.membership.actualCount, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    assert.equal(sourceHost.membership.orderedExactly, true);
    assert.match(sourceHost.canonicalAlphaSilhouetteSequenceSha256, /^[a-f0-9]{64}$/);
    assertCompactTrace(sourceHost.orderedFullRecordTrace, TOTAL_HOST_TRANSITIONS_PER_VARIANT);
    for (const [key, expectedCount] of Object.entries(expectedHost112GroupCounts)) {
      const group = sourceHost.core.groups[key];
      assert.equal(group.count, expectedCount);
      assert.equal(group.passing, expectedCount);
      assert.equal(group.failing, 0);
      assert.equal(group.membership.ok, true);
      assertCompactTrace(group.trace, expectedCount);
      assert.deepEqual(group.trace.failingTransitionIds, group.failingTransitionIds);
    }
    assertCompactTrace(
      sourceHost.supplemental.samePhaseNonNeighborGaze.trace,
      SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    );
    assertCompactTrace(
      sourceHost.supplemental.crossPhaseNonNeighborGaze.trace,
      CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    );
    assert.deepEqual(
      sourceHost.orderedFullRecordTrace.failingTransitionIds,
      sourceHost.failingTransitionIds,
    );
    assert.equal(report.samePhaseTransitions.timedRowPairs.count, 36 * FRAMES);
    assert.equal(report.samePhaseTransitions.gazeEntry.count, 144 * FRAMES);
    assert.equal(report.samePhaseTransitions.gazeNeighborPairs.count, 16 * FRAMES);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.count, 120 * FRAMES);
    assert.equal(report.samePhaseTransitions.membership.ok, true);
    assert.equal(report.samePhaseTransitions.membership.phaseCount, FRAMES);
    assert.ok(report.samePhaseTransitions.membership.phases.every((phase) => (
      phase.ok
        && phase.actionToIdle.expectedCount === 8
        && phase.gazeTimedBoundaries.expectedCount === 144
        && phase.timedRowPairs.expectedCount === 36
        && phase.gazeNeighborPairs.expectedCount === 16
        && phase.gazeBodyPairs.expectedCount === 120
        && [
          phase.actionToIdle,
          phase.gazeTimedBoundaries,
          phase.timedRowPairs,
          phase.gazeNeighborPairs,
          phase.gazeBodyPairs,
        ].every((membership) => (
          membership.ok
            && membership.expectedCount === membership.actualCount
            && membership.expectedIdsSha256 === membership.actualIdsSha256
            && membership.duplicateIds.length === 0
            && membership.missingIds.length === 0
            && membership.unexpectedIds.length === 0
        ))
    )));
    assert.equal(report.crossPhaseTransitions.phaseWindowCount, FRAMES);
    assert.equal(report.crossPhaseTransitions.loopSeamWindowCount, 1);
    assert.equal(report.crossPhaseTransitions.timedRowChanges.count, 72 * FRAMES);
    assert.equal(report.crossPhaseTransitions.gazeNeighborChanges.count, 32 * FRAMES);
    assert.equal(report.crossPhaseTransitions.gazeTimedBoundaries.count, 192 * FRAMES);
    assert.equal(report.crossPhaseTransitions.gazeTimedBoundaries.gazeToTimedCount, 144 * FRAMES);
    assert.equal(
      report.crossPhaseTransitions.gazeTimedBoundaries.eligibleTimedToGazeCount,
      48 * FRAMES,
    );
    assert.equal(report.crossPhaseTransitions.gazeBodyNonNeighborChanges.count, 208 * FRAMES);
    assert.equal(report.crossPhaseTransitions.membership.ok, true);
    assert.equal(report.crossPhaseTransitions.membership.windowCount, FRAMES);
    assert.ok(report.crossPhaseTransitions.membership.windows.every((window) => (
      window.ok
        && window.timedRowChanges.expectedCount === 72
        && window.gazeNeighborChanges.expectedCount === 32
        && window.gazeToTimed.expectedCount === 144
        && window.eligibleTimedToGaze.expectedCount === 48
        && window.gazeBodyNonNeighborChanges.expectedCount === 208
        && [
          window.timedRowChanges,
          window.gazeNeighborChanges,
          window.gazeToTimed,
          window.eligibleTimedToGaze,
          window.gazeBodyNonNeighborChanges,
        ].every((membership) => (
          membership.ok
            && membership.expectedCount === membership.actualCount
            && membership.expectedIdsSha256 === membership.actualIdsSha256
            && membership.duplicateIds.length === 0
            && membership.missingIds.length === 0
            && membership.unexpectedIds.length === 0
        ))
    )));
    assert.deepEqual(report.samePhaseTransitions.failedTransitionIds, []);
    assert.deepEqual(report.crossPhaseTransitions.failedTransitionIds, []);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.phaseStability.ok, true);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.phaseStability.pairCount, 120);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.phaseStability.transitionCount, 120 * FRAMES);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.phaseStability.failingPairCount, 0);
    assert.equal(report.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborPairCount, 104);
    assert.equal(
      report.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount,
      SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    );
    assert.equal(
      report.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborPairKeys.length,
      104,
    );
    assert.ok(report.samePhaseTransitions.gazeBodyPairs.phaseStability.pairs.every((pair) => (
      pair.complete && pair.phaseCount === FRAMES && pair.ok && pair.flags.length === 0
    )));
    const crossGazePhase = report.crossPhaseTransitions.gazeBodyNonNeighborChanges.phaseStability;
    assert.equal(crossGazePhase.ok, true);
    assert.equal(crossGazePhase.pairCount, 208);
    assert.equal(crossGazePhase.transitionCount, CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(crossGazePhase.adjacentPairCount, 0);
    assert.equal(crossGazePhase.nonNeighborPairCount, 208);
    assert.equal(crossGazePhase.nonNeighborTransitionCount, CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT);
    assert.equal(crossGazePhase.failingPairCount, 0);
    assert.ok(crossGazePhase.pairs.every((pair) => (
      pair.complete && pair.phaseCount === FRAMES && pair.ok && pair.flags.length === 0
    )));
    for (const cell of report.temporal.cells) {
      assertCompactTrace(cell.temporalAdjacency.trace, FRAMES);
      assert.equal(cell.isolatedFrameExcursions.trace.recordCount, FRAMES);
      assert.match(
        cell.isolatedFrameExcursions.trace.orderedIdsSha256,
        /^[a-f0-9]{64}$/,
      );
      assert.match(
        cell.isolatedFrameExcursions.trace.orderedFullRecordSha256,
        /^[a-f0-9]{64}$/,
      );
      assert.deepEqual(cell.isolatedFrameExcursions.trace.failingFrameIds, []);
    }
    assertCompactTrace(report.temporal.orderedTransitionTrace, 73 * FRAMES);
    assert.equal(report.temporal.orderedIsolatedFrameTrace.recordCount, 73 * FRAMES);
    assert.deepEqual(report.temporal.orderedIsolatedFrameTrace.failingFrameIds, []);
    for (const cell of report.displayedTemporal112.cells) {
      assert.equal(cell.transitionCount, FRAMES);
      assert.equal(cell.internalTransitionCount, FRAMES - 1);
      assert.equal(cell.loopSeamCount, 1);
      assert.equal(cell.isolatedFrameCount, FRAMES);
      assert.equal(cell.upperBoundSafe, true);
      assertCompactTrace(cell.transitionTrace, FRAMES);
      assert.equal(cell.isolatedFrameTrace.recordCount, FRAMES);
      assert.match(cell.isolatedFrameTrace.orderedIdsSha256, /^[a-f0-9]{64}$/);
      assert.match(cell.isolatedFrameTrace.orderedFullRecordSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(cell.isolatedFrameTrace.failingFrameIds, []);
    }
    assertCompactTrace(report.displayedTemporal112.orderedTransitionTrace, 73 * FRAMES);
    assert.equal(
      report.displayedTemporal112.orderedIsolatedFrameTrace.recordCount,
      73 * FRAMES,
    );
    assert.deepEqual(
      report.displayedTemporal112.orderedIsolatedFrameTrace.failingFrameIds,
      [],
    );
    const allFrameSheet = report.temporal.artifacts.allFrameSheet;
    assert.equal(allFrameSheet.frameCount, FRAMES);
    assert.equal(allFrameSheet.requiredCellCount, 73);
    assert.equal(allFrameSheet.displayedCellFrames, REQUIRED_CELL_COUNT * FRAMES);
    assert.match(allFrameSheet.sha256, /^[a-f0-9]{64}$/);
    assert.match(allFrameSheet.sampling, /no resampling/);
    const allFrameBytes = await readFile(path.join(root, allFrameSheet.path));
    assert.equal(sha256(allFrameBytes), allFrameSheet.sha256);
    const allFrameMetadata = await sharp(allFrameBytes).metadata();
    assert.equal(allFrameMetadata.width, allFrameSheet.width);
    assert.equal(allFrameMetadata.height, allFrameSheet.height);
  }
  const darkGazeSeriesSha = reports[0].samePhaseTransitions.gazeBodyPairs
    .phaseStability.canonicalPairSequenceSha256;
  const lightGazeSeriesSha = reports[1].samePhaseTransitions.gazeBodyPairs
    .phaseStability.canonicalPairSequenceSha256;
  assert.match(darkGazeSeriesSha, /^[a-f0-9]{64}$/);
  assert.equal(darkGazeSeriesSha, lightGazeSeriesSha);

  const combined = JSON.parse(await readFile(path.join(root, "qa/animated-atlas.json"), "utf8"));
  assert.equal(
    combined.temporalCoverage.totalTransitions,
    VARIANT_COUNT * REQUIRED_CELL_COUNT * FRAMES,
  );
  assert.equal(
    combined.temporalCoverage.totalInternalTransitions,
    VARIANT_COUNT * REQUIRED_CELL_COUNT * (FRAMES - 1),
  );
  assert.equal(combined.temporalCoverage.totalLoopSeams, VARIANT_COUNT * REQUIRED_CELL_COUNT);
  assert.equal(
    combined.temporalCoverage.totalIsolatedFrameWindows,
    VARIANT_COUNT * REQUIRED_CELL_COUNT * FRAMES,
  );
  assert.deepEqual(combined.temporalCoverage.displayed112, {
    totalTransitions: VARIANT_COUNT * REQUIRED_CELL_COUNT * FRAMES,
    totalInternalTransitions: VARIANT_COUNT * REQUIRED_CELL_COUNT * (FRAMES - 1),
    totalLoopSeams: VARIANT_COUNT * REQUIRED_CELL_COUNT,
    totalIsolatedFrameWindows: VARIANT_COUNT * REQUIRED_CELL_COUNT * FRAMES,
    totalFailingTransitions: 0,
    totalFailingIsolatedFrames: 0,
  });
  assert.equal(combined.hostBoundaryCoverage.samePhase.timedRowPairs, VARIANT_COUNT * 36 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.samePhase.gazeTimedBoundaries, VARIANT_COUNT * 144 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.samePhase.gazeNeighborPairs, VARIANT_COUNT * 16 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.samePhase.gazeBodyPairs, VARIANT_COUNT * 120 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.samePhase.gazeBodyNonNeighborPairs, VARIANT_COUNT * 104 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.timedRowChanges, VARIANT_COUNT * 72 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.gazeNeighborChanges, VARIANT_COUNT * 32 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.gazeTimedBoundaries, VARIANT_COUNT * 192 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.gazeToTimed, VARIANT_COUNT * 144 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.eligibleTimedToGaze, VARIANT_COUNT * 48 * FRAMES);
  assert.equal(combined.hostBoundaryCoverage.crossPhase.gazeBodyNonNeighborChanges, VARIANT_COUNT * 208 * FRAMES);
  assert.deepEqual(combined.hostBoundaryCoverage.disjointTotals, {
    coreRuntimeTransitions: VARIANT_COUNT * HOST_CORE_TRANSITIONS_PER_VARIANT,
    supplementalSamePhaseNonNeighborGaze:
      VARIANT_COUNT * SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    supplementalCrossPhaseNonNeighborGaze:
      VARIANT_COUNT * CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    totalUniqueRuntimeTransitions: VARIANT_COUNT * TOTAL_HOST_TRANSITIONS_PER_VARIANT,
  });
  assert.deepEqual(combined.hostBoundaryCoverage.displayed112, {
    variants: 2,
    coreRuntimeTransitions: VARIANT_COUNT * HOST_CORE_TRANSITIONS_PER_VARIANT,
    supplementalSamePhaseNonNeighborGaze:
      VARIANT_COUNT * SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    supplementalCrossPhaseNonNeighborGaze:
      VARIANT_COUNT * CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    totalUniqueRuntimeTransitions: VARIANT_COUNT * TOTAL_HOST_TRANSITIONS_PER_VARIANT,
    totalFailingCoreTransitions: 0,
    exactMembership: true,
  });
  assert.deepEqual(combined.hostBoundaryCoverage.sourceCell, {
    variants: 2,
    coreRuntimeTransitions: VARIANT_COUNT * HOST_CORE_TRANSITIONS_PER_VARIANT,
    supplementalSamePhaseNonNeighborGaze:
      VARIANT_COUNT * SAME_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    supplementalCrossPhaseNonNeighborGaze:
      VARIANT_COUNT * CROSS_NON_NEIGHBOR_TRANSITIONS_PER_VARIANT,
    totalUniqueRuntimeTransitions: VARIANT_COUNT * TOTAL_HOST_TRANSITIONS_PER_VARIANT,
    totalFailingCoreTransitions: 0,
    exactMembership: true,
  });
  assert.equal(combined.crossTheme.gazeBodyPairPhaseParity, true);
  assert.equal(combined.crossTheme.crossPhaseGazeBodyPairPhaseParity, true);
  assert.equal(combined.crossTheme.sourceHostBoundaryParity, true);
  assert.equal(combined.crossTheme.displayed112HostBoundaryParity, true);
  assert.equal(combined.crossTheme.displayed112HostSamePhaseGazeBodyParity, true);
  assert.equal(combined.crossTheme.displayed112HostCrossPhaseGazeBodyParity, true);
  assert.match(
    combined.crossTheme.displayed112HostBoundaryAlphaSilhouetteSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.match(
    combined.crossTheme.sourceHostBoundaryAlphaSilhouetteSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.match(combined.crossTheme.displayed112HostSamePhaseGazeBodySha256, /^[a-f0-9]{64}$/);
  assert.match(combined.crossTheme.displayed112HostCrossPhaseGazeBodySha256, /^[a-f0-9]{64}$/);
  assert.match(combined.crossTheme.gazeBodyPairPhaseSha256, /^[a-f0-9]{64}$/);
  assert.match(combined.crossTheme.crossPhaseGazeBodyPairPhaseSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    combined.temporalArtifacts.allFrameSheets.dark.displayedCellFrames,
    REQUIRED_CELL_COUNT * FRAMES,
  );
  assert.equal(
    combined.temporalArtifacts.allFrameSheets.light.displayedCellFrames,
    REQUIRED_CELL_COUNT * FRAMES,
  );
  assert.equal(combined.temporalArtifacts.worstCaseSheet.rowCount, 28);
  assert.ok(combined.temporalArtifacts.worstCaseSheet.rows.every(({ flags }) => flags.length === 0));
  const worstBytes = await readFile(path.join(
    root,
    combined.temporalArtifacts.worstCaseSheet.path,
  ));
  assert.equal(sha256(worstBytes), combined.temporalArtifacts.worstCaseSheet.sha256);
  const worstMetadata = await sharp(worstBytes).metadata();
  assert.equal(worstMetadata.width, combined.temporalArtifacts.worstCaseSheet.width);
  assert.equal(worstMetadata.height, combined.temporalArtifacts.worstCaseSheet.height);
});
