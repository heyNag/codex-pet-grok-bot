#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { verifyArbitraryPhaseTraceIntegrity } from "./arbitrary-phase-report-integrity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_GATE_SHA256 = "2735e490caf5eaea1250a186072e65d2cd652c11f50d17f487989724877efa5f";
const EXPECTED_BASELINE_SHA256 = "c4c4552f34a427a09293ebb39a5f1a8a0c9b12d5c276e81baedbe24800b371f1";
const EXPECTED_BASELINE_JSON_SHA256 = "6b6a16a25b4325b9b447ba62befa7684ac4a0f2f39ed79486de421a5c0dba082";
const EXPECTED_HOST_GRAPH_ORDER_SHA256 = "8970e497ceced7b3a0a1b031c6a75bdbe544011887fe69a93798675bb0dad736";
const FAMILY_EDGE_COUNTS = Object.freeze({
  timedCellAdvance: 57,
  timedEffectiveReset: 460,
  timedToGaze: 912,
  gazeToTimed: 144,
  adjacentGaze: 32,
  nonNeighborGaze: 208,
});
const PROFILE_LOWER_FACTOR = 0.96;
const PROFILE_UPPER_FACTOR = 1.04;
const PROFILE_ZERO_EPSILON = 1e-7;
const CELL_PROFILE_METRICS = Object.freeze([
  "silhouetteIouExcursion",
  "silhouetteCentroidDiameterPx",
  "alphaAreaRatioExcursion",
  "perceptualDiameterRms",
]);
const EDGE_PROFILE_METRICS = Object.freeze([
  ...CELL_PROFILE_METRICS,
  "samePhaseSilhouetteIouExcursionRms",
  "samePhaseSilhouetteCentroidDistanceRmsPx",
  "samePhaseAlphaAreaRatioExcursionRms",
  "samePhasePerceptualRms",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const ARBITRARY_PHASE_SOURCE_ROW_GATES = Object.freeze({
  0: Object.freeze({ minimumSilhouetteIou: 0.985844715, maximumSilhouetteCentroidDistancePx: 0.685494087, maximumAlphaAreaRatioSymmetric: 1.001965773, maximumPerceptualRms: 19.423896735 }),
  1: Object.freeze({ minimumSilhouetteIou: 0.961010204, maximumSilhouetteCentroidDistancePx: 2.507291564, maximumAlphaAreaRatioSymmetric: 1.002015947, maximumPerceptualRms: 14.290606664 }),
  2: Object.freeze({ minimumSilhouetteIou: 0.961106238, maximumSilhouetteCentroidDistancePx: 2.49942484, maximumAlphaAreaRatioSymmetric: 1.002018057, maximumPerceptualRms: 14.294982915 }),
  3: Object.freeze({ minimumSilhouetteIou: 0.957378969, maximumSilhouetteCentroidDistancePx: 2.473418879, maximumAlphaAreaRatioSymmetric: 1.013101354, maximumPerceptualRms: 15.017137725 }),
  4: Object.freeze({ minimumSilhouetteIou: 0.745531915, maximumSilhouetteCentroidDistancePx: 17.961465723, maximumAlphaAreaRatioSymmetric: 1.003779042, maximumPerceptualRms: 41.848738267 }),
  5: Object.freeze({ minimumSilhouetteIou: 0.942550114, maximumSilhouetteCentroidDistancePx: 3.643417828, maximumAlphaAreaRatioSymmetric: 1.002662904, maximumPerceptualRms: 22.644768464 }),
  6: Object.freeze({ minimumSilhouetteIou: 0.978083002, maximumSilhouetteCentroidDistancePx: 1.21543086, maximumAlphaAreaRatioSymmetric: 1.006546872, maximumPerceptualRms: 24.867107528 }),
  7: Object.freeze({ minimumSilhouetteIou: 0.981561144, maximumSilhouetteCentroidDistancePx: 1.218904382, maximumAlphaAreaRatioSymmetric: 1.001581983, maximumPerceptualRms: 25.773522855 }),
  8: Object.freeze({ minimumSilhouetteIou: 0.949078721, maximumSilhouetteCentroidDistancePx: 1.600405223, maximumAlphaAreaRatioSymmetric: 1.016134498, maximumPerceptualRms: 32.779510063 }),
  9: Object.freeze({ minimumSilhouetteIou: 0.992089249, maximumSilhouetteCentroidDistancePx: 0.289019138, maximumAlphaAreaRatioSymmetric: 1.0027945, maximumPerceptualRms: 3.992507078 }),
  10: Object.freeze({ minimumSilhouetteIou: 0.992279602, maximumSilhouetteCentroidDistancePx: 0.284306355, maximumAlphaAreaRatioSymmetric: 1.002797687, maximumPerceptualRms: 3.9286721 }),
});

const SURFACES = Object.freeze({ dark: [8, 11, 12], light: [243, 241, 233] });

function frameSummary(frame, width, height, surface) {
  const pixels = width * height;
  let silhouetteCount = 0;
  let centroidX = 0;
  let centroidY = 0;
  let alphaArea = 0;
  const mask = Buffer.alloc(pixels);
  const perceptual = new Float64Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const alphaByte = frame[offset + 3];
    const alpha = alphaByte / 255;
    alphaArea += alphaByte;
    if (alphaByte >= 128) {
      mask[pixel] = 1;
      silhouetteCount += 1;
      centroidX += pixel % width;
      centroidY += Math.floor(pixel / width);
    }
    const red = frame[offset] * alpha + surface[0] * (1 - alpha);
    const green = frame[offset + 1] * alpha + surface[1] * (1 - alpha);
    const blue = frame[offset + 2] * alpha + surface[2] * (1 - alpha);
    perceptual[pixel * 3] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    perceptual[pixel * 3 + 1] = (-0.1146 * red - 0.3854 * green + 0.5 * blue) * 0.5;
    perceptual[pixel * 3 + 2] = (0.5 * red - 0.4542 * green - 0.0458 * blue) * 0.5;
  }
  return {
    mask,
    silhouetteCount,
    centroidX: centroidX / silhouetteCount,
    centroidY: centroidY / silhouetteCount,
    alphaArea,
    perceptual,
  };
}

function compareSummaries(left, right, pixels) {
  let intersection = 0;
  let perceptualSquare = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (left.mask[pixel] && right.mask[pixel]) intersection += 1;
    const offset = pixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = left.perceptual[offset + channel] - right.perceptual[offset + channel];
      perceptualSquare += difference * difference;
    }
  }
  const union = left.silhouetteCount + right.silhouetteCount - intersection;
  return {
    silhouetteIou: union > 0 ? intersection / union : 1,
    silhouetteCentroidDistancePx: Math.hypot(
      left.centroidX - right.centroidX,
      left.centroidY - right.centroidY,
    ),
    alphaAreaRatioSymmetric: Math.max(left.alphaArea, right.alphaArea)
      / Math.min(left.alphaArea, right.alphaArea),
    perceptualRms: Math.sqrt(perceptualSquare / pixels) / 255 * 100,
  };
}

function rms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function compareProfile(actual, baseline, metricNames) {
  const failures = [];
  metricNames.forEach((metric, index) => {
    const expected = baseline[index];
    if (expected <= PROFILE_ZERO_EPSILON) return;
    const lower = expected * PROFILE_LOWER_FACTOR;
    const upper = expected * PROFILE_UPPER_FACTOR;
    if (actual[index] < lower) failures.push({ metric, direction: "below", actual: actual[index], required: lower });
    else if (actual[index] > upper) failures.push({ metric, direction: "above", actual: actual[index], required: upper });
  });
  return failures;
}

function profileFromComparisons(comparisons) {
  return [
    1 - Math.min(...comparisons.map(({ silhouetteIou }) => silhouetteIou)),
    Math.max(...comparisons.map(({ silhouetteCentroidDistancePx }) => silhouetteCentroidDistancePx)),
    Math.max(...comparisons.map(({ alphaAreaRatioSymmetric }) => alphaAreaRatioSymmetric)) - 1,
    Math.max(...comparisons.map(({ perceptualRms }) => perceptualRms)),
  ];
}

function authoredCellCycleEvaluation({ frames, width, height, theme = "dark", identifier = "cell" }) {
  const surface = SURFACES[theme];
  if (!surface) throw new RangeError(`unknown theme ${theme}`);
  const summaries = frames.map((frame) => frameSummary(frame, width, height, surface));
  const comparisons = [];
  const digest = createHash("sha256");
  for (let from = 0; from < summaries.length; from += 1) {
    for (let to = 0; to < summaries.length; to += 1) {
      const metrics = compareSummaries(summaries[from], summaries[to], width * height);
      comparisons.push(metrics);
      if (from !== to) {
        digest.update(
          `${identifier}:p${from}->p${to}`
          + `|${metrics.silhouetteIou.toFixed(9)}`
          + `|${metrics.silhouetteCentroidDistancePx.toFixed(9)}`
          + `|${metrics.alphaAreaRatioSymmetric.toFixed(9)}`
          + `|${metrics.perceptualRms.toFixed(9)}\n`,
        );
      }
    }
  }
  return {
    profile: profileFromComparisons(comparisons),
    orderedMetricTraceSha256: digest.digest("hex"),
  };
}

export function authoredCellCycleProfile({ frames, width, height, theme = "dark" }) {
  return authoredCellCycleEvaluation({ frames, width, height, theme }).profile;
}

export function authoredCellOrderedMetricTraceSha256({ frames, width, height, theme = "dark", identifier = "cell" }) {
  return authoredCellCycleEvaluation({ frames, width, height, theme, identifier }).orderedMetricTraceSha256;
}

export function analyzeAuthoredCellCycle({
  frames,
  baseline,
  expectedOrderedMetricTraceSha256,
  identifier = "cell",
  width,
  height,
  theme = "dark",
}) {
  const { profile, orderedMetricTraceSha256 } = authoredCellCycleEvaluation({
    frames,
    width,
    height,
    theme,
    identifier,
  });
  const failures = compareProfile(profile, baseline, CELL_PROFILE_METRICS);
  if (
    expectedOrderedMetricTraceSha256 !== undefined
    && orderedMetricTraceSha256 !== expectedOrderedMetricTraceSha256
  ) {
    failures.push({
      metric: "orderedMetricTraceSha256",
      direction: "changed",
      actual: orderedMetricTraceSha256,
      required: expectedOrderedMetricTraceSha256,
      baseline: expectedOrderedMetricTraceSha256,
    });
  }
  return {
    ok: failures.length === 0,
    profile,
    baseline,
    orderedMetricTraceSha256,
    expectedOrderedMetricTraceSha256,
    failures,
  };
}

export function authoredStateEdgeProfile({ leftFrames, rightFrames, width, height, theme = "dark" }) {
  if (leftFrames.length !== rightFrames.length) throw new TypeError("leftFrames and rightFrames must contain the same phase count");
  const surface = SURFACES[theme];
  if (!surface) throw new RangeError(`unknown theme ${theme}`);
  const left = leftFrames.map((frame) => frameSummary(frame, width, height, surface));
  const right = rightFrames.map((frame) => frameSummary(frame, width, height, surface));
  const comparisons = [];
  const diagonal = [];
  for (let from = 0; from < left.length; from += 1) {
    for (let to = 0; to < right.length; to += 1) {
      const metrics = compareSummaries(left[from], right[to], width * height);
      comparisons.push(metrics);
      if (from === to) diagonal.push(metrics);
    }
  }
  return [
    ...profileFromComparisons(comparisons),
    rms(diagonal.map(({ silhouetteIou }) => 1 - silhouetteIou)),
    rms(diagonal.map(({ silhouetteCentroidDistancePx }) => silhouetteCentroidDistancePx)),
    rms(diagonal.map(({ alphaAreaRatioSymmetric }) => alphaAreaRatioSymmetric - 1)),
    rms(diagonal.map(({ perceptualRms }) => perceptualRms)),
  ];
}

export function analyzeAuthoredStateEdge({ leftFrames, rightFrames, baseline, width, height, theme = "dark" }) {
  const profile = authoredStateEdgeProfile({ leftFrames, rightFrames, width, height, theme });
  const failures = compareProfile(profile, baseline, EDGE_PROFILE_METRICS);
  return { ok: failures.length === 0, profile, baseline, failures };
}

export function analyzeContinuityAlias({ leftFrames, rightFrames }) {
  if (!Array.isArray(leftFrames) || leftFrames.length !== rightFrames?.length) {
    throw new TypeError("continuity aliases must contain the same phase count");
  }
  const differingPhases = [];
  leftFrames.forEach((frame, phase) => {
    if (!Buffer.isBuffer(frame) || !Buffer.isBuffer(rightFrames[phase])) {
      throw new TypeError("continuity alias phases must be Buffers");
    }
    if (!frame.equals(rightFrames[phase])) differingPhases.push(phase);
  });
  return { ok: differingPhases.length === 0, phaseCount: leftFrames.length, differingPhases };
}

export function sampledContinuityMetricTrace({ leftFrames, rightFrames, width, height, theme = "dark" }) {
  if (!Array.isArray(leftFrames) || leftFrames.length !== rightFrames?.length) {
    throw new TypeError("sampled continuity sequences must contain the same phase count");
  }
  const surface = SURFACES[theme];
  if (!surface) throw new RangeError(`unknown theme ${theme}`);
  const digest = createHash("sha256");
  for (let phase = 0; phase < leftFrames.length; phase += 1) {
    const left = frameSummary(leftFrames[phase], width, height, surface);
    const right = frameSummary(rightFrames[phase], width, height, surface);
    const metrics = compareSummaries(left, right, width * height);
    const row = [
      1 - metrics.silhouetteIou,
      metrics.silhouetteCentroidDistancePx,
      metrics.alphaAreaRatioSymmetric - 1,
      metrics.perceptualRms,
    ];
    digest.update(`p${phase}|${row.map((value) => value.toFixed(9)).join("|")}\n`);
  }
  return digest.digest("hex");
}

export function analyzeSampledContinuity({ leftFrames, rightFrames, expectedTraceSha256, width, height, theme = "dark" }) {
  const actualTraceSha256 = sampledContinuityMetricTrace({ leftFrames, rightFrames, width, height, theme });
  return {
    ok: actualTraceSha256 === expectedTraceSha256,
    expectedTraceSha256,
    actualTraceSha256,
  };
}

export function analyzeArbitraryPhaseRgbaSequence({
  frames,
  width = 192,
  height = 208,
  row = 0,
  theme = "dark",
} = {}) {
  if (!Array.isArray(frames) || frames.length < 2) throw new TypeError("frames must contain at least two RGBA phases");
  const expectedBytes = width * height * 4;
  if (frames.some((frame) => !Buffer.isBuffer(frame) || frame.length !== expectedBytes)) {
    throw new TypeError(`every frame must contain ${expectedBytes} RGBA bytes`);
  }
  const gate = ARBITRARY_PHASE_SOURCE_ROW_GATES[row];
  if (!gate) throw new RangeError(`row ${row} has no arbitrary-phase gate`);
  const surface = SURFACES[theme];
  if (!surface) throw new RangeError(`unknown theme ${theme}`);
  const summaries = frames.map((frame) => frameSummary(frame, width, height, surface));
  const failures = [];
  let pairCount = 0;
  for (let phaseFrom = 0; phaseFrom < summaries.length; phaseFrom += 1) {
    for (let phaseTo = 0; phaseTo < summaries.length; phaseTo += 1) {
      if (phaseFrom === phaseTo) continue;
      pairCount += 1;
      const metrics = compareSummaries(summaries[phaseFrom], summaries[phaseTo], width * height);
      const flags = [];
      if (metrics.silhouetteIou < gate.minimumSilhouetteIou) flags.push("silhouetteIou");
      if (metrics.silhouetteCentroidDistancePx > gate.maximumSilhouetteCentroidDistancePx) flags.push("silhouetteCentroidDistancePx");
      if (metrics.alphaAreaRatioSymmetric > gate.maximumAlphaAreaRatioSymmetric) flags.push("alphaAreaRatioSymmetric");
      if (metrics.perceptualRms > gate.maximumPerceptualRms) flags.push("perceptualRms");
      if (flags.length) failures.push({ id: `p${phaseFrom}->p${phaseTo}`, flags, metrics });
    }
  }
  return { ok: failures.length === 0, pairCount, gate, failures };
}

function findPython() {
  const candidates = [process.env.ARBITRARY_PHASE_PYTHON, "python3"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import numpy, PIL"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("arbitrary-phase generation requires Python 3 with NumPy and Pillow; set ARBITRARY_PHASE_PYTHON to that interpreter");
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

export function checkArbitraryPhaseReport({ root = repositoryRoot } = {}) {
  const reportBytes = readFileSync(path.join(root, "qa/arbitrary-phase-qa.json"));
  const report = JSON.parse(reportBytes);
  const oracleBytes = readFileSync(path.join(root, "qa/codex-default-dpr2-browser-oracle.json"));
  const oracle = JSON.parse(oracleBytes);
  const baselineBytes = readFileSync(path.join(root, "qa/arbitrary-phase-baselines.json.gz"));
  const baselineJsonBytes = gunzipSync(baselineBytes);
  const baseline = JSON.parse(baselineJsonBytes);
  requireCheck(report.schemaVersion === 1 && report.kind === "arbitrary-decoder-phase-browser-host-qa", "arbitrary-phase report schema changed");
  requireCheck(report.ok === true && report.errors.length === 0, "arbitrary-phase report is not passing");
  requireCheck(report.thresholdPolicy?.calibrationMode === false, "arbitrary-phase report is an unsealed calibration");
  requireCheck(sha256(baselineBytes) === EXPECTED_BASELINE_SHA256, "arbitrary-phase authored-profile baseline digest changed");
  requireCheck(sha256(baselineJsonBytes) === EXPECTED_BASELINE_JSON_SHA256, "arbitrary-phase authored-profile JSON changed");
  requireCheck(baseline.schemaVersion === 1 && baseline.kind === "arbitrary-decoder-phase-authored-profiles", "arbitrary-phase baseline schema changed");
  requireCheck(JSON.stringify(baseline.cellProfileMetrics) === JSON.stringify(CELL_PROFILE_METRICS), "arbitrary-phase cell-profile metrics changed");
  requireCheck(JSON.stringify(baseline.edgeProfileMetrics) === JSON.stringify(EDGE_PROFILE_METRICS), "arbitrary-phase edge-profile metrics changed");
  requireCheck(baseline.cellOrder?.length === 73, "arbitrary-phase baseline cell order changed");
  requireCheck(baseline.hostGraphOrderedSha256 === EXPECTED_HOST_GRAPH_ORDER_SHA256, "arbitrary-phase ordered host graph changed");
  const traceIntegrity = verifyArbitraryPhaseTraceIntegrity({ report, baseline });
  requireCheck(report.thresholdPolicy?.authoredProfileBaseline?.sha256 === EXPECTED_BASELINE_SHA256, "arbitrary-phase report is bound to a different profile baseline");
  requireCheck(report.thresholdPolicy?.authoredProfileBaseline?.uncompressedJsonSha256 === EXPECTED_BASELINE_JSON_SHA256, "arbitrary-phase report baseline JSON binding changed");
  requireCheck(report.thresholdPolicy?.authoredProfileBaseline?.generationMode === false, "arbitrary-phase report used baseline-generation mode");
  requireCheck(report.thresholdPolicy?.authoredProfileBaseline?.reviewedReplacementMode === false, "arbitrary-phase report used reviewed baseline-replacement mode");
  requireCheck(report.contract?.withinReachableCellCount === 73, "arbitrary-phase reachable-cell count changed");
  requireCheck(report.contract?.hostGraph?.renderedFramesPerThemePerPath === 4380, "arbitrary-phase rendered-frame count changed");
  requireCheck(report.contract?.hostGraph?.uniqueChangedCellEdgesPerPath === 1813, "arbitrary-phase host graph changed");
  requireCheck(report.contract?.hostGraph?.rawTimedEffectiveResetMembership === 461, "arbitrary-phase reset graph changed");
  requireCheck(report.contract?.hostGraph?.disjointTimedEffectiveResetTraceCount === 460, "arbitrary-phase reset overlap changed");
  requireCheck(report.contract?.hostGraph?.timedToGazeEdges === 912, "arbitrary-phase timed-to-gaze graph changed");
  requireCheck(report.contract?.hostGraph?.gazeToTimedEdges === 144, "arbitrary-phase gaze-to-timed graph changed");
  requireCheck(report.contract?.hostGraph?.gazeToDifferentGazeEdges === 240, "arbitrary-phase gaze graph changed");
  requireCheck(report.contract?.renderedPixelCountsPerTheme?.source === 174_919_680, "arbitrary-phase source pixel coverage changed");
  requireCheck(report.contract?.renderedPixelCountsPerTheme?.codexDefaultDpr2 === 240_462_000, "arbitrary-phase browser pixel coverage changed");
  requireCheck(report.browserOracle?.reportSha256 === sha256(oracleBytes), "arbitrary-phase report is stale against the browser oracle");
  requireCheck(report.browserOracle?.rawRoundTripSha256 === oracle.sourceMaps?.rawSha256, "arbitrary-phase report is bound to a different browser map");
  requireCheck(report.browserOracle?.compressedMapSha256 === oracle.sourceMaps?.compressedSha256, "arbitrary-phase report is bound to a different compressed map");
  requireCheck(report.browserOracle?.pythonLoaderOutOfRangeRedPath === "rejected source x=192 before any atlas indexing", "Python browser-map loader red path changed");
  const gates = { source: report.paths?.source?.gates, codexDefaultDpr2: report.paths?.codexDefaultDpr2?.gates };
  requireCheck(sha256(JSON.stringify(gates)) === EXPECTED_GATE_SHA256, "arbitrary-phase gates changed without recalibration");
  for (const pathId of ["source", "codexDefaultDpr2"]) {
    const pathReport = report.paths?.[pathId];
    const counts = report.contract?.orderedPairCountsPerTheme?.[pathId];
    requireCheck(counts?.within === 258_420 && counts.stateSwitch === 6_526_800 && counts.total === 6_785_220, `${pathId} pair coverage changed`);
    requireCheck(pathReport?.crossThemeAlphaParity === true, `${pathId} cross-theme alpha parity failed`);
    for (const theme of ["dark", "light"]) {
      const themeReport = pathReport.themes?.[theme];
      const baselineBranch = baseline.paths?.[pathId]?.[theme];
      requireCheck(baselineBranch?.cells?.profiles?.length === 73, `${pathId}/${theme} baseline cell count changed`);
      requireCheck(baselineBranch?.cells?.orderedMetricTraceSha256?.length === 73, `${pathId}/${theme} baseline cell trace count changed`);
      requireCheck(baselineBranch.cells.profiles.every((profile) => profile.length === CELL_PROFILE_METRICS.length), `${pathId}/${theme} baseline cell profile width changed`);
      requireCheck(baselineBranch.cells.orderedMetricTraceSha256.every((digest) => /^[a-f0-9]{64}$/u.test(digest)), `${pathId}/${theme} baseline cell trace digest is invalid`);
      const atlasBytes = readFileSync(path.join(root, `pet/grok-bot-${theme}/spritesheet.webp`));
      requireCheck(themeReport?.atlas?.fileSha256 === sha256(atlasBytes), `${pathId}/${theme} atlas is stale`);
      requireCheck(themeReport.atlas.phaseCount === 60, `${pathId}/${theme} phase count changed`);
      requireCheck(themeReport.within?.allReachableCells?.count === 258_420, `${pathId}/${theme} within coverage changed`);
      requireCheck(themeReport.within.allReachableCells.failingPairCount === 0, `${pathId}/${theme} has a failing within-cell pair`);
      requireCheck(themeReport.within.fullCycleMateriality?.failingCellCount === 0, `${pathId}/${theme} cell materiality failed`);
      const cellBaseline = themeReport.within.fullCycleMateriality?.authoredPerCellBaseline;
      requireCheck(cellBaseline?.comparedCellCount === 73, `${pathId}/${theme} per-cell baseline coverage changed`);
      requireCheck(cellBaseline?.failingCellCount === 0, `${pathId}/${theme} per-cell authored profile changed`);
      requireCheck(/^[a-f0-9]{64}$/u.test(cellBaseline.orderedProfileTraceSha256), `${pathId}/${theme} per-cell profile trace is invalid`);
      for (const [family, edgeCount] of Object.entries(FAMILY_EDGE_COUNTS)) {
        const familyReport = themeReport.stateSwitchFamilies?.[family];
        const familyBaseline = baselineBranch.edges?.[family];
        requireCheck(familyBaseline?.profiles?.length === edgeCount, `${pathId}/${theme}/${family} baseline edge count changed`);
        requireCheck(familyBaseline?.orderedMetricTraceSha256?.length === edgeCount, `${pathId}/${theme}/${family} baseline edge trace count changed`);
        requireCheck(familyBaseline?.samePhaseMetricTraceSha256?.length === edgeCount, `${pathId}/${theme}/${family} baseline same-phase trace count changed`);
        requireCheck(familyBaseline?.samePhasePerceptualRms?.length === edgeCount, `${pathId}/${theme}/${family} baseline semantic-distance count changed`);
        requireCheck(familyBaseline.profiles.every((profile) => profile.length === EDGE_PROFILE_METRICS.length), `${pathId}/${theme}/${family} baseline edge profile width changed`);
        requireCheck(familyBaseline.orderedMetricTraceSha256.every((digest) => /^[a-f0-9]{64}$/u.test(digest)), `${pathId}/${theme}/${family} baseline edge trace digest is invalid`);
        requireCheck(familyBaseline.samePhaseMetricTraceSha256.every((digest) => /^[a-f0-9]{64}$/u.test(digest)), `${pathId}/${theme}/${family} baseline same-phase digest is invalid`);
        requireCheck(familyBaseline.samePhasePerceptualRms.every((distances) => distances.length === 60), `${pathId}/${theme}/${family} baseline phase-distance width changed`);
        requireCheck(familyReport?.statePairCount === edgeCount, `${pathId}/${theme}/${family} edge coverage changed`);
        requireCheck(familyReport.count === edgeCount * 3600, `${pathId}/${theme}/${family} phase coverage changed`);
        requireCheck(familyReport.failingPairCount === 0, `${pathId}/${theme}/${family} has a failing pair`);
        requireCheck(familyReport.fullCycleMateriality?.failingStatePairCount === 0, `${pathId}/${theme}/${family} materiality failed`);
        requireCheck(/^[a-f0-9]{64}$/u.test(familyReport.orderedMetricTraceSha256), `${pathId}/${theme}/${family} trace digest is invalid`);
        const edgeBaseline = familyReport.authoredPerEdgeBaseline;
        requireCheck(edgeBaseline?.comparedEdgeCount === edgeCount, `${pathId}/${theme}/${family} per-edge baseline coverage changed`);
        requireCheck(edgeBaseline?.failingEdgeCount === 0, `${pathId}/${theme}/${family} per-edge authored profile changed`);
        requireCheck(/^[a-f0-9]{64}$/u.test(edgeBaseline.orderedProfileTraceSha256), `${pathId}/${theme}/${family} profile trace is invalid`);
        if (family === "timedCellAdvance") {
          requireCheck(edgeBaseline.policyCounts?.[pathId === "source" ? "continuityAlias" : "sampledContinuity"] === 57, `${pathId}/${theme}/${family} continuity policy changed`);
        } else if (family === "timedEffectiveReset") {
          requireCheck(edgeBaseline.policyCounts?.semanticDistinction === 456, `${pathId}/${theme}/${family} semantic reset policy changed`);
          requireCheck(edgeBaseline.policyCounts?.[pathId === "source" ? "continuityAlias" : "sampledContinuity"] === 4, `${pathId}/${theme}/${family} continuity reset policy changed`);
        } else {
          requireCheck(edgeBaseline.policyCounts?.semanticDistinction === edgeCount, `${pathId}/${theme}/${family} semantic policy changed`);
        }
      }
      if (pathId === "source") {
        requireCheck(themeReport.timedColumnEquivalence?.allTimedColumnsEqualToC0 === true, `${theme} source timed-column identity failed`);
      } else {
        requireCheck(Object.values(themeReport.timedColumnEquivalence?.rows ?? {}).some(({ uniqueRenderedSequenceCount }) => uniqueRenderedSequenceCount > 1), `${theme} browser-specific column sampling was collapsed`);
      }
    }
  }
  return {
    ok: true,
    sha256: sha256(reportBytes),
    totalOrderedPairTraces: traceIntegrity.exactPhasePairCount,
    exactItemTraceCount: traceIntegrity.exactItemTraceCount,
  };
}

function main() {
  if (process.argv.slice(2).includes("--check")) {
    const result = checkArbitraryPhaseReport();
    console.log(`PASS: sealed arbitrary decoder phases; ${result.totalOrderedPairTraces} ordered traces`);
    return;
  }
  const python = findPython();
  const result = spawnSync(
    python,
    [path.join(repositoryRoot, "scripts/arbitrary-phase-qa.py"), ...process.argv.slice(2)],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
