#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  ROWS,
} from "../src/spec.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qaRoot = path.join(repositoryRoot, "qa");
const ACTION_CYCLES = 3;
const IDLE_DURATION_MULTIPLIER = 6;
const TIMED_ROWS = ROWS.filter((row) => row.index <= 8);
const IDLE_ROW = TIMED_ROWS.find((row) => row.index === 0);
const CELL_PIXEL_COUNT = CELL_WIDTH * CELL_HEIGHT;
const MEASUREMENT_POLICY = "project-specific release thresholds are enforced for every runtime transition";
const CONTINUITY_THRESHOLDS = Object.freeze({
  requiredTransitionCount: 65,
  maximumNormalizedAlphaDifference: 0.25,
  maximumNormalizedCompositedRgbDifference: 0.25,
  maximumChangedPixelFraction: 0.45,
  maximumAlphaAreaRatioSymmetric: 2.5,
});
const MOTION_GATES = Object.freeze({
  idle: Object.freeze({ minimumMeanSilhouetteIou: 0.94, maximumMeanSilhouetteAreaStepFraction: 0.02, maximumMeanSilhouetteCentroidStepPx: 1.5 }),
  "running-right": Object.freeze({ minimumMeanSilhouetteIou: 0.88, maximumMeanSilhouetteAreaStepFraction: 0.04, maximumMeanSilhouetteCentroidStepPx: 2.5 }),
  "running-left": Object.freeze({ minimumMeanSilhouetteIou: 0.88, maximumMeanSilhouetteAreaStepFraction: 0.04, maximumMeanSilhouetteCentroidStepPx: 2.5 }),
  waving: Object.freeze({ minimumMeanSilhouetteIou: 0.90, maximumMeanSilhouetteAreaStepFraction: 0.02, maximumMeanSilhouetteCentroidStepPx: 2.5 }),
  jumping: Object.freeze({ minimumMeanSilhouetteIou: 0.73, maximumMeanSilhouetteAreaStepFraction: 0.06, maximumMeanSilhouetteCentroidStepPx: 11 }),
  failed: Object.freeze({ minimumMeanSilhouetteIou: 0.82, maximumMeanSilhouetteAreaStepFraction: 0.06, maximumMeanSilhouetteCentroidStepPx: 3 }),
  waiting: Object.freeze({ minimumMeanSilhouetteIou: 0.84, maximumMeanSilhouetteAreaStepFraction: 0.06, maximumMeanSilhouetteCentroidStepPx: 4 }),
  running: Object.freeze({ minimumMeanSilhouetteIou: 0.89, maximumMeanSilhouetteAreaStepFraction: 0.03, maximumMeanSilhouetteCentroidStepPx: 2.5 }),
  review: Object.freeze({ minimumMeanSilhouetteIou: 0.75, maximumMeanSilhouetteAreaStepFraction: 0.04, maximumMeanSilhouetteCentroidStepPx: 12 }),
});

const VARIANTS = Object.freeze([
  Object.freeze({
    theme: "dark",
    stageBackground: Object.freeze({ hex: "#101010", rgb: Object.freeze([16, 16, 16]) }),
    atlasPath: path.join(repositoryRoot, "qa", "authoring-atlas-dark.webp"),
  }),
  Object.freeze({
    theme: "light",
    stageBackground: Object.freeze({ hex: "#F3F3F1", rgb: Object.freeze([243, 243, 241]) }),
    atlasPath: path.join(repositoryRoot, "qa", "authoring-atlas-light.webp"),
  }),
]);

if (!IDLE_ROW) throw new Error("The v2 runtime atlas must contain row 0 (idle)");

const reports = [];
for (const variant of VARIANTS) reports.push(await analyzeVariant(variant));
const themeParity = compareThemeMetrics(reports);
const combinedValidation = validateCombined(reports, themeParity);

const combined = {
  schemaVersion: 2,
  kind: "codex-pet-runtime-continuity",
  ok: combinedValidation.ok,
  measurementPolicy: MEASUREMENT_POLICY,
  thresholds: CONTINUITY_THRESHOLDS,
  motionGates: MOTION_GATES,
  runtimeModel: runtimeModel(),
  metricDefinitions: metricDefinitions(),
  themes: Object.fromEntries(reports.map((report) => [report.theme, report])),
  themeParity,
  summary: summarizeReports(reports),
  validation: combinedValidation,
};

await mkdir(qaRoot, { recursive: true });
for (const report of reports) {
  await writeJson(path.join(qaRoot, `runtime-continuity-${report.theme}.json`), report);
}
await writeJson(path.join(qaRoot, "runtime-continuity.json"), combined);

for (const report of reports) {
  const alphaMaximum = report.summary.allTransitions.normalizedAlphaDifference.max;
  const colorMaximum = report.summary.allTransitions.normalizedCompositedRgbDifference.max;
  console.log(
    `${report.theme}: ${report.summary.allTransitions.transitionCount} unique transitions; `
      + `max alpha ${alphaMaximum.value.toFixed(6)} at ${alphaMaximum.transitionId}; `
      + `max composited RGB ${colorMaximum.value.toFixed(6)} at ${colorMaximum.transitionId}`,
  );
}
console.log("Wrote qa/runtime-continuity-{dark,light}.json, qa/runtime-continuity.json, and runtime preview WebPs");
if (!combinedValidation.ok) {
  const failed = combinedValidation.checks.filter((check) => !check.pass).map((check) => check.id).join(", ");
  throw new Error(`Runtime continuity validation failed: ${failed}`);
}

async function analyzeVariant(variant) {
  const atlasBytes = await readFile(variant.atlasPath);
  const decoded = await sharp(atlasBytes, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width !== ATLAS_WIDTH || height !== ATLAS_HEIGHT || channels !== 4) {
    throw new Error(
      `${variant.theme} atlas must decode to ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA; `
        + `received ${width}x${height} with ${channels} channels`,
    );
  }

  const cells = new Map();
  const cellAt = (row, column) => {
    const key = `${row}:${column}`;
    if (!cells.has(key)) cells.set(key, extractCell(decoded.data, width, row, column));
    return cells.get(key);
  };

  const rowReports = TIMED_ROWS.map((row) => analyzeRow(row, cellAt, variant.stageBackground.rgb));
  const previewDirectory = path.join(qaRoot, `runtime-previews-${variant.theme}`);
  const previews = await buildRuntimePreviews(previewDirectory, cellAt);
  const transitions = flattenTransitions(rowReports);
  const summary = summarizeTransitionSet(transitions);
  const validation = validateTheme(summary, rowReports);

  return {
    schemaVersion: 2,
    kind: "codex-pet-runtime-continuity-theme",
    theme: variant.theme,
    ok: validation.ok,
    measurementPolicy: MEASUREMENT_POLICY,
    thresholds: CONTINUITY_THRESHOLDS,
    motionGates: MOTION_GATES,
    atlas: {
      path: relativePath(variant.atlasPath),
      width,
      height,
      channels,
      sha256: sha256(atlasBytes),
    },
    compositingStageBackground: variant.stageBackground,
    runtimeModel: runtimeModel(),
    metricDefinitions: metricDefinitions(),
    rows: rowReports,
    previews,
    summary,
    validation,
  };
}

function validateTheme(summary, rows) {
  const all = summary.allTransitions;
  const checks = [
    thresholdCheck("transition-count", all.transitionCount, CONTINUITY_THRESHOLDS.requiredTransitionCount, "equal"),
    thresholdCheck("normalized-alpha-difference", all.normalizedAlphaDifference.max.value, CONTINUITY_THRESHOLDS.maximumNormalizedAlphaDifference),
    thresholdCheck("composited-rgb-difference", all.normalizedCompositedRgbDifference.max.value, CONTINUITY_THRESHOLDS.maximumNormalizedCompositedRgbDifference),
    thresholdCheck("changed-pixel-fraction", all.changedPixelFraction.max.value, CONTINUITY_THRESHOLDS.maximumChangedPixelFraction),
    thresholdCheck("alpha-area-ratio-symmetric", all.alphaAreaRatioSymmetric.max.value, CONTINUITY_THRESHOLDS.maximumAlphaAreaRatioSymmetric),
    ...rows.map((row) => ({
      id: `row-${row.row}-${row.id}-motion-gate`,
      actual: row.motionGateValidation.ok,
      expected: true,
      operator: "equal",
      pass: row.motionGateValidation.ok,
    })),
  ];
  return { ok: checks.every((check) => check.pass), checks };
}

function validateCombined(themeReports, themeParityReport) {
  const checks = [
    thresholdCheck("theme-count", themeReports.length, 2, "equal"),
    thresholdCheck("theme-parity-transition-count", themeParityReport.comparedTransitions, CONTINUITY_THRESHOLDS.requiredTransitionCount, "equal"),
    thresholdCheck("theme-parity-exact-mismatches", themeParityReport.exactMetricMismatches, 0, "equal"),
    thresholdCheck("theme-parity-maximum-delta", themeParityReport.maximumAbsoluteDelta, 0, "equal"),
    ...themeReports.map((report) => ({
      id: `${report.theme}-thresholds`,
      actual: report.validation.ok,
      expected: true,
      operator: "equal",
      pass: report.validation.ok === true,
    })),
  ];
  return { ok: checks.every((check) => check.pass), checks };
}

function thresholdCheck(id, actual, expected, operator = "maximum") {
  return {
    id,
    actual,
    [operator === "equal" ? "expected" : "maximum"]: expected,
    operator,
    pass: operator === "equal" ? actual === expected : actual <= expected,
  };
}

function analyzeRow(row, cellAt, stageBackground) {
  const expectedFrameCount = row.durations.length;
  if (row.frames.length !== expectedFrameCount) {
    throw new Error(
      `Timed row ${row.index} (${row.id}) has ${row.durations.length} durations and `
        + `${row.frames.length} frames; expected ${expectedFrameCount} frames`,
    );
  }

  const runtimeDurations = row.durations.map((duration) => (
    row.index === 0 ? duration * IDLE_DURATION_MULTIPLIER : duration
  ));
  const adjacent = [];
  for (let column = 0; column < row.durations.length - 1; column += 1) {
    adjacent.push(transition({
      id: `r${two(row.index)}-c${column}-to-c${column + 1}`,
      kind: "adjacent",
      row,
      fromColumn: column,
      toRow: row,
      toColumn: column + 1,
      holdBeforeTransitionMs: runtimeDurations[column],
      runtimeOccurrences: row.index === 0
        ? { perIdleCycle: 1 }
        : { perThreeCycleActionSequence: ACTION_CYCLES },
      fromPixels: cellAt(row.index, column),
      toPixels: cellAt(row.index, column + 1),
      stageBackground,
    }));
  }

  const base = {
    row: row.index,
    id: row.id,
    label: row.label,
    timedFrameCount: row.durations.length,
    sourceDurationsMs: [...row.durations],
    runtimeDurationsMs: runtimeDurations,
    sourceCycleDurationMs: sum(row.durations),
    runtimeCycleDurationMs: sum(runtimeDurations),
    adjacent,
  };

  if (row.index === 0) {
    return withRowSummary({
      ...base,
      runtimeRole: "slow-idle-loop",
      durationMultiplier: IDLE_DURATION_MULTIPLIER,
      idleLoop: transition({
        id: "r00-idle-c5-to-c0",
        kind: "idle-loop",
        row,
        fromColumn: row.durations.length - 1,
        toRow: row,
        toColumn: 0,
        holdBeforeTransitionMs: runtimeDurations.at(-1),
        runtimeOccurrences: { perIdleCycle: 1 },
        fromPixels: cellAt(row.index, row.durations.length - 1),
        toPixels: cellAt(row.index, 0),
        stageBackground,
      }),
    });
  }

  return withRowSummary({
    ...base,
    runtimeRole: "three-cycles-then-idle",
    actionCycleCount: ACTION_CYCLES,
    actionDurationBeforeIdleMs: sum(runtimeDurations) * ACTION_CYCLES,
    repeatBoundary: transition({
      id: `r${two(row.index)}-repeat-last-to-c0`,
      kind: "repeat-boundary",
      row,
      fromColumn: row.durations.length - 1,
      toRow: row,
      toColumn: 0,
      holdBeforeTransitionMs: runtimeDurations.at(-1),
      runtimeOccurrences: {
        perThreeCycleActionSequence: ACTION_CYCLES - 1,
        boundaries: ["cycle-1-to-2", "cycle-2-to-3"],
      },
      fromPixels: cellAt(row.index, row.durations.length - 1),
      toPixels: cellAt(row.index, 0),
      stageBackground,
    }),
    thirdCycleExitToIdle: transition({
      id: `r${two(row.index)}-cycle3-last-to-idle-c0`,
      kind: "third-cycle-to-idle",
      row,
      fromColumn: row.durations.length - 1,
      toRow: IDLE_ROW,
      toColumn: 0,
      holdBeforeTransitionMs: runtimeDurations.at(-1),
      runtimeOccurrences: { perThreeCycleActionSequence: 1, boundary: "cycle-3-to-idle" },
      fromPixels: cellAt(row.index, row.durations.length - 1),
      toPixels: cellAt(IDLE_ROW.index, 0),
      stageBackground,
    }),
  });
}

function transition({
  id,
  kind,
  row,
  fromColumn,
  toRow,
  toColumn,
  holdBeforeTransitionMs,
  runtimeOccurrences,
  fromPixels,
  toPixels,
  stageBackground,
}) {
  return {
    id,
    kind,
    from: {
      row: row.index,
      rowId: row.id,
      column: fromColumn,
      frame: row.frames[fromColumn].name,
    },
    to: {
      row: toRow.index,
      rowId: toRow.id,
      column: toColumn,
      frame: toRow.frames[toColumn].name,
    },
    holdBeforeTransitionMs,
    runtimeOccurrences,
    metrics: comparePixels(fromPixels, toPixels, stageBackground),
  };
}

function comparePixels(fromPixels, toPixels, stageBackground) {
  const from = fromPixels.alpha;
  const to = toPixels.alpha;
  let absoluteDifference = 0;
  let changedPixels = 0;
  let fromAlpha = 0;
  let toAlpha = 0;
  let rgbaAbsoluteDifference = 0;
  let compositedRgbAbsoluteDifference = 0;
  let changedCompositedPixels = 0;
  let fromSilhouetteArea = 0;
  let toSilhouetteArea = 0;
  let silhouetteIntersection = 0;
  let silhouetteUnion = 0;
  let fromSilhouetteX = 0;
  let fromSilhouetteY = 0;
  let toSilhouetteX = 0;
  let toSilhouetteY = 0;
  for (let index = 0; index < from.length; index += 1) {
    const delta = Math.abs(to[index] - from[index]);
    absoluteDifference += delta;
    if (delta !== 0) changedPixels += 1;
    fromAlpha += from[index];
    toAlpha += to[index];

    const x = index % CELL_WIDTH;
    const y = Math.floor(index / CELL_WIDTH);
    const fromVisible = from[index] >= 128;
    const toVisible = to[index] >= 128;
    if (fromVisible) {
      fromSilhouetteArea += 1;
      fromSilhouetteX += x;
      fromSilhouetteY += y;
    }
    if (toVisible) {
      toSilhouetteArea += 1;
      toSilhouetteX += x;
      toSilhouetteY += y;
    }
    if (fromVisible && toVisible) silhouetteIntersection += 1;
    if (fromVisible || toVisible) silhouetteUnion += 1;

    const rgbaOffset = index * 4;
    let compositedPixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      rgbaAbsoluteDifference += Math.abs(
        toPixels.rgba[rgbaOffset + channel] - fromPixels.rgba[rgbaOffset + channel],
      );
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const background = stageBackground[channel];
      const fromComposited = (
        fromPixels.rgba[rgbaOffset + channel] * from[index]
        + background * (255 - from[index])
      ) / 255;
      const toComposited = (
        toPixels.rgba[rgbaOffset + channel] * to[index]
        + background * (255 - to[index])
      ) / 255;
      const compositedDelta = Math.abs(toComposited - fromComposited);
      compositedRgbAbsoluteDifference += compositedDelta;
      if (compositedDelta > Number.EPSILON) compositedPixelChanged = true;
    }
    if (compositedPixelChanged) changedCompositedPixels += 1;
  }

  const fromArea = fromAlpha / 255;
  const toArea = toAlpha / 255;
  const directionalRatio = fromArea === 0 ? null : toArea / fromArea;
  const smallerArea = Math.min(fromArea, toArea);
  const symmetricRatio = smallerArea === 0 ? null : Math.max(fromArea, toArea) / smallerArea;
  const silhouetteAreaMaximum = Math.max(fromSilhouetteArea, toSilhouetteArea);
  const fromCentroid = fromSilhouetteArea === 0
    ? null
    : [fromSilhouetteX / fromSilhouetteArea, fromSilhouetteY / fromSilhouetteArea];
  const toCentroid = toSilhouetteArea === 0
    ? null
    : [toSilhouetteX / toSilhouetteArea, toSilhouetteY / toSilhouetteArea];

  return {
    normalizedAlphaDifference: rounded(absoluteDifference / (255 * CELL_PIXEL_COUNT)),
    normalizedRgbaDifference: rounded(rgbaAbsoluteDifference / (255 * 4 * CELL_PIXEL_COUNT)),
    normalizedCompositedRgbDifference: rounded(compositedRgbAbsoluteDifference / (255 * 3 * CELL_PIXEL_COUNT)),
    changedPixelFraction: rounded(changedPixels / CELL_PIXEL_COUNT),
    changedPixels,
    changedCompositedPixelFraction: rounded(changedCompositedPixels / CELL_PIXEL_COUNT),
    changedCompositedPixels,
    pixelCount: CELL_PIXEL_COUNT,
    fromAlphaAreaEquivalentPixels: rounded(fromArea, 3),
    toAlphaAreaEquivalentPixels: rounded(toArea, 3),
    fromAlphaAreaFraction: rounded(fromArea / CELL_PIXEL_COUNT),
    toAlphaAreaFraction: rounded(toArea / CELL_PIXEL_COUNT),
    alphaAreaRatio: directionalRatio == null ? null : rounded(directionalRatio),
    alphaAreaRatioSymmetric: symmetricRatio == null ? null : rounded(symmetricRatio),
    silhouetteIou: silhouetteUnion === 0 ? null : rounded(silhouetteIntersection / silhouetteUnion),
    silhouetteAreaStepFraction: silhouetteAreaMaximum === 0
      ? null
      : rounded(Math.abs(toSilhouetteArea - fromSilhouetteArea) / silhouetteAreaMaximum),
    silhouetteCentroidStepPx: fromCentroid == null || toCentroid == null
      ? null
      : rounded(Math.hypot(toCentroid[0] - fromCentroid[0], toCentroid[1] - fromCentroid[1])),
  };
}

async function buildRuntimePreviews(outputDirectory, cellAt) {
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const previews = [];

  for (const row of TIMED_ROWS) {
    const frames = [];
    const delays = [];
    const sequence = [];
    const actionCycles = row.index === 0 ? 0 : ACTION_CYCLES;

    if (row.index !== 0) {
      for (let cycle = 1; cycle <= ACTION_CYCLES; cycle += 1) {
        for (let column = 0; column < row.durations.length; column += 1) {
          frames.push(cellAt(row.index, column).rgba);
          delays.push(row.durations[column]);
          sequence.push({ phase: "action", cycle, row: row.index, column, delayMs: row.durations[column] });
        }
      }
    }

    for (let column = 0; column < IDLE_ROW.durations.length; column += 1) {
      const delay = IDLE_ROW.durations[column] * IDLE_DURATION_MULTIPLIER;
      frames.push(cellAt(IDLE_ROW.index, column).rgba);
      delays.push(delay);
      sequence.push({ phase: "slow-idle", cycle: 1, row: IDLE_ROW.index, column, delayMs: delay });
    }

    const fileName = `${two(row.index)}-${row.id}-runtime.webp`;
    const outputPath = path.join(outputDirectory, fileName);
    await writeAnimatedWebp(frames, delays, outputPath);
    const bytes = await readFile(outputPath);
    const metadata = await sharp(bytes, { animated: true }).metadata();
    if (
      metadata.pages !== frames.length
      || metadata.pageHeight !== CELL_HEIGHT
      || metadata.width !== CELL_WIDTH
      || metadata.loop !== 0
      || !sameNumbers(metadata.delay, delays)
    ) {
      throw new Error(`Runtime preview metadata mismatch for ${relativePath(outputPath)}`);
    }
    const decodedPreview = await sharp(bytes, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let index = 0; index < frames.length; index += 1) {
      const start = index * CELL_PIXEL_COUNT * 4;
      const decodedFrame = decodedPreview.data.subarray(start, start + CELL_PIXEL_COUNT * 4);
      if (!decodedFrame.equals(frames[index])) {
        throw new Error(`Runtime preview frame ${index} is not lossless in ${relativePath(outputPath)}`);
      }
    }
    previews.push({
      row: row.index,
      rowId: row.id,
      path: relativePath(outputPath),
      sha256: sha256(bytes),
      frameCount: frames.length,
      actionCycles,
      includesOneSlowIdleCycle: true,
      totalDurationMs: sum(delays),
      pageHeight: metadata.pageHeight,
      pages: metadata.pages,
      loop: "infinite preview loop; each loop replays the documented finite runtime sequence",
      sequence,
    });
  }

  return previews;
}

async function writeAnimatedWebp(frames, delays, outputPath) {
  // Give libvips the decoded cells as one page-aware raw stack. This avoids
  // the alpha-premultiplication rounding that compositing PNG pages can add at
  // antialiased edges, so every decoded preview page remains byte-identical to
  // its atlas cell.
  const stack = sharp(Buffer.concat(frames), {
    raw: {
      width: CELL_WIDTH,
      height: CELL_HEIGHT * frames.length,
      pageHeight: CELL_HEIGHT,
      channels: 4,
    },
  });

  await stack.webp({
    lossless: true,
    quality: 100,
    alphaQuality: 100,
    delay: delays,
    effort: 6,
    exact: true,
    loop: 0,
  }).toFile(outputPath);
}

function extractCell(atlasPixels, atlasWidth, row, column) {
  const rgba = Buffer.alloc(CELL_PIXEL_COUNT * 4);
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const sourceStart = (((row * CELL_HEIGHT + y) * atlasWidth) + column * CELL_WIDTH) * 4;
    const targetStart = y * CELL_WIDTH * 4;
    atlasPixels.copy(rgba, targetStart, sourceStart, sourceStart + CELL_WIDTH * 4);
  }
  const alpha = Buffer.alloc(CELL_PIXEL_COUNT);
  for (let pixel = 0; pixel < CELL_PIXEL_COUNT; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3];
  return { rgba, alpha };
}

function flattenTransitions(rows) {
  return rows.flatMap(rowTransitions);
}

function rowTransitions(row) {
  return [
    ...row.adjacent,
    ...(row.idleLoop ? [row.idleLoop] : []),
    ...(row.repeatBoundary ? [row.repeatBoundary] : []),
    ...(row.thirdCycleExitToIdle ? [row.thirdCycleExitToIdle] : []),
  ];
}

function withRowSummary(row) {
  const cycleTransitions = [
    ...row.adjacent,
    ...(row.idleLoop ? [row.idleLoop] : []),
    ...(row.repeatBoundary ? [row.repeatBoundary] : []),
  ];
  const cycleMotionSummary = summarizeMetrics(cycleTransitions);
  return {
    ...row,
    summary: summarizeMetrics(rowTransitions(row)),
    cycleMotionSummary,
    motionGateValidation: validateRowMotion(row.id, cycleMotionSummary),
  };
}

function validateRowMotion(rowId, summary) {
  const gate = MOTION_GATES[rowId];
  if (!gate) throw new Error(`Missing motion gate for runtime row ${rowId}`);
  const checks = [
    {
      id: "mean-silhouette-iou",
      actual: summary.silhouetteIou.mean,
      minimum: gate.minimumMeanSilhouetteIou,
      operator: "minimum",
      pass: summary.silhouetteIou.mean >= gate.minimumMeanSilhouetteIou,
    },
    thresholdCheck(
      "mean-silhouette-area-step",
      summary.silhouetteAreaStepFraction.mean,
      gate.maximumMeanSilhouetteAreaStepFraction,
    ),
    thresholdCheck(
      "mean-silhouette-centroid-step",
      summary.silhouetteCentroidStepPx.mean,
      gate.maximumMeanSilhouetteCentroidStepPx,
    ),
  ];
  return { ok: checks.every((check) => check.pass), gate, checks };
}

function summarizeTransitionSet(transitions) {
  const byKind = Object.fromEntries(
    [...new Set(transitions.map((candidate) => candidate.kind))].map((kind) => {
      const matching = transitions.filter((candidate) => candidate.kind === kind);
      return [kind, summarizeMetrics(matching)];
    }),
  );
  return {
    allTransitions: summarizeMetrics(transitions),
    byKind,
  };
}

function summarizeMetrics(transitions) {
  return {
    transitionCount: transitions.length,
    normalizedAlphaDifference: distribution(transitions, "normalizedAlphaDifference"),
    normalizedRgbaDifference: distribution(transitions, "normalizedRgbaDifference"),
    normalizedCompositedRgbDifference: distribution(transitions, "normalizedCompositedRgbDifference"),
    changedPixelFraction: distribution(transitions, "changedPixelFraction"),
    changedCompositedPixelFraction: distribution(transitions, "changedCompositedPixelFraction"),
    alphaAreaRatioSymmetric: distribution(transitions, "alphaAreaRatioSymmetric"),
    silhouetteIou: distribution(transitions, "silhouetteIou"),
    silhouetteAreaStepFraction: distribution(transitions, "silhouetteAreaStepFraction"),
    silhouetteCentroidStepPx: distribution(transitions, "silhouetteCentroidStepPx"),
  };
}

function distribution(transitions, key) {
  const values = transitions
    .map((candidate) => ({ transitionId: candidate.id, value: candidate.metrics[key] }))
    .filter((candidate) => candidate.value != null)
    .sort((left, right) => left.value - right.value || left.transitionId.localeCompare(right.transitionId));
  if (values.length === 0) return { count: 0, min: null, mean: null, p50: null, p95: null, max: null };
  return {
    count: values.length,
    min: values[0],
    mean: rounded(sum(values.map((candidate) => candidate.value)) / values.length),
    p50: values[Math.ceil(values.length * 0.50) - 1],
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values.at(-1),
  };
}

function compareThemeMetrics(themeReports) {
  const [first, ...others] = themeReports;
  const reference = new Map(flattenTransitions(first.rows).map((candidate) => [candidate.id, candidate]));
  let comparedTransitions = 0;
  let exactMetricMismatches = 0;
  let maximumAbsoluteDelta = 0;
  let maximumDeltaTransitionId = null;
  for (const report of others) {
    for (const candidate of flattenTransitions(report.rows)) {
      const expected = reference.get(candidate.id);
      if (!expected) throw new Error(`Theme ${report.theme} contains unexpected transition ${candidate.id}`);
      comparedTransitions += 1;
      for (const key of ["normalizedAlphaDifference", "changedPixelFraction", "alphaAreaRatio", "alphaAreaRatioSymmetric", "silhouetteIou", "silhouetteAreaStepFraction", "silhouetteCentroidStepPx"]) {
        const left = expected.metrics[key];
        const right = candidate.metrics[key];
        const delta = left == null || right == null ? (left === right ? 0 : Number.POSITIVE_INFINITY) : Math.abs(left - right);
        if (delta !== 0) exactMetricMismatches += 1;
        if (delta > maximumAbsoluteDelta) {
          maximumAbsoluteDelta = delta;
          maximumDeltaTransitionId = candidate.id;
        }
      }
    }
  }
  return {
    referenceTheme: first.theme,
    comparedTransitions,
    comparedAlphaMetricsPerTransition: 7,
    exactMetricMismatches,
    maximumAbsoluteDelta: Number.isFinite(maximumAbsoluteDelta) ? rounded(maximumAbsoluteDelta) : "infinity",
    maximumDeltaTransitionId,
  };
}

function summarizeReports(themeReports) {
  const all = themeReports.flatMap((report) => flattenTransitions(report.rows).map((transition) => ({
    ...transition,
    id: `${report.theme}:${transition.id}`,
  })));
  return {
    themeCount: themeReports.length,
    uniqueTransitionsPerTheme: flattenTransitions(themeReports[0].rows).length,
    acrossThemes: summarizeMetrics(all),
  };
}

function runtimeModel() {
  return {
    atlasVersion: 2,
    timedRows: "rows 0 through 8",
    transparentIdleCells: [{ row: 0, column: 6 }, { row: 0, column: 7 }],
    idle: {
      timedColumns: [0, 1, 2, 3, 4, 5],
      durationMultiplier: IDLE_DURATION_MULTIPLIER,
      cycleDurationMs: sum(IDLE_ROW.durations) * IDLE_DURATION_MULTIPLIER,
      loopBoundary: "row 0 c5 to row 0 c0",
    },
    nonIdleActions: {
      rows: [1, 2, 3, 4, 5, 6, 7, 8],
      cycleCountBeforeIdle: ACTION_CYCLES,
      repeatBoundaries: ["cycle 1 last to cycle 2 c0", "cycle 2 last to cycle 3 c0"],
      exitBoundary: "cycle 3 last to idle c0",
    },
    previews: "each action preview renders three action cycles followed by one 6x-duration idle cycle; the idle preview renders one 6x-duration idle cycle",
  };
}

function metricDefinitions() {
  return {
    normalizedAlphaDifference: "sum(abs(alphaTo-alphaFrom)) / (255 * cellPixelCount)",
    normalizedRgbaDifference: "sum(abs(toRGBA-fromRGBA)) / (255 * 4 * cellPixelCount)",
    normalizedCompositedRgbDifference: "sum(abs(toRGB-over-stage - fromRGB-over-stage)) / (255 * 3 * cellPixelCount); straight-alpha sRGB-channel compositing",
    changedPixelFraction: "count(alphaTo != alphaFrom) / cellPixelCount; exact lossless alpha comparison",
    changedCompositedPixelFraction: "count(any composited RGB channel differs) / cellPixelCount",
    alphaAreaEquivalentPixels: "sum(alpha) / 255",
    alphaAreaRatio: "toAlphaAreaEquivalentPixels / fromAlphaAreaEquivalentPixels; directional",
    alphaAreaRatioSymmetric: "max(fromAlphaArea,toAlphaArea) / min(fromAlphaArea,toAlphaArea); always >= 1",
    silhouetteIou: "intersection / union of source-cell pixels whose alpha is at least 128",
    silhouetteAreaStepFraction: "abs(toArea-fromArea) / max(toArea,fromArea) for alpha-at-least-128 silhouettes",
    silhouetteCentroidStepPx: "Euclidean distance between alpha-at-least-128 silhouette centroids in source-cell pixels",
  };
}

async function writeJson(outputPath, value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(target) {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rounded(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function two(value) {
  return String(value).padStart(2, "0");
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
