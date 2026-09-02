#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildAnimatedAtlasTemporalArtifacts } from "./animated-atlas-temporal-artifacts.mjs";
import { renderShippingHostFrame } from "./exhaustive-edge-qa.mjs";
import { CODEX_DEFAULT_DPR2_DISPLAY } from "./codex-default-dpr2-oracle.mjs";
import { timeWeightedLinearResidual } from "../src/encoded-timeline-metrics.mjs";
import {
  FLUID_ATLAS_FRAME_COUNT,
  FLUID_ATLAS_LOOP_MS,
  fluidAtlasDelays,
} from "../src/fluid-atlas.mjs";
import { THEME_PALETTES } from "../src/grok-art.mjs";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  COLUMNS,
  ROWS,
  ROW_COUNT,
} from "../src/spec.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ATLAS_BYTES = 20 * 1024 * 1024;
const SAFETY_GUTTER_PX = 4;
const REQUIRED_COLUMNS_BY_ROW = Object.freeze([6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
const REQUIRED_CELL_COUNT = REQUIRED_COLUMNS_BY_ROW.reduce((total, count) => total + count, 0);
const UNUSED_CELL_COUNT = COLUMNS * ROW_COUNT - REQUIRED_CELL_COUNT;
const TIMED_ROWS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]);
const ACTION_ROWS = Object.freeze(TIMED_ROWS.slice(1));
const GAZE_ELIGIBLE_ROWS = Object.freeze([0, 3, 7]);
const ACCENT_KEYS = Object.freeze(["coral", "blue", "green", "gold", "violet", "teal"]);
const DIFF_EPSILON = 1e-12;
const MAX_INSPECTABLE_PAGES = 128;
export const TEMPORAL_MOTION_GATE = Object.freeze({
  minimumChangedPixelFractionPerInternalTransition: 0.001,
  minimumNormalizedRgbaDiffPerInternalTransition: 0.00001,
  requiresDistinctAlphaFrames: true,
  // Pixel quantization can leave one or two individually sub-threshold gaze
  // adjacencies even though the authored 60-phase orbit moves continuously as
  // a whole. These lower bounds retain 2.5% measured headroom on the weakest
  // complete light-theme gaze cycle; timed/action rows remain strict per edge.
  gazeFullCycle: Object.freeze({
    rowIndices: Object.freeze([9, 10]),
    minimumActiveInternalTransitionFraction: 0.925,
    minimumTotalNormalizedRgbaDiff: 0.0048248,
    minimumTotalChangedPixelFraction: 0.88064,
  }),
});
const MIN_TEMPORAL_CHANGED_PIXEL_FRACTION
  = TEMPORAL_MOTION_GATE.minimumChangedPixelFractionPerInternalTransition;
const MIN_TEMPORAL_NORMALIZED_RGBA_DIFF
  = TEMPORAL_MOTION_GATE.minimumNormalizedRgbaDiffPerInternalTransition;
const TEMPORAL_FEATURE_ROI = Object.freeze({ minX: 20, minY: 20, maxX: 175, maxY: 160 });
const TEMPORAL_SURFACES = Object.freeze({
  dark: Object.freeze({ background: Object.freeze([8, 11, 12]), featureTone: 0 }),
  light: Object.freeze({ background: Object.freeze([243, 241, 233]), featureTone: 255 }),
});
// Kept as an export alias for the existing report schema; the bytes now come
// from the exact 7.04rem/DPR2 browser screenshot oracle rather than an
// integer-size coordinate helper.
export const SHIPPING_112_DISPLAY = CODEX_DEFAULT_DPR2_DISPLAY;

// Upper bounds apply to every required cell's 59 internal adjacencies and one
// loop seam. Global limits stop a large replacement anywhere. Frozen per-row
// limits keep a quiet gaze/locomotion row from inheriting the much larger
// allowance needed by jump and review. Perceptual and feature-local limits are
// evaluated after straight-alpha compositing on the intended Codex surface.
export const ANIMATED_TEMPORAL_ADJACENCY_GATE = Object.freeze({
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
  minimumFeatureInkEndpointPeakFraction: 0.10,
  isolatedSnapMinimumPerceptualRms: 1,
  localEnergyFloorPerceptualRms: 0.25,
  maximumLocalEnergyRatio: 1.72343,
  isolatedFrameMinimumPerceptualRms: 1,
  isolatedFrameSkipEnergyFloorPerceptualRms: 0.25,
  maximumIsolatedFrameExcursionRatio: 3.38,
  perceptualModel: "intended-surface sRGB alpha composite; luma-weighted YCbCr distance (0-100)",
  strongDifferenceThreshold: 8,
  featureRoi: TEMPORAL_FEATURE_ROI,
  loop: Object.freeze({
    maximumNormalizedRgbaDiff: 0.00673,
    maximumNormalizedAlphaDiff: 0.00562,
    maximumChangedPixelFraction: 0.03583,
    maximumChangedAlphaPixelFraction: 0.02304,
    maximumSilhouetteCentroidDistancePx: 0.642,
  }),
});

export const ANIMATED_TEMPORAL_ROW_GATES = Object.freeze({
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
// Frozen independently on the complete authoritative 7.04rem fallback / DPR2 browser trace. The tight per-row ceilings preserve genuine authored motion while
// catching nearest-neighbor alias excursions that a source-cell average hides.
export const ANIMATED_112_TEMPORAL_GATE = Object.freeze({
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
export const ANIMATED_112_TEMPORAL_ROW_GATES = Object.freeze({
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
const THEME_RELATION_CHANNEL_TOLERANCE = 3;
const MAX_UNCLASSIFIED_VISIBLE_PAIR_FRACTION = 0.00012;
const MAX_PALETTE_ROLE_MISMATCH_VISIBLE_PAIR_FRACTION = 0.0001;
const SAME_PHASE_TRANSITION_GATES = Object.freeze({
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
export const GAZE_BODY_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 120,
  requiredPhasesPerPair: FLUID_ATLAS_FRAME_COUNT,
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
export const GAZE_BODY_CROSS_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 16 * 13,
  requiredPhasesPerPair: FLUID_ATLAS_FRAME_COUNT,
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

// Frozen independently from every boundary in the complete default
// 7.04rem fallback / DPR2 host matrix. Each type keeps about four percent measured
// headroom instead of inheriting a looser unrelated state-switch envelope.
export const DISPLAYED_112_HOST_BOUNDARY_GATES = Object.freeze({
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
export const DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 16 * 13 / 2,
  requiredPhasesPerPair: FLUID_ATLAS_FRAME_COUNT,
  maximumAdjacentStep: Object.freeze({ silhouetteIou: 0.0017148612, silhouetteCentroidDistancePx: 0.096489, normalizedAlphaDiff: 0.00023839088, alphaAreaRatioSymmetric: 0.00294826272 }),
  maximumSecondDifferenceResidual: Object.freeze({ silhouetteIou: 0.00095294368, silhouetteCentroidDistancePx: 0.05713078488, normalizedAlphaDiff: 0.00023263344, alphaAreaRatioSymmetric: 0.00221755664 }),
  maximumPairRange: Object.freeze({ silhouetteIou: 0.00307643336, silhouetteCentroidDistancePx: 0.213377, normalizedAlphaDiff: 0.00078077168, alphaAreaRatioSymmetric: 0.00335386688 }),
});
export const DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE = Object.freeze({
  requiredPairs: 16 * 13,
  requiredPhasesPerPair: FLUID_ATLAS_FRAME_COUNT,
  maximumAdjacentStep: Object.freeze({ silhouetteIou: 0.00129268568, silhouetteCentroidDistancePx: 0.102391, normalizedAlphaDiff: 0.00034945248, alphaAreaRatioSymmetric: 0.0030197128 }),
  maximumSecondDifferenceResidual: Object.freeze({ silhouetteIou: 0.0009464, silhouetteCentroidDistancePx: 0.077811, normalizedAlphaDiff: 0.00023998936, alphaAreaRatioSymmetric: 0.00295903088 }),
  maximumPairRange: Object.freeze({ silhouetteIou: 0.00363833496, silhouetteCentroidDistancePx: 0.2197, normalizedAlphaDiff: 0.0010667072, alphaAreaRatioSymmetric: 0.004706832 }),
});

const VARIANTS = Object.freeze({
  dark: Object.freeze({
    atlasPath: "pet/grok-bot-dark/spritesheet.webp",
    manifestPath: "pet/grok-bot-dark/pet.json",
    petId: "grok-bot-dark",
    theme: "dark-codex",
  }),
  light: Object.freeze({
    atlasPath: "pet/grok-bot-light/spritesheet.webp",
    manifestPath: "pet/grok-bot-light/pet.json",
    petId: "grok-bot-light",
    theme: "light-codex",
  }),
});

const EXPECTED_DELAYS = Object.freeze(fluidAtlasDelays());

function round(value, digits = 9) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

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

function featureInkWeight(red, green, blue, alpha, featureTone) {
  if (alpha === 0) return 0;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const neutralWeight = 1 - clamp((maximum - minimum) / 24, 0, 1);
  const tone = (red + green + blue) / (3 * 255);
  const featureToneWeight = featureTone === 0 ? 1 - tone : tone;
  return alpha / 255 * neutralWeight * featureToneWeight;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function exactIdMembership(actualIds, expectedIds) {
  const counts = new Map();
  for (const id of actualIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(expectedIds);
  const duplicateIds = [...counts.entries()]
    .filter(([, count]) => count !== 1)
    .map(([id]) => id)
    .toSorted();
  const missingIds = expectedIds.filter((id) => !actualSet.has(id));
  const unexpectedIds = actualIds.filter((id) => !expectedSet.has(id));
  const orderedExactly = arraysEqual(actualIds, expectedIds);
  return {
    ok: duplicateIds.length === 0
      && missingIds.length === 0
      && unexpectedIds.length === 0
      && orderedExactly,
    expectedCount: expectedIds.length,
    actualCount: actualIds.length,
    orderedExactly,
    duplicateIds,
    missingIds,
    unexpectedIds,
    expectedIdsSha256: sha256Json(expectedIds),
    actualIdsSha256: sha256Json(actualIds),
  };
}

function gazeDirectionDistance(left, right) {
  const absolute = Math.abs(left - right);
  return Math.min(absolute, 16 - absolute);
}

function gazeDirectionsAdjacent(left, right) {
  return gazeDirectionDistance(left, right) === 1;
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) throw new Error(`Expected a six-digit RGB color, received ${JSON.stringify(value)}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function rgbEqual(red, green, blue, expected) {
  return red === expected[0] && green === expected[1] && blue === expected[2];
}

function setMaskBit(mask, pixelIndex) {
  mask[pixelIndex >> 3] |= 1 << (pixelIndex & 7);
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function requiredCells() {
  return REQUIRED_COLUMNS_BY_ROW.flatMap((columns, row) =>
    Array.from({ length: columns }, (_, column) => ({
      column,
      key: `r${row}c${column}`,
      row,
      state: ROWS[row]?.id ?? `row-${row}`,
    })),
  );
}

function contractErrors() {
  const errors = [];
  if (ATLAS_WIDTH !== 1536 || ATLAS_HEIGHT !== 2288) {
    errors.push(`source contract must remain 1536x2288; received ${ATLAS_WIDTH}x${ATLAS_HEIGHT}`);
  }
  if (CELL_WIDTH !== 192 || CELL_HEIGHT !== 208 || COLUMNS !== 8 || ROW_COUNT !== 11) {
    errors.push(
      `source cell grid must remain 8x11 at 192x208; received ${COLUMNS}x${ROW_COUNT} at ${CELL_WIDTH}x${CELL_HEIGHT}`,
    );
  }
  const sourceCounts = ROWS.map((row) => row.frames.length);
  if (!arraysEqual(sourceCounts, REQUIRED_COLUMNS_BY_ROW)) {
    errors.push(
      `source required-cell layout must be ${REQUIRED_COLUMNS_BY_ROW.join(",")}; received ${sourceCounts.join(",")}`,
    );
  }
  if (REQUIRED_CELL_COUNT !== 73 || UNUSED_CELL_COUNT !== 15) {
    errors.push(`source contract must contain 73 required and 15 unused cells`);
  }
  return errors;
}

function paletteContract(variant) {
  const config = VARIANTS[variant];
  const palette = THEME_PALETTES[config.theme];
  return {
    body: hexToRgb(palette.body),
    feature: hexToRgb(palette.eye),
    accents: Object.fromEntries(ACCENT_KEYS.map((key) => [key, hexToRgb(palette[key])])),
  };
}

function featurePixel(variant, red, green, blue, alpha, localX, localY) {
  if (alpha <= 180 || localX < 20 || localX >= 175 || localY < 20 || localY >= 160) return false;
  return variant === "light"
    ? red > 180 && green > 180 && blue > 180
    : red < 75 && green < 75 && blue < 75;
}

function findEyeComponents(mask) {
  const visited = Buffer.alloc(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let origin = 0; origin < mask.length; origin += 1) {
    if (mask[origin] === 0 || visited[origin] !== 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = origin;
    visited[origin] = 1;
    let pixels = 0;
    let xTotal = 0;
    let yTotal = 0;
    let minX = CELL_WIDTH;
    let minY = CELL_HEIGHT;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % CELL_WIDTH;
      const y = Math.floor(index / CELL_WIDTH);
      pixels += 1;
      xTotal += x;
      yTotal += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= CELL_WIDTH || nextY < 0 || nextY >= CELL_HEIGHT) continue;
          const next = nextY * CELL_WIDTH + nextX;
          if (mask[next] === 0 || visited[next] !== 0) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (pixels >= 12) {
      components.push({
        pixels,
        center: { x: xTotal / pixels, y: yTotal / pixels },
        bounds: { minX, minY, maxX, maxY },
      });
    }
  }
  return components
    .sort((left, right) => right.pixels - left.pixels)
    .slice(0, 2)
    .sort((left, right) => left.center.x - right.center.x);
}

function inspectGaze(cells) {
  const errors = [];
  const hashes = cells.map((cell) => cell.rgbaSha256);
  const distinctCellCount = new Set(hashes).size;
  if (distinctCellCount !== 16) errors.push(`gaze cells contain ${distinctCellCount}/16 distinct authored images`);

  const readable = cells.every((cell) =>
    cell.featureCenter
    && cell.faceFeaturePixels >= 120
    && cell.eyeComponents.length === 2);
  if (!readable) {
    errors.push("all gaze cells must expose two readable eye components and at least 120 eye-feature pixels");
    return {
      ok: false,
      distinctCellCount,
      hashes,
      familyCenter: null,
      directions: [],
      eyeFamilies: [],
      componentCounts: cells.map((cell, index) => ({
        angleDegrees: index * 22.5,
        faceFeaturePixels: cell.faceFeaturePixels,
        components: cell.eyeComponents,
      })),
      errors,
    };
  }

  const familyCenter = {
    x: cells.reduce((sum, cell) => sum + cell.featureCenter.x, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.featureCenter.y, 0) / cells.length,
  };
  const directions = cells.map((cell, index) => {
    const angleDegrees = index * 22.5;
    const radians = angleDegrees * Math.PI / 180;
    const expectedX = Math.sin(radians);
    const expectedY = -Math.cos(radians);
    const dx = cell.featureCenter.x - familyCenter.x;
    const dy = cell.featureCenter.y - familyCenter.y;
    const forward = dx * expectedX + dy * expectedY;
    const sideways = Math.abs(dx * expectedY - dy * expectedX);
    const horizontalCorrect = Math.abs(expectedX) <= 0.25 || Math.sign(dx) === Math.sign(expectedX);
    const verticalCorrect = Math.abs(expectedY) <= 0.25 || Math.sign(dy) === Math.sign(expectedY);
    return {
      angleDegrees,
      center: cell.featureCenter,
      dx: round(dx, 4),
      dy: round(dy, 4),
      forward: round(forward, 4),
      sideways: round(sideways, 4),
      forwardReadable: forward >= 7,
      sidewaysControlled: sideways <= 10,
      horizontalCorrect,
      verticalCorrect,
    };
  });

  for (const direction of directions) {
    if (!direction.forwardReadable) errors.push(`gaze ${direction.angleDegrees}deg is not displaced far enough`);
    if (!direction.sidewaysControlled) errors.push(`gaze ${direction.angleDegrees}deg drifts off its intended axis`);
    if (!direction.horizontalCorrect) errors.push(`gaze ${direction.angleDegrees}deg moves along the wrong horizontal axis`);
    if (!direction.verticalCorrect) errors.push(`gaze ${direction.angleDegrees}deg moves along the wrong vertical axis`);
  }

  const adjacency = cells.map((cell, index) => {
    const next = cells[(index + 1) % cells.length];
    return round(Math.hypot(next.featureCenter.x - cell.featureCenter.x, next.featureCenter.y - cell.featureCenter.y), 4);
  });
  adjacency.forEach((distance, index) => {
    if (distance > 12) errors.push(`gaze ${index * 22.5}deg to ${((index + 1) % 16) * 22.5}deg jumps ${distance}px`);
  });

  const cardinalChecks = [
    { index: 0, label: "up", ok: cells[0].featureCenter.y < familyCenter.y - 4 },
    { index: 4, label: "right", ok: cells[4].featureCenter.x > familyCenter.x + 8 },
    { index: 8, label: "down", ok: cells[8].featureCenter.y > familyCenter.y + 2 },
    { index: 12, label: "left", ok: cells[12].featureCenter.x < familyCenter.x - 8 },
  ];
  cardinalChecks.forEach((check) => {
    if (!check.ok) errors.push(`cardinal gaze ${check.label} is not strongly authored`);
  });

  const eyeFamilies = [0, 1].map((eyeIndex) => {
    const centers = cells.map((cell) => cell.eyeComponents[eyeIndex].center);
    const center = {
      x: centers.reduce((sum, candidate) => sum + candidate.x, 0) / centers.length,
      y: centers.reduce((sum, candidate) => sum + candidate.y, 0) / centers.length,
    };
    const checks = centers.map((candidate, directionIndex) => {
      const angleDegrees = directionIndex * 22.5;
      const radians = angleDegrees * Math.PI / 180;
      const expectedX = Math.sin(radians);
      const expectedY = -Math.cos(radians);
      const dx = candidate.x - center.x;
      const dy = candidate.y - center.y;
      const forward = dx * expectedX + dy * expectedY;
      const sideways = Math.abs(dx * expectedY - dy * expectedX);
      return {
        angleDegrees,
        center: { x: round(candidate.x, 4), y: round(candidate.y, 4) },
        forward: round(forward, 4),
        sideways: round(sideways, 4),
        ok: forward >= 5
          && sideways <= 10
          && (Math.abs(expectedX) <= 0.25 || Math.sign(dx) === Math.sign(expectedX))
          && (Math.abs(expectedY) <= 0.25 || Math.sign(dy) === Math.sign(expectedY)),
      };
    });
    checks.forEach((check) => {
      if (!check.ok) errors.push(`eye ${eyeIndex + 1} gaze ${check.angleDegrees}deg is not directionally authored`);
    });
    return {
      eye: eyeIndex + 1,
      familyCenter: { x: round(center.x, 4), y: round(center.y, 4) },
      checks,
      ok: checks.every((check) => check.ok),
    };
  });

  return {
    ok: errors.length === 0,
    distinctCellCount,
    hashes,
    familyCenter: { x: round(familyCenter.x, 4), y: round(familyCenter.y, 4) },
    directions,
    adjacentCenterDistancesPx: adjacency,
    cardinalChecks,
    eyeFamilies,
    componentCounts: cells.map((cell, index) => ({
      angleDegrees: index * 22.5,
      faceFeaturePixels: cell.faceFeaturePixels,
      components: cell.eyeComponents,
    })),
    errors,
  };
}

function transitionGateResult(kind, metric) {
  const gate = SAME_PHASE_TRANSITION_GATES[kind];
  const checks = {
    silhouetteIou: metric.silhouetteIou >= gate.minimumSilhouetteIou,
    silhouetteCentroidDistancePx:
      metric.silhouetteCentroidDistancePx <= gate.maximumSilhouetteCentroidDistancePx,
    normalizedAlphaDiff: metric.normalizedAlphaDiff <= gate.maximumNormalizedAlphaDiff,
    alphaAreaRatioSymmetric: metric.alphaAreaRatioSymmetric <= gate.maximumAlphaAreaRatioSymmetric,
  };
  if (gate.maximumNormalizedRgbaDiff != null) {
    checks.normalizedRgbaDiff = metric.normalizedRgbaDiff <= gate.maximumNormalizedRgbaDiff;
  }
  if (gate.maximumChangedPixelFraction != null) {
    checks.changedPixelFraction = metric.changedPixelFraction <= gate.maximumChangedPixelFraction;
  }
  if (gate.maximumChangedAlphaPixelFraction != null) {
    checks.changedAlphaPixelFraction
      = metric.changedAlphaPixelFraction <= gate.maximumChangedAlphaPixelFraction;
  }
  return { ok: Object.values(checks).every(Boolean), gate, checks };
}

function temporalAdjacencyGateResult(metric, row, seam) {
  const rowGate = ANIMATED_TEMPORAL_ROW_GATES[row];
  const checks = {
    normalizedRgbaDiff:
      metric.normalizedRgbaDiff <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumNormalizedRgbaDiff,
    normalizedAlphaDiff:
      metric.normalizedAlphaDiff <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumNormalizedAlphaDiff,
    changedPixelFraction:
      metric.changedPixelFraction <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumChangedPixelFraction,
    changedAlphaPixelFraction:
      metric.changedAlphaPixelFraction
        <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumChangedAlphaPixelFraction,
    rowNormalizedRgbaDiff: metric.normalizedRgbaDiff <= rowGate.maximumNormalizedRgbaDiff,
    rowNormalizedAlphaDiff: metric.normalizedAlphaDiff <= rowGate.maximumNormalizedAlphaDiff,
    rowChangedPixelFraction: metric.changedPixelFraction <= rowGate.maximumChangedPixelFraction,
    rowChangedAlphaPixelFraction:
      metric.changedAlphaPixelFraction <= rowGate.maximumChangedAlphaPixelFraction,
    rowPerceptualRms: metric.perceptualRms <= rowGate.maximumPerceptualRms,
    rowStronglyChangedCellFraction:
      metric.stronglyChangedCellFraction <= rowGate.maximumStronglyChangedCellFraction,
    perceptualRms: metric.perceptualRms <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumPerceptualRms,
    stronglyChangedCellFraction:
      metric.stronglyChangedCellFraction
        <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumStronglyChangedCellFraction,
    featureInkMassStepFraction:
      !metric.featureInkMaterial
      || metric.featureInkMassStepFraction
        <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumFeatureInkMassStepFraction,
    featureInkVariationFraction:
      !metric.featureInkMaterial
      || metric.featureInkVariationFraction
        <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumFeatureInkVariationFraction,
    featureInkCentroidStepPx:
      !metric.featureInkCentroidMaterial
      || metric.featureInkCentroidStepPx
        <= ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumFeatureInkCentroidStepPx,
    rowFeatureInkMassStepFraction:
      !metric.featureInkMaterial
      || metric.featureInkMassStepFraction <= rowGate.maximumFeatureInkMassStepFraction,
    rowFeatureInkVariationFraction:
      !metric.featureInkMaterial
      || metric.featureInkVariationFraction <= rowGate.maximumFeatureInkVariationFraction,
    rowFeatureInkCentroidStepPx:
      !metric.featureInkCentroidMaterial
      || metric.featureInkCentroidStepPx <= rowGate.maximumFeatureInkCentroidStepPx,
    localEnergyRatio: metric.perceptualRms
      < ANIMATED_TEMPORAL_ADJACENCY_GATE.isolatedSnapMinimumPerceptualRms
      || metric.localEnergyRatio <= Math.min(
        ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumLocalEnergyRatio,
        rowGate.maximumLocalEnergyRatio,
      ),
  };
  if (seam) {
    checks.loopNormalizedRgbaDiff = metric.normalizedRgbaDiff
      <= ANIMATED_TEMPORAL_ADJACENCY_GATE.loop.maximumNormalizedRgbaDiff;
    checks.loopNormalizedAlphaDiff = metric.normalizedAlphaDiff
      <= ANIMATED_TEMPORAL_ADJACENCY_GATE.loop.maximumNormalizedAlphaDiff;
    checks.loopChangedPixelFraction = metric.changedPixelFraction
      <= ANIMATED_TEMPORAL_ADJACENCY_GATE.loop.maximumChangedPixelFraction;
    checks.loopChangedAlphaPixelFraction = metric.changedAlphaPixelFraction
      <= ANIMATED_TEMPORAL_ADJACENCY_GATE.loop.maximumChangedAlphaPixelFraction;
    checks.loopSilhouetteCentroidDistancePx = metric.silhouetteCentroidDistancePx
      <= ANIMATED_TEMPORAL_ADJACENCY_GATE.loop.maximumSilhouetteCentroidDistancePx;
  }
  return {
    ok: Object.values(checks).every(Boolean),
    rowGate,
    checks,
    flags: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name),
  };
}

function isolatedFrameGateResult(excursion, row) {
  const rowGate = ANIMATED_TEMPORAL_ROW_GATES[row];
  const material = Math.min(
    excursion.previousPerceptualRms,
    excursion.nextPerceptualRms,
  ) >= ANIMATED_TEMPORAL_ADJACENCY_GATE.isolatedFrameMinimumPerceptualRms;
  const checks = {
    isolatedFrameExcursionRatio: !material
      || excursion.excursionRatio
        <= Math.min(
          ANIMATED_TEMPORAL_ADJACENCY_GATE.maximumIsolatedFrameExcursionRatio,
          rowGate.maximumIsolatedFrameExcursionRatio,
        ),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    material,
    rowGateMaximumIsolatedFrameExcursionRatio: rowGate.maximumIsolatedFrameExcursionRatio,
    checks,
    flags: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name),
  };
}

function summarizeSamePhaseTransitions(transitions) {
  if (transitions.length === 0) {
    return {
      count: 0,
      passing: 0,
      minimumSilhouetteIou: null,
      maximumSilhouetteCentroidDistancePx: null,
      maximumNormalizedRgbaDiff: null,
      maximumNormalizedAlphaDiff: null,
      maximumChangedPixelFraction: null,
      maximumChangedAlphaPixelFraction: null,
      maximumAlphaAreaRatioSymmetric: null,
    };
  }
  return {
    count: transitions.length,
    passing: transitions.filter((transition) => transition.validation.ok).length,
    minimumSilhouetteIou: round(Math.min(...transitions.map((transition) => transition.metrics.silhouetteIou))),
    maximumSilhouetteCentroidDistancePx: round(
      Math.max(...transitions.map((transition) => transition.metrics.silhouetteCentroidDistancePx)),
    ),
    maximumNormalizedRgbaDiff: round(
      Math.max(...transitions.map((transition) => transition.metrics.normalizedRgbaDiff)),
    ),
    maximumNormalizedAlphaDiff: round(
      Math.max(...transitions.map((transition) => transition.metrics.normalizedAlphaDiff)),
    ),
    maximumChangedPixelFraction: round(
      Math.max(...transitions.map((transition) => transition.metrics.changedPixelFraction)),
    ),
    maximumChangedAlphaPixelFraction: round(
      Math.max(...transitions.map((transition) => transition.metrics.changedAlphaPixelFraction)),
    ),
    maximumAlphaAreaRatioSymmetric: round(
      Math.max(...transitions.map((transition) => transition.metrics.alphaAreaRatioSymmetric)),
    ),
  };
}

export function analyzeGazeBodyPhaseTransitions(
  transitions,
  { gate = GAZE_BODY_PHASE_STABILITY_GATE } = {},
) {
  const properties = Object.keys(gate.maximumAdjacentStep);
  const groups = new Map();
  for (const transition of transitions) {
    const key = `${transition.from.angleDegrees}->${transition.to.angleDegrees}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transition);
  }
  const pairs = [...groups.entries()].map(([key, entries]) => {
    const ordered = entries.toSorted((left, right) => left.page - right.page);
    const complete = ordered.length === FLUID_ATLAS_FRAME_COUNT
      && ordered.every((entry, index) => entry.page === index);
    const metrics = Object.fromEntries(properties.map((property) => {
      const values = ordered.map((entry) => entry.metrics[property]);
      const adjacentSteps = values.map((value, index) => (
        Math.abs(values[(index + 1) % values.length] - value)
      ));
      const residuals = values.map((value, index) => {
        const previous = (index - 1 + values.length) % values.length;
        const next = (index + 1) % values.length;
        const previousMs = EXPECTED_DELAYS[previous];
        const nextMs = EXPECTED_DELAYS[index];
        return Math.abs(timeWeightedLinearResidual(
          values[previous], value, values[next], previousMs, nextMs,
        ));
      });
      return [property, {
        minimum: round(Math.min(...values)),
        maximum: round(Math.max(...values)),
        maximumAdjacentStep: round(Math.max(...adjacentSteps)),
        maximumSecondDifferenceResidual: round(Math.max(...residuals)),
        sequenceSha256: sha256Json(values),
        pairRangePasses: Math.max(...values) - Math.min(...values)
          <= gate.maximumPairRange[property],
        adjacentPasses: Math.max(...adjacentSteps)
          <= gate.maximumAdjacentStep[property],
        secondDifferencePasses: Math.max(...residuals)
          <= gate.maximumSecondDifferenceResidual[property],
      }];
    }));
    const flags = properties.flatMap((property) => {
      const report = metrics[property];
      return [
        ...(report.pairRangePasses ? [] : [`${property}:pair-range`]),
        ...(report.adjacentPasses ? [] : [`${property}:adjacent-step`]),
        ...(report.secondDifferencePasses ? [] : [`${property}:second-difference`]),
      ];
    });
    return {
      key,
      fromAngleDegrees: ordered[0]?.from.angleDegrees ?? null,
      toAngleDegrees: ordered[0]?.to.angleDegrees ?? null,
      phaseCount: ordered.length,
      complete,
      ok: complete && flags.length === 0,
      flags,
      metrics,
      canonicalMetricSequenceSha256: sha256Json(
        properties.map((property) => ordered.map((entry) => entry.metrics[property])),
      ),
    };
  });
  const failingPairs = pairs.filter(({ ok }) => !ok);
  const nonNeighborPairs = pairs.filter(({ fromAngleDegrees, toAngleDegrees }) => (
    !gazeDirectionsAdjacent(fromAngleDegrees / 22.5, toAngleDegrees / 22.5)
  ));
  return {
    ok: pairs.length === gate.requiredPairs
      && failingPairs.length === 0,
    gate,
    pairCount: pairs.length,
    transitionCount: transitions.length,
    adjacentPairCount: pairs.filter(({ fromAngleDegrees, toAngleDegrees }) => (
      gazeDirectionsAdjacent(fromAngleDegrees / 22.5, toAngleDegrees / 22.5)
    )).length,
    nonNeighborPairCount: nonNeighborPairs.length,
    nonNeighborTransitionCount: nonNeighborPairs
      .reduce((total, pair) => total + pair.phaseCount, 0),
    nonNeighborPairKeys: nonNeighborPairs.map(({ key }) => key),
    nonNeighborPairKeysSha256: sha256Json(nonNeighborPairs.map(({ key }) => key)),
    failingPairCount: failingPairs.length,
    failingPairKeys: failingPairs.map(({ key }) => key),
    canonicalPairSequenceSha256: sha256Json(
      pairs.map(({ key, canonicalMetricSequenceSha256 }) => ({
        key,
        canonicalMetricSequenceSha256,
      })),
    ),
    pairs,
  };
}

function inspectSamePhaseTransitions(pixels, pageIndex) {
  const errors = [];
  const actionToIdle = ACTION_ROWS.map((row) => {
    const rawMetrics = compareCellRegions(pixels, pixels, 0, row, 0, 0);
    const metrics = presentDiff(rawMetrics);
    const validation = transitionGateResult("actionToIdle", rawMetrics);
    const transition = {
      id: `p${pageIndex}-r${row}c0-to-idle`,
      kind: "action-to-idle",
      from: { row, column: 0, state: ROWS[row].id },
      to: { row: 0, column: 0, state: ROWS[0].id },
      metrics,
      validation,
    };
    if (!validation.ok) {
      errors.push(
        `${transition.id} fails same-phase action-to-idle continuity `
        + `(IoU ${metrics.silhouetteIou}, centroid ${metrics.silhouetteCentroidDistancePx}px, `
        + `alpha ${metrics.normalizedAlphaDiff})`,
      );
    }
    return transition;
  });

  const gazeEntry = TIMED_ROWS.flatMap((row) =>
    Array.from({ length: 16 }, (_, directionIndex) => {
      const gazeRow = directionIndex < 8 ? 9 : 10;
      const gazeColumn = directionIndex % 8;
      const rawMetrics = compareCellRegions(pixels, pixels, 0, row, gazeColumn, gazeRow);
      const metrics = presentDiff(rawMetrics);
      const validation = transitionGateResult(
        GAZE_ELIGIBLE_ROWS.includes(row) ? "gazeEntry" : "gazeTimedBoundary",
        rawMetrics,
      );
      const transition = {
        id: `p${pageIndex}-r${row}c0-to-gaze-${directionIndex * 22.5}deg`,
        kind: "gaze-entry",
        from: { row, column: 0, state: ROWS[row].id },
        to: { row: gazeRow, column: gazeColumn, state: "gaze", angleDegrees: directionIndex * 22.5 },
        metrics,
        validation,
      };
      if (!validation.ok) {
        errors.push(
          `${transition.id} fails same-phase gaze-entry continuity `
          + `(IoU ${metrics.silhouetteIou}, centroid ${metrics.silhouetteCentroidDistancePx}px, `
          + `alpha ${metrics.normalizedAlphaDiff})`,
        );
      }
      return transition;
    }),
  );

  const timedRowPairs = TIMED_ROWS.flatMap((fromRow, fromIndex) => (
    TIMED_ROWS.slice(fromIndex + 1).map((toRow) => {
      const rawMetrics = compareCellRegions(pixels, pixels, 0, fromRow, 0, toRow);
      const metrics = presentDiff(rawMetrics);
      const validation = transitionGateResult("timedRowPair", rawMetrics);
      const transition = {
        id: `p${pageIndex}-timed-r${fromRow}-to-r${toRow}`,
        kind: "timed-row-pair",
        from: { row: fromRow, column: 0, state: ROWS[fromRow].id },
        to: { row: toRow, column: 0, state: ROWS[toRow].id },
        metrics,
        validation,
      };
      if (!validation.ok) {
        errors.push(
          `${transition.id} fails same-phase timed-row continuity `
          + `(IoU ${metrics.silhouetteIou}, centroid ${metrics.silhouetteCentroidDistancePx}px, `
          + `alpha ${metrics.normalizedAlphaDiff})`,
        );
      }
      return transition;
    })
  ));

  const gazeNeighborPairs = Array.from({ length: 16 }, (_, directionIndex) => {
    const nextDirectionIndex = (directionIndex + 1) % 16;
    const fromRow = directionIndex < 8 ? 9 : 10;
    const fromColumn = directionIndex % 8;
    const toRow = nextDirectionIndex < 8 ? 9 : 10;
    const toColumn = nextDirectionIndex % 8;
    const rawMetrics = compareCellRegions(
      pixels,
      pixels,
      fromColumn,
      fromRow,
      toColumn,
      toRow,
    );
    const metrics = presentDiff(rawMetrics);
    const validation = transitionGateResult("adjacentGazeSector", rawMetrics);
    const transition = {
      id: `p${pageIndex}-gaze-${directionIndex * 22.5}-to-${nextDirectionIndex * 22.5}deg`,
      kind: "adjacent-gaze-sector",
      from: {
        row: fromRow,
        column: fromColumn,
        state: "gaze",
        angleDegrees: directionIndex * 22.5,
      },
      to: {
        row: toRow,
        column: toColumn,
        state: "gaze",
        angleDegrees: nextDirectionIndex * 22.5,
      },
      wraps: nextDirectionIndex === 0,
      metrics,
      validation,
    };
    if (!validation.ok) {
      errors.push(
        `${transition.id} fails adjacent gaze-sector continuity `
        + `(IoU ${metrics.silhouetteIou}, centroid ${metrics.silhouetteCentroidDistancePx}px, `
        + `RGBA ${metrics.normalizedRgbaDiff})`,
      );
    }
    return transition;
  });

  const gazeBodyPairs = Array.from({ length: 16 }, (_, fromDirection) => (
    Array.from({ length: 16 - fromDirection - 1 }, (_, offset) => fromDirection + offset + 1)
      .map((toDirection) => {
        const from = gazeCell(fromDirection);
        const to = gazeCell(toDirection);
        const rawMetrics = compareCellRegions(
          pixels,
          pixels,
          from.column,
          from.row,
          to.column,
          to.row,
        );
        const metrics = presentDiff(rawMetrics);
        const validation = {
          ok: true,
          deferredToPairPhaseStability: true,
          checks: { pairPhaseStability: true },
          flags: [],
        };
        const transition = {
          id: `p${pageIndex}-gaze-body-${fromDirection * 22.5}-to-${toDirection * 22.5}deg`,
          kind: "gaze-body-stability",
          page: pageIndex,
          from,
          to,
          metrics,
          validation,
        };
        return transition;
      })
  )).flat();
  const expectedIds = expectedSamePhaseIds(pageIndex);
  const membership = {
    actionToIdle: exactIdMembership(actionToIdle.map(({ id }) => id), expectedIds.actionToIdle),
    gazeTimedBoundaries: exactIdMembership(gazeEntry.map(({ id }) => id), expectedIds.gazeTimedBoundaries),
    timedRowPairs: exactIdMembership(timedRowPairs.map(({ id }) => id), expectedIds.timedRowPairs),
    gazeNeighborPairs: exactIdMembership(gazeNeighborPairs.map(({ id }) => id), expectedIds.gazeNeighborPairs),
    gazeBodyPairs: exactIdMembership(gazeBodyPairs.map(({ id }) => id), expectedIds.gazeBodyPairs),
  };
  membership.ok = Object.values(membership).every((entry) => entry === true || entry.ok);
  for (const [kind, report] of Object.entries(membership)) {
    if (kind !== "ok" && !report.ok) errors.push(`same-phase ${kind} transition ID membership is incomplete`);
  }

  return {
    ok: errors.length === 0 && membership.ok,
    gates: SAME_PHASE_TRANSITION_GATES,
    modeledEdges: {
      actionToIdle: "rows 1-8 column 0 to idle row 0 column 0 at the same embedded WebP phase",
      gazeEntry: "all timed rows 0-8 column 0 to all 16 gaze cells at the same embedded WebP phase; pixel difference is symmetric",
      timedRowPairs: "all 36 unordered row 0-8 column-0 pairs at the same embedded WebP phase",
      gazeNeighborPairs: "all 16 neighboring gaze-sector pairs, including the 337.5-to-0-degree wrap, at the same embedded WebP phase",
      gazeBodyPairs: "all 120 unordered gaze-sector pairs; only body/silhouette stability is gated because arbitrary eye-target jumps are intentional",
    },
    actionToIdle,
    gazeEntry,
    timedRowPairs,
    gazeNeighborPairs,
    gazeBodyPairs,
    membership,
    summary: {
      actionToIdle: summarizeSamePhaseTransitions(actionToIdle),
      gazeEntry: summarizeSamePhaseTransitions(gazeEntry),
      timedRowPairs: summarizeSamePhaseTransitions(timedRowPairs),
      gazeNeighborPairs: summarizeSamePhaseTransitions(gazeNeighborPairs),
      gazeBodyPairs: summarizeSamePhaseTransitions(gazeBodyPairs),
    },
    errors,
  };
}

function gazeCell(directionIndex) {
  return {
    row: directionIndex < 8 ? 9 : 10,
    column: directionIndex % 8,
    state: "gaze",
    angleDegrees: directionIndex * 22.5,
  };
}

function displayed112HostBoundaryCells() {
  return [
    ...TIMED_ROWS.map((row) => ({
      key: `r${row}c0`,
      row,
      column: 0,
      state: ROWS[row].id,
    })),
    ...Array.from({ length: 16 }, (_, direction) => {
      const cell = gazeCell(direction);
      return { key: `r${cell.row}c${cell.column}`, ...cell };
    }),
  ];
}

function gazePairIsNonNeighbor(from, to) {
  return from.angleDegrees != null
    && to.angleDegrees != null
    && !gazeDirectionsAdjacent(from.angleDegrees / 22.5, to.angleDegrees / 22.5);
}

function expectedSamePhaseIds(pageIndex) {
  return {
    actionToIdle: ACTION_ROWS.map((row) => `p${pageIndex}-r${row}c0-to-idle`),
    gazeTimedBoundaries: TIMED_ROWS.flatMap((row) => (
      Array.from({ length: 16 }, (_, direction) => (
        `p${pageIndex}-r${row}c0-to-gaze-${direction * 22.5}deg`
      ))
    )),
    timedRowPairs: TIMED_ROWS.flatMap((fromRow, fromIndex) => (
      TIMED_ROWS.slice(fromIndex + 1).map((toRow) => (
        `p${pageIndex}-timed-r${fromRow}-to-r${toRow}`
      ))
    )),
    gazeNeighborPairs: Array.from({ length: 16 }, (_, direction) => (
      `p${pageIndex}-gaze-${direction * 22.5}-to-${((direction + 1) % 16) * 22.5}deg`
    )),
    gazeBodyPairs: Array.from({ length: 16 }, (_, fromDirection) => (
      Array.from({ length: 16 - fromDirection - 1 }, (_, offset) => (
        fromDirection + offset + 1
      )).map((toDirection) => (
        `p${pageIndex}-gaze-body-${fromDirection * 22.5}-to-${toDirection * 22.5}deg`
      ))
    )).flat(),
  };
}

function expectedCrossPhaseIds(fromPage, toPage) {
  const prefix = `p${fromPage}-to-p${toPage}-`;
  return {
    timedRowChanges: TIMED_ROWS.flatMap((fromRow) => (
      TIMED_ROWS.filter((toRow) => toRow !== fromRow).map((toRow) => (
        `${prefix}timed-r${fromRow}-to-r${toRow}`
      ))
    )),
    gazeNeighborChanges: Array.from({ length: 16 }, (_, direction) => {
      const next = (direction + 1) % 16;
      return [
        `${prefix}gaze-${direction * 22.5}-to-${next * 22.5}deg`,
        `${prefix}gaze-${next * 22.5}-to-${direction * 22.5}deg`,
      ];
    }).flat(),
    gazeToTimed: Array.from({ length: 16 }, (_, direction) => (
      TIMED_ROWS.map((toRow) => `${prefix}gaze-${direction * 22.5}-to-r${toRow}`)
    )).flat(),
    eligibleTimedToGaze: GAZE_ELIGIBLE_ROWS.flatMap((fromRow) => (
      Array.from({ length: 16 }, (_, direction) => (
        `${prefix}r${fromRow}-to-gaze-${direction * 22.5}deg`
      ))
    )),
    gazeBodyNonNeighborChanges: Array.from({ length: 16 }, (_, fromDirection) => (
      Array.from({ length: 16 }, (_, toDirection) => toDirection)
        .filter((toDirection) => (
          toDirection !== fromDirection
          && !gazeDirectionsAdjacent(fromDirection, toDirection)
        ))
        .map((toDirection) => (
          `${prefix}gaze-body-${fromDirection * 22.5}-to-${toDirection * 22.5}deg`
        ))
    )).flat(),
  };
}

function inspectCrossPhaseTransitions(fromPixels, toPixels, fromPage, toPage) {
  const errors = [];
  const seam = toPage === 0;
  const makeTransition = ({ id, kind, gateKind, from, to }) => {
    const rawMetrics = compareCellRegions(
      fromPixels,
      toPixels,
      from.column,
      from.row,
      to.column,
      to.row,
    );
    const metrics = presentDiff(rawMetrics);
    const validation = transitionGateResult(gateKind, rawMetrics);
    const transition = {
      id: `p${fromPage}-to-p${toPage}-${id}`,
      kind,
      fromPage,
      toPage,
      seam,
      from,
      to,
      metrics,
      validation,
    };
    if (!validation.ok) {
      errors.push(
        `${transition.id} fails ${kind} continuity `
        + `(IoU ${metrics.silhouetteIou}, centroid ${metrics.silhouetteCentroidDistancePx}px, `
        + `RGBA ${metrics.normalizedRgbaDiff}, alpha ${metrics.normalizedAlphaDiff})`,
      );
    }
    return transition;
  };

  const timedRowChanges = TIMED_ROWS.flatMap((fromRow) => (
    TIMED_ROWS.filter((toRow) => toRow !== fromRow).map((toRow) => makeTransition({
      id: `timed-r${fromRow}-to-r${toRow}`,
      kind: "cross-phase-timed-row-change",
      gateKind: "timedRowCrossPhase",
      from: { row: fromRow, column: 0, state: ROWS[fromRow].id },
      to: { row: toRow, column: 0, state: ROWS[toRow].id },
    }))
  ));

  const gazeNeighborChanges = Array.from({ length: 16 }, (_, directionIndex) => {
    const nextDirectionIndex = (directionIndex + 1) % 16;
    return [
      [directionIndex, nextDirectionIndex],
      [nextDirectionIndex, directionIndex],
    ].map(([fromDirection, toDirection]) => makeTransition({
      id: `gaze-${fromDirection * 22.5}-to-${toDirection * 22.5}deg`,
      kind: "cross-phase-adjacent-gaze-sector",
      gateKind: "adjacentGazeSector",
      from: gazeCell(fromDirection),
      to: gazeCell(toDirection),
    }));
  }).flat();

  const gazeToTimed = Array.from({ length: 16 }, (_, directionIndex) => (
    TIMED_ROWS.map((toRow) => makeTransition({
      id: `gaze-${directionIndex * 22.5}-to-r${toRow}`,
      kind: "cross-phase-gaze-to-timed-row",
      gateKind: GAZE_ELIGIBLE_ROWS.includes(toRow) ? "gazeEntry" : "gazeTimedBoundary",
      from: gazeCell(directionIndex),
      to: { row: toRow, column: 0, state: ROWS[toRow].id },
    }))
  )).flat();
  const eligibleTimedToGaze = GAZE_ELIGIBLE_ROWS.flatMap((fromRow) => (
    Array.from({ length: 16 }, (_, directionIndex) => makeTransition({
      id: `r${fromRow}-to-gaze-${directionIndex * 22.5}deg`,
      kind: "cross-phase-eligible-timed-row-to-gaze",
      gateKind: "gazeEntry",
      from: { row: fromRow, column: 0, state: ROWS[fromRow].id },
      to: gazeCell(directionIndex),
    }))
  ));
  const gazeTimedBoundaries = [...gazeToTimed, ...eligibleTimedToGaze];
  const gazeBodyNonNeighborChanges = Array.from({ length: 16 }, (_, fromDirection) => (
    Array.from({ length: 16 }, (_, toDirection) => toDirection)
      .filter((toDirection) => (
        toDirection !== fromDirection
        && !gazeDirectionsAdjacent(fromDirection, toDirection)
      ))
      .map((toDirection) => {
        const from = gazeCell(fromDirection);
        const to = gazeCell(toDirection);
        const rawMetrics = compareCellRegions(
          fromPixels,
          toPixels,
          from.column,
          from.row,
          to.column,
          to.row,
        );
        return {
          id: `p${fromPage}-to-p${toPage}-gaze-body-${fromDirection * 22.5}-to-${toDirection * 22.5}deg`,
          kind: "cross-phase-gaze-body-non-neighbor",
          fromPage,
          toPage,
          seam,
          from,
          to,
          metrics: presentDiff(rawMetrics),
          validation: {
            ok: true,
            deferredToPairPhaseStability: true,
            checks: { pairPhaseStability: true },
            flags: [],
          },
        };
      })
  )).flat();
  // Arbitrary eye-target jumps are intentional. Only pair-specific
  // alpha/silhouette stability across all 60 decoder phases is authoritative.

  const expectedIds = expectedCrossPhaseIds(fromPage, toPage);
  const membership = {
    timedRowChanges: exactIdMembership(
      timedRowChanges.map(({ id }) => id),
      expectedIds.timedRowChanges,
    ),
    gazeNeighborChanges: exactIdMembership(
      gazeNeighborChanges.map(({ id }) => id),
      expectedIds.gazeNeighborChanges,
    ),
    gazeToTimed: exactIdMembership(gazeToTimed.map(({ id }) => id), expectedIds.gazeToTimed),
    eligibleTimedToGaze: exactIdMembership(
      eligibleTimedToGaze.map(({ id }) => id),
      expectedIds.eligibleTimedToGaze,
    ),
    gazeBodyNonNeighborChanges: exactIdMembership(
      gazeBodyNonNeighborChanges.map(({ id }) => id),
      expectedIds.gazeBodyNonNeighborChanges,
    ),
  };
  membership.ok = Object.values(membership).every((entry) => entry === true || entry.ok);
  for (const [kind, report] of Object.entries(membership)) {
    if (kind !== "ok" && !report.ok) errors.push(`cross-phase ${kind} transition ID membership is incomplete`);
  }

  return {
    ok: errors.length === 0 && membership.ok,
    fromPage,
    toPage,
    seam,
    timedRowChanges,
    gazeNeighborChanges,
    gazeTimedBoundaries,
    gazeToTimed,
    eligibleTimedToGaze,
    gazeBodyNonNeighborChanges,
    membership,
    errors,
  };
}

function inspectPage(variant, pageIndex, pixels, info) {
  if (info.width !== ATLAS_WIDTH || info.height !== ATLAS_HEIGHT || info.channels !== 4) {
    throw new Error(
      `decoded page ${pageIndex} must be ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA; `
      + `received ${info.width}x${info.height} with ${info.channels} channels`,
    );
  }

  const errors = [];
  const pixelCount = ATLAS_WIDTH * ATLAS_HEIGHT;
  const maskBytes = Math.ceil(pixelCount / 8);
  const alphaBytes = Buffer.allocUnsafe(pixelCount);
  const visibleMask = Buffer.alloc(maskBytes);
  const colors = paletteContract(variant);
  const categoryNames = ["body", "feature", ...ACCENT_KEYS, "unclassified"];
  const categoryMasks = Object.fromEntries(categoryNames.map((name) => [name, Buffer.alloc(maskBytes)]));
  const categoryCounts = Object.fromEntries(categoryNames.map((name) => [name, 0]));
  const unusedRgbaHash = createHash("sha256");
  const cells = [];
  let hiddenRgbPixels = 0;
  let visiblePixels = 0;
  let alphaSum = 0;

  for (let row = 0; row < ROW_COUNT; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const required = column < REQUIRED_COLUMNS_BY_ROW[row];
      const rgbaHash = createHash("sha256");
      const alphaHash = createHash("sha256");
      const alphaRow = Buffer.allocUnsafe(CELL_WIDTH);
      let cellVisiblePixels = 0;
      let cellAlphaSum = 0;
      let cellHiddenRgbPixels = 0;
      let nonZeroRgbaPixels = 0;
      let safetyGutterNonZeroRgbaPixels = 0;
      let safetyGutterMaximumAlpha = 0;
      let faceFeaturePixels = 0;
      let featureXTotal = 0;
      let featureYTotal = 0;
      const eyeFeatureMask = row >= 9 ? Buffer.alloc(CELL_WIDTH * CELL_HEIGHT) : null;
      let minX = CELL_WIDTH;
      let minY = CELL_HEIGHT;
      let maxX = -1;
      let maxY = -1;

      for (let localY = 0; localY < CELL_HEIGHT; localY += 1) {
        const atlasY = row * CELL_HEIGHT + localY;
        const rowStart = (atlasY * ATLAS_WIDTH + column * CELL_WIDTH) * 4;
        const rowEnd = rowStart + CELL_WIDTH * 4;
        const rgbaRow = pixels.subarray(rowStart, rowEnd);
        rgbaHash.update(rgbaRow);
        if (!required) unusedRgbaHash.update(rgbaRow);

        for (let localX = 0; localX < CELL_WIDTH; localX += 1) {
          const rgbaOffset = rowStart + localX * 4;
          const red = pixels[rgbaOffset];
          const green = pixels[rgbaOffset + 1];
          const blue = pixels[rgbaOffset + 2];
          const alpha = pixels[rgbaOffset + 3];
          const atlasX = column * CELL_WIDTH + localX;
          const absolutePixel = atlasY * ATLAS_WIDTH + atlasX;
          alphaRow[localX] = alpha;
          alphaBytes[absolutePixel] = alpha;

          if (red !== 0 || green !== 0 || blue !== 0 || alpha !== 0) nonZeroRgbaPixels += 1;
          if (alpha === 0 && (red !== 0 || green !== 0 || blue !== 0)) {
            cellHiddenRgbPixels += 1;
            hiddenRgbPixels += 1;
          }
          if (
            required
            && (localX < SAFETY_GUTTER_PX
              || localX >= CELL_WIDTH - SAFETY_GUTTER_PX
              || localY < SAFETY_GUTTER_PX
              || localY >= CELL_HEIGHT - SAFETY_GUTTER_PX)
            && (red !== 0 || green !== 0 || blue !== 0 || alpha !== 0)
          ) {
            safetyGutterNonZeroRgbaPixels += 1;
            safetyGutterMaximumAlpha = Math.max(safetyGutterMaximumAlpha, alpha);
          }

          if (alpha > 0) {
            visiblePixels += 1;
            cellVisiblePixels += 1;
            alphaSum += alpha;
            cellAlphaSum += alpha;
            minX = Math.min(minX, localX);
            minY = Math.min(minY, localY);
            maxX = Math.max(maxX, localX);
            maxY = Math.max(maxY, localY);
            setMaskBit(visibleMask, absolutePixel);

            let category = null;
            if (rgbEqual(red, green, blue, colors.body)) category = "body";
            else if (rgbEqual(red, green, blue, colors.feature)) category = "feature";
            else {
              category = ACCENT_KEYS.find((key) => rgbEqual(red, green, blue, colors.accents[key])) ?? null;
            }
            category ??= "unclassified";
            categoryCounts[category] += 1;
            setMaskBit(categoryMasks[category], absolutePixel);

            if (row >= 9 && featurePixel(variant, red, green, blue, alpha, localX, localY)) {
              faceFeaturePixels += 1;
              featureXTotal += localX;
              featureYTotal += localY;
              eyeFeatureMask[localY * CELL_WIDTH + localX] = 1;
            }
          }
        }
        alphaHash.update(alphaRow);
      }

      const eyeComponents = eyeFeatureMask ? findEyeComponents(eyeFeatureMask) : [];
      const featureCenter = eyeComponents.length === 2
        ? {
            x: (eyeComponents[0].center.x + eyeComponents[1].center.x) / 2,
            y: (eyeComponents[0].center.y + eyeComponents[1].center.y) / 2,
          }
        : faceFeaturePixels > 0
          ? {
              x: featureXTotal / faceFeaturePixels,
              y: featureYTotal / faceFeaturePixels,
            }
          : null;
      const cell = {
        key: `r${row}c${column}`,
        row,
        column,
        state: ROWS[row]?.id ?? `row-${row}`,
        required,
        visiblePixels: cellVisiblePixels,
        alphaSum: cellAlphaSum,
        bounds: cellVisiblePixels > 0 ? { minX, minY, maxX, maxY } : null,
        hiddenRgbPixels: cellHiddenRgbPixels,
        nonZeroRgbaPixels,
        safetyGutterNonZeroRgbaPixels,
        safetyGutterMaximumAlpha,
        rgbaSha256: rgbaHash.digest("hex"),
        alphaSha256: alphaHash.digest("hex"),
        faceFeaturePixels,
        featureCenter,
        eyeComponents,
      };

      if (required && cellVisiblePixels === 0) errors.push(`${cell.key} is required but blank`);
      if (!required && nonZeroRgbaPixels !== 0) {
        errors.push(`${cell.key} is unused but contains ${nonZeroRgbaPixels} non-zero RGBA pixels`);
      }
      if (required && safetyGutterNonZeroRgbaPixels !== 0) {
        errors.push(
          `${cell.key} has ${safetyGutterNonZeroRgbaPixels} non-zero RGBA pixels `
          + `(maximum alpha ${safetyGutterMaximumAlpha}) in its ${SAFETY_GUTTER_PX}px safety gutter`,
        );
      }
      cells.push(cell);
    }
  }

  if (hiddenRgbPixels !== 0) errors.push(`${hiddenRgbPixels} alpha-zero pixels retain hidden RGB`);
  const requiredVisibleCellCount = cells.filter((cell) => cell.required && cell.visiblePixels > 0).length;
  const unusedZeroCellCount = cells.filter((cell) => !cell.required && cell.nonZeroRgbaPixels === 0).length;
  if (requiredVisibleCellCount !== REQUIRED_CELL_COUNT) {
    errors.push(`page contains ${requiredVisibleCellCount}/${REQUIRED_CELL_COUNT} visible required cells`);
  }
  if (unusedZeroCellCount !== UNUSED_CELL_COUNT) {
    errors.push(`page contains ${unusedZeroCellCount}/${UNUSED_CELL_COUNT} zero-RGBA unused cells`);
  }

  const timedRows = TIMED_ROWS.map((row) => {
    const populated = cells.filter((cell) => cell.row === row && cell.required);
    const distinctHashes = [...new Set(populated.map((cell) => cell.rgbaSha256))];
    const identical = distinctHashes.length === 1;
    if (!identical) errors.push(`timed row ${row} (${ROWS[row].id}) has ${distinctHashes.length} populated images at this phase`);
    return {
      row,
      state: ROWS[row].id,
      populatedColumns: populated.length,
      identical,
      rgbaSha256: identical ? distinctHashes[0] : null,
      distinctRgbaSha256: distinctHashes,
    };
  });

  const idleCells = cells.filter((cell) => cell.row === 0 && cell.required);
  const idleRow = timedRows.find((row) => row.row === 0);

  const gazeCells = cells.filter((cell) => cell.row >= 9 && cell.required);
  const gaze = inspectGaze(gazeCells);
  errors.push(...gaze.errors);
  const samePhaseTransitions = inspectSamePhaseTransitions(pixels, pageIndex);
  errors.push(...samePhaseTransitions.errors);

  const silhouetteCells = cells.map((cell) => ({
    row: cell.row,
    column: cell.column,
    required: cell.required,
    visiblePixels: cell.visiblePixels,
    alphaSum: cell.alphaSum,
    bounds: cell.bounds,
    alphaSha256: cell.alphaSha256,
  }));
  const paletteCategories = Object.fromEntries(categoryNames.map((name) => [name, {
    rgb: name === "body" ? colors.body
      : name === "feature" ? colors.feature
        : colors.accents[name] ?? null,
    exactPixels: categoryCounts[name],
    maskSha256: sha256(categoryMasks[name]),
  }]));
  const canonicalPalette = categoryNames.map((name) => ({
    name,
    exactPixels: paletteCategories[name].exactPixels,
    maskSha256: paletteCategories[name].maskSha256,
  }));

  return {
    index: pageIndex,
    ok: errors.length === 0,
    rgbaSha256: sha256(pixels),
    alphaSha256: sha256(alphaBytes),
    visibleMaskSha256: sha256(visibleMask),
    visiblePixels,
    alphaSum,
    hiddenRgbPixels,
    requiredVisibleCellCount,
    unusedZeroCellCount,
    unusedRgbaSha256: unusedRgbaHash.digest("hex"),
    safetyGutterPx: SAFETY_GUTTER_PX,
    safetyGutterViolationCount: cells.filter((cell) => cell.safetyGutterNonZeroRgbaPixels > 0).length,
    safetyGutterViolations: cells
      .filter((cell) => cell.safetyGutterNonZeroRgbaPixels > 0)
      .map((cell) => ({
        key: cell.key,
        row: cell.row,
        column: cell.column,
        nonZeroRgbaPixels: cell.safetyGutterNonZeroRgbaPixels,
        maximumAlpha: cell.safetyGutterMaximumAlpha,
        bounds: cell.bounds,
      })),
    requiredCellRgbaSha256: Object.fromEntries(
      cells.filter((cell) => cell.required).map((cell) => [cell.key, cell.rgbaSha256]),
    ),
    timedRows,
    idle: {
      continuousTimeline: true,
      populatedColumns: idleCells.length,
      phaseIdentical: idleRow.identical,
      rgbaSha256: idleRow.rgbaSha256,
      hostColumns: idleCells.map((cell) => cell.column),
    },
    gaze,
    samePhaseTransitions,
    silhouette: {
      sha256: sha256Json(silhouetteCells),
      cells: silhouetteCells,
    },
    palette: {
      canonicalClassificationSha256: sha256Json(canonicalPalette),
      categories: paletteCategories,
    },
    errors,
  };
}

function compareCellRegions(left, right, fromColumn, fromRow, toColumn, toRow, options = {}) {
  const regionWidth = options.regionWidth ?? CELL_WIDTH;
  const regionHeight = options.regionHeight ?? CELL_HEIGHT;
  const leftWidth = options.leftWidth ?? ATLAS_WIDTH;
  const rightWidth = options.rightWidth ?? ATLAS_WIDTH;
  const surface = options.surface ?? null;
  let absoluteRgbaDelta = 0;
  let absoluteAlphaDelta = 0;
  let changedPixels = 0;
  let changedAlphaPixels = 0;
  let maximumChannelDelta = 0;
  let silhouetteIntersection = 0;
  let silhouetteUnion = 0;
  let fromSilhouettePixels = 0;
  let toSilhouettePixels = 0;
  let fromCentroidX = 0;
  let fromCentroidY = 0;
  let toCentroidX = 0;
  let toCentroidY = 0;
  let fromAlphaArea = 0;
  let toAlphaArea = 0;
  let perceptualSquareSum = 0;
  let stronglyChangedPixels = 0;
  let fromFeatureInkMass = 0;
  let toFeatureInkMass = 0;
  let featureInkVariation = 0;
  let fromFeatureX = 0;
  let fromFeatureY = 0;
  let toFeatureX = 0;
  let toFeatureY = 0;

  for (let localY = 0; localY < regionHeight; localY += 1) {
    const fromStart = ((fromRow * regionHeight + localY) * leftWidth + fromColumn * regionWidth) * 4;
    const toStart = ((toRow * regionHeight + localY) * rightWidth + toColumn * regionWidth) * 4;
    for (let localX = 0; localX < regionWidth; localX += 1) {
      const fromOffset = fromStart + localX * 4;
      const toOffset = toStart + localX * 4;
      let pixelChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(left[fromOffset + channel] - right[toOffset + channel]);
        absoluteRgbaDelta += delta;
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        if (delta !== 0) pixelChanged = true;
      }
      const fromAlpha = left[fromOffset + 3];
      const toAlpha = right[toOffset + 3];
      const alphaDelta = Math.abs(fromAlpha - toAlpha);
      absoluteAlphaDelta += alphaDelta;
      if (alphaDelta !== 0) changedAlphaPixels += 1;
      if (pixelChanged) changedPixels += 1;

      if (surface) {
        const fromAlphaUnit = fromAlpha / 255;
        const toAlphaUnit = toAlpha / 255;
        const delta = perceptualDelta(
          right[toOffset] * toAlphaUnit + surface.background[0] * (1 - toAlphaUnit)
            - left[fromOffset] * fromAlphaUnit - surface.background[0] * (1 - fromAlphaUnit),
          right[toOffset + 1] * toAlphaUnit + surface.background[1] * (1 - toAlphaUnit)
            - left[fromOffset + 1] * fromAlphaUnit - surface.background[1] * (1 - fromAlphaUnit),
          right[toOffset + 2] * toAlphaUnit + surface.background[2] * (1 - toAlphaUnit)
            - left[fromOffset + 2] * fromAlphaUnit - surface.background[2] * (1 - fromAlphaUnit),
        );
        perceptualSquareSum += delta ** 2;
        if (delta >= ANIMATED_TEMPORAL_ADJACENCY_GATE.strongDifferenceThreshold) {
          stronglyChangedPixels += 1;
        }
        if (
          localX >= TEMPORAL_FEATURE_ROI.minX
          && localX < TEMPORAL_FEATURE_ROI.maxX
          && localY >= TEMPORAL_FEATURE_ROI.minY
          && localY < TEMPORAL_FEATURE_ROI.maxY
        ) {
          const fromFeature = featureInkWeight(
            left[fromOffset],
            left[fromOffset + 1],
            left[fromOffset + 2],
            fromAlpha,
            surface.featureTone,
          );
          const toFeature = featureInkWeight(
            right[toOffset],
            right[toOffset + 1],
            right[toOffset + 2],
            toAlpha,
            surface.featureTone,
          );
          fromFeatureInkMass += fromFeature;
          toFeatureInkMass += toFeature;
          featureInkVariation += Math.abs(toFeature - fromFeature);
          fromFeatureX += localX * fromFeature;
          fromFeatureY += localY * fromFeature;
          toFeatureX += localX * toFeature;
          toFeatureY += localY * toFeature;
        }
      }
      fromAlphaArea += fromAlpha;
      toAlphaArea += toAlpha;
      const fromVisible = fromAlpha >= 128;
      const toVisible = toAlpha >= 128;
      if (fromVisible || toVisible) silhouetteUnion += 1;
      if (fromVisible && toVisible) silhouetteIntersection += 1;
      if (fromVisible) {
        fromSilhouettePixels += 1;
        fromCentroidX += localX;
        fromCentroidY += localY;
      }
      if (toVisible) {
        toSilhouettePixels += 1;
        toCentroidX += localX;
        toCentroidY += localY;
      }
    }
  }

  const cellPixels = regionWidth * regionHeight;
  const fromCenter = fromSilhouettePixels > 0
    ? { x: fromCentroidX / fromSilhouettePixels, y: fromCentroidY / fromSilhouettePixels }
    : null;
  const toCenter = toSilhouettePixels > 0
    ? { x: toCentroidX / toSilhouettePixels, y: toCentroidY / toSilhouettePixels }
    : null;
  const minimumAlphaArea = Math.min(fromAlphaArea, toAlphaArea);
  const maximumAlphaArea = Math.max(fromAlphaArea, toAlphaArea);
  const fromFeatureCenter = fromFeatureInkMass > 1
    ? { x: fromFeatureX / fromFeatureInkMass, y: fromFeatureY / fromFeatureInkMass }
    : null;
  const toFeatureCenter = toFeatureInkMass > 1
    ? { x: toFeatureX / toFeatureInkMass, y: toFeatureY / toFeatureInkMass }
    : null;
  return {
    normalizedRgbaDiff: absoluteRgbaDelta / (cellPixels * 4 * 255),
    normalizedAlphaDiff: absoluteAlphaDelta / (cellPixels * 255),
    changedPixelFraction: changedPixels / cellPixels,
    changedAlphaPixelFraction: changedAlphaPixels / cellPixels,
    maximumChannelDelta,
    silhouetteIou: silhouetteUnion > 0 ? silhouetteIntersection / silhouetteUnion : 1,
    silhouetteCentroidDistancePx: fromCenter && toCenter
      ? Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y)
      : Number.POSITIVE_INFINITY,
    fromSilhouettePixels,
    toSilhouettePixels,
    alphaAreaRatioSymmetric: minimumAlphaArea > 0 ? maximumAlphaArea / minimumAlphaArea : Number.POSITIVE_INFINITY,
    perceptualRms: surface ? Math.sqrt(perceptualSquareSum / cellPixels) : 0,
    stronglyChangedCellFraction: surface ? stronglyChangedPixels / cellPixels : 0,
    fromFeatureInkMass,
    toFeatureInkMass,
    featureInkVariation,
    featureInkCentroidStepPx: fromFeatureCenter && toFeatureCenter
      ? Math.hypot(toFeatureCenter.x - fromFeatureCenter.x, toFeatureCenter.y - fromFeatureCenter.y)
      : 0,
  };
}

function compareCellPages(left, right, column, row, surface) {
  return compareCellRegions(left, right, column, row, column, row, { surface });
}

export function analyzeTemporalRgbaSequence({
  frames,
  variant = "dark",
  row = 0,
  width = CELL_WIDTH,
  height = CELL_HEIGHT,
} = {}) {
  if (!Array.isArray(frames) || frames.length !== FLUID_ATLAS_FRAME_COUNT) {
    throw new Error(`synthetic temporal sequence must contain ${FLUID_ATLAS_FRAME_COUNT} frames`);
  }
  const expectedBytes = width * height * 4;
  if (frames.some((frame) => !Buffer.isBuffer(frame) || frame.length !== expectedBytes)) {
    throw new Error(`each synthetic temporal frame must contain ${expectedBytes} RGBA bytes`);
  }
  const surface = TEMPORAL_SURFACES[variant];
  if (!surface) throw new Error(`synthetic temporal variant must be dark or light`);
  const compare = (from, to) => compareCellRegions(from, to, 0, 0, 0, 0, {
    regionWidth: width,
    regionHeight: height,
    leftWidth: width,
    rightWidth: width,
    surface,
  });
  const track = {
    key: "synthetic",
    row,
    column: 0,
    state: "synthetic",
    rgbaHashes: frames.map((frame) => sha256(frame)),
    alphaHashes: frames.map((frame) => sha256(Buffer.from(
      Array.from({ length: width * height }, (_, pixel) => frame[pixel * 4 + 3]),
    ))),
    internalDiffs: frames.slice(0, -1).map((frame, index) => compare(frame, frames[index + 1])),
    loopDiff: compare(frames.at(-1), frames[0]),
    skipDiffs: frames.map((_, center) => compare(
      frames[(center - 1 + frames.length) % frames.length],
      frames[(center + 1) % frames.length],
    )),
  };
  const errors = [];
  const [cell] = finalizeTemporalTracks(new Map([[track.key, track]]), frames.length, errors);
  return { cell, errors };
}

function presentDiff(diff) {
  if (!diff) return null;
  return {
    normalizedRgbaDiff: round(diff.normalizedRgbaDiff),
    normalizedAlphaDiff: round(diff.normalizedAlphaDiff),
    changedPixelFraction: round(diff.changedPixelFraction),
    changedAlphaPixelFraction: round(diff.changedAlphaPixelFraction),
    maximumChannelDelta: diff.maximumChannelDelta,
    silhouetteIou: round(diff.silhouetteIou),
    silhouetteCentroidDistancePx: round(diff.silhouetteCentroidDistancePx),
    fromSilhouettePixels: diff.fromSilhouettePixels,
    toSilhouettePixels: diff.toSilhouettePixels,
    alphaAreaRatioSymmetric: round(diff.alphaAreaRatioSymmetric),
    perceptualRms: round(diff.perceptualRms),
    stronglyChangedCellFraction: round(diff.stronglyChangedCellFraction),
    fromFeatureInkMass: round(diff.fromFeatureInkMass),
    toFeatureInkMass: round(diff.toFeatureInkMass),
    featureInkMassStepFraction: round(diff.featureInkMassStepFraction ?? 0),
    featureInkVariationFraction: round(diff.featureInkVariationFraction ?? 0),
    featureInkCentroidStepPx: round(diff.featureInkCentroidStepPx),
    featureInkMaterial: diff.featureInkMaterial ?? false,
    featureInkCentroidMaterial: diff.featureInkCentroidMaterial ?? false,
    localEnergyRatio: round(diff.localEnergyRatio ?? 0),
  };
}

function compareDisplayed112Frames(left, right, variant) {
  return compareCellRegions(left, right, 0, 0, 0, 0, {
    regionWidth: SHIPPING_112_DISPLAY.deviceWidthPx,
    regionHeight: SHIPPING_112_DISPLAY.deviceHeightPx,
    leftWidth: SHIPPING_112_DISPLAY.deviceWidthPx,
    rightWidth: SHIPPING_112_DISPLAY.deviceWidthPx,
    surface: TEMPORAL_SURFACES[variant],
  });
}

function displayed112TransitionGateResult(metric, row, seam) {
  const gate = ANIMATED_112_TEMPORAL_GATE;
  const rowGate = ANIMATED_112_TEMPORAL_ROW_GATES[row];
  const checks = {
    normalizedRgbaDiff: metric.normalizedRgbaDiff <= gate.maximumNormalizedRgbaDiff,
    normalizedAlphaDiff: metric.normalizedAlphaDiff <= gate.maximumNormalizedAlphaDiff,
    changedPixelFraction: metric.changedPixelFraction <= gate.maximumChangedPixelFraction,
    changedAlphaPixelFraction:
      metric.changedAlphaPixelFraction <= gate.maximumChangedAlphaPixelFraction,
    perceptualRms: metric.perceptualRms <= gate.maximumPerceptualRms,
    stronglyChangedCellFraction:
      metric.stronglyChangedCellFraction <= gate.maximumStronglyChangedCellFraction,
    rowNormalizedRgbaDiff: metric.normalizedRgbaDiff <= rowGate.maximumNormalizedRgbaDiff,
    rowNormalizedAlphaDiff: metric.normalizedAlphaDiff <= rowGate.maximumNormalizedAlphaDiff,
    rowChangedPixelFraction: metric.changedPixelFraction <= rowGate.maximumChangedPixelFraction,
    rowChangedAlphaPixelFraction:
      metric.changedAlphaPixelFraction <= rowGate.maximumChangedAlphaPixelFraction,
    rowPerceptualRms: metric.perceptualRms <= rowGate.maximumPerceptualRms,
    rowStronglyChangedCellFraction:
      metric.stronglyChangedCellFraction <= rowGate.maximumStronglyChangedCellFraction,
    localEnergyRatio: metric.perceptualRms < gate.localEnergyMaterialPerceptualRms
      || metric.localEnergyRatio <= Math.min(
        gate.maximumLocalEnergyRatio,
        rowGate.maximumLocalEnergyRatio,
      ),
  };
  if (seam) {
    checks.loopNormalizedRgbaDiff = metric.normalizedRgbaDiff
      <= gate.loop.maximumNormalizedRgbaDiff;
    checks.loopNormalizedAlphaDiff = metric.normalizedAlphaDiff
      <= gate.loop.maximumNormalizedAlphaDiff;
    checks.loopChangedPixelFraction = metric.changedPixelFraction
      <= gate.loop.maximumChangedPixelFraction;
    checks.loopChangedAlphaPixelFraction = metric.changedAlphaPixelFraction
      <= gate.loop.maximumChangedAlphaPixelFraction;
    checks.loopPerceptualRms = metric.perceptualRms <= gate.loop.maximumPerceptualRms;
  }
  return {
    ok: Object.values(checks).every(Boolean),
    rowGate,
    checks,
    flags: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name),
  };
}

function displayed112IsolatedGateResult(excursion, row) {
  const gate = ANIMATED_112_TEMPORAL_GATE;
  const rowGate = ANIMATED_112_TEMPORAL_ROW_GATES[row];
  const material = Math.min(
    excursion.previousPerceptualRms,
    excursion.nextPerceptualRms,
  ) >= gate.isolatedFrameMinimumPerceptualRms;
  const checks = {
    isolatedFrameExcursionRatio: !material
      || excursion.excursionRatio <= Math.min(
        gate.maximumIsolatedFrameExcursionRatio,
        rowGate.maximumIsolatedFrameExcursionRatio,
      ),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    material,
    checks,
    flags: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name),
  };
}

function finalizeDisplayed112Tracks(tracks, inspectedPageCount, errors) {
  return [...tracks.values()].map((track) => {
    const rawTransitions = [
      ...track.internalDiffs.map((metrics, fromPage) => ({
        fromPage,
        toPage: fromPage + 1,
        seam: false,
        metrics,
      })),
      ...(track.loopDiff == null ? [] : [{
        fromPage: inspectedPageCount - 1,
        toPage: 0,
        seam: true,
        metrics: track.loopDiff,
      }]),
    ];
    rawTransitions.forEach(({ metrics }, index) => {
      const previous = rawTransitions[
        (index - 1 + rawTransitions.length) % rawTransitions.length
      ]?.metrics.perceptualRms ?? 0;
      const next = rawTransitions[(index + 1) % rawTransitions.length]
        ?.metrics.perceptualRms ?? 0;
      metrics.localEnergyRatio = metrics.perceptualRms / Math.max(
        ANIMATED_112_TEMPORAL_GATE.localEnergyFloorPerceptualRms,
        (previous + next) / 2,
      );
    });
    const transitions = rawTransitions.map((transition) => ({
      fromPage: transition.fromPage,
      toPage: transition.toPage,
      seam: transition.seam,
      metrics: presentDiff(transition.metrics),
      validation: displayed112TransitionGateResult(
        transition.metrics,
        track.row,
        transition.seam,
      ),
    }));
    const isolatedFrames = Array.from({ length: inspectedPageCount }, (_, centerPage) => {
      const previous = rawTransitions[
        (centerPage - 1 + rawTransitions.length) % rawTransitions.length
      ]?.metrics.perceptualRms ?? 0;
      const next = rawTransitions[centerPage]?.metrics.perceptualRms ?? 0;
      const skip = track.skipDiffs[centerPage]?.perceptualRms ?? Number.POSITIVE_INFINITY;
      const excursion = {
        previousPerceptualRms: previous,
        nextPerceptualRms: next,
        skipPerceptualRms: skip,
        excursionRatio: Math.min(previous, next) / Math.max(
          ANIMATED_112_TEMPORAL_GATE.isolatedFrameSkipEnergyFloorPerceptualRms,
          skip,
        ),
      };
      return {
        centerPage,
        previousPage: (centerPage - 1 + inspectedPageCount) % inspectedPageCount,
        nextPage: (centerPage + 1) % inspectedPageCount,
        previousPerceptualRms: round(previous),
        nextPerceptualRms: round(next),
        skipPerceptualRms: round(skip),
        excursionRatio: round(excursion.excursionRatio),
        validation: displayed112IsolatedGateResult(excursion, track.row),
      };
    });
    const completeCoverage = transitions.length === FLUID_ATLAS_FRAME_COUNT
      && transitions.every((transition, index) => (
        transition.fromPage === index
          && transition.toPage === (index + 1) % FLUID_ATLAS_FRAME_COUNT
          && transition.seam === (index === FLUID_ATLAS_FRAME_COUNT - 1)
      ))
      && isolatedFrames.length === FLUID_ATLAS_FRAME_COUNT
      && track.skipDiffs.every(Boolean);
    const failingTransitions = transitions.filter(({ validation }) => !validation.ok);
    const failingIsolatedFrames = isolatedFrames.filter(({ validation }) => !validation.ok);
    const upperBoundSafe = completeCoverage
      && failingTransitions.length === 0
      && failingIsolatedFrames.length === 0;
    if (!upperBoundSafe) {
      errors.push(
        `${track.key} exact 7.04rem/DPR2 temporal gate has `
        + `${failingTransitions.length} transition and `
        + `${failingIsolatedFrames.length} isolated-frame failure(s)`,
      );
    }
    return {
      key: track.key,
      row: track.row,
      column: track.column,
      state: track.state,
      inspectedPages: inspectedPageCount,
      completeCoverage,
      upperBoundSafe,
      transitionCount: transitions.length,
      internalTransitionCount: transitions.filter(({ seam }) => !seam).length,
      loopSeamCount: transitions.filter(({ seam }) => seam).length,
      failingTransitionCount: failingTransitions.length,
      transitions,
      isolatedFrameCount: isolatedFrames.length,
      failingIsolatedFrameCount: failingIsolatedFrames.length,
      isolatedFrames,
    };
  });
}

function summarizeDisplayed112Temporal(cells) {
  const transitions = cells.flatMap((cell) => cell.transitions.map((transition) => ({
    cellKey: cell.key,
    row: cell.row,
    column: cell.column,
    state: cell.state,
    ...transition,
  })));
  const isolatedFrames = cells.flatMap((cell) => cell.isolatedFrames.map((frame) => ({
    cellKey: cell.key,
    row: cell.row,
    column: cell.column,
    state: cell.state,
    ...frame,
  })));
  const metricNames = [
    "normalizedRgbaDiff",
    "normalizedAlphaDiff",
    "changedPixelFraction",
    "changedAlphaPixelFraction",
    "perceptualRms",
    "stronglyChangedCellFraction",
    "localEnergyRatio",
  ];
  const maximumObserved = Object.fromEntries(metricNames.map((metric) => {
    const maximum = transitions.reduce((current, candidate) => (
      current == null || candidate.metrics[metric] > current.metrics[metric]
        ? candidate
        : current
    ), null);
    return [metric, maximum == null ? null : {
      value: maximum.metrics[metric],
      cellKey: maximum.cellKey,
      row: maximum.row,
      column: maximum.column,
      state: maximum.state,
      fromPage: maximum.fromPage,
      toPage: maximum.toPage,
      seam: maximum.seam,
    }];
  }));
  const rowMaximumObserved = Object.fromEntries(Array.from({ length: ROW_COUNT }, (_, row) => {
    const rowTransitions = transitions.filter((transition) => transition.row === row);
    return [row, Object.fromEntries(metricNames.map((metric) => [metric, round(Math.max(
      0,
      ...rowTransitions.map((transition) => transition.metrics[metric]),
    ))]))];
  }));
  const materialLocalEnergyTransitions = transitions.filter(({ metrics }) => (
    metrics.perceptualRms >= ANIMATED_112_TEMPORAL_GATE.localEnergyMaterialPerceptualRms
  ));
  const maximumMaterialLocalEnergy = materialLocalEnergyTransitions.reduce(
    (current, candidate) => (
      current == null || candidate.metrics.localEnergyRatio > current.metrics.localEnergyRatio
        ? candidate
        : current
    ),
    null,
  );
  const maximumIsolatedFrame = isolatedFrames.reduce((current, candidate) => (
    current == null || candidate.excursionRatio > current.excursionRatio ? candidate : current
  ), null);
  const materialIsolatedFrames = isolatedFrames.filter(({ validation }) => validation.material);
  const maximumMaterialIsolatedFrame = materialIsolatedFrames.reduce((current, candidate) => (
    current == null || candidate.excursionRatio > current.excursionRatio ? candidate : current
  ), null);
  const rowMaximumObservedMaterialLocalEnergyRatio = Object.fromEntries(
    Array.from({ length: ROW_COUNT }, (_, row) => {
      const values = materialLocalEnergyTransitions
        .filter((transition) => transition.row === row)
        .map((transition) => transition.metrics.localEnergyRatio);
      return [row, values.length === 0 ? null : round(Math.max(...values))];
    }),
  );
  const rowMaximumObservedIsolatedFrameExcursionRatio = Object.fromEntries(
    Array.from({ length: ROW_COUNT }, (_, row) => {
      const values = isolatedFrames
        .filter((frame) => frame.row === row)
        .map((frame) => frame.excursionRatio);
      return [row, values.length === 0 ? null : round(Math.max(...values))];
    }),
  );
  const rowMaximumObservedMaterialIsolatedFrameExcursionRatio = Object.fromEntries(
    Array.from({ length: ROW_COUNT }, (_, row) => {
      const values = materialIsolatedFrames
        .filter((frame) => frame.row === row)
        .map((frame) => frame.excursionRatio);
      return [row, values.length === 0 ? null : round(Math.max(...values))];
    }),
  );
  const failingTransitions = transitions.filter(({ validation }) => !validation.ok);
  const failingIsolatedFrames = isolatedFrames.filter(({ validation }) => !validation.ok);
  return {
    display: SHIPPING_112_DISPLAY,
    sampling: "authoritative Chromium DPR2 pixelated host background lattice",
    gate: ANIMATED_112_TEMPORAL_GATE,
    rowGates: ANIMATED_112_TEMPORAL_ROW_GATES,
    requiredCellCount: REQUIRED_CELL_COUNT,
    frameCount: FLUID_ATLAS_FRAME_COUNT,
    transitionCount: transitions.length,
    internalTransitionCount: transitions.filter(({ seam }) => !seam).length,
    loopSeamCount: transitions.filter(({ seam }) => seam).length,
    isolatedFrameCount: isolatedFrames.length,
    upperBoundSafeCellCount: cells.filter(({ upperBoundSafe }) => upperBoundSafe).length,
    failingTransitionCount: failingTransitions.length,
    failingIsolatedFrameCount: failingIsolatedFrames.length,
    completeCoverage: transitions.length === REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT
      && isolatedFrames.length === REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT
      && cells.every(({ completeCoverage }) => completeCoverage),
    maximumObserved,
    maximumObservedMaterialLocalEnergyRatio: maximumMaterialLocalEnergy == null ? null : {
      value: maximumMaterialLocalEnergy.metrics.localEnergyRatio,
      cellKey: maximumMaterialLocalEnergy.cellKey,
      row: maximumMaterialLocalEnergy.row,
      column: maximumMaterialLocalEnergy.column,
      state: maximumMaterialLocalEnergy.state,
      fromPage: maximumMaterialLocalEnergy.fromPage,
      toPage: maximumMaterialLocalEnergy.toPage,
      seam: maximumMaterialLocalEnergy.seam,
    },
    maximumObservedIsolatedFrameExcursion: maximumIsolatedFrame == null ? null : {
      value: maximumIsolatedFrame.excursionRatio,
      cellKey: maximumIsolatedFrame.cellKey,
      row: maximumIsolatedFrame.row,
      column: maximumIsolatedFrame.column,
      state: maximumIsolatedFrame.state,
      previousPage: maximumIsolatedFrame.previousPage,
      centerPage: maximumIsolatedFrame.centerPage,
      nextPage: maximumIsolatedFrame.nextPage,
    },
    maximumObservedMaterialIsolatedFrameExcursion:
      maximumMaterialIsolatedFrame == null ? null : {
        value: maximumMaterialIsolatedFrame.excursionRatio,
        cellKey: maximumMaterialIsolatedFrame.cellKey,
        row: maximumMaterialIsolatedFrame.row,
        column: maximumMaterialIsolatedFrame.column,
        state: maximumMaterialIsolatedFrame.state,
        previousPage: maximumMaterialIsolatedFrame.previousPage,
        centerPage: maximumMaterialIsolatedFrame.centerPage,
        nextPage: maximumMaterialIsolatedFrame.nextPage,
      },
    rowMaximumObserved,
    rowMaximumObservedMaterialLocalEnergyRatio,
    rowMaximumObservedIsolatedFrameExcursionRatio,
    rowMaximumObservedMaterialIsolatedFrameExcursionRatio,
    failingTransitionIds: failingTransitions.map((transition) => (
      `${transition.cellKey}:p${transition.fromPage}->p${transition.toPage}`
    )),
    failingIsolatedFrameIds: failingIsolatedFrames.map((frame) => (
      `${frame.cellKey}:p${frame.centerPage}`
    )),
    cells,
  };
}

export function analyzeDisplayed112RgbaSequence({ frames, variant = "dark", row = 0 } = {}) {
  const expectedBytes = SHIPPING_112_DISPLAY.deviceWidthPx
    * SHIPPING_112_DISPLAY.deviceHeightPx * 4;
  if (!Array.isArray(frames) || frames.length !== FLUID_ATLAS_FRAME_COUNT) {
    throw new Error(`displayed temporal sequence must contain ${FLUID_ATLAS_FRAME_COUNT} frames`);
  }
  if (frames.some((frame) => !Buffer.isBuffer(frame) || frame.length !== expectedBytes)) {
    throw new Error(`each displayed temporal frame must contain ${expectedBytes} RGBA bytes`);
  }
  const compare = (left, right) => compareDisplayed112Frames(left, right, variant);
  const track = {
    key: "synthetic-displayed-default-dpr2",
    row,
    column: 0,
    state: "synthetic",
    internalDiffs: frames.slice(0, -1).map((frame, index) => compare(frame, frames[index + 1])),
    loopDiff: compare(frames.at(-1), frames[0]),
    skipDiffs: frames.map((_, center) => compare(
      frames[(center - 1 + frames.length) % frames.length],
      frames[(center + 1) % frames.length],
    )),
  };
  const errors = [];
  const [cell] = finalizeDisplayed112Tracks(new Map([[track.key, track]]), frames.length, errors);
  return { cell, errors };
}

const DISPLAYED_112_HOST_METRICS = Object.freeze([
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
const DISPLAYED_112_HOST_PARITY_METRICS = Object.freeze([
  "silhouetteIou",
  "silhouetteCentroidDistancePx",
  "normalizedAlphaDiff",
  "changedAlphaPixelFraction",
  "alphaAreaRatioSymmetric",
]);
const HOST_TRACE_WORST_PER_METRIC = 5;

function canonicalHostTransitionRecord(transition) {
  return {
    id: transition.id,
    kind: transition.kind,
    gateKind: transition.gateKind ?? null,
    page: transition.page ?? null,
    fromPage: transition.fromPage ?? transition.page ?? null,
    toPage: transition.toPage ?? transition.page ?? null,
    seam: transition.seam === true,
    from: transition.from,
    to: transition.to,
    metrics: Object.fromEntries(Object.entries(transition.metrics).toSorted(([left], [right]) => (
      left.localeCompare(right)
    ))),
    validation: {
      ok: transition.validation.ok,
      deferredToPairPhaseStability:
        transition.validation.deferredToPairPhaseStability === true,
      checks: Object.fromEntries(
        Object.entries(transition.validation.checks ?? {}).toSorted(([left], [right]) => (
          left.localeCompare(right)
        )),
      ),
      flags: [...(transition.validation.flags ?? [])],
    },
  };
}

function transitionMetricSetting(transition, metric) {
  return {
    id: transition.id,
    value: transition.metrics[metric],
    fromPage: transition.fromPage ?? transition.page ?? null,
    toPage: transition.toPage ?? transition.page ?? null,
  };
}

export function summarizeHostTransitionTrace(transitions) {
  const records = transitions.map(canonicalHostTransitionRecord);
  const metricNames = [...new Set(transitions.flatMap(({ metrics }) => Object.keys(metrics)))].toSorted();
  const metricExtrema = Object.fromEntries(metricNames.map((metric) => {
    const candidates = transitions.filter(({ metrics }) => Number.isFinite(metrics[metric]));
    const ascending = candidates.toSorted((left, right) => (
      left.metrics[metric] - right.metrics[metric] || left.id.localeCompare(right.id)
    ));
    return [metric, {
      minimum: ascending.length === 0 ? null : transitionMetricSetting(ascending[0], metric),
      maximum: ascending.length === 0 ? null : transitionMetricSetting(ascending.at(-1), metric),
    }];
  }));
  const worstByMetric = Object.fromEntries(metricNames.map((metric) => {
    const candidates = transitions.filter(({ metrics }) => Number.isFinite(metrics[metric]));
    const worstFirst = candidates.toSorted((left, right) => {
      const difference = metric === "silhouetteIou"
        ? left.metrics[metric] - right.metrics[metric]
        : right.metrics[metric] - left.metrics[metric];
      return difference || left.id.localeCompare(right.id);
    });
    return [metric, worstFirst.slice(0, HOST_TRACE_WORST_PER_METRIC).map((transition) => (
      transitionMetricSetting(transition, metric)
    ))];
  }));
  const failing = transitions.filter(({ validation }) => !validation.ok);
  return {
    recordCount: records.length,
    orderedIdsSha256: sha256Json(records.map(({ id }) => id)),
    orderedFullRecordSha256: sha256Json(records),
    metricNames,
    metricNamesSha256: sha256Json(metricNames),
    metricExtrema,
    worstPerMetric: HOST_TRACE_WORST_PER_METRIC,
    worstByMetric,
    failingTransitionIds: failing.map(({ id }) => id),
  };
}

function summarizeIsolatedFrameTrace(records) {
  const failing = records.filter(({ validation }) => !validation.ok);
  return {
    recordCount: records.length,
    orderedIdsSha256: sha256Json(records.map(({ id }) => id)),
    orderedFullRecordSha256: sha256Json(records),
    failingFrameIds: failing.map(({ id }) => id),
  };
}

function displayed112HostBoundaryGateResult(kind, metric) {
  const gate = DISPLAYED_112_HOST_BOUNDARY_GATES[kind];
  if (!gate) throw new Error(`unknown exact default-fallback host-boundary gate ${kind}`);
  const checks = {
    silhouetteIou: metric.silhouetteIou >= gate.minimumSilhouetteIou,
    silhouetteCentroidDistancePx:
      metric.silhouetteCentroidDistancePx <= gate.maximumSilhouetteCentroidDistancePx,
    normalizedRgbaDiff: metric.normalizedRgbaDiff <= gate.maximumNormalizedRgbaDiff,
    normalizedAlphaDiff: metric.normalizedAlphaDiff <= gate.maximumNormalizedAlphaDiff,
    changedPixelFraction: metric.changedPixelFraction <= gate.maximumChangedPixelFraction,
    changedAlphaPixelFraction:
      metric.changedAlphaPixelFraction <= gate.maximumChangedAlphaPixelFraction,
    alphaAreaRatioSymmetric:
      metric.alphaAreaRatioSymmetric <= gate.maximumAlphaAreaRatioSymmetric,
    perceptualRms: metric.perceptualRms <= gate.maximumPerceptualRms,
    stronglyChangedCellFraction:
      metric.stronglyChangedCellFraction <= gate.maximumStronglyChangedCellFraction,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    gate,
    checks,
    flags: Object.entries(checks).filter(([, passes]) => !passes).map(([name]) => name),
  };
}

export function analyzeSourceHostBoundaryRgba({
  from,
  to,
  gateKind = "adjacentGazeSector",
} = {}) {
  const expectedBytes = CELL_WIDTH * CELL_HEIGHT * 4;
  if (!Buffer.isBuffer(from) || !Buffer.isBuffer(to)
    || from.length !== expectedBytes || to.length !== expectedBytes) {
    throw new Error(`source host-boundary frames must contain ${expectedBytes} RGBA bytes`);
  }
  const rawMetrics = compareCellRegions(from, to, 0, 0, 0, 0, {
    regionWidth: CELL_WIDTH,
    regionHeight: CELL_HEIGHT,
    leftWidth: CELL_WIDTH,
    rightWidth: CELL_WIDTH,
  });
  const validation = transitionGateResult(gateKind, rawMetrics);
  return {
    metrics: presentDiff(rawMetrics),
    validation: {
      ...validation,
      flags: Object.entries(validation.checks)
        .filter(([, passes]) => !passes)
        .map(([name]) => name),
    },
  };
}

export function analyzeDisplayed112HostBoundaryRgba({
  from,
  to,
  variant = "dark",
  gateKind = "samePhaseAdjacentGaze",
} = {}) {
  const expectedBytes = SHIPPING_112_DISPLAY.deviceWidthPx
    * SHIPPING_112_DISPLAY.deviceHeightPx * 4;
  if (!Buffer.isBuffer(from) || !Buffer.isBuffer(to)
    || from.length !== expectedBytes || to.length !== expectedBytes) {
    throw new Error(`displayed host-boundary frames must contain ${expectedBytes} RGBA bytes`);
  }
  const rawMetrics = compareDisplayed112Frames(from, to, variant);
  return {
    metrics: presentDiff(rawMetrics),
    validation: displayed112HostBoundaryGateResult(gateKind, rawMetrics),
  };
}

function displayed112CachedHostFrame(frameCache, cell, page) {
  return frameCache.get(`r${cell.row}c${cell.column}`)?.[page] ?? null;
}

function makeDisplayed112HostTransition({
  sourceTransition,
  fromPage,
  toPage,
  frameCache,
  variant,
  gateKind = null,
}) {
  const from = displayed112CachedHostFrame(frameCache, sourceTransition.from, fromPage);
  const to = displayed112CachedHostFrame(frameCache, sourceTransition.to, toPage);
  if (!from || !to) {
    throw new Error(
      `${sourceTransition.id} is missing cached exact default-fallback frame bytes `
      + `for p${fromPage}->p${toPage}`,
    );
  }
  const rawMetrics = compareDisplayed112Frames(from, to, variant);
  const validation = gateKind == null
    ? {
        ok: true,
        deferredToPairPhaseStability: true,
        checks: { pairPhaseStability: true },
        flags: [],
      }
    : displayed112HostBoundaryGateResult(gateKind, rawMetrics);
  return {
    id: sourceTransition.id,
    kind: sourceTransition.kind,
    gateKind,
    page: fromPage,
    fromPage,
    toPage,
    seam: fromPage !== toPage && toPage === 0,
    from: sourceTransition.from,
    to: sourceTransition.to,
    metrics: presentDiff(rawMetrics),
    validation,
  };
}

function summarizeDisplayed112HostGroup(transitions, expectedIds, gateKind) {
  const maximumObserved = Object.fromEntries(DISPLAYED_112_HOST_METRICS.map((metric) => {
    const values = transitions.map((transition) => transition.metrics[metric]);
    return [metric, values.length === 0 ? null : round(
      metric === "silhouetteIou" ? Math.min(...values) : Math.max(...values),
    )];
  }));
  const failing = transitions.filter(({ validation }) => !validation.ok);
  const alphaSilhouetteSequence = transitions.map((transition) => ({
    id: transition.id,
    metrics: DISPLAYED_112_HOST_PARITY_METRICS.map((metric) => transition.metrics[metric]),
  }));
  return {
    gateKind,
    gate: DISPLAYED_112_HOST_BOUNDARY_GATES[gateKind],
    count: transitions.length,
    passing: transitions.length - failing.length,
    failing: failing.length,
    membership: exactIdMembership(transitions.map(({ id }) => id), expectedIds),
    maximumObserved,
    trace: summarizeHostTransitionTrace(transitions),
    canonicalAlphaSilhouetteSequenceSha256: sha256Json(alphaSilhouetteSequence),
    failingTransitionIds: failing.map(({ id }) => id),
  };
}

function displayed112HostExpectedIds(pageCount) {
  const pages = Array.from({ length: pageCount }, (_, page) => page);
  const samePhase = {
    timedRowPairs: pages.flatMap((page) => expectedSamePhaseIds(page).timedRowPairs),
    eligibleTimedToGaze: pages.flatMap((page) => GAZE_ELIGIBLE_ROWS.flatMap((row) => (
      Array.from({ length: 16 }, (_, direction) => (
        `p${page}-r${row}c0-to-gaze-${direction * 22.5}deg`
      ))
    ))),
    otherTimedToGaze: pages.flatMap((page) => TIMED_ROWS
      .filter((row) => !GAZE_ELIGIBLE_ROWS.includes(row))
      .flatMap((row) => Array.from({ length: 16 }, (_, direction) => (
        `p${page}-r${row}c0-to-gaze-${direction * 22.5}deg`
      )))),
    adjacentGaze: pages.flatMap((page) => expectedSamePhaseIds(page).gazeNeighborPairs),
    nonNeighborGaze: pages.flatMap((page) => expectedSamePhaseIds(page).gazeBodyPairs
      .filter((id) => {
        const match = id.match(/gaze-body-([\d.]+)-to-([\d.]+)deg$/u);
        return match && !gazeDirectionsAdjacent(Number(match[1]) / 22.5, Number(match[2]) / 22.5);
      })),
  };
  const crossPhase = {
    timedRowChanges: [],
    adjacentGaze: [],
    gazeToEligibleTimed: [],
    gazeToOtherTimed: [],
    eligibleTimedToGaze: [],
    nonNeighborGaze: [],
  };
  for (const fromPage of pages) {
    const toPage = (fromPage + 1) % pageCount;
    const expected = expectedCrossPhaseIds(fromPage, toPage);
    crossPhase.timedRowChanges.push(...expected.timedRowChanges);
    crossPhase.adjacentGaze.push(...expected.gazeNeighborChanges);
    crossPhase.gazeToEligibleTimed.push(...expected.gazeToTimed.filter((id) => (
      GAZE_ELIGIBLE_ROWS.some((row) => id.endsWith(`-to-r${row}`))
    )));
    crossPhase.gazeToOtherTimed.push(...expected.gazeToTimed.filter((id) => (
      TIMED_ROWS.some((row) => !GAZE_ELIGIBLE_ROWS.includes(row) && id.endsWith(`-to-r${row}`))
    )));
    crossPhase.eligibleTimedToGaze.push(...expected.eligibleTimedToGaze);
    crossPhase.nonNeighborGaze.push(...expected.gazeBodyNonNeighborChanges);
  }
  return { samePhase, crossPhase };
}

function buildDisplayed112HostBoundaryReport({
  pages,
  crossPhaseWindows,
  frameCache,
  variant,
  errors,
}) {
  const expected = displayed112HostExpectedIds(pages.length);
  const sameTimedSource = pages.flatMap((page) => page.samePhaseTransitions.timedRowPairs
    .map((transition) => ({ transition, page: page.index })));
  const sameGazeSource = pages.flatMap((page) => page.samePhaseTransitions.gazeEntry
    .map((transition) => ({ transition, page: page.index })));
  const sameAdjacentSource = pages.flatMap((page) => page.samePhaseTransitions.gazeNeighborPairs
    .map((transition) => ({ transition, page: page.index })));
  const sameBodySource = pages.flatMap((page) => page.samePhaseTransitions.gazeBodyPairs
    .filter(({ from, to }) => gazePairIsNonNeighbor(from, to))
    .map((transition) => ({ transition, page: page.index })));
  const crossTimedSource = crossPhaseWindows.flatMap((window) => window.timedRowChanges);
  const crossAdjacentSource = crossPhaseWindows.flatMap((window) => window.gazeNeighborChanges);
  const crossGazeToTimedSource = crossPhaseWindows.flatMap((window) => window.gazeToTimed);
  const crossTimedToGazeSource = crossPhaseWindows.flatMap((window) => window.eligibleTimedToGaze);
  const crossBodySource = crossPhaseWindows.flatMap(
    (window) => window.gazeBodyNonNeighborChanges,
  );
  const sameTransition = ({ transition, page }, gateKind = null) => (
    makeDisplayed112HostTransition({
      sourceTransition: transition,
      fromPage: page,
      toPage: page,
      frameCache,
      variant,
      gateKind,
    })
  );
  const crossTransition = (transition, gateKind = null) => makeDisplayed112HostTransition({
    sourceTransition: transition,
    fromPage: transition.fromPage,
    toPage: transition.toPage,
    frameCache,
    variant,
    gateKind,
  });

  const coreDefinitions = [
    ["samePhaseTimedRowPairs", sameTimedSource.map((entry) => sameTransition(entry, "samePhaseTimedRowPairs")), expected.samePhase.timedRowPairs],
    ["samePhaseEligibleTimedToGaze", sameGazeSource.filter(({ transition }) => GAZE_ELIGIBLE_ROWS.includes(transition.from.row)).map((entry) => sameTransition(entry, "samePhaseEligibleTimedToGaze")), expected.samePhase.eligibleTimedToGaze],
    ["samePhaseOtherTimedToGaze", sameGazeSource.filter(({ transition }) => !GAZE_ELIGIBLE_ROWS.includes(transition.from.row)).map((entry) => sameTransition(entry, "samePhaseOtherTimedToGaze")), expected.samePhase.otherTimedToGaze],
    ["samePhaseAdjacentGaze", sameAdjacentSource.map((entry) => sameTransition(entry, "samePhaseAdjacentGaze")), expected.samePhase.adjacentGaze],
    ["crossPhaseTimedRowChanges", crossTimedSource.map((entry) => crossTransition(entry, "crossPhaseTimedRowChanges")), expected.crossPhase.timedRowChanges],
    ["crossPhaseAdjacentGaze", crossAdjacentSource.map((entry) => crossTransition(entry, "crossPhaseAdjacentGaze")), expected.crossPhase.adjacentGaze],
    ["crossPhaseGazeToEligibleTimed", crossGazeToTimedSource.filter(({ to }) => GAZE_ELIGIBLE_ROWS.includes(to.row)).map((entry) => crossTransition(entry, "crossPhaseGazeToEligibleTimed")), expected.crossPhase.gazeToEligibleTimed],
    ["crossPhaseGazeToOtherTimed", crossGazeToTimedSource.filter(({ to }) => !GAZE_ELIGIBLE_ROWS.includes(to.row)).map((entry) => crossTransition(entry, "crossPhaseGazeToOtherTimed")), expected.crossPhase.gazeToOtherTimed],
    ["crossPhaseEligibleTimedToGaze", crossTimedToGazeSource.map((entry) => crossTransition(entry, "crossPhaseEligibleTimedToGaze")), expected.crossPhase.eligibleTimedToGaze],
  ];
  const groups = Object.fromEntries(coreDefinitions.map(([key, transitions, expectedIds]) => [
    key,
    summarizeDisplayed112HostGroup(transitions, expectedIds, key),
  ]));
  const coreTransitions = coreDefinitions.flatMap(([, transitions]) => transitions);
  const coreExpectedIds = coreDefinitions.flatMap(([, , expectedIds]) => expectedIds);

  const sameNonNeighborTransitions = sameBodySource.map((entry) => sameTransition(entry));
  const crossNonNeighborTransitions = crossBodySource.map((entry) => crossTransition(entry));
  const samePhaseStability = analyzeGazeBodyPhaseTransitions(sameNonNeighborTransitions, {
    gate: DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
  });
  const crossPhaseStability = analyzeGazeBodyPhaseTransitions(crossNonNeighborTransitions, {
    gate: DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
  });
  const sameMembership = exactIdMembership(
    sameNonNeighborTransitions.map(({ id }) => id),
    expected.samePhase.nonNeighborGaze,
  );
  const crossMembership = exactIdMembership(
    crossNonNeighborTransitions.map(({ id }) => id),
    expected.crossPhase.nonNeighborGaze,
  );
  const allTransitions = [
    ...coreTransitions,
    ...sameNonNeighborTransitions,
    ...crossNonNeighborTransitions,
  ];
  const allExpectedIds = [
    ...coreExpectedIds,
    ...expected.samePhase.nonNeighborGaze,
    ...expected.crossPhase.nonNeighborGaze,
  ];
  const membership = exactIdMembership(allTransitions.map(({ id }) => id), allExpectedIds);
  const failingCoreTransitions = coreTransitions.filter(({ validation }) => !validation.ok);
  const canonicalAlphaSilhouetteSequenceSha256 = sha256Json({
    groups: Object.fromEntries(Object.entries(groups).map(([key, group]) => (
      [key, group.canonicalAlphaSilhouetteSequenceSha256]
    ))),
    samePhaseNonNeighborGaze: samePhaseStability.canonicalPairSequenceSha256,
    crossPhaseNonNeighborGaze: crossPhaseStability.canonicalPairSequenceSha256,
  });
  const orderedFullRecordTrace = summarizeHostTransitionTrace(allTransitions);
  const ok = pages.length === FLUID_ATLAS_FRAME_COUNT
    && crossPhaseWindows.length === FLUID_ATLAS_FRAME_COUNT
    && coreTransitions.length === coreExpectedIds.length
    && sameNonNeighborTransitions.length === expected.samePhase.nonNeighborGaze.length
    && crossNonNeighborTransitions.length === expected.crossPhase.nonNeighborGaze.length
    && allTransitions.length === allExpectedIds.length
    && Object.values(groups).every((group) => group.failing === 0 && group.membership.ok)
    && sameMembership.ok
    && crossMembership.ok
    && membership.ok
    && samePhaseStability.ok
    && crossPhaseStability.ok
    && failingCoreTransitions.length === 0;
  if (!ok) {
    errors.push(
      `exact 7.04rem/DPR2 host-boundary matrix failed or is incomplete: `
      + `${allTransitions.length}/${allExpectedIds.length} IDs, `
      + `${failingCoreTransitions.length} core failure(s), `
      + `${samePhaseStability.failingPairCount + crossPhaseStability.failingPairCount} pair failure(s)`,
    );
  }
  return {
    ok,
    display: SHIPPING_112_DISPLAY,
    sampling: "authoritative Chromium DPR2 pixelated host background lattice",
    gates: DISPLAYED_112_HOST_BOUNDARY_GATES,
    gazeBodyPhaseStabilityGate: DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
    gazeBodyCrossPhaseStabilityGate:
      DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
    core: {
      transitionCount: coreTransitions.length,
      expectedTransitionCount: coreExpectedIds.length,
      passingTransitionCount: coreTransitions.length - failingCoreTransitions.length,
      failingTransitionCount: failingCoreTransitions.length,
      groups,
    },
    supplemental: {
      samePhaseNonNeighborGaze: {
        transitionCount: sameNonNeighborTransitions.length,
        membership: sameMembership,
        phaseStability: samePhaseStability,
        trace: summarizeHostTransitionTrace(sameNonNeighborTransitions),
      },
      crossPhaseNonNeighborGaze: {
        transitionCount: crossNonNeighborTransitions.length,
        membership: crossMembership,
        phaseStability: crossPhaseStability,
        trace: summarizeHostTransitionTrace(crossNonNeighborTransitions),
      },
    },
    totalUniqueTransitionCount: allTransitions.length,
    expectedTotalUniqueTransitionCount: allExpectedIds.length,
    membership,
    orderedFullRecordTrace,
    canonicalAlphaSilhouetteSequenceSha256,
    failingTransitionIds: failingCoreTransitions.map(({ id }) => id),
  };
}

function sourceHostTransition(transition, gateKind = null) {
  const samePhaseMatch = /^p(\d+)-/u.exec(transition.id);
  const page = transition.page ?? (samePhaseMatch ? Number(samePhaseMatch[1]) : null);
  return {
    ...transition,
    gateKind,
    page,
    fromPage: transition.fromPage ?? page,
    toPage: transition.toPage ?? page,
    seam: transition.seam === true,
  };
}

function summarizeSourceHostGroup(transitions, expectedIds, gateKind) {
  const failing = transitions.filter(({ validation }) => !validation.ok);
  const alphaSilhouetteSequence = transitions.map((transition) => ({
    id: transition.id,
    metrics: DISPLAYED_112_HOST_PARITY_METRICS.map((metric) => transition.metrics[metric]),
  }));
  return {
    gateKind,
    gate: gateKind == null ? null : SAME_PHASE_TRANSITION_GATES[gateKind],
    count: transitions.length,
    passing: transitions.length - failing.length,
    failing: failing.length,
    membership: exactIdMembership(transitions.map(({ id }) => id), expectedIds),
    summary: summarizeSamePhaseTransitions(transitions),
    trace: summarizeHostTransitionTrace(transitions),
    canonicalAlphaSilhouetteSequenceSha256: sha256Json(alphaSilhouetteSequence),
    failingTransitionIds: failing.map(({ id }) => id),
  };
}

function buildSourceHostBoundaryReport({
  pages,
  crossPhaseWindows,
  gazeBodyPhaseStability,
  crossPhaseGazeBodyPhaseStability,
  errors,
}) {
  const expected = displayed112HostExpectedIds(pages.length);
  const sameTimed = pages.flatMap((page) => page.samePhaseTransitions.timedRowPairs)
    .map((transition) => sourceHostTransition(transition, "timedRowPair"));
  const sameGaze = pages.flatMap((page) => page.samePhaseTransitions.gazeEntry);
  const sameEligible = sameGaze
    .filter(({ from }) => GAZE_ELIGIBLE_ROWS.includes(from.row))
    .map((transition) => sourceHostTransition(transition, "gazeEntry"));
  const sameOther = sameGaze
    .filter(({ from }) => !GAZE_ELIGIBLE_ROWS.includes(from.row))
    .map((transition) => sourceHostTransition(transition, "gazeTimedBoundary"));
  const sameAdjacent = pages.flatMap((page) => page.samePhaseTransitions.gazeNeighborPairs)
    .map((transition) => sourceHostTransition(transition, "adjacentGazeSector"));
  const sameNonNeighbor = pages.flatMap((page) => page.samePhaseTransitions.gazeBodyPairs)
    .filter(({ from, to }) => gazePairIsNonNeighbor(from, to))
    .map((transition) => sourceHostTransition(transition));

  const crossTimed = crossPhaseWindows.flatMap((window) => window.timedRowChanges)
    .map((transition) => sourceHostTransition(transition, "timedRowCrossPhase"));
  const crossAdjacent = crossPhaseWindows.flatMap((window) => window.gazeNeighborChanges)
    .map((transition) => sourceHostTransition(transition, "adjacentGazeSector"));
  const crossGazeToTimed = crossPhaseWindows.flatMap((window) => window.gazeToTimed);
  const crossGazeEligible = crossGazeToTimed
    .filter(({ to }) => GAZE_ELIGIBLE_ROWS.includes(to.row))
    .map((transition) => sourceHostTransition(transition, "gazeEntry"));
  const crossGazeOther = crossGazeToTimed
    .filter(({ to }) => !GAZE_ELIGIBLE_ROWS.includes(to.row))
    .map((transition) => sourceHostTransition(transition, "gazeTimedBoundary"));
  const crossEligibleToGaze = crossPhaseWindows
    .flatMap((window) => window.eligibleTimedToGaze)
    .map((transition) => sourceHostTransition(transition, "gazeEntry"));
  const crossNonNeighbor = crossPhaseWindows
    .flatMap((window) => window.gazeBodyNonNeighborChanges)
    .map((transition) => sourceHostTransition(transition));

  const definitions = [
    ["samePhaseTimedRowPairs", sameTimed, expected.samePhase.timedRowPairs, "timedRowPair"],
    ["samePhaseEligibleTimedToGaze", sameEligible, expected.samePhase.eligibleTimedToGaze, "gazeEntry"],
    ["samePhaseOtherTimedToGaze", sameOther, expected.samePhase.otherTimedToGaze, "gazeTimedBoundary"],
    ["samePhaseAdjacentGaze", sameAdjacent, expected.samePhase.adjacentGaze, "adjacentGazeSector"],
    ["crossPhaseTimedRowChanges", crossTimed, expected.crossPhase.timedRowChanges, "timedRowCrossPhase"],
    ["crossPhaseAdjacentGaze", crossAdjacent, expected.crossPhase.adjacentGaze, "adjacentGazeSector"],
    ["crossPhaseGazeToEligibleTimed", crossGazeEligible, expected.crossPhase.gazeToEligibleTimed, "gazeEntry"],
    ["crossPhaseGazeToOtherTimed", crossGazeOther, expected.crossPhase.gazeToOtherTimed, "gazeTimedBoundary"],
    ["crossPhaseEligibleTimedToGaze", crossEligibleToGaze, expected.crossPhase.eligibleTimedToGaze, "gazeEntry"],
  ];
  const groups = Object.fromEntries(definitions.map(([key, transitions, expectedIds, gateKind]) => [
    key,
    summarizeSourceHostGroup(transitions, expectedIds, gateKind),
  ]));
  const coreTransitions = definitions.flatMap(([, transitions]) => transitions);
  const coreExpectedIds = definitions.flatMap(([, , expectedIds]) => expectedIds);
  const sameMembership = exactIdMembership(
    sameNonNeighbor.map(({ id }) => id),
    expected.samePhase.nonNeighborGaze,
  );
  const crossMembership = exactIdMembership(
    crossNonNeighbor.map(({ id }) => id),
    expected.crossPhase.nonNeighborGaze,
  );
  const allTransitions = [...coreTransitions, ...sameNonNeighbor, ...crossNonNeighbor];
  const allExpectedIds = [
    ...coreExpectedIds,
    ...expected.samePhase.nonNeighborGaze,
    ...expected.crossPhase.nonNeighborGaze,
  ];
  const membership = exactIdMembership(allTransitions.map(({ id }) => id), allExpectedIds);
  const failingCoreTransitions = coreTransitions.filter(({ validation }) => !validation.ok);
  const canonicalAlphaSilhouetteSequenceSha256 = sha256Json({
    groups: Object.fromEntries(Object.entries(groups).map(([key, group]) => (
      [key, group.canonicalAlphaSilhouetteSequenceSha256]
    ))),
    samePhaseNonNeighborGaze: gazeBodyPhaseStability.canonicalPairSequenceSha256,
    crossPhaseNonNeighborGaze:
      crossPhaseGazeBodyPhaseStability.canonicalPairSequenceSha256,
  });
  const ok = coreTransitions.length === coreExpectedIds.length
    && sameNonNeighbor.length === expected.samePhase.nonNeighborGaze.length
    && crossNonNeighbor.length === expected.crossPhase.nonNeighborGaze.length
    && allTransitions.length === allExpectedIds.length
    && Object.values(groups).every((group) => group.failing === 0 && group.membership.ok)
    && sameMembership.ok
    && crossMembership.ok
    && membership.ok
    && gazeBodyPhaseStability.ok
    && crossPhaseGazeBodyPhaseStability.ok
    && failingCoreTransitions.length === 0;
  if (!ok) {
    errors.push(
      `source-cell host-boundary matrix failed or is incomplete: `
      + `${allTransitions.length}/${allExpectedIds.length} IDs, `
      + `${failingCoreTransitions.length} core failure(s)`,
    );
  }
  return {
    ok,
    sampling: "decoded 192x208 source cells before authoritative host scaling",
    gates: SAME_PHASE_TRANSITION_GATES,
    core: {
      transitionCount: coreTransitions.length,
      expectedTransitionCount: coreExpectedIds.length,
      passingTransitionCount: coreTransitions.length - failingCoreTransitions.length,
      failingTransitionCount: failingCoreTransitions.length,
      groups,
    },
    supplemental: {
      samePhaseNonNeighborGaze: {
        transitionCount: sameNonNeighbor.length,
        membership: sameMembership,
        phaseStability: gazeBodyPhaseStability,
        trace: summarizeHostTransitionTrace(sameNonNeighbor),
      },
      crossPhaseNonNeighborGaze: {
        transitionCount: crossNonNeighbor.length,
        membership: crossMembership,
        phaseStability: crossPhaseGazeBodyPhaseStability,
        trace: summarizeHostTransitionTrace(crossNonNeighbor),
      },
    },
    totalUniqueTransitionCount: allTransitions.length,
    expectedTotalUniqueTransitionCount: allExpectedIds.length,
    membership,
    orderedFullRecordTrace: summarizeHostTransitionTrace(allTransitions),
    canonicalAlphaSilhouetteSequenceSha256,
    failingTransitionIds: failingCoreTransitions.map(({ id }) => id),
  };
}

function summarizeDiffs(diffs) {
  if (diffs.length === 0) {
    return {
      transitions: 0,
      meanNormalizedRgbaDiff: 0,
      minimumNormalizedRgbaDiff: 0,
      maximumNormalizedRgbaDiff: 0,
      meanNormalizedAlphaDiff: 0,
      minimumNormalizedAlphaDiff: 0,
      maximumNormalizedAlphaDiff: 0,
      meanChangedPixelFraction: 0,
      minimumChangedPixelFraction: 0,
      maximumChangedPixelFraction: 0,
      meanChangedAlphaPixelFraction: 0,
      minimumChangedAlphaPixelFraction: 0,
      maximumChangedAlphaPixelFraction: 0,
    };
  }
  return {
    transitions: diffs.length,
    meanNormalizedRgbaDiff: round(
      diffs.reduce((sum, diff) => sum + diff.normalizedRgbaDiff, 0) / diffs.length,
    ),
    minimumNormalizedRgbaDiff: round(Math.min(...diffs.map((diff) => diff.normalizedRgbaDiff))),
    maximumNormalizedRgbaDiff: round(Math.max(...diffs.map((diff) => diff.normalizedRgbaDiff))),
    meanNormalizedAlphaDiff: round(
      diffs.reduce((sum, diff) => sum + diff.normalizedAlphaDiff, 0) / diffs.length,
    ),
    minimumNormalizedAlphaDiff: round(Math.min(...diffs.map((diff) => diff.normalizedAlphaDiff))),
    maximumNormalizedAlphaDiff: round(Math.max(...diffs.map((diff) => diff.normalizedAlphaDiff))),
    meanChangedPixelFraction: round(
      diffs.reduce((sum, diff) => sum + diff.changedPixelFraction, 0) / diffs.length,
    ),
    minimumChangedPixelFraction: round(Math.min(...diffs.map((diff) => diff.changedPixelFraction))),
    maximumChangedPixelFraction: round(Math.max(...diffs.map((diff) => diff.changedPixelFraction))),
    meanChangedAlphaPixelFraction: round(
      diffs.reduce((sum, diff) => sum + diff.changedAlphaPixelFraction, 0) / diffs.length,
    ),
    minimumChangedAlphaPixelFraction: round(Math.min(...diffs.map((diff) => diff.changedAlphaPixelFraction))),
    maximumChangedAlphaPixelFraction: round(Math.max(...diffs.map((diff) => diff.changedAlphaPixelFraction))),
  };
}

function finalizeTemporalTracks(tracks, inspectedPageCount, errors) {
  return [...tracks.values()].map((track) => {
    const distinctRgbaFrameCount = new Set(track.rgbaHashes).size;
    const distinctAlphaFrameCount = new Set(track.alphaHashes).size;
    const internalSummary = summarizeDiffs(track.internalDiffs);
    const activeInternalTransitionCount = track.internalDiffs.filter((diff) => (
      diff.normalizedRgbaDiff >= MIN_TEMPORAL_NORMALIZED_RGBA_DIFF
        && diff.changedPixelFraction >= MIN_TEMPORAL_CHANGED_PIXEL_FRACTION
    )).length;
    const totalNormalizedRgbaDiff = track.internalDiffs.reduce(
      (sum, diff) => sum + diff.normalizedRgbaDiff,
      0,
    );
    const totalChangedPixelFraction = track.internalDiffs.reduce(
      (sum, diff) => sum + diff.changedPixelFraction,
      0,
    );
    const activeInternalTransitionFraction = track.internalDiffs.length === 0
      ? 0
      : activeInternalTransitionCount / track.internalDiffs.length;
    const gazeFullCycleGate = TEMPORAL_MOTION_GATE.gazeFullCycle;
    const usesGazeFullCycleGate = gazeFullCycleGate.rowIndices.includes(track.row);
    const strictPerTransitionMotion = track.internalDiffs.every((diff) => (
      diff.normalizedRgbaDiff >= MIN_TEMPORAL_NORMALIZED_RGBA_DIFF
        && diff.changedPixelFraction >= MIN_TEMPORAL_CHANGED_PIXEL_FRACTION
    ));
    const gazeFullCycleMotion = activeInternalTransitionFraction
      >= gazeFullCycleGate.minimumActiveInternalTransitionFraction
      && totalNormalizedRgbaDiff >= gazeFullCycleGate.minimumTotalNormalizedRgbaDiff
      && totalChangedPixelFraction >= gazeFullCycleGate.minimumTotalChangedPixelFraction;
    const completeInternalCoverage = track.internalDiffs.length
      === FLUID_ATLAS_FRAME_COUNT - 1;
    const motionExists = inspectedPageCount === FLUID_ATLAS_FRAME_COUNT
      && distinctRgbaFrameCount > 1
      && (!TEMPORAL_MOTION_GATE.requiresDistinctAlphaFrames || distinctAlphaFrameCount > 1)
      && completeInternalCoverage
      && (usesGazeFullCycleGate ? gazeFullCycleMotion : strictPerTransitionMotion);
    const loopNotWorse = track.loopDiff != null
      && track.internalDiffs.length > 0
      && track.loopDiff.normalizedRgbaDiff <= Math.max(...track.internalDiffs.map((diff) => diff.normalizedRgbaDiff)) + DIFF_EPSILON
      && track.loopDiff.normalizedAlphaDiff <= Math.max(...track.internalDiffs.map((diff) => diff.normalizedAlphaDiff)) + DIFF_EPSILON
      && track.loopDiff.changedPixelFraction <= Math.max(...track.internalDiffs.map((diff) => diff.changedPixelFraction)) + DIFF_EPSILON
      && track.loopDiff.changedAlphaPixelFraction <= Math.max(...track.internalDiffs.map((diff) => diff.changedAlphaPixelFraction)) + DIFF_EPSILON;
    const rawTemporalTransitions = [
      ...track.internalDiffs.map((metrics, fromPage) => ({
        fromPage,
        toPage: fromPage + 1,
        seam: false,
        metrics,
      })),
      ...(track.loopDiff == null ? [] : [{
        fromPage: inspectedPageCount - 1,
        toPage: 0,
        seam: true,
        metrics: track.loopDiff,
      }]),
    ];
    const featureInkPeak = Math.max(
      1,
      ...rawTemporalTransitions.flatMap(({ metrics }) => [
        metrics.fromFeatureInkMass,
        metrics.toFeatureInkMass,
      ]),
    );
    rawTemporalTransitions.forEach(({ metrics }, index) => {
      metrics.featureInkMassStepFraction = Math.abs(
        metrics.toFeatureInkMass - metrics.fromFeatureInkMass,
      ) / featureInkPeak;
      metrics.featureInkVariationFraction = metrics.featureInkVariation / featureInkPeak;
      metrics.featureInkMaterial = featureInkPeak
        >= ANIMATED_TEMPORAL_ADJACENCY_GATE.minimumFeatureInkPeakForFeatureMetrics;
      metrics.featureInkCentroidMaterial = metrics.featureInkMaterial
        && Math.min(metrics.fromFeatureInkMass, metrics.toFeatureInkMass)
          >= Math.max(
            ANIMATED_TEMPORAL_ADJACENCY_GATE.minimumFeatureInkEndpointMass,
            featureInkPeak
              * ANIMATED_TEMPORAL_ADJACENCY_GATE.minimumFeatureInkEndpointPeakFraction,
          );
      const previous = rawTemporalTransitions[
        (index - 1 + rawTemporalTransitions.length) % rawTemporalTransitions.length
      ]?.metrics.perceptualRms ?? 0;
      const next = rawTemporalTransitions[(index + 1) % rawTemporalTransitions.length]
        ?.metrics.perceptualRms ?? 0;
      metrics.localEnergyRatio = metrics.perceptualRms / Math.max(
        ANIMATED_TEMPORAL_ADJACENCY_GATE.localEnergyFloorPerceptualRms,
        (previous + next) / 2,
      );
    });
    const temporalTransitions = rawTemporalTransitions.map((transition) => ({
      fromPage: transition.fromPage,
      toPage: transition.toPage,
      seam: transition.seam,
      metrics: presentDiff(transition.metrics),
      validation: temporalAdjacencyGateResult(transition.metrics, track.row, transition.seam),
    }));
    const frameExcursions = Array.from({ length: inspectedPageCount }, (_, centerPage) => {
      const previousTransition = rawTemporalTransitions[
        (centerPage - 1 + rawTemporalTransitions.length) % rawTemporalTransitions.length
      ];
      const nextTransition = rawTemporalTransitions[centerPage];
      const skip = track.skipDiffs[centerPage];
      const excursion = {
        centerPage,
        previousPage: (centerPage - 1 + inspectedPageCount) % inspectedPageCount,
        nextPage: (centerPage + 1) % inspectedPageCount,
        previousPerceptualRms: previousTransition?.metrics.perceptualRms ?? 0,
        nextPerceptualRms: nextTransition?.metrics.perceptualRms ?? 0,
        skipPerceptualRms: skip?.perceptualRms ?? Number.POSITIVE_INFINITY,
      };
      excursion.excursionRatio = Math.min(
        excursion.previousPerceptualRms,
        excursion.nextPerceptualRms,
      ) / Math.max(
        ANIMATED_TEMPORAL_ADJACENCY_GATE.isolatedFrameSkipEnergyFloorPerceptualRms,
        excursion.skipPerceptualRms,
      );
      return {
        centerPage: excursion.centerPage,
        previousPage: excursion.previousPage,
        nextPage: excursion.nextPage,
        previousPerceptualRms: round(excursion.previousPerceptualRms),
        nextPerceptualRms: round(excursion.nextPerceptualRms),
        skipPerceptualRms: round(excursion.skipPerceptualRms),
        excursionRatio: round(excursion.excursionRatio),
        validation: isolatedFrameGateResult(excursion, track.row),
      };
    });
    const completeTemporalCoverage = temporalTransitions.length === FLUID_ATLAS_FRAME_COUNT
      && temporalTransitions.filter(({ seam }) => seam).length === 1
      && temporalTransitions.every((transition, index) => (
        transition.fromPage === index
        && transition.toPage === (index + 1) % FLUID_ATLAS_FRAME_COUNT
        && transition.seam === (index === FLUID_ATLAS_FRAME_COUNT - 1)
      ));
    const failingTemporalTransitions = temporalTransitions.filter(
      ({ validation }) => !validation.ok,
    );
    const failingFrameExcursions = frameExcursions.filter(({ validation }) => !validation.ok);
    const temporalUpperBoundSafe = completeTemporalCoverage
      && track.skipDiffs.filter(Boolean).length === inspectedPageCount
      && failingTemporalTransitions.length === 0
      && failingFrameExcursions.length === 0;
    if (!motionExists) errors.push(`${track.key} has no temporal pixel motion across ${inspectedPageCount} pages`);
    if (!loopNotWorse) errors.push(`${track.key} loop adjacency is worse than an internal adjacency`);
    if (!completeTemporalCoverage) {
      errors.push(`${track.key} temporal upper-bound coverage is incomplete or misordered`);
    }
    if (failingTemporalTransitions.length > 0) {
      errors.push(
        `${track.key} has ${failingTemporalTransitions.length} temporal adjacency upper-bound failure(s): `
        + failingTemporalTransitions.slice(0, 4).map((transition) => (
          `p${transition.fromPage}->p${transition.toPage} ${transition.validation.flags.join("+")}`
        )).join(", "),
      );
    }
    if (failingFrameExcursions.length > 0) {
      errors.push(
        `${track.key} has ${failingFrameExcursions.length} isolated-frame excursion failure(s): `
        + failingFrameExcursions.slice(0, 4).map((excursion) => (
          `p${excursion.centerPage} ratio ${excursion.excursionRatio}`
        )).join(", "),
      );
    }
    const maximumInternal = track.internalDiffs.length > 0
      ? Math.max(...track.internalDiffs.map((diff) => diff.normalizedRgbaDiff))
      : 0;
    return {
      key: track.key,
      row: track.row,
      column: track.column,
      state: track.state,
      inspectedPages: inspectedPageCount,
      distinctRgbaFrameCount,
      distinctAlphaFrameCount,
      motionExists,
      fullCycleMotion: {
        mode: usesGazeFullCycleGate ? "gaze-full-cycle" : "per-internal-transition",
        internalTransitionCount: track.internalDiffs.length,
        activeInternalTransitionCount,
        activeInternalTransitionFraction: round(activeInternalTransitionFraction),
        totalNormalizedRgbaDiff: round(totalNormalizedRgbaDiff),
        totalChangedPixelFraction: round(totalChangedPixelFraction),
        passesSelectedGate: usesGazeFullCycleGate
          ? gazeFullCycleMotion
          : strictPerTransitionMotion,
      },
      rgbaSequenceSha256: sha256(Buffer.from(track.rgbaHashes.join("\n"))),
      alphaSequenceSha256: sha256(Buffer.from(track.alphaHashes.join("\n"))),
      internalAdjacency: internalSummary,
      loopAdjacency: presentDiff(track.loopDiff),
      loopToMaximumInternalRgbaRatio: maximumInternal > 0 && track.loopDiff
        ? round(track.loopDiff.normalizedRgbaDiff / maximumInternal)
        : null,
      loopNotWorse,
      temporalAdjacency: {
        completeCoverage: completeTemporalCoverage,
        transitionCount: temporalTransitions.length,
        internalTransitionCount: temporalTransitions.filter(({ seam }) => !seam).length,
        loopSeamCount: temporalTransitions.filter(({ seam }) => seam).length,
        upperBoundSafe: temporalUpperBoundSafe,
        failingTransitionCount: failingTemporalTransitions.length,
        featureInkPeak: round(featureInkPeak),
        transitions: temporalTransitions,
      },
      isolatedFrameExcursions: {
        completeCoverage: frameExcursions.length === inspectedPageCount
          && track.skipDiffs.filter(Boolean).length === inspectedPageCount,
        frameCount: frameExcursions.length,
        passingFrameCount: frameExcursions.length - failingFrameExcursions.length,
        failingFrameCount: failingFrameExcursions.length,
        maximumObservedRatio: round(Math.max(0, ...frameExcursions.map(({ excursionRatio }) => excursionRatio))),
        frames: frameExcursions,
      },
    };
  });
}

function summarizeTemporalAdjacency(temporalCells) {
  const transitions = temporalCells.flatMap((cell) => (
    cell.temporalAdjacency.transitions.map((transition) => ({
      cellKey: cell.key,
      row: cell.row,
      column: cell.column,
      state: cell.state,
      ...transition,
    }))
  ));
  const maximumObserved = Object.fromEntries([
    "normalizedRgbaDiff",
    "normalizedAlphaDiff",
    "changedPixelFraction",
    "changedAlphaPixelFraction",
    "perceptualRms",
    "stronglyChangedCellFraction",
    "featureInkMassStepFraction",
    "featureInkVariationFraction",
    "featureInkCentroidStepPx",
    "localEnergyRatio",
  ].map((metric) => {
    const maximum = transitions.reduce((current, candidate) => (
      current == null || candidate.metrics[metric] > current.metrics[metric]
        ? candidate
        : current
    ), null);
    return [metric, maximum == null ? null : {
      value: maximum.metrics[metric],
      cellKey: maximum.cellKey,
      row: maximum.row,
      column: maximum.column,
      state: maximum.state,
      fromPage: maximum.fromPage,
      toPage: maximum.toPage,
      seam: maximum.seam,
    }];
  }));
  const failing = transitions.filter(({ validation }) => !validation.ok);
  const maximumMaterialLocalEnergy = transitions
    .filter(({ metrics }) => (
      metrics.perceptualRms >= ANIMATED_TEMPORAL_ADJACENCY_GATE.isolatedSnapMinimumPerceptualRms
    ))
    .reduce((current, candidate) => (
      current == null || candidate.metrics.localEnergyRatio > current.metrics.localEnergyRatio
        ? candidate
        : current
    ), null);
  const frameExcursions = temporalCells.flatMap((cell) => (
    cell.isolatedFrameExcursions.frames.map((frame) => ({
      cellKey: cell.key,
      row: cell.row,
      column: cell.column,
      state: cell.state,
      ...frame,
    }))
  ));
  const failingFrameExcursions = frameExcursions.filter(({ validation }) => !validation.ok);
  const maximumFrameExcursion = frameExcursions.reduce((current, candidate) => (
    current == null || candidate.excursionRatio > current.excursionRatio ? candidate : current
  ), null);
  const expectedTransitionCount = REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT;
  const expectedInternalTransitionCount = REQUIRED_CELL_COUNT * (FLUID_ATLAS_FRAME_COUNT - 1);
  return {
    gate: ANIMATED_TEMPORAL_ADJACENCY_GATE,
    requiredCellCount: REQUIRED_CELL_COUNT,
    frameCount: FLUID_ATLAS_FRAME_COUNT,
    expectedTransitionCount,
    transitionCount: transitions.length,
    expectedInternalTransitionCount,
    internalTransitionCount: transitions.filter(({ seam }) => !seam).length,
    expectedLoopSeamCount: REQUIRED_CELL_COUNT,
    loopSeamCount: transitions.filter(({ seam }) => seam).length,
    passingTransitionCount: transitions.length - failing.length,
    failingTransitionCount: failing.length,
    expectedIsolatedFrameCount: expectedTransitionCount,
    isolatedFrameCount: frameExcursions.length,
    passingIsolatedFrameCount: frameExcursions.length - failingFrameExcursions.length,
    failingIsolatedFrameCount: failingFrameExcursions.length,
    upperBoundSafeCellCount: temporalCells.filter(
      (cell) => cell.temporalAdjacency.upperBoundSafe,
    ).length,
    completeCoverage: transitions.length === expectedTransitionCount
      && transitions.filter(({ seam }) => !seam).length === expectedInternalTransitionCount
      && transitions.filter(({ seam }) => seam).length === REQUIRED_CELL_COUNT
      && frameExcursions.length === expectedTransitionCount
      && temporalCells.every((cell) => cell.isolatedFrameExcursions.completeCoverage),
    maximumObserved,
    maximumObservedMaterialLocalEnergyRatio: maximumMaterialLocalEnergy == null ? null : {
      value: maximumMaterialLocalEnergy.metrics.localEnergyRatio,
      cellKey: maximumMaterialLocalEnergy.cellKey,
      row: maximumMaterialLocalEnergy.row,
      column: maximumMaterialLocalEnergy.column,
      state: maximumMaterialLocalEnergy.state,
      fromPage: maximumMaterialLocalEnergy.fromPage,
      toPage: maximumMaterialLocalEnergy.toPage,
      seam: maximumMaterialLocalEnergy.seam,
    },
    maximumObservedIsolatedFrameExcursion: maximumFrameExcursion == null ? null : {
      value: maximumFrameExcursion.excursionRatio,
      cellKey: maximumFrameExcursion.cellKey,
      row: maximumFrameExcursion.row,
      column: maximumFrameExcursion.column,
      state: maximumFrameExcursion.state,
      previousPage: maximumFrameExcursion.previousPage,
      centerPage: maximumFrameExcursion.centerPage,
      nextPage: maximumFrameExcursion.nextPage,
    },
    failingTransitionIds: failing.map((transition) => (
      `${transition.cellKey}:p${transition.fromPage}->p${transition.toPage}`
    )),
    failingIsolatedFrameIds: failingFrameExcursions.map((frame) => (
      `${frame.cellKey}:p${frame.centerPage}`
    )),
  };
}

async function readManifest(root, config, errors) {
  const manifestPath = path.join(root, config.manifestPath);
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.id !== config.petId) errors.push(`manifest id must be ${config.petId}`);
    if (manifest.spriteVersionNumber !== 2) errors.push(`manifest spriteVersionNumber must be 2`);
    if (manifest.spritesheetPath !== "spritesheet.webp") {
      errors.push(`manifest spritesheetPath must be spritesheet.webp`);
    }
    return manifest;
  } catch (error) {
    errors.push(`manifest is missing or invalid: ${error.message}`);
    return null;
  }
}

function compactPageReport(page) {
  const { cells: _silhouetteCells, ...silhouette } = page.silhouette;
  const {
    actionToIdle: _actionToIdleTransitions,
    gazeEntry: _gazeEntryTransitions,
    timedRowPairs: _timedRowPairTransitions,
    gazeNeighborPairs: _gazeNeighborPairTransitions,
    gazeBodyPairs: _gazeBodyPairTransitions,
    ...samePhaseTransitions
  } = page.samePhaseTransitions;
  return {
    ...page,
    silhouette,
    samePhaseTransitions,
  };
}

export async function inspectAnimatedAtlas({ root = repositoryRoot, variant } = {}) {
  const config = VARIANTS[variant];
  if (!config) throw new Error(`Unknown variant ${JSON.stringify(variant)}; expected dark or light`);
  const errors = contractErrors();
  const atlasPath = path.join(root, config.atlasPath);
  const manifest = await readManifest(root, config, errors);
  let fileBytes = null;
  let atlasSha256 = null;
  let metadata = null;

  try {
    const file = await stat(atlasPath);
    fileBytes = file.size;
    atlasSha256 = await hashFile(atlasPath);
    if (fileBytes > MAX_ATLAS_BYTES) {
      errors.push(`atlas exceeds 20 MiB (${fileBytes} bytes)`);
    }
    metadata = await sharp(atlasPath, { animated: true, failOn: "error" }).metadata();
  } catch (error) {
    errors.push(`atlas is missing or unreadable: ${error.message}`);
  }

  const format = metadata?.format ?? null;
  const pageCount = metadata?.pages ?? (metadata ? 1 : 0);
  const pageHeight = metadata?.pageHeight ?? metadata?.height ?? null;
  const delays = metadata?.delay ?? [];
  if (metadata) {
    if (format !== "webp") errors.push(`atlas format must be WebP; received ${format}`);
    if (metadata.width !== ATLAS_WIDTH || pageHeight !== ATLAS_HEIGHT) {
      errors.push(`each page canvas must be ${ATLAS_WIDTH}x${ATLAS_HEIGHT}; received ${metadata.width}x${pageHeight}`);
    }
    if (pageCount !== FLUID_ATLAS_FRAME_COUNT) {
      errors.push(`atlas must contain exactly ${FLUID_ATLAS_FRAME_COUNT} pages; received ${pageCount}`);
    }
    if (metadata.loop !== 0) errors.push(`atlas loop must be 0; received ${metadata.loop}`);
    if (!arraysEqual(delays, EXPECTED_DELAYS)) {
      errors.push(`atlas delays must match the cumulative ${FLUID_ATLAS_LOOP_MS}ms schedule across ${FLUID_ATLAS_FRAME_COUNT} pages`);
    }
    if (metadata.hasAlpha !== true || metadata.channels !== 4) {
      errors.push(`atlas must preserve RGBA alpha; metadata reports ${metadata.channels} channels and hasAlpha=${metadata.hasAlpha}`);
    }
    if (metadata.pages && metadata.height !== pageHeight * pageCount) {
      errors.push(`animated stack height ${metadata.height} does not equal pageHeight x pages (${pageHeight * pageCount})`);
    }
  }

  const pages = [];
  const tracks = new Map(requiredCells().map((cell) => [cell.key, {
    ...cell,
    rgbaHashes: [],
    alphaHashes: [],
    internalDiffs: [],
    loopDiff: null,
    skipDiffs: Array.from({ length: FLUID_ATLAS_FRAME_COUNT }, () => null),
  }]));
  const displayed112Tracks = new Map(requiredCells().map((cell) => [cell.key, {
    ...cell,
    internalDiffs: [],
    loopDiff: null,
    skipDiffs: Array.from({ length: FLUID_ATLAS_FRAME_COUNT }, () => null),
    firstFrame: null,
    secondFrame: null,
    previousPreviousFrame: null,
    previousFrame: null,
  }]));
  const displayed112HostFrameCache = new Map(displayed112HostBoundaryCells().map((cell) => (
    [cell.key, []]
  )));
  let firstPixels = null;
  let secondPixels = null;
  let previousPreviousPixels = null;
  let previousPixels = null;
  const crossPhaseWindows = [];
  let inspectedPageCount = 0;
  const canDecode = metadata
    && metadata.width === ATLAS_WIDTH
    && pageHeight === ATLAS_HEIGHT
    && pageCount > 0
    && pageCount <= MAX_INSPECTABLE_PAGES;
  if (metadata && pageCount > MAX_INSPECTABLE_PAGES) {
    errors.push(`refusing to inspect unreasonable page count ${pageCount} (limit ${MAX_INSPECTABLE_PAGES})`);
  }

  if (canDecode) {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      let decoded;
      try {
        decoded = await sharp(atlasPath, {
          animated: true,
          failOn: "error",
          page: pageIndex,
          pages: 1,
          sequentialRead: true,
        }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      } catch (error) {
        errors.push(`page ${pageIndex} could not be decoded: ${error.message}`);
        break;
      }

      let page;
      try {
        page = inspectPage(variant, pageIndex, decoded.data, decoded.info);
      } catch (error) {
        errors.push(`page ${pageIndex} inspection failed: ${error.message}`);
        break;
      }
      pages.push(page);
      inspectedPageCount += 1;
      errors.push(...page.errors.map((error) => `page ${pageIndex}: ${error}`));

      if (previousPixels) {
        const crossPhase = inspectCrossPhaseTransitions(
          previousPixels,
          decoded.data,
          pageIndex - 1,
          pageIndex,
        );
        crossPhaseWindows.push(crossPhase);
        errors.push(...crossPhase.errors.map((error) => `cross-phase: ${error}`));
      }

      for (const cell of requiredCells()) {
        const inspectedCell = page.silhouette.cells.find(
          (candidate) => candidate.row === cell.row && candidate.column === cell.column,
        );
        const track = tracks.get(cell.key);
        track.rgbaHashes.push(page.requiredCellRgbaSha256[cell.key]);
        track.alphaHashes.push(inspectedCell.alphaSha256);
        if (previousPixels) {
          track.internalDiffs.push(compareCellPages(
            previousPixels,
            decoded.data,
            cell.column,
            cell.row,
            TEMPORAL_SURFACES[variant],
          ));
        }
        if (previousPreviousPixels) {
          track.skipDiffs[pageIndex - 1] = compareCellPages(
            previousPreviousPixels,
            decoded.data,
            cell.column,
            cell.row,
            TEMPORAL_SURFACES[variant],
          );
        }
        const displayedTrack = displayed112Tracks.get(cell.key);
        const displayedFrame = renderShippingHostFrame(
          decoded.data,
          cell.row,
          cell.column,
          SHIPPING_112_DISPLAY,
        );
        displayed112HostFrameCache.get(cell.key)?.push(displayedFrame);
        if (displayedTrack.previousFrame) {
          displayedTrack.internalDiffs.push(compareDisplayed112Frames(
            displayedTrack.previousFrame,
            displayedFrame,
            variant,
          ));
        }
        if (displayedTrack.previousPreviousFrame) {
          displayedTrack.skipDiffs[pageIndex - 1] = compareDisplayed112Frames(
            displayedTrack.previousPreviousFrame,
            displayedFrame,
            variant,
          );
        }
        if (pageIndex === 0) displayedTrack.firstFrame = displayedFrame;
        if (pageIndex === 1) displayedTrack.secondFrame = displayedFrame;
        displayedTrack.previousPreviousFrame = displayedTrack.previousFrame;
        displayedTrack.previousFrame = displayedFrame;
      }

      if (pageIndex === 0) firstPixels = decoded.data;
      if (pageIndex === 1) secondPixels = decoded.data;
      previousPreviousPixels = previousPixels;
      previousPixels = decoded.data;
    }
  }

  if (firstPixels && previousPixels && inspectedPageCount > 1) {
    const loopCrossPhase = inspectCrossPhaseTransitions(
      previousPixels,
      firstPixels,
      inspectedPageCount - 1,
      0,
    );
    crossPhaseWindows.push(loopCrossPhase);
    errors.push(...loopCrossPhase.errors.map((error) => `cross-phase: ${error}`));
    for (const cell of requiredCells()) {
      const track = tracks.get(cell.key);
      track.loopDiff = compareCellPages(
        previousPixels,
        firstPixels,
        cell.column,
        cell.row,
        TEMPORAL_SURFACES[variant],
      );
      if (previousPreviousPixels) {
        track.skipDiffs[inspectedPageCount - 1] = compareCellPages(
          previousPreviousPixels,
          firstPixels,
          cell.column,
          cell.row,
          TEMPORAL_SURFACES[variant],
        );
      }
      if (secondPixels) {
        track.skipDiffs[0] = compareCellPages(
          previousPixels,
          secondPixels,
          cell.column,
          cell.row,
          TEMPORAL_SURFACES[variant],
        );
      }
      const displayedTrack = displayed112Tracks.get(cell.key);
      if (displayedTrack.firstFrame && displayedTrack.previousFrame) {
        displayedTrack.loopDiff = compareDisplayed112Frames(
          displayedTrack.previousFrame,
          displayedTrack.firstFrame,
          variant,
        );
      }
      if (displayedTrack.previousPreviousFrame && displayedTrack.firstFrame) {
        displayedTrack.skipDiffs[inspectedPageCount - 1] = compareDisplayed112Frames(
          displayedTrack.previousPreviousFrame,
          displayedTrack.firstFrame,
          variant,
        );
      }
      if (displayedTrack.previousFrame && displayedTrack.secondFrame) {
        displayedTrack.skipDiffs[0] = compareDisplayed112Frames(
          displayedTrack.previousFrame,
          displayedTrack.secondFrame,
          variant,
        );
      }
    }
  }
  const temporalCells = finalizeTemporalTracks(tracks, inspectedPageCount, errors);
  const temporalAdjacency = summarizeTemporalAdjacency(temporalCells);
  const displayed112Cells = finalizeDisplayed112Tracks(
    displayed112Tracks,
    inspectedPageCount,
    errors,
  );
  const displayed112Temporal = summarizeDisplayed112Temporal(displayed112Cells);
  const temporalMotionCellCount = temporalCells.filter((cell) => cell.motionExists).length;
  const loopSafeCellCount = temporalCells.filter((cell) => cell.loopNotWorse).length;
  const idleTimelineCell = temporalCells.find((cell) => cell.row === 0 && cell.column === 0) ?? null;
  const idlePhaseIdenticalEveryPage = pages.length === FLUID_ATLAS_FRAME_COUNT
    && pages.every((page) => page.timedRows.find((row) => row.row === 0)?.identical === true);
  const timedRowPhaseIdentity = TIMED_ROWS.map((row) => {
    const identicalPhaseCount = pages.filter(
      (page) => page.timedRows.find((candidate) => candidate.row === row)?.identical === true,
    ).length;
    return {
      row,
      state: ROWS[row].id,
      inspectedPhases: pages.length,
      identicalPhaseCount,
      allPhasesIdentical: pages.length === FLUID_ATLAS_FRAME_COUNT
        && identicalPhaseCount === FLUID_ATLAS_FRAME_COUNT,
    };
  });
  const actionToIdleTransitions = pages.flatMap((page) => page.samePhaseTransitions.actionToIdle);
  const gazeEntryTransitions = pages.flatMap((page) => page.samePhaseTransitions.gazeEntry);
  const timedRowPairTransitions = pages.flatMap((page) => page.samePhaseTransitions.timedRowPairs);
  const gazeNeighborPairTransitions = pages.flatMap(
    (page) => page.samePhaseTransitions.gazeNeighborPairs,
  );
  const gazeBodyPairTransitions = pages.flatMap((page) => page.samePhaseTransitions.gazeBodyPairs);
  const gazeBodyPhaseStability = analyzeGazeBodyPhaseTransitions(gazeBodyPairTransitions);
  const expectedActionToIdleTransitionCount = FLUID_ATLAS_FRAME_COUNT * ACTION_ROWS.length;
  const expectedGazeEntryTransitionCount = FLUID_ATLAS_FRAME_COUNT * TIMED_ROWS.length * 16;
  const expectedTimedRowPairTransitionCount = FLUID_ATLAS_FRAME_COUNT
    * TIMED_ROWS.length * (TIMED_ROWS.length - 1) / 2;
  const expectedGazeNeighborPairTransitionCount = FLUID_ATLAS_FRAME_COUNT * 16;
  const expectedGazeBodyPairTransitionCount = FLUID_ATLAS_FRAME_COUNT * 16 * 15 / 2;
  const crossPhaseTimedRowChanges = crossPhaseWindows.flatMap(
    (window) => window.timedRowChanges,
  );
  const crossPhaseGazeNeighborChanges = crossPhaseWindows.flatMap(
    (window) => window.gazeNeighborChanges,
  );
  const crossPhaseGazeTimedBoundaries = crossPhaseWindows.flatMap(
    (window) => window.gazeTimedBoundaries,
  );
  const crossPhaseGazeToTimed = crossPhaseWindows.flatMap((window) => window.gazeToTimed);
  const crossPhaseEligibleTimedToGaze = crossPhaseWindows.flatMap(
    (window) => window.eligibleTimedToGaze,
  );
  const crossPhaseGazeBodyNonNeighborChanges = crossPhaseWindows.flatMap(
    (window) => window.gazeBodyNonNeighborChanges,
  );
  const crossPhaseGazeBodyPhaseStability = analyzeGazeBodyPhaseTransitions(
    crossPhaseGazeBodyNonNeighborChanges.map((transition) => ({
      ...transition,
      page: transition.fromPage,
    })),
    { gate: GAZE_BODY_CROSS_PHASE_STABILITY_GATE },
  );
  const expectedCrossPhaseWindowCount = FLUID_ATLAS_FRAME_COUNT;
  const expectedCrossPhaseTimedRowChangeCount = FLUID_ATLAS_FRAME_COUNT
    * TIMED_ROWS.length * (TIMED_ROWS.length - 1);
  const expectedCrossPhaseGazeNeighborChangeCount = FLUID_ATLAS_FRAME_COUNT * 16 * 2;
  const expectedCrossPhaseGazeTimedBoundaryCount = FLUID_ATLAS_FRAME_COUNT
    * (16 * TIMED_ROWS.length + GAZE_ELIGIBLE_ROWS.length * 16);
  const expectedCrossPhaseGazeToTimedCount = FLUID_ATLAS_FRAME_COUNT
    * 16 * TIMED_ROWS.length;
  const expectedCrossPhaseEligibleTimedToGazeCount = FLUID_ATLAS_FRAME_COUNT
    * GAZE_ELIGIBLE_ROWS.length * 16;
  const expectedCrossPhaseGazeBodyNonNeighborCount = FLUID_ATLAS_FRAME_COUNT * 16 * 13;
  const displayed112HostBoundaries = buildDisplayed112HostBoundaryReport({
    pages,
    crossPhaseWindows,
    frameCache: displayed112HostFrameCache,
    variant,
    errors,
  });
  const sourceHostBoundaries = buildSourceHostBoundaryReport({
    pages,
    crossPhaseWindows,
    gazeBodyPhaseStability,
    crossPhaseGazeBodyPhaseStability,
    errors,
  });
  if (actionToIdleTransitions.length !== expectedActionToIdleTransitionCount) {
    errors.push(
      `same-phase action-to-idle coverage is ${actionToIdleTransitions.length}/${expectedActionToIdleTransitionCount}`,
    );
  }
  if (gazeEntryTransitions.length !== expectedGazeEntryTransitionCount) {
    errors.push(`same-phase gaze-entry coverage is ${gazeEntryTransitions.length}/${expectedGazeEntryTransitionCount}`);
  }
  if (timedRowPairTransitions.length !== expectedTimedRowPairTransitionCount) {
    errors.push(
      `same-phase timed-row pair coverage is ${timedRowPairTransitions.length}/`
      + `${expectedTimedRowPairTransitionCount}`,
    );
  }
  if (gazeNeighborPairTransitions.length !== expectedGazeNeighborPairTransitionCount) {
    errors.push(
      `same-phase adjacent gaze-sector coverage is ${gazeNeighborPairTransitions.length}/`
      + `${expectedGazeNeighborPairTransitionCount}`,
    );
  }
  if (gazeBodyPairTransitions.length !== expectedGazeBodyPairTransitionCount) {
    errors.push(
      `same-phase gaze body-stability coverage is ${gazeBodyPairTransitions.length}/`
      + `${expectedGazeBodyPairTransitionCount}`,
    );
  }
  if (!pages.every((page) => page.samePhaseTransitions.membership.ok)) {
    errors.push("same-phase host transition ID membership is incomplete or duplicated");
  }
  if (!gazeBodyPhaseStability.ok) {
    errors.push(
      `gaze body pair phase stability failed for ${gazeBodyPhaseStability.failingPairCount}/`
      + `${gazeBodyPhaseStability.pairCount} pairs: `
      + gazeBodyPhaseStability.failingPairKeys.slice(0, 8).join(", "),
    );
  }
  if (crossPhaseWindows.length !== expectedCrossPhaseWindowCount) {
    errors.push(
      `cross-phase window coverage is ${crossPhaseWindows.length}/${expectedCrossPhaseWindowCount}`,
    );
  }
  if (crossPhaseTimedRowChanges.length !== expectedCrossPhaseTimedRowChangeCount) {
    errors.push(
      `cross-phase timed-row change coverage is ${crossPhaseTimedRowChanges.length}/`
      + `${expectedCrossPhaseTimedRowChangeCount}`,
    );
  }
  if (crossPhaseGazeNeighborChanges.length !== expectedCrossPhaseGazeNeighborChangeCount) {
    errors.push(
      `cross-phase adjacent gaze-sector coverage is ${crossPhaseGazeNeighborChanges.length}/`
      + `${expectedCrossPhaseGazeNeighborChangeCount}`,
    );
  }
  if (crossPhaseGazeTimedBoundaries.length !== expectedCrossPhaseGazeTimedBoundaryCount) {
    errors.push(
      `cross-phase gaze/timed boundary coverage is ${crossPhaseGazeTimedBoundaries.length}/`
      + `${expectedCrossPhaseGazeTimedBoundaryCount}`,
    );
  }
  if (crossPhaseGazeToTimed.length !== expectedCrossPhaseGazeToTimedCount) {
    errors.push(
      `cross-phase gaze-to-timed coverage is ${crossPhaseGazeToTimed.length}/`
      + `${expectedCrossPhaseGazeToTimedCount}`,
    );
  }
  if (crossPhaseEligibleTimedToGaze.length !== expectedCrossPhaseEligibleTimedToGazeCount) {
    errors.push(
      `cross-phase eligible-timed-to-gaze coverage is ${crossPhaseEligibleTimedToGaze.length}/`
      + `${expectedCrossPhaseEligibleTimedToGazeCount}`,
    );
  }
  if (
    crossPhaseGazeBodyNonNeighborChanges.length
    !== expectedCrossPhaseGazeBodyNonNeighborCount
  ) {
    errors.push(
      `cross-phase non-neighbor gaze body coverage is `
      + `${crossPhaseGazeBodyNonNeighborChanges.length}/`
      + `${expectedCrossPhaseGazeBodyNonNeighborCount}`,
    );
  }
  if (!crossPhaseWindows.every((window) => window.membership.ok)) {
    errors.push("cross-phase host transition ID membership is incomplete or duplicated");
  }
  if (!crossPhaseGazeBodyPhaseStability.ok) {
    errors.push(
      `cross-phase non-neighbor gaze body phase stability failed for `
      + `${crossPhaseGazeBodyPhaseStability.failingPairCount}/`
      + `${crossPhaseGazeBodyPhaseStability.pairCount} pairs`,
    );
  }
  if (temporalMotionCellCount !== REQUIRED_CELL_COUNT) {
    errors.push(`temporal motion exists in ${temporalMotionCellCount}/${REQUIRED_CELL_COUNT} reachable cells`);
  }
  if (loopSafeCellCount !== REQUIRED_CELL_COUNT) {
    errors.push(`loop adjacency is safe in ${loopSafeCellCount}/${REQUIRED_CELL_COUNT} reachable cells`);
  }
  if (!temporalAdjacency.completeCoverage) {
    errors.push("temporal adjacency or isolated-frame coverage is incomplete");
  }
  if (temporalAdjacency.transitionCount !== REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT) {
    errors.push(
      `temporal transition coverage is ${temporalAdjacency.transitionCount}/`
      + `${REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT}`,
    );
  }
  if (temporalAdjacency.upperBoundSafeCellCount !== REQUIRED_CELL_COUNT) {
    errors.push(
      `temporal upper-bound safety passes in ${temporalAdjacency.upperBoundSafeCellCount}/`
      + `${REQUIRED_CELL_COUNT} reachable cells`,
    );
  }
  if (
    temporalAdjacency.failingTransitionCount !== 0
    || temporalAdjacency.failingIsolatedFrameCount !== 0
  ) {
    errors.push(
      `temporal gate found ${temporalAdjacency.failingTransitionCount} failing adjacency transition(s) `
      + `and ${temporalAdjacency.failingIsolatedFrameCount} isolated-frame excursion(s)`,
    );
  }

  return {
    schemaVersion: 1,
    variant,
    petId: config.petId,
    ok: errors.length === 0,
    contract: {
      spriteVersionNumber: 2,
      pageCanvas: { width: 1536, height: 2288 },
      frameCount: FLUID_ATLAS_FRAME_COUNT,
      frameDelaysMs: EXPECTED_DELAYS,
      loopDurationMs: FLUID_ATLAS_LOOP_MS,
      loop: 0,
      maxBytes: MAX_ATLAS_BYTES,
      safetyGutterPx: SAFETY_GUTTER_PX,
      requiredColumnsByRow: REQUIRED_COLUMNS_BY_ROW,
      requiredCellCount: REQUIRED_CELL_COUNT,
      unusedCellCount: UNUSED_CELL_COUNT,
      temporalMotion: TEMPORAL_MOTION_GATE,
      temporalAdjacencyUpperBounds: ANIMATED_TEMPORAL_ADJACENCY_GATE,
      temporalRowUpperBounds: ANIMATED_TEMPORAL_ROW_GATES,
      displayed112TemporalUpperBounds: ANIMATED_112_TEMPORAL_GATE,
      displayed112TemporalRowUpperBounds: ANIMATED_112_TEMPORAL_ROW_GATES,
      displayed112Sampling: SHIPPING_112_DISPLAY,
      displayed112HostBoundaryGates: DISPLAYED_112_HOST_BOUNDARY_GATES,
      displayed112HostGazeBodyPhaseStabilityGate:
        DISPLAYED_112_GAZE_BODY_PHASE_STABILITY_GATE,
      displayed112HostGazeBodyCrossPhaseStabilityGate:
        DISPLAYED_112_GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
      samePhaseTransitionGates: SAME_PHASE_TRANSITION_GATES,
      gazeBodyPhaseStabilityGate: GAZE_BODY_PHASE_STABILITY_GATE,
      gazeBodyCrossPhaseStabilityGate: GAZE_BODY_CROSS_PHASE_STABILITY_GATE,
    },
    manifest,
    atlas: {
      path: config.atlasPath,
      bytes: fileBytes,
      within20MiB: fileBytes != null && fileBytes <= MAX_ATLAS_BYTES,
      sha256: atlasSha256,
      format,
      width: metadata?.width ?? null,
      stackedHeight: metadata?.height ?? null,
      pageHeight,
      pages: pageCount,
      loop: metadata?.loop ?? null,
      delaysMs: delays,
      channels: metadata?.channels ?? null,
      hasAlpha: metadata?.hasAlpha ?? false,
    },
    inspectedPageCount,
    pages: pages.map(compactPageReport),
    temporal: {
      reachableCellCount: REQUIRED_CELL_COUNT,
      motionCellCount: temporalMotionCellCount,
      loopSafeCellCount,
      transitionCount: temporalAdjacency.transitionCount,
      internalTransitionCount: temporalAdjacency.internalTransitionCount,
      loopSeamCount: temporalAdjacency.loopSeamCount,
      isolatedFrameCount: temporalAdjacency.isolatedFrameCount,
      upperBoundSafeCellCount: temporalAdjacency.upperBoundSafeCellCount,
      adjacencyUpperBounds: temporalAdjacency,
      cells: temporalCells,
    },
    displayedTemporal112: displayed112Temporal,
    sourceHostBoundaries,
    displayed112HostBoundaries,
    timedRowPhaseIdentity,
    idleTimeline: {
      continuousRowWideTimeline: true,
      phaseIdenticalEveryPage: idlePhaseIdenticalEveryPage,
      inspectedPhases: inspectedPageCount,
      distinctRgbaFrameCount: idleTimelineCell?.distinctRgbaFrameCount ?? 0,
      distinctAlphaFrameCount: idleTimelineCell?.distinctAlphaFrameCount ?? 0,
      motionExists: idleTimelineCell?.motionExists ?? false,
      internalAdjacency: idleTimelineCell?.internalAdjacency ?? null,
      loopAdjacency: idleTimelineCell?.loopAdjacency ?? null,
      loopNotWorse: idleTimelineCell?.loopNotWorse ?? false,
    },
    samePhaseTransitions: {
      ok: actionToIdleTransitions.length === expectedActionToIdleTransitionCount
        && gazeEntryTransitions.length === expectedGazeEntryTransitionCount
        && timedRowPairTransitions.length === expectedTimedRowPairTransitionCount
        && gazeNeighborPairTransitions.length === expectedGazeNeighborPairTransitionCount
        && gazeBodyPairTransitions.length === expectedGazeBodyPairTransitionCount
        && actionToIdleTransitions.every((transition) => transition.validation.ok)
        && gazeEntryTransitions.every((transition) => transition.validation.ok)
        && timedRowPairTransitions.every((transition) => transition.validation.ok)
        && gazeNeighborPairTransitions.every((transition) => transition.validation.ok)
        && gazeBodyPairTransitions.every((transition) => transition.validation.ok)
        && pages.every((page) => page.samePhaseTransitions.membership.ok)
        && gazeBodyPhaseStability.ok,
      gates: SAME_PHASE_TRANSITION_GATES,
      actionToIdle: summarizeSamePhaseTransitions(actionToIdleTransitions),
      gazeEntry: summarizeSamePhaseTransitions(gazeEntryTransitions),
      timedRowPairs: summarizeSamePhaseTransitions(timedRowPairTransitions),
      gazeNeighborPairs: summarizeSamePhaseTransitions(gazeNeighborPairTransitions),
      gazeBodyPairs: {
        ...summarizeSamePhaseTransitions(gazeBodyPairTransitions),
        phaseStability: gazeBodyPhaseStability,
      },
      membership: {
        ok: pages.every((page) => page.samePhaseTransitions.membership.ok),
        phaseCount: pages.length,
        phases: pages.map((page) => ({
          page: page.index,
          ...page.samePhaseTransitions.membership,
        })),
      },
      failedTransitionIds: [
        ...actionToIdleTransitions,
        ...gazeEntryTransitions,
        ...timedRowPairTransitions,
        ...gazeNeighborPairTransitions,
        ...gazeBodyPairTransitions,
      ]
        .filter((transition) => !transition.validation.ok)
        .map((transition) => transition.id),
    },
    crossPhaseTransitions: {
      ok: crossPhaseWindows.length === expectedCrossPhaseWindowCount
        && crossPhaseTimedRowChanges.length === expectedCrossPhaseTimedRowChangeCount
        && crossPhaseGazeNeighborChanges.length === expectedCrossPhaseGazeNeighborChangeCount
        && crossPhaseGazeTimedBoundaries.length === expectedCrossPhaseGazeTimedBoundaryCount
        && crossPhaseGazeToTimed.length === expectedCrossPhaseGazeToTimedCount
        && crossPhaseEligibleTimedToGaze.length === expectedCrossPhaseEligibleTimedToGazeCount
        && crossPhaseGazeBodyNonNeighborChanges.length
          === expectedCrossPhaseGazeBodyNonNeighborCount
        && crossPhaseTimedRowChanges.every((transition) => transition.validation.ok)
        && crossPhaseGazeNeighborChanges.every((transition) => transition.validation.ok)
        && crossPhaseGazeTimedBoundaries.every((transition) => transition.validation.ok)
        && crossPhaseWindows.every((window) => window.membership.ok)
        && crossPhaseGazeBodyPhaseStability.ok,
      gates: SAME_PHASE_TRANSITION_GATES,
      phaseWindowCount: crossPhaseWindows.length,
      loopSeamWindowCount: crossPhaseWindows.filter(({ seam }) => seam).length,
      timedRowChanges: {
        ...summarizeSamePhaseTransitions(crossPhaseTimedRowChanges),
        transitions: crossPhaseTimedRowChanges,
      },
      gazeNeighborChanges: {
        ...summarizeSamePhaseTransitions(crossPhaseGazeNeighborChanges),
        transitions: crossPhaseGazeNeighborChanges,
      },
      gazeTimedBoundaries: {
        ...summarizeSamePhaseTransitions(crossPhaseGazeTimedBoundaries),
        gazeToTimedCount: crossPhaseGazeToTimed.length,
        eligibleTimedToGazeCount: crossPhaseEligibleTimedToGaze.length,
        transitions: crossPhaseGazeTimedBoundaries,
      },
      gazeBodyNonNeighborChanges: {
        ...summarizeSamePhaseTransitions(crossPhaseGazeBodyNonNeighborChanges),
        phaseStability: crossPhaseGazeBodyPhaseStability,
      },
      membership: {
        ok: crossPhaseWindows.every((window) => window.membership.ok),
        windowCount: crossPhaseWindows.length,
        windows: crossPhaseWindows.map((window) => ({
          fromPage: window.fromPage,
          toPage: window.toPage,
          seam: window.seam,
          ...window.membership,
        })),
      },
      failedTransitionIds: [
        ...crossPhaseTimedRowChanges,
        ...crossPhaseGazeNeighborChanges,
        ...crossPhaseGazeTimedBoundaries,
      ].filter((transition) => !transition.validation.ok).map((transition) => transition.id),
    },
    errors,
  };
}

function comparePaletteCategory(darkPage, lightPage, category) {
  const dark = darkPage?.palette.categories[category];
  const light = lightPage?.palette.categories[category];
  return {
    category,
    darkRgb: dark?.rgb ?? null,
    lightRgb: light?.rgb ?? null,
    darkExactPixels: dark?.exactPixels ?? null,
    lightExactPixels: light?.exactPixels ?? null,
    countsEqual: dark != null && light != null && dark.exactPixels === light.exactPixels,
    masksEqual: dark != null && light != null && dark.maskSha256 === light.maskSha256,
    darkMaskSha256: dark?.maskSha256 ?? null,
    lightMaskSha256: light?.maskSha256 ?? null,
  };
}

async function inspectCrossThemePixels(root, pageIndex) {
  const decoded = {};
  for (const variant of ["dark", "light"]) {
    const atlasPath = path.join(root, VARIANTS[variant].atlasPath);
    decoded[variant] = await sharp(atlasPath, {
      animated: true,
      failOn: "error",
      page: pageIndex,
      pages: 1,
      sequentialRead: true,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (
      decoded[variant].info.width !== ATLAS_WIDTH
      || decoded[variant].info.height !== ATLAS_HEIGHT
      || decoded[variant].info.channels !== 4
    ) {
      throw new Error(
        `${variant} page ${pageIndex} did not decode as ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA`,
      );
    }
  }

  const pixelCount = ATLAS_WIDTH * ATLAS_HEIGHT;
  const darkPalette = paletteContract("dark");
  const lightPalette = paletteContract("light");
  const relationCodes = Buffer.allocUnsafe(pixelCount);
  const counts = {
    transparentPair: 0,
    sameColorPair: 0,
    inverseColorPair: 0,
    allowedCompositedPair: 0,
    unclassifiedPair: 0,
    alphaMismatchPair: 0,
    bodyRoleMismatchPair: 0,
    featureRoleMismatchPair: 0,
    accentRoleMismatchPair: 0,
    anyPaletteRoleMismatchPair: 0,
  };
  let maximumChannelDeltaSpread = 0;
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    const darkAlpha = decoded.dark.data[offset + 3];
    const lightAlpha = decoded.light.data[offset + 3];
    if (darkAlpha === 0 && lightAlpha === 0) {
      counts.transparentPair += 1;
      relationCodes[pixel] = 0;
      continue;
    }
    if (darkAlpha !== lightAlpha) {
      counts.alphaMismatchPair += 1;
      relationCodes[pixel] = 4;
      continue;
    }

    const darkRed = decoded.dark.data[offset];
    const darkGreen = decoded.dark.data[offset + 1];
    const darkBlue = decoded.dark.data[offset + 2];
    const lightRed = decoded.light.data[offset];
    const lightGreen = decoded.light.data[offset + 1];
    const lightBlue = decoded.light.data[offset + 2];
    const bodyRoleMismatch = rgbEqual(darkRed, darkGreen, darkBlue, darkPalette.body)
      !== rgbEqual(lightRed, lightGreen, lightBlue, lightPalette.body);
    const featureRoleMismatch = rgbEqual(darkRed, darkGreen, darkBlue, darkPalette.feature)
      !== rgbEqual(lightRed, lightGreen, lightBlue, lightPalette.feature);
    const accentRoleMismatch = ACCENT_KEYS.some((key) =>
      rgbEqual(darkRed, darkGreen, darkBlue, darkPalette.accents[key])
      !== rgbEqual(lightRed, lightGreen, lightBlue, lightPalette.accents[key]));
    if (bodyRoleMismatch) counts.bodyRoleMismatchPair += 1;
    if (featureRoleMismatch) counts.featureRoleMismatchPair += 1;
    if (accentRoleMismatch) counts.accentRoleMismatchPair += 1;
    if (bodyRoleMismatch || featureRoleMismatch || accentRoleMismatch) {
      counts.anyPaletteRoleMismatchPair += 1;
    }
    if (darkRed === lightRed && darkGreen === lightGreen && darkBlue === lightBlue) {
      counts.sameColorPair += 1;
      relationCodes[pixel] = 1;
      continue;
    }
    if (darkRed + lightRed === 255 && darkGreen + lightGreen === 255 && darkBlue + lightBlue === 255) {
      counts.inverseColorPair += 1;
      relationCodes[pixel] = 2;
      continue;
    }

    // Replacing monochrome black/white layers while preserving an accent layer
    // changes all three channels by the same amount. Permit three quantization
    // levels of spread for SVG raster/composite rounding, but account for every
    // visible pixel rather than considering only exact palette samples.
    const channelDeltas = [
      darkRed - lightRed,
      darkGreen - lightGreen,
      darkBlue - lightBlue,
    ];
    const spread = Math.max(...channelDeltas) - Math.min(...channelDeltas);
    maximumChannelDeltaSpread = Math.max(maximumChannelDeltaSpread, spread);
    if (spread <= THEME_RELATION_CHANNEL_TOLERANCE) {
      counts.allowedCompositedPair += 1;
      relationCodes[pixel] = 3;
    } else {
      counts.unclassifiedPair += 1;
      relationCodes[pixel] = 5;
    }
  }

  const visiblePairCount = pixelCount - counts.transparentPair;
  const unclassifiedVisiblePairFraction = visiblePairCount > 0
    ? counts.unclassifiedPair / visiblePairCount
    : 0;
  const paletteRoleMismatchVisiblePairFraction = visiblePairCount > 0
    ? counts.anyPaletteRoleMismatchPair / visiblePairCount
    : 0;

  return {
    ok: counts.alphaMismatchPair === 0
      && unclassifiedVisiblePairFraction <= MAX_UNCLASSIFIED_VISIBLE_PAIR_FRACTION
      && paletteRoleMismatchVisiblePairFraction <= MAX_PALETTE_ROLE_MISMATCH_VISIBLE_PAIR_FRACTION,
    gate: {
      maximumChannelDeltaSpreadForAllowedComposite: THEME_RELATION_CHANNEL_TOLERANCE,
      maximumUnclassifiedVisiblePairFraction: MAX_UNCLASSIFIED_VISIBLE_PAIR_FRACTION,
      maximumPaletteRoleMismatchVisiblePairFraction: MAX_PALETTE_ROLE_MISMATCH_VISIBLE_PAIR_FRACTION,
    },
    counts,
    visiblePairCount,
    unclassifiedVisiblePairFraction: round(unclassifiedVisiblePairFraction),
    paletteRoleMismatchVisiblePairFraction: round(paletteRoleMismatchVisiblePairFraction),
    maximumObservedChannelDeltaSpread: maximumChannelDeltaSpread,
    relationSha256: sha256(relationCodes),
  };
}

async function compareThemes(dark, light, root) {
  const errors = [];
  const pageCountEqual = dark.atlas.pages === light.atlas.pages;
  const delaysEqual = arraysEqual(dark.atlas.delaysMs, light.atlas.delaysMs);
  const completePageInspection = dark.inspectedPageCount === FLUID_ATLAS_FRAME_COUNT
    && light.inspectedPageCount === FLUID_ATLAS_FRAME_COUNT;
  const darkGazeBodyPairSha = dark.samePhaseTransitions?.gazeBodyPairs?.phaseStability
    ?.canonicalPairSequenceSha256;
  const lightGazeBodyPairSha = light.samePhaseTransitions?.gazeBodyPairs?.phaseStability
    ?.canonicalPairSequenceSha256;
  const gazeBodyPairPhaseParity = validSha256(darkGazeBodyPairSha)
    && validSha256(lightGazeBodyPairSha)
    && darkGazeBodyPairSha === lightGazeBodyPairSha;
  const darkCrossPhaseGazeBodySha = dark.crossPhaseTransitions?.gazeBodyNonNeighborChanges
    ?.phaseStability?.canonicalPairSequenceSha256;
  const lightCrossPhaseGazeBodySha = light.crossPhaseTransitions?.gazeBodyNonNeighborChanges
    ?.phaseStability?.canonicalPairSequenceSha256;
  const crossPhaseGazeBodyPairPhaseParity = validSha256(darkCrossPhaseGazeBodySha)
    && validSha256(lightCrossPhaseGazeBodySha)
    && darkCrossPhaseGazeBodySha === lightCrossPhaseGazeBodySha;
  const darkSourceHostSha = dark.sourceHostBoundaries
    ?.canonicalAlphaSilhouetteSequenceSha256;
  const lightSourceHostSha = light.sourceHostBoundaries
    ?.canonicalAlphaSilhouetteSequenceSha256;
  const sourceHostBoundaryParity = validSha256(darkSourceHostSha)
    && validSha256(lightSourceHostSha)
    && darkSourceHostSha === lightSourceHostSha;
  const darkDisplayedHostSha = dark.displayed112HostBoundaries
    ?.canonicalAlphaSilhouetteSequenceSha256;
  const lightDisplayedHostSha = light.displayed112HostBoundaries
    ?.canonicalAlphaSilhouetteSequenceSha256;
  const displayed112HostBoundaryParity = validSha256(darkDisplayedHostSha)
    && validSha256(lightDisplayedHostSha)
    && darkDisplayedHostSha === lightDisplayedHostSha;
  const darkDisplayedSamePairSha = dark.displayed112HostBoundaries?.supplemental
    ?.samePhaseNonNeighborGaze?.phaseStability?.canonicalPairSequenceSha256;
  const lightDisplayedSamePairSha = light.displayed112HostBoundaries?.supplemental
    ?.samePhaseNonNeighborGaze?.phaseStability?.canonicalPairSequenceSha256;
  const displayed112HostSamePhaseGazeBodyParity = validSha256(darkDisplayedSamePairSha)
    && validSha256(lightDisplayedSamePairSha)
    && darkDisplayedSamePairSha === lightDisplayedSamePairSha;
  const darkDisplayedCrossPairSha = dark.displayed112HostBoundaries?.supplemental
    ?.crossPhaseNonNeighborGaze?.phaseStability?.canonicalPairSequenceSha256;
  const lightDisplayedCrossPairSha = light.displayed112HostBoundaries?.supplemental
    ?.crossPhaseNonNeighborGaze?.phaseStability?.canonicalPairSequenceSha256;
  const displayed112HostCrossPhaseGazeBodyParity = validSha256(darkDisplayedCrossPairSha)
    && validSha256(lightDisplayedCrossPairSha)
    && darkDisplayedCrossPairSha === lightDisplayedCrossPairSha;
  if (!pageCountEqual) errors.push(`dark/light page counts differ (${dark.atlas.pages} vs ${light.atlas.pages})`);
  if (!delaysEqual) errors.push("dark/light delay arrays differ");
  if (!completePageInspection) {
    errors.push(
      `cross-theme parity requires ${FLUID_ATLAS_FRAME_COUNT} inspected pages per variant; `
      + `received dark=${dark.inspectedPageCount}, light=${light.inspectedPageCount}`,
    );
  }
  if (!gazeBodyPairPhaseParity) {
    errors.push("dark/light gaze body pair phase-stability sequences differ");
  }
  if (!crossPhaseGazeBodyPairPhaseParity) {
    errors.push("dark/light cross-phase gaze body pair phase-stability sequences differ");
  }
  if (!sourceHostBoundaryParity) {
    errors.push("dark/light source-cell host-boundary alpha/silhouette sequences differ");
  }
  if (!displayed112HostBoundaryParity) {
    errors.push("dark/light exact default-fallback host-boundary alpha/silhouette sequences differ");
  }
  if (!displayed112HostSamePhaseGazeBodyParity) {
    errors.push("dark/light exact default-fallback same-phase gaze/body sequences differ");
  }
  if (!displayed112HostCrossPhaseGazeBodyParity) {
    errors.push("dark/light exact default-fallback cross-phase gaze/body sequences differ");
  }

  const pageCount = Math.max(dark.pages.length, light.pages.length);
  const pages = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const darkPage = dark.pages[pageIndex];
    const lightPage = light.pages[pageIndex];
    if (!darkPage || !lightPage) {
      errors.push(`cross-theme page ${pageIndex} is missing from ${darkPage ? "light" : "dark"}`);
      pages.push({ index: pageIndex, ok: false, missingVariant: darkPage ? "light" : "dark" });
      continue;
    }

    const visibleMasksEqual = darkPage.visibleMaskSha256 === lightPage.visibleMaskSha256;
    const alphaValuesEqual = darkPage.alphaSha256 === lightPage.alphaSha256;
    const silhouetteMetricsEqual = darkPage.silhouette.sha256 === lightPage.silhouette.sha256;
    const body = comparePaletteCategory(darkPage, lightPage, "body");
    const feature = comparePaletteCategory(darkPage, lightPage, "feature");
    const accents = ACCENT_KEYS.map((key) => comparePaletteCategory(darkPage, lightPage, key));
    const unclassified = comparePaletteCategory(darkPage, lightPage, "unclassified");
    const bodyInversionExact = body.countsEqual && body.masksEqual;
    const featureInversionExact = feature.countsEqual && feature.masksEqual;
    const accentsExact = accents.every((accent) => accent.countsEqual && accent.masksEqual);
    const unclassifiedMasksEqual = unclassified.countsEqual && unclassified.masksEqual;
    const canonicalPaletteClassesEqual = darkPage.palette.canonicalClassificationSha256
      === lightPage.palette.canonicalClassificationSha256;
    let fullPixelThemeRelation;
    try {
      fullPixelThemeRelation = await inspectCrossThemePixels(root, pageIndex);
    } catch (error) {
      fullPixelThemeRelation = { ok: false, error: error.message };
    }
    const ok = visibleMasksEqual
      && alphaValuesEqual
      && silhouetteMetricsEqual
      && fullPixelThemeRelation.ok;

    if (!visibleMasksEqual) errors.push(`page ${pageIndex} dark/light visible alpha masks differ`);
    if (!alphaValuesEqual) errors.push(`page ${pageIndex} dark/light alpha values differ`);
    if (!silhouetteMetricsEqual) errors.push(`page ${pageIndex} dark/light silhouette metrics differ`);
    if (!fullPixelThemeRelation.ok) errors.push(`page ${pageIndex} full-pixel theme relation failed`);

    pages.push({
      index: pageIndex,
      ok,
      visibleMasksEqual,
      alphaValuesEqual,
      silhouetteMetricsEqual,
      darkAlphaSha256: darkPage.alphaSha256,
      lightAlphaSha256: lightPage.alphaSha256,
      darkVisibleMaskSha256: darkPage.visibleMaskSha256,
      lightVisibleMaskSha256: lightPage.visibleMaskSha256,
      darkSilhouetteSha256: darkPage.silhouette.sha256,
      lightSilhouetteSha256: lightPage.silhouette.sha256,
      bodyInversionExact,
      featureInversionExact,
      accentsExact,
      unclassifiedMasksEqual,
      fullPixelThemeRelation,
      canonicalPaletteClassesEqual,
      darkCanonicalPaletteSha256: darkPage.palette.canonicalClassificationSha256,
      lightCanonicalPaletteSha256: lightPage.palette.canonicalClassificationSha256,
      body,
      feature,
      accents,
      unclassified,
    });
  }

  return {
    ok: errors.length === 0,
    pageCountEqual,
    delaysEqual,
    completePageInspection,
    identicalPerPageAlphaMasks: pages.length === FLUID_ATLAS_FRAME_COUNT
      && pages.every((page) => page.visibleMasksEqual && page.alphaValuesEqual),
    identicalPerPageSilhouetteMetrics: pages.length === FLUID_ATLAS_FRAME_COUNT
      && pages.every((page) => page.silhouetteMetricsEqual),
    exactBodyFeatureInversion: pages.length === FLUID_ATLAS_FRAME_COUNT
      && pages.every((page) => page.bodyInversionExact && page.featureInversionExact),
    identicalExactAccentMasks: pages.length === FLUID_ATLAS_FRAME_COUNT
      && pages.every((page) => page.accentsExact),
    exhaustiveVisiblePairClassification: pages.length === FLUID_ATLAS_FRAME_COUNT
      && pages.every((page) => page.fullPixelThemeRelation?.ok),
    gazeBodyPairPhaseParity,
    gazeBodyPairPhaseSha256: gazeBodyPairPhaseParity ? darkGazeBodyPairSha : null,
    crossPhaseGazeBodyPairPhaseParity,
    crossPhaseGazeBodyPairPhaseSha256: crossPhaseGazeBodyPairPhaseParity
      ? darkCrossPhaseGazeBodySha
      : null,
    sourceHostBoundaryParity,
    sourceHostBoundaryAlphaSilhouetteSha256: sourceHostBoundaryParity
      ? darkSourceHostSha
      : null,
    displayed112HostBoundaryParity,
    displayed112HostBoundaryAlphaSilhouetteSha256: displayed112HostBoundaryParity
      ? darkDisplayedHostSha
      : null,
    displayed112HostSamePhaseGazeBodyParity,
    displayed112HostSamePhaseGazeBodySha256: displayed112HostSamePhaseGazeBodyParity
      ? darkDisplayedSamePairSha
      : null,
    displayed112HostCrossPhaseGazeBodyParity,
    displayed112HostCrossPhaseGazeBodySha256: displayed112HostCrossPhaseGazeBodyParity
      ? darkDisplayedCrossPairSha
      : null,
    pages,
    errors,
  };
}

function compactVariant(report) {
  return {
    ok: report.ok,
    reportPath: `qa/animated-atlas-${report.variant}.json`,
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

export async function validateAnimatedAtlases({
  root = repositoryRoot,
  includeTemporalArtifacts = true,
} = {}) {
  // Intentionally await variants sequentially. Each inspector retains only the
  // 25 host-reachable timed/gaze cells at the exact 7.04rem/DPR2 browser map across
  // 60 phases (~314 MiB), rather than either full decoded atlas stack.
  const dark = await inspectAnimatedAtlas({ root, variant: "dark" });
  const light = await inspectAnimatedAtlas({ root, variant: "light" });
  const crossTheme = await compareThemes(dark, light, root);
  const temporalArtifacts = includeTemporalArtifacts
    ? await buildAnimatedAtlasTemporalArtifacts({ root, reports: { dark, light } })
    : null;
  if (temporalArtifacts) {
    for (const [variant, report] of Object.entries({ dark, light })) {
      report.temporal.artifacts = {
        allFrameSheet: temporalArtifacts.report.allFrameSheets[variant],
        worstCaseSheet: {
          path: temporalArtifacts.report.worstCaseSheet.path,
          sha256: temporalArtifacts.report.worstCaseSheet.sha256,
          rowCount: temporalArtifacts.report.worstCaseSheet.rowCount,
        },
      };
    }
  }
  const errors = [
    ...dark.errors.map((error) => `dark: ${error}`),
    ...light.errors.map((error) => `light: ${error}`),
    ...crossTheme.errors.map((error) => `cross-theme: ${error}`),
  ];
  const coreRuntimeTransitions = [dark, light].reduce((total, report) => (
    total
      + report.samePhaseTransitions.timedRowPairs.count
      + report.samePhaseTransitions.gazeEntry.count
      + report.samePhaseTransitions.gazeNeighborPairs.count
      + report.crossPhaseTransitions.timedRowChanges.count
      + report.crossPhaseTransitions.gazeNeighborChanges.count
      + report.crossPhaseTransitions.gazeTimedBoundaries.count
  ), 0);
  const combined = {
    schemaVersion: 1,
    ok: errors.length === 0,
    contract: dark.contract,
    variants: {
      dark: compactVariant(dark),
      light: compactVariant(light),
    },
    temporalCoverage: {
      variants: 2,
      requiredCellCountPerVariant: REQUIRED_CELL_COUNT,
      frameCount: FLUID_ATLAS_FRAME_COUNT,
      transitionsPerVariant: REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT,
      totalTransitions: dark.temporal.transitionCount + light.temporal.transitionCount,
      totalInternalTransitions:
        dark.temporal.internalTransitionCount + light.temporal.internalTransitionCount,
      totalLoopSeams: dark.temporal.loopSeamCount + light.temporal.loopSeamCount,
      totalIsolatedFrameWindows:
        dark.temporal.isolatedFrameCount + light.temporal.isolatedFrameCount,
      totalFailingTransitions:
        dark.temporal.adjacencyUpperBounds.failingTransitionCount
        + light.temporal.adjacencyUpperBounds.failingTransitionCount,
      totalFailingIsolatedFrames:
        dark.temporal.adjacencyUpperBounds.failingIsolatedFrameCount
        + light.temporal.adjacencyUpperBounds.failingIsolatedFrameCount,
      displayed112: {
        totalTransitions: dark.displayedTemporal112.transitionCount
          + light.displayedTemporal112.transitionCount,
        totalInternalTransitions: dark.displayedTemporal112.internalTransitionCount
          + light.displayedTemporal112.internalTransitionCount,
        totalLoopSeams: dark.displayedTemporal112.loopSeamCount
          + light.displayedTemporal112.loopSeamCount,
        totalIsolatedFrameWindows: dark.displayedTemporal112.isolatedFrameCount
          + light.displayedTemporal112.isolatedFrameCount,
        totalFailingTransitions: dark.displayedTemporal112.failingTransitionCount
          + light.displayedTemporal112.failingTransitionCount,
        totalFailingIsolatedFrames: dark.displayedTemporal112.failingIsolatedFrameCount
          + light.displayedTemporal112.failingIsolatedFrameCount,
      },
    },
    hostBoundaryCoverage: {
      samePhase: {
        timedRowPairs: dark.samePhaseTransitions.timedRowPairs.count
          + light.samePhaseTransitions.timedRowPairs.count,
        gazeTimedBoundaries: dark.samePhaseTransitions.gazeEntry.count
          + light.samePhaseTransitions.gazeEntry.count,
        gazeNeighborPairs: dark.samePhaseTransitions.gazeNeighborPairs.count
          + light.samePhaseTransitions.gazeNeighborPairs.count,
        gazeBodyPairs: dark.samePhaseTransitions.gazeBodyPairs.count
          + light.samePhaseTransitions.gazeBodyPairs.count,
        gazeBodyNonNeighborPairs:
          dark.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount
          + light.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount,
      },
      crossPhase: {
        phaseWindows: dark.crossPhaseTransitions.phaseWindowCount
          + light.crossPhaseTransitions.phaseWindowCount,
        loopSeamWindows: dark.crossPhaseTransitions.loopSeamWindowCount
          + light.crossPhaseTransitions.loopSeamWindowCount,
        timedRowChanges: dark.crossPhaseTransitions.timedRowChanges.count
          + light.crossPhaseTransitions.timedRowChanges.count,
        gazeNeighborChanges: dark.crossPhaseTransitions.gazeNeighborChanges.count
          + light.crossPhaseTransitions.gazeNeighborChanges.count,
        gazeTimedBoundaries: dark.crossPhaseTransitions.gazeTimedBoundaries.count
          + light.crossPhaseTransitions.gazeTimedBoundaries.count,
        gazeToTimed: dark.crossPhaseTransitions.gazeTimedBoundaries.gazeToTimedCount
          + light.crossPhaseTransitions.gazeTimedBoundaries.gazeToTimedCount,
        eligibleTimedToGaze:
          dark.crossPhaseTransitions.gazeTimedBoundaries.eligibleTimedToGazeCount
          + light.crossPhaseTransitions.gazeTimedBoundaries.eligibleTimedToGazeCount,
        gazeBodyNonNeighborChanges:
          dark.crossPhaseTransitions.gazeBodyNonNeighborChanges.count
          + light.crossPhaseTransitions.gazeBodyNonNeighborChanges.count,
      },
      disjointTotals: {
        coreRuntimeTransitions,
        supplementalSamePhaseNonNeighborGaze:
          dark.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount
          + light.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount,
        supplementalCrossPhaseNonNeighborGaze:
          dark.crossPhaseTransitions.gazeBodyNonNeighborChanges.count
          + light.crossPhaseTransitions.gazeBodyNonNeighborChanges.count,
        totalUniqueRuntimeTransitions: coreRuntimeTransitions
          + dark.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount
          + light.samePhaseTransitions.gazeBodyPairs.phaseStability.nonNeighborTransitionCount
          + dark.crossPhaseTransitions.gazeBodyNonNeighborChanges.count
          + light.crossPhaseTransitions.gazeBodyNonNeighborChanges.count,
      },
      displayed112: {
        variants: 2,
        coreRuntimeTransitions:
          dark.displayed112HostBoundaries.core.transitionCount
          + light.displayed112HostBoundaries.core.transitionCount,
        supplementalSamePhaseNonNeighborGaze:
          dark.displayed112HostBoundaries.supplemental.samePhaseNonNeighborGaze
            .transitionCount
          + light.displayed112HostBoundaries.supplemental.samePhaseNonNeighborGaze
            .transitionCount,
        supplementalCrossPhaseNonNeighborGaze:
          dark.displayed112HostBoundaries.supplemental.crossPhaseNonNeighborGaze
            .transitionCount
          + light.displayed112HostBoundaries.supplemental.crossPhaseNonNeighborGaze
            .transitionCount,
        totalUniqueRuntimeTransitions:
          dark.displayed112HostBoundaries.totalUniqueTransitionCount
          + light.displayed112HostBoundaries.totalUniqueTransitionCount,
        totalFailingCoreTransitions:
          dark.displayed112HostBoundaries.core.failingTransitionCount
          + light.displayed112HostBoundaries.core.failingTransitionCount,
        exactMembership:
          dark.displayed112HostBoundaries.membership.ok
          && light.displayed112HostBoundaries.membership.ok,
      },
      sourceCell: {
        variants: 2,
        coreRuntimeTransitions:
          dark.sourceHostBoundaries.core.transitionCount
          + light.sourceHostBoundaries.core.transitionCount,
        supplementalSamePhaseNonNeighborGaze:
          dark.sourceHostBoundaries.supplemental.samePhaseNonNeighborGaze.transitionCount
          + light.sourceHostBoundaries.supplemental.samePhaseNonNeighborGaze.transitionCount,
        supplementalCrossPhaseNonNeighborGaze:
          dark.sourceHostBoundaries.supplemental.crossPhaseNonNeighborGaze.transitionCount
          + light.sourceHostBoundaries.supplemental.crossPhaseNonNeighborGaze.transitionCount,
        totalUniqueRuntimeTransitions:
          dark.sourceHostBoundaries.totalUniqueTransitionCount
          + light.sourceHostBoundaries.totalUniqueTransitionCount,
        totalFailingCoreTransitions:
          dark.sourceHostBoundaries.core.failingTransitionCount
          + light.sourceHostBoundaries.core.failingTransitionCount,
        exactMembership:
          dark.sourceHostBoundaries.membership.ok
          && light.sourceHostBoundaries.membership.ok,
      },
    },
    crossTheme,
    temporalArtifacts: temporalArtifacts?.report ?? null,
    errors,
  };
  return {
    ok: combined.ok,
    variants: { dark, light },
    combined,
    artifactFiles: temporalArtifacts?.files ?? new Map(),
  };
}

function canonicalReportFiles(result) {
  const compactSourceTemporalCell = (cell) => {
    const transitions = cell.temporalAdjacency.transitions.map((transition) => ({
      ...transition,
      id: `${cell.key}:p${transition.fromPage}->p${transition.toPage}`,
      kind: "source-cell-temporal-adjacency",
      gateKind: `row-${cell.row}`,
      from: { row: cell.row, column: cell.column, state: cell.state },
      to: { row: cell.row, column: cell.column, state: cell.state },
    }));
    const isolatedFrames = cell.isolatedFrameExcursions.frames.map((frame) => ({
      id: `${cell.key}:p${frame.centerPage}`,
      ...frame,
    }));
    const { transitions: _transitions, ...temporalAdjacency } = cell.temporalAdjacency;
    const { frames: _frames, ...isolatedFrameExcursions } = cell.isolatedFrameExcursions;
    return {
      ...cell,
      temporalAdjacency: {
        ...temporalAdjacency,
        trace: summarizeHostTransitionTrace(transitions),
      },
      isolatedFrameExcursions: {
        ...isolatedFrameExcursions,
        trace: summarizeIsolatedFrameTrace(isolatedFrames),
      },
    };
  };
  const compactDisplayedTemporalCell = (cell) => {
    const transitions = cell.transitions.map((transition) => ({
      ...transition,
      id: `${cell.key}:p${transition.fromPage}->p${transition.toPage}`,
      kind: "displayed-default-dpr2-temporal-adjacency",
      gateKind: `row-${cell.row}`,
      from: { row: cell.row, column: cell.column, state: cell.state },
      to: { row: cell.row, column: cell.column, state: cell.state },
    }));
    const isolatedFrames = cell.isolatedFrames.map((frame) => ({
      id: `${cell.key}:p${frame.centerPage}`,
      ...frame,
    }));
    const { transitions: _transitions, isolatedFrames: _isolatedFrames, ...summary } = cell;
    return {
      ...summary,
      transitionTrace: summarizeHostTransitionTrace(transitions),
      isolatedFrameTrace: {
        ...summarizeIsolatedFrameTrace(isolatedFrames),
      },
    };
  };
  const compactVariantForPersistence = (report) => {
    const sourceTemporalTransitions = report.temporal.cells.flatMap((cell) => (
      cell.temporalAdjacency.transitions.map((transition) => ({
        ...transition,
        id: `${cell.key}:p${transition.fromPage}->p${transition.toPage}`,
        kind: "source-cell-temporal-adjacency",
        gateKind: `row-${cell.row}`,
        from: { row: cell.row, column: cell.column, state: cell.state },
        to: { row: cell.row, column: cell.column, state: cell.state },
      }))
    ));
    const sourceIsolatedFrames = report.temporal.cells.flatMap((cell) => (
      cell.isolatedFrameExcursions.frames.map((frame) => ({
        id: `${cell.key}:p${frame.centerPage}`,
        ...frame,
      }))
    ));
    const displayedTemporalTransitions = report.displayedTemporal112.cells.flatMap((cell) => (
      cell.transitions.map((transition) => ({
        ...transition,
        id: `${cell.key}:p${transition.fromPage}->p${transition.toPage}`,
        kind: "displayed-default-dpr2-temporal-adjacency",
        gateKind: `row-${cell.row}`,
        from: { row: cell.row, column: cell.column, state: cell.state },
        to: { row: cell.row, column: cell.column, state: cell.state },
      }))
    ));
    const displayedIsolatedFrames = report.displayedTemporal112.cells.flatMap((cell) => (
      cell.isolatedFrames.map((frame) => ({
        id: `${cell.key}:p${frame.centerPage}`,
        ...frame,
      }))
    ));
    const {
      transitions: _timedRowTransitions,
      ...crossPhaseTimedRowChanges
    } = report.crossPhaseTransitions.timedRowChanges;
    const {
      transitions: _gazeNeighborTransitions,
      ...crossPhaseGazeNeighborChanges
    } = report.crossPhaseTransitions.gazeNeighborChanges;
    const {
      transitions: _gazeTimedTransitions,
      ...crossPhaseGazeTimedBoundaries
    } = report.crossPhaseTransitions.gazeTimedBoundaries;
    return {
      ...report,
      temporal: {
        ...report.temporal,
        orderedTransitionTrace: summarizeHostTransitionTrace(sourceTemporalTransitions),
        orderedIsolatedFrameTrace: {
          ...summarizeIsolatedFrameTrace(sourceIsolatedFrames),
        },
        cells: report.temporal.cells.map(compactSourceTemporalCell),
      },
      displayedTemporal112: {
        ...report.displayedTemporal112,
        orderedTransitionTrace: summarizeHostTransitionTrace(displayedTemporalTransitions),
        orderedIsolatedFrameTrace: {
          ...summarizeIsolatedFrameTrace(displayedIsolatedFrames),
        },
        cells: report.displayedTemporal112.cells.map(compactDisplayedTemporalCell),
      },
      crossPhaseTransitions: {
        ...report.crossPhaseTransitions,
        timedRowChanges: crossPhaseTimedRowChanges,
        gazeNeighborChanges: crossPhaseGazeNeighborChanges,
        gazeTimedBoundaries: crossPhaseGazeTimedBoundaries,
      },
    };
  };
  const persistedDark = compactVariantForPersistence(result.variants.dark);
  const persistedLight = compactVariantForPersistence(result.variants.light);
  return Object.freeze({
    // Variant ledgers are deterministic machine evidence. Keep them minified so
    // the exhaustive hashes and summaries remain practical to track publicly;
    // `jq` and every JSON consumer retain the exact same schema.
    "animated-atlas-dark.json": `${JSON.stringify(persistedDark)}\n`,
    "animated-atlas-light.json": `${JSON.stringify(persistedLight)}\n`,
    "animated-atlas.json": `${JSON.stringify(result.combined, null, 2)}\n`,
  });
}

export async function writeAnimatedAtlasReports(result, { root = repositoryRoot } = {}) {
  const qaDirectory = path.join(root, "qa");
  await mkdir(qaDirectory, { recursive: true });
  for (const [name, contents] of Object.entries(canonicalReportFiles(result))) {
    await writeFile(path.join(qaDirectory, name), contents);
  }
  for (const [relativePath, contents] of result.artifactFiles ?? []) {
    await writeFile(path.join(root, relativePath), contents);
  }
}

export async function checkAnimatedAtlasReports(result, { root = repositoryRoot } = {}) {
  const qaDirectory = path.join(root, "qa");
  const files = [];
  for (const [name, expected] of Object.entries(canonicalReportFiles(result))) {
    const reportPath = path.join(qaDirectory, name);
    let actual = null;
    let error = null;
    try {
      actual = await readFile(reportPath, "utf8");
    } catch (readError) {
      error = readError.message;
    }
    const matches = actual === expected;
    files.push({
      path: path.relative(root, reportPath).split(path.sep).join("/"),
      matches,
      expectedSha256: sha256(Buffer.from(expected)),
      actualSha256: actual == null ? null : sha256(Buffer.from(actual)),
      error,
    });
  }
  for (const [relativePath, expected] of result.artifactFiles ?? []) {
    const reportPath = path.join(root, relativePath);
    let actual = null;
    let error = null;
    try {
      actual = await readFile(reportPath);
    } catch (readError) {
      error = readError.message;
    }
    const matches = actual != null && actual.equals(expected);
    files.push({
      path: path.relative(root, reportPath).split(path.sep).join("/"),
      matches,
      expectedSha256: sha256(expected),
      actualSha256: actual == null ? null : sha256(actual),
      error,
    });
  }
  return {
    ok: files.every((file) => file.matches),
    files,
  };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help")) {
    console.log("Usage: node scripts/animated-atlas-qa.mjs [--check]");
    console.log("Default: validate both shipping atlases and write deterministic JSON plus temporal image evidence.");
    console.log("--check: validate and byte-compare all six canonical report and image files without writing.");
    return;
  }
  const unknown = argumentsList.filter((argument) => argument !== "--check");
  if (unknown.length > 0) throw new Error(`Unknown argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);

  const result = await validateAnimatedAtlases();
  const reportFileCheck = argumentsList.includes("--check")
    ? await checkAnimatedAtlasReports(result)
    : null;
  if (!reportFileCheck) await writeAnimatedAtlasReports(result);
  for (const [variant, report] of Object.entries(result.variants)) {
    console.log(
      `${report.ok ? "PASS" : "FAIL"}: ${variant} animated atlas; `
      + `${report.inspectedPageCount}/${FLUID_ATLAS_FRAME_COUNT} pages, `
      + `${report.temporal.motionCellCount}/${REQUIRED_CELL_COUNT} moving cells, `
      + `${report.temporal.loopSafeCellCount}/${REQUIRED_CELL_COUNT} loop-safe cells, `
      + `${report.displayedTemporal112.transitionCount} exact 7.04rem/DPR2 transitions, `
      + `${report.displayed112HostBoundaries.totalUniqueTransitionCount} exact 7.04rem/DPR2 host boundaries, `
      + `${report.errors.length} errors`,
    );
  }
  console.log(
    `${result.combined.crossTheme.ok ? "PASS" : "FAIL"}: cross-theme alpha, silhouette, inversion, and accent parity; `
    + `${result.combined.crossTheme.errors.length} errors`,
  );
  if (result.combined.temporalArtifacts) {
    const artifacts = result.combined.temporalArtifacts;
    console.log(
      `PASS: temporal image evidence; `
      + `${artifacts.allFrameSheets.dark.displayedCellFrames + artifacts.allFrameSheets.light.displayedCellFrames} `
      + `displayed source-cell frames and ${artifacts.worstCaseSheet.rowCount} worst-transition rows`,
    );
  }
  if (reportFileCheck) {
    console.log(
      `${reportFileCheck.ok ? "PASS" : "FAIL"}: canonical animated-atlas report bytes; `
      + `${reportFileCheck.files.filter((file) => file.matches).length}/${reportFileCheck.files.length} current`,
    );
    for (const file of reportFileCheck.files.filter((candidate) => !candidate.matches)) {
      console.error(`error: stale or missing report ${file.path}`);
    }
  }
  for (const error of result.combined.errors) console.error(`error: ${error}`);
  if (!result.ok || (reportFileCheck && !reportFileCheck.ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
