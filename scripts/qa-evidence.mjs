import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { GROK_STATES } from "../src/spec.mjs";
import { inspectAlphaEdgeQuality } from "./alpha-edge-qa.mjs";
import { verifyArbitraryPhaseTraceIntegrity } from "./arbitrary-phase-report-integrity.mjs";
import {
  CODEX_DEFAULT_DPR2_DISPLAY,
  CODEX_DEFAULT_DPR2_ORACLE_REPORT,
  codexDefaultDpr2CellMap,
} from "./codex-default-dpr2-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = "qa/evidence.json";
const ANIMATED_ATLAS_FRAME_COUNT = 60;
const ANIMATED_ATLAS_LOOP_MS = 1000;
const ANIMATED_ATLAS_DELAYS_MS = Object.freeze(Array.from(
  { length: ANIMATED_ATLAS_FRAME_COUNT },
  (_, index) => Math.round((index + 1) * ANIMATED_ATLAS_LOOP_MS / ANIMATED_ATLAS_FRAME_COUNT)
    - Math.round(index * ANIMATED_ATLAS_LOOP_MS / ANIMATED_ATLAS_FRAME_COUNT),
));
const ANIMATED_ATLAS_REQUIRED_COLUMNS = Object.freeze([6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
const ANIMATED_ATLAS_REQUIRED_CELL_KEYS = Object.freeze(
  ANIMATED_ATLAS_REQUIRED_COLUMNS.flatMap((columnCount, row) => (
    Array.from({ length: columnCount }, (_, column) => `r${row}c${column}`)
  )),
);
const ARBITRARY_PHASE_BASELINE_SHA256 = "c4c4552f34a427a09293ebb39a5f1a8a0c9b12d5c276e81baedbe24800b371f1";
const ARBITRARY_PHASE_BASELINE_JSON_SHA256 = "6b6a16a25b4325b9b447ba62befa7684ac4a0f2f39ed79486de421a5c0dba082";
const ANIMATED_TEMPORAL_MOTION_GATES = Object.freeze({
  minimumChangedPixelFractionPerInternalTransition: 0.001,
  minimumNormalizedRgbaDiffPerInternalTransition: 0.00001,
  requiresDistinctAlphaFrames: true,
  gazeFullCycle: Object.freeze({
    rowIndices: Object.freeze([9, 10]),
    minimumActiveInternalTransitionFraction: 0.925,
    minimumTotalNormalizedRgbaDiff: 0.0048248,
    minimumTotalChangedPixelFraction: 0.88064,
  }),
});
const ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS = Object.freeze({
  maximumNormalizedRgbaDiff: 0.034,
  maximumNormalizedAlphaDiff: 0.027,
  maximumChangedPixelFraction: 0.097,
  maximumChangedAlphaPixelFraction: 0.043,
  maximumPerceptualRms: 35,
  maximumStronglyChangedCellFraction: 0.125,
  maximumFeatureInkMassStepFraction: 0.174,
  maximumFeatureInkVariationFraction: 1.82,
  maximumFeatureInkCentroidStepPx: 12.75,
  minimumFeatureInkPeakForFeatureMetrics: 64,
  minimumFeatureInkEndpointMass: 16,
  minimumFeatureInkEndpointPeakFraction: 0.1,
  isolatedSnapMinimumPerceptualRms: 1,
  localEnergyFloorPerceptualRms: 0.25,
  maximumLocalEnergyRatio: 1.72343,
  isolatedFrameMinimumPerceptualRms: 1,
  isolatedFrameSkipEnergyFloorPerceptualRms: 0.25,
  maximumIsolatedFrameExcursionRatio: 3.38,
  perceptualModel: "intended-surface sRGB alpha composite; luma-weighted YCbCr distance (0-100)",
  strongDifferenceThreshold: 8,
  featureRoi: Object.freeze({ minX: 20, minY: 20, maxX: 175, maxY: 160 }),
  loop: Object.freeze({
    maximumNormalizedRgbaDiff: 0.00673,
    maximumNormalizedAlphaDiff: 0.00562,
    maximumChangedPixelFraction: 0.03583,
    maximumChangedAlphaPixelFraction: 0.02304,
    maximumSilhouetteCentroidDistancePx: 0.642,
  }),
});
const ANIMATED_TEMPORAL_ROW_UPPER_BOUNDS = Object.freeze({
  0: Object.freeze({ maximumNormalizedRgbaDiff: 0.0262, maximumNormalizedAlphaDiff: 0.0012, maximumChangedPixelFraction: 0.055, maximumChangedAlphaPixelFraction: 0.017, maximumPerceptualRms: 18.3, maximumStronglyChangedCellFraction: 0.042, maximumFeatureInkMassStepFraction: 0.057, maximumFeatureInkVariationFraction: 1.82, maximumFeatureInkCentroidStepPx: 12.75, maximumLocalEnergyRatio: 1.4686, maximumIsolatedFrameExcursionRatio: 1.66 }),
  1: Object.freeze({ maximumNormalizedRgbaDiff: 0.0054, maximumNormalizedAlphaDiff: 0.0043, maximumChangedPixelFraction: 0.0275, maximumChangedAlphaPixelFraction: 0.022, maximumPerceptualRms: 4.31, maximumStronglyChangedCellFraction: 0.0166, maximumFeatureInkMassStepFraction: 0.023, maximumFeatureInkVariationFraction: 0.089, maximumFeatureInkCentroidStepPx: 0.67, maximumLocalEnergyRatio: 1.72343, maximumIsolatedFrameExcursionRatio: 0.66 }),
  2: Object.freeze({ maximumNormalizedRgbaDiff: 0.0051, maximumNormalizedAlphaDiff: 0.0043, maximumChangedPixelFraction: 0.029, maximumChangedAlphaPixelFraction: 0.022, maximumPerceptualRms: 4.01, maximumStronglyChangedCellFraction: 0.0174, maximumFeatureInkMassStepFraction: 0.00175, maximumFeatureInkVariationFraction: 0.044, maximumFeatureInkCentroidStepPx: 0.4, maximumLocalEnergyRatio: 1.58187, maximumIsolatedFrameExcursionRatio: 0.66 }),
  3: Object.freeze({ maximumNormalizedRgbaDiff: 0.0058, maximumNormalizedAlphaDiff: 0.0043, maximumChangedPixelFraction: 0.033, maximumChangedAlphaPixelFraction: 0.022, maximumPerceptualRms: 4.57, maximumStronglyChangedCellFraction: 0.0217, maximumFeatureInkMassStepFraction: 0.0038, maximumFeatureInkVariationFraction: 0.026, maximumFeatureInkCentroidStepPx: 0.34, maximumLocalEnergyRatio: 1.63066, maximumIsolatedFrameExcursionRatio: 0.74 }),
  4: Object.freeze({ maximumNormalizedRgbaDiff: 0.032, maximumNormalizedAlphaDiff: 0.027, maximumChangedPixelFraction: 0.055, maximumChangedAlphaPixelFraction: 0.043, maximumPerceptualRms: 16.32, maximumStronglyChangedCellFraction: 0.048, maximumFeatureInkMassStepFraction: 0.0031, maximumFeatureInkVariationFraction: 0.296, maximumFeatureInkCentroidStepPx: 3.08, maximumLocalEnergyRatio: 1.27935, maximumIsolatedFrameExcursionRatio: 3.38 }),
  5: Object.freeze({ maximumNormalizedRgbaDiff: 0.0162, maximumNormalizedAlphaDiff: 0.0046, maximumChangedPixelFraction: 0.041, maximumChangedAlphaPixelFraction: 0.021, maximumPerceptualRms: 13.21, maximumStronglyChangedCellFraction: 0.0326, maximumFeatureInkMassStepFraction: 0.078, maximumFeatureInkVariationFraction: 0.845, maximumFeatureInkCentroidStepPx: 9.75, maximumLocalEnergyRatio: 1.69289, maximumIsolatedFrameExcursionRatio: 0.927397 }),
  6: Object.freeze({ maximumNormalizedRgbaDiff: 0.0158, maximumNormalizedAlphaDiff: 0.0024, maximumChangedPixelFraction: 0.041, maximumChangedAlphaPixelFraction: 0.019, maximumPerceptualRms: 13.46, maximumStronglyChangedCellFraction: 0.0285, maximumFeatureInkMassStepFraction: 0.07, maximumFeatureInkVariationFraction: 0.585, maximumFeatureInkCentroidStepPx: 6.55, maximumLocalEnergyRatio: 1.26065, maximumIsolatedFrameExcursionRatio: 1.35 }),
  7: Object.freeze({ maximumNormalizedRgbaDiff: 0.0283, maximumNormalizedAlphaDiff: 0.0021, maximumChangedPixelFraction: 0.059, maximumChangedAlphaPixelFraction: 0.019, maximumPerceptualRms: 18.84, maximumStronglyChangedCellFraction: 0.0465, maximumFeatureInkMassStepFraction: 0.011, maximumFeatureInkVariationFraction: 1.16, maximumFeatureInkCentroidStepPx: 10.83, maximumLocalEnergyRatio: 1.23612, maximumIsolatedFrameExcursionRatio: 1.39 }),
  8: Object.freeze({ maximumNormalizedRgbaDiff: 0.034, maximumNormalizedAlphaDiff: 0.004, maximumChangedPixelFraction: 0.097, maximumChangedAlphaPixelFraction: 0.041, maximumPerceptualRms: 19.81, maximumStronglyChangedCellFraction: 0.0604, maximumFeatureInkMassStepFraction: 0.174, maximumFeatureInkVariationFraction: 0.652, maximumFeatureInkCentroidStepPx: 9.75, maximumLocalEnergyRatio: 1.29391, maximumIsolatedFrameExcursionRatio: 0.88 }),
  9: Object.freeze({ maximumNormalizedRgbaDiff: 0.00135, maximumNormalizedAlphaDiff: 0.00105, maximumChangedPixelFraction: 0.0215, maximumChangedAlphaPixelFraction: 0.017, maximumPerceptualRms: 1.03, maximumStronglyChangedCellFraction: 0.0067, maximumFeatureInkMassStepFraction: 0.0035, maximumFeatureInkVariationFraction: 0.019, maximumFeatureInkCentroidStepPx: 0.12, maximumLocalEnergyRatio: 1.55, maximumIsolatedFrameExcursionRatio: 0.89 }),
  10: Object.freeze({ maximumNormalizedRgbaDiff: 0.001464, maximumNormalizedAlphaDiff: 0.00105, maximumChangedPixelFraction: 0.022, maximumChangedAlphaPixelFraction: 0.017, maximumPerceptualRms: 1.01, maximumStronglyChangedCellFraction: 0.0062, maximumFeatureInkMassStepFraction: 0.00165, maximumFeatureInkVariationFraction: 0.0175, maximumFeatureInkCentroidStepPx: 0.1, maximumLocalEnergyRatio: 1.55, maximumIsolatedFrameExcursionRatio: 0.89 }),
});
const ANIMATED_112_TEMPORAL_GATE = Object.freeze({
  maximumNormalizedRgbaDiff: 0.03444820288,
  maximumNormalizedAlphaDiff: 0.02820201904,
  maximumChangedPixelFraction: 0.09926411664,
  maximumChangedAlphaPixelFraction: 0.04421420744,
  maximumPerceptualRms: 20.05324842144,
  maximumStronglyChangedCellFraction: 0.06122550096,
  localEnergyFloorPerceptualRms: 0.25,
  localEnergyMaterialPerceptualRms: 1,
  maximumLocalEnergyRatio: 4.13971467416,
  isolatedFrameMinimumPerceptualRms: 1,
  isolatedFrameSkipEnergyFloorPerceptualRms: 0.25,
  maximumIsolatedFrameExcursionRatio: 3.35242163984,
  loop: Object.freeze({
    maximumNormalizedRgbaDiff: 0.0066,
    maximumNormalizedAlphaDiff: 0.00552,
    maximumChangedPixelFraction: 0.0358,
    maximumChangedAlphaPixelFraction: 0.0231,
    maximumPerceptualRms: 5.55,
  }),
});
const ANIMATED_112_TEMPORAL_ROW_GATES = Object.freeze({
  0: Object.freeze({ maximumNormalizedRgbaDiff: 0.0264504292, maximumNormalizedAlphaDiff: 0.00118965392, maximumChangedPixelFraction: 0.05529617496, maximumChangedAlphaPixelFraction: 0.01718178488, maximumPerceptualRms: 18.43628416032, maximumStronglyChangedCellFraction: 0.04184626576, maximumLocalEnergyRatio: 1.494817, maximumIsolatedFrameExcursionRatio: 1.0015567796 }),
  1: Object.freeze({ maximumNormalizedRgbaDiff: 0.00565334432, maximumNormalizedAlphaDiff: 0.00448776016, maximumChangedPixelFraction: 0.02805537384, maximumChangedAlphaPixelFraction: 0.02324371608, maximumPerceptualRms: 4.47149508312, maximumStronglyChangedCellFraction: 0.01725755928, maximumLocalEnergyRatio: 1.72032, maximumIsolatedFrameExcursionRatio: 0.663617 }),
  2: Object.freeze({ maximumNormalizedRgbaDiff: 0.00538412368, maximumNormalizedAlphaDiff: 0.00449348016, maximumChangedPixelFraction: 0.0297792352, maximumChangedAlphaPixelFraction: 0.02324371608, maximumPerceptualRms: 4.1603358264, maximumStronglyChangedCellFraction: 0.0178637524, maximumLocalEnergyRatio: 1.561489, maximumIsolatedFrameExcursionRatio: 0.601219 }),
  3: Object.freeze({ maximumNormalizedRgbaDiff: 0.0057482672, maximumNormalizedAlphaDiff: 0.00417077232, maximumChangedPixelFraction: 0.03237449904, maximumChangedAlphaPixelFraction: 0.02182295128, maximumPerceptualRms: 4.68867323288, maximumStronglyChangedCellFraction: 0.02142513672, maximumLocalEnergyRatio: 1.618848, maximumIsolatedFrameExcursionRatio: 0.74059986832 }),
  4: Object.freeze({ maximumNormalizedRgbaDiff: 0.03341165776, maximumNormalizedAlphaDiff: 0.02820201904, maximumChangedPixelFraction: 0.05582659368, maximumChangedAlphaPixelFraction: 0.04421420744, maximumPerceptualRms: 16.64421549544, maximumStronglyChangedCellFraction: 0.0490258652, maximumLocalEnergyRatio: 1.264877, maximumIsolatedFrameExcursionRatio: 3.35242163984 }),
  5: Object.freeze({ maximumNormalizedRgbaDiff: 0.01589620656, maximumNormalizedAlphaDiff: 0.00461241664, maximumChangedPixelFraction: 0.04044444456, maximumChangedAlphaPixelFraction: 0.0206673948, maximumPerceptualRms: 13.20822485112, maximumStronglyChangedCellFraction: 0.03250710424, maximumLocalEnergyRatio: 1.678405, maximumIsolatedFrameExcursionRatio: 0.942322 }),
  6: Object.freeze({ maximumNormalizedRgbaDiff: 0.01588500784, maximumNormalizedAlphaDiff: 0.0023044996, maximumChangedPixelFraction: 0.04101275048, maximumChangedAlphaPixelFraction: 0.01858360608, maximumPerceptualRms: 13.71794542664, maximumStronglyChangedCellFraction: 0.02864262336, maximumLocalEnergyRatio: 1.23992308232, maximumIsolatedFrameExcursionRatio: 1.36926898056 }),
  7: Object.freeze({ maximumNormalizedRgbaDiff: 0.0285377092, maximumNormalizedAlphaDiff: 0.001987882, maximumChangedPixelFraction: 0.05883861568, maximumChangedAlphaPixelFraction: 0.01761748664, maximumPerceptualRms: 19.08636945904, maximumStronglyChangedCellFraction: 0.04680947128, maximumLocalEnergyRatio: 1.22015257624, maximumIsolatedFrameExcursionRatio: 1.37869129008 }),
  8: Object.freeze({ maximumNormalizedRgbaDiff: 0.03444820288, maximumNormalizedAlphaDiff: 0.0040045148, maximumChangedPixelFraction: 0.09926411664, maximumChangedAlphaPixelFraction: 0.04072859752, maximumPerceptualRms: 20.05324842144, maximumStronglyChangedCellFraction: 0.06122550096, maximumLocalEnergyRatio: 1.319606, maximumIsolatedFrameExcursionRatio: 0.87197985992 }),
  9: Object.freeze({ maximumNormalizedRgbaDiff: 0.00142199096, maximumNormalizedAlphaDiff: 0.00102636768, maximumChangedPixelFraction: 0.02125464432, maximumChangedAlphaPixelFraction: 0.01682185752, maximumPerceptualRms: 1.0349286688, maximumStronglyChangedCellFraction: 0.00668706688, maximumLocalEnergyRatio: 4.13971467416, maximumIsolatedFrameExcursionRatio: 0.89203659168 }),
  10: Object.freeze({ maximumNormalizedRgbaDiff: 0.0013025532, maximumNormalizedAlphaDiff: 0.00103127128, maximumChangedPixelFraction: 0.02150091112, maximumChangedAlphaPixelFraction: 0.01710601048, maximumPerceptualRms: 1.01334327328, maximumStronglyChangedCellFraction: 0.00640291392, maximumLocalEnergyRatio: 4.02942556432, maximumIsolatedFrameExcursionRatio: 0.89766587976 }),
});
const ANIMATED_112_DISPLAY = CODEX_DEFAULT_DPR2_DISPLAY;
const ANIMATED_SAME_PHASE_TRANSITION_GATES = Object.freeze({
  actionToIdle: Object.freeze({
    minimumSilhouetteIou: 0.82,
    maximumSilhouetteCentroidDistancePx: 12,
    maximumNormalizedAlphaDiff: 0.11,
    maximumAlphaAreaRatioSymmetric: 1.08,
  }),
  gazeEntry: Object.freeze({
    minimumSilhouetteIou: 0.84,
    maximumSilhouetteCentroidDistancePx: 10,
    maximumNormalizedAlphaDiff: 0.09,
    maximumAlphaAreaRatioSymmetric: 1.06,
  }),
  gazeTimedBoundary: Object.freeze({
    minimumSilhouetteIou: 0.796,
    maximumSilhouetteCentroidDistancePx: 14.87,
    maximumNormalizedAlphaDiff: 0.1215,
    maximumAlphaAreaRatioSymmetric: 1.0265,
  }),
  timedRowPair: Object.freeze({
    minimumSilhouetteIou: 0.82,
    maximumSilhouetteCentroidDistancePx: 12,
    maximumNormalizedAlphaDiff: 0.11,
    maximumAlphaAreaRatioSymmetric: 1.08,
  }),
  timedRowCrossPhase: Object.freeze({
    minimumSilhouetteIou: 0.82,
    maximumSilhouetteCentroidDistancePx: 12.25,
    maximumNormalizedAlphaDiff: 0.11,
    maximumAlphaAreaRatioSymmetric: 1.08,
  }),
  adjacentGazeSector: Object.freeze({
    minimumSilhouetteIou: 0.936,
    maximumSilhouetteCentroidDistancePx: 4.16,
    maximumNormalizedRgbaDiff: 0.05683,
    maximumNormalizedAlphaDiff: 0.03538,
    maximumChangedPixelFraction: 0.08416,
    maximumChangedAlphaPixelFraction: 0.05146,
    maximumAlphaAreaRatioSymmetric: 1.0104,
  }),
});
const ANIMATED_GAZE_BODY_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 120,
  requiredPhasesPerPair: 60,
  maximumAdjacentStep: Object.freeze({
    silhouetteIou: 0.00205,
    silhouetteCentroidDistancePx: 0.071,
    normalizedAlphaDiff: 0.000226,
    alphaAreaRatioSymmetric: 0.00289,
  }),
  maximumSecondDifferenceResidual: Object.freeze({
    silhouetteIou: 0.00114,
    silhouetteCentroidDistancePx: 0.0458,
    normalizedAlphaDiff: 0.000208,
    alphaAreaRatioSymmetric: 0.00221,
  }),
  maximumPairRange: Object.freeze({
    silhouetteIou: 0.00296,
    silhouetteCentroidDistancePx: 0.133293,
    normalizedAlphaDiff: 0.000612,
    alphaAreaRatioSymmetric: 0.00299,
  }),
});
const ANIMATED_GAZE_BODY_CROSS_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 208,
  requiredPhasesPerPair: 60,
  maximumAdjacentStep: Object.freeze({
    silhouetteIou: 0.00117,
    silhouetteCentroidDistancePx: 0.0635,
    normalizedAlphaDiff: 0.000347,
    alphaAreaRatioSymmetric: 0.00298,
  }),
  maximumSecondDifferenceResidual: Object.freeze({
    silhouetteIou: 0.00085,
    silhouetteCentroidDistancePx: 0.046754,
    normalizedAlphaDiff: 0.000235,
    alphaAreaRatioSymmetric: 0.00295,
  }),
  maximumPairRange: Object.freeze({
    silhouetteIou: 0.00336,
    silhouetteCentroidDistancePx: 0.164,
    normalizedAlphaDiff: 0.000959,
    alphaAreaRatioSymmetric: 0.00432,
  }),
});
const ANIMATED_112_HOST_BOUNDARY_GATES = Object.freeze({
  samePhaseTimedRowPairs: Object.freeze({ minimumSilhouetteIou: 0.829, maximumSilhouetteCentroidDistancePx: 14.46, maximumNormalizedRgbaDiff: 0.158, maximumNormalizedAlphaDiff: 0.0997, maximumChangedPixelFraction: 0.2071, maximumChangedAlphaPixelFraction: 0.118, maximumAlphaAreaRatioSymmetric: 1.0315, maximumPerceptualRms: 41.11, maximumStronglyChangedCellFraction: 0.1982 }),
  samePhaseEligibleTimedToGaze: Object.freeze({ minimumSilhouetteIou: 0.8718, maximumSilhouetteCentroidDistancePx: 11.17, maximumNormalizedRgbaDiff: 0.1339, maximumNormalizedAlphaDiff: 0.0747, maximumChangedPixelFraction: 0.177, maximumChangedAlphaPixelFraction: 0.0923, maximumAlphaAreaRatioSymmetric: 1.0238, maximumPerceptualRms: 38.18, maximumStronglyChangedCellFraction: 0.169 }),
  samePhaseOtherTimedToGaze: Object.freeze({ minimumSilhouetteIou: 0.7945, maximumSilhouetteCentroidDistancePx: 17.49, maximumNormalizedRgbaDiff: 0.1455, maximumNormalizedAlphaDiff: 0.1232, maximumChangedPixelFraction: 0.1924, maximumChangedAlphaPixelFraction: 0.1396, maximumAlphaAreaRatioSymmetric: 1.0258, maximumPerceptualRms: 37.7, maximumStronglyChangedCellFraction: 0.1828 }),
  samePhaseAdjacentGaze: Object.freeze({ minimumSilhouetteIou: 0.9355, maximumSilhouetteCentroidDistancePx: 4.89, maximumNormalizedRgbaDiff: 0.0568, maximumNormalizedAlphaDiff: 0.0358, maximumChangedPixelFraction: 0.0842, maximumChangedAlphaPixelFraction: 0.0522, maximumAlphaAreaRatioSymmetric: 1.0099, maximumPerceptualRms: 24.04, maximumStronglyChangedCellFraction: 0.0776 }),
  crossPhaseTimedRowChanges: Object.freeze({ minimumSilhouetteIou: 0.8265, maximumSilhouetteCentroidDistancePx: 14.7, maximumNormalizedRgbaDiff: 0.1593, maximumNormalizedAlphaDiff: 0.1013, maximumChangedPixelFraction: 0.2105, maximumChangedAlphaPixelFraction: 0.1189, maximumAlphaAreaRatioSymmetric: 1.0322, maximumPerceptualRms: 41.27, maximumStronglyChangedCellFraction: 0.2017 }),
  crossPhaseAdjacentGaze: Object.freeze({ minimumSilhouetteIou: 0.9352, maximumSilhouetteCentroidDistancePx: 4.91, maximumNormalizedRgbaDiff: 0.057, maximumNormalizedAlphaDiff: 0.036, maximumChangedPixelFraction: 0.0844, maximumChangedAlphaPixelFraction: 0.0523, maximumAlphaAreaRatioSymmetric: 1.0113, maximumPerceptualRms: 24.09, maximumStronglyChangedCellFraction: 0.0779 }),
  crossPhaseGazeToEligibleTimed: Object.freeze({ minimumSilhouetteIou: 0.8712, maximumSilhouetteCentroidDistancePx: 11.22, maximumNormalizedRgbaDiff: 0.1342, maximumNormalizedAlphaDiff: 0.0749, maximumChangedPixelFraction: 0.1772, maximumChangedAlphaPixelFraction: 0.0925, maximumAlphaAreaRatioSymmetric: 1.0238, maximumPerceptualRms: 38.2, maximumStronglyChangedCellFraction: 0.1692 }),
  crossPhaseGazeToOtherTimed: Object.freeze({ minimumSilhouetteIou: 0.7945, maximumSilhouetteCentroidDistancePx: 17.49, maximumNormalizedRgbaDiff: 0.1453, maximumNormalizedAlphaDiff: 0.1232, maximumChangedPixelFraction: 0.1923, maximumChangedAlphaPixelFraction: 0.1396, maximumAlphaAreaRatioSymmetric: 1.0258, maximumPerceptualRms: 37.68, maximumStronglyChangedCellFraction: 0.1828 }),
  crossPhaseEligibleTimedToGaze: Object.freeze({ minimumSilhouetteIou: 0.8717, maximumSilhouetteCentroidDistancePx: 11.17, maximumNormalizedRgbaDiff: 0.1338, maximumNormalizedAlphaDiff: 0.0746, maximumChangedPixelFraction: 0.177, maximumChangedAlphaPixelFraction: 0.0922, maximumAlphaAreaRatioSymmetric: 1.0238, maximumPerceptualRms: 38.16, maximumStronglyChangedCellFraction: 0.1688 }),
});
const ANIMATED_112_HOST_GAZE_BODY_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 104,
  requiredPhasesPerPair: 60,
  maximumAdjacentStep: Object.freeze({ silhouetteIou: 0.0017148612, silhouetteCentroidDistancePx: 0.096489, normalizedAlphaDiff: 0.00023839088, alphaAreaRatioSymmetric: 0.00294826272 }),
  maximumSecondDifferenceResidual: Object.freeze({ silhouetteIou: 0.00095294368, silhouetteCentroidDistancePx: 0.05713078488, normalizedAlphaDiff: 0.00023263344, alphaAreaRatioSymmetric: 0.00221755664 }),
  maximumPairRange: Object.freeze({ silhouetteIou: 0.00307643336, silhouetteCentroidDistancePx: 0.213377, normalizedAlphaDiff: 0.00078077168, alphaAreaRatioSymmetric: 0.00335386688 }),
});
const ANIMATED_112_HOST_GAZE_BODY_CROSS_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 208,
  requiredPhasesPerPair: 60,
  maximumAdjacentStep: Object.freeze({ silhouetteIou: 0.00129268568, silhouetteCentroidDistancePx: 0.102391, normalizedAlphaDiff: 0.00034945248, alphaAreaRatioSymmetric: 0.0030197128 }),
  maximumSecondDifferenceResidual: Object.freeze({ silhouetteIou: 0.0009464, silhouetteCentroidDistancePx: 0.077811, normalizedAlphaDiff: 0.00023998936, alphaAreaRatioSymmetric: 0.00295903088 }),
  maximumPairRange: Object.freeze({ silhouetteIou: 0.00363833496, silhouetteCentroidDistancePx: 0.2197, normalizedAlphaDiff: 0.0010667072, alphaAreaRatioSymmetric: 0.004706832 }),
});
const ANIMATED_SAME_NON_NEIGHBOR_PAIR_KEYS_SHA256 = "b99e9baaad867f1ff9444a2e60c52d2fdcb75fabe3f802b78165587300539c88";
const ANIMATED_CROSS_NON_NEIGHBOR_PAIR_KEYS_SHA256 = "702345dc1815ec0a0868a735ea03c34d464789e109f42565adf010299bf32899";
const ANIMATED_THEME_RELATION_GATE = Object.freeze({
  maximumChannelDeltaSpreadForAllowedComposite: 3,
  maximumUnclassifiedVisiblePairFraction: 0.00012,
  maximumPaletteRoleMismatchVisiblePairFraction: 0.0001,
});

const ACCENT_COLORS = Object.freeze({
  coral: "#F9705C",
  blue: "#5B95F0",
  green: "#3FBE86",
  gold: "#F5B13F",
  violet: "#9A72EE",
  teal: "#35C3BD",
});

const TIMED_ROW_IDS = Object.freeze([
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
]);

const SOURCE_EFFECTS = Object.freeze([
  "dots",
  "orbit",
  "radar",
  "progress",
  "gather",
  "wave",
  "send",
  "receive",
  "dock",
  "ball",
  "whirl",
  "standby",
  "pencil",
  "bang",
]);

const SOURCE_MOTION_INPUTS = Object.freeze([
  ".node-version",
  "src/grok-art.mjs",
  "src/grok-body-registry.mjs",
  "src/grok-eye-topologies.mjs",
  "src/grok-motion.mjs",
  "src/source-motion-timing.mjs",
  "src/spec.mjs",
  "scripts/build-source-motion.mjs",
  "package.json",
  "package-lock.json",
]);

const SOURCE_MOTION_ENCODER = Object.freeze({
  node: "v26.8.1",
  sharp: "0.35.4",
  libvips: "8.18.6",
  webp: "1.6.0",
  rsvg: "2.62.91",
  cairo: "1.18.4",
  pixman: "0.46.4",
});

const FLUID_QA_INPUT_PATHS = Object.freeze([
  "src/animation-timeline.mjs",
  "src/coverage-raster.mjs",
  "src/encoded-timeline-metrics.mjs",
  "src/fluid-atlas.mjs",
  "scripts/build.mjs",
  "scripts/animated-atlas-qa.mjs",
  "scripts/animated-atlas-temporal-artifacts.mjs",
  "scripts/alpha-edge-qa.mjs",
  "scripts/alpha-edge-quality.mjs",
  "test/animation-timeline.test.mjs",
  "test/animated-atlas-temporal.test.mjs",
  "test/coverage-raster.test.mjs",
  "test/encoded-timeline-metrics.test.mjs",
]);

const ANIMATED_TEMPORAL_ARTIFACT_PATHS = Object.freeze([
  "qa/animated-atlas-temporal-all-frames-dark.png",
  "qa/animated-atlas-temporal-all-frames-light.png",
  "qa/animated-atlas-temporal-worst-cases.png",
]);

const EXHAUSTIVE_EDGE_QA_PATHS = Object.freeze([
  "scripts/exhaustive-edge-qa.mjs",
  "test/exhaustive-edge-qa.test.mjs",
  "test/qa-input-freshness.test.mjs",
  "test/qa-lifecycle.test.mjs",
  "qa/exhaustive-edge-qa.json",
  "qa/exhaustive-edge-worst-cases.png",
]);

const DEFAULT_DPR2_AND_ARBITRARY_PHASE_QA_PATHS = Object.freeze([
  "scripts/capture-codex-default-dpr2-oracle.mjs",
  "scripts/codex-default-dpr2-oracle.mjs",
  "scripts/arbitrary-phase-qa.mjs",
  "scripts/arbitrary-phase-qa.py",
  "scripts/arbitrary-phase-report-integrity.mjs",
  "test/browser-oracle-and-arbitrary-phase.test.mjs",
  "qa/codex-default-dpr2-browser-oracle.json",
  "qa/codex-default-dpr2-browser-oracle.png",
  "qa/codex-default-dpr2-browser-oracle-map.bin",
  "qa/arbitrary-phase-baselines.json.gz",
  "qa/arbitrary-phase-qa.json",
]);

const SOURCE_MOTION_TEMPORAL_QA_PATHS = Object.freeze([
  "scripts/source-motion-qa.mjs",
  "scripts/source-motion-temporal-qa.mjs",
  "test/source-motion-timing.test.mjs",
  "qa/source-motion-temporal.json",
  "qa/source-motion-temporal-all-frames.png",
  "qa/source-motion-temporal-worst-cases.png",
]);

const EXHAUSTIVE_EDGE_QA_EXPECTED = Object.freeze({
  shippingCellPages: 73 * ANIMATED_ATLAS_FRAME_COUNT * 2,
  shippingUnusedCellPages: 15 * ANIMATED_ATLAS_FRAME_COUNT * 2,
  sourceMotionNominalFrames: 4_368,
  sourceMotionEncodedPages: 4_120,
  shippingCompositeOutputs: 8 * 73 * ANIMATED_ATLAS_FRAME_COUNT,
  sourceCompositeOutputs: 8_736,
  shippingSequences: 8,
  shippingFramesPerSequence: 73 * ANIMATED_ATLAS_FRAME_COUNT,
  sourceSequences: 4,
  sourceFramesPerSequence: 2_184,
});
const EXHAUSTIVE_EDGE_QA_THRESHOLDS = Object.freeze({
  maximumHiddenRgbPixels: 0,
  maximumGutterNonZeroRgbaPixels: 0,
  maximumAlphaMismatchPixels: 0,
  maximumUnclassifiedVisiblePairFraction: 0.00012,
  maximumUnexplainedMatteCandidateFraction: 0.00005,
  maximumReciprocalDarkLightMattePairs: 0,
  maximumReciprocalOuterEdgeContaminationPixels: 0,
  maximumSourceMotionCssFilterMatches: 0,
  relationChannelTolerance: 3,
  localReferenceRadiusPx: 3,
  matteAnalysisAlphaRange: Object.freeze([16, 239]),
  matteCandidate: Object.freeze({
    maximumMatteDistance: 6,
    minimumStraightDistance: 24,
    minimumMatteAdvantage: 18,
  }),
  outerEdgeContamination: Object.freeze({
    maximumKeylineReferenceDistance: 24,
    maximumPrimaryFillReferenceDistance: 30,
    maximumEdgeAlpha: 8,
    maximumPremattedDistance: 6,
    maximumNeutralChannelSpread: 6,
    maximumNeutralPairDistance: 12,
    localReferenceRadiusPx: 3,
    intentionalInverseFeature: Object.freeze({
      minimumPixels: 8,
      minimumWidthPx: 3,
      minimumHeightPx: 3,
      minimumBoundingBoxFillRatio: 0.25,
      maximumCanvasDimensionFraction: 0.35,
    }),
    pairedChromaContinuation: Object.freeze({
      localReferenceRadiusPx: 3,
      minimumChannelSpread: 18,
      minimumAlphaIncrease: 1,
    }),
  }),
});

const runtimePreviewPaths = (variant) => TIMED_ROW_IDS.map(
  (id, row) => `qa/runtime-previews-${variant}/${String(row).padStart(2, "0")}-${id}-runtime.webp`,
);

const sourceMotionPaths = Object.freeze(
  ["dark", "light"].flatMap((theme) => (
    SOURCE_EFFECTS.map((effect) => `preview/source-lab/motion/${theme}/${effect}.webp`)
  )),
);

const OFFICIAL_ROW_DURATIONS = Object.freeze({
  idle: Object.freeze([280, 110, 110, 140, 140, 320]),
  "running-right": Object.freeze([120, 120, 120, 120, 120, 120, 120, 220]),
  "running-left": Object.freeze([120, 120, 120, 120, 120, 120, 120, 220]),
  waving: Object.freeze([140, 140, 140, 280]),
  jumping: Object.freeze([140, 140, 140, 140, 280]),
  failed: Object.freeze([140, 140, 140, 140, 140, 140, 140, 240]),
  waiting: Object.freeze([150, 150, 150, 150, 150, 260]),
  running: Object.freeze([120, 120, 120, 120, 120, 220]),
  review: Object.freeze([150, 150, 150, 150, 150, 280]),
});

const OFFICIAL_SCRIPT_SHAS = Object.freeze({
  "validate_atlas.py": "ebbbc77cfbd27ef8476ac6fda716e864cf372a2ed4c2beb27ebdb2487e972194",
  "make_contact_sheet.py": "51e2085b8acb172dcdd5fff9993bdee413f3851b714229ca095dc99cd551aa96",
  "make_direction_qa_sheet.py": "823e81e0aece24d1d6537889c9daaa2660208ff52604509b24fd5e24e7302acb",
  "make_direction_blind_qa_sheet.py": "52f2a29251872449fed51c7744c3f9f503274ee288eb23efc29a2c568b0d52bd",
  "combine_direction_blind_verdicts.py": "4dad56adaad032a4e6d070494b0ab2ca316429cf69363450f9fbf7135d1c2d42",
  "validate_direction_blind_verdicts.py": "7871667432918e0ffcdbb9beaf88a01c0af4b9e2809c5000f7b533a9ddc6e13d",
  "measure_direction_continuity.py": "e24b7065af82eab5638f1fcdeb627d497391a2f1e9ba19801827d1db3a6d8c2d",
  "render_animation_previews.py": "911e8813e1b79b7f9da44fae8a667c044818e8c71f41eaa4b280e91c78cde61e",
});
const OFFICIAL_V2_NEUTRAL_CELL_DIAGNOSTIC = "idle row 0 column 6 is empty or too sparse (0 pixels)";

const BLIND_LOOK_DIRECTIONS = Object.freeze([
  "000", "022.5", "045", "067.5", "090", "112.5", "135", "157.5",
  "180", "202.5", "225", "247.5", "270", "292.5", "315", "337.5",
]);

const BLIND_AXIS_PAIRS = Object.freeze([
  Object.freeze(["horizontal", "022.5", "screen-right", "337.5", "screen-left", "review"]),
  Object.freeze(["horizontal", "045", "screen-right", "315", "screen-left", "review"]),
  Object.freeze(["horizontal", "067.5", "screen-right", "292.5", "screen-left", "review"]),
  Object.freeze(["horizontal", "090", "screen-right", "270", "screen-left", "hard"]),
  Object.freeze(["horizontal", "112.5", "screen-right", "247.5", "screen-left", "review"]),
  Object.freeze(["horizontal", "135", "screen-right", "225", "screen-left", "review"]),
  Object.freeze(["horizontal", "157.5", "screen-right", "202.5", "screen-left", "review"]),
  Object.freeze(["vertical", "000", "up", "180", "down", "hard"]),
  Object.freeze(["vertical", "022.5", "up", "157.5", "down", "review"]),
  Object.freeze(["vertical", "045", "up", "135", "down", "review"]),
  Object.freeze(["vertical", "067.5", "up", "112.5", "down", "review"]),
  Object.freeze(["vertical", "337.5", "up", "202.5", "down", "review"]),
  Object.freeze(["vertical", "315", "up", "225", "down", "review"]),
  Object.freeze(["vertical", "292.5", "up", "247.5", "down", "review"]),
]);

const RUNTIME_CONTINUITY_POLICY = "project-specific release thresholds are enforced for every runtime transition";
const RUNTIME_CONTINUITY_THRESHOLDS = Object.freeze({
  requiredTransitionCount: 65,
  maximumNormalizedAlphaDifference: 0.25,
  maximumNormalizedCompositedRgbDifference: 0.25,
  maximumChangedPixelFraction: 0.45,
  maximumAlphaAreaRatioSymmetric: 2.5,
});

const officialPreviewPaths = (variant) => TIMED_ROW_IDS.map(
  (id) => `qa/official-previews-${variant}/${id}.gif`,
);

const EXPECTED_DIRECTIONS = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
  angle: index * 22.5,
  row: index < 8 ? 9 : 10,
  column: index % 8,
  frame: `gaze-${Number.isInteger(index * 22.5)
    ? String(index * 22.5).padStart(3, "0")
    : String(index * 22.5)}`,
})));

const finalReviewArtifactPaths = (variant) => Object.freeze([
  VARIANTS[variant].atlasPath,
  VARIANTS[variant].authoringAtlasPath,
  VARIANTS[variant].animatedReportPath,
  `qa/contact-sheet-${variant}.png`,
  `qa/look-directions-${variant}.png`,
  `qa/runtime-continuity-${variant}.json`,
  ...runtimePreviewPaths(variant),
  `preview/source-lab/state-atlas-${variant}.webp`,
  `preview/source-lab/state-contact-${variant}.png`,
  `preview/source-lab/effect-transitions-${variant}.webp`,
  `preview/source-lab/effect-transitions-${variant}.png`,
  "preview/source-lab/motion/manifest.json",
  ...SOURCE_EFFECTS.map((effect) => `preview/source-lab/motion/${variant}/${effect}.webp`),
  "qa/official-hatch-qa.json",
  "qa/codex-default-dpr2-browser-oracle.json",
  "qa/codex-default-dpr2-browser-oracle.png",
  "qa/codex-default-dpr2-browser-oracle-map.bin",
  "qa/arbitrary-phase-baselines.json.gz",
  "qa/arbitrary-phase-qa.json",
  "qa/exhaustive-edge-qa.json",
]);

const VARIANTS = Object.freeze({
  dark: Object.freeze({
    id: "grok-bot-dark",
    displayName: "Grok Bot Dark",
    atlasPath: "pet/grok-bot-dark/spritesheet.webp",
    authoringAtlasPath: "qa/authoring-atlas-dark.webp",
    animatedReportPath: "qa/animated-atlas-dark.json",
    manifestPath: "pet/grok-bot-dark/pet.json",
    bodyColor: "#FFFFFF",
    eyeColor: "#000000",
    artifactPaths: Object.freeze([
      "qa/authoring-atlas-dark.webp",
      "qa/animated-atlas-dark.json",
      "qa/validation-dark.json",
      "qa/official-validation-dark.json",
      "qa/contact-sheet-dark.png",
      "qa/look-directions-dark.png",
      "qa/look-continuity-dark.json",
      "qa/direction-semantics-dark.json",
      "qa/final-visual-review-dark.json",
      "qa/runtime-continuity-dark.json",
      "qa/official-frames-dark/manifest.json",
      ...officialPreviewPaths("dark"),
      ...runtimePreviewPaths("dark"),
    ]),
  }),
  light: Object.freeze({
    id: "grok-bot-light",
    displayName: "Grok Bot Light",
    atlasPath: "pet/grok-bot-light/spritesheet.webp",
    authoringAtlasPath: "qa/authoring-atlas-light.webp",
    animatedReportPath: "qa/animated-atlas-light.json",
    manifestPath: "pet/grok-bot-light/pet.json",
    bodyColor: "#000000",
    eyeColor: "#FFFFFF",
    artifactPaths: Object.freeze([
      "qa/authoring-atlas-light.webp",
      "qa/animated-atlas-light.json",
      "qa/validation-light.json",
      "qa/official-validation-light.json",
      "qa/contact-sheet-light.png",
      "qa/look-directions-light.png",
      "qa/look-continuity-light.json",
      "qa/direction-semantics-light.json",
      "qa/final-visual-review-light.json",
      "qa/runtime-continuity-light.json",
      "qa/official-frames-light/manifest.json",
      ...officialPreviewPaths("light"),
      ...runtimePreviewPaths("light"),
    ]),
  }),
});

const SHARED_ARTIFACT_PATHS = Object.freeze([
  "qa/animated-atlas.json",
  ...FLUID_QA_INPUT_PATHS,
  ...ANIMATED_TEMPORAL_ARTIFACT_PATHS,
  ...EXHAUSTIVE_EDGE_QA_PATHS,
  ...DEFAULT_DPR2_AND_ARBITRARY_PHASE_QA_PATHS,
  ...SOURCE_MOTION_TEMPORAL_QA_PATHS,
  "qa/theme-parity.json",
  "qa/runtime-continuity.json",
  "qa/official-hatch-qa.json",
  "preview/source-lab/state-atlas-dark.webp",
  "preview/source-lab/state-atlas-light.webp",
  "preview/source-lab/state-contact-dark.png",
  "preview/source-lab/state-contact-light.png",
  "preview/source-lab/effect-transitions-dark.webp",
  "preview/source-lab/effect-transitions-light.webp",
  "preview/source-lab/effect-transitions-dark.png",
  "preview/source-lab/effect-transitions-light.png",
  "preview/source-lab/motion/manifest.json",
  ...sourceMotionPaths,
  "qa/direction-blind-pairs.png",
  "qa/direction-blind-answer-key.json",
  "qa/direction-blind-verdict-1.json",
  "qa/direction-blind-verdict-2.json",
  "qa/direction-blind-verdict-3.json",
  "qa/direction-blind-verdict-4.json",
  "qa/direction-blind-verdict-5.json",
  "qa/direction-blind-consensus.json",
  "qa/direction-blind-validation.json",
]);

const VARIANT_NAMES = Object.freeze(Object.keys(VARIANTS));
const absolute = (relative) => path.join(root, relative);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Json = (value) => sha256(Buffer.from(JSON.stringify(value)));
const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const rgbKey = ([red, green, blue]) => (red << 16) | (green << 8) | blue;
const sourceRgbKeys = Object.freeze(
  Object.fromEntries(Object.entries(ACCENT_COLORS).map(([name, hex]) => [name, rgbKey(rgb(hex))])),
);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireArray(value, label) {
  requireCondition(Array.isArray(value), `${label} must be an array`);
}

function requireEmpty(report, field, label) {
  requireArray(report[field], `${label}.${field}`);
  requireCondition(report[field].length === 0, `${label}.${field} must be empty`);
}

function requireEmptyIfPresent(report, field, label) {
  if (report[field] === undefined) return;
  requireEmpty(report, field, label);
}

function requireArtifactPath(candidate, expectedRelative, label) {
  requireCondition(typeof candidate === "string" && candidate.length > 0, `${label} must be a path`);
  requireCondition(
    path.resolve(root, candidate) === absolute(expectedRelative),
    `${label} must resolve to ${expectedRelative}`,
  );
}

function resolveRepositoryRelativePath(rootDir, relativePath, label) {
  requireCondition(
    typeof relativePath === "string" && relativePath.length > 0,
    `${label} must be a repository-relative path`,
  );
  const absolutePath = path.resolve(rootDir, relativePath);
  const relativeFromRoot = path.relative(rootDir, absolutePath);
  requireCondition(
    !path.isAbsolute(relativePath)
      && relativeFromRoot !== ".."
      && !relativeFromRoot.startsWith(`..${path.sep}`),
    `${label} must remain inside the repository`,
  );
  return absolutePath;
}

const EXHAUSTIVE_STRUCTURAL_CSS_PATHS = Object.freeze([
  "preview/styles.css",
  "preview/index.html",
  "preview/app.mjs",
]);

export async function verifyExhaustiveStructuralCssFileHashes(
  report,
  { rootDir = root } = {},
) {
  const files = report.structuralCss?.files;
  requireCondition(
    files && typeof files === "object" && !Array.isArray(files),
    "exhaustive edge QA structural CSS file records are missing",
  );
  const records = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  const recordedPaths = records.map(([relativePath]) => relativePath).sort();
  const expectedPaths = [...EXHAUSTIVE_STRUCTURAL_CSS_PATHS].sort();
  requireCondition(
    deepEqual(recordedPaths, expectedPaths),
    `exhaustive edge QA structural CSS file set must be exactly ${EXHAUSTIVE_STRUCTURAL_CSS_PATHS.join(", ")}`,
  );
  for (const [relativePath, record] of records) {
    requireSha256(record?.sha256, `exhaustive edge QA structural CSS ${relativePath} SHA-256`);
    const currentSha256 = sha256(await readFile(resolveRepositoryRelativePath(
      rootDir,
      relativePath,
      `exhaustive edge QA structural CSS ${relativePath}`,
    )));
    requireCondition(
      currentSha256 === record.sha256,
      `exhaustive edge QA structural CSS SHA is stale for ${relativePath}`,
    );
  }
  return records.map(([relativePath, { sha256: expectedSha256 }]) => ({
    relativePath,
    expectedSha256,
  }));
}

function requireArtifactSuffix(candidate, expectedRelative, label) {
  requireCondition(typeof candidate === "string" && candidate.length > 0, `${label} must be a path`);
  const normalized = candidate.replaceAll("\\", "/");
  requireCondition(
    normalized === expectedRelative || normalized.endsWith(`/${expectedRelative}`),
    `${label} must end with ${expectedRelative}`,
  );
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return deepEqual(leftKeys, rightKeys)
      && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

const ANIMATED_TIMED_ROWS = Object.freeze(Array.from({ length: 9 }, (_, row) => row));
const ANIMATED_ACTION_ROWS = Object.freeze(Array.from({ length: 8 }, (_, index) => index + 1));
const ANIMATED_GAZE_ELIGIBLE_ROWS = Object.freeze([0, 3, 7]);
const ANIMATED_GAZE_ANGLES = Object.freeze(Array.from({ length: 16 }, (_, direction) => direction * 22.5));
const ANIMATED_SEQUENCE_METRICS = Object.freeze([
  "silhouetteIou",
  "silhouetteCentroidDistancePx",
  "normalizedAlphaDiff",
  "alphaAreaRatioSymmetric",
]);

function animatedGazeDirectionsAdjacent(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 16 - distance) === 1;
}

function expectedAnimatedSamePhaseIds(page) {
  return {
    actionToIdle: ANIMATED_ACTION_ROWS.map((row) => `p${page}-r${row}c0-to-idle`),
    gazeTimedBoundaries: ANIMATED_TIMED_ROWS.flatMap((row) => (
      ANIMATED_GAZE_ANGLES.map((angle) => `p${page}-r${row}c0-to-gaze-${angle}deg`)
    )),
    timedRowPairs: ANIMATED_TIMED_ROWS.flatMap((fromRow, fromIndex) => (
      ANIMATED_TIMED_ROWS.slice(fromIndex + 1).map((toRow) => (
        `p${page}-timed-r${fromRow}-to-r${toRow}`
      ))
    )),
    gazeNeighborPairs: ANIMATED_GAZE_ANGLES.map((angle, direction) => (
      `p${page}-gaze-${angle}-to-${ANIMATED_GAZE_ANGLES[(direction + 1) % 16]}deg`
    )),
    gazeBodyPairs: ANIMATED_GAZE_ANGLES.flatMap((fromAngle, fromDirection) => (
      ANIMATED_GAZE_ANGLES.slice(fromDirection + 1).map((toAngle) => (
        `p${page}-gaze-body-${fromAngle}-to-${toAngle}deg`
      ))
    )),
  };
}

function expectedAnimatedCrossPhaseIds(fromPage, toPage) {
  const prefix = `p${fromPage}-to-p${toPage}-`;
  return {
    timedRowChanges: ANIMATED_TIMED_ROWS.flatMap((fromRow) => (
      ANIMATED_TIMED_ROWS.filter((toRow) => toRow !== fromRow).map((toRow) => (
        `${prefix}timed-r${fromRow}-to-r${toRow}`
      ))
    )),
    gazeNeighborChanges: ANIMATED_GAZE_ANGLES.flatMap((angle, direction) => {
      const nextAngle = ANIMATED_GAZE_ANGLES[(direction + 1) % 16];
      return [
        `${prefix}gaze-${angle}-to-${nextAngle}deg`,
        `${prefix}gaze-${nextAngle}-to-${angle}deg`,
      ];
    }),
    gazeToTimed: ANIMATED_GAZE_ANGLES.flatMap((angle) => (
      ANIMATED_TIMED_ROWS.map((toRow) => `${prefix}gaze-${angle}-to-r${toRow}`)
    )),
    eligibleTimedToGaze: ANIMATED_GAZE_ELIGIBLE_ROWS.flatMap((fromRow) => (
      ANIMATED_GAZE_ANGLES.map((angle) => `${prefix}r${fromRow}-to-gaze-${angle}deg`)
    )),
    gazeBodyNonNeighborChanges: ANIMATED_GAZE_ANGLES.flatMap((fromAngle, fromDirection) => (
      ANIMATED_GAZE_ANGLES
        .filter((_, toDirection) => (
          toDirection !== fromDirection
          && !animatedGazeDirectionsAdjacent(fromDirection, toDirection)
        ))
        .map((toAngle) => `${prefix}gaze-body-${fromAngle}-to-${toAngle}deg`)
    )),
  };
}

function expectedAnimatedGazePairKeys({ directed, nonNeighborOnly }) {
  return ANIMATED_GAZE_ANGLES.flatMap((fromAngle, fromDirection) => (
    ANIMATED_GAZE_ANGLES.flatMap((toAngle, toDirection) => {
      if (toDirection === fromDirection) return [];
      if (!directed && toDirection <= fromDirection) return [];
      if (nonNeighborOnly && animatedGazeDirectionsAdjacent(fromDirection, toDirection)) return [];
      return [`${fromAngle}->${toAngle}`];
    })
  ));
}

function verifyAnimatedMembershipRecord(record, expectedIds, label) {
  requireCondition(
    record?.ok === true
      && record.expectedCount === expectedIds.length
      && record.actualCount === expectedIds.length
      && record.orderedExactly === true,
    `${label} exact ordered membership failed`,
  );
  for (const field of ["duplicateIds", "missingIds", "unexpectedIds"]) {
    requireEmpty(record, field, label);
  }
  const expectedHash = sha256Json(expectedIds);
  requireSha256(record.expectedIdsSha256, `${label}.expectedIdsSha256`);
  requireSha256(record.actualIdsSha256, `${label}.actualIdsSha256`);
  requireCondition(
    record.expectedIdsSha256 === expectedHash && record.actualIdsSha256 === expectedHash,
    `${label} hashes do not bind the independently recomputed IDs`,
  );
}

function verifyAnimatedPhaseMembership(membership, label) {
  requireCondition(
    membership?.ok === true
      && membership.phaseCount === ANIMATED_ATLAS_FRAME_COUNT,
    `${label} phase membership summary is incomplete`,
  );
  requireArray(membership.phases, `${label}.phases`);
  requireCondition(membership.phases.length === ANIMATED_ATLAS_FRAME_COUNT, `${label} phase coverage is incomplete`);
  for (const [page, phase] of membership.phases.entries()) {
    requireCondition(phase.page === page && phase.ok === true, `${label} page ${page} is missing or failing`);
    const expected = expectedAnimatedSamePhaseIds(page);
    for (const field of Object.keys(expected)) {
      verifyAnimatedMembershipRecord(phase[field], expected[field], `${label} p${page}.${field}`);
    }
  }
}

function verifyAnimatedWindowMembership(membership, label) {
  requireCondition(
    membership?.ok === true
      && membership.windowCount === ANIMATED_ATLAS_FRAME_COUNT,
    `${label} window membership summary is incomplete`,
  );
  requireArray(membership.windows, `${label}.windows`);
  requireCondition(membership.windows.length === ANIMATED_ATLAS_FRAME_COUNT, `${label} window coverage is incomplete`);
  for (const [fromPage, window] of membership.windows.entries()) {
    const toPage = (fromPage + 1) % ANIMATED_ATLAS_FRAME_COUNT;
    requireCondition(
      window.fromPage === fromPage
        && window.toPage === toPage
        && window.seam === (fromPage === ANIMATED_ATLAS_FRAME_COUNT - 1)
        && window.ok === true,
      `${label} p${fromPage}->p${toPage} is missing or failing`,
    );
    const expected = expectedAnimatedCrossPhaseIds(fromPage, toPage);
    for (const field of Object.keys(expected)) {
      verifyAnimatedMembershipRecord(window[field], expected[field], `${label} p${fromPage}->p${toPage}.${field}`);
    }
  }
}

function verifyAnimatedPairPhaseStability(phaseStability, {
  label,
  gate,
  directed,
  pairUniverseNonNeighborOnly = directed,
  pairCount,
  adjacentPairCount,
  nonNeighborPairCount,
  nonNeighborTransitionCount,
  nonNeighborPairKeysSha256,
}) {
  const expectedPairs = expectedAnimatedGazePairKeys({
    directed,
    nonNeighborOnly: pairUniverseNonNeighborOnly,
  });
  const expectedNonNeighborPairs = expectedAnimatedGazePairKeys({ directed, nonNeighborOnly: true });
  requireCondition(
    expectedPairs.length === pairCount
      && expectedNonNeighborPairs.length === nonNeighborPairCount
      && sha256Json(expectedNonNeighborPairs) === nonNeighborPairKeysSha256,
    `${label} independent pair contract is internally inconsistent`,
  );
  requireCondition(
    phaseStability?.ok === true
      && deepEqual(phaseStability.gate, gate)
      && phaseStability.pairCount === pairCount
      && phaseStability.transitionCount === pairCount * ANIMATED_ATLAS_FRAME_COUNT
      && phaseStability.adjacentPairCount === adjacentPairCount
      && phaseStability.nonNeighborPairCount === nonNeighborPairCount
      && phaseStability.nonNeighborTransitionCount === nonNeighborTransitionCount
      && phaseStability.failingPairCount === 0,
    `${label} summary is incomplete or failing`,
  );
  requireEmpty(phaseStability, "failingPairKeys", label);
  requireArray(phaseStability.nonNeighborPairKeys, `${label}.nonNeighborPairKeys`);
  requireCondition(
    deepEqual(phaseStability.nonNeighborPairKeys, expectedNonNeighborPairs)
      && phaseStability.nonNeighborPairKeysSha256 === nonNeighborPairKeysSha256,
    `${label} non-neighbor pair keys are incomplete or stale`,
  );
  requireArray(phaseStability.pairs, `${label}.pairs`);
  requireCondition(
    deepEqual(phaseStability.pairs.map(({ key }) => key), expectedPairs),
    `${label} pair identities or order differ from the independent contract`,
  );
  for (const pair of phaseStability.pairs) {
    const pairLabel = `${label} ${pair.key}`;
    requireCondition(
      pair.complete === true
        && pair.phaseCount === ANIMATED_ATLAS_FRAME_COUNT
        && pair.ok === true,
      `${pairLabel} phase sequence is incomplete or failing`,
    );
    requireEmpty(pair, "flags", pairLabel);
    for (const metric of ANIMATED_SEQUENCE_METRICS) {
      const evidence = pair.metrics?.[metric];
      const pairRange = evidence?.maximum - evidence?.minimum;
      requireCondition(
        Number.isFinite(evidence?.minimum)
          && Number.isFinite(evidence?.maximum)
          && evidence.minimum <= evidence.maximum
          && Number.isFinite(evidence?.maximumAdjacentStep)
          && Number.isFinite(evidence?.maximumSecondDifferenceResidual)
          && Number.isFinite(pairRange)
          && evidence.maximumAdjacentStep <= gate.maximumAdjacentStep[metric]
          && evidence.maximumSecondDifferenceResidual
            <= gate.maximumSecondDifferenceResidual[metric]
          && pairRange <= gate.maximumPairRange[metric]
          && evidence?.pairRangePasses === true
          && evidence?.adjacentPasses === true
          && evidence?.secondDifferencePasses === true,
        `${pairLabel} ${metric} numeric step, residual, or range exceeds its frozen gate`,
      );
      requireSha256(evidence.sequenceSha256, `${pairLabel}.${metric}.sequenceSha256`);
    }
    requireSha256(pair.canonicalMetricSequenceSha256, `${pairLabel}.canonicalMetricSequenceSha256`);
  }
  const canonicalHash = sha256Json(
    phaseStability.pairs.map(({ key, canonicalMetricSequenceSha256 }) => ({ key, canonicalMetricSequenceSha256 })),
  );
  requireSha256(phaseStability.canonicalPairSequenceSha256, `${label}.canonicalPairSequenceSha256`);
  requireCondition(
    phaseStability.canonicalPairSequenceSha256 === canonicalHash,
    `${label} canonical pair sequence hash is stale`,
  );
}

const ANIMATED_112_HOST_METRICS = Object.freeze([
  "silhouetteIou",
  "silhouetteCentroidDistancePx",
  "normalizedRgbaDiff",
  "normalizedAlphaDiff",
  "changedPixelFraction",
  "changedAlphaPixelFraction",
  "alphaAreaRatioSymmetric",
  "perceptualRms",
  "stronglyChangedCellFraction",
]);
const ANIMATED_HOST_TRACE_METRICS = Object.freeze([
  "alphaAreaRatioSymmetric",
  "changedAlphaPixelFraction",
  "changedPixelFraction",
  "featureInkCentroidMaterial",
  "featureInkCentroidStepPx",
  "featureInkMassStepFraction",
  "featureInkMaterial",
  "featureInkVariationFraction",
  "fromFeatureInkMass",
  "fromSilhouettePixels",
  "localEnergyRatio",
  "maximumChannelDelta",
  "normalizedAlphaDiff",
  "normalizedRgbaDiff",
  "perceptualRms",
  "silhouetteCentroidDistancePx",
  "silhouetteIou",
  "stronglyChangedCellFraction",
  "toFeatureInkMass",
  "toSilhouettePixels",
]);
const ANIMATED_HOST_TRACE_BOOLEAN_METRICS = Object.freeze(new Set([
  "featureInkCentroidMaterial",
  "featureInkMaterial",
]));

function expectedAnimatedDisplayed112HostIds() {
  const groups = {
    samePhaseTimedRowPairs: [],
    samePhaseEligibleTimedToGaze: [],
    samePhaseOtherTimedToGaze: [],
    samePhaseAdjacentGaze: [],
    crossPhaseTimedRowChanges: [],
    crossPhaseAdjacentGaze: [],
    crossPhaseGazeToEligibleTimed: [],
    crossPhaseGazeToOtherTimed: [],
    crossPhaseEligibleTimedToGaze: [],
  };
  const samePhaseNonNeighborGaze = [];
  const crossPhaseNonNeighborGaze = [];
  for (let page = 0; page < ANIMATED_ATLAS_FRAME_COUNT; page += 1) {
    const same = expectedAnimatedSamePhaseIds(page);
    const cross = expectedAnimatedCrossPhaseIds(
      page,
      (page + 1) % ANIMATED_ATLAS_FRAME_COUNT,
    );
    groups.samePhaseTimedRowPairs.push(...same.timedRowPairs);
    groups.samePhaseEligibleTimedToGaze.push(...same.gazeTimedBoundaries.filter((id) => (
      ANIMATED_GAZE_ELIGIBLE_ROWS.some((row) => id.startsWith(`p${page}-r${row}c0-`))
    )));
    groups.samePhaseOtherTimedToGaze.push(...same.gazeTimedBoundaries.filter((id) => (
      !ANIMATED_GAZE_ELIGIBLE_ROWS.some((row) => id.startsWith(`p${page}-r${row}c0-`))
    )));
    groups.samePhaseAdjacentGaze.push(...same.gazeNeighborPairs);
    samePhaseNonNeighborGaze.push(...same.gazeBodyPairs.filter((id) => {
      const match = id.match(/gaze-body-([\d.]+)-to-([\d.]+)deg$/u);
      return match
        && !animatedGazeDirectionsAdjacent(Number(match[1]) / 22.5, Number(match[2]) / 22.5);
    }));

    groups.crossPhaseTimedRowChanges.push(...cross.timedRowChanges);
    groups.crossPhaseAdjacentGaze.push(...cross.gazeNeighborChanges);
    groups.crossPhaseGazeToEligibleTimed.push(...cross.gazeToTimed.filter((id) => (
      ANIMATED_GAZE_ELIGIBLE_ROWS.some((row) => id.endsWith(`-to-r${row}`))
    )));
    groups.crossPhaseGazeToOtherTimed.push(...cross.gazeToTimed.filter((id) => (
      ANIMATED_TIMED_ROWS.some((row) => (
        !ANIMATED_GAZE_ELIGIBLE_ROWS.includes(row) && id.endsWith(`-to-r${row}`)
      ))
    )));
    groups.crossPhaseEligibleTimedToGaze.push(...cross.eligibleTimedToGaze);
    crossPhaseNonNeighborGaze.push(...cross.gazeBodyNonNeighborChanges);
  }
  return { groups, samePhaseNonNeighborGaze, crossPhaseNonNeighborGaze };
}

function animatedTransitionPhaseMetadata(id) {
  const cellPhaseMatch = id.match(/^r\d+c\d+:p(\d+)->p(\d+)$/u);
  const crossPhaseMatch = id.match(/^p(\d+)-to-p(\d+)-/u);
  const samePhaseMatch = id.match(/^p(\d+)-/u);
  const fromPage = Number(cellPhaseMatch?.[1] ?? crossPhaseMatch?.[1] ?? samePhaseMatch?.[1]);
  const toPage = Number(cellPhaseMatch?.[2] ?? crossPhaseMatch?.[2] ?? samePhaseMatch?.[1]);
  return {
    fromPage,
    toPage,
    seam: fromPage !== toPage && toPage === 0,
  };
}

function verifyAnimatedHostTraceSetting(setting, expectedIdSet, metric, label) {
  requireCondition(
    setting
      && expectedIdSet.has(setting.id)
      && Number.isFinite(setting.value),
    `${label} does not identify a measured transition`,
  );
  const phase = animatedTransitionPhaseMetadata(setting.id);
  requireCondition(
    setting.fromPage === phase.fromPage && setting.toPage === phase.toPage,
    `${label} phase metadata changed`,
  );
  return setting.value;
}

function verifyAnimatedHostTrace(trace, expectedIds, label, { maximumObserved = null } = {}) {
  requireCondition(
    trace?.recordCount === expectedIds.length
      && trace.worstPerMetric === 5,
    `${label} record count or worst-case depth is incomplete`,
  );
  requireSha256(trace.orderedIdsSha256, `${label}.orderedIdsSha256`);
  requireSha256(trace.orderedFullRecordSha256, `${label}.orderedFullRecordSha256`);
  requireCondition(
    trace.orderedIdsSha256 === sha256Json(expectedIds),
    `${label} does not bind the independently recomputed ordered IDs`,
  );
  requireEmpty(trace, "failingTransitionIds", label);
  requireCondition(
    deepEqual(trace.metricNames, ANIMATED_HOST_TRACE_METRICS)
      && trace.metricNamesSha256 === sha256Json(ANIMATED_HOST_TRACE_METRICS)
      && deepEqual(Object.keys(trace.metricExtrema ?? {}).sort(), [...ANIMATED_HOST_TRACE_METRICS]),
    `${label} does not bind the exact trace metric set`,
  );
  requireCondition(
    deepEqual(Object.keys(trace.worstByMetric ?? {}).sort(), [...ANIMATED_HOST_TRACE_METRICS]),
    `${label}.worstByMetric does not cover the exact trace metric set`,
  );
  const expectedIdSet = new Set(expectedIds);
  for (const metric of ANIMATED_HOST_TRACE_METRICS) {
    const extrema = trace.metricExtrema[metric];
    const worst = trace.worstByMetric[metric];
    requireArray(worst, `${label}.worstByMetric.${metric}`);
    if (ANIMATED_HOST_TRACE_BOOLEAN_METRICS.has(metric)) {
      requireCondition(
        deepEqual(extrema, { minimum: null, maximum: null }) && worst.length === 0,
        `${label}.${metric} should not claim numeric extrema for Boolean evidence`,
      );
      continue;
    }
    const minimum = verifyAnimatedHostTraceSetting(
      extrema?.minimum,
      expectedIdSet,
      metric,
      `${label}.metricExtrema.${metric}.minimum`,
    );
    const maximum = verifyAnimatedHostTraceSetting(
      extrema?.maximum,
      expectedIdSet,
      metric,
      `${label}.metricExtrema.${metric}.maximum`,
    );
    requireCondition(minimum <= maximum, `${label}.${metric} extrema are inverted`);
    requireCondition(
      worst.length === Math.min(trace.worstPerMetric, expectedIds.length),
      `${label}.${metric} worst-case list is incomplete`,
    );
    const worstValues = worst.map((setting, index) => verifyAnimatedHostTraceSetting(
      setting,
      expectedIdSet,
      metric,
      `${label}.worstByMetric.${metric}[${index}]`,
    ));
    requireCondition(
      new Set(worst.map(({ id }) => id)).size === worst.length,
      `${label}.${metric} worst-case IDs must be unique`,
    );
    const ascending = metric === "silhouetteIou";
    requireCondition(
      worstValues.every((value, index) => (
        index === 0 || (ascending ? worstValues[index - 1] <= value : worstValues[index - 1] >= value)
      )),
      `${label}.${metric} worst-case list order changed`,
    );
    requireCondition(
      worstValues[0] === (ascending ? minimum : maximum),
      `${label}.${metric} worst-case list does not begin at its measured extremum`,
    );
    if (maximumObserved && ANIMATED_112_HOST_METRICS.includes(metric)) {
      requireCondition(
        maximumObserved[metric] === (ascending ? minimum : maximum),
        `${label}.${metric} trace disagrees with the gate summary`,
      );
    }
  }
}

function expectedAnimatedCellTransitionIds(cellKey) {
  return Array.from({ length: ANIMATED_ATLAS_FRAME_COUNT }, (_, fromPage) => (
    `${cellKey}:p${fromPage}->p${(fromPage + 1) % ANIMATED_ATLAS_FRAME_COUNT}`
  ));
}

function expectedAnimatedCellIsolatedFrameIds(cellKey) {
  return Array.from({ length: ANIMATED_ATLAS_FRAME_COUNT }, (_, page) => `${cellKey}:p${page}`);
}

function verifyAnimatedIsolatedFrameTrace(trace, expectedIds, label) {
  requireCondition(trace?.recordCount === expectedIds.length, `${label} record count is incomplete`);
  requireSha256(trace.orderedIdsSha256, `${label}.orderedIdsSha256`);
  requireSha256(trace.orderedFullRecordSha256, `${label}.orderedFullRecordSha256`);
  requireCondition(
    trace.orderedIdsSha256 === sha256Json(expectedIds),
    `${label} does not bind the independently recomputed ordered frame IDs`,
  );
  requireEmpty(trace, "failingFrameIds", label);
}

function verifyAnimatedTraceExtremaAgainstGate(trace, gate, label) {
  for (const [metric, gateField, lowerBound] of [
    ["silhouetteIou", "minimumSilhouetteIou", true],
    ["silhouetteCentroidDistancePx", "maximumSilhouetteCentroidDistancePx", false],
    ["normalizedRgbaDiff", "maximumNormalizedRgbaDiff", false],
    ["normalizedAlphaDiff", "maximumNormalizedAlphaDiff", false],
    ["changedPixelFraction", "maximumChangedPixelFraction", false],
    ["changedAlphaPixelFraction", "maximumChangedAlphaPixelFraction", false],
    ["alphaAreaRatioSymmetric", "maximumAlphaAreaRatioSymmetric", false],
    ["perceptualRms", "maximumPerceptualRms", false],
    ["stronglyChangedCellFraction", "maximumStronglyChangedCellFraction", false],
  ]) {
    if (!Number.isFinite(gate?.[gateField])) continue;
    const observed = trace.metricExtrema?.[metric]?.[lowerBound ? "minimum" : "maximum"]?.value;
    requireCondition(
      Number.isFinite(observed) && (lowerBound ? observed >= gate[gateField] : observed <= gate[gateField]),
      `${label}.${metric} exceeds its frozen gate`,
    );
  }
}

function verifyAnimatedDisplayed112HostGroup(group, expectedIds, gateKind, label) {
  const gate = ANIMATED_112_HOST_BOUNDARY_GATES[gateKind];
  requireCondition(
    group?.gateKind === gateKind
      && deepEqual(group.gate, gate)
      && group.count === expectedIds.length
      && group.passing === expectedIds.length
      && group.failing === 0,
    `${label} summary is incomplete, changed, or failing`,
  );
  verifyAnimatedMembershipRecord(group.membership, expectedIds, `${label}.membership`);
  requireEmpty(group, "failingTransitionIds", label);
  verifyAnimatedHostTrace(group.trace, expectedIds, `${label}.trace`, {
    maximumObserved: group.maximumObserved,
  });
  requireCondition(
    deepEqual(group.failingTransitionIds, group.trace.failingTransitionIds),
    `${label} failure IDs disagree with the full trace`,
  );
  for (const [metric, gateField] of [
    ["silhouetteIou", "minimumSilhouetteIou"],
    ["silhouetteCentroidDistancePx", "maximumSilhouetteCentroidDistancePx"],
    ["normalizedRgbaDiff", "maximumNormalizedRgbaDiff"],
    ["normalizedAlphaDiff", "maximumNormalizedAlphaDiff"],
    ["changedPixelFraction", "maximumChangedPixelFraction"],
    ["changedAlphaPixelFraction", "maximumChangedAlphaPixelFraction"],
    ["alphaAreaRatioSymmetric", "maximumAlphaAreaRatioSymmetric"],
    ["perceptualRms", "maximumPerceptualRms"],
    ["stronglyChangedCellFraction", "maximumStronglyChangedCellFraction"],
  ]) {
    requireCondition(
      metric === "silhouetteIou"
        ? group.maximumObserved[metric] >= gate[gateField]
        : group.maximumObserved[metric] <= gate[gateField],
      `${label}.${metric} exceeds its exact gate`,
    );
  }
  requireSha256(
    group.canonicalAlphaSilhouetteSequenceSha256,
    `${label}.canonicalAlphaSilhouetteSequenceSha256`,
  );
}

function verifyAnimatedDisplayed112HostSupplement(supplement, expectedIds, {
  label,
  gate,
  directed,
  pairUniverseNonNeighborOnly = true,
  pairCount,
  adjacentPairCount = 0,
  nonNeighborPairCount = pairCount,
  pairKeysSha256,
}) {
  requireCondition(
    supplement?.transitionCount === expectedIds.length,
    `${label} transition count is incomplete`,
  );
  verifyAnimatedMembershipRecord(supplement.membership, expectedIds, `${label}.membership`);
  verifyAnimatedHostTrace(supplement.trace, expectedIds, `${label}.trace`);
  verifyAnimatedPairPhaseStability(supplement.phaseStability, {
    label: `${label}.phaseStability`,
    gate,
    directed,
    pairUniverseNonNeighborOnly,
    pairCount,
    adjacentPairCount,
    nonNeighborPairCount,
    nonNeighborTransitionCount: expectedIds.length,
    nonNeighborPairKeysSha256: pairKeysSha256,
  });
}

const ANIMATED_SOURCE_HOST_GROUP_GATES = Object.freeze({
  samePhaseTimedRowPairs: "timedRowPair",
  samePhaseEligibleTimedToGaze: "gazeEntry",
  samePhaseOtherTimedToGaze: "gazeTimedBoundary",
  samePhaseAdjacentGaze: "adjacentGazeSector",
  crossPhaseTimedRowChanges: "timedRowCrossPhase",
  crossPhaseAdjacentGaze: "adjacentGazeSector",
  crossPhaseGazeToEligibleTimed: "gazeEntry",
  crossPhaseGazeToOtherTimed: "gazeTimedBoundary",
  crossPhaseEligibleTimedToGaze: "gazeEntry",
});

function verifyAnimatedSourceHostGroup(group, expectedIds, groupKey, label) {
  const gateKind = ANIMATED_SOURCE_HOST_GROUP_GATES[groupKey];
  const gate = ANIMATED_SAME_PHASE_TRANSITION_GATES[gateKind];
  requireCondition(
    gate
      && group?.gateKind === gateKind
      && deepEqual(group.gate, gate)
      && group.count === expectedIds.length
      && group.passing === expectedIds.length
      && group.failing === 0,
    `${label} summary is incomplete, changed, or failing`,
  );
  verifyAnimatedMembershipRecord(group.membership, expectedIds, `${label}.membership`);
  verifyAnimatedHostTrace(group.trace, expectedIds, `${label}.trace`);
  verifyAnimatedTraceExtremaAgainstGate(group.trace, gate, `${label}.trace`);
  const expectedSummary = {
    count: expectedIds.length,
    passing: expectedIds.length,
    minimumSilhouetteIou: group.trace.metricExtrema.silhouetteIou.minimum.value,
    maximumSilhouetteCentroidDistancePx:
      group.trace.metricExtrema.silhouetteCentroidDistancePx.maximum.value,
    maximumNormalizedRgbaDiff: group.trace.metricExtrema.normalizedRgbaDiff.maximum.value,
    maximumNormalizedAlphaDiff: group.trace.metricExtrema.normalizedAlphaDiff.maximum.value,
    maximumChangedPixelFraction: group.trace.metricExtrema.changedPixelFraction.maximum.value,
    maximumChangedAlphaPixelFraction:
      group.trace.metricExtrema.changedAlphaPixelFraction.maximum.value,
    maximumAlphaAreaRatioSymmetric:
      group.trace.metricExtrema.alphaAreaRatioSymmetric.maximum.value,
  };
  requireCondition(
    deepEqual(group.summary, expectedSummary),
    `${label} maxima summary disagrees with the full trace`,
  );
  requireCondition(
    deepEqual(group.failingTransitionIds, group.trace.failingTransitionIds),
    `${label} failure IDs disagree with the full trace`,
  );
  requireEmpty(group, "failingTransitionIds", label);
  requireSha256(
    group.canonicalAlphaSilhouetteSequenceSha256,
    `${label}.canonicalAlphaSilhouetteSequenceSha256`,
  );
}

function verifyAnimatedSourceHostBoundaries(host, label) {
  const expected = expectedAnimatedDisplayed112HostIds();
  const expectedCoreIds = Object.values(expected.groups).flat();
  requireCondition(
    host?.ok === true
      && host.sampling === "decoded 192x208 source cells before authoritative host scaling"
      && deepEqual(host.gates, ANIMATED_SAME_PHASE_TRANSITION_GATES)
      && host.core?.transitionCount === expectedCoreIds.length
      && host.core?.expectedTransitionCount === expectedCoreIds.length
      && host.core?.passingTransitionCount === expectedCoreIds.length
      && host.core?.failingTransitionCount === 0,
    `${label} contract or core summary is incomplete, changed, or failing`,
  );
  requireCondition(
    deepEqual(Object.keys(host.core.groups ?? {}), Object.keys(expected.groups)),
    `${label} core group set changed`,
  );
  for (const [groupKey, expectedIds] of Object.entries(expected.groups)) {
    verifyAnimatedSourceHostGroup(
      host.core.groups[groupKey],
      expectedIds,
      groupKey,
      `${label}.core.groups.${groupKey}`,
    );
  }
  verifyAnimatedDisplayed112HostSupplement(
    host.supplemental?.samePhaseNonNeighborGaze,
    expected.samePhaseNonNeighborGaze,
    {
      label: `${label}.supplemental.samePhaseNonNeighborGaze`,
      gate: ANIMATED_GAZE_BODY_PHASE_STABILITY_GATE,
      directed: false,
      pairUniverseNonNeighborOnly: false,
      pairCount: 120,
      adjacentPairCount: 16,
      nonNeighborPairCount: 104,
      pairKeysSha256: ANIMATED_SAME_NON_NEIGHBOR_PAIR_KEYS_SHA256,
    },
  );
  verifyAnimatedDisplayed112HostSupplement(
    host.supplemental?.crossPhaseNonNeighborGaze,
    expected.crossPhaseNonNeighborGaze,
    {
      label: `${label}.supplemental.crossPhaseNonNeighborGaze`,
      gate: ANIMATED_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      directed: true,
      pairCount: 208,
      pairKeysSha256: ANIMATED_CROSS_NON_NEIGHBOR_PAIR_KEYS_SHA256,
    },
  );
  const allExpectedIds = [
    ...expectedCoreIds,
    ...expected.samePhaseNonNeighborGaze,
    ...expected.crossPhaseNonNeighborGaze,
  ];
  requireCondition(
    host.totalUniqueTransitionCount === allExpectedIds.length
      && host.expectedTotalUniqueTransitionCount === allExpectedIds.length,
    `${label} total unique transition count is incomplete`,
  );
  verifyAnimatedMembershipRecord(host.membership, allExpectedIds, `${label}.membership`);
  verifyAnimatedHostTrace(
    host.orderedFullRecordTrace,
    allExpectedIds,
    `${label}.orderedFullRecordTrace`,
  );
  const coreFailureIds = Object.values(host.core.groups).flatMap((group) => (
    group.trace.failingTransitionIds
  ));
  requireCondition(
    deepEqual(host.failingTransitionIds, coreFailureIds)
      && deepEqual(host.orderedFullRecordTrace.failingTransitionIds, coreFailureIds),
    `${label} top-level, group, and full-trace failure IDs disagree`,
  );
  requireEmpty(host, "failingTransitionIds", label);
  const expectedCanonicalHash = sha256Json({
    groups: Object.fromEntries(Object.entries(host.core.groups).map(([key, group]) => (
      [key, group.canonicalAlphaSilhouetteSequenceSha256]
    ))),
    samePhaseNonNeighborGaze:
      host.supplemental.samePhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256,
    crossPhaseNonNeighborGaze:
      host.supplemental.crossPhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256,
  });
  requireSha256(
    host.canonicalAlphaSilhouetteSequenceSha256,
    `${label}.canonicalAlphaSilhouetteSequenceSha256`,
  );
  requireCondition(
    host.canonicalAlphaSilhouetteSequenceSha256 === expectedCanonicalHash,
    `${label} canonical alpha/silhouette hash is stale`,
  );
}

function verifyAnimatedDisplayed112HostBoundaries(host, label) {
  const expected = expectedAnimatedDisplayed112HostIds();
  requireCondition(
    host?.ok === true
      && deepEqual(host.display, ANIMATED_112_DISPLAY)
      && host.sampling === "authoritative Chromium DPR2 pixelated host background lattice"
      && deepEqual(host.gates, ANIMATED_112_HOST_BOUNDARY_GATES)
      && deepEqual(
        host.gazeBodyPhaseStabilityGate,
        ANIMATED_112_HOST_GAZE_BODY_PHASE_STABILITY_GATE,
      )
      && deepEqual(
        host.gazeBodyCrossPhaseStabilityGate,
        ANIMATED_112_HOST_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      ),
    `${label} display, sampler, or gate contract changed`,
  );
  const expectedGroupCounts = Object.fromEntries(
    Object.entries(expected.groups).map(([key, ids]) => [key, ids.length]),
  );
  requireCondition(
    deepEqual(expectedGroupCounts, {
      samePhaseTimedRowPairs: 36 * ANIMATED_ATLAS_FRAME_COUNT,
      samePhaseEligibleTimedToGaze: 48 * ANIMATED_ATLAS_FRAME_COUNT,
      samePhaseOtherTimedToGaze: 96 * ANIMATED_ATLAS_FRAME_COUNT,
      samePhaseAdjacentGaze: 16 * ANIMATED_ATLAS_FRAME_COUNT,
      crossPhaseTimedRowChanges: 72 * ANIMATED_ATLAS_FRAME_COUNT,
      crossPhaseAdjacentGaze: 32 * ANIMATED_ATLAS_FRAME_COUNT,
      crossPhaseGazeToEligibleTimed: 48 * ANIMATED_ATLAS_FRAME_COUNT,
      crossPhaseGazeToOtherTimed: 96 * ANIMATED_ATLAS_FRAME_COUNT,
      crossPhaseEligibleTimedToGaze: 48 * ANIMATED_ATLAS_FRAME_COUNT,
    }),
    `${label} independent core group contract is internally inconsistent`,
  );
  const expectedCoreCount = Object.values(expectedGroupCounts).reduce((sum, count) => sum + count, 0);
  requireCondition(
    host.core?.transitionCount === expectedCoreCount
      && host.core?.expectedTransitionCount === expectedCoreCount
      && host.core?.passingTransitionCount === expectedCoreCount
      && host.core?.failingTransitionCount === 0,
    `${label} core summary is incomplete or failing`,
  );
  for (const [gateKind, expectedIds] of Object.entries(expected.groups)) {
    verifyAnimatedDisplayed112HostGroup(
      host.core.groups?.[gateKind],
      expectedIds,
      gateKind,
      `${label}.core.groups.${gateKind}`,
    );
  }
  requireCondition(
    deepEqual(Object.keys(host.core.groups ?? {}), Object.keys(expected.groups)),
    `${label} core group set changed`,
  );
  verifyAnimatedDisplayed112HostSupplement(
    host.supplemental?.samePhaseNonNeighborGaze,
    expected.samePhaseNonNeighborGaze,
    {
      label: `${label}.supplemental.samePhaseNonNeighborGaze`,
      gate: ANIMATED_112_HOST_GAZE_BODY_PHASE_STABILITY_GATE,
      directed: false,
      pairCount: 104,
      pairKeysSha256: ANIMATED_SAME_NON_NEIGHBOR_PAIR_KEYS_SHA256,
    },
  );
  verifyAnimatedDisplayed112HostSupplement(
    host.supplemental?.crossPhaseNonNeighborGaze,
    expected.crossPhaseNonNeighborGaze,
    {
      label: `${label}.supplemental.crossPhaseNonNeighborGaze`,
      gate: ANIMATED_112_HOST_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      directed: true,
      pairCount: 208,
      pairKeysSha256: ANIMATED_CROSS_NON_NEIGHBOR_PAIR_KEYS_SHA256,
    },
  );

  const allExpectedIds = [
    ...Object.values(expected.groups).flat(),
    ...expected.samePhaseNonNeighborGaze,
    ...expected.crossPhaseNonNeighborGaze,
  ];
  requireCondition(
    host.totalUniqueTransitionCount === allExpectedIds.length
      && host.expectedTotalUniqueTransitionCount === allExpectedIds.length,
    `${label} total unique transition count is incomplete`,
  );
  verifyAnimatedMembershipRecord(host.membership, allExpectedIds, `${label}.membership`);
  verifyAnimatedHostTrace(
    host.orderedFullRecordTrace,
    allExpectedIds,
    `${label}.orderedFullRecordTrace`,
  );
  const coreFailureIds = Object.values(host.core.groups).flatMap((group) => (
    group.trace.failingTransitionIds
  ));
  requireCondition(
    deepEqual(host.failingTransitionIds, coreFailureIds)
      && deepEqual(host.orderedFullRecordTrace.failingTransitionIds, coreFailureIds),
    `${label} top-level, group, and full-trace failure IDs disagree`,
  );
  requireEmpty(host, "failingTransitionIds", label);
  const expectedCanonicalHash = sha256Json({
    groups: Object.fromEntries(Object.entries(host.core.groups).map(([key, group]) => (
      [key, group.canonicalAlphaSilhouetteSequenceSha256]
    ))),
    samePhaseNonNeighborGaze:
      host.supplemental.samePhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256,
    crossPhaseNonNeighborGaze:
      host.supplemental.crossPhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256,
  });
  requireSha256(
    host.canonicalAlphaSilhouetteSequenceSha256,
    `${label}.canonicalAlphaSilhouetteSequenceSha256`,
  );
  requireCondition(
    host.canonicalAlphaSilhouetteSequenceSha256 === expectedCanonicalHash,
    `${label} canonical alpha/silhouette hash is stale`,
  );
}

function verifyAnimatedMaximumRecord(record, field, limit, label) {
  requireCondition(
    record?.[field]
      && Number.isFinite(record[field].value)
      && record[field].value <= limit,
    `${label}.${field} exceeds its bound or is missing`,
  );
}

export function verifyAnimatedDiagnosticMaximumRecord(record, field, label) {
  requireCondition(
    record?.[field] && Number.isFinite(record[field].value),
    `${label}.${field} is missing or non-finite`,
  );
  return true;
}

export function verifyAnimatedSourceIsolatedFrameSummary(isolated, cellKey, label) {
  requireCondition(
    isolated?.completeCoverage === true
      && isolated?.frameCount === ANIMATED_ATLAS_FRAME_COUNT
      && isolated?.passingFrameCount === ANIMATED_ATLAS_FRAME_COUNT
      && isolated?.failingFrameCount === 0
      && Number.isFinite(isolated?.maximumObservedRatio),
    `${label} isolated-frame coverage or diagnostic maximum is incomplete`,
  );
  verifyAnimatedIsolatedFrameTrace(
    isolated.trace,
    expectedAnimatedCellIsolatedFrameIds(cellKey),
    `${label}.isolatedFrameExcursions.trace`,
  );
  requireCondition(
    isolated.failingFrameCount === isolated.trace.failingFrameIds.length,
    `${label} isolated-frame summary and trace failure counts disagree`,
  );
  return true;
}

export function verifyAnimatedDisplayed112(displayed, label) {
  requireCondition(
    displayed?.requiredCellCount === 73
      && displayed.frameCount === ANIMATED_ATLAS_FRAME_COUNT
      && displayed.transitionCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && displayed.internalTransitionCount === 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1)
      && displayed.loopSeamCount === 73
      && displayed.isolatedFrameCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && displayed.upperBoundSafeCellCount === 73
      && displayed.completeCoverage === true
      && displayed.failingTransitionCount === 0
      && displayed.failingIsolatedFrameCount === 0,
    `${label} summary is incomplete or failing`,
  );
  requireCondition(
    deepEqual(displayed.display, ANIMATED_112_DISPLAY)
      && displayed.sampling === "authoritative Chromium DPR2 pixelated host background lattice"
      && deepEqual(displayed.gate, ANIMATED_112_TEMPORAL_GATE)
      && deepEqual(displayed.rowGates, ANIMATED_112_TEMPORAL_ROW_GATES),
    `${label} display, sampler, or gate contract changed`,
  );
  requireEmpty(displayed, "failingTransitionIds", label);
  requireEmpty(displayed, "failingIsolatedFrameIds", label);
  const expectedTransitionIds = ANIMATED_ATLAS_REQUIRED_CELL_KEYS.flatMap((cellKey) => (
    expectedAnimatedCellTransitionIds(cellKey)
  ));
  const expectedIsolatedFrameIds = ANIMATED_ATLAS_REQUIRED_CELL_KEYS.flatMap((cellKey) => (
    expectedAnimatedCellIsolatedFrameIds(cellKey)
  ));
  verifyAnimatedHostTrace(
    displayed.orderedTransitionTrace,
    expectedTransitionIds,
    `${label}.orderedTransitionTrace`,
  );
  verifyAnimatedIsolatedFrameTrace(
    displayed.orderedIsolatedFrameTrace,
    expectedIsolatedFrameIds,
    `${label}.orderedIsolatedFrameTrace`,
  );
  requireCondition(
    deepEqual(displayed.failingTransitionIds, displayed.orderedTransitionTrace.failingTransitionIds)
      && deepEqual(
        displayed.failingIsolatedFrameIds,
        displayed.orderedIsolatedFrameTrace.failingFrameIds,
      ),
    `${label} top-level and full-trace failure IDs disagree`,
  );

  for (const [field, limit] of [
    ["normalizedRgbaDiff", ANIMATED_112_TEMPORAL_GATE.maximumNormalizedRgbaDiff],
    ["normalizedAlphaDiff", ANIMATED_112_TEMPORAL_GATE.maximumNormalizedAlphaDiff],
    ["changedPixelFraction", ANIMATED_112_TEMPORAL_GATE.maximumChangedPixelFraction],
    ["changedAlphaPixelFraction", ANIMATED_112_TEMPORAL_GATE.maximumChangedAlphaPixelFraction],
    ["perceptualRms", ANIMATED_112_TEMPORAL_GATE.maximumPerceptualRms],
    ["stronglyChangedCellFraction", ANIMATED_112_TEMPORAL_GATE.maximumStronglyChangedCellFraction],
  ]) {
    verifyAnimatedMaximumRecord(displayed.maximumObserved, field, limit, `${label}.maximumObserved`);
  }
  requireCondition(
    Number.isFinite(displayed.maximumObservedMaterialLocalEnergyRatio?.value)
      && displayed.maximumObservedMaterialLocalEnergyRatio.value
        <= ANIMATED_112_TEMPORAL_GATE.maximumLocalEnergyRatio,
    `${label} material local-energy maximum is missing or exceeds its bound`,
  );
  requireCondition(
    Number.isFinite(displayed.maximumObservedIsolatedFrameExcursion?.value),
    `${label} isolated-frame maximum is missing`,
  );
  requireCondition(
    Number.isFinite(displayed.maximumObservedMaterialIsolatedFrameExcursion?.value)
      && displayed.maximumObservedMaterialIsolatedFrameExcursion.value
        <= ANIMATED_112_TEMPORAL_GATE.maximumIsolatedFrameExcursionRatio,
    `${label} material isolated-frame maximum is missing or exceeds its bound`,
  );

  const metricToGate = Object.freeze({
    normalizedRgbaDiff: "maximumNormalizedRgbaDiff",
    normalizedAlphaDiff: "maximumNormalizedAlphaDiff",
    changedPixelFraction: "maximumChangedPixelFraction",
    changedAlphaPixelFraction: "maximumChangedAlphaPixelFraction",
    perceptualRms: "maximumPerceptualRms",
    stronglyChangedCellFraction: "maximumStronglyChangedCellFraction",
  });
  for (const row of Object.keys(ANIMATED_112_TEMPORAL_ROW_GATES)) {
    const rowGate = ANIMATED_112_TEMPORAL_ROW_GATES[row];
    const rowMaximum = displayed.rowMaximumObserved?.[row];
    requireCondition(rowMaximum && typeof rowMaximum === "object", `${label} row ${row} maxima are missing`);
    for (const [metric, gateField] of Object.entries(metricToGate)) {
      requireCondition(
        Number.isFinite(rowMaximum[metric]) && rowMaximum[metric] <= rowGate[gateField],
        `${label} row ${row} ${metric} exceeds its row gate or is missing`,
      );
    }
    const materialLocalEnergy = displayed.rowMaximumObservedMaterialLocalEnergyRatio?.[row];
    requireCondition(
      (materialLocalEnergy === null
        && rowMaximum.perceptualRms < ANIMATED_112_TEMPORAL_GATE.localEnergyMaterialPerceptualRms)
        || (Number.isFinite(materialLocalEnergy)
          && materialLocalEnergy <= rowGate.maximumLocalEnergyRatio),
      `${label} row ${row} material local-energy maximum is inconsistent or exceeds its row gate`,
    );
    requireCondition(
      Number.isFinite(displayed.rowMaximumObservedIsolatedFrameExcursionRatio?.[row]),
      `${label} row ${row} isolated-frame maximum is missing`,
    );
    const materialIsolated = displayed.rowMaximumObservedMaterialIsolatedFrameExcursionRatio?.[row];
    requireCondition(
      materialIsolated === null
        || (Number.isFinite(materialIsolated) && materialIsolated <= rowGate.maximumIsolatedFrameExcursionRatio),
      `${label} row ${row} material isolated-frame maximum exceeds its row gate or is missing`,
    );
  }

  requireArray(displayed.cells, `${label}.cells`);
  requireCondition(
    displayed.cells.length === 73
      && deepEqual(displayed.cells.map(({ key }) => key), ANIMATED_ATLAS_REQUIRED_CELL_KEYS),
    `${label} cell coverage does not exactly match the 73 reachable host cells`,
  );
  for (const cell of displayed.cells) {
    const cellLabel = `${label} ${cell.key}`;
    const rowGate = ANIMATED_112_TEMPORAL_ROW_GATES[cell.row];
    requireCondition(rowGate !== undefined, `${cellLabel} has an unknown row`);
    requireCondition(
      cell.key === `r${cell.row}c${cell.column}`
        && cell.inspectedPages === ANIMATED_ATLAS_FRAME_COUNT
        && cell.completeCoverage === true
        && cell.upperBoundSafe === true
        && cell.transitionCount === ANIMATED_ATLAS_FRAME_COUNT
        && cell.internalTransitionCount === ANIMATED_ATLAS_FRAME_COUNT - 1
        && cell.loopSeamCount === 1
        && cell.failingTransitionCount === 0
        && cell.isolatedFrameCount === ANIMATED_ATLAS_FRAME_COUNT
        && cell.failingIsolatedFrameCount === 0,
      `${cellLabel} summary is incomplete or failing`,
    );
    const cellTransitionIds = expectedAnimatedCellTransitionIds(cell.key);
    const cellIsolatedFrameIds = expectedAnimatedCellIsolatedFrameIds(cell.key);
    verifyAnimatedHostTrace(
      cell.transitionTrace,
      cellTransitionIds,
      `${cellLabel}.transitionTrace`,
    );
    verifyAnimatedTraceExtremaAgainstGate(cell.transitionTrace, rowGate, `${cellLabel}.transitionTrace`);
    verifyAnimatedIsolatedFrameTrace(
      cell.isolatedFrameTrace,
      cellIsolatedFrameIds,
      `${cellLabel}.isolatedFrameTrace`,
    );
    requireCondition(
      cell.failingTransitionCount === cell.transitionTrace.failingTransitionIds.length
        && cell.failingIsolatedFrameCount === cell.isolatedFrameTrace.failingFrameIds.length,
      `${cellLabel} summary and trace failure counts disagree`,
    );
  }
  return true;
}

async function readJson(relative) {
  try {
    return JSON.parse(await readFile(absolute(relative), "utf8"));
  } catch (error) {
    throw new Error(`${relative} is not valid readable JSON: ${error.message}`);
  }
}

async function writeJson(relative, value) {
  await writeFile(absolute(relative), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function missingPaths(paths) {
  const checks = await Promise.all(paths.map(async (relative) => {
    try {
      await access(absolute(relative));
      return null;
    } catch {
      return relative;
    }
  }));
  return checks.filter(Boolean);
}

async function requireInputs() {
  const paths = [
    ...VARIANT_NAMES.flatMap((variant) => {
      const config = VARIANTS[variant];
      return [config.manifestPath, config.atlasPath, ...config.artifactPaths];
    }),
    ...SHARED_ARTIFACT_PATHS,
  ];
  const missing = await missingPaths(paths);
  requireCondition(
    missing.length === 0,
    `missing required QA artifacts: ${missing.join(", ")}`,
  );
}

function embeddedShaValues(value, matches = [], location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => embeddedShaValues(entry, matches, `${location}[${index}]`));
    return matches;
  }
  if (!value || typeof value !== "object") return matches;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("_", "");
    if (["atlassha256", "darkatlassha256", "lightatlassha256", "stimulussha256"].includes(normalized)) {
      matches.push({ key: normalized, value: entry, location: `${location}.${key}` });
    }
    embeddedShaValues(entry, matches, `${location}.${key}`);
  }
  return matches;
}

function verifyEmbeddedShas(report, label, {
  atlasSha = null,
  darkAtlasSha = null,
  lightAtlasSha = null,
  stimulusSha = null,
} = {}) {
  for (const embedded of embeddedShaValues(report)) {
    const expected = embedded.key === "darkatlassha256"
      ? darkAtlasSha
      : embedded.key === "lightatlassha256"
        ? lightAtlasSha
        : embedded.key === "stimulussha256"
          ? stimulusSha
          : atlasSha;
    requireCondition(expected !== null, `${label} embeds ${embedded.location} without a known comparison SHA`);
    requireCondition(
      embedded.value === expected,
      `${label} ${embedded.location} is for different bytes`,
    );
  }
}

function embeddedSha(report, camelKey, snakeKey) {
  return report[camelKey] ?? report[snakeKey] ?? null;
}

async function inspectAtlasFirstPage(variant, atlasPath, role) {
  const config = VARIANTS[variant];
  const bytes = await readFile(absolute(atlasPath));
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  const decoded = await sharp(bytes, {
    animated: true,
    failOn: "error",
    page: 0,
    pages: 1,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  requireCondition(
    info.width === 1536 && info.height === 2288 && info.channels === 4,
    `${variant} ${role} atlas first page must decode to 1536x2288 RGBA`,
  );
  requireCondition(metadata.format === "webp", `${variant} ${role} atlas must be WebP`);
  if (role === "authoring") {
    requireCondition((metadata.pages ?? 1) === 1, `${variant} authoring atlas must be a single static page`);
  }

  const alpha = Buffer.alloc(info.width * info.height);
  const counts = Object.fromEntries(Object.keys(ACCENT_COLORS).map((name) => [name, 0]));
  counts.body = 0;
  counts.eyes = 0;
  const bodyKey = rgbKey(rgb(config.bodyColor));
  const eyeKey = rgbKey(rgb(config.eyeColor));
  let hiddenRgbPixels = 0;

  for (let offset = 0, pixel = 0; offset < data.length; offset += 4, pixel += 1) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const pixelAlpha = data[offset + 3];
    alpha[pixel] = pixelAlpha;
    if (pixelAlpha === 0) {
      if (red !== 0 || green !== 0 || blue !== 0) hiddenRgbPixels += 1;
      continue;
    }
    const color = rgbKey([red, green, blue]);
    if (color === bodyKey) counts.body += 1;
    if (color === eyeKey) counts.eyes += 1;
    for (const [name, sourceColor] of Object.entries(sourceRgbKeys)) {
      if (color === sourceColor) counts[name] += 1;
    }
  }

  requireCondition(hiddenRgbPixels === 0, `${variant} ${role} atlas contains ${hiddenRgbPixels} hidden RGB pixels`);
  requireCondition(counts.body >= 10_000, `${variant} ${role} atlas is missing a substantial exact body-color region`);
  requireCondition(counts.eyes >= 1_000, `${variant} ${role} atlas is missing substantial exact eye/effect ink`);
  for (const name of Object.keys(ACCENT_COLORS)) {
    requireCondition(counts[name] > 0, `${variant} ${role} atlas does not contain exact accent ${name}`);
  }

  return Object.freeze({
    role,
    path: atlasPath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    format: metadata.format,
    encodedPages: metadata.pages ?? 1,
    width: info.width,
    height: info.height,
    channels: info.channels,
    alphaMaskSha256: sha256(alpha),
    hiddenRgbPixels,
    exactAccentColorPixels: Object.freeze(counts),
  });
}

async function verifyManifest(variant, config) {
  const bytes = await readFile(absolute(config.manifestPath));
  const manifest = JSON.parse(bytes.toString("utf8"));
  requireCondition(manifest.id === config.id, `${variant} manifest ID must be ${config.id}`);
  requireCondition(manifest.displayName === config.displayName, `${variant} manifest displayName is wrong`);
  requireCondition(manifest.spriteVersionNumber === 2, `${variant} manifest must use spriteVersionNumber 2`);
  requireCondition(manifest.spritesheetPath === "spritesheet.webp", `${variant} manifest sprite path is wrong`);
  requireCondition(
    typeof manifest.description === "string" && manifest.description.trim().length >= 20,
    `${variant} manifest description is not meaningful`,
  );
  return {
    manifest,
    evidence: {
      path: config.manifestPath,
      sha256: sha256(bytes),
      id: manifest.id,
    },
  };
}

async function verifyCustomValidation(variant, config, shippingAtlas, authoringAtlas, manifest) {
  const relative = `qa/validation-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} custom validator schema must be 1`);
  requireCondition(report.variant === variant, `${variant} custom validator variant is wrong`);
  requireCondition(report.petId === config.id, `${variant} custom validator petId is wrong`);
  requireCondition(report.ok === true, `${variant} custom validator must pass`);
  requireCondition(
    report.atlasSha256 === shippingAtlas.sha256,
    `${variant} custom validator is for a different shipping atlas`,
  );
  verifyEmbeddedShas(report, `${variant} custom validator`, { atlasSha: shippingAtlas.sha256 });
  requireCondition(deepEqual(report.manifest, manifest), `${variant} custom validator manifest snapshot is stale`);
  requireEmpty(report, "errors", `${variant} custom validator`);
  requireEmpty(report, "warnings", `${variant} custom validator`);
  requireCondition(
    report.spritesheet?.width === 1536 && report.spritesheet?.height === 2288,
    `${variant} custom validator dimensions are wrong`,
  );
  requireArtifactPath(report.spritesheet?.path, config.atlasPath, `${variant} custom validator spritesheet.path`);
  requireCondition(report.spritesheet?.format === "webp", `${variant} custom validator format is wrong`);
  requireCondition(report.spritesheet?.hasAlpha === true, `${variant} custom validator did not confirm alpha`);
  requireCondition(report.spritesheet?.expectedPopulatedCells === 73, `${variant} populated-cell count is wrong`);
  requireCondition(report.spritesheet?.expectedUnusedCells === 15, `${variant} unused-cell count is wrong`);
  requireCondition(report.spritesheet?.hiddenRgbPixels === 0, `${variant} custom validator found hidden RGB`);
  requireArray(report.cells, `${variant} custom validator.cells`);
  requireCondition(report.cells.length === 88, `${variant} custom validator must inspect all 88 cells`);
  requireCondition(
    report.cells.every((cell) => cell.hiddenRgbPixels === 0),
    `${variant} custom validator contains a cell with hidden RGB`,
  );
  requireArtifactPath(
    report.authoringAtlas?.path,
    config.authoringAtlasPath,
    `${variant} custom validator authoringAtlas.path`,
  );
  requireCondition(
    report.authoringAtlas?.sha256 === authoringAtlas.sha256,
    `${variant} custom validator is for a different authoring atlas`,
  );
  requireCondition(
    report.authoringAtlas?.format === "webp"
      && report.authoringAtlas?.width === 1536
      && report.authoringAtlas?.height === 2288
      && report.authoringAtlas?.channels === 4
      && report.authoringAtlas?.hasAlpha === true,
    `${variant} custom validator authoring atlas metadata is wrong`,
  );
}

async function verifyOfficialValidation(variant, config, authoringAtlas) {
  const relative = `qa/official-validation-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.ok === false, `${variant} official validator must retain the audited v2 neutral-cell diagnostic`);
  requireArtifactPath(report.file, config.authoringAtlasPath, `${variant} official validator file`);
  verifyEmbeddedShas(report, `${variant} official validator`, { atlasSha: authoringAtlas.sha256 });
  requireCondition(report.sprite_version_number === 2, `${variant} official validator did not confirm v2`);
  requireCondition(String(report.format).toUpperCase() === "WEBP", `${variant} official validator format must be WEBP`);
  requireCondition(report.columns === 8 && report.rows === 11, `${variant} official validator grid is wrong`);
  requireCondition(report.width === 1536 && report.height === 2288, `${variant} official validator dimensions are wrong`);
  requireCondition(report.mode === "RGBA", `${variant} official validator mode must be RGBA`);
  requireCondition(report.transparent_rgb_residue_pixels === 0, `${variant} official validator found hidden RGB`);
  requireCondition(
    deepEqual(report.errors, [OFFICIAL_V2_NEUTRAL_CELL_DIAGNOSTIC]),
    `${variant} official validator contains a finding beyond the audited v2 neutral-cell diagnostic`,
  );
  requireEmpty(report, "warnings", `${variant} official validator`);
  requireArray(report.cells, `${variant} official validator.cells`);
  requireCondition(report.cells.length === 88, `${variant} official validator must inspect all 88 cells`);
  requireCondition(
    report.cells.some((cell) => (
      cell.row === 0
      && cell.column === 6
      && cell.used === true
      && cell.nontransparent_pixels === 0
    )),
    `${variant} official validator did not bind the known diagnostic to idle r0c6`,
  );
}

function expectedAnimatedCompact(report, config) {
  return {
    ok: report.ok,
    reportPath: config.animatedReportPath,
    atlasPath: report.atlas.path,
    atlasSha256: report.atlas.sha256,
    bytes: report.atlas.bytes,
    pages: report.atlas.pages,
    delaysMs: report.atlas.delaysMs,
    loop: report.atlas.loop,
    hasAlpha: report.atlas.hasAlpha,
    inspectedPageCount: report.inspectedPageCount,
    motionCellCount: report.temporal.motionCellCount,
    loopSafeCellCount: report.temporal.loopSafeCellCount,
    temporalTransitionCount: report.temporal.transitionCount,
    temporalInternalTransitionCount: report.temporal.internalTransitionCount,
    temporalLoopSeamCount: report.temporal.loopSeamCount,
    temporalIsolatedFrameCount: report.temporal.isolatedFrameCount,
    temporalUpperBoundSafeCellCount: report.temporal.upperBoundSafeCellCount,
    temporalMaximumObserved: report.temporal.adjacencyUpperBounds.maximumObserved,
    temporalMaximumObservedIsolatedFrameExcursion:
      report.temporal.adjacencyUpperBounds.maximumObservedIsolatedFrameExcursion,
    displayed112TransitionCount: report.displayedTemporal112.transitionCount,
    displayed112InternalTransitionCount: report.displayedTemporal112.internalTransitionCount,
    displayed112LoopSeamCount: report.displayedTemporal112.loopSeamCount,
    displayed112IsolatedFrameCount: report.displayedTemporal112.isolatedFrameCount,
    displayed112UpperBoundSafeCellCount: report.displayedTemporal112.upperBoundSafeCellCount,
    displayed112MaximumObserved: report.displayedTemporal112.maximumObserved,
    displayed112MaximumObservedMaterialLocalEnergyRatio:
      report.displayedTemporal112.maximumObservedMaterialLocalEnergyRatio,
    displayed112MaximumObservedIsolatedFrameExcursion:
      report.displayedTemporal112.maximumObservedIsolatedFrameExcursion,
    displayed112MaximumObservedMaterialIsolatedFrameExcursion:
      report.displayedTemporal112.maximumObservedMaterialIsolatedFrameExcursion,
    sourceHostBoundariesOk: report.sourceHostBoundaries.ok,
    sourceHostCoreTransitionCount: report.sourceHostBoundaries.core.transitionCount,
    sourceHostSamePhaseNonNeighborTransitionCount:
      report.sourceHostBoundaries.supplemental.samePhaseNonNeighborGaze.transitionCount,
    sourceHostCrossPhaseNonNeighborTransitionCount:
      report.sourceHostBoundaries.supplemental.crossPhaseNonNeighborGaze.transitionCount,
    sourceHostTotalUniqueTransitionCount:
      report.sourceHostBoundaries.totalUniqueTransitionCount,
    sourceHostOrderedFullRecordSha256:
      report.sourceHostBoundaries.orderedFullRecordTrace.orderedFullRecordSha256,
    sourceHostCanonicalAlphaSilhouetteSequenceSha256:
      report.sourceHostBoundaries.canonicalAlphaSilhouetteSequenceSha256,
    displayed112HostBoundariesOk: report.displayed112HostBoundaries.ok,
    displayed112HostCoreTransitionCount:
      report.displayed112HostBoundaries.core.transitionCount,
    displayed112HostSamePhaseNonNeighborTransitionCount:
      report.displayed112HostBoundaries.supplemental.samePhaseNonNeighborGaze.transitionCount,
    displayed112HostCrossPhaseNonNeighborTransitionCount:
      report.displayed112HostBoundaries.supplemental.crossPhaseNonNeighborGaze.transitionCount,
    displayed112HostTotalUniqueTransitionCount:
      report.displayed112HostBoundaries.totalUniqueTransitionCount,
    displayed112HostCanonicalAlphaSilhouetteSequenceSha256:
      report.displayed112HostBoundaries.canonicalAlphaSilhouetteSequenceSha256,
    timedRowsPhaseIdentical: report.timedRowPhaseIdentity.every((row) => row.allPhasesIdentical),
    idleTimelineOk: report.idleTimeline.phaseIdenticalEveryPage
      && report.idleTimeline.motionExists
      && report.idleTimeline.loopNotWorse,
    samePhaseTransitionsOk: report.samePhaseTransitions.ok,
    samePhaseMembershipOk: report.samePhaseTransitions.membership.ok,
    samePhaseTransitionCounts: {
      timedRowPairs: report.samePhaseTransitions.timedRowPairs.count,
      gazeTimedBoundaries: report.samePhaseTransitions.gazeEntry.count,
      gazeNeighborPairs: report.samePhaseTransitions.gazeNeighborPairs.count,
      gazeBodyPairs: report.samePhaseTransitions.gazeBodyPairs.count,
      gazeBodyNonNeighborPairs:
        report.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount,
    },
    crossPhaseTransitionsOk: report.crossPhaseTransitions.ok,
    crossPhaseMembershipOk: report.crossPhaseTransitions.membership.ok,
    crossPhaseTransitionCounts: {
      phaseWindows: report.crossPhaseTransitions.phaseWindowCount,
      loopSeamWindows: report.crossPhaseTransitions.loopSeamWindowCount,
      timedRowChanges: report.crossPhaseTransitions.timedRowChanges.count,
      gazeNeighborChanges: report.crossPhaseTransitions.gazeNeighborChanges.count,
      gazeTimedBoundaries: report.crossPhaseTransitions.gazeTimedBoundaries.count,
      gazeToTimed: report.crossPhaseTransitions.gazeTimedBoundaries.gazeToTimedCount,
      eligibleTimedToGaze:
        report.crossPhaseTransitions.gazeTimedBoundaries.eligibleTimedToGazeCount,
      gazeBodyNonNeighborChanges:
        report.crossPhaseTransitions.gazeBodyNonNeighborChanges.count,
    },
    pageRgbaSha256: report.pages.map((page) => page.rgbaSha256),
    pageAlphaSha256: report.pages.map((page) => page.alphaSha256),
    pageSilhouetteSha256: report.pages.map((page) => page.silhouette.sha256),
    errorCount: report.errors.length,
  };
}

export function verifyAnimatedAtlasContract(contract, label = "animated atlas") {
  requireCondition(
    contract?.spriteVersionNumber === 2
      && deepEqual(contract?.pageCanvas, { width: 1536, height: 2288 })
      && contract?.frameCount === ANIMATED_ATLAS_FRAME_COUNT
      && deepEqual(contract?.frameDelaysMs, ANIMATED_ATLAS_DELAYS_MS)
      && contract?.loopDurationMs === ANIMATED_ATLAS_LOOP_MS
      && contract?.loop === 0
      && contract?.maxBytes === 20 * 1024 * 1024
      && contract?.safetyGutterPx === 4
      && deepEqual(contract?.requiredColumnsByRow, ANIMATED_ATLAS_REQUIRED_COLUMNS)
      && contract?.requiredCellCount === 73
      && contract?.unusedCellCount === 15
      && deepEqual(contract?.temporalMotion, ANIMATED_TEMPORAL_MOTION_GATES)
      && deepEqual(
        contract?.temporalAdjacencyUpperBounds,
        ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS,
      )
      && deepEqual(
        contract?.temporalRowUpperBounds,
        ANIMATED_TEMPORAL_ROW_UPPER_BOUNDS,
      )
      && deepEqual(
        contract?.displayed112TemporalUpperBounds,
        ANIMATED_112_TEMPORAL_GATE,
      )
      && deepEqual(
        contract?.displayed112TemporalRowUpperBounds,
        ANIMATED_112_TEMPORAL_ROW_GATES,
      )
      && deepEqual(contract?.displayed112Sampling, ANIMATED_112_DISPLAY)
      && deepEqual(
        contract?.displayed112HostBoundaryGates,
        ANIMATED_112_HOST_BOUNDARY_GATES,
      )
      && deepEqual(
        contract?.displayed112HostGazeBodyPhaseStabilityGate,
        ANIMATED_112_HOST_GAZE_BODY_PHASE_STABILITY_GATE,
      )
      && deepEqual(
        contract?.displayed112HostGazeBodyCrossPhaseStabilityGate,
        ANIMATED_112_HOST_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      )
      && deepEqual(
        contract?.samePhaseTransitionGates,
        ANIMATED_SAME_PHASE_TRANSITION_GATES,
      )
      && deepEqual(
        contract?.gazeBodyPhaseStabilityGate,
        ANIMATED_GAZE_BODY_PHASE_STABILITY_GATE,
      )
      && deepEqual(
        contract?.gazeBodyCrossPhaseStabilityGate,
        ANIMATED_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      ),
    `${label} contract is incomplete or changed`,
  );
  return true;
}

async function verifyAnimatedAtlas(variant, config, shippingAtlas, manifest) {
  const report = await readJson(config.animatedReportPath);
  const label = `${variant} animated atlas`;
  requireCondition(report.schemaVersion === 1, `${label} schema must be 1`);
  requireCondition(report.variant === variant, `${label} variant is wrong`);
  requireCondition(report.petId === config.id, `${label} petId is wrong`);
  requireCondition(report.ok === true, `${label} must pass`);
  requireCondition(deepEqual(report.manifest, manifest), `${label} manifest snapshot is stale`);
  verifyAnimatedAtlasContract(report.contract, label);

  requireArtifactPath(report.atlas?.path, config.atlasPath, `${label} atlas.path`);
  requireCondition(report.atlas?.sha256 === shippingAtlas.sha256, `${label} is for different shipping bytes`);
  requireCondition(report.atlas?.bytes === shippingAtlas.bytes, `${label} byte count is stale`);
  requireCondition(
    report.atlas?.format === "webp"
      && report.atlas?.width === 1536
      && report.atlas?.stackedHeight === 2288 * ANIMATED_ATLAS_FRAME_COUNT
      && report.atlas?.pageHeight === 2288
      && report.atlas?.pages === ANIMATED_ATLAS_FRAME_COUNT
      && report.atlas?.loop === 0
      && report.atlas?.channels === 4
      && report.atlas?.hasAlpha === true
      && report.atlas?.within20MiB === true,
    `${label} encoded metadata is wrong`,
  );
  requireCondition(
    deepEqual(
      report.atlas?.delaysMs,
      ANIMATED_ATLAS_DELAYS_MS,
    ),
    `${label} delay table is wrong`,
  );

  requireCondition(report.inspectedPageCount === ANIMATED_ATLAS_FRAME_COUNT, `${label} did not inspect all pages`);
  requireArray(report.pages, `${label}.pages`);
  requireCondition(report.pages.length === ANIMATED_ATLAS_FRAME_COUNT, `${label} page evidence is incomplete`);
  for (const [index, page] of report.pages.entries()) {
    const pageLabel = `${label} page ${index}`;
    requireCondition(page.index === index && page.ok === true, `${pageLabel} did not pass`);
    requireCondition(page.hiddenRgbPixels === 0, `${pageLabel} contains hidden RGB`);
    requireCondition(page.requiredVisibleCellCount === 73, `${pageLabel} required-cell coverage is wrong`);
    requireCondition(page.unusedZeroCellCount === 15, `${pageLabel} unused-cell coverage is wrong`);
    requireCondition(page.safetyGutterPx === 4, `${pageLabel} safety gutter changed`);
    requireCondition(page.safetyGutterViolationCount === 0, `${pageLabel} violates the safety gutter`);
    requireArray(page.safetyGutterViolations, `${pageLabel}.safetyGutterViolations`);
    requireCondition(page.safetyGutterViolations.length === 0, `${pageLabel} has safety-gutter findings`);
    requireCondition(
      deepEqual(Object.keys(page.requiredCellRgbaSha256 ?? {}), ANIMATED_ATLAS_REQUIRED_CELL_KEYS),
      `${pageLabel} required-cell hash keys do not exactly match the 73 reachable host cells`,
    );
    for (const [cellKey, digest] of Object.entries(page.requiredCellRgbaSha256)) {
      requireSha256(digest, `${pageLabel}.requiredCellRgbaSha256.${cellKey}`);
    }
    requireArray(page.timedRows, `${pageLabel}.timedRows`);
    requireCondition(
      page.timedRows.length === 9
        && page.timedRows.every((row, rowIndex) => row.row === rowIndex && row.identical === true),
      `${pageLabel} timed rows are not phase-identical across populated host columns`,
    );
    requireCondition(
      page.idle?.continuousTimeline === true && page.idle?.phaseIdentical === true,
      `${pageLabel} idle timeline is not continuous and row-wide`,
    );
    requireCondition(page.gaze?.ok === true && page.gaze?.distinctCellCount === 16, `${pageLabel} gaze family failed`);
    requireEmpty(page.gaze, "errors", `${pageLabel}.gaze`);
    requireCondition(page.samePhaseTransitions?.ok === true, `${pageLabel} same-phase transitions failed`);
    requireEmpty(page.samePhaseTransitions, "errors", `${pageLabel}.samePhaseTransitions`);
    requireEmpty(page, "errors", pageLabel);
  }

  requireCondition(
    report.temporal?.reachableCellCount === 73
      && report.temporal?.motionCellCount === 73
      && report.temporal?.loopSafeCellCount === 73
      && report.temporal?.transitionCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && report.temporal?.internalTransitionCount === 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1)
      && report.temporal?.loopSeamCount === 73
      && report.temporal?.isolatedFrameCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && report.temporal?.upperBoundSafeCellCount === 73,
    `${label} must prove complete, bounded temporal continuity in all 73 reachable cells`,
  );
  const temporalBounds = report.temporal?.adjacencyUpperBounds;
  requireCondition(
    deepEqual(temporalBounds?.gate, ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS)
      && temporalBounds?.requiredCellCount === 73
      && temporalBounds?.frameCount === ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.expectedTransitionCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.transitionCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.expectedInternalTransitionCount === 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1)
      && temporalBounds?.internalTransitionCount === 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1)
      && temporalBounds?.expectedLoopSeamCount === 73
      && temporalBounds?.loopSeamCount === 73
      && temporalBounds?.passingTransitionCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.failingTransitionCount === 0
      && temporalBounds?.expectedIsolatedFrameCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.isolatedFrameCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.passingIsolatedFrameCount === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && temporalBounds?.failingIsolatedFrameCount === 0
      && temporalBounds?.upperBoundSafeCellCount === 73
      && temporalBounds?.completeCoverage === true,
    `${label} temporal upper-bound summary is incomplete, changed, or failing`,
  );
  requireEmpty(temporalBounds, "failingTransitionIds", `${label}.temporal.adjacencyUpperBounds`);
  requireEmpty(temporalBounds, "failingIsolatedFrameIds", `${label}.temporal.adjacencyUpperBounds`);
  for (const [field, limit] of [
    ["normalizedRgbaDiff", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumNormalizedRgbaDiff],
    ["normalizedAlphaDiff", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumNormalizedAlphaDiff],
    ["changedPixelFraction", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumChangedPixelFraction],
    ["changedAlphaPixelFraction", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumChangedAlphaPixelFraction],
    ["perceptualRms", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumPerceptualRms],
    ["stronglyChangedCellFraction", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumStronglyChangedCellFraction],
    ["featureInkMassStepFraction", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumFeatureInkMassStepFraction],
    ["featureInkVariationFraction", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumFeatureInkVariationFraction],
    ["featureInkCentroidStepPx", ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumFeatureInkCentroidStepPx],
  ]) {
    verifyAnimatedMaximumRecord(
      temporalBounds.maximumObserved,
      field,
      limit,
      `${label}.temporal.adjacencyUpperBounds.maximumObserved`,
    );
  }
  requireCondition(
    Number.isFinite(temporalBounds.maximumObservedMaterialLocalEnergyRatio?.value)
      && temporalBounds.maximumObservedMaterialLocalEnergyRatio.value
        <= ANIMATED_TEMPORAL_ADJACENCY_UPPER_BOUNDS.maximumLocalEnergyRatio,
    `${label} material source-cell local-energy maximum is missing or exceeds its bound`,
  );
  // Ratios for sub-material motion are retained as diagnostics and can be
  // arbitrarily high. The generated failure trace applies the row/global gate
  // only when both adjacent steps meet the material perceptual threshold.
  verifyAnimatedDiagnosticMaximumRecord(
    temporalBounds,
    "maximumObservedIsolatedFrameExcursion",
    `${label}.temporal.adjacencyUpperBounds`,
  );
  const expectedTemporalTransitionIds = ANIMATED_ATLAS_REQUIRED_CELL_KEYS.flatMap((cellKey) => (
    expectedAnimatedCellTransitionIds(cellKey)
  ));
  const expectedTemporalIsolatedFrameIds = ANIMATED_ATLAS_REQUIRED_CELL_KEYS.flatMap((cellKey) => (
    expectedAnimatedCellIsolatedFrameIds(cellKey)
  ));
  verifyAnimatedHostTrace(
    report.temporal?.orderedTransitionTrace,
    expectedTemporalTransitionIds,
    `${label}.temporal.orderedTransitionTrace`,
  );
  verifyAnimatedIsolatedFrameTrace(
    report.temporal?.orderedIsolatedFrameTrace,
    expectedTemporalIsolatedFrameIds,
    `${label}.temporal.orderedIsolatedFrameTrace`,
  );
  requireCondition(
    deepEqual(
      temporalBounds.failingTransitionIds,
      report.temporal.orderedTransitionTrace.failingTransitionIds,
    )
      && deepEqual(
        temporalBounds.failingIsolatedFrameIds,
        report.temporal.orderedIsolatedFrameTrace.failingFrameIds,
      ),
    `${label} temporal summary and full-trace failure IDs disagree`,
  );
  requireArray(report.temporal?.cells, `${label}.temporal.cells`);
  requireCondition(
    deepEqual(report.temporal.cells.map((cell) => cell.key), ANIMATED_ATLAS_REQUIRED_CELL_KEYS),
    `${label} temporal cells do not exactly match the 73 reachable host cells`,
  );
  requireCondition(
    report.temporal.cells.length === 73,
    `${label} temporal cell evidence is incomplete`,
  );
  for (const cell of report.temporal.cells) {
    const cellLabel = `${label} temporal ${cell.key}`;
    const rowGate = ANIMATED_TEMPORAL_ROW_UPPER_BOUNDS[cell.row];
    requireCondition(rowGate !== undefined, `${cellLabel} has an unknown row`);
    requireCondition(
      cell.key === `r${cell.row}c${cell.column}`
        && cell.inspectedPages === ANIMATED_ATLAS_FRAME_COUNT
        && cell.distinctRgbaFrameCount >= ANIMATED_ATLAS_FRAME_COUNT - 1
        && cell.distinctRgbaFrameCount <= ANIMATED_ATLAS_FRAME_COUNT
        && cell.distinctAlphaFrameCount >= ANIMATED_ATLAS_FRAME_COUNT - 1
        && cell.distinctAlphaFrameCount <= ANIMATED_ATLAS_FRAME_COUNT
        && cell.motionExists === true
        && cell.loopNotWorse === true,
      `${cellLabel} frame coverage or motion proof is incomplete`,
    );
    const fullCycleMotion = cell.fullCycleMotion;
    const usesGazeFullCycleGate = ANIMATED_TEMPORAL_MOTION_GATES
      .gazeFullCycle.rowIndices.includes(cell.row);
    requireCondition(
      fullCycleMotion?.internalTransitionCount === ANIMATED_ATLAS_FRAME_COUNT - 1
        && Number.isInteger(fullCycleMotion.activeInternalTransitionCount)
        && fullCycleMotion.activeInternalTransitionCount >= 0
        && fullCycleMotion.activeInternalTransitionCount
          <= fullCycleMotion.internalTransitionCount
        && Number.isFinite(fullCycleMotion.activeInternalTransitionFraction)
        && Number.isFinite(fullCycleMotion.totalNormalizedRgbaDiff)
        && Number.isFinite(fullCycleMotion.totalChangedPixelFraction)
        && fullCycleMotion.passesSelectedGate === true
        && (usesGazeFullCycleGate
          ? fullCycleMotion.mode === "gaze-full-cycle"
            && fullCycleMotion.activeInternalTransitionFraction
              >= ANIMATED_TEMPORAL_MOTION_GATES.gazeFullCycle
                .minimumActiveInternalTransitionFraction
            && fullCycleMotion.totalNormalizedRgbaDiff
              >= ANIMATED_TEMPORAL_MOTION_GATES.gazeFullCycle
                .minimumTotalNormalizedRgbaDiff
            && fullCycleMotion.totalChangedPixelFraction
              >= ANIMATED_TEMPORAL_MOTION_GATES.gazeFullCycle
                .minimumTotalChangedPixelFraction
          : fullCycleMotion.mode === "per-internal-transition"
            && fullCycleMotion.activeInternalTransitionCount
              === ANIMATED_ATLAS_FRAME_COUNT - 1),
      `${cellLabel} selected full-cycle motion gate is incomplete or failing`,
    );
    const adjacency = cell.temporalAdjacency;
    requireCondition(
      adjacency?.completeCoverage === true
        && adjacency?.transitionCount === ANIMATED_ATLAS_FRAME_COUNT
        && adjacency?.internalTransitionCount === ANIMATED_ATLAS_FRAME_COUNT - 1
        && adjacency?.loopSeamCount === 1
        && adjacency?.upperBoundSafe === true
        && adjacency?.failingTransitionCount === 0,
      `${cellLabel} adjacency coverage is incomplete or failing`,
    );
    verifyAnimatedHostTrace(
      adjacency.trace,
      expectedAnimatedCellTransitionIds(cell.key),
      `${cellLabel}.temporalAdjacency.trace`,
    );
    verifyAnimatedTraceExtremaAgainstGate(
      adjacency.trace,
      rowGate,
      `${cellLabel}.temporalAdjacency.trace`,
    );
    requireCondition(
      adjacency.failingTransitionCount === adjacency.trace.failingTransitionIds.length,
      `${cellLabel} adjacency summary and trace failure counts disagree`,
    );

    verifyAnimatedSourceIsolatedFrameSummary(
      cell.isolatedFrameExcursions,
      cell.key,
      cellLabel,
    );
  }
  verifyAnimatedDisplayed112(report.displayedTemporal112, `${label}.displayedTemporal112`);
  verifyAnimatedSourceHostBoundaries(
    report.sourceHostBoundaries,
    `${label}.sourceHostBoundaries`,
  );
  verifyAnimatedDisplayed112HostBoundaries(
    report.displayed112HostBoundaries,
    `${label}.displayed112HostBoundaries`,
  );
  requireArray(report.timedRowPhaseIdentity, `${label}.timedRowPhaseIdentity`);
  requireCondition(
    report.timedRowPhaseIdentity.length === 9
      && report.timedRowPhaseIdentity.every((row, index) =>
        row.row === index
        && row.inspectedPhases === ANIMATED_ATLAS_FRAME_COUNT
        && row.identicalPhaseCount === ANIMATED_ATLAS_FRAME_COUNT
        && row.allPhasesIdentical === true),
    `${label} timed-row phase identity is incomplete`,
  );
  requireCondition(
    report.idleTimeline?.continuousRowWideTimeline === true
      && report.idleTimeline?.phaseIdenticalEveryPage === true
      && report.idleTimeline?.inspectedPhases === ANIMATED_ATLAS_FRAME_COUNT
      && report.idleTimeline?.motionExists === true
      && report.idleTimeline?.loopNotWorse === true,
    `${label} idle timeline evidence failed`,
  );
  requireCondition(
    report.samePhaseTransitions?.ok === true
      && deepEqual(report.samePhaseTransitions?.gates, ANIMATED_SAME_PHASE_TRANSITION_GATES)
      && report.samePhaseTransitions?.actionToIdle?.count === ANIMATED_ATLAS_FRAME_COUNT * 8
      && report.samePhaseTransitions?.actionToIdle?.passing === ANIMATED_ATLAS_FRAME_COUNT * 8
      && report.samePhaseTransitions?.gazeEntry?.count === ANIMATED_ATLAS_FRAME_COUNT * 9 * 16
      && report.samePhaseTransitions?.gazeEntry?.passing === ANIMATED_ATLAS_FRAME_COUNT * 9 * 16
      && report.samePhaseTransitions?.timedRowPairs?.count === ANIMATED_ATLAS_FRAME_COUNT * 36
      && report.samePhaseTransitions?.timedRowPairs?.passing === ANIMATED_ATLAS_FRAME_COUNT * 36
      && report.samePhaseTransitions?.gazeNeighborPairs?.count === ANIMATED_ATLAS_FRAME_COUNT * 16
      && report.samePhaseTransitions?.gazeNeighborPairs?.passing === ANIMATED_ATLAS_FRAME_COUNT * 16
      && report.samePhaseTransitions?.gazeBodyPairs?.count === ANIMATED_ATLAS_FRAME_COUNT * 120
      && report.samePhaseTransitions?.gazeBodyPairs?.passing === ANIMATED_ATLAS_FRAME_COUNT * 120
      && report.samePhaseTransitions?.gazeBodyPairs?.phaseStability?.nonNeighborTransitionCount
        === ANIMATED_ATLAS_FRAME_COUNT * 104,
    `${label} same-phase transition coverage is incomplete or failing`,
  );
  requireEmpty(report.samePhaseTransitions, "failedTransitionIds", `${label}.samePhaseTransitions`);
  verifyAnimatedPhaseMembership(report.samePhaseTransitions.membership, `${label}.samePhaseTransitions.membership`);
  const phaseStability = report.samePhaseTransitions.gazeBodyPairs.phaseStability;
  verifyAnimatedPairPhaseStability(phaseStability, {
    label: `${label}.samePhaseTransitions.gazeBodyPairs.phaseStability`,
    gate: ANIMATED_GAZE_BODY_PHASE_STABILITY_GATE,
    directed: false,
    pairCount: 120,
    adjacentPairCount: 16,
    nonNeighborPairCount: 104,
    nonNeighborTransitionCount: 104 * ANIMATED_ATLAS_FRAME_COUNT,
    nonNeighborPairKeysSha256: ANIMATED_SAME_NON_NEIGHBOR_PAIR_KEYS_SHA256,
  });

  requireCondition(
    report.crossPhaseTransitions?.ok === true
      && deepEqual(report.crossPhaseTransitions?.gates, ANIMATED_SAME_PHASE_TRANSITION_GATES)
      && report.crossPhaseTransitions?.phaseWindowCount === ANIMATED_ATLAS_FRAME_COUNT
      && report.crossPhaseTransitions?.loopSeamWindowCount === 1
      && report.crossPhaseTransitions?.timedRowChanges?.count === ANIMATED_ATLAS_FRAME_COUNT * 72
      && report.crossPhaseTransitions?.timedRowChanges?.passing === ANIMATED_ATLAS_FRAME_COUNT * 72
      && report.crossPhaseTransitions?.gazeNeighborChanges?.count === ANIMATED_ATLAS_FRAME_COUNT * 32
      && report.crossPhaseTransitions?.gazeNeighborChanges?.passing === ANIMATED_ATLAS_FRAME_COUNT * 32
      && report.crossPhaseTransitions?.gazeTimedBoundaries?.count === ANIMATED_ATLAS_FRAME_COUNT * 192
      && report.crossPhaseTransitions?.gazeTimedBoundaries?.passing === ANIMATED_ATLAS_FRAME_COUNT * 192
      && report.crossPhaseTransitions?.gazeTimedBoundaries?.gazeToTimedCount
        === ANIMATED_ATLAS_FRAME_COUNT * 144
      && report.crossPhaseTransitions?.gazeTimedBoundaries?.eligibleTimedToGazeCount
        === ANIMATED_ATLAS_FRAME_COUNT * 48
      && report.crossPhaseTransitions?.gazeBodyNonNeighborChanges?.count
        === ANIMATED_ATLAS_FRAME_COUNT * 208
      && report.crossPhaseTransitions?.gazeBodyNonNeighborChanges?.passing
        === ANIMATED_ATLAS_FRAME_COUNT * 208,
    `${label} cross-phase host-boundary coverage is incomplete or failing`,
  );
  requireEmpty(report.crossPhaseTransitions, "failedTransitionIds", `${label}.crossPhaseTransitions`);
  verifyAnimatedWindowMembership(report.crossPhaseTransitions.membership, `${label}.crossPhaseTransitions.membership`);
  verifyAnimatedPairPhaseStability(
    report.crossPhaseTransitions.gazeBodyNonNeighborChanges.phaseStability,
    {
      label: `${label}.crossPhaseTransitions.gazeBodyNonNeighborChanges.phaseStability`,
      gate: ANIMATED_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      directed: true,
      pairCount: 208,
      adjacentPairCount: 0,
      nonNeighborPairCount: 208,
      nonNeighborTransitionCount: 208 * ANIMATED_ATLAS_FRAME_COUNT,
      nonNeighborPairKeysSha256: ANIMATED_CROSS_NON_NEIGHBOR_PAIR_KEYS_SHA256,
    },
  );

  const allFramePath = `qa/animated-atlas-temporal-all-frames-${variant}.png`;
  const allFrameArtifact = report.temporal.artifacts?.allFrameSheet;
  const allFrameBytes = await readFile(absolute(allFramePath));
  requireArtifactPath(allFrameArtifact?.path, allFramePath, `${label} all-frame sheet path`);
  requireCondition(
    allFrameArtifact.sha256 === sha256(allFrameBytes)
      && allFrameArtifact.variant === variant
      && allFrameArtifact.width === 176 + 192 * ANIMATED_ATLAS_FRAME_COUNT
      && allFrameArtifact.height === 15228
      && allFrameArtifact.frameCount === ANIMATED_ATLAS_FRAME_COUNT
      && allFrameArtifact.requiredCellCount === 73
      && allFrameArtifact.displayedCellFrames === 73 * ANIMATED_ATLAS_FRAME_COUNT
      && allFrameArtifact.sampling === "exact decoded 192x208 source cell on intended surface; no resampling"
      && deepEqual(allFrameArtifact.intendedSurfaceRgb, variant === "dark" ? [8, 11, 12] : [243, 241, 233]),
    `${label} all-frame image evidence is stale or incomplete`,
  );
  requireArray(allFrameArtifact.rowOrder, `${label} all-frame sheet rowOrder`);
  requireCondition(
    deepEqual(
      allFrameArtifact.rowOrder,
      report.temporal.cells.map(({ key, row, column, state }) => ({ key, row, column, state })),
    ),
    `${label} all-frame image row order does not cover every temporal cell`,
  );
  const allFrameMetadata = await sharp(allFrameBytes, { failOn: "error" }).metadata();
  requireCondition(
    allFrameMetadata.format === "png"
      && allFrameMetadata.width === allFrameArtifact.width
      && allFrameMetadata.height === allFrameArtifact.height,
    `${label} all-frame image metadata is stale`,
  );

  const worstCasePath = "qa/animated-atlas-temporal-worst-cases.png";
  const worstCaseArtifact = report.temporal.artifacts?.worstCaseSheet;
  const worstCaseBytes = await readFile(absolute(worstCasePath));
  requireArtifactPath(worstCaseArtifact?.path, worstCasePath, `${label} worst-case sheet path`);
  requireCondition(
    worstCaseArtifact.sha256 === sha256(worstCaseBytes)
      && worstCaseArtifact.rowCount === 28,
    `${label} worst-case image evidence is stale or incomplete`,
  );
  requireEmpty(report, "errors", label);
  return report;
}

async function verifyCombinedAnimatedAtlases(animatedReports, shippingAtlases) {
  const report = await readJson("qa/animated-atlas.json");
  const variants = 2;
  const coreHostBoundaryTransitions = variants * ANIMATED_ATLAS_FRAME_COUNT
    * (36 + 144 + 16 + 72 + 32 + 192);
  const supplementalSamePhaseNonNeighborGaze = variants
    * ANIMATED_ATLAS_FRAME_COUNT * 104;
  const supplementalCrossPhaseNonNeighborGaze = variants
    * ANIMATED_ATLAS_FRAME_COUNT * 208;
  const totalUniqueRuntimeTransitions = coreHostBoundaryTransitions
    + supplementalSamePhaseNonNeighborGaze
    + supplementalCrossPhaseNonNeighborGaze;
  requireCondition(report.schemaVersion === 1, "combined animated atlas schema must be 1");
  requireCondition(report.ok === true, "combined animated atlas QA must pass");
  requireCondition(
    deepEqual(report.contract, animatedReports.dark.contract)
      && deepEqual(animatedReports.light.contract, animatedReports.dark.contract),
    "combined animated atlas contract differs from a variant report",
  );
  for (const variant of VARIANT_NAMES) {
    requireCondition(
      deepEqual(report.variants?.[variant], expectedAnimatedCompact(animatedReports[variant], VARIANTS[variant])),
      `combined animated atlas ${variant} summary is stale`,
    );
    requireCondition(
      report.variants[variant].atlasSha256 === shippingAtlases[variant].sha256,
      `combined animated atlas ${variant} SHA is for different shipping bytes`,
    );
  }
  requireCondition(
    deepEqual(report.temporalCoverage, {
      variants: 2,
      requiredCellCountPerVariant: 73,
      frameCount: ANIMATED_ATLAS_FRAME_COUNT,
      transitionsPerVariant: 73 * ANIMATED_ATLAS_FRAME_COUNT,
      totalTransitions: 2 * 73 * ANIMATED_ATLAS_FRAME_COUNT,
      totalInternalTransitions: 2 * 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1),
      totalLoopSeams: 2 * 73,
      totalIsolatedFrameWindows: 2 * 73 * ANIMATED_ATLAS_FRAME_COUNT,
      totalFailingTransitions: 0,
      totalFailingIsolatedFrames: 0,
      displayed112: {
        totalTransitions: 2 * 73 * ANIMATED_ATLAS_FRAME_COUNT,
        totalInternalTransitions: 2 * 73 * (ANIMATED_ATLAS_FRAME_COUNT - 1),
        totalLoopSeams: 2 * 73,
        totalIsolatedFrameWindows: 2 * 73 * ANIMATED_ATLAS_FRAME_COUNT,
        totalFailingTransitions: 0,
        totalFailingIsolatedFrames: 0,
      },
    }),
    "combined animated atlas temporal coverage is incomplete or stale",
  );
  requireCondition(
    deepEqual(report.hostBoundaryCoverage, {
      samePhase: {
        timedRowPairs: variants * ANIMATED_ATLAS_FRAME_COUNT * 36,
        gazeTimedBoundaries: variants * ANIMATED_ATLAS_FRAME_COUNT * 144,
        gazeNeighborPairs: variants * ANIMATED_ATLAS_FRAME_COUNT * 16,
        gazeBodyPairs: variants * ANIMATED_ATLAS_FRAME_COUNT * 120,
        gazeBodyNonNeighborPairs: supplementalSamePhaseNonNeighborGaze,
      },
      crossPhase: {
        phaseWindows: variants * ANIMATED_ATLAS_FRAME_COUNT,
        loopSeamWindows: variants,
        timedRowChanges: variants * ANIMATED_ATLAS_FRAME_COUNT * 72,
        gazeNeighborChanges: variants * ANIMATED_ATLAS_FRAME_COUNT * 32,
        gazeTimedBoundaries: variants * ANIMATED_ATLAS_FRAME_COUNT * 192,
        gazeToTimed: variants * ANIMATED_ATLAS_FRAME_COUNT * 144,
        eligibleTimedToGaze: variants * ANIMATED_ATLAS_FRAME_COUNT * 48,
        gazeBodyNonNeighborChanges: supplementalCrossPhaseNonNeighborGaze,
      },
      disjointTotals: {
        coreRuntimeTransitions: coreHostBoundaryTransitions,
        supplementalSamePhaseNonNeighborGaze,
        supplementalCrossPhaseNonNeighborGaze,
        totalUniqueRuntimeTransitions,
      },
      displayed112: {
        variants,
        coreRuntimeTransitions: coreHostBoundaryTransitions,
        supplementalSamePhaseNonNeighborGaze,
        supplementalCrossPhaseNonNeighborGaze,
        totalUniqueRuntimeTransitions,
        totalFailingCoreTransitions: 0,
        exactMembership: true,
      },
      sourceCell: {
        variants,
        coreRuntimeTransitions: coreHostBoundaryTransitions,
        supplementalSamePhaseNonNeighborGaze,
        supplementalCrossPhaseNonNeighborGaze,
        totalUniqueRuntimeTransitions,
        totalFailingCoreTransitions: 0,
        exactMembership: true,
      },
    }),
    "combined animated atlas host-boundary coverage is incomplete or stale",
  );
  const reportedCoreHostBoundaryTransitions =
    report.hostBoundaryCoverage.samePhase.timedRowPairs
    + report.hostBoundaryCoverage.samePhase.gazeTimedBoundaries
    + report.hostBoundaryCoverage.samePhase.gazeNeighborPairs
    + report.hostBoundaryCoverage.crossPhase.timedRowChanges
    + report.hostBoundaryCoverage.crossPhase.gazeNeighborChanges
    + report.hostBoundaryCoverage.crossPhase.gazeTimedBoundaries;
  requireCondition(
    reportedCoreHostBoundaryTransitions === coreHostBoundaryTransitions
      && report.hostBoundaryCoverage.disjointTotals.coreRuntimeTransitions
        === coreHostBoundaryTransitions
      && report.hostBoundaryCoverage.disjointTotals.supplementalSamePhaseNonNeighborGaze
        === supplementalSamePhaseNonNeighborGaze
      && report.hostBoundaryCoverage.disjointTotals.supplementalCrossPhaseNonNeighborGaze
        === supplementalCrossPhaseNonNeighborGaze
      && report.hostBoundaryCoverage.disjointTotals.totalUniqueRuntimeTransitions
        === totalUniqueRuntimeTransitions,
    `combined animated atlas must judge the exact ${totalUniqueRuntimeTransitions.toLocaleString("en-US")} disjoint host-boundary comparisons`,
  );
  for (const [surface, coverage] of [
    ["sourceCell", report.hostBoundaryCoverage.sourceCell],
    ["displayed112", report.hostBoundaryCoverage.displayed112],
  ]) {
    requireCondition(
      coverage.variants === 2
        && coverage.coreRuntimeTransitions === coreHostBoundaryTransitions
        && coverage.supplementalSamePhaseNonNeighborGaze
          === supplementalSamePhaseNonNeighborGaze
        && coverage.supplementalCrossPhaseNonNeighborGaze
          === supplementalCrossPhaseNonNeighborGaze
        && coverage.totalUniqueRuntimeTransitions === totalUniqueRuntimeTransitions
        && coverage.totalFailingCoreTransitions === 0
        && coverage.exactMembership === true,
      `combined animated atlas ${surface} must judge the exact ${totalUniqueRuntimeTransitions.toLocaleString("en-US")} disjoint host boundaries`,
    );
  }
  requireCondition(
    report.crossTheme?.ok === true
      && report.crossTheme?.pageCountEqual === true
      && report.crossTheme?.delaysEqual === true
      && report.crossTheme?.completePageInspection === true
      && report.crossTheme?.identicalPerPageAlphaMasks === true
      && report.crossTheme?.identicalPerPageSilhouetteMetrics === true
      && report.crossTheme?.exhaustiveVisiblePairClassification === true
      && report.crossTheme?.gazeBodyPairPhaseParity === true
      && report.crossTheme?.crossPhaseGazeBodyPairPhaseParity === true
      && report.crossTheme?.sourceHostBoundaryParity === true
      && report.crossTheme?.displayed112HostBoundaryParity === true
      && report.crossTheme?.displayed112HostSamePhaseGazeBodyParity === true
      && report.crossTheme?.displayed112HostCrossPhaseGazeBodyParity === true,
    "combined animated atlas cross-theme proof failed",
  );
  requireArray(report.crossTheme?.pages, "combined animated atlas crossTheme.pages");
  requireCondition(
    report.crossTheme.pages.length === ANIMATED_ATLAS_FRAME_COUNT
      && report.crossTheme.pages.every((page, index) =>
        page.index === index
        && page.ok === true
        && page.visibleMasksEqual === true
        && page.alphaValuesEqual === true
        && page.silhouetteMetricsEqual === true
        && page.fullPixelThemeRelation?.ok === true
        && deepEqual(page.fullPixelThemeRelation?.gate, ANIMATED_THEME_RELATION_GATE)
        && page.fullPixelThemeRelation?.counts?.alphaMismatchPair === 0
        && page.fullPixelThemeRelation?.unclassifiedVisiblePairFraction
          <= ANIMATED_THEME_RELATION_GATE.maximumUnclassifiedVisiblePairFraction
        && page.fullPixelThemeRelation?.paletteRoleMismatchVisiblePairFraction
          <= ANIMATED_THEME_RELATION_GATE.maximumPaletteRoleMismatchVisiblePairFraction),
    "combined animated atlas cross-theme page coverage is incomplete",
  );
  requireEmpty(report.crossTheme, "errors", "combined animated atlas crossTheme");

  const darkGazeSeriesSha = animatedReports.dark.samePhaseTransitions.gazeBodyPairs
    .phaseStability.canonicalPairSequenceSha256;
  const lightGazeSeriesSha = animatedReports.light.samePhaseTransitions.gazeBodyPairs
    .phaseStability.canonicalPairSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkGazeSeriesSha)
      && /^[a-f0-9]{64}$/.test(lightGazeSeriesSha)
      && darkGazeSeriesSha === lightGazeSeriesSha,
    "combined animated atlas cross-theme gaze/body canonical series hashes differ",
  );
  requireCondition(
    report.crossTheme.gazeBodyPairPhaseSha256 === darkGazeSeriesSha,
    "combined animated atlas same-phase parity hash is stale",
  );
  const darkCrossGazeSeriesSha = animatedReports.dark.crossPhaseTransitions
    .gazeBodyNonNeighborChanges.phaseStability.canonicalPairSequenceSha256;
  const lightCrossGazeSeriesSha = animatedReports.light.crossPhaseTransitions
    .gazeBodyNonNeighborChanges.phaseStability.canonicalPairSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkCrossGazeSeriesSha)
      && /^[a-f0-9]{64}$/.test(lightCrossGazeSeriesSha)
      && darkCrossGazeSeriesSha === lightCrossGazeSeriesSha
      && report.crossTheme.crossPhaseGazeBodyPairPhaseSha256 === darkCrossGazeSeriesSha,
    "combined animated atlas cross-phase gaze/body canonical series hashes differ or are stale",
  );

  const darkSourceHostSha = animatedReports.dark.sourceHostBoundaries
    .canonicalAlphaSilhouetteSequenceSha256;
  const lightSourceHostSha = animatedReports.light.sourceHostBoundaries
    .canonicalAlphaSilhouetteSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkSourceHostSha)
      && /^[a-f0-9]{64}$/.test(lightSourceHostSha)
      && darkSourceHostSha === lightSourceHostSha
      && report.crossTheme.sourceHostBoundaryAlphaSilhouetteSha256 === darkSourceHostSha,
    "combined animated atlas source-cell host-boundary parity hash differs or is stale",
  );

  const darkDisplayedHostSha = animatedReports.dark.displayed112HostBoundaries
    .canonicalAlphaSilhouetteSequenceSha256;
  const lightDisplayedHostSha = animatedReports.light.displayed112HostBoundaries
    .canonicalAlphaSilhouetteSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkDisplayedHostSha)
      && /^[a-f0-9]{64}$/.test(lightDisplayedHostSha)
      && darkDisplayedHostSha === lightDisplayedHostSha
      && report.crossTheme.displayed112HostBoundaryAlphaSilhouetteSha256
        === darkDisplayedHostSha,
    "combined animated atlas exact default DPR2 host-boundary parity hash differs or is stale",
  );
  const darkDisplayedSameSha = animatedReports.dark.displayed112HostBoundaries.supplemental
    .samePhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256;
  const lightDisplayedSameSha = animatedReports.light.displayed112HostBoundaries.supplemental
    .samePhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkDisplayedSameSha)
      && /^[a-f0-9]{64}$/.test(lightDisplayedSameSha)
      && darkDisplayedSameSha === lightDisplayedSameSha
      && report.crossTheme.displayed112HostSamePhaseGazeBodySha256
        === darkDisplayedSameSha,
    "combined animated atlas exact default DPR2 same-phase gaze/body parity hash differs or is stale",
  );
  const darkDisplayedCrossSha = animatedReports.dark.displayed112HostBoundaries.supplemental
    .crossPhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256;
  const lightDisplayedCrossSha = animatedReports.light.displayed112HostBoundaries.supplemental
    .crossPhaseNonNeighborGaze.phaseStability.canonicalPairSequenceSha256;
  requireCondition(
    /^[a-f0-9]{64}$/.test(darkDisplayedCrossSha)
      && /^[a-f0-9]{64}$/.test(lightDisplayedCrossSha)
      && darkDisplayedCrossSha === lightDisplayedCrossSha
      && report.crossTheme.displayed112HostCrossPhaseGazeBodySha256
        === darkDisplayedCrossSha,
    "combined animated atlas exact default DPR2 cross-phase gaze/body parity hash differs or is stale",
  );

  requireCondition(
    report.temporalArtifacts
      && typeof report.temporalArtifacts === "object"
      && report.temporalArtifacts.allFrameSheets
      && report.temporalArtifacts.worstCaseSheet,
    "combined animated atlas temporal artifact records are missing",
  );
  for (const variant of VARIANT_NAMES) {
    requireCondition(
      deepEqual(
        report.temporalArtifacts?.allFrameSheets?.[variant],
        animatedReports[variant].temporal.artifacts.allFrameSheet,
      ),
      `combined animated atlas ${variant} all-frame artifact differs from its variant report`,
    );
  }
  const worstCase = report.temporalArtifacts.worstCaseSheet;
  const worstCasePath = "qa/animated-atlas-temporal-worst-cases.png";
  const worstCaseBytes = await readFile(absolute(worstCasePath));
  requireArtifactPath(worstCase?.path, worstCasePath, "combined animated atlas worst-case sheet path");
  requireCondition(
    worstCase.sha256 === sha256(worstCaseBytes)
      && worstCase.width === 796
      && worstCase.height === 5868
      && worstCase.rowCount === 28
      && worstCase.sampling === "exact decoded 192x208 source cell on intended surface; no resampling",
    "combined animated atlas worst-case image evidence is stale or incomplete",
  );
  requireArray(worstCase.rows, "combined animated atlas worst-case rows");
  requireCondition(
    worstCase.rows.length === 28
      && VARIANT_NAMES.every((variant) => worstCase.rows.filter((row) => row.variant === variant).length === 14),
    "combined animated atlas worst-case rows must cover 14 cases per theme",
  );
  for (const [index, row] of worstCase.rows.entries()) {
    requireCondition(
      VARIANT_NAMES.includes(row.variant)
        && /^r(?:[0-9]|10)c[0-7]$/.test(row.cellKey)
        && Number.isInteger(row.fromPage)
        && row.fromPage >= 0
        && row.fromPage < ANIMATED_ATLAS_FRAME_COUNT
        && row.toPage === (row.fromPage + 1) % ANIMATED_ATLAS_FRAME_COUNT
        && row.seam === (row.fromPage === ANIMATED_ATLAS_FRAME_COUNT - 1),
      `combined animated atlas worst-case row ${index} is not a valid inspected transition`,
    );
    requireEmpty(row, "flags", `combined animated atlas worst-case row ${index}`);
  }
  const worstCaseMetadata = await sharp(worstCaseBytes, { failOn: "error" }).metadata();
  requireCondition(
    worstCaseMetadata.format === "png"
      && worstCaseMetadata.width === worstCase.width
      && worstCaseMetadata.height === worstCase.height,
    "combined animated atlas worst-case image metadata is stale",
  );
  requireEmpty(report, "errors", "combined animated atlas");
}

async function verifyContinuity(variant, authoringAtlas) {
  const relative = `qa/look-continuity-${variant}.json`;
  const report = await readJson(relative);
  verifyEmbeddedShas(report, `${variant} look continuity`, { atlasSha: authoringAtlas.sha256 });
  requireCondition(
    report.ok === true && report.reviewRequired === false,
    `${variant} look continuity must pass without review`,
  );
  requireArray(report.pairs, `${variant} look continuity.pairs`);
  requireCondition(report.pairs.length === 16, `${variant} look continuity must cover all 16 transitions`);
  requireEmpty(report, "warnings", `${variant} look continuity`);
  requireEmpty(report, "alphaHoles", `${variant} look continuity`);
}

async function verifyDirectionSemantics(variant, config, authoringAtlas) {
  const relative = `qa/direction-semantics-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} direction semantics schema must be 1`);
  requireCondition(report.variant === undefined || report.variant === variant, `${variant} direction semantics variant is wrong`);
  requireCondition(report.petId === undefined || report.petId === config.id, `${variant} direction semantics petId is wrong`);
  requireCondition(
    embeddedSha(report, "atlasSha256", "atlas_sha256") === authoringAtlas.sha256,
    `${variant} direction semantics are for a different authoring atlas`,
  );
  verifyEmbeddedShas(report, `${variant} direction semantics`, { atlasSha: authoringAtlas.sha256 });
  requireCondition(report.ok === true, `${variant} direction semantics must pass`);
  requireArray(report.directions, `${variant} direction semantics.directions`);
  requireCondition(report.directions.length === 16, `${variant} direction semantics must cover 16 poses`);
  for (const [index, expected] of EXPECTED_DIRECTIONS.entries()) {
    const entry = report.directions[index];
    requireCondition(
      entry.angle === expected.angle
        && entry.row === expected.row
        && entry.column === expected.column
        && entry.frame === expected.frame,
      `${variant} direction semantics entry ${index} does not identify the expected pose`,
    );
    requireCondition(entry.pass === true, `${variant} direction semantics ${expected.frame} failed`);
    requireCondition(typeof entry.observation === "string" && entry.observation.length >= 10, `${variant} direction semantics ${expected.frame} lacks an observation`);
  }
  requireCondition(typeof report.reviewer?.kind === "string" && report.reviewer.kind.length > 0, `${variant} direction semantics reviewer is missing`);
  requireCondition(typeof report.method === "string" && report.method.length >= 30, `${variant} direction semantics method is incomplete`);
  const directionSheetPath = `qa/look-directions-${variant}.png`;
  requireArtifactPath(report.reviewedArtifact?.path, directionSheetPath, `${variant} direction semantics reviewedArtifact.path`);
  requireCondition(
    report.reviewedArtifact?.sha256 === sha256(await readFile(absolute(directionSheetPath))),
    `${variant} direction semantics reviewed direction sheet SHA is stale`,
  );
  requireEmpty(report, "issues", `${variant} direction semantics`);
  requireEmptyIfPresent(report, "warnings", `${variant} direction semantics`);
}

async function verifyFinalVisualReview(variant, config, authoringAtlas) {
  const relative = `qa/final-visual-review-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 2, `${variant} final visual review schema must be 2`);
  requireCondition(report.variant === undefined || report.variant === variant, `${variant} final visual review variant is wrong`);
  requireCondition(report.petId === undefined || report.petId === config.id, `${variant} final visual review petId is wrong`);
  requireCondition(
    report.authoringAtlasSha256 === authoringAtlas.sha256,
    `${variant} final visual review is for a different authoring atlas`,
  );
  requireCondition(
    report.shippingAtlasSha256 === sha256(await readFile(absolute(config.atlasPath))),
    `${variant} final visual review is for a different shipping atlas`,
  );
  requireCondition(report.ok === true, `${variant} final visual review must pass`);
  requireCondition(typeof report.reviewer?.kind === "string" && report.reviewer.kind.length > 0, `${variant} final visual review reviewer is missing`);
  requireCondition(typeof report.reviewer?.name === "string" && report.reviewer.name.length > 0, `${variant} final visual review reviewer name is missing`);
  requireCondition(typeof report.method === "string" && report.method.length >= 60, `${variant} final visual review method is incomplete`);
  requireCondition(/^\d{4}-\d{2}-\d{2}T/.test(report.reviewedAt), `${variant} final visual review timestamp is invalid`);
  requireCondition(deepEqual(report.coverage?.installedRows, TIMED_ROW_IDS), `${variant} final visual review did not cover all installed rows`);
  requireCondition(deepEqual(report.coverage?.gazeAngles, EXPECTED_DIRECTIONS.map(({ angle }) => angle)), `${variant} final visual review did not cover all gaze angles`);
  requireCondition(deepEqual(report.coverage?.characterStates, GROK_STATES), `${variant} final visual review did not cover all 39 character states`);
  requireCondition(deepEqual(report.coverage?.effects, SOURCE_EFFECTS), `${variant} final visual review did not cover all 14 effects`);
  requireCondition(deepEqual(report.coverage?.runtimePreviews, TIMED_ROW_IDS), `${variant} final visual review did not cover all runtime previews`);
  requireArray(report.reviewedArtifacts, `${variant} final visual review.reviewedArtifacts`);
  const expectedPaths = finalReviewArtifactPaths(variant);
  requireCondition(report.reviewedArtifacts.length === expectedPaths.length, `${variant} final visual review artifact coverage is incomplete`);
  requireCondition(
    deepEqual(report.reviewedArtifacts.map(({ path: artifactPath }) => artifactPath), expectedPaths),
    `${variant} final visual review artifact order or set is wrong`,
  );
  for (const [index, artifact] of report.reviewedArtifacts.entries()) {
    requireArtifactPath(artifact.path, expectedPaths[index], `${variant} final visual review artifact ${index}.path`);
    requireCondition(
      artifact.sha256 === sha256(await readFile(absolute(expectedPaths[index]))),
      `${variant} final visual review artifact ${expectedPaths[index]} SHA is stale`,
    );
  }
  requireArray(report.observations, `${variant} final visual review.observations`);
  requireCondition(report.observations.length >= 5, `${variant} final visual review needs concrete observations`);
  requireCondition(report.observations.every((entry) => typeof entry === "string" && entry.length >= 20), `${variant} final visual review contains a terse observation`);
  requireEmpty(report, "blockingIssues", `${variant} final visual review`);
  requireEmptyIfPresent(report, "warnings", `${variant} final visual review`);
}

function runtimeThresholdCheck(id, actual, expected, operator = "maximum") {
  return {
    id,
    actual,
    [operator === "equal" ? "expected" : "maximum"]: expected,
    operator,
    pass: operator === "equal" ? actual === expected : actual <= expected,
  };
}

function expectedRuntimeThemeValidation(report) {
  const all = report.summary?.allTransitions;
  const checks = [
    runtimeThresholdCheck("transition-count", all?.transitionCount, RUNTIME_CONTINUITY_THRESHOLDS.requiredTransitionCount, "equal"),
    runtimeThresholdCheck("normalized-alpha-difference", all?.normalizedAlphaDifference?.max?.value, RUNTIME_CONTINUITY_THRESHOLDS.maximumNormalizedAlphaDifference),
    runtimeThresholdCheck("composited-rgb-difference", all?.normalizedCompositedRgbDifference?.max?.value, RUNTIME_CONTINUITY_THRESHOLDS.maximumNormalizedCompositedRgbDifference),
    runtimeThresholdCheck("changed-pixel-fraction", all?.changedPixelFraction?.max?.value, RUNTIME_CONTINUITY_THRESHOLDS.maximumChangedPixelFraction),
    runtimeThresholdCheck("alpha-area-ratio-symmetric", all?.alphaAreaRatioSymmetric?.max?.value, RUNTIME_CONTINUITY_THRESHOLDS.maximumAlphaAreaRatioSymmetric),
    ...(report.rows ?? []).map((row) => ({
      id: `row-${row.row}-${row.id}-motion-gate`,
      actual: row.motionGateValidation?.ok,
      expected: true,
      operator: "equal",
      pass: row.motionGateValidation?.ok === true,
    })),
  ];
  return { ok: checks.every((check) => check.pass), checks };
}

async function verifyRuntimeContinuity(variant, authoringAtlas) {
  const relative = `qa/runtime-continuity-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 2, `${variant} runtime continuity schema must be 2`);
  requireCondition(report.kind === "codex-pet-runtime-continuity-theme", `${variant} runtime continuity kind is wrong`);
  requireCondition(report.theme === variant, `${variant} runtime continuity theme is wrong`);
  requireCondition(report.ok === true, `${variant} runtime continuity thresholds failed`);
  requireCondition(report.measurementPolicy === RUNTIME_CONTINUITY_POLICY, `${variant} runtime continuity policy changed`);
  requireCondition(deepEqual(report.thresholds, RUNTIME_CONTINUITY_THRESHOLDS), `${variant} runtime continuity thresholds changed`);
  requireCondition(
    report.atlas?.sha256 === authoringAtlas.sha256,
    `${variant} runtime continuity is for a different authoring atlas`,
  );
  requireCondition(report.atlas?.width === 1536 && report.atlas?.height === 2288 && report.atlas?.channels === 4, `${variant} runtime continuity atlas dimensions are wrong`);
  requireArtifactPath(
    report.atlas?.path,
    VARIANTS[variant].authoringAtlasPath,
    `${variant} runtime continuity atlas.path`,
  );
  requireArray(report.rows, `${variant} runtime continuity.rows`);
  requireCondition(report.rows.length === TIMED_ROW_IDS.length, `${variant} runtime continuity must cover all timed rows`);
  requireCondition(
    report.rows.every((row, index) => row.row === index && row.id === TIMED_ROW_IDS[index]),
    `${variant} runtime continuity row order is wrong`,
  );
  requireCondition(
    report.summary?.allTransitions?.transitionCount === 65,
    `${variant} runtime continuity must measure all 65 unique runtime transitions`,
  );
  requireCondition(
    deepEqual(report.validation, expectedRuntimeThemeValidation(report)) && report.validation.ok === true,
    `${variant} runtime continuity threshold results are stale or failing`,
  );
  requireArray(report.previews, `${variant} runtime continuity.previews`);
  requireCondition(report.previews.length === TIMED_ROW_IDS.length, `${variant} runtime continuity must include 9 previews`);
  const expectedPaths = runtimePreviewPaths(variant);
  for (const [index, preview] of report.previews.entries()) {
    const label = `${variant} runtime preview ${index}`;
    requireCondition(preview.row === index && preview.rowId === TIMED_ROW_IDS[index], `${label} row identity is wrong`);
    requireArtifactPath(preview.path, expectedPaths[index], `${label}.path`);
    const bytes = await readFile(absolute(expectedPaths[index]));
    requireCondition(preview.sha256 === sha256(bytes), `${label} SHA is stale`);
    requireCondition(preview.pages === preview.frameCount && preview.pages > 0, `${label} page count is invalid`);
    requireCondition(preview.pageHeight === 208, `${label} page height must be 208`);
    requireCondition(preview.includesOneSlowIdleCycle === true, `${label} must include one slow idle cycle`);
    requireCondition(index === 0 ? preview.actionCycles === 0 : preview.actionCycles === 3, `${label} action cycle count is wrong`);
    requireCondition(preview.sequence?.length === preview.frameCount, `${label} sequence length is wrong`);
    requireCondition(
      preview.sequence?.reduce((total, frame) => total + frame.delayMs, 0) === preview.totalDurationMs,
      `${label} duration does not match its frame sequence`,
    );
  }
  return report;
}

async function verifyVariant(variant, config, shippingAtlas, authoringAtlas) {
  const { manifest, evidence: manifestEvidence } = await verifyManifest(variant, config);
  await verifyCustomValidation(variant, config, shippingAtlas, authoringAtlas, manifest);
  await verifyOfficialValidation(variant, config, authoringAtlas);
  const animatedReport = await verifyAnimatedAtlas(variant, config, shippingAtlas, manifest);
  await verifyContinuity(variant, authoringAtlas);
  await verifyDirectionSemantics(variant, config, authoringAtlas);
  await verifyFinalVisualReview(variant, config, authoringAtlas);
  await verifyRuntimeContinuity(variant, authoringAtlas);
  return {
    manifest: manifestEvidence,
    animatedReport,
    assertions: Object.freeze({
      manifestIdentity: true,
      customValidator: true,
      officialValidator: true,
      animatedAtlasAllPages: true,
      alphaClean: true,
      directionContinuity: true,
      directionSemantics: true,
      finalVisualReview: true,
      runtimeContinuity: true,
      runtimePreviewByteChecks: true,
    }),
  };
}

async function verifyThemeParity(authoringAtlases) {
  const report = await readJson("qa/theme-parity.json");
  requireCondition(report.schemaVersion === 1, "theme parity schema must be 1");
  requireCondition(report.ok === true, "theme parity must pass");
  verifyEmbeddedShas(report, "theme parity", {
    darkAtlasSha: authoringAtlases.dark.sha256,
    lightAtlasSha: authoringAtlases.light.sha256,
  });
  requireCondition(report.darkAtlasSha256 === authoringAtlases.dark.sha256, "theme parity dark authoring atlas SHA is stale");
  requireCondition(report.lightAtlasSha256 === authoringAtlases.light.sha256, "theme parity light authoring atlas SHA is stale");
  requireCondition(
    report.dimensions?.width === 1536
      && report.dimensions?.height === 2288
      && report.dimensions?.channels === 4,
    "theme parity dimensions are wrong",
  );
  requireCondition(
    authoringAtlases.dark.alphaMaskSha256 === authoringAtlases.light.alphaMaskSha256,
    "theme authoring atlas alpha masks differ",
  );
  requireCondition(report.alphaMismatchPixels === 0, "theme parity found alpha-mask mismatches");
  requireCondition(
    report.alphaMaskSha256?.dark === authoringAtlases.dark.alphaMaskSha256
      && report.alphaMaskSha256?.light === authoringAtlases.light.alphaMaskSha256,
    "theme parity alpha-mask SHA is stale",
  );
  requireCondition(deepEqual(report.accentColors, ACCENT_COLORS), "theme parity accent palette is wrong");
  requireEmpty(report, "errors", "theme parity");
  requireArray(report.warnings, "theme parity.warnings");

  for (const variant of VARIANT_NAMES) {
    const documented = report.exactAccentColorPixels?.[variant];
    const actual = authoringAtlases[variant].exactAccentColorPixels;
    requireCondition(
      deepEqual(documented, actual),
      `theme parity exact color counts are stale for ${variant}`,
    );
    requireCondition(documented.body >= 10_000, `theme parity ${variant} body color is missing`);
    requireCondition(documented.eyes >= 1_000, `theme parity ${variant} eye color is missing`);
    for (const name of Object.keys(ACCENT_COLORS)) {
      requireCondition(documented[name] > 0, `theme parity ${variant} accent ${name} is missing`);
    }
  }
}

async function verifyAlphaEdges(authoringAtlases) {
  for (const variant of VARIANT_NAMES) {
    const report = await inspectAlphaEdgeQuality(absolute(VARIANTS[variant].authoringAtlasPath));
    requireCondition(report.ok === true, `${variant} authoring atlas alpha-edge quality must pass`);
    requireCondition(report.populatedCellCount === 73, `${variant} alpha-edge QA must inspect 73 authored cells`);
    requireArray(report.cells, `${variant} alpha-edge QA.cells`);
    requireCondition(report.cells.length === 73, `${variant} alpha-edge QA cell coverage is incomplete`);
    requireEmpty(report, "errors", `${variant} alpha-edge QA`);
    requireCondition(
      authoringAtlases[variant].path === VARIANTS[variant].authoringAtlasPath,
      `${variant} alpha-edge QA was not bound to the authoring atlas`,
    );
  }
}

async function verifyCombinedRuntimeContinuity(authoringAtlases) {
  const report = await readJson("qa/runtime-continuity.json");
  requireCondition(report.schemaVersion === 2, "combined runtime continuity schema must be 2");
  requireCondition(report.kind === "codex-pet-runtime-continuity", "combined runtime continuity kind is wrong");
  requireCondition(report.ok === true, "combined runtime continuity thresholds failed");
  requireCondition(report.measurementPolicy === RUNTIME_CONTINUITY_POLICY, "combined runtime continuity policy changed");
  requireCondition(deepEqual(report.thresholds, RUNTIME_CONTINUITY_THRESHOLDS), "combined runtime continuity thresholds changed");
  const [dark, light] = await Promise.all([
    readJson("qa/runtime-continuity-dark.json"),
    readJson("qa/runtime-continuity-light.json"),
  ]);
  requireCondition(deepEqual(report.themes?.dark, dark), "combined runtime continuity dark report is stale");
  requireCondition(deepEqual(report.themes?.light, light), "combined runtime continuity light report is stale");
  requireCondition(
    dark.atlas?.sha256 === authoringAtlases.dark.sha256,
    "combined runtime continuity dark authoring atlas SHA is stale",
  );
  requireCondition(
    light.atlas?.sha256 === authoringAtlases.light.sha256,
    "combined runtime continuity light authoring atlas SHA is stale",
  );
  requireCondition(report.themeParity?.comparedTransitions === 65, "runtime theme parity must compare all 65 transitions");
  requireCondition(report.themeParity?.exactMetricMismatches === 0, "runtime theme parity has alpha-geometry metric mismatches");
  requireCondition(report.themeParity?.maximumAbsoluteDelta === 0, "runtime theme parity maximum alpha-geometry delta must be zero");
  const combinedChecks = [
    runtimeThresholdCheck("theme-count", 2, 2, "equal"),
    runtimeThresholdCheck("theme-parity-transition-count", report.themeParity.comparedTransitions, RUNTIME_CONTINUITY_THRESHOLDS.requiredTransitionCount, "equal"),
    runtimeThresholdCheck("theme-parity-exact-mismatches", report.themeParity.exactMetricMismatches, 0, "equal"),
    runtimeThresholdCheck("theme-parity-maximum-delta", report.themeParity.maximumAbsoluteDelta, 0, "equal"),
    { id: "dark-thresholds", actual: dark.validation?.ok, expected: true, operator: "equal", pass: dark.validation?.ok === true },
    { id: "light-thresholds", actual: light.validation?.ok, expected: true, operator: "equal", pass: light.validation?.ok === true },
  ];
  requireCondition(
    deepEqual(report.validation, { ok: combinedChecks.every((check) => check.pass), checks: combinedChecks }),
    "combined runtime continuity threshold results are stale",
  );
}

async function verifySourceMotionStudies() {
  const relative = "preview/source-lab/motion/manifest.json";
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, "source motion manifest schema must be 1");
  requireCondition(report.kind === "grok-bot-motion-studies", "source motion manifest kind is wrong");
  requireCondition(deepEqual(report.encoder, SOURCE_MOTION_ENCODER), "source motion encoder record differs from the sealed generator runtime");
  requireCondition(report.frameRate === 60, "source motion studies must be rendered at 60 fps");
  requireCondition(report.activeSeconds === 1.8 && report.releaseSeconds === 0.8, "source motion study timing is wrong");
  requireCondition(report.nominalFrameCount === 156, "source motion nominal frame count is wrong");
  requireCondition(report.presentationDurationMs === 2600, "source motion presentation must be exactly 2.6 seconds at 60 fps");
  requireCondition(report.maximumAllowedActiveHoldMs === 34, "source motion active-frame hold limit must be 34ms");
  requireCondition(report.rasterScale === 3, "source motion raster scale must be 3x");
  requireCondition(report.frameWidth === 576 && report.frameHeight === 624, "source motion frame dimensions are wrong");
  requireCondition(report.displayWidthCssPx === 288, "source motion display width is wrong");
  requireCondition(
    report.spring?.damping === 28
      && report.spring?.stiffness === 196
      && report.spring?.maximumStepSeconds === 1 / 120,
    "source motion activation spring differs from the character motion model",
  );
  requireCondition(report.inputs && typeof report.inputs === "object", "source motion manifest inputs are missing");
  requireCondition(deepEqual(Object.keys(report.inputs), SOURCE_MOTION_INPUTS), "source motion manifest input set or order is incomplete");
  for (const [inputPath, documentedSha] of Object.entries(report.inputs)) {
    const inputBytes = await readFile(absolute(inputPath));
    requireCondition(documentedSha === sha256(inputBytes), `source motion input SHA is stale for ${inputPath}`);
  }
  requireArray(report.assets, "source motion manifest.assets");
  requireCondition(report.assets.length === sourceMotionPaths.length, "source motion manifest must cover 14 effects in both themes");
  const expectedPathSet = new Set(sourceMotionPaths);
  const actualPaths = report.assets.map((asset) => asset.path);
  requireCondition(new Set(actualPaths).size === sourceMotionPaths.length, "source motion manifest asset paths must be unique");
  requireCondition(actualPaths.every((assetPath) => expectedPathSet.has(assetPath)), "source motion manifest contains an unexpected asset path");
  requireCondition(sourceMotionPaths.every((assetPath) => actualPaths.includes(assetPath)), "source motion manifest is missing an expected asset path");
  for (const asset of report.assets) {
    const label = `source motion ${asset.theme}/${asset.effect}`;
    requireCondition(["dark", "light"].includes(asset.theme), `${label} theme is invalid`);
    requireCondition(SOURCE_EFFECTS.includes(asset.effect), `${label} effect is invalid`);
    const bytes = await readFile(absolute(asset.path));
    requireCondition(asset.sha256 === sha256(bytes), `${label} SHA is stale`);
    requireCondition(asset.pageHeight === 624, `${label} page height must be 624`);
    requireCondition(asset.pages >= 75 && asset.pages <= report.nominalFrameCount, `${label} page count is outside the lossless animation bounds`);
    requireCondition(asset.loop === 0, `${label} must loop continuously for the preview bench`);
    requireCondition(asset.durationMs === report.presentationDurationMs, `${label} duration is wrong`);
    requireCondition(asset.maximumActiveHoldMs <= report.maximumAllowedActiveHoldMs, `${label} contains an unintended active-frame hold`);
  }
}

function atlasCellPixels(atlasPixels, atlasWidth, row, column) {
  const cell = Buffer.alloc(192 * 208 * 4);
  for (let y = 0; y < 208; y += 1) {
    const sourceStart = (((row * 208 + y) * atlasWidth) + column * 192) * 4;
    const targetStart = y * 192 * 4;
    atlasPixels.copy(cell, targetStart, sourceStart, sourceStart + 192 * 4);
  }
  return cell;
}

async function verifySealedImage(record, expectedPath, label) {
  requireArtifactPath(record?.path, expectedPath, `${label}.path`);
  const bytes = await readFile(absolute(expectedPath));
  requireCondition(record.sha256 === sha256(bytes), `${label} SHA is stale`);
  requireCondition(record.bytes === bytes.length, `${label} byte count is stale`);
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  requireCondition(record.width === metadata.width && record.height === metadata.height, `${label} dimensions are stale`);
  return { bytes, metadata };
}

async function verifyOfficialHatchSeal(authoringAtlases) {
  const report = await readJson("qa/official-hatch-qa.json");
  requireCondition(report.schemaVersion === 1, "official hatch seal schema must be 1");
  requireCondition(report.kind === "codex-pet-official-hatch-qa-seal", "official hatch seal kind is wrong");
  requireCondition(report.ok === true, "official hatch seal must pass");
  requireCondition(
    deepEqual(Object.keys(report.officialScripts ?? {}).sort(), Object.keys(OFFICIAL_SCRIPT_SHAS).sort()),
    "official hatch seal script set is wrong",
  );
  for (const [scriptName, expectedSha] of Object.entries(OFFICIAL_SCRIPT_SHAS)) {
    const record = report.officialScripts[scriptName];
    requireArtifactSuffix(record?.path, scriptName, `official script ${scriptName}`);
    requireCondition(record.sha256 === expectedSha, `official script ${scriptName} SHA is not the audited hatch tool`);
  }
  requireArray(report.verification, "official hatch seal.verification");
  requireCondition(report.verification.length >= 4, "official hatch seal verification attestation is incomplete");
  requireArray(report.limitations, "official hatch seal.limitations");

  for (const variant of VARIANT_NAMES) {
    const config = VARIANTS[variant];
    const theme = report.themes?.[variant];
    const label = `${variant} official hatch seal`;
    requireCondition(theme && typeof theme === "object", `${label} theme record is missing`);
    requireArtifactPath(theme.atlas?.path, config.authoringAtlasPath, `${label}.atlas.path`);
    requireCondition(theme.atlas?.sha256 === authoringAtlases[variant].sha256, `${label} authoring atlas SHA is stale`);
    requireCondition(theme.atlas?.width === 1536 && theme.atlas?.height === 2288 && theme.atlas?.channels === 4, `${label} atlas dimensions are wrong`);

    const atlasBytes = await readFile(absolute(config.authoringAtlasPath));
    const atlasDecoded = await sharp(atlasBytes, { failOn: "error" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    requireCondition(theme.atlas.decodedRgbaSha256 === sha256(atlasDecoded.data), `${label} decoded atlas SHA is stale`);

    const officialValidationPath = `qa/official-validation-${variant}.json`;
    requireArtifactPath(theme.officialValidation?.path, officialValidationPath, `${label}.officialValidation.path`);
    const validationBytes = await readFile(absolute(officialValidationPath));
    requireCondition(theme.officialValidation.sha256 === sha256(validationBytes), `${label} official validation hash is stale`);
    requireCondition(
      theme.officialValidation.ok === false
        && theme.officialValidation.acceptedKnownNeutralCellMismatch === true
        && theme.officialValidation.errors === 1
        && theme.officialValidation.warnings === 0,
      `${label} official validation summary does not match the audited v2 neutral-cell diagnostic`,
    );

    const frameManifestPath = `qa/official-frames-${variant}/manifest.json`;
    requireArtifactPath(theme.frameExtraction?.path, frameManifestPath, `${label}.frameExtraction.path`);
    const frameManifestBytes = await readFile(absolute(frameManifestPath));
    requireCondition(theme.frameExtraction.sha256 === sha256(frameManifestBytes), `${label} frame manifest hash is stale`);
    requireCondition(theme.frameExtraction.frameCount === 57 && theme.frameExtraction.pixelIdentityVerified === true, `${label} frame extraction attestation is incomplete`);
    const frameManifest = JSON.parse(frameManifestBytes.toString("utf8"));
    requireCondition(frameManifest.schemaVersion === 1 && frameManifest.kind === "codex-pet-official-preview-frame-extraction", `${label} frame manifest schema is wrong`);
    requireCondition(frameManifest.variant === variant, `${label} frame manifest variant is wrong`);
    requireCondition(
      frameManifest.atlas?.sha256 === authoringAtlases[variant].sha256,
      `${label} frame manifest authoring atlas SHA is stale`,
    );
    requireCondition(frameManifest.atlas?.decodedRgbaSha256 === theme.atlas.decodedRgbaSha256, `${label} frame manifest decoded atlas SHA is stale`);
    requireArray(frameManifest.frames, `${label} frame manifest.frames`);
    requireCondition(frameManifest.frames.length === 57, `${label} frame manifest must contain 57 frames`);
    const seenCells = new Set();
    for (const frame of frameManifest.frames) {
      const expectedDurations = OFFICIAL_ROW_DURATIONS[frame.state];
      requireCondition(expectedDurations !== undefined, `${label} frame has unknown state ${frame.state}`);
      requireCondition(TIMED_ROW_IDS[frame.row] === frame.state, `${label} frame row/state mismatch`);
      requireCondition(frame.column >= 0 && frame.column < expectedDurations.length, `${label} frame column is invalid`);
      requireCondition(frame.durationMs === expectedDurations[frame.column], `${label} frame duration is wrong`);
      const cellId = `${frame.row}:${frame.column}`;
      requireCondition(!seenCells.has(cellId), `${label} duplicates cell ${cellId}`);
      seenCells.add(cellId);
      const expectedPath = `qa/official-frames-${variant}/${frame.state}/${String(frame.column).padStart(2, "0")}.png`;
      requireArtifactPath(frame.path, expectedPath, `${label} frame.path`);
      const pngBytes = await readFile(absolute(expectedPath));
      requireCondition(frame.pngSha256 === sha256(pngBytes), `${label} ${expectedPath} PNG SHA is stale`);
      const pngDecoded = await sharp(pngBytes, { failOn: "error" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      requireCondition(pngDecoded.info.width === 192 && pngDecoded.info.height === 208 && pngDecoded.info.channels === 4, `${label} ${expectedPath} dimensions are wrong`);
      const expectedPixels = atlasCellPixels(atlasDecoded.data, atlasDecoded.info.width, frame.row, frame.column);
      requireCondition(frame.rgbaSha256 === sha256(expectedPixels), `${label} ${expectedPath} RGBA SHA is stale`);
      requireCondition(pngDecoded.data.equals(expectedPixels), `${label} ${expectedPath} is not pixel-identical to its atlas cell`);
    }
    requireCondition(seenCells.size === 57, `${label} frame manifest cell coverage is incomplete`);

    await verifySealedImage(theme.contactSheet, `qa/contact-sheet-${variant}.png`, `${label} contact sheet`);
    await verifySealedImage(theme.lookDirectionSheet, `qa/look-directions-${variant}.png`, `${label} look direction sheet`);

    const continuityPath = `qa/look-continuity-${variant}.json`;
    requireArtifactPath(theme.lookContinuity?.path, continuityPath, `${label}.lookContinuity.path`);
    const continuityBytes = await readFile(absolute(continuityPath));
    requireCondition(theme.lookContinuity.sha256 === sha256(continuityBytes), `${label} look continuity hash is stale`);
    requireCondition(theme.lookContinuity.ok === true && theme.lookContinuity.pairCount === 16 && theme.lookContinuity.warnings === 0 && theme.lookContinuity.alphaHoles === 0, `${label} look continuity summary failed`);

    requireArray(theme.animatedPreviews, `${label}.animatedPreviews`);
    requireCondition(theme.animatedPreviews.length === TIMED_ROW_IDS.length, `${label} must contain 9 official GIFs`);
    for (const [index, preview] of theme.animatedPreviews.entries()) {
      const state = TIMED_ROW_IDS[index];
      const expectedPath = officialPreviewPaths(variant)[index];
      requireCondition(preview.state === state, `${label} GIF state order is wrong`);
      requireArtifactPath(preview.path, expectedPath, `${label} GIF path`);
      const gifBytes = await readFile(absolute(expectedPath));
      requireCondition(preview.sha256 === sha256(gifBytes) && preview.bytes === gifBytes.length, `${label} ${state} GIF hash or size is stale`);
      const metadata = await sharp(gifBytes, { animated: true, failOn: "error" }).metadata();
      requireCondition(metadata.format === "gif" && metadata.width === 192 && metadata.pageHeight === 208, `${label} ${state} GIF format is wrong`);
      requireCondition(metadata.pages === OFFICIAL_ROW_DURATIONS[state].length && metadata.loop === 0, `${label} ${state} GIF frame count or loop is wrong`);
      requireCondition(deepEqual(metadata.delay, OFFICIAL_ROW_DURATIONS[state]), `${label} ${state} GIF timing is wrong`);
      requireCondition(preview.frames === metadata.pages && preview.loop === metadata.loop && deepEqual(preview.durationsMs, metadata.delay), `${label} ${state} GIF seal metadata is stale`);
    }
  }
}

function pairIds(report, label) {
  requireArray(report.pairs, `${label}.pairs`);
  requireCondition(report.pairs.length === 14, `${label} must contain 14 pairs`);
  const ids = report.pairs.map((pair) => pair?.pair);
  requireCondition(ids.every((id) => typeof id === "string" && id.length > 0), `${label} has an invalid pair ID`);
  requireCondition(new Set(ids).size === 14, `${label} pair IDs must be unique`);
  return ids;
}

function requireSamePairIds(expected, actual, label) {
  requireCondition(deepEqual([...actual].sort(), [...expected].sort()), `${label} pair IDs do not match the answer key`);
}

async function verifyBlindStimulusAndAnswerKey(answerKey, darkAtlas, stimulusPath) {
  requireCondition(answerKey.schema_version === 3, "blind direction answer key schema_version must be 3");
  requireCondition(
    answerKey.instructions === "Do not provide this answer key to the blind visual QA reviewer.",
    "blind direction answer key instructions changed",
  );
  requireCondition(answerKey.pairs.length === BLIND_AXIS_PAIRS.length, "blind direction answer key pair count is wrong");

  const atlasDecoded = await sharp(
    await readFile(absolute(VARIANTS.dark.authoringAtlasPath)),
    { failOn: "error" },
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  requireCondition(
    atlasDecoded.info.width === 1536 && atlasDecoded.info.height === 2288 && atlasDecoded.info.channels === 4,
    "blind direction source atlas dimensions are wrong",
  );
  const stimulusBytes = await readFile(absolute(stimulusPath));
  const stimulusDecoded = await sharp(stimulusBytes, { failOn: "error" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  requireCondition(
    stimulusDecoded.info.width === 384
      && stimulusDecoded.info.height === BLIND_AXIS_PAIRS.length * (208 + 28)
      && stimulusDecoded.info.channels === 3,
    "blind direction stimulus dimensions are wrong",
  );

  const axisIndexes = { horizontal: 0, vertical: 0 };
  for (const [row, definition] of BLIND_AXIS_PAIRS.entries()) {
    const [axis, firstSource, firstDirection, secondSource, secondDirection, gate] = definition;
    axisIndexes[axis] += 1;
    const pairId = `${axis}-${axisIndexes[axis]}`;
    const pair = answerKey.pairs[row];
    requireCondition(pair?.pair === pairId, `blind answer key row ${row} must be ${pairId}`);
    requireCondition(pair.axis === axis && pair.gate === gate, `blind answer key ${pairId} axis or gate is wrong`);
    const expectedBySource = new Map([
      [firstSource, firstDirection],
      [secondSource, secondDirection],
    ]);
    requireCondition(
      deepEqual([pair.A?.source_direction, pair.B?.source_direction].sort(), [firstSource, secondSource].sort()),
      `blind answer key ${pairId} does not contain the canonical source pair`,
    );

    let labelInkPixels = 0;
    for (let y = row * 236; y < row * 236 + 28; y += 1) {
      for (let x = 0; x < 384; x += 1) {
        const offset = (y * 384 + x) * 3;
        if (
          stimulusDecoded.data[offset] !== 255
          || stimulusDecoded.data[offset + 1] !== 255
          || stimulusDecoded.data[offset + 2] !== 255
        ) labelInkPixels += 1;
      }
    }
    requireCondition(labelInkPixels >= 40, `blind stimulus ${pairId} is missing its A/B label band`);

    for (const [slot, sheetColumn] of [["A", 0], ["B", 1]]) {
      const sourceDirection = pair[slot]?.source_direction;
      requireCondition(
        pair[slot]?.expected_direction === expectedBySource.get(sourceDirection),
        `blind answer key ${pairId} ${slot} direction does not match its canonical source angle`,
      );
      const directionIndex = BLIND_LOOK_DIRECTIONS.indexOf(sourceDirection);
      requireCondition(directionIndex >= 0, `blind answer key ${pairId} ${slot} has an unknown source angle`);
      const atlasRow = 9 + Math.floor(directionIndex / 8);
      const atlasColumn = directionIndex % 8;
      const cell = atlasCellPixels(atlasDecoded.data, atlasDecoded.info.width, atlasRow, atlasColumn);
      for (let y = 0; y < 208; y += 1) {
        for (let x = 0; x < 192; x += 1) {
          const cellOffset = (y * 192 + x) * 4;
          const sheetOffset = (((row * 236 + 28 + y) * 384) + sheetColumn * 192 + x) * 3;
          const alpha = cell[cellOffset + 3];
          for (let channel = 0; channel < 3; channel += 1) {
            const expected = Math.round((cell[cellOffset + channel] * alpha + 242 * (255 - alpha)) / 255);
            requireCondition(
              stimulusDecoded.data[sheetOffset + channel] === expected,
              `blind stimulus ${pairId} ${slot} is not the keyed dark-atlas cell`,
            );
          }
        }
      }
    }
  }

  return {
    answerKeySchema: 3,
    canonicalPairs: BLIND_AXIS_PAIRS.length,
    pixelBoundCells: BLIND_AXIS_PAIRS.length * 2,
    darkAtlasSha256: darkAtlas.sha256,
  };
}

function recomputeBlindConsensus(verdicts, expectedPairIds) {
  return expectedPairIds.map((pairId) => {
    const axis = pairId.startsWith("horizontal-") ? "horizontal" : "vertical";
    const allowed = axis === "horizontal"
      ? ["screen-left", "screen-right", "ambiguous"]
      : ["up", "down", "ambiguous"];
    const pair = { pair: pairId };
    const votes = {};
    for (const slot of ["A", "B"]) {
      const counts = {};
      for (const verdict of verdicts) {
        const value = verdict.pairs.find((entry) => entry.pair === pairId)?.[slot];
        requireCondition(allowed.includes(value), `blind verdict ${pairId} ${slot} has invalid ${axis} classification ${value}`);
        counts[value] = (counts[value] ?? 0) + 1;
      }
      const ranked = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      requireCondition(ranked[0][1] >= 3, `blind consensus ${pairId} ${slot} has no strict majority`);
      pair[slot] = ranked[0][0];
      votes[slot] = counts;
    }
    pair.reason = "strict majority of independent blind reviews";
    pair.votes = votes;
    return pair;
  });
}

async function verifyDarkBlindSuite(darkAtlas) {
  const stimulusPath = "qa/direction-blind-pairs.png";
  const stimulusSha = sha256(await readFile(absolute(stimulusPath)));
  const shaContext = { atlasSha: darkAtlas.sha256, stimulusSha };

  const answerKey = await readJson("qa/direction-blind-answer-key.json");
  requireCondition(
    embeddedSha(answerKey, "atlasSha256", "atlas_sha256") === darkAtlas.sha256,
    "blind direction answer key is for a different dark atlas",
  );
  verifyEmbeddedShas(answerKey, "blind direction answer key", shaContext);
  const expectedPairIds = pairIds(answerKey, "blind direction answer key");
  const stimulusBinding = await verifyBlindStimulusAndAnswerKey(answerKey, darkAtlas, stimulusPath);

  const reviewerIds = new Set();
  const verdictEvidence = [];
  const verdictReports = [];
  for (let index = 1; index <= 5; index += 1) {
    const label = `blind verdict ${index}`;
    const verdictPath = `qa/direction-blind-verdict-${index}.json`;
    const verdict = await readJson(verdictPath);
    requireCondition(
      embeddedSha(verdict, "stimulusSha256", "stimulus_sha256") === stimulusSha,
      `${label} is for a different stimulus sheet`,
    );
    verifyEmbeddedShas(verdict, label, shaContext);
    requireCondition(verdict.schemaVersion === 1, `${label} schemaVersion must be 1`);
    requireCondition(verdict.reviewer?.kind === "independent-blind-agent", `${label} reviewer kind is wrong`);
    requireCondition(typeof verdict.reviewer?.id === "string" && verdict.reviewer.id.length >= 8, `${label} reviewer ID is missing`);
    requireCondition(!reviewerIds.has(verdict.reviewer.id), `${label} duplicates another reviewer ID`);
    reviewerIds.add(verdict.reviewer.id);
    requireCondition(typeof verdict.method === "string" && verdict.method.length >= 30, `${label} method is incomplete`);
    const ids = pairIds(verdict, label);
    requireSamePairIds(expectedPairIds, ids, label);
    requireCondition(
      verdict.pairs.every((pair) => typeof pair.A === "string" && typeof pair.B === "string"),
      `${label} must classify both stimuli in every pair`,
    );
    requireCondition(
      verdict.pairs.every((pair) => typeof pair.reason === "string" && pair.reason.length >= 12),
      `${label} must include a nontrivial visual reason for every pair`,
    );
    verdictEvidence.push({ path: verdictPath, sha256: sha256(await readFile(absolute(verdictPath))) });
    verdictReports.push(verdict);
  }
  requireCondition(reviewerIds.size === 5, "blind direction suite must contain five distinct reviewer IDs");

  const consensus = await readJson("qa/direction-blind-consensus.json");
  requireCondition(
    embeddedSha(consensus, "stimulusSha256", "stimulus_sha256") === stimulusSha,
    "blind direction consensus is for a different stimulus sheet",
  );
  verifyEmbeddedShas(consensus, "blind direction consensus", shaContext);
  requireCondition(consensus.schemaVersion === 1, "blind direction consensus schemaVersion must be 1");
  requireCondition(consensus.reviewerCount === 5, "blind direction consensus reviewerCount must be 5");
  requireCondition(deepEqual(consensus.sourceVerdicts, verdictEvidence), "blind direction consensus is not bound to the five reviewed verdict files");
  requireSamePairIds(
    expectedPairIds,
    pairIds(consensus, "blind direction consensus"),
    "blind direction consensus",
  );
  requireCondition(
    consensus.pairs.every((pair) => typeof pair.A === "string" && typeof pair.B === "string"),
    "blind direction consensus must classify both stimuli in every pair",
  );
  const recomputedConsensusPairs = recomputeBlindConsensus(verdictReports, expectedPairIds);
  requireCondition(
    deepEqual(consensus.pairs, recomputedConsensusPairs),
    "blind direction consensus votes or strict-majority classifications do not match the five bound verdicts",
  );

  const validation = await readJson("qa/direction-blind-validation.json");
  verifyEmbeddedShas(validation, "blind direction validation", shaContext);
  requireCondition(validation.schemaVersion === 1, "blind direction validation schemaVersion must be 1");
  requireCondition(
    deepEqual(validation.inputs, {
      answerKey: { path: "qa/direction-blind-answer-key.json", sha256: sha256(await readFile(absolute("qa/direction-blind-answer-key.json"))) },
      consensus: { path: "qa/direction-blind-consensus.json", sha256: sha256(await readFile(absolute("qa/direction-blind-consensus.json"))) },
    }),
    "blind direction validation is not bound to its answer key and consensus",
  );
  requireCondition(
    validation.ok === true && validation.reviewRequired === false,
    "blind direction validation must pass without review",
  );
  requireSamePairIds(
    expectedPairIds,
    pairIds(validation, "blind direction validation"),
    "blind direction validation",
  );
  requireCondition(
    validation.pairs.every((pair) => pair.A?.pass === true && pair.B?.pass === true),
    "blind direction validation contains a failing stimulus",
  );
  const consensusByPair = new Map(consensus.pairs.map((pair) => [pair.pair, pair]));
  const expectedValidationPairs = answerKey.pairs.map((expected) => {
    const observed = consensusByPair.get(expected.pair);
    return {
      pair: expected.pair,
      axis: expected.axis,
      gate: expected.gate,
      A: {
        observed: observed.A,
        expected: expected.A.expected_direction,
        source_direction: expected.A.source_direction,
        pass: observed.A === expected.A.expected_direction,
      },
      B: {
        observed: observed.B,
        expected: expected.B.expected_direction,
        source_direction: expected.B.source_direction,
        pass: observed.B === expected.B.expected_direction,
      },
    };
  });
  requireCondition(
    deepEqual(validation.pairs, expectedValidationPairs),
    "blind direction validation was not recomputed from the bound answer key and consensus",
  );
  requireEmpty(validation, "errors", "blind direction validation");
  requireEmpty(validation, "warnings", "blind direction validation");
  requireEmpty(validation, "unconfirmed", "blind direction validation");

  return {
    stimulus: { path: stimulusPath, sha256: stimulusSha },
    assertions: Object.freeze({
      darkAtlasAnswerKey: true,
      stimulusHashes: true,
      stimulusDarkAtlasPixelBinding: stimulusBinding.pixelBoundCells === 28,
      fiveIndependentVerdicts: true,
      consensusRecomputed: true,
      fourteenPairs: true,
      validation: true,
    }),
  };
}

function requireSha256(value, label) {
  requireCondition(
    typeof value === "string" && /^[0-9a-f]{64}$/u.test(value),
    `${label} must be a lowercase SHA-256 digest`,
  );
}

function rejectPrivateAbsolutePaths(value, label, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateAbsolutePaths(entry, label, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string"
      && (
        value.startsWith("/Users/")
        || value.startsWith("file://")
        || value.includes(root)
      )
    ) {
      throw new Error(`${label} contains a private absolute path at ${location}`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    rejectPrivateAbsolutePaths(entry, label, `${location}.${key}`);
  }
}

function verifyExhaustivePixelAudit(audit, label) {
  requireCondition(audit?.ok === true, `${label} pixel audit must pass`);
  requireCondition(audit.hiddenRgbPixels === 0, `${label} contains hidden RGB pixels`);
  requireCondition(audit.gutterNonZeroRgbaPixels === 0, `${label} enters the safety gutter`);
  requireCondition(audit.alphaMismatchPixels === 0, `${label} dark/light alpha masks differ`);
  requireCondition(
    audit.matteCandidates?.reciprocalDarkLightPairs === 0,
    `${label} contains reciprocal dark/light semitransparent mattes`,
  );
  requireCondition(
    audit.outerEdgeContaminationCandidates?.total === 0,
    `${label} contains reciprocal outer-edge keyline or halo pixels`,
  );
  requireCondition(
    Number.isFinite(audit.unclassifiedVisiblePairFraction)
      && audit.unclassifiedVisiblePairFraction
        <= EXHAUSTIVE_EDGE_QA_THRESHOLDS.maximumUnclassifiedVisiblePairFraction,
    `${label} unclassified visible-pair fraction exceeds its bound or is missing`,
  );
  requireCondition(
    Number.isFinite(audit.unexplainedMatteCandidateFraction)
      && audit.unexplainedMatteCandidateFraction
        <= EXHAUSTIVE_EDGE_QA_THRESHOLDS.maximumUnexplainedMatteCandidateFraction,
    `${label} unexplained matte-candidate fraction exceeds its bound or is missing`,
  );
  requireCondition(
    audit.matteCandidates?.total
      === audit.matteCandidates.dark + audit.matteCandidates.light + audit.matteCandidates.chroma,
    `${label} matte-candidate category totals are inconsistent`,
  );
  for (const classification of [
    "reversedSemitransparent",
    "reversedOpaque",
    "reciprocalPremattedShell",
    "sameNeutralHalo",
  ]) {
    requireCondition(
      audit.outerEdgeContaminationCandidates?.[classification] === 0,
      `${label} contains ${classification} pixels`,
    );
  }
  const exclusions = audit.intentionalOuterEdgeFeatureExclusions;
  const exclusionKinds = [
    "opaqueInverseFeature",
    "compactInverseFeature",
    "pairedChromaContinuation",
  ];
  requireCondition(exclusions && typeof exclusions === "object", `${label} intentional edge exclusions are missing`);
  requireCondition(
    exclusions.total === exclusionKinds.reduce((total, kind) => total + exclusions[kind], 0),
    `${label} intentional edge exclusion total is inconsistent`,
  );
  requireArray(exclusions.representativeCases, `${label}.intentionalOuterEdgeFeatureExclusions.representativeCases`);
  requireCondition(
    exclusions.representativeCases.length > 0 || exclusions.total === 0,
    `${label} intentional edge exclusions lack representative evidence`,
  );
  for (const kind of exclusionKinds) {
    const representatives = exclusions.representativeCasesByExclusion?.[kind];
    requireArray(representatives, `${label}.intentionalOuterEdgeFeatureExclusions.representativeCasesByExclusion.${kind}`);
    requireCondition(
      (exclusions[kind] === 0 && representatives.length === 0)
        || (exclusions[kind] > 0 && representatives.length > 0),
      `${label} ${kind} representative coverage disagrees with its exact count`,
    );
    for (const candidate of representatives) {
      requireCondition(
        candidate.exclusion === kind
          && candidate.classification === `intentional-${kind}`
          && Number.isInteger(candidate.alpha)
          && candidate.alpha > 0
          && candidate.alpha <= 255,
        `${label} ${kind} representative is malformed`,
      );
      if (kind === "opaqueInverseFeature") {
        requireCondition(
          candidate.featureInkReference
            && Number.isFinite(candidate.featureInkReference.darkDistance)
            && Number.isFinite(candidate.featureInkReference.lightDistance),
          `${label} opaque inverse feature lacks local opaque-ink evidence`,
        );
      } else if (kind === "compactInverseFeature") {
        const component = candidate.intentionalInverseFeature;
        requireCondition(
          component?.intentional === true
            && component.pixelCount >= 8
            && component.width >= 3
            && component.height >= 3
            && component.boundingBoxFillRatio >= 0.25,
          `${label} compact inverse feature lacks filled two-dimensional component evidence`,
        );
      } else {
        requireCondition(
          candidate.pairedChromaContinuation
            && candidate.pairedChromaContinuation.alpha > candidate.alpha
            && candidate.pairedChromaContinuation.channelSpread >= 18,
          `${label} paired-chroma continuation lacks higher-alpha chroma evidence`,
        );
      }
    }
  }
  for (const category of ["hiddenRgb", "gutter", "alphaMismatch"]) {
    requireArray(audit.integrityFailureSamples?.[category], `${label}.integrityFailureSamples.${category}`);
    requireCondition(
      audit.integrityFailureSamples[category].length === 0,
      `${label} retains a ${category} failure sample`,
    );
  }
  requireArray(audit.representativeSemiAlphaEdges, `${label}.representativeSemiAlphaEdges`);
  requireCondition(
    audit.representativeSemiAlphaEdges.length > 0,
    `${label} did not retain a representative natural edge for human review`,
  );
  requireEmpty(audit, "errors", `${label} pixel audit`);
}

function verifyCompositeSequences(sequences, expected, label) {
  requireArray(sequences, `${label}.sequences`);
  requireCondition(sequences.length === expected.size, `${label} sequence count is incomplete`);
  const actualLabels = sequences.map(({ label: sequenceLabel }) => sequenceLabel);
  requireCondition(new Set(actualLabels).size === expected.size, `${label} sequence labels are not unique`);
  requireCondition(
    deepEqual([...actualLabels].sort(), [...expected.keys()].sort()),
    `${label} sequence labels differ from the exhaustive contract`,
  );
  const digests = {};
  for (const sequence of sequences) {
    const contract = expected.get(sequence.label);
    requireCondition(sequence.frameCount === contract.frameCount, `${label} ${sequence.label} frame count is incomplete`);
    requireCondition(sequence.pixelsPerFrame === contract.pixelsPerFrame, `${label} ${sequence.label} pixel count is wrong`);
    requireCondition(
      sequence.compositedPixels === sequence.frameCount * sequence.pixelsPerFrame,
      `${label} ${sequence.label} composited pixel count is inconsistent`,
    );
    requireSha256(sequence.orderedFrameDigestSha256, `${label} ${sequence.label} ordered frame digest`);
    digests[sequence.label] = sequence.orderedFrameDigestSha256;
  }
  requireCondition(
    new Set(Object.values(digests)).size === expected.size,
    `${label} has duplicate ordered frame digests across distinct render paths`,
  );
  return Object.freeze(Object.fromEntries(Object.entries(digests).sort(([left], [right]) => left.localeCompare(right))));
}

async function verifyExhaustiveEdgeQa() {
  const reportPath = "qa/exhaustive-edge-qa.json";
  const reviewPath = "qa/exhaustive-edge-worst-cases.png";
  const reportBytes = await readFile(absolute(reportPath));
  const report = JSON.parse(reportBytes.toString("utf8"));
  rejectPrivateAbsolutePaths(report, "exhaustive edge QA");
  requireCondition(report.schemaVersion === 1, "exhaustive edge QA schemaVersion must be 1");
  requireCondition(report.kind === "exhaustive-edge-and-compositing-qa", "exhaustive edge QA kind is wrong");
  requireCondition(report.ok === true, "exhaustive edge QA must pass");
  requireEmpty(report, "errors", "exhaustive edge QA");
  requireCondition(
    deepEqual(report.thresholds, EXHAUSTIVE_EDGE_QA_THRESHOLDS),
    "exhaustive edge QA thresholds changed",
  );

  const coverage = report.coverage ?? {};
  requireCondition(
    coverage.shippingCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingCellPages
      && coverage.expectedShippingCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingCellPages,
    "exhaustive edge QA shipping cell-page coverage is incomplete",
  );
  requireCondition(
    coverage.shippingUnusedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingUnusedCellPages
      && coverage.expectedShippingUnusedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingUnusedCellPages,
    "exhaustive edge QA unused shipping cell-page coverage is incomplete",
  );
  requireCondition(
    coverage.sourceMotionNominalFrames === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceMotionNominalFrames
      && coverage.expectedSourceMotionNominalFrames === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceMotionNominalFrames,
    "exhaustive edge QA source-motion nominal-frame coverage is incomplete",
  );
  requireCondition(
    coverage.expectedSourceMotionEncodedPages === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceMotionEncodedPages
      && coverage.sourceMotionEncodedPages === coverage.expectedSourceMotionEncodedPages,
    "exhaustive edge QA source-motion encoded-page coverage is incomplete",
  );
  requireCondition(
    coverage.mathematicallyCompositedShippingOutputs === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingCompositeOutputs,
    "exhaustive edge QA shipping composite coverage is incomplete",
  );
  requireCondition(
    coverage.mathematicallyCompositedSourceOutputs === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceCompositeOutputs,
    "exhaustive edge QA source composite coverage is incomplete",
  );
  requireCondition(
    deepEqual(coverage.omitted, {
      shippingCellPages: 0,
      shippingUnusedCellPages: 0,
      sourceMotionNominalFrames: 0,
      sourceMotionEncodedPages: 0,
    }),
    "exhaustive edge QA omitted one or more inspected frame classes",
  );
  requireCondition(coverage.skippedFrames === 0, "exhaustive edge QA skipped one or more frames");
  requireCondition(coverage.errorCount === 0, "exhaustive edge QA recorded one or more errors");
  requireCondition(
    report.contract?.sourceTimeline?.expectedEncodedPages === coverage.expectedSourceMotionEncodedPages,
    "exhaustive edge QA source timeline does not expose its exact encoded-page total",
  );
  requireCondition(
    deepEqual(report.contract?.stageColors, {
      dark: { css: "#080b0c", rgb: [8, 11, 12] },
      light: { css: "#f3f1e9", rgb: [243, 241, 233] },
    }),
    "exhaustive edge QA stage colors changed",
  );
  requireCondition(
    report.contract?.displayPaths?.shipping96?.cssWidthPx === 96
      && report.contract.displayPaths.shipping96.deviceWidthPx === 192
      && report.contract.displayPaths.shipping96.deviceHeightPx === 208
      && report.contract.displayPaths.shipping96.samplingLatticeHeightPx === 208,
    "exhaustive edge QA 96 CSS px shipping path changed",
  );
  requireCondition(
    report.contract?.displayPaths?.shippingDefaultDpr2?.cssWidthExpression === "7.04rem"
      && report.contract.displayPaths.shippingDefaultDpr2.cssWidthPx === 112.6328125
      && report.contract.displayPaths.shippingDefaultDpr2.cssHeightPx === 122.015625
      && report.contract.displayPaths.shippingDefaultDpr2.devicePixelRatio === 2
      && report.contract.displayPaths.shippingDefaultDpr2.deviceWidthPx === 225
      && report.contract.displayPaths.shippingDefaultDpr2.deviceHeightPx === 244,
    "exhaustive edge QA exact default DPR2 browser path changed",
  );
  requireCondition(
    report.contract?.displayPaths?.sourcePreview?.cssWidthPx === 288
      && report.contract.displayPaths.sourcePreview.deviceWidthPx === 576
      && report.contract.displayPaths.sourcePreview.deviceHeightPx === 624,
    "exhaustive edge QA source-preview display path changed",
  );

  const decoder = report.decoderValidation;
  requireCondition(decoder?.ok === true, "exhaustive edge QA decoder proof must pass");
  requireCondition(decoder.semantics === "full-canvas history-coalesced straight RGBA", "exhaustive edge QA decoder semantics changed");
  requireCondition(
    deepEqual(decoder.primaryDecoder, {
      library: "sharp/libvips",
      sharpVersion: "0.35.4",
      libvipsVersion: "8.18.6",
      libwebpVersion: "1.6.0",
    }),
    "exhaustive edge QA primary decoder runtime changed",
  );
  requireCondition(
    decoder.independentOracle?.canonical === "libwebp WebPAnimDecoder with MODE_RGBA"
      && decoder.independentOracle?.secondary === "ffmpeg RGBA rawvideo with -fps_mode passthrough"
      && decoder.independentOracle?.agreement === "byte-identical full-canvas RGBA",
    "exhaustive edge QA independent decoder oracle contract changed",
  );
  requireCondition(decoder.fixture?.ok === true, "exhaustive edge QA decoder fixture must pass");
  requireEmpty(decoder.fixture, "errors", "exhaustive edge QA decoder fixture");
  requireCondition(decoder.verifiedAssets === 4, "exhaustive edge QA must bind four independent decoder oracles");
  requireCondition(decoder.pageSpecificReads === 120, "exhaustive edge QA must prove all 120 shipping page-specific reads");
  requireArray(decoder.assets, "exhaustive edge QA decoder assets");
  requireCondition(decoder.assets.length === decoder.verifiedAssets, "exhaustive edge QA decoder asset coverage is incomplete");
  requireCondition(
    decoder.verifiedFullCanvasPages === decoder.assets.reduce((total, asset) => total + asset.metadata.pages, 0),
    "exhaustive edge QA decoder full-stack page coverage is incomplete",
  );
  for (const asset of decoder.assets) {
    requireCondition(asset.ok === true && asset.fullStackExact === true, `decoder oracle ${asset.id} failed`);
    requireCondition(asset.anmf?.frames === asset.metadata?.pages, `decoder oracle ${asset.id} ANMF coverage is incomplete`);
    requireCondition(asset.pageAccessAudit?.exact === true, `decoder oracle ${asset.id} page access differs from its stack`);
    requireCondition(
      asset.pageAccessAudit.inspectedPages === asset.pageAccessAudit.expectedPages,
      `decoder oracle ${asset.id} page access coverage is incomplete`,
    );
    requireCondition(asset.pageAccessAudit.mismatchPages === 0, `decoder oracle ${asset.id} has page-access mismatches`);
    requireCondition(
      asset.sampledPages.every((sample) => sample.exact === true),
      `decoder oracle ${asset.id} has a non-oracle sampled page`,
    );
    requireCondition(
      asset.encodedSha256 === sha256(await readFile(absolute(asset.path))),
      `decoder oracle ${asset.id} is for different encoded bytes`,
    );
    requireEmpty(asset, "errors", `decoder oracle ${asset.id}`);
  }
  requireEmpty(decoder, "errors", "exhaustive edge QA decoder proof");

  const css = report.structuralCss;
  requireCondition(css?.ok === true, "source-motion structural CSS proof must pass");
  await verifyExhaustiveStructuralCssFileHashes(report);
  requireCondition(css.imageRenderingAuto === true && css.heightAuto === true, "source-motion image sizing/rendering contract changed");
  requireCondition(css.computedStyleContract?.filter === "none", "source-motion art has a CSS filter");
  requireCondition(css.computedStyleContract?.webkitFilter === "none", "source-motion art has a WebKit filter");
  requireCondition(css.computedStyleContract?.boxShadow === "none", "source-motion art has a box shadow");
  requireCondition(css.computedStyleContract?.opacity === 1, "source-motion art has non-unit opacity");
  requireCondition(css.computedStyleContract?.mixBlendMode === "normal", "source-motion art has a blend mode");
  requireCondition(css.computedStyleContract?.imageRendering === "auto", "source-motion art does not use smooth image rendering");
  requireCondition(css.displayContract?.cssWidthPx === 288, "source-motion CSS width must be 288px");
  requireCondition(css.displayContract?.devicePixelRatio === 2, "source-motion QA must target DPR2");
  requireCondition(css.displayContract?.expectedDeviceCanvas?.width === 576, "source-motion device width must be 576px");
  requireCondition(css.displayContract?.expectedDeviceCanvas?.height === 624, "source-motion device height must be 624px");
  requireCondition(css.displayContract?.exactAtTargetDevicePixelRatio === true, "source-motion preview is not native at DPR2");
  requireCondition(css.stageSurfaceContract?.exact === true, "source-motion stage colors differ from the compositor");
  requireEmpty(css, "forbiddenFilterOrDropShadowMatches", "source-motion CSS proof");
  requireEmpty(css, "inlineStyleMatches", "source-motion CSS proof");
  requireEmpty(css, "scriptFilterMatches", "source-motion CSS proof");
  requireEmpty(css, "errors", "source-motion CSS proof");

  requireCondition(report.shipping?.ok === true, "exhaustive shipping audit must pass");
  requireCondition(report.shipping.inspectedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingCellPages, "shipping audit omitted a cell-page");
  requireCondition(report.shipping.expectedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingCellPages, "shipping expected cell-page count changed");
  requireCondition(report.shipping.expectedUnusedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingUnusedCellPages, "shipping expected unused cell-page count changed");
  requireCondition(report.shipping.unusedAudit?.ok === true, "unused shipping cells must pass");
  requireCondition(report.shipping.unusedAudit.inspectedCellPages === EXHAUSTIVE_EDGE_QA_EXPECTED.shippingUnusedCellPages, "unused shipping cells were omitted");
  requireCondition(report.shipping.unusedAudit.hiddenRgbPixels === 0, "unused shipping cells contain hidden RGB");
  requireCondition(report.shipping.unusedAudit.nonZeroRgbaPixels === 0, "unused shipping cells contain non-zero RGBA");
  for (const variant of ["dark", "light"]) {
    const atlas = report.shipping.atlas?.[variant];
    const expectedAtlasPath = `pet/grok-bot-${variant}/spritesheet.webp`;
    requireArtifactPath(atlas?.path, expectedAtlasPath, `exhaustive shipping ${variant} atlas path`);
    requireCondition(atlas.sha256 === sha256(await readFile(absolute(expectedAtlasPath))), `exhaustive shipping ${variant} atlas SHA is stale`);
    requireCondition(atlas.pages === 60 && atlas.pageHeight === 2288 && atlas.width === 1536, `exhaustive shipping ${variant} atlas metadata changed`);
    requireCondition(atlas.ok === true, `exhaustive shipping ${variant} atlas metadata failed`);
    requireEmpty(atlas, "errors", `exhaustive shipping ${variant} atlas`);
  }
  verifyExhaustivePixelAudit(report.shipping.pixelAudit, "shipping");
  requireCondition(report.shipping.pixelAudit?.inspectedFrames === 4380, "source shipping pixel accumulator frame coverage changed");
  requireCondition(report.shipping.pixelAudit?.inspectedPixelsPerVariant === 174_919_680, "source shipping pixel accumulator per-variant coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.path === "7.04rem default fallback at DPR2", "exact browser pixel audit path changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.sampling?.id === CODEX_DEFAULT_DPR2_DISPLAY.id, "exact browser pixel audit sampler changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.renderedFramesPerTheme === 4380, "exact browser pixel audit frame coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.renderedDevicePixelsPerTheme === 240_462_000, "exact browser pixel audit per-theme device-pixel coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.renderedFramesAcrossThemes === 8760, "exact browser pixel audit cross-theme frame coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.renderedDevicePixelsAcrossThemes === 480_924_000, "exact browser pixel audit cross-theme device-pixel coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.inspectedFrames === 4380, "exact browser pixel accumulator frame coverage changed");
  requireCondition(report.shipping.exactBrowserPixelAudit?.inspectedPixelsPerVariant === 240_462_000, "exact browser pixel accumulator per-variant coverage changed");
  verifyExhaustivePixelAudit(report.shipping.exactBrowserPixelAudit, "exact default DPR2 browser shipping");
  requireEmpty(report.shipping, "errors", "exhaustive shipping audit");

  requireCondition(report.sourceMotion?.ok === true, "exhaustive source-motion audit must pass");
  requireCondition(report.sourceMotion.inspectedNominalFrames === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceMotionNominalFrames, "source-motion audit omitted a nominal frame");
  requireCondition(report.sourceMotion.expectedNominalFrames === EXHAUSTIVE_EDGE_QA_EXPECTED.sourceMotionNominalFrames, "source-motion nominal contract changed");
  requireCondition(report.sourceMotion.inspectedEncodedPages === coverage.expectedSourceMotionEncodedPages, "source-motion audit omitted an encoded page");
  requireCondition(report.sourceMotion.expectedEncodedPages === coverage.expectedSourceMotionEncodedPages, "source-motion encoded-page totals disagree");
  requireArtifactPath(report.sourceMotion.manifest?.path, "preview/source-lab/motion/manifest.json", "exhaustive source-motion manifest path");
  requireCondition(
    report.sourceMotion.manifest.sha256 === sha256(await readFile(absolute("preview/source-lab/motion/manifest.json"))),
    "exhaustive source-motion manifest SHA is stale",
  );
  requireArray(report.sourceMotion.effects, "exhaustive source-motion effects");
  requireCondition(report.sourceMotion.effects.length === 14, "exhaustive source-motion effect coverage is incomplete");
  requireCondition(
    report.sourceMotion.effects.reduce((total, effect) => total + effect.encodedPagesPerVariant * 2, 0)
      === coverage.expectedSourceMotionEncodedPages,
    "exhaustive source-motion per-effect encoded pages do not sum to the coverage total",
  );
  requireCondition(
    report.sourceMotion.effects.every((effect) => effect.nominalFramesPerVariant === 156),
    "exhaustive source-motion per-effect nominal coverage is incomplete",
  );
  requireCondition(
    new Set(report.sourceMotion.effects.map(({ effect }) => effect)).size === 14,
    "exhaustive source-motion effect identities are not unique",
  );
  for (const effect of report.sourceMotion.effects) {
    requireCondition(
      effect.encodedPageUseCounts.length === effect.encodedPagesPerVariant
        && effect.encodedPageUseCounts.every((count) => Number.isInteger(count) && count > 0),
      `exhaustive source-motion ${effect.effect} has an unreachable encoded page`,
    );
    for (const variant of ["dark", "light"]) {
      const asset = effect[variant];
      const expectedPath = `preview/source-lab/motion/${variant}/${effect.effect}.webp`;
      requireArtifactPath(asset?.path, expectedPath, `exhaustive source-motion ${variant}/${effect.effect} path`);
      requireCondition(asset.sha256 === sha256(await readFile(absolute(expectedPath))), `exhaustive source-motion ${variant}/${effect.effect} SHA is stale`);
      requireCondition(asset.encodedPages === effect.encodedPagesPerVariant, `exhaustive source-motion ${variant}/${effect.effect} page count differs`);
      requireCondition(asset.ok === true, `exhaustive source-motion ${variant}/${effect.effect} failed`);
      requireEmpty(asset, "errors", `exhaustive source-motion ${variant}/${effect.effect}`);
    }
  }
  verifyExhaustivePixelAudit(report.sourceMotion.pixelAudit, "source motion");
  requireEmpty(report.sourceMotion, "errors", "exhaustive source-motion audit");

  const shippingExpected = new Map();
  for (const variant of ["dark", "light"]) {
    for (const display of ["shipping96", "shippingDefaultDpr2"]) {
      for (const stage of ["dark", "light"]) {
        shippingExpected.set(`${variant}:${display}:${stage}`, {
          frameCount: EXHAUSTIVE_EDGE_QA_EXPECTED.shippingFramesPerSequence,
          pixelsPerFrame: display === "shipping96" ? 192 * 208 : 225 * 244,
        });
      }
    }
  }
  const sourceExpected = new Map();
  for (const variant of ["dark", "light"]) {
    for (const stage of ["dark", "light"]) {
      sourceExpected.set(`${variant}:sourcePreview:${stage}`, {
        frameCount: EXHAUSTIVE_EDGE_QA_EXPECTED.sourceFramesPerSequence,
        pixelsPerFrame: 576 * 624,
      });
    }
  }
  const shippingCompositeDigests = verifyCompositeSequences(
    report.shipping.compositing?.sequences,
    shippingExpected,
    "exhaustive shipping compositing",
  );
  const sourceCompositeDigests = verifyCompositeSequences(
    report.sourceMotion.compositing?.sequences,
    sourceExpected,
    "exhaustive source compositing",
  );

  const reviewBytes = await readFile(absolute(reviewPath));
  const review = report.humanReviewArtifact;
  requireArtifactPath(review?.path, reviewPath, "exhaustive edge QA human review path");
  requireCondition(review.sha256 === sha256(reviewBytes), "exhaustive edge QA human review SHA is stale");
  requireCondition(review.labelRenderer === "embedded deterministic 5x7 bitmap glyphs", "exhaustive edge QA review labels are host-dependent");
  requireArray(review.cases, "exhaustive edge QA human review cases");
  requireCondition(review.caseCount === review.cases.length && review.caseCount > 0, "exhaustive edge QA human review case coverage is empty or stale");
  requireCondition(
    ["shipping", "source"].every((section) => review.cases.some((entry) => entry.section === section)),
    "exhaustive edge QA human review must include shipping and source-motion rows",
  );
  const reviewMetadata = await sharp(reviewBytes, { failOn: "error" }).metadata();
  requireCondition(reviewMetadata.format === "png", "exhaustive edge QA human review must be PNG");
  requireCondition(review.width === reviewMetadata.width && review.height === reviewMetadata.height, "exhaustive edge QA human review dimensions are stale");
  requireCondition(
    deepEqual(review.columns?.shipping, [
      { display: "shipping96", role: "intended" },
      { display: "shipping96", role: "opposite" },
      { display: "shippingDefaultDpr2", role: "intended" },
      { display: "shippingDefaultDpr2", role: "opposite" },
    ]),
    "exhaustive edge QA shipping review does not cover intended/opposite 96 and exact default DPR2 paths",
  );
  requireCondition(
    deepEqual(review.columns?.source, [
      { display: "sourcePreview", role: "intended" },
      { display: "sourcePreview", role: "opposite" },
    ]),
    "exhaustive edge QA source review does not use the actual 288 CSS px / DPR2 path",
  );
  for (const [section, audit] of [["shipping", report.shipping.pixelAudit], ["source", report.sourceMotion.pixelAudit]]) {
    for (const category of ["hiddenRgb", "gutter", "alphaMismatch"]) {
      if (audit.integrityFailureSamples[category].length > 0) {
        requireCondition(
          review.cases.some((entry) => entry.section === section && entry.category === category),
          `exhaustive edge QA review omits ${section} ${category}`,
        );
      }
    }
    for (const classification of ["reversedSemitransparent", "reversedOpaque", "reciprocalPremattedShell", "sameNeutralHalo"]) {
      if (audit.outerEdgeContaminationCandidates[classification] > 0) {
        requireCondition(
          review.cases.some((entry) => entry.section === section && entry.classification === classification),
          `exhaustive edge QA review omits ${section} ${classification}`,
        );
      }
    }
    for (const exclusion of ["opaqueInverseFeature", "compactInverseFeature", "pairedChromaContinuation"]) {
      if (audit.intentionalOuterEdgeFeatureExclusions[exclusion] > 0) {
        requireCondition(
          review.cases.some((entry) => (
            entry.section === section
            && entry.classification === `intentional-${exclusion}`
          )),
          `exhaustive edge QA review omits ${section} intentional ${exclusion}`,
        );
      }
    }
  }

  return Object.freeze({
    report: { path: reportPath, sha256: sha256(reportBytes) },
    humanReview: { path: reviewPath, sha256: sha256(reviewBytes), width: review.width, height: review.height, caseCount: review.caseCount },
    coverage: Object.freeze({ ...coverage }),
    compositeDigests: Object.freeze({
      shipping: shippingCompositeDigests,
      sourceMotion: sourceCompositeDigests,
    }),
  });
}

async function verifyDefaultDpr2BrowserOracle() {
  const reportPath = "qa/codex-default-dpr2-browser-oracle.json";
  const diagnosticPath = "qa/codex-default-dpr2-browser-oracle.png";
  const mapPath = "qa/codex-default-dpr2-browser-oracle-map.bin";
  const reportBytes = await readFile(absolute(reportPath));
  const diagnostic = await readFile(absolute(diagnosticPath));
  const compressedMap = await readFile(absolute(mapPath));
  const report = JSON.parse(reportBytes.toString("utf8"));
  rejectPrivateAbsolutePaths(report, "default DPR2 browser oracle");
  requireCondition(report.schemaVersion === 1, "default DPR2 browser oracle schema changed");
  requireCondition(report.kind === "codex-default-dpr2-browser-oracle", "default DPR2 browser oracle kind is wrong");
  requireCondition(report.ok === true, "default DPR2 browser oracle must pass");
  requireEmpty(report, "errors", "default DPR2 browser oracle");
  requireCondition(report.renderer?.browser === "Chrome/151.0.7922.174", "default DPR2 browser renderer version changed");
  requireCondition(report.renderer?.v8Version === "15.1.206.23", "default DPR2 browser V8 version changed");
  requireCondition(report.renderer?.mainExecutableSha256 === "228fb899e6a7c27ae43151857616f0ba2b926de67cfc119a370038fdd16f407e", "default DPR2 browser executable identity changed");
  requireCondition(report.renderer?.frameworkSha256 === "89738f94b75f1946dff8c7848c6798d53ff19c15d39979ef5bc51a7a86701539", "default DPR2 browser framework identity changed");
  requireCondition(report.renderer?.applicationResourcesSha256 === "f56ac8d5254a10fc4a04e7417fa787d135c3bbca49bad7d668d4ae65833d40c7", "default DPR2 application resource identity changed");
  requireCondition(report.target?.cssWidthExpression === "7.04rem", "default DPR2 CSS fallback changed");
  requireCondition(report.target?.rootFontSizePx === 16, "default DPR2 root font size changed");
  requireCondition(report.target?.devicePixelRatio === 2, "default DPR2 ratio changed");
  requireCondition(deepEqual(report.target?.measuredCssRect, { x: 0, y: 0, width: 112.6328125, height: 122.015625 }), "default DPR2 measured CSS rectangle changed");
  requireCondition(deepEqual(report.target?.measuredDeviceFootprint, { width: 225, height: 244 }), "default DPR2 device footprint changed");
  requireCondition(deepEqual(report.target?.capturedZoomContract, { visualViewportScale: 1, bodyZoom: "1" }), "default DPR2 browser zoom contract changed");
  requireCondition(report.target?.originContract?.fixtureCssOriginsAreIntegers === true, "default DPR2 fixture origin is not integer CSS");
  requireCondition(report.target?.originContract?.fixtureDeviceOriginsAreIntegers === true, "default DPR2 fixture origin is not integer device-aligned");
  requireCondition(report.target?.originContract?.capturedHostOriginsAreIntegers === true, "captured host pet origin is not integer-aligned");
  requireCondition(report.target?.actualHostElements?.length >= 1, "browser oracle did not capture a live host pet element");
  requireCondition(report.target?.actualHostElements?.every(({ rect, deviceOrigin, dpr }) => (
    dpr === 2 && Number.isInteger(rect.x) && Number.isInteger(rect.y)
      && rect.width === 112.6328125 && rect.height === 122.015625
      && deviceOrigin.x === rect.x * dpr && deviceOrigin.y === rect.y * dpr
      && Number.isInteger(deviceOrigin.x) && Number.isInteger(deviceOrigin.y)
  )), "captured host element has an unsealed origin phase");
  requireCondition(report.target?.actualHostElements?.every(({ backgroundSize, imageRendering, backgroundPositionUsesAtlasGrid }) => (
    backgroundSize === "800% 1100%"
      && imageRendering === "pixelated"
      && backgroundPositionUsesAtlasGrid === true
  )), "captured host element does not use the exact fixture scaling/style/grid contract");
  requireCondition(report.target?.originContract?.hostLayoutEvidence?.startsWith("manual code-audit premise:") === true, "browser oracle overstates screenshot proof of universal host layout");
  requireCondition(report.screenshotProbe?.passCount === 8, "browser oracle screenshot pass count changed");
  requireCondition(report.screenshotProbe?.encodedLinearIndexBits === 22, "browser oracle coordinate bit count changed");
  requireCondition(report.screenshotProbe?.channelTrace?.every(({ ambiguousChannelSamples, minimumOneChannel, maximumZeroChannel }) => (
    ambiguousChannelSamples === 0 && minimumOneChannel === 255 && maximumZeroChannel <= 4
  )), "browser oracle binary screenshot channel trace is ambiguous");
  requireArtifactPath(report.screenshotProbe?.diagnosticPath, diagnosticPath, "browser oracle diagnostic path");
  requireCondition(report.screenshotProbe.diagnosticSha256 === sha256(diagnostic), "browser oracle diagnostic screenshot is stale");
  requireArtifactPath(report.sourceMaps?.compressedPath, mapPath, "browser oracle map path");
  requireCondition(report.sourceMaps.compressedSha256 === sha256(compressedMap), "browser oracle compressed map is stale");
  requireCondition(report.sourceMaps.compressedBytes === compressedMap.length, "browser oracle compressed byte count is stale");
  requireCondition(report.sourceMaps.allCellCount === 88, "browser oracle does not cover all 88 cells");
  requireCondition(report.sourceMaps.outputDeviceWidth === 225 && report.sourceMaps.outputDeviceHeight === 244, "browser oracle map geometry changed");
  requireCondition(report.sourceMaps.rawBytes === 9_662_400, "browser oracle expanded byte count changed");
  requireCondition(report.sourceMaps.rawSha256 === report.sourceMaps.roundTripRawSha256, "browser oracle compact map is not a lossless round trip");
  requireCondition(deepEqual(report.sourceMaps.nonSeparablePixels, { x: 2276, y: 0 }), "browser oracle two-dimensional seam trace changed");
  requireArray(report.sourceMaps.cellTrace, "browser oracle cell trace");
  requireCondition(report.sourceMaps.cellTrace.length === 88, "browser oracle per-cell trace is incomplete");
  const rawMaps = [];
  for (let row = 0; row < 11; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const map = codexDefaultDpr2CellMap(row, column);
      const trace = report.sourceMaps.cellTrace[row * 8 + column];
      requireCondition(trace.key === `r${row}c${column}`, "browser oracle cell order changed");
      requireCondition(trace.sourceCoordinateMapSha256 === sha256(map), `browser oracle r${row}c${column} map digest is stale`);
      rawMaps.push(map);
    }
  }
  const rawMap = Buffer.concat(rawMaps);
  requireCondition(sha256(rawMap) === report.sourceMaps.rawSha256, "browser oracle reader diverges from the screenshot-derived raw map");
  requireCondition(sha256Json(report.sourceMaps.cellTrace) === report.sourceMaps.orderedCellTraceSha256, "browser oracle ordered cell trace is stale");
  requireCondition(deepEqual(report, CODEX_DEFAULT_DPR2_ORACLE_REPORT), "browser oracle module and report disagree");
  return {
    path: reportPath,
    sha256: sha256(reportBytes),
    renderer: report.renderer,
    deviceFootprint: report.target.measuredDeviceFootprint,
    rawMapSha256: report.sourceMaps.rawSha256,
    nonSeparablePixels: report.sourceMaps.nonSeparablePixels,
  };
}

async function verifyArbitraryPhaseQa(browserOracle) {
  const relative = "qa/arbitrary-phase-qa.json";
  const baselineRelative = "qa/arbitrary-phase-baselines.json.gz";
  const bytes = await readFile(absolute(relative));
  const baselineBytes = await readFile(absolute(baselineRelative));
  const baselineJsonBytes = gunzipSync(baselineBytes);
  const baseline = JSON.parse(baselineJsonBytes.toString("utf8"));
  const report = JSON.parse(bytes.toString("utf8"));
  rejectPrivateAbsolutePaths(report, "arbitrary phase QA");
  requireCondition(report.schemaVersion === 1, "arbitrary phase QA schema changed");
  requireCondition(report.kind === "arbitrary-decoder-phase-browser-host-qa", "arbitrary phase QA kind is wrong");
  requireCondition(report.ok === true, "arbitrary phase QA must pass");
  requireEmpty(report, "errors", "arbitrary phase QA");
  requireCondition(report.thresholdPolicy?.calibrationMode === false, "arbitrary phase QA is an unsealed calibration report");
  requireCondition(sha256(baselineBytes) === ARBITRARY_PHASE_BASELINE_SHA256, "arbitrary phase authored-profile baseline changed");
  requireCondition(sha256(baselineJsonBytes) === ARBITRARY_PHASE_BASELINE_JSON_SHA256, "arbitrary phase baseline JSON changed");
  requireCondition(baseline.schemaVersion === 1 && baseline.kind === "arbitrary-decoder-phase-authored-profiles", "arbitrary phase baseline contract changed");
  requireCondition(baseline.hostGraphOrderedSha256 === "8970e497ceced7b3a0a1b031c6a75bdbe544011887fe69a93798675bb0dad736", "arbitrary phase baseline graph order changed");
  const traceIntegrity = verifyArbitraryPhaseTraceIntegrity({ report, baseline });
  requireCondition(report.thresholdPolicy?.authoredProfileBaseline?.path === baselineRelative, "arbitrary phase profile baseline path changed");
  requireCondition(report.thresholdPolicy?.authoredProfileBaseline?.sha256 === ARBITRARY_PHASE_BASELINE_SHA256, "arbitrary phase report is bound to a different profile baseline");
  requireCondition(report.thresholdPolicy?.authoredProfileBaseline?.uncompressedJsonSha256 === ARBITRARY_PHASE_BASELINE_JSON_SHA256, "arbitrary phase report baseline JSON binding changed");
  requireCondition(report.thresholdPolicy?.authoredProfileBaseline?.generationMode === false, "arbitrary phase report used baseline-generation mode");
  requireCondition(report.thresholdPolicy?.authoredProfileBaseline?.reviewedReplacementMode === false, "arbitrary phase report used reviewed baseline-replacement mode");
  requireCondition(report.contract?.withinReachableCellCount === 73, "arbitrary phase reachable-cell count changed");
  requireCondition(report.contract?.hostGraph?.renderedFramesPerThemePerPath === 4380, "arbitrary phase rendered-frame count changed");
  requireCondition(report.contract?.hostGraph?.uniqueChangedCellEdgesPerPath === 1813, "arbitrary phase host graph is incomplete");
  requireCondition(report.contract?.hostGraph?.rawTimedEffectiveResetMembership === 461, "arbitrary phase effective-reset membership changed");
  requireCondition(report.contract?.hostGraph?.disjointTimedEffectiveResetTraceCount === 460, "arbitrary phase reset overlap was not removed");
  requireCondition(report.contract?.hostGraph?.timedToGazeEdges === 912, "arbitrary phase timed-to-gaze graph is incomplete");
  requireCondition(report.contract?.hostGraph?.gazeToTimedEdges === 144, "arbitrary phase gaze-to-timed graph is incomplete");
  requireCondition(report.contract?.hostGraph?.gazeToDifferentGazeEdges === 240, "arbitrary phase gaze graph is incomplete");
  requireCondition(report.contract?.renderedPixelCountsPerTheme?.source === 174_919_680, "arbitrary phase source pixel coverage changed");
  requireCondition(report.contract?.renderedPixelCountsPerTheme?.codexDefaultDpr2 === 240_462_000, "arbitrary phase browser pixel coverage changed");
  for (const pathId of ["source", "codexDefaultDpr2"]) {
    const counts = report.contract?.orderedPairCountsPerTheme?.[pathId];
    requireCondition(deepEqual(counts, { within: 258_420, stateSwitch: 6_526_800, total: 6_785_220 }), `${pathId} arbitrary phase ordered-pair coverage changed`);
  }
  requireCondition(report.browserOracle?.reportSha256 === browserOracle.sha256, "arbitrary phase QA is bound to a different browser oracle report");
  requireCondition(report.browserOracle?.rawRoundTripSha256 === browserOracle.rawMapSha256, "arbitrary phase QA is bound to a different browser map");
  requireCondition(report.browserOracle?.renderer?.browser === browserOracle.renderer.browser, "arbitrary phase QA renderer identity changed");
  requireCondition(report.browserOracle?.pythonLoaderOutOfRangeRedPath === "rejected source x=192 before any atlas indexing", "arbitrary phase Python map-loader red path changed");
  const familyEdges = { timedCellAdvance: 57, timedEffectiveReset: 460, timedToGaze: 912, gazeToTimed: 144, adjacentGaze: 32, nonNeighborGaze: 208 };
  for (const [pathId, pathReport] of Object.entries(report.paths ?? {})) {
    requireCondition(["source", "codexDefaultDpr2"].includes(pathId), `unknown arbitrary phase path ${pathId}`);
    requireCondition(pathReport.crossThemeAlphaParity === true, `${pathId} dark/light alpha parity failed`);
    requireCondition(pathReport.gates != null, `${pathId} arbitrary phase gates are missing`);
    for (const theme of ["dark", "light"]) {
      const themeReport = pathReport.themes?.[theme];
      requireCondition(themeReport?.atlas?.phaseCount === 60, `${pathId}/${theme} phase count changed`);
      const atlasPath = `pet/grok-bot-${theme}/spritesheet.webp`;
      requireArtifactPath(themeReport.atlas.path, atlasPath, `${pathId}/${theme} arbitrary phase atlas path`);
      requireCondition(themeReport.atlas.fileSha256 === sha256(await readFile(absolute(atlasPath))), `${pathId}/${theme} arbitrary phase atlas is stale`);
      requireCondition(themeReport.within?.allReachableCells?.count === 258_420, `${pathId}/${theme} within-cell pair count changed`);
      requireCondition(themeReport.within.allReachableCells.failingPairCount === 0, `${pathId}/${theme} has a failing within-cell phase pair`);
      requireSha256(themeReport.within.allReachableCells.orderedMetricTraceSha256, `${pathId}/${theme} within-cell metric trace`);
      requireCondition(themeReport.within.fullCycleMateriality?.failingCellCount === 0, `${pathId}/${theme} cell materiality failed`);
      const cellBaseline = themeReport.within.fullCycleMateriality?.authoredPerCellBaseline;
      requireCondition(cellBaseline?.comparedCellCount === 73, `${pathId}/${theme} per-cell authored baseline coverage changed`);
      requireCondition(cellBaseline?.failingCellCount === 0, `${pathId}/${theme} per-cell authored profile changed`);
      requireSha256(cellBaseline?.orderedProfileTraceSha256, `${pathId}/${theme} per-cell authored profile trace`);
      for (let row = 0; row < 11; row += 1) {
        const rowReport = themeReport.within.byRow?.[row];
        requireCondition(rowReport?.count === ANIMATED_ATLAS_REQUIRED_COLUMNS[row] * 60 * 59, `${pathId}/${theme}/row${row} pair count changed`);
        requireCondition(rowReport.failingPairCount === 0, `${pathId}/${theme}/row${row} has a failing arbitrary pair`);
      }
      for (const [family, edgeCount] of Object.entries(familyEdges)) {
        const familyReport = themeReport.stateSwitchFamilies?.[family];
        requireCondition(familyReport?.statePairCount === edgeCount, `${pathId}/${theme}/${family} edge count changed`);
        requireCondition(familyReport.count === edgeCount * 3600, `${pathId}/${theme}/${family} phase-pair count changed`);
        requireCondition(familyReport.failingPairCount === 0, `${pathId}/${theme}/${family} has a failing phase pair`);
        requireCondition(familyReport.fullCycleMateriality?.failingStatePairCount === 0, `${pathId}/${theme}/${family} materiality failed`);
        requireSha256(familyReport.orderedMetricTraceSha256, `${pathId}/${theme}/${family} metric trace`);
        const edgeBaseline = familyReport.authoredPerEdgeBaseline;
        requireCondition(edgeBaseline?.comparedEdgeCount === edgeCount, `${pathId}/${theme}/${family} per-edge authored baseline coverage changed`);
        requireCondition(edgeBaseline?.failingEdgeCount === 0, `${pathId}/${theme}/${family} per-edge authored profile changed`);
        requireSha256(edgeBaseline?.orderedProfileTraceSha256, `${pathId}/${theme}/${family} authored profile trace`);
        if (family === "timedCellAdvance") {
          requireCondition(edgeBaseline.policyCounts?.[pathId === "source" ? "continuityAlias" : "sampledContinuity"] === 57, `${pathId}/${theme}/${family} continuity policy changed`);
        } else if (family === "timedEffectiveReset") {
          requireCondition(edgeBaseline.policyCounts?.semanticDistinction === 456, `${pathId}/${theme}/${family} semantic reset policy changed`);
          requireCondition(edgeBaseline.policyCounts?.[pathId === "source" ? "continuityAlias" : "sampledContinuity"] === 4, `${pathId}/${theme}/${family} continuity reset policy changed`);
        } else {
          requireCondition(edgeBaseline.policyCounts?.semanticDistinction === edgeCount, `${pathId}/${theme}/${family} semantic policy changed`);
        }
      }
      if (pathId === "source") {
        requireCondition(themeReport.timedColumnEquivalence?.allTimedColumnsEqualToC0 === true, `${theme} source timed-column alias proof failed`);
      } else {
        requireCondition(Object.values(themeReport.timedColumnEquivalence?.rows ?? {}).some(({ uniqueRenderedSequenceCount }) => uniqueRenderedSequenceCount > 1), `${theme} exact browser path did not retain column-specific sampler differences`);
      }
    }
  }
  return {
    path: relative,
    sha256: sha256(bytes),
    orderedPairsPerThemePerPath: 6_785_220,
    totalOrderedPairTraces: traceIntegrity.exactPhasePairCount,
    exactItemTraceCount: traceIntegrity.exactItemTraceCount,
    uniqueChangedCellEdgesPerPath: 1813,
    authoredProfileBaselineSha256: ARBITRARY_PHASE_BASELINE_SHA256,
  };
}

async function verifySourceMotionTemporalQa() {
  const reportPath = "qa/source-motion-temporal.json";
  const allFramePath = "qa/source-motion-temporal-all-frames.png";
  const worstCasePath = "qa/source-motion-temporal-worst-cases.png";
  const reportBytes = await readFile(absolute(reportPath));
  const report = JSON.parse(reportBytes.toString("utf8"));
  rejectPrivateAbsolutePaths(report, "source-motion temporal QA");
  requireCondition(report.schemaVersion === 1, "source-motion temporal QA schemaVersion must be 1");
  requireCondition(report.kind === "source-motion-temporal-qa", "source-motion temporal QA kind is wrong");
  requireCondition(report.ok === true, "source-motion temporal QA must pass");
  requireEmpty(report, "errors", "source-motion temporal QA");
  requireCondition(report.contract?.temporal?.schemaVersion === 1, "source-motion temporal gate schema is wrong");
  requireCondition(report.contract?.frameRate === 60, "source-motion temporal frame rate changed");
  requireCondition(report.contract?.frameWidth === 576 && report.contract?.frameHeight === 624, "source-motion temporal frame canvas changed");
  requireCondition(report.contract?.displayWidthCssPx === 288, "source-motion temporal CSS width changed");
  requireArtifactPath(report.sourceManifest?.path, "preview/source-lab/motion/manifest.json", "source-motion temporal manifest path");
  requireCondition(
    report.sourceManifest.sha256 === sha256(await readFile(absolute("preview/source-lab/motion/manifest.json"))),
    "source-motion temporal QA is for a different source manifest",
  );
  for (const key of ["sharp", "libvips", "webp"]) {
    requireCondition(typeof report.decoder?.[key] === "string" && report.decoder[key].length > 0, `source-motion temporal decoder ${key} is missing`);
  }

  requireArray(report.assets, "source-motion temporal assets");
  requireCondition(report.assets.length === 28, "source-motion temporal QA must cover 28 assets");
  const assetKeys = report.assets.map(({ key }) => key);
  requireCondition(new Set(assetKeys).size === 28, "source-motion temporal asset keys are not unique");
  requireCondition(
    deepEqual([...report.assets.map(({ path: assetPath }) => assetPath)].sort(), [...sourceMotionPaths].sort()),
    "source-motion temporal asset paths are incomplete",
  );
  let displayedFrames = 0;
  let adjacentTransitions = 0;
  let loopSeams = 0;
  let eyeTransitionLandmarks = 0;
  for (const asset of report.assets) {
    const label = `source-motion temporal ${asset.key}`;
    requireCondition(asset.sha256 === sha256(await readFile(absolute(asset.path))), `${label} SHA is stale`);
    requireCondition(Number.isInteger(asset.pages) && asset.pages > 0, `${label} page count is invalid`);
    requireCondition(asset.temporal?.pages === asset.pages, `${label} temporal page count differs`);
    requireCondition(asset.temporal.adjacentTransitions === asset.pages - 1, `${label} adjacent transition count is wrong`);
    requireCondition(asset.temporal.loopSeams === 1, `${label} loop seam count is wrong`);
    requireCondition(asset.temporal.failingTransitionCount === 0, `${label} contains a failing temporal transition`);
    requireArray(asset.temporal.eyeTransitionLandmarks, `${label}.eyeTransitionLandmarks`);
    requireCondition(asset.temporal.eyeTransitionLandmarks.length === 2, `${label} must cover two eye-transition landmarks`);
    requireCondition(
      asset.temporal.eyeTransitionLandmarks.every((landmark) => landmark.passes === true && landmark.flags.length === 0),
      `${label} has a failing eye-transition landmark`,
    );
    requireArray(asset.temporal.transitions, `${label}.transitions`);
    requireCondition(asset.temporal.transitions.length === asset.pages, `${label} transition coverage is incomplete`);
    for (const [index, transition] of asset.temporal.transitions.entries()) {
      requireCondition(transition.fromPage === index, `${label} transition ${index} has a non-sequential source page`);
      requireCondition(transition.toPage === (index + 1) % asset.pages, `${label} transition ${index} has a non-sequential destination page`);
      requireCondition(transition.seam === (index === asset.pages - 1), `${label} transition ${index} seam flag is wrong`);
      requireArray(transition.flags, `${label}.transitions[${index}].flags`);
      requireCondition(transition.flags.length === 0, `${label} transition ${index} failed: ${transition.flags.join(",")}`);
    }
    displayedFrames += asset.pages;
    adjacentTransitions += asset.temporal.adjacentTransitions;
    loopSeams += asset.temporal.loopSeams;
    eyeTransitionLandmarks += asset.temporal.eyeTransitionLandmarks.length;
  }
  requireCondition(report.summary?.effects === 14 && report.summary?.themes === 2 && report.summary?.assets === 28, "source-motion temporal summary coverage is wrong");
  requireCondition(report.summary.displayedFrames === displayedFrames, "source-motion temporal displayed-frame total is stale");
  requireCondition(report.summary.adjacentTransitions === adjacentTransitions && adjacentTransitions === displayedFrames - 28, "source-motion temporal adjacent-transition total is stale");
  requireCondition(report.summary.loopSeams === loopSeams && loopSeams === 28, "source-motion temporal loop-seam total is stale");
  requireCondition(report.summary.eyeTransitionLandmarks === eyeTransitionLandmarks && eyeTransitionLandmarks === 56, "source-motion temporal eye-landmark total is stale");
  requireCondition(report.summary.failingTemporalTransitions === 0, "source-motion temporal summary contains failures");
  requireCondition(report.eyeTransition?.passes === true, "source-motion eye-transition proof must pass");
  requireArray(report.eyeTransition?.landmarks, "source-motion eye-transition landmarks");
  requireCondition(report.eyeTransition.landmarks.length === 56, "source-motion eye-transition proof must cover 56 landmarks");
  requireCondition(report.eyeTransition.landmarks.every((landmark) => landmark.passes === true), "source-motion eye-transition landmark failed");

  const allFrameBytes = await readFile(absolute(allFramePath));
  const worstCaseBytes = await readFile(absolute(worstCasePath));
  requireArtifactPath(report.artifacts?.report, reportPath, "source-motion temporal report artifact path");
  requireArtifactPath(report.artifacts?.allFrameSheet, allFramePath, "source-motion temporal all-frame sheet path");
  requireCondition(report.artifacts.allFrameSheetSha256 === sha256(allFrameBytes), "source-motion temporal all-frame sheet SHA is stale");
  requireArtifactPath(report.artifacts?.worstCaseSheet, worstCasePath, "source-motion temporal worst-case sheet path");
  requireCondition(report.artifacts.worstCaseSheetSha256 === sha256(worstCaseBytes), "source-motion temporal worst-case sheet SHA is stale");
  const [allFrameMetadata, worstCaseMetadata] = await Promise.all([
    sharp(allFrameBytes, { failOn: "error" }).metadata(),
    sharp(worstCaseBytes, { failOn: "error" }).metadata(),
  ]);
  requireCondition(allFrameMetadata.format === "png", "source-motion temporal all-frame sheet must be PNG");
  requireCondition(worstCaseMetadata.format === "png", "source-motion temporal worst-case sheet must be PNG");
  requireCondition(
    allFrameMetadata.width > 0 && allFrameMetadata.height > 0
      && worstCaseMetadata.width > 0 && worstCaseMetadata.height > 0,
    "source-motion temporal review sheet dimensions are invalid",
  );
  requireArray(report.artifacts.worstCaseSheetRows, "source-motion temporal worst-case rows");
  requireCondition(report.artifacts.worstCaseSheetRows.length === 28, "source-motion temporal worst-case sheet must cover 28 assets");
  requireCondition(
    report.artifacts.worstCaseSheetRows.every((row) => Array.isArray(row.flags) && row.flags.length === 0),
    "source-motion temporal worst-case sheet includes a failing transition",
  );

  return Object.freeze({
    report: { path: reportPath, sha256: sha256(reportBytes) },
    allFrameSheet: {
      path: allFramePath,
      sha256: sha256(allFrameBytes),
      width: allFrameMetadata.width,
      height: allFrameMetadata.height,
    },
    worstCaseSheet: {
      path: worstCasePath,
      sha256: sha256(worstCaseBytes),
      width: worstCaseMetadata.width,
      height: worstCaseMetadata.height,
    },
    summary: Object.freeze({ ...report.summary }),
  });
}

async function artifactHashes(paths) {
  const entries = await Promise.all(
    paths.map(async (relative) => [relative, sha256(await readFile(absolute(relative)))]),
  );
  return Object.fromEntries(entries);
}

async function verifyAllReports() {
  requireCondition(
    new Set(VARIANT_NAMES.map((variant) => VARIANTS[variant].id)).size === VARIANT_NAMES.length,
    "pet variant IDs must be unique",
  );
  const shippingAtlasEntries = await Promise.all(
    VARIANT_NAMES.map(async (variant) => [
      variant,
      await inspectAtlasFirstPage(
        variant,
        VARIANTS[variant].atlasPath,
        "shipping",
      ),
    ]),
  );
  const authoringAtlasEntries = await Promise.all(
    VARIANT_NAMES.map(async (variant) => [
      variant,
      await inspectAtlasFirstPage(
        variant,
        VARIANTS[variant].authoringAtlasPath,
        "authoring",
      ),
    ]),
  );
  const shippingAtlases = Object.fromEntries(shippingAtlasEntries);
  const authoringAtlases = Object.fromEntries(authoringAtlasEntries);
  const variantResults = {};
  for (const variant of VARIANT_NAMES) {
    variantResults[variant] = await verifyVariant(
      variant,
      VARIANTS[variant],
      shippingAtlases[variant],
      authoringAtlases[variant],
    );
  }
  const animatedReports = Object.fromEntries(
    VARIANT_NAMES.map((variant) => [variant, variantResults[variant].animatedReport]),
  );
  await verifyCombinedAnimatedAtlases(animatedReports, shippingAtlases);
  await verifyOfficialHatchSeal(authoringAtlases);
  await verifyThemeParity(authoringAtlases);
  await verifyAlphaEdges(authoringAtlases);
  await verifyCombinedRuntimeContinuity(authoringAtlases);
  await verifySourceMotionStudies();
  const defaultDpr2BrowserOracle = await verifyDefaultDpr2BrowserOracle();
  const arbitraryPhaseQa = await verifyArbitraryPhaseQa(defaultDpr2BrowserOracle);
  const exhaustiveEdgeQa = await verifyExhaustiveEdgeQa();
  const sourceMotionTemporalQa = await verifySourceMotionTemporalQa();
  requireCondition(
    exhaustiveEdgeQa.coverage.expectedSourceMotionEncodedPages
      === sourceMotionTemporalQa.summary.displayedFrames,
    "exhaustive edge and temporal QA disagree on the exact encoded source-motion page total",
  );
  const blind = await verifyDarkBlindSuite(authoringAtlases.dark);

  return {
    shippingAtlases,
    authoringAtlases,
    variantResults,
    sharedAssertions: Object.freeze({
      animatedAtlasReports: true,
      themeAlphaMaskEquality: true,
      authoringAlphaEdges: true,
      exactSourcePalettePresent: true,
      runtimeContinuity: true,
      sourceMotionStudies: true,
      exactDefaultDpr2BrowserOracle: true,
      arbitraryDecoderPhaseCoverage: true,
      exhaustiveEdgeAndCompositing: true,
      sourceMotionTemporalContinuity: true,
      sourceMotionEncodedPageTotalsAgree: true,
      officialHatchSeal: true,
      darkBlindSuite: true,
      ...blind.assertions,
    }),
    blindStimulus: blind.stimulus,
    defaultDpr2BrowserOracle,
    arbitraryPhaseQa,
    exhaustiveEdgeQa,
    sourceMotionTemporalQa,
  };
}

async function buildEvidence(verified) {
  const variants = {};
  for (const variant of VARIANT_NAMES) {
    const config = VARIANTS[variant];
    variants[variant] = {
      petId: config.id,
      manifest: verified.variantResults[variant].manifest,
      shippingAtlas: {
        path: config.atlasPath,
        sha256: verified.shippingAtlases[variant].sha256,
        bytes: verified.shippingAtlases[variant].bytes,
        firstPageRgba: {
          width: verified.shippingAtlases[variant].width,
          height: verified.shippingAtlases[variant].height,
          channels: verified.shippingAtlases[variant].channels,
          alphaMaskSha256: verified.shippingAtlases[variant].alphaMaskSha256,
          exactAccentColorPixels: verified.shippingAtlases[variant].exactAccentColorPixels,
        },
      },
      authoringAtlas: {
        path: config.authoringAtlasPath,
        sha256: verified.authoringAtlases[variant].sha256,
        bytes: verified.authoringAtlases[variant].bytes,
        width: verified.authoringAtlases[variant].width,
        height: verified.authoringAtlases[variant].height,
        channels: verified.authoringAtlases[variant].channels,
        alphaMaskSha256: verified.authoringAtlases[variant].alphaMaskSha256,
      },
      animatedAtlasReport: {
        path: config.animatedReportPath,
        sha256: sha256(await readFile(absolute(config.animatedReportPath))),
      },
      artifacts: await artifactHashes(config.artifactPaths),
      assertions: verified.variantResults[variant].assertions,
    };
  }
  return {
    schemaVersion: 4,
    variants,
    shared: {
      artifacts: await artifactHashes(SHARED_ARTIFACT_PATHS),
      blindStimulus: verified.blindStimulus,
      defaultDpr2BrowserOracle: verified.defaultDpr2BrowserOracle,
      arbitraryPhaseQa: verified.arbitraryPhaseQa,
      exhaustiveEdgeQa: verified.exhaustiveEdgeQa,
      sourceMotionTemporalQa: verified.sourceMotionTemporalQa,
      assertions: verified.sharedAssertions,
    },
  };
}

async function seal() {
  await requireInputs();
  const verified = await verifyAllReports();
  const evidence = await buildEvidence(verified);
  await writeJson(evidencePath, evidence);
  const artifactCount = VARIANT_NAMES.reduce(
    (total, variant) => total + VARIANTS[variant].artifactPaths.length,
    SHARED_ARTIFACT_PATHS.length,
  );
  console.log(
    `Sealed ${artifactCount} QA artifacts for animated dark ${verified.shippingAtlases.dark.sha256} and light ${verified.shippingAtlases.light.sha256}`,
  );
}

async function verify() {
  await requireInputs();
  const missingEvidence = await missingPaths([evidencePath]);
  requireCondition(
    missingEvidence.length === 0,
    `missing ${evidencePath}; run npm run qa:seal after all final QA artifacts pass`,
  );
  const evidence = await readJson(evidencePath);
  requireCondition(evidence.schemaVersion === 4, "QA evidence schema must be 4");
  const verified = await verifyAllReports();
  const expected = await buildEvidence(verified);
  requireCondition(
    deepEqual(evidence, expected),
    "QA evidence or one of its sealed manifests, atlases, or artifacts changed; review and rerun npm run qa:seal",
  );
  const artifactCount = VARIANT_NAMES.reduce(
    (total, variant) => total + VARIANTS[variant].artifactPaths.length,
    SHARED_ARTIFACT_PATHS.length,
  );
  console.log(
    `PASS: ${artifactCount} sealed QA artifacts match animated dark ${verified.shippingAtlases.dark.sha256} and light ${verified.shippingAtlases.light.sha256}`,
  );
}

async function main() {
  try {
    if (process.argv.slice(2).includes("--seal")) await seal();
    else await verify();
  } catch (error) {
    console.error(`QA evidence failure: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
