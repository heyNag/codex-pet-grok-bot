#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CODEX_DEFAULT_DPR2_DISPLAY,
  codexDefaultDpr2CellMap,
  renderCodexDefaultDpr2Frame,
} from "./codex-default-dpr2-oracle.mjs";
import {
  FLUID_ATLAS_FRAME_COUNT,
  FLUID_ATLAS_LOOP_MS,
  fluidAtlasDelays,
} from "../src/fluid-atlas.mjs";
import { THEME_PALETTES } from "../src/grok-art.mjs";
import {
  SOURCE_MOTION_ACTIVE_SECONDS,
  SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
  SOURCE_MOTION_FRAME_HEIGHT,
  SOURCE_MOTION_FRAME_RATE,
  SOURCE_MOTION_FRAME_WIDTH,
  SOURCE_MOTION_RASTER_SCALE,
  SOURCE_MOTION_RELEASE_SECONDS,
  sourceMotionFrameDelaysMs,
} from "../src/source-motion-timing.mjs";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  COLUMNS,
  ROWS,
  ROW_COUNT,
  SOURCE_EFFECT_TRANSITIONS,
} from "../src/spec.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repositoryRoot, "qa", "exhaustive-edge-qa.json");
const reviewImagePath = path.join(repositoryRoot, "qa", "exhaustive-edge-worst-cases.png");

const SAFETY_GUTTER_PX = 4;
const SOURCE_NOMINAL_FRAME_RATE = SOURCE_MOTION_FRAME_RATE;
const SOURCE_NOMINAL_FRAME_COUNT = Math.round(
  (SOURCE_MOTION_ACTIVE_SECONDS + SOURCE_MOTION_RELEASE_SECONDS) * SOURCE_MOTION_FRAME_RATE,
);
const SOURCE_DURATION_MS = Math.round(
  (SOURCE_MOTION_ACTIVE_SECONDS + SOURCE_MOTION_RELEASE_SECONDS) * 1000,
);
const LOCAL_REFERENCE_RADIUS_PX = 3;
const MATTE_ANALYSIS_MIN_ALPHA = 16;
const MATTE_ANALYSIS_MAX_ALPHA = 239;
const MAX_WORST_CASES = 16;

const REQUIRED_COLUMNS_BY_ROW = Object.freeze(ROWS.map((row) => row.frames.length));
const REQUIRED_CELL_COUNT = REQUIRED_COLUMNS_BY_ROW.reduce((sum, count) => sum + count, 0);
const UNUSED_CELL_COUNT = COLUMNS * ROW_COUNT - REQUIRED_CELL_COUNT;
const EXPECTED_SOURCE_EFFECTS = Object.freeze(SOURCE_EFFECT_TRANSITIONS.map(({ effect }) => effect));

const STAGES = Object.freeze({
  dark: Object.freeze({ css: "#080b0c", rgb: Object.freeze([8, 11, 12]) }),
  light: Object.freeze({ css: "#f3f1e9", rgb: Object.freeze([243, 241, 233]) }),
});

const SHIPPING_VARIANTS = Object.freeze({
  dark: Object.freeze({
    atlasPath: "pet/grok-bot-dark/spritesheet.webp",
    manifestPath: "pet/grok-bot-dark/pet.json",
    petId: "grok-bot-dark",
    palette: "dark-codex",
    intendedStage: "dark",
  }),
  light: Object.freeze({
    atlasPath: "pet/grok-bot-light/spritesheet.webp",
    manifestPath: "pet/grok-bot-light/pet.json",
    petId: "grok-bot-light",
    palette: "light-codex",
    intendedStage: "light",
  }),
});

const DISPLAY_PATHS = Object.freeze({
  shipping96: Object.freeze({
    cssWidthPx: 96,
    cssHeightPx: 104,
    devicePixelRatio: 2,
    deviceWidthPx: 192,
    deviceHeightPx: 208,
    samplingLatticeWidthPx: 192,
    samplingLatticeHeightPx: 208,
    interpolation: "exact 1:1 Chromium pixelated background sampling",
  }),
  shippingDefaultDpr2: Object.freeze({
    ...CODEX_DEFAULT_DPR2_DISPLAY,
    hostBackground: Object.freeze({
      width: "var(--codex-pet-width, 7.04rem)",
      aspectRatio: "192 / 208",
      backgroundSize: "800% 1100%",
      horizontalPosition: "column / 7 * 100%",
      verticalPosition: "row / 10 * 100%",
    }),
  }),
  sourcePreview: Object.freeze({
    cssWidthPx: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
    devicePixelRatio: 2,
    deviceWidthPx: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX * 2,
    deviceHeightPx: Math.round(
      SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX * 2 * SOURCE_MOTION_FRAME_HEIGHT / SOURCE_MOTION_FRAME_WIDTH,
    ),
    interpolation: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX * 2 === SOURCE_MOTION_FRAME_WIDTH
      ? "exact native-device-pixel sampling with image-rendering:auto"
      : "smooth premultiplied-alpha Lanczos3 resampling",
  }),
});

const THRESHOLDS = Object.freeze({
  maximumHiddenRgbPixels: 0,
  maximumGutterNonZeroRgbaPixels: 0,
  maximumAlphaMismatchPixels: 0,
  maximumUnclassifiedVisiblePairFraction: 0.00012,
  maximumUnexplainedMatteCandidateFraction: 0.00005,
  maximumReciprocalDarkLightMattePairs: 0,
  maximumReciprocalOuterEdgeContaminationPixels: 0,
  maximumSourceMotionCssFilterMatches: 0,
  relationChannelTolerance: 3,
  localReferenceRadiusPx: LOCAL_REFERENCE_RADIUS_PX,
  matteAnalysisAlphaRange: Object.freeze([
    MATTE_ANALYSIS_MIN_ALPHA,
    MATTE_ANALYSIS_MAX_ALPHA,
  ]),
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
    localReferenceRadiusPx: LOCAL_REFERENCE_RADIUS_PX,
    intentionalInverseFeature: Object.freeze({
      minimumPixels: 8,
      minimumWidthPx: 3,
      minimumHeightPx: 3,
      minimumBoundingBoxFillRatio: 0.25,
      maximumCanvasDimensionFraction: 0.35,
    }),
    pairedChromaContinuation: Object.freeze({
      localReferenceRadiusPx: LOCAL_REFERENCE_RADIUS_PX,
      minimumChannelSpread: 18,
      minimumAlphaIncrease: 1,
    }),
  }),
});

const ACCENT_KEYS = Object.freeze(["coral", "blue", "green", "gold", "violet", "teal"]);
const MATTE_REFERENCES = Object.freeze([
  Object.freeze({ id: "black", category: "dark", rgb: Object.freeze([0, 0, 0]) }),
  Object.freeze({ id: "dark-stage", category: "dark", rgb: STAGES.dark.rgb }),
  Object.freeze({ id: "white", category: "light", rgb: Object.freeze([255, 255, 255]) }),
  Object.freeze({ id: "light-stage", category: "light", rgb: STAGES.light.rgb }),
  ...ACCENT_KEYS.map((key) => Object.freeze({
    id: key,
    category: "chroma",
    rgb: Object.freeze(hexToRgb(THEME_PALETTES["dark-codex"][key])),
  })),
]);

const SOURCE_NOMINAL_DELAYS_MS = Object.freeze(sourceMotionFrameDelaysMs());

const ANMF_REGRESSION_FIXTURE = Object.freeze({
  base64: "UklGRvwAAABXRUJQVlA4WAoAAAASAAAAAwAAAwAAQU5JTQYAAAD///8AAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAANWUDhMDwAAAC8BQAAAB9D/iP4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAABWUDhMDwAAAC8BQAAQBxDR/wIGIqL/AQBBTk1GQAAAAAEAAAEAAAEAAAEAAGQAAAJWUDhMKAAAAC8BQAAQHyAQSN4fOo35FxAU+T+aQICQxn+UCPiLBJm0bajtrkX0P3Y=",
  sha256: "edee2990a282b6c6f2d1348a867b4d5296d00144f88c1fa7ed6ce8ff70b346f8",
  width: 4,
  pageHeight: 4,
  pages: 4,
  pageSha256: Object.freeze([
    "fec0f57de0b19bc7dacb5b0fc3de7b56fc68dfdbeeebc8f9f4c506bf6e821c77",
    "baa8355c4c5a057d762fa82ae4d19a5be2e0cf1739fbcb3af913b69ea278f90b",
    "c344af55d52a80b15e3b300a6e55d482ce2ded1ed9540aafc560bc3b8c645542",
    "5716854e1c113f341f2c2c910afd6bd3b6ffcae0e6bf20c7e5a4c60fc41732a3",
  ]),
  frames: Object.freeze([
    Object.freeze({ x: 0, y: 0, width: 4, height: 4, durationMs: 100, disposeToBackground: false, blendMode: "no-blend", flags: 2 }),
    Object.freeze({ x: 0, y: 0, width: 2, height: 2, durationMs: 100, disposeToBackground: true, blendMode: "no-blend", flags: 3 }),
    Object.freeze({ x: 0, y: 0, width: 2, height: 2, durationMs: 100, disposeToBackground: false, blendMode: "source-over", flags: 0 }),
    Object.freeze({ x: 2, y: 2, width: 2, height: 2, durationMs: 100, disposeToBackground: false, blendMode: "no-blend", flags: 2 }),
  ]),
});

// These full-canvas RGBA hashes were independently established with libwebp's
// WebPAnimDecoder (MODE_RGBA) and ffmpeg with frame-rate passthrough. They make
// the production audit fail closed if libvips ever starts exposing raw ANMF
// fragments instead of browser-equivalent coalesced frames.
const PINNED_DECODER_ORACLES = Object.freeze([
  Object.freeze({
    id: "shipping-dark",
    path: "pet/grok-bot-dark/spritesheet.webp",
    width: ATLAS_WIDTH,
    pageHeight: ATLAS_HEIGHT,
    pages: FLUID_ATLAS_FRAME_COUNT,
    fullStackSha256: "367db70affd4708124d300bde23145c81486d1d1e78852dd2db434af9b471db1",
    disposalPages: Object.freeze([2, 37, 55]),
    pageSpecific: true,
    pageSha256: Object.freeze({
      0: "6db8936ae8fb106f8f7535af652f2f0ba4b0865ffabc9cd864a507dd6285c742",
      1: "4c09a7719c83079939eb7137aabd5262e11376a0ac407d1b1e9e945659c7e730",
      2: "f648e608dfd759f941cf183db5bdc701c682bef76ea355a3fa31f43514c4f9b1",
      3: "251d28faa9136e44484713b4a3558753caa13325789e36f37c9ddbb6d35ad70b",
      37: "5652b851aaf4e3b2e0602a7356afc4df66e6d1771abb12f0e91d6f3391f9c7ec",
      38: "db7dc12ef2d29dfd51ca42fc83fdf8031f6d10f38a7918eb0fdccda97c353831",
      55: "3383198823696c6a0d9061b68042f73090a454ca2332beb61ac74e03201ef423",
      56: "bd83f87e31852043237350fff3c67bb14b319c29d58849f50027e83601e592c0",
      59: "f46a71b2cbd5eb5b98ad85d3f9651e99b2f7d82887d2f64e1a0dcd0f9fe86a7d",
    }),
  }),
  Object.freeze({
    id: "shipping-light",
    path: "pet/grok-bot-light/spritesheet.webp",
    width: ATLAS_WIDTH,
    pageHeight: ATLAS_HEIGHT,
    pages: FLUID_ATLAS_FRAME_COUNT,
    fullStackSha256: "9988349e836f2014f7f0dfcf3ab2a01401e923bb02f7faa7c31a09d5c18be881",
    disposalPages: Object.freeze([37, 55]),
    pageSpecific: true,
    pageSha256: Object.freeze({
      0: "4a532c427c1354d6899a65a8bb5dbf0cb6735e8c1b559b881d61faa0d7634082",
      1: "452ed66dfdd8c903990ed41d59e0405ba3f283749f2fc270a20f143ec9515b90",
      37: "4bfdda6f3d750b7de2cf7b1db4bf9186ceb8a442a6560c733611ff889243849d",
      38: "65f72e33473f9ef6756cf0855253b680a40e4f2f91811361688006bc57ea09eb",
      55: "45b86e03af080180b1e54111df9390540c51fdf1ba353e71ec8be1e94ca81f88",
      56: "54aaf10aab75aefcf5f4c9ba1c61f61937f78e076487e15f0f208ff6fa1b7bc5",
      59: "1d180eb7283e1b621e32786b204fb8106a90a26d5e4905816f72721fa936adc6",
    }),
  }),
  Object.freeze({
    id: "source-dark-radar",
    path: "preview/source-lab/motion/dark/radar.webp",
    width: SOURCE_MOTION_FRAME_WIDTH,
    pageHeight: SOURCE_MOTION_FRAME_HEIGHT,
    pages: 147,
    fullStackSha256: "10975ef06d2f6d5306291014ee4dcc796bb636ffa97342d171ab997731e75fea",
    disposalPages: Object.freeze([0, 1, 2, 3, 4, 25, 51, 77, 103]),
    pageSpecific: false,
    pageSha256: Object.freeze({
      0: "bd1310810711f7fe991a7715d34dc8637008bb26ee2ced0eedb506e1d8fe8675",
      1: "d72e1495df47209e81de84e82b435bcc8412478d776b9872acfea9b30e31f8d2",
      25: "15ed47331326243ebad6f055c5a31538c6309bb9b97d3ad715ce23c2fd7dc935",
      26: "a9089d970bade840501017be9393b76adceaa5bb37f0d09ff64b49acedc5b2e0",
      30: "a04cdaaba59799b69773d1245c25fd12a73e50fb54be3823e1c21ad4bf233392",
      51: "301d9043c67f7242ed7c933eacc438e2eba8eb52b386e4b61b321bd5706a4511",
      52: "c36569fe8b70d45cff033869fdde1ac7c574a49d4aeb789666825fea2e85dbba",
      77: "301d9043c67f7242ed7c933eacc438e2eba8eb52b386e4b61b321bd5706a4511",
      78: "c36569fe8b70d45cff033869fdde1ac7c574a49d4aeb789666825fea2e85dbba",
      103: "301d9043c67f7242ed7c933eacc438e2eba8eb52b386e4b61b321bd5706a4511",
      104: "c36569fe8b70d45cff033869fdde1ac7c574a49d4aeb789666825fea2e85dbba",
      146: "bd1310810711f7fe991a7715d34dc8637008bb26ee2ced0eedb506e1d8fe8675",
    }),
  }),
  Object.freeze({
    id: "source-light-whirl",
    path: "preview/source-lab/motion/light/whirl.webp",
    width: SOURCE_MOTION_FRAME_WIDTH,
    pageHeight: SOURCE_MOTION_FRAME_HEIGHT,
    pages: 147,
    fullStackSha256: "eaba0a27ef8e2c8a2ac3290532a023754047fe2a607f3b3f23c8ffdf48128d51",
    disposalPages: Object.freeze([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      18, 19, 20, 21, 22, 23, 24, 25, 26,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
      56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
      83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
      99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]),
    pageSpecific: false,
    pageSha256: Object.freeze({
      0: "21f737fda294e4397dfbe7ade1c0e56af7e0d95e6697553d483e56c58f40d2f0",
      1: "6e5758bbd981cd62b153e6f5e7c489d67da641eb4205c2f30da3b93c58a36191",
      16: "cd905349bf4d700797677c8ff6766cffc3819be694fc94fd1db2bb44d49dc5ec",
      17: "60178abc055758eac84d7791e45bffb476725dcf3dc0230be106ead61f45e834",
      18: "2b4f34169d9a2faddffcaff7b60a798a976fa280dd182a757940cade11ce54cd",
      26: "4706cf57ae12e53dd1c907ac19394c5bae8ec8731df6a8e40f6dcf597077d0e1",
      27: "3254b3810c267903288aed53fe6031140fca8db9995055dde3e053c8a0752ce4",
      40: "a9290506561e9821c11ac6455ce78630d46c7d94636c5efa0407c1189d1c4b6a",
      41: "ef0a37ad7a38a340efb08dd5287f453e379dbfefe3df289575008246882687cc",
      69: "08c7c4f953dd088f91ab65e1d9e581aa6fc76713f96d172afa9fb806ca01bc2c",
      70: "6d054f5092888e270cdfea6158535bb53261f0b44878350204f67e977224b0e1",
      83: "ef0c2592c792c60c9b49959e1cb163745be7cbb8829b78bdf86f892733f8cf6b",
      84: "007ef1ae766cb258ea62e675618ebc4959f583840bcb6955c8be9c93cee51598",
      109: "5c5dbc4daafbe9adc4e4b78334e646004c346e45c0e3496f480d4220af74f314",
      110: "39147607be0369506838bd29eb86b20209221989ad36ef8fd4878f3a4701bc1f",
      146: "82e3bc26475970ef90d9de682f6a6947a81e5263c7a60f5156a8d65e7aef7f11",
    }),
  }),
]);

function round(value, digits = 9) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

const EXHAUSTIVE_OUTPUT_PATHS = Object.freeze(new Set([
  "qa/exhaustive-edge-qa.json",
  "qa/exhaustive-edge-worst-cases.png",
]));

function collectRecordedInputHashRecords(report) {
  const records = new Map();
  const add = (relativePath, expectedSha256, location) => {
    if (EXHAUSTIVE_OUTPUT_PATHS.has(relativePath)) return;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error(`exhaustive QA recorded an invalid file path at ${location}`);
    }
    if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
      throw new Error(`exhaustive QA recorded an invalid SHA-256 for ${relativePath} at ${location}`);
    }
    const previous = records.get(relativePath);
    if (previous && previous.expectedSha256 !== expectedSha256) {
      throw new Error(`exhaustive QA recorded conflicting SHA-256 values for ${relativePath}`);
    }
    records.set(relativePath, { relativePath, expectedSha256 });
  };

  const visit = (value, location = "report") => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.path === "string") {
      if (typeof value.sha256 === "string") add(value.path, value.sha256, `${location}.sha256`);
      if (typeof value.encodedSha256 === "string") {
        add(value.path, value.encodedSha256, `${location}.encodedSha256`);
      }
    }
    for (const [key, entry] of Object.entries(value)) visit(entry, `${location}.${key}`);
  };

  visit(report);
  for (const [relativePath, record] of Object.entries(report.structuralCss?.files ?? {})) {
    add(relativePath, record?.sha256, `report.structuralCss.files.${relativePath}`);
  }
  for (const [relativePath, record] of Object.entries(report.sourceMotion?.manifest?.inputs ?? {})) {
    add(relativePath, record?.actualSha256, `report.sourceMotion.manifest.inputs.${relativePath}`);
  }
  return [...records.values()].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath)
  ));
}

function resolveRecordedInputPath(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const relativeFromRoot = path.relative(rootDir, absolutePath);
  if (
    path.isAbsolute(relativePath)
    || relativeFromRoot === ".."
    || relativeFromRoot.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`exhaustive QA recorded a path outside the repository: ${relativePath}`);
  }
  return absolutePath;
}

async function verifyRecordedInputHashes(report, { rootDir = repositoryRoot } = {}) {
  const records = collectRecordedInputHashRecords(report);
  for (const record of records) {
    let currentSha256 = null;
    try {
      currentSha256 = await hashFile(resolveRecordedInputPath(rootDir, record.relativePath));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (currentSha256 !== record.expectedSha256) {
      throw new Error(`${record.relativePath} changed while exhaustive QA was running`);
    }
  }
  return records;
}

let exhaustiveOutputTransaction = 0;

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceFileAtomically(targetPath, contents, suffix) {
  const temporaryPath = `${targetPath}.${process.pid}.${suffix}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { flag: "wx" });
    await rename(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function restoreOutput(targetPath, previousBytes, suffix) {
  if (previousBytes === null) {
    await unlink(targetPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return;
  }
  await replaceFileAtomically(targetPath, previousBytes, suffix);
}

async function writeExhaustiveArtifactsAtomically({
  rootDir = repositoryRoot,
  report,
  serializedReport,
  reviewImage,
  beforeFinalInputVerification,
} = {}) {
  if (
    beforeFinalInputVerification !== undefined
    && typeof beforeFinalInputVerification !== "function"
  ) {
    throw new TypeError("beforeFinalInputVerification must be a function when provided");
  }
  await verifyRecordedInputHashes(report, { rootDir });
  const qaRoot = path.join(rootDir, "qa");
  const targetReportPath = path.join(qaRoot, "exhaustive-edge-qa.json");
  const targetReviewPath = path.join(qaRoot, "exhaustive-edge-worst-cases.png");
  await mkdir(qaRoot, { recursive: true });

  exhaustiveOutputTransaction += 1;
  const token = `${process.pid}.${exhaustiveOutputTransaction}`;
  const stagedReportPath = `${targetReportPath}.${token}.stage`;
  const stagedReviewPath = `${targetReviewPath}.${token}.stage`;
  const [previousReport, previousReview] = await Promise.all([
    readOptionalFile(targetReportPath),
    readOptionalFile(targetReviewPath),
  ]);
  let reportReplaced = false;
  let reviewReplaced = false;

  try {
    await Promise.all([
      writeFile(stagedReportPath, serializedReport, { flag: "wx" }),
      writeFile(stagedReviewPath, reviewImage, { flag: "wx" }),
    ]);
    await verifyRecordedInputHashes(report, { rootDir });
    await rename(stagedReviewPath, targetReviewPath);
    reviewReplaced = true;
    await rename(stagedReportPath, targetReportPath);
    reportReplaced = true;
    if (beforeFinalInputVerification) await beforeFinalInputVerification();
    await verifyRecordedInputHashes(report, { rootDir });
  } catch (error) {
    const rollbackErrors = [];
    if (reviewReplaced) {
      await restoreOutput(targetReviewPath, previousReview, `${token}.review-rollback`)
        .catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (reportReplaced) {
      await restoreOutput(targetReportPath, previousReport, `${token}.report-rollback`)
        .catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "exhaustive QA output transaction and rollback failed");
    }
    throw error;
  } finally {
    await Promise.all([
      unlink(stagedReportPath).catch(() => {}),
      unlink(stagedReviewPath).catch(() => {}),
    ]);
  }
}

function readUint24Le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseAnimatedWebpFrameHeaders(buffer) {
  if (
    buffer.length < 12
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Animated decoder fixture is not a RIFF WebP file");
  }
  const frames = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const next = payload + length + (length & 1);
    if (next > buffer.length) throw new Error(`WebP ${chunk} chunk exceeds the RIFF boundary`);
    if (chunk === "ANMF") {
      if (length < 16) throw new Error("WebP ANMF chunk is shorter than its frame header");
      const flags = buffer[payload + 15];
      frames.push({
        index: frames.length,
        x: readUint24Le(buffer, payload) * 2,
        y: readUint24Le(buffer, payload + 3) * 2,
        width: readUint24Le(buffer, payload + 6) + 1,
        height: readUint24Le(buffer, payload + 9) + 1,
        durationMs: readUint24Le(buffer, payload + 12),
        disposeToBackground: (flags & 1) !== 0,
        blendMode: (flags & 2) !== 0 ? "no-blend" : "source-over",
        flags,
      });
    }
    offset = next;
  }
  return frames;
}

function bufferDifference(left, right) {
  if (left.length !== right.length) {
    return { equal: false, differingBytes: Math.max(left.length, right.length), maximumChannelDelta: 255 };
  }
  if (left.equals(right)) return { equal: true, differingBytes: 0, maximumChannelDelta: 0 };
  let differingBytes = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < left.length; offset += 1) {
    const delta = Math.abs(left[offset] - right[offset]);
    if (delta > 0) differingBytes += 1;
    if (delta > maximumChannelDelta) maximumChannelDelta = delta;
  }
  return { equal: differingBytes === 0, differingBytes, maximumChannelDelta };
}

function rgbaAt(stack, width, pageHeight, page, x, y) {
  const offset = ((page * pageHeight + y) * width + x) * 4;
  return [...stack.subarray(offset, offset + 4)];
}

async function verifyDecoderRegressionFixture() {
  const errors = [];
  const fixture = Buffer.from(ANMF_REGRESSION_FIXTURE.base64, "base64");
  const fixtureSha256 = sha256(fixture);
  if (fixtureSha256 !== ANMF_REGRESSION_FIXTURE.sha256) errors.push("fixture SHA-256 changed");
  const frameHeaders = parseAnimatedWebpFrameHeaders(fixture);
  const expectedHeaders = ANMF_REGRESSION_FIXTURE.frames.map((frame, index) => ({ index, ...frame }));
  if (JSON.stringify(frameHeaders) !== JSON.stringify(expectedHeaders)) {
    errors.push("fixture ANMF frame headers changed");
  }
  const decoded = await sharp(fixture, {
    animated: true,
    failOn: "error",
    sequentialRead: true,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expectedInfo = {
    width: ANMF_REGRESSION_FIXTURE.width,
    height: ANMF_REGRESSION_FIXTURE.pageHeight * ANMF_REGRESSION_FIXTURE.pages,
    pageHeight: ANMF_REGRESSION_FIXTURE.pageHeight,
    pages: ANMF_REGRESSION_FIXTURE.pages,
    channels: 4,
  };
  for (const [key, expected] of Object.entries(expectedInfo)) {
    if (decoded.info[key] !== expected) errors.push(`fixture decoded ${key} is ${decoded.info[key]}; expected ${expected}`);
  }
  const pageBytes = expectedInfo.width * expectedInfo.pageHeight * 4;
  const pages = [];
  for (let page = 0; page < expectedInfo.pages; page += 1) {
    const stackPage = decoded.data.subarray(page * pageBytes, (page + 1) * pageBytes);
    const stackSha256 = sha256(stackPage);
    if (stackSha256 !== ANMF_REGRESSION_FIXTURE.pageSha256[page]) {
      errors.push(`fixture stack page ${page} differs from its independent oracle`);
    }
    const pageRead = await sharp(fixture, {
      animated: true,
      failOn: "error",
      page,
      pages: 1,
      sequentialRead: true,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const comparison = bufferDifference(pageRead.data, stackPage);
    if (!comparison.equal) errors.push(`fixture page-specific read ${page} differs from its stack slice`);
    pages.push({
      page,
      sha256: stackSha256,
      pageSpecificComparison: comparison,
    });
  }
  const semanticPixels = [
    { page: 0, x: 3, y: 3, expected: [255, 0, 0, 255], proves: "initial full-canvas no-blend replacement" },
    { page: 1, x: 0, y: 0, expected: [0, 255, 0, 255], proves: "cropped no-blend replacement" },
    { page: 1, x: 3, y: 3, expected: [255, 0, 0, 255], proves: "history outside the crop is retained" },
    { page: 2, x: 0, y: 0, expected: [0, 0, 255, 128], proves: "prior background-disposal is applied before source-over" },
    { page: 3, x: 3, y: 2, expected: [0, 0, 0, 0], proves: "transparent no-blend replacement clears history" },
    { page: 3, x: 3, y: 3, expected: [255, 0, 255, 64], proves: "straight RGBA survives coalescing" },
  ].map((sample) => {
    const actual = rgbaAt(decoded.data, expectedInfo.width, expectedInfo.pageHeight, sample.page, sample.x, sample.y);
    if (!arraysEqual(actual, sample.expected)) {
      errors.push(`fixture semantic pixel p${sample.page}:${sample.x},${sample.y} is ${actual.join(",")}`);
    }
    return { ...sample, actual, exact: arraysEqual(actual, sample.expected) };
  });
  return {
    ok: errors.length === 0,
    fixtureSha256,
    bytes: fixture.length,
    metadata: expectedInfo,
    frameHeaders,
    pages,
    semanticPixels,
    errors,
  };
}

async function inspectAnimatedDecoder() {
  const errors = [];
  const fixture = await verifyDecoderRegressionFixture();
  errors.push(...fixture.errors.map((error) => `fixture: ${error}`));
  const assets = [];
  let verifiedFullCanvasPages = 0;
  let pageSpecificReads = 0;
  let croppedAnmfFrames = 0;
  let backgroundDisposalFrames = 0;

  for (const oracle of PINNED_DECODER_ORACLES) {
    const absolutePath = path.join(repositoryRoot, oracle.path);
    const encoded = await readFile(absolutePath);
    const frameHeaders = parseAnimatedWebpFrameHeaders(encoded);
    const metadata = await sharp(encoded, { animated: true, failOn: "error" }).metadata();
    const decoded = await sharp(encoded, {
      animated: true,
      failOn: "error",
      sequentialRead: true,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const assetErrors = [];
    const fullStackSha256 = sha256(decoded.data);
    const pageHeight = decoded.info.pageHeight ?? decoded.info.height;
    if (
      decoded.info.width !== oracle.width
      || pageHeight !== oracle.pageHeight
      || decoded.info.pages !== oracle.pages
      || decoded.info.channels !== 4
    ) {
      assetErrors.push("decoded stack metadata differs from its pinned oracle");
    }
    if (frameHeaders.length !== oracle.pages) {
      assetErrors.push(`ANMF frame coverage is ${frameHeaders.length}/${oracle.pages}`);
    }
    if (fullStackSha256 !== oracle.fullStackSha256) {
      assetErrors.push("full coalesced RGBA stack differs from its independent oracle");
    }
    const disposalPages = frameHeaders
      .filter(({ disposeToBackground }) => disposeToBackground)
      .map(({ index }) => index);
    if (!arraysEqual(disposalPages, oracle.disposalPages)) {
      assetErrors.push(`background-disposal pages are ${disposalPages.join(",")}; expected ${oracle.disposalPages.join(",")}`);
    }
    const pageBytes = oracle.width * oracle.pageHeight * 4;
    const pageSpecificComparisons = new Map();
    const pageAccessDigest = createHash("sha256");
    let pageAccessDifferingBytes = 0;
    let pageAccessMaximumChannelDelta = 0;
    let pageAccessMismatchPages = 0;
    if (oracle.pageSpecific) {
      for (let page = 0; page < oracle.pages; page += 1) {
        const stackPage = decoded.data.subarray(page * pageBytes, (page + 1) * pageBytes);
        const pageRead = await sharp(encoded, {
          animated: true,
          failOn: "error",
          page,
          pages: 1,
          sequentialRead: true,
        }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const comparison = bufferDifference(pageRead.data, stackPage);
        const pageReadSha256 = sha256(pageRead.data);
        const stackPageSha256 = sha256(stackPage);
        pageSpecificComparisons.set(page, comparison);
        pageAccessDigest.update(`${page}\0${pageReadSha256}\0${stackPageSha256}\n`);
        pageSpecificReads += 1;
        pageAccessDifferingBytes += comparison.differingBytes;
        pageAccessMaximumChannelDelta = Math.max(
          pageAccessMaximumChannelDelta,
          comparison.maximumChannelDelta,
        );
        if (!comparison.equal) {
          pageAccessMismatchPages += 1;
          assetErrors.push(`page-specific read ${page} differs from its independently pinned full-stack slice`);
        }
      }
    }
    const sampledPages = [];
    for (const [pageText, expectedSha256] of Object.entries(oracle.pageSha256)) {
      const page = Number(pageText);
      const stackPage = decoded.data.subarray(page * pageBytes, (page + 1) * pageBytes);
      const stackSha256 = sha256(stackPage);
      if (stackSha256 !== expectedSha256) {
        assetErrors.push(`coalesced page ${page} differs from its independent oracle`);
      }
      const pageSpecificComparison = pageSpecificComparisons.get(page) ?? null;
      sampledPages.push({
        page,
        sha256: stackSha256,
        expectedSha256,
        exact: stackSha256 === expectedSha256,
        pageSpecificComparison,
      });
    }
    const croppedFrames = frameHeaders.filter(({ x, y, width, height }) => (
      x !== 0 || y !== 0 || width !== oracle.width || height !== oracle.pageHeight
    )).length;
    const noBlendFrames = frameHeaders.filter(({ blendMode }) => blendMode === "no-blend").length;
    const sourceOverFrames = frameHeaders.length - noBlendFrames;
    verifiedFullCanvasPages += oracle.pages;
    croppedAnmfFrames += croppedFrames;
    backgroundDisposalFrames += disposalPages.length;
    errors.push(...assetErrors.map((error) => `${oracle.id}: ${error}`));
    assets.push({
      id: oracle.id,
      path: oracle.path,
      encodedSha256: sha256(encoded),
      metadata: {
        width: metadata.width,
        stackedHeight: metadata.height,
        pageHeight: metadata.pageHeight ?? metadata.height,
        pages: metadata.pages,
        channels: metadata.channels,
      },
      anmf: {
        frames: frameHeaders.length,
        croppedFrames,
        noBlendFrames,
        sourceOverFrames,
        backgroundDisposalFrames: disposalPages.length,
        backgroundDisposalPages: disposalPages,
      },
      decodedFullStackSha256: fullStackSha256,
      expectedFullStackSha256: oracle.fullStackSha256,
      fullStackExact: fullStackSha256 === oracle.fullStackSha256,
      pageAccessModeUsedByAudit: oracle.pageSpecific ? "page-specific" : "full-stack",
      pageAccessAudit: oracle.pageSpecific ? {
        expectedPages: oracle.pages,
        inspectedPages: pageSpecificComparisons.size,
        mismatchPages: pageAccessMismatchPages,
        differingBytes: pageAccessDifferingBytes,
        maximumChannelDelta: pageAccessMaximumChannelDelta,
        orderedPagePairDigestSha256: pageAccessDigest.digest("hex"),
        exact: pageSpecificComparisons.size === oracle.pages && pageAccessMismatchPages === 0,
      } : {
        expectedPages: oracle.pages,
        inspectedPages: oracle.pages,
        mismatchPages: 0,
        differingBytes: 0,
        maximumChannelDelta: 0,
        orderedPagePairDigestSha256: null,
        exact: true,
      },
      sampledPages,
      ok: assetErrors.length === 0,
      errors: assetErrors,
    });
  }

  return {
    ok: errors.length === 0,
    semantics: "full-canvas history-coalesced straight RGBA",
    primaryDecoder: {
      library: "sharp/libvips",
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      libwebpVersion: sharp.versions.webp,
    },
    independentOracle: {
      canonical: "libwebp WebPAnimDecoder with MODE_RGBA",
      secondary: "ffmpeg RGBA rawvideo with -fps_mode passthrough",
      agreement: "byte-identical full-canvas RGBA",
      warning: "fragment extractors are not valid visible-frame decoders because ANMF crop, blend, disposal, and history are required",
    },
    verifiedAssets: assets.length,
    verifiedFullCanvasPages,
    pageSpecificReads,
    croppedAnmfFrames,
    backgroundDisposalFrames,
    fixture,
    assets,
    errors,
  };
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) throw new Error(`Expected six-digit RGB, received ${JSON.stringify(value)}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function maximumChannelDistance(left, right) {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  );
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sourceLabel(context) {
  if (context.kind.startsWith("shipping")) {
    return `${context.variant}:page-${context.page}:r${context.row}c${context.column}`;
  }
  return `${context.effect}:encoded-${context.encodedPage}:nominal-${context.nominalFirst}-${context.nominalLast}`;
}

function makePixelAccumulator() {
  return {
    inspectedFrames: 0,
    inspectedPixelsPerVariant: 0,
    transparentPixelsAcrossVariants: 0,
    visiblePixelsAcrossVariants: 0,
    opaquePixelsAcrossVariants: 0,
    semiAlphaPixelsAcrossVariants: 0,
    hiddenRgbPixels: 0,
    gutterPixelsAcrossVariants: 0,
    gutterNonZeroRgbaPixels: 0,
    alphaMismatchPixels: 0,
    semiAlphaPairPixels: 0,
    relation: {
      transparent: 0,
      sameRgb: 0,
      inverseRgb: 0,
      equalChannelDelta: 0,
      unclassified: 0,
    },
    matteCandidates: {
      analyzedPixels: 0,
      withoutOpaqueLocalReference: 0,
      total: 0,
      dark: 0,
      light: 0,
      chroma: 0,
      unexplained: 0,
      reciprocalDarkLightPairs: 0,
    },
    outerEdgeContaminationCandidates: {
      total: 0,
      reversedSemitransparent: 0,
      reversedOpaque: 0,
      reciprocalPremattedShell: 0,
      sameNeutralHalo: 0,
      worstCases: [],
      worstCasesByClassification: {
        reversedSemitransparent: [],
        reversedOpaque: [],
        reciprocalPremattedShell: [],
        sameNeutralHalo: [],
      },
    },
    intentionalOuterEdgeFeatureExclusions: {
      total: 0,
      opaqueInverseFeature: 0,
      compactInverseFeature: 0,
      pairedChromaContinuation: 0,
      representativeCases: [],
      representativeCasesByExclusion: {
        opaqueInverseFeature: [],
        compactInverseFeature: [],
        pairedChromaContinuation: [],
      },
    },
    integrityFailureSamples: {
      hiddenRgb: [],
      gutter: [],
      alphaMismatch: [],
    },
    representativeSemiAlphaEdges: [],
    worstUnclassifiedRelations: [],
    worstMatteCandidates: [],
  };
}

function pushWorst(collection, candidate, score) {
  collection.push({ ...candidate, score: round(score, 6) });
  collection.sort((left, right) => right.score - left.score
    || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (collection.length > MAX_WORST_CASES) collection.length = MAX_WORST_CASES;
}

function relationForPixel(dark, light, offset) {
  const darkRgb = [dark[offset], dark[offset + 1], dark[offset + 2]];
  const lightRgb = [light[offset], light[offset + 1], light[offset + 2]];
  const sameSpread = Math.max(
    ...darkRgb.map((value, channel) => Math.abs(value - lightRgb[channel])),
  );
  if (sameSpread <= THRESHOLDS.relationChannelTolerance) {
    return { id: "sameRgb", darkRgb, lightRgb, spread: sameSpread };
  }
  const inverseSpread = Math.max(
    ...darkRgb.map((value, channel) => Math.abs(value + lightRgb[channel] - 255)),
  );
  if (inverseSpread <= THRESHOLDS.relationChannelTolerance) {
    return { id: "inverseRgb", darkRgb, lightRgb, spread: inverseSpread };
  }
  const deltas = darkRgb.map((value, channel) => value - lightRgb[channel]);
  const deltaSpread = Math.max(...deltas) - Math.min(...deltas);
  if (deltaSpread <= THRESHOLDS.relationChannelTolerance) {
    return { id: "equalChannelDelta", darkRgb, lightRgb, spread: deltaSpread, deltas };
  }
  return {
    id: "unclassified",
    darkRgb,
    lightRgb,
    spread: Math.min(sameSpread, inverseSpread, deltaSpread),
    deltas,
  };
}

function compositeRgb(rgb, alpha, background) {
  return rgb.map((value, channel) => Math.floor(
    (value * alpha + background[channel] * (255 - alpha) + 127) / 255,
  ));
}

function minimumReferenceDistance(rgb, references) {
  return Math.min(...references.map((reference) => maximumChannelDistance(rgb, reference)));
}

function inverseFeaturePixel(topology, x, y) {
  if (x < 0 || x >= topology.width || y < 0 || y >= topology.height) return false;
  const offset = (y * topology.width + x) * 4;
  const darkAlpha = topology.dark[offset + 3];
  if (darkAlpha === 0 || topology.light[offset + 3] !== darkAlpha) return false;
  const darkRgb = [topology.dark[offset], topology.dark[offset + 1], topology.dark[offset + 2]];
  const lightRgb = [topology.light[offset], topology.light[offset + 1], topology.light[offset + 2]];
  return minimumReferenceDistance(darkRgb, [[0, 0, 0], STAGES.dark.rgb])
      <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance
    && minimumReferenceDistance(lightRgb, [[255, 255, 255], STAGES.light.rgb])
      <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance;
}

function makeOuterFeatureTopology(dark, light, width, height) {
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  return { dark, light, width, height, labels, components: [] };
}

function inverseFeatureComponentAt(topology, startX, startY) {
  if (startX < 0 || startX >= topology.width || startY < 0 || startY >= topology.height) return null;
  const startIndex = startY * topology.width + startX;
  const existingLabel = topology.labels[startIndex];
  if (existingLabel === -2) return null;
  if (existingLabel >= 0) return topology.components[existingLabel];
  if (!inverseFeaturePixel(topology, startX, startY)) {
    topology.labels[startIndex] = -2;
    return null;
  }

  const label = topology.components.length;
  const queue = [startIndex];
  topology.labels[startIndex] = label;
  let cursor = 0;
  let pixelCount = 0;
  let minimumX = startX;
  let maximumX = startX;
  let minimumY = startY;
  let maximumY = startY;
  let maximumAlpha = 0;
  while (cursor < queue.length) {
    const index = queue[cursor];
    cursor += 1;
    const x = index % topology.width;
    const y = Math.floor(index / topology.width);
    pixelCount += 1;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
    maximumAlpha = Math.max(maximumAlpha, topology.dark[index * 4 + 3]);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const localX = x + dx;
        const localY = y + dy;
        if (localX < 0 || localX >= topology.width || localY < 0 || localY >= topology.height) continue;
        const localIndex = localY * topology.width + localX;
        if (topology.labels[localIndex] !== -1) continue;
        if (!inverseFeaturePixel(topology, localX, localY)) {
          topology.labels[localIndex] = -2;
          continue;
        }
        topology.labels[localIndex] = label;
        queue.push(localIndex);
      }
    }
  }

  const componentWidth = maximumX - minimumX + 1;
  const componentHeight = maximumY - minimumY + 1;
  const boundingBoxFillRatio = pixelCount / (componentWidth * componentHeight);
  const gate = THRESHOLDS.outerEdgeContamination.intentionalInverseFeature;
  const intentional = pixelCount >= gate.minimumPixels
    && componentWidth >= gate.minimumWidthPx
    && componentHeight >= gate.minimumHeightPx
    && boundingBoxFillRatio >= gate.minimumBoundingBoxFillRatio
    && componentWidth <= topology.width * gate.maximumCanvasDimensionFraction
    && componentHeight <= topology.height * gate.maximumCanvasDimensionFraction;
  const component = {
    label,
    pixelCount,
    bounds: { minimumX, minimumY, maximumX, maximumY },
    width: componentWidth,
    height: componentHeight,
    boundingBoxFillRatio: round(boundingBoxFillRatio),
    maximumAlpha,
    intentional,
  };
  topology.components.push(component);
  return component;
}

function nearbyIntentionalInverseFeature(topology, x, y) {
  for (let radius = 0; radius <= THRESHOLDS.outerEdgeContamination.localReferenceRadiusPx; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const component = inverseFeatureComponentAt(topology, x + dx, y + dy);
        if (component?.intentional) return component;
      }
    }
  }
  return null;
}

function nearbyPairedChromaContinuation(dark, light, width, height, x, y, alpha) {
  const gate = THRESHOLDS.outerEdgeContamination.pairedChromaContinuation;
  for (let radius = 1; radius <= gate.localReferenceRadiusPx; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const localX = x + dx;
        const localY = y + dy;
        if (localX < 0 || localX >= width || localY < 0 || localY >= height) continue;
        const localOffset = (localY * width + localX) * 4;
        const localAlpha = dark[localOffset + 3];
        if (
          localAlpha < alpha + gate.minimumAlphaIncrease
          || light[localOffset + 3] !== localAlpha
        ) continue;
        const darkRgb = [dark[localOffset], dark[localOffset + 1], dark[localOffset + 2]];
        const lightRgb = [light[localOffset], light[localOffset + 1], light[localOffset + 2]];
        const pairedDistance = maximumChannelDistance(darkRgb, lightRgb);
        const darkSpread = Math.max(...darkRgb) - Math.min(...darkRgb);
        const lightSpread = Math.max(...lightRgb) - Math.min(...lightRgb);
        const darkDominantChannel = darkRgb.indexOf(Math.max(...darkRgb));
        const lightDominantChannel = lightRgb.indexOf(Math.max(...lightRgb));
        if (
          darkSpread >= gate.minimumChannelSpread
          && lightSpread >= gate.minimumChannelSpread
          && darkDominantChannel === lightDominantChannel
        ) {
          return {
            x: localX,
            y: localY,
            alpha: localAlpha,
            darkRgb,
            lightRgb,
            distance: radius,
            pairedDistance,
            dominantChannel: darkDominantChannel,
            channelSpread: Math.max(darkSpread, lightSpread),
          };
        }
      }
    }
  }
  return null;
}

function findReciprocalOuterEdgeContamination(dark, light, width, height, x, y, featureTopology) {
  const offset = (y * width + x) * 4;
  const alpha = dark[offset + 3];
  if (alpha === 0 || light[offset + 3] !== alpha) return null;
  const darkRgb = [dark[offset], dark[offset + 1], dark[offset + 2]];
  const lightRgb = [light[offset], light[offset + 1], light[offset + 2]];

  let edgeReference = null;
  let primaryFillReference = null;
  let featureInkReference = null;
  // A real shell outline lies between transparent exterior pixels and opaque
  // primary fill on the same local normal. Merely finding both somewhere in a
  // square neighborhood falsely labels eyes, arms, and nearby satellites.
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  for (const [dx, dy] of directions) {
    let directionalEdge = null;
    let directionalFill = null;
    for (let distance = 1; distance <= THRESHOLDS.outerEdgeContamination.localReferenceRadiusPx; distance += 1) {
      const edgeX = x + dx * distance;
      const edgeY = y + dy * distance;
      if (edgeX < 0 || edgeX >= width || edgeY < 0 || edgeY >= height) break;
      const edgeOffset = (edgeY * width + edgeX) * 4;
      const edgeDarkAlpha = dark[edgeOffset + 3];
      const edgeLightAlpha = light[edgeOffset + 3];
      if (
        edgeDarkAlpha <= THRESHOLDS.outerEdgeContamination.maximumEdgeAlpha
        && edgeLightAlpha <= THRESHOLDS.outerEdgeContamination.maximumEdgeAlpha
      ) {
        directionalEdge = { x: edgeX, y: edgeY, alpha: edgeDarkAlpha, distance, dx, dy };
        break;
      }
    }
    for (let distance = 1; distance <= THRESHOLDS.outerEdgeContamination.localReferenceRadiusPx; distance += 1) {
      const fillX = x - dx * distance;
      const fillY = y - dy * distance;
      if (fillX < 0 || fillX >= width || fillY < 0 || fillY >= height) break;
      const fillOffset = (fillY * width + fillX) * 4;
      const fillDarkAlpha = dark[fillOffset + 3];
      const fillLightAlpha = light[fillOffset + 3];
      if (fillDarkAlpha !== 255 || fillLightAlpha !== 255) continue;
      const localDarkRgb = [dark[fillOffset], dark[fillOffset + 1], dark[fillOffset + 2]];
      const localLightRgb = [light[fillOffset], light[fillOffset + 1], light[fillOffset + 2]];
      const darkFillDistance = minimumReferenceDistance(localDarkRgb, [[255, 255, 255], STAGES.light.rgb]);
      const lightFillDistance = minimumReferenceDistance(localLightRgb, [[0, 0, 0], STAGES.dark.rgb]);
      if (
        darkFillDistance <= THRESHOLDS.outerEdgeContamination.maximumPrimaryFillReferenceDistance
        && lightFillDistance <= THRESHOLDS.outerEdgeContamination.maximumPrimaryFillReferenceDistance
      ) {
        directionalFill = {
          x: fillX,
          y: fillY,
          darkRgb: localDarkRgb,
          lightRgb: localLightRgb,
          darkDistance: darkFillDistance,
          lightDistance: lightFillDistance,
          distance,
          dx: -dx,
          dy: -dy,
        };
        break;
      }
    }
    if (directionalEdge && directionalFill) {
      edgeReference = directionalEdge;
      primaryFillReference = directionalFill;
      break;
    }
  }
  if (!edgeReference || !primaryFillReference) return null;

  // The expressive eyes and other inverse-color features can legitimately
  // meet the silhouette. Their antialiased overlap with the primary body is
  // not a background matte. Record a nearby opaque feature core so that only
  // isolated outer-shell contaminants are classified below.
  for (let radius = 1; radius <= THRESHOLDS.outerEdgeContamination.localReferenceRadiusPx; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const featureX = x + dx;
        const featureY = y + dy;
        if (featureX < 0 || featureX >= width || featureY < 0 || featureY >= height) continue;
        const featureOffset = (featureY * width + featureX) * 4;
        if (dark[featureOffset + 3] !== 255 || light[featureOffset + 3] !== 255) continue;
        const featureDarkRgb = [dark[featureOffset], dark[featureOffset + 1], dark[featureOffset + 2]];
        const featureLightRgb = [light[featureOffset], light[featureOffset + 1], light[featureOffset + 2]];
        const featureDarkDistance = minimumReferenceDistance(featureDarkRgb, [[0, 0, 0], STAGES.dark.rgb]);
        const featureLightDistance = minimumReferenceDistance(featureLightRgb, [[255, 255, 255], STAGES.light.rgb]);
        if (
          featureDarkDistance <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance
          && featureLightDistance <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance
        ) {
          featureInkReference = {
            x: featureX,
            y: featureY,
            darkRgb: featureDarkRgb,
            lightRgb: featureLightRgb,
            darkDistance: featureDarkDistance,
            lightDistance: featureLightDistance,
          };
          break;
        }
      }
      if (featureInkReference) break;
    }
    if (featureInkReference) break;
  }

  const reversedDarkDistance = minimumReferenceDistance(darkRgb, [[0, 0, 0], STAGES.dark.rgb]);
  const reversedLightDistance = minimumReferenceDistance(lightRgb, [[255, 255, 255], STAGES.light.rgb]);
  const reversed = reversedDarkDistance
    <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance
    && reversedLightDistance
    <= THRESHOLDS.outerEdgeContamination.maximumKeylineReferenceDistance;
  const expectedPremattedDark = compositeRgb(primaryFillReference.darkRgb, alpha, STAGES.dark.rgb);
  const expectedPremattedLight = compositeRgb(primaryFillReference.lightRgb, alpha, STAGES.light.rgb);
  const premattedDarkDistance = maximumChannelDistance(darkRgb, expectedPremattedDark);
  const premattedLightDistance = maximumChannelDistance(lightRgb, expectedPremattedLight);
  const prematted = alpha >= MATTE_ANALYSIS_MIN_ALPHA
    && alpha <= MATTE_ANALYSIS_MAX_ALPHA
    && premattedDarkDistance <= THRESHOLDS.outerEdgeContamination.maximumPremattedDistance
    && premattedLightDistance <= THRESHOLDS.outerEdgeContamination.maximumPremattedDistance;
  const darkNeutralSpread = Math.max(...darkRgb) - Math.min(...darkRgb);
  const lightNeutralSpread = Math.max(...lightRgb) - Math.min(...lightRgb);
  const neutralPairDistance = maximumChannelDistance(darkRgb, lightRgb);
  const sameNeutral = darkNeutralSpread
    <= THRESHOLDS.outerEdgeContamination.maximumNeutralChannelSpread
    && lightNeutralSpread <= THRESHOLDS.outerEdgeContamination.maximumNeutralChannelSpread
    && neutralPairDistance <= THRESHOLDS.outerEdgeContamination.maximumNeutralPairDistance;
  const intentionalInverseFeature = (reversed || sameNeutral)
    ? nearbyIntentionalInverseFeature(featureTopology, x, y)
    : null;
  const pairedChromaContinuation = sameNeutral
    ? nearbyPairedChromaContinuation(dark, light, width, height, x, y, alpha)
    : null;
  const exclusion = featureInkReference
    ? "opaqueInverseFeature"
    : intentionalInverseFeature
      ? "compactInverseFeature"
      : pairedChromaContinuation
        ? "pairedChromaContinuation"
        : null;
  let classification = null;
  const onePixelOpaqueOutline = alpha === 255
    && edgeReference.distance === 1
    && primaryFillReference.distance === 1;
  const potentiallyContaminated = (reversed && (alpha < 255 || onePixelOpaqueOutline))
    || prematted
    || sameNeutral;
  if (reversed && !exclusion && (alpha < 255 || onePixelOpaqueOutline)) {
    classification = alpha === 255 ? "reversedOpaque" : "reversedSemitransparent";
  }
  else if (prematted && !exclusion) classification = "reciprocalPremattedShell";
  else if (sameNeutral && !exclusion) classification = "sameNeutralHalo";
  if (!classification && !(exclusion && potentiallyContaminated)) return null;
  return {
    alpha,
    classification,
    exclusion,
    darkRgb,
    lightRgb,
    reversedDarkDistance,
    reversedLightDistance,
    expectedPremattedDark,
    expectedPremattedLight,
    premattedDarkDistance,
    premattedLightDistance,
    darkNeutralSpread,
    lightNeutralSpread,
    neutralPairDistance,
    edgeReference,
    primaryFillReference,
    featureInkReference,
    intentionalInverseFeature,
    pairedChromaContinuation,
  };
}

function findMatteCandidate(rgba, width, height, x, y) {
  const offset = (y * width + x) * 4;
  const alpha = rgba[offset + 3];
  if (alpha < MATTE_ANALYSIS_MIN_ALPHA || alpha > MATTE_ANALYSIS_MAX_ALPHA) return null;
  const rgb = [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
  let bestStraight = null;
  let bestMatte = null;

  for (let radius = 1; radius <= LOCAL_REFERENCE_RADIUS_PX; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const localX = x + dx;
        const localY = y + dy;
        if (localX < 0 || localX >= width || localY < 0 || localY >= height) continue;
        const referenceOffset = (localY * width + localX) * 4;
        if (rgba[referenceOffset + 3] !== 255) continue;
        const referenceRgb = [
          rgba[referenceOffset],
          rgba[referenceOffset + 1],
          rgba[referenceOffset + 2],
        ];
        const straightDistance = maximumChannelDistance(rgb, referenceRgb);
        if (!bestStraight || straightDistance < bestStraight.distance) {
          bestStraight = { distance: straightDistance, rgb: referenceRgb, x: localX, y: localY };
        }
        for (const matte of MATTE_REFERENCES) {
          const expected = compositeRgb(referenceRgb, alpha, matte.rgb);
          const distance = maximumChannelDistance(rgb, expected);
          if (!bestMatte || distance < bestMatte.distance) {
            bestMatte = {
              distance,
              expected,
              matte,
              referenceRgb,
              referenceX: localX,
              referenceY: localY,
            };
          }
        }
      }
    }
    if (bestStraight?.distance === 0) break;
  }

  if (!bestStraight || !bestMatte) return { alpha, rgb, noReference: true };
  const advantage = bestStraight.distance - bestMatte.distance;
  const likely = bestMatte.distance <= THRESHOLDS.matteCandidate.maximumMatteDistance
    && bestStraight.distance >= THRESHOLDS.matteCandidate.minimumStraightDistance
    && advantage >= THRESHOLDS.matteCandidate.minimumMatteAdvantage;
  return {
    alpha,
    rgb,
    noReference: false,
    likely,
    advantage,
    straight: bestStraight,
    matte: bestMatte,
  };
}

function presentMatteCandidate(candidate, variant, x, y, context, relation) {
  const actualComposites = Object.fromEntries(Object.entries(STAGES).map(([stage, config]) => [
    stage,
    compositeRgb(candidate.rgb, candidate.alpha, config.rgb),
  ]));
  const referenceComposites = Object.fromEntries(Object.entries(STAGES).map(([stage, config]) => [
    stage,
    compositeRgb(candidate.matte.referenceRgb, candidate.alpha, config.rgb),
  ]));
  return {
    frame: sourceLabel(context),
    repeats: context.weight,
    variant,
    x,
    y,
    alpha: candidate.alpha,
    rgb: candidate.rgb,
    localOpaqueReference: {
      x: candidate.matte.referenceX,
      y: candidate.matte.referenceY,
      rgb: candidate.matte.referenceRgb,
    },
    closestMatte: candidate.matte.matte.id,
    matteCategory: candidate.matte.matte.category,
    straightDistance: candidate.straight.distance,
    matteDistance: candidate.matte.distance,
    matteAdvantage: candidate.advantage,
    pairRelation: relation.id,
    actualComposites,
    localReferenceComposites: referenceComposites,
    maximumCompositeDifference: Math.max(
      ...Object.keys(STAGES).flatMap((stage) => actualComposites[stage].map(
        (value, channel) => Math.abs(value - referenceComposites[stage][channel]),
      )),
    ),
  };
}

function inspectFramePair(dark, light, width, height, context, accumulator) {
  const expectedBytes = width * height * 4;
  if (dark.length !== expectedBytes || light.length !== expectedBytes) {
    throw new Error(`${sourceLabel(context)} must contain ${expectedBytes} RGBA bytes per variant`);
  }
  const weight = context.weight;
  const gutterPx = context.gutterPx ?? SAFETY_GUTTER_PX;
  accumulator.inspectedFrames += weight;
  accumulator.inspectedPixelsPerVariant += width * height * weight;
  const featureTopology = makeOuterFeatureTopology(dark, light, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inGutter = x < gutterPx
        || x >= width - gutterPx
        || y < gutterPx
        || y >= height - gutterPx;
      if (inGutter) accumulator.gutterPixelsAcrossVariants += 2 * weight;

      for (const [variant, rgba] of [["dark", dark], ["light", light]]) {
        const alpha = rgba[offset + 3];
        const rgbNonZero = rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0;
        if (alpha === 0) {
          accumulator.transparentPixelsAcrossVariants += weight;
          if (rgbNonZero) {
            accumulator.hiddenRgbPixels += weight;
            pushWorst(accumulator.integrityFailureSamples.hiddenRgb, {
              frame: sourceLabel(context),
              repeats: weight,
              variant,
              x,
              y,
              alpha,
              rgb: [rgba[offset], rgba[offset + 1], rgba[offset + 2]],
              classification: "hiddenRgb",
            }, Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]));
          }
        } else {
          accumulator.visiblePixelsAcrossVariants += weight;
          if (alpha === 255) accumulator.opaquePixelsAcrossVariants += weight;
          else accumulator.semiAlphaPixelsAcrossVariants += weight;
        }
        if (inGutter && (alpha !== 0 || rgbNonZero)) {
          accumulator.gutterNonZeroRgbaPixels += weight;
          pushWorst(accumulator.integrityFailureSamples.gutter, {
            frame: sourceLabel(context),
            repeats: weight,
            variant,
            x,
            y,
            alpha,
            rgb: [rgba[offset], rgba[offset + 1], rgba[offset + 2]],
            classification: "gutter",
          }, alpha * 256 + Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]));
        }
      }

      const darkAlpha = dark[offset + 3];
      const lightAlpha = light[offset + 3];
      if (darkAlpha !== lightAlpha) {
        accumulator.alphaMismatchPixels += weight;
        pushWorst(accumulator.integrityFailureSamples.alphaMismatch, {
          frame: sourceLabel(context),
          repeats: weight,
          variant: "dark",
          pairedVariant: true,
          x,
          y,
          alpha: darkAlpha,
          lightAlpha,
          rgb: [dark[offset], dark[offset + 1], dark[offset + 2]],
          lightRgb: [light[offset], light[offset + 1], light[offset + 2]],
          classification: "alphaMismatch",
        }, Math.abs(darkAlpha - lightAlpha));
        continue;
      }
      if (darkAlpha === 0) {
        accumulator.relation.transparent += weight;
        continue;
      }
      const outerEdgeContamination = findReciprocalOuterEdgeContamination(
        dark,
        light,
        width,
        height,
        x,
        y,
        featureTopology,
      );
      if (outerEdgeContamination) {
        const presented = {
          frame: sourceLabel(context),
          repeats: weight,
          x,
          y,
          alpha: darkAlpha,
          darkRgb: outerEdgeContamination.darkRgb,
          lightRgb: outerEdgeContamination.lightRgb,
          classification: outerEdgeContamination.classification,
          reversedDarkDistance: outerEdgeContamination.reversedDarkDistance,
          reversedLightDistance: outerEdgeContamination.reversedLightDistance,
          expectedPremattedDark: outerEdgeContamination.expectedPremattedDark,
          expectedPremattedLight: outerEdgeContamination.expectedPremattedLight,
          premattedDarkDistance: outerEdgeContamination.premattedDarkDistance,
          premattedLightDistance: outerEdgeContamination.premattedLightDistance,
          neutralPairDistance: outerEdgeContamination.neutralPairDistance,
          edgeReference: outerEdgeContamination.edgeReference,
          primaryFillReference: outerEdgeContamination.primaryFillReference,
          featureInkReference: outerEdgeContamination.featureInkReference,
          intentionalInverseFeature: outerEdgeContamination.intentionalInverseFeature,
          pairedChromaContinuation: outerEdgeContamination.pairedChromaContinuation,
        };
        if (outerEdgeContamination.exclusion) {
          const collection = accumulator.intentionalOuterEdgeFeatureExclusions;
          collection.total += weight;
          collection[outerEdgeContamination.exclusion] += weight;
          const exclusionCandidate = {
            ...presented,
            classification: `intentional-${outerEdgeContamination.exclusion}`,
            exclusion: outerEdgeContamination.exclusion,
          };
          const exclusionScore = outerEdgeContamination.intentionalInverseFeature?.pixelCount
            ?? outerEdgeContamination.pairedChromaContinuation?.alpha
            ?? outerEdgeContamination.featureInkReference?.darkDistance
            ?? 0;
          pushWorst(collection.representativeCases, exclusionCandidate, exclusionScore);
          pushWorst(
            collection.representativeCasesByExclusion[outerEdgeContamination.exclusion],
            exclusionCandidate,
            exclusionScore,
          );
        } else {
          const collection = accumulator.outerEdgeContaminationCandidates;
          collection.total += weight;
          collection[outerEdgeContamination.classification] += weight;
          const score = outerEdgeContamination.classification.startsWith("reversed") ? 1024
            - outerEdgeContamination.reversedDarkDistance
            - outerEdgeContamination.reversedLightDistance
            : outerEdgeContamination.classification === "reciprocalPremattedShell" ? 768
              - outerEdgeContamination.premattedDarkDistance
              - outerEdgeContamination.premattedLightDistance
              : 512 - outerEdgeContamination.neutralPairDistance;
          pushWorst(collection.worstCases, presented, score);
          pushWorst(
            collection.worstCasesByClassification[outerEdgeContamination.classification],
            presented,
            score,
          );
        }
      }
      if (darkAlpha === 255) continue;

      accumulator.semiAlphaPairPixels += weight;
      const relation = relationForPixel(dark, light, offset);
      accumulator.relation[relation.id] += weight;
      if (
        accumulator.representativeSemiAlphaEdges.length < MAX_WORST_CASES
        && darkAlpha >= 96
        && darkAlpha <= 160
      ) {
        pushWorst(accumulator.representativeSemiAlphaEdges, {
          frame: sourceLabel(context),
          repeats: weight,
          variant: "dark",
          x,
          y,
          alpha: darkAlpha,
          rgb: relation.darkRgb,
          lightRgb: relation.lightRgb,
          classification: `natural-${relation.id}`,
        }, 255 - Math.abs(darkAlpha - 128));
      }
      if (relation.id === "unclassified") {
        pushWorst(accumulator.worstUnclassifiedRelations, {
          frame: sourceLabel(context),
          repeats: weight,
          x,
          y,
          alpha: darkAlpha,
          darkRgb: relation.darkRgb,
          lightRgb: relation.lightRgb,
          channelSpread: relation.spread,
        }, relation.spread);
      }

      const pairedMatteCandidates = [];
      for (const [variant, rgba] of [["dark", dark], ["light", light]]) {
        const candidate = findMatteCandidate(rgba, width, height, x, y);
        if (!candidate) continue;
        accumulator.matteCandidates.analyzedPixels += weight;
        if (candidate.noReference) {
          accumulator.matteCandidates.withoutOpaqueLocalReference += weight;
          continue;
        }
        if (!candidate.likely) continue;
        accumulator.matteCandidates.total += weight;
        accumulator.matteCandidates[candidate.matte.matte.category] += weight;
        pairedMatteCandidates.push({ variant, candidate });
        const unexplained = relation.id === "unclassified";
        if (unexplained) accumulator.matteCandidates.unexplained += weight;
        const presented = presentMatteCandidate(candidate, variant, x, y, context, relation);
        pushWorst(
          accumulator.worstMatteCandidates,
          { ...presented, unexplained },
          presented.maximumCompositeDifference + (unexplained ? 512 : 0),
        );
      }
      if (
        outerEdgeContamination?.classification === "reciprocalPremattedShell"
        && relation.id === "inverseRgb"
        && pairedMatteCandidates.length === 2
        && (
          pairedMatteCandidates[0].candidate.matte.matte.category === "dark"
            && pairedMatteCandidates[1].candidate.matte.matte.category === "light"
          || pairedMatteCandidates[0].candidate.matte.matte.category === "light"
            && pairedMatteCandidates[1].candidate.matte.matte.category === "dark"
        )
      ) {
        accumulator.matteCandidates.reciprocalDarkLightPairs += weight;
      }
    }
  }
}

function finalizePixelAccumulator(accumulator) {
  const visiblePairPixels = accumulator.visiblePixelsAcrossVariants / 2;
  const unclassifiedFraction = accumulator.semiAlphaPairPixels > 0
    ? accumulator.relation.unclassified / accumulator.semiAlphaPairPixels
    : 0;
  const unclassifiedVisibleFraction = visiblePairPixels > 0
    ? accumulator.relation.unclassified / visiblePairPixels
    : 0;
  const unexplainedMatteFraction = accumulator.matteCandidates.analyzedPixels > 0
    ? accumulator.matteCandidates.unexplained / accumulator.matteCandidates.analyzedPixels
    : 0;
  const errors = [];
  if (accumulator.hiddenRgbPixels > THRESHOLDS.maximumHiddenRgbPixels) {
    errors.push(`${accumulator.hiddenRgbPixels} transparent pixels retain hidden RGB`);
  }
  if (accumulator.gutterNonZeroRgbaPixels > THRESHOLDS.maximumGutterNonZeroRgbaPixels) {
    errors.push(`${accumulator.gutterNonZeroRgbaPixels} non-zero RGBA pixels enter a required safety gutter`);
  }
  if (accumulator.alphaMismatchPixels > THRESHOLDS.maximumAlphaMismatchPixels) {
    errors.push(`${accumulator.alphaMismatchPixels} dark/light pixel pairs have unequal alpha`);
  }
  if (unclassifiedVisibleFraction > THRESHOLDS.maximumUnclassifiedVisiblePairFraction) {
    errors.push(`unclassified visible-pair fraction ${round(unclassifiedVisibleFraction)} exceeds ${THRESHOLDS.maximumUnclassifiedVisiblePairFraction}`);
  }
  if (unexplainedMatteFraction > THRESHOLDS.maximumUnexplainedMatteCandidateFraction) {
    errors.push(`unexplained matte-candidate fraction ${round(unexplainedMatteFraction)} exceeds ${THRESHOLDS.maximumUnexplainedMatteCandidateFraction}`);
  }
  if (
    accumulator.matteCandidates.reciprocalDarkLightPairs
    > THRESHOLDS.maximumReciprocalDarkLightMattePairs
  ) {
    errors.push(`${accumulator.matteCandidates.reciprocalDarkLightPairs} reciprocal dark/light semitransparent matte pairs detected`);
  }
  if (
    accumulator.outerEdgeContaminationCandidates.total
    > THRESHOLDS.maximumReciprocalOuterEdgeContaminationPixels
  ) {
    errors.push(`${accumulator.outerEdgeContaminationCandidates.total} reciprocal outer-edge keyline/halo pixels detected`);
  }
  return {
    ok: errors.length === 0,
    ...accumulator,
    visiblePairPixels,
    unclassifiedSemiAlphaPairFraction: round(unclassifiedFraction),
    unclassifiedVisiblePairFraction: round(unclassifiedVisibleFraction),
    unexplainedMatteCandidateFraction: round(unexplainedMatteFraction),
    errors,
  };
}

function extractCell(page, row, column) {
  const cell = Buffer.allocUnsafe(CELL_WIDTH * CELL_HEIGHT * 4);
  let target = 0;
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const start = ((row * CELL_HEIGHT + y) * ATLAS_WIDTH + column * CELL_WIDTH) * 4;
    page.copy(cell, target, start, start + CELL_WIDTH * 4);
    target += CELL_WIDTH * 4;
  }
  return cell;
}

function chromiumPixelatedSourceIndex(targetIndex, sourceSize, samplingLatticeSize) {
  const numerator = (targetIndex * 2 + 1) * sourceSize;
  const denominator = samplingLatticeSize * 2;
  return Math.max(0, Math.min(sourceSize - 1, Math.ceil(numerator / denominator) - 1));
}

function nearestResizeRgba(
  source,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  samplingLatticeWidth = targetWidth,
  samplingLatticeHeight = targetHeight,
) {
  if (
    sourceWidth === targetWidth
    && sourceHeight === targetHeight
    && samplingLatticeWidth === targetWidth
    && samplingLatticeHeight === targetHeight
  ) return source;
  const output = Buffer.allocUnsafe(targetWidth * targetHeight * 4);
  const sourceX = Int16Array.from(
    { length: targetWidth },
    (_, x) => chromiumPixelatedSourceIndex(x, sourceWidth, samplingLatticeWidth),
  );
  const sourceY = Int16Array.from(
    { length: targetHeight },
    (_, y) => chromiumPixelatedSourceIndex(y, sourceHeight, samplingLatticeHeight),
  );
  let outputOffset = 0;
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceOffset = (sourceY[y] * sourceWidth + sourceX[x]) * 4;
      output[outputOffset] = source[sourceOffset];
      output[outputOffset + 1] = source[sourceOffset + 1];
      output[outputOffset + 2] = source[sourceOffset + 2];
      output[outputOffset + 3] = source[sourceOffset + 3];
      outputOffset += 4;
    }
  }
  return output;
}

function displayedCenterForSourceIndex(sourceIndex, sourceSize, targetSize, samplingLatticeSize) {
  let first = -1;
  let last = -1;
  for (let targetIndex = 0; targetIndex < targetSize; targetIndex += 1) {
    if (chromiumPixelatedSourceIndex(targetIndex, sourceSize, samplingLatticeSize) !== sourceIndex) continue;
    if (first < 0) first = targetIndex;
    last = targetIndex;
  }
  if (first >= 0) return (first + last + 1) / 2;
  return Math.max(0.5, Math.min(targetSize - 0.5, (sourceIndex + 0.5) * targetSize / sourceSize));
}

function displayedCenterForOracleSource(row, column, sourceX, sourceY) {
  const map = codexDefaultDpr2CellMap(row, column);
  let xTotal = 0;
  let yTotal = 0;
  let count = 0;
  for (let pixel = 0; pixel < CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx
    * CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx; pixel += 1) {
    if (map[pixel * 2] !== sourceX || map[pixel * 2 + 1] !== sourceY) continue;
    xTotal += pixel % CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx + 0.5;
    yTotal += Math.floor(pixel / CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx) + 0.5;
    count += 1;
  }
  return count > 0 ? { x: xTotal / count, y: yTotal / count } : null;
}

function renderShippingHostFrame(atlasPage, row, column, display) {
  if (display.id === CODEX_DEFAULT_DPR2_DISPLAY.id) {
    return renderCodexDefaultDpr2Frame(atlasPage, row, column);
  }
  const output = Buffer.allocUnsafe(display.deviceWidthPx * display.deviceHeightPx * 4);
  const sourceX = Int16Array.from(
    { length: display.deviceWidthPx },
    (_, x) => column * CELL_WIDTH + chromiumPixelatedSourceIndex(
      x,
      CELL_WIDTH,
      display.samplingLatticeWidthPx,
    ),
  );
  const sourceY = Int16Array.from(
    { length: display.deviceHeightPx },
    (_, y) => row * CELL_HEIGHT + chromiumPixelatedSourceIndex(
      y,
      CELL_HEIGHT,
      display.samplingLatticeHeightPx,
    ),
  );
  let outputOffset = 0;
  for (let y = 0; y < display.deviceHeightPx; y += 1) {
    for (let x = 0; x < display.deviceWidthPx; x += 1) {
      const sourceOffset = (sourceY[y] * ATLAS_WIDTH + sourceX[x]) * 4;
      atlasPage.copy(output, outputOffset, sourceOffset, sourceOffset + 4);
      outputOffset += 4;
    }
  }
  return output;
}

function flattenStraightRgba(source, background) {
  const output = Buffer.allocUnsafe(source.length / 4 * 3);
  let target = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3];
    output[target] = Math.floor((source[offset] * alpha + background[0] * (255 - alpha) + 127) / 255);
    output[target + 1] = Math.floor((source[offset + 1] * alpha + background[1] * (255 - alpha) + 127) / 255);
    output[target + 2] = Math.floor((source[offset + 2] * alpha + background[2] * (255 - alpha) + 127) / 255);
    target += 3;
  }
  return output;
}

function makeSequence(label, pixelsPerFrame) {
  return {
    label,
    pixelsPerFrame,
    frameCount: 0,
    hash: createHash("sha256"),
  };
}

function appendFrameDigest(sequence, frameId, frameDigest) {
  sequence.hash.update(frameId);
  sequence.hash.update("\0");
  sequence.hash.update(frameDigest);
  sequence.hash.update("\n");
  sequence.frameCount += 1;
}

function finishSequence(sequence) {
  return {
    label: sequence.label,
    frameCount: sequence.frameCount,
    pixelsPerFrame: sequence.pixelsPerFrame,
    compositedPixels: sequence.frameCount * sequence.pixelsPerFrame,
    orderedFrameDigestSha256: sequence.hash.digest("hex"),
  };
}

function shippingSequenceKey(variant, display, stage) {
  return `${variant}:${display}:${stage}`;
}

async function inspectShipping() {
  const errors = [];
  const metadataReports = {};
  const atlasPaths = {};
  const expectedDelays = fluidAtlasDelays();

  for (const [variant, config] of Object.entries(SHIPPING_VARIANTS)) {
    const absoluteAtlasPath = path.join(repositoryRoot, config.atlasPath);
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, config.manifestPath), "utf8"));
    const file = await stat(absoluteAtlasPath);
    const metadata = await sharp(absoluteAtlasPath, { animated: true, failOn: "error" }).metadata();
    const pageHeight = metadata.pageHeight ?? metadata.height;
    const variantErrors = [];
    if (manifest.id !== config.petId) variantErrors.push(`manifest id is ${manifest.id}`);
    if (manifest.spriteVersionNumber !== 2) variantErrors.push(`spriteVersionNumber is ${manifest.spriteVersionNumber}`);
    if (manifest.spritesheetPath !== "spritesheet.webp") variantErrors.push(`spritesheetPath is ${manifest.spritesheetPath}`);
    if (metadata.format !== "webp") variantErrors.push(`format is ${metadata.format}`);
    if (metadata.width !== ATLAS_WIDTH || pageHeight !== ATLAS_HEIGHT) {
      variantErrors.push(`page canvas is ${metadata.width}x${pageHeight}`);
    }
    if (metadata.pages !== FLUID_ATLAS_FRAME_COUNT) variantErrors.push(`page count is ${metadata.pages}`);
    if (!arraysEqual(metadata.delay, expectedDelays)) variantErrors.push(`frame delays do not match the ${FLUID_ATLAS_LOOP_MS}ms cumulative schedule`);
    if (metadata.loop !== 0) variantErrors.push(`loop is ${metadata.loop}`);
    if (metadata.hasAlpha !== true || metadata.channels !== 4) variantErrors.push("atlas is not RGBA");
    metadataReports[variant] = {
      path: config.atlasPath,
      bytes: file.size,
      sha256: await hashFile(absoluteAtlasPath),
      manifest: {
        path: config.manifestPath,
        sha256: await hashFile(path.join(repositoryRoot, config.manifestPath)),
        id: manifest.id,
        spriteVersionNumber: manifest.spriteVersionNumber,
        spritesheetPath: manifest.spritesheetPath,
      },
      format: metadata.format,
      width: metadata.width,
      stackedHeight: metadata.height,
      pageHeight,
      pages: metadata.pages,
      delaysMs: metadata.delay,
      durationMs: metadata.delay?.reduce((sum, delay) => sum + delay, 0) ?? null,
      loop: metadata.loop,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      ok: variantErrors.length === 0,
      errors: variantErrors,
    };
    errors.push(...variantErrors.map((error) => `${variant}: ${error}`));

    atlasPaths[variant] = absoluteAtlasPath;
  }

  const pixelAudit = makePixelAccumulator();
  const exactBrowserPixelAudit = makePixelAccumulator();
  const sequences = new Map();
  for (const variant of Object.keys(SHIPPING_VARIANTS)) {
    for (const [display, config] of Object.entries(DISPLAY_PATHS).filter(([id]) => id.startsWith("shipping"))) {
      for (const stage of Object.keys(STAGES)) {
        const key = shippingSequenceKey(variant, display, stage);
        sequences.set(key, makeSequence(key, config.deviceWidthPx * config.deviceHeightPx));
      }
    }
  }

  let inspectedCellPages = 0;
  const unusedAudit = {
    inspectedCellPages: 0,
    inspectedPixels: 0,
    transparentPixels: 0,
    hiddenRgbPixels: 0,
    nonZeroRgbaPixels: 0,
    worstCells: [],
  };
  for (let page = 0; page < FLUID_ATLAS_FRAME_COUNT; page += 1) {
    const pagePair = {};
    for (const variant of ["dark", "light"]) {
      const decoded = await sharp(atlasPaths[variant], {
        animated: true,
        failOn: "error",
        page,
        pages: 1,
        sequentialRead: true,
      }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== ATLAS_WIDTH
        || decoded.info.height !== ATLAS_HEIGHT
        || decoded.info.channels !== 4
      ) {
        throw new Error(`${variant} shipping page ${page} did not decode to the expected RGBA canvas`);
      }
      pagePair[variant] = decoded.data;
    }
    const darkPage = pagePair.dark;
    const lightPage = pagePair.light;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let column = 0; column < REQUIRED_COLUMNS_BY_ROW[row]; column += 1) {
        const cells = {
          dark: extractCell(darkPage, row, column),
          light: extractCell(lightPage, row, column),
        };
        const context = { kind: "shipping", page, row, column, weight: 1, variant: "pair" };
        inspectFramePair(cells.dark, cells.light, CELL_WIDTH, CELL_HEIGHT, context, pixelAudit);
        const exactDark = renderCodexDefaultDpr2Frame(darkPage, row, column);
        const exactLight = renderCodexDefaultDpr2Frame(lightPage, row, column);
        inspectFramePair(
          exactDark,
          exactLight,
          CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx,
          CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx,
          {
            kind: "shipping-default-dpr2-browser-oracle",
            page,
            row,
            column,
            weight: 1,
            variant: "pair",
            gutterPx: SAFETY_GUTTER_PX,
          },
          exactBrowserPixelAudit,
        );
        inspectedCellPages += 2;

        for (const variant of Object.keys(cells)) {
          for (const [display, displayConfig] of Object.entries(DISPLAY_PATHS).filter(([id]) => id.startsWith("shipping"))) {
            const rendered = renderShippingHostFrame(pagePair[variant], row, column, displayConfig);
            for (const [stage, stageConfig] of Object.entries(STAGES)) {
              const composited = flattenStraightRgba(rendered, stageConfig.rgb);
              const key = shippingSequenceKey(variant, display, stage);
              appendFrameDigest(
                sequences.get(key),
                `${variant}:p${page}:r${row}c${column}`,
                sha256(composited),
              );
            }
          }
        }
      }
    }
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let column = REQUIRED_COLUMNS_BY_ROW[row]; column < COLUMNS; column += 1) {
        for (const [variant, atlasPage] of [["dark", darkPage], ["light", lightPage]]) {
          const cell = extractCell(atlasPage, row, column);
          let cellNonZero = 0;
          let cellHiddenRgb = 0;
          for (let offset = 0; offset < cell.length; offset += 4) {
            const rgbNonZero = cell[offset] !== 0 || cell[offset + 1] !== 0 || cell[offset + 2] !== 0;
            const alpha = cell[offset + 3];
            if (alpha === 0) unusedAudit.transparentPixels += 1;
            if (alpha === 0 && rgbNonZero) cellHiddenRgb += 1;
            if (alpha !== 0 || rgbNonZero) cellNonZero += 1;
          }
          unusedAudit.inspectedCellPages += 1;
          unusedAudit.inspectedPixels += CELL_WIDTH * CELL_HEIGHT;
          unusedAudit.hiddenRgbPixels += cellHiddenRgb;
          unusedAudit.nonZeroRgbaPixels += cellNonZero;
          if (cellNonZero > 0) {
            pushWorst(unusedAudit.worstCells, {
              variant,
              page,
              row,
              column,
              nonZeroRgbaPixels: cellNonZero,
              hiddenRgbPixels: cellHiddenRgb,
            }, cellNonZero);
          }
        }
      }
    }
  }

  const expectedCellPages = REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2;
  if (inspectedCellPages !== expectedCellPages) {
    errors.push(`shipping cell-page coverage is ${inspectedCellPages}/${expectedCellPages}`);
  }
  const expectedUnusedCellPages = UNUSED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2;
  if (unusedAudit.inspectedCellPages !== expectedUnusedCellPages) {
    errors.push(`unused cell-page coverage is ${unusedAudit.inspectedCellPages}/${expectedUnusedCellPages}`);
  }
  if (unusedAudit.nonZeroRgbaPixels !== 0) {
    errors.push(`${unusedAudit.nonZeroRgbaPixels} non-zero RGBA pixels exist in unused cells`);
  }
  if (unusedAudit.hiddenRgbPixels !== 0) {
    errors.push(`${unusedAudit.hiddenRgbPixels} unused transparent pixels retain hidden RGB`);
  }
  const finalizedPixels = finalizePixelAccumulator(pixelAudit);
  const finalizedExactBrowserPixels = finalizePixelAccumulator(exactBrowserPixelAudit);
  const expectedRenderedFramesPerTheme = REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT;
  const expectedSourcePixelsPerTheme = expectedRenderedFramesPerTheme * CELL_WIDTH * CELL_HEIGHT;
  const expectedExactBrowserPixelsPerTheme = expectedRenderedFramesPerTheme
    * CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx
    * CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx;
  if (finalizedPixels.inspectedFrames !== expectedRenderedFramesPerTheme) {
    errors.push(`source pixel accumulator inspected ${finalizedPixels.inspectedFrames}/${expectedRenderedFramesPerTheme} frames`);
  }
  if (finalizedPixels.inspectedPixelsPerVariant !== expectedSourcePixelsPerTheme) {
    errors.push(`source pixel accumulator inspected ${finalizedPixels.inspectedPixelsPerVariant}/${expectedSourcePixelsPerTheme} pixels per variant`);
  }
  if (finalizedExactBrowserPixels.inspectedFrames !== expectedRenderedFramesPerTheme) {
    errors.push(`exact browser pixel accumulator inspected ${finalizedExactBrowserPixels.inspectedFrames}/${expectedRenderedFramesPerTheme} frames`);
  }
  if (finalizedExactBrowserPixels.inspectedPixelsPerVariant !== expectedExactBrowserPixelsPerTheme) {
    errors.push(`exact browser pixel accumulator inspected ${finalizedExactBrowserPixels.inspectedPixelsPerVariant}/${expectedExactBrowserPixelsPerTheme} pixels per variant`);
  }
  errors.push(...finalizedPixels.errors.map((error) => `pixels: ${error}`));
  errors.push(...finalizedExactBrowserPixels.errors.map((error) => `exact browser pixels: ${error}`));
  return {
    ok: errors.length === 0,
    expectedCellPages,
    inspectedCellPages,
    expectedUnusedCellPages,
    unusedAudit: {
      ...unusedAudit,
      ok: unusedAudit.inspectedCellPages === expectedUnusedCellPages
        && unusedAudit.nonZeroRgbaPixels === 0
        && unusedAudit.hiddenRgbPixels === 0,
    },
    requiredCellsPerPage: REQUIRED_CELL_COUNT,
    unusedCellsPerPage: UNUSED_CELL_COUNT,
    atlas: metadataReports,
    pixelAudit: finalizedPixels,
    exactBrowserPixelAudit: {
      ...finalizedExactBrowserPixels,
      path: "7.04rem default fallback at DPR2",
      sampling: CODEX_DEFAULT_DPR2_DISPLAY,
      renderedFramesPerTheme: expectedRenderedFramesPerTheme,
      renderedDevicePixelsPerTheme: expectedExactBrowserPixelsPerTheme,
      renderedFramesAcrossThemes: expectedRenderedFramesPerTheme * 2,
      renderedDevicePixelsAcrossThemes: expectedExactBrowserPixelsPerTheme * 2,
      invariance: "the screenshot-derived map point-samples exact source RGBA bytes; source-gutter transparency is therefore preserved without interpolation",
    },
    compositing: {
      paths: Object.fromEntries(Object.entries(DISPLAY_PATHS).filter(([id]) => id.startsWith("shipping"))),
      surfaces: STAGES,
      sequences: [...sequences.values()].map(finishSequence),
    },
    errors,
  };
}

function timelineMap(delays, nominalDelays) {
  const encodedEnds = [];
  let elapsed = 0;
  for (const delay of delays) {
    elapsed += delay;
    encodedEnds.push(elapsed);
  }
  const mapping = [];
  let nominalStart = 0;
  let encodedPage = 0;
  for (let nominalFrame = 0; nominalFrame < nominalDelays.length; nominalFrame += 1) {
    while (encodedPage < encodedEnds.length - 1 && nominalStart >= encodedEnds[encodedPage]) {
      encodedPage += 1;
    }
    mapping.push(encodedPage);
    nominalStart += nominalDelays[nominalFrame];
  }
  return {
    mapping,
    encodedDurationMs: elapsed,
    nominalDurationMs: nominalStart,
    encodedEnds,
  };
}

function sourceSequenceKey(variant, stage) {
  return `${variant}:sourcePreview:${stage}`;
}

async function sourcePreviewCompositeStack(assetPath, stage, width, height) {
  let pipeline = sharp(assetPath, {
    animated: true,
    failOn: "error",
    sequentialRead: true,
  });
  if (
    width !== DISPLAY_PATHS.sourcePreview.deviceWidthPx
    || height !== DISPLAY_PATHS.sourcePreview.deviceHeightPx
  ) {
    pipeline = pipeline.resize(
      DISPLAY_PATHS.sourcePreview.deviceWidthPx,
      DISPLAY_PATHS.sourcePreview.deviceHeightPx,
      { fit: "fill", kernel: "lanczos3" },
    );
  }
  return pipeline
    .flatten({ background: STAGES[stage].css })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function inspectSourceMotion() {
  const errors = [];
  const manifestPath = path.join(repositoryRoot, "preview/source-lab/motion/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) errors.push(`manifest schemaVersion is ${manifest.schemaVersion}`);
  if (manifest.frameRate !== SOURCE_NOMINAL_FRAME_RATE) errors.push(`manifest frameRate is ${manifest.frameRate}`);
  if (manifest.nominalFrameCount !== SOURCE_NOMINAL_FRAME_COUNT) {
    errors.push(`manifest nominalFrameCount is ${manifest.nominalFrameCount}`);
  }
  if (manifest.presentationDurationMs !== SOURCE_DURATION_MS) {
    errors.push(`manifest presentationDurationMs is ${manifest.presentationDurationMs}`);
  }
  if (manifest.rasterScale !== SOURCE_MOTION_RASTER_SCALE) {
    errors.push(`manifest rasterScale is ${manifest.rasterScale}`);
  }
  if (manifest.frameWidth !== SOURCE_MOTION_FRAME_WIDTH || manifest.frameHeight !== SOURCE_MOTION_FRAME_HEIGHT) {
    errors.push(`manifest frame canvas is ${manifest.frameWidth}x${manifest.frameHeight}`);
  }
  if (manifest.displayWidthCssPx !== SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX) {
    errors.push(`manifest displayWidthCssPx is ${manifest.displayWidthCssPx}`);
  }
  const manifestEffects = [...new Set(manifest.assets.map(({ effect }) => effect))];
  if (!arraysEqual(manifestEffects, EXPECTED_SOURCE_EFFECTS)) {
    errors.push(`manifest effect order is ${manifestEffects.join(",")}`);
  }
  if (manifest.assets.length !== EXPECTED_SOURCE_EFFECTS.length * 2) {
    errors.push(`manifest has ${manifest.assets.length}/${EXPECTED_SOURCE_EFFECTS.length * 2} assets`);
  }
  const inputReports = {};
  for (const [relative, expectedSha256] of Object.entries(manifest.inputs ?? {})) {
    let actualSha256 = null;
    try {
      actualSha256 = await hashFile(path.join(repositoryRoot, relative));
    } catch {
      errors.push(`manifest input ${relative} is unreadable`);
    }
    const current = actualSha256 === expectedSha256;
    if (!current) errors.push(`manifest input ${relative} changed after source-motion generation`);
    inputReports[relative] = { expectedSha256, actualSha256, current };
  }

  const assetsByKey = new Map(manifest.assets.map((asset) => [`${asset.theme}:${asset.effect}`, asset]));
  const sequences = new Map();
  for (const variant of Object.keys(SHIPPING_VARIANTS)) {
    for (const stage of Object.keys(STAGES)) {
      const key = sourceSequenceKey(variant, stage);
      sequences.set(key, makeSequence(
        key,
        DISPLAY_PATHS.sourcePreview.deviceWidthPx * DISPLAY_PATHS.sourcePreview.deviceHeightPx,
      ));
    }
  }
  const pixelAudit = makePixelAccumulator();
  const assetReports = [];
  let inspectedNominalFrames = 0;
  let inspectedEncodedPages = 0;

  for (const effect of EXPECTED_SOURCE_EFFECTS) {
    const pair = {};
    for (const variant of ["dark", "light"]) {
      const asset = assetsByKey.get(`${variant}:${effect}`);
      if (!asset) {
        errors.push(`missing ${variant}/${effect} asset record`);
        continue;
      }
      const absolutePath = path.join(repositoryRoot, asset.path);
      const file = await stat(absolutePath);
      const fileSha256 = await hashFile(absolutePath);
      const metadata = await sharp(absolutePath, { animated: true, failOn: "error" }).metadata();
      const pageHeight = metadata.pageHeight ?? metadata.height;
      const assetErrors = [];
      if (asset.path !== `preview/source-lab/motion/${variant}/${effect}.webp`) {
        assetErrors.push(`path is ${asset.path}`);
      }
      if (asset.sha256 !== fileSha256) assetErrors.push("manifest SHA-256 does not match file");
      if (asset.pages !== metadata.pages) assetErrors.push(`manifest pages ${asset.pages} != file pages ${metadata.pages}`);
      if (asset.pageHeight !== pageHeight) assetErrors.push(`manifest pageHeight ${asset.pageHeight} != ${pageHeight}`);
      if (metadata.format !== "webp") assetErrors.push(`format is ${metadata.format}`);
      if (metadata.width !== SOURCE_MOTION_FRAME_WIDTH || pageHeight !== SOURCE_MOTION_FRAME_HEIGHT) {
        assetErrors.push(`page canvas is ${metadata.width}x${pageHeight}`);
      }
      if (metadata.pages < 1 || metadata.pages > SOURCE_NOMINAL_FRAME_COUNT) {
        assetErrors.push(`encoded page count is ${metadata.pages}`);
      }
      if (metadata.loop !== 0) assetErrors.push(`loop is ${metadata.loop}`);
      if (metadata.hasAlpha !== true || metadata.channels !== 4) assetErrors.push("asset is not RGBA");
      const durationMs = metadata.delay?.reduce((sum, delay) => sum + delay, 0) ?? null;
      if (durationMs !== SOURCE_DURATION_MS) assetErrors.push(`duration is ${durationMs}ms`);
      if (asset.durationMs !== durationMs) assetErrors.push(`manifest duration ${asset.durationMs} != ${durationMs}`);
      const timeline = timelineMap(metadata.delay ?? [], SOURCE_NOMINAL_DELAYS_MS);
      if (timeline.encodedDurationMs !== timeline.nominalDurationMs) {
        assetErrors.push(`encoded/nominal durations differ (${timeline.encodedDurationMs}/${timeline.nominalDurationMs}ms)`);
      }
      if (timeline.mapping.some((page) => page >= metadata.pages)) {
        assetErrors.push("nominal timeline maps beyond the encoded page count");
      }
      const decoded = await sharp(absolutePath, {
        animated: true,
        failOn: "error",
        sequentialRead: true,
      }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== SOURCE_MOTION_FRAME_WIDTH
        || decoded.info.pageHeight !== SOURCE_MOTION_FRAME_HEIGHT
        || decoded.info.pages !== metadata.pages
        || decoded.info.channels !== 4
      ) {
        assetErrors.push("decoded RGBA stack metadata is inconsistent");
      }
      pair[variant] = {
        asset,
        absolutePath,
        bytes: file.size,
        fileSha256,
        metadata,
        pageHeight,
        durationMs,
        timeline,
        decoded,
        assetErrors,
      };
      errors.push(...assetErrors.map((error) => `${variant}/${effect}: ${error}`));
    }

    if (!pair.dark || !pair.light) continue;
    if (!arraysEqual(pair.dark.metadata.delay, pair.light.metadata.delay)) {
      errors.push(`${effect}: dark/light encoded delays differ`);
    }
    if (pair.dark.metadata.pages !== pair.light.metadata.pages) {
      errors.push(`${effect}: dark/light encoded page counts differ`);
    }
    if (!arraysEqual(pair.dark.timeline.mapping, pair.light.timeline.mapping)) {
      errors.push(`${effect}: dark/light nominal timeline mappings differ`);
    }

    const pageCount = Math.min(pair.dark.metadata.pages, pair.light.metadata.pages);
    const pageBytes = SOURCE_MOTION_FRAME_WIDTH * SOURCE_MOTION_FRAME_HEIGHT * 4;
    const nominalByPage = Array.from({ length: pageCount }, () => []);
    pair.dark.timeline.mapping.forEach((page, nominalFrame) => {
      if (nominalByPage[page]) nominalByPage[page].push(nominalFrame);
    });
    for (let encodedPage = 0; encodedPage < pageCount; encodedPage += 1) {
      const nominalFrames = nominalByPage[encodedPage];
      if (nominalFrames.length === 0) {
        errors.push(`${effect}: encoded page ${encodedPage} is unreachable from the nominal 60fps timeline`);
        continue;
      }
      const dark = pair.dark.decoded.data.subarray(encodedPage * pageBytes, (encodedPage + 1) * pageBytes);
      const light = pair.light.decoded.data.subarray(encodedPage * pageBytes, (encodedPage + 1) * pageBytes);
      inspectFramePair(dark, light, SOURCE_MOTION_FRAME_WIDTH, SOURCE_MOTION_FRAME_HEIGHT, {
        kind: "source",
        effect,
        encodedPage,
        nominalFirst: nominalFrames[0],
        nominalLast: nominalFrames.at(-1),
        weight: nominalFrames.length,
        gutterPx: SAFETY_GUTTER_PX * SOURCE_MOTION_RASTER_SCALE,
      }, pixelAudit);
      inspectedEncodedPages += 2;
      inspectedNominalFrames += nominalFrames.length * 2;
    }
    // The paired transparent stacks are no longer needed. Drop the only strong
    // references before producing each opaque preview stack so peak memory is
    // bounded to one effect pair rather than accumulating across effects.
    pair.dark.decoded = null;
    pair.light.decoded = null;

    const compositorReports = {};
    for (const variant of ["dark", "light"]) {
      compositorReports[variant] = {};
      for (const stage of ["dark", "light"]) {
        const composited = await sourcePreviewCompositeStack(
          pair[variant].absolutePath,
          stage,
          pair[variant].metadata.width,
          pair[variant].pageHeight,
        );
        const expectedPageBytes = DISPLAY_PATHS.sourcePreview.deviceWidthPx
          * DISPLAY_PATHS.sourcePreview.deviceHeightPx * 3;
        if (
          composited.info.width !== DISPLAY_PATHS.sourcePreview.deviceWidthPx
          || composited.info.pageHeight !== DISPLAY_PATHS.sourcePreview.deviceHeightPx
          || composited.info.pages !== pair[variant].metadata.pages
          || composited.info.channels !== 3
        ) {
          errors.push(`${variant}/${effect}/${stage}: smooth composite stack has unexpected metadata`);
        }
        const pageDigests = Array.from({ length: composited.info.pages }, (_, page) => sha256(
          composited.data.subarray(page * expectedPageBytes, (page + 1) * expectedPageBytes),
        ));
        const sequence = sequences.get(sourceSequenceKey(variant, stage));
        pair[variant].timeline.mapping.forEach((encodedPage, nominalFrame) => {
          appendFrameDigest(sequence, `${variant}:${effect}:n${nominalFrame}`, pageDigests[encodedPage]);
        });
        compositorReports[variant][stage] = {
          role: SHIPPING_VARIANTS[variant].intendedStage === stage ? "intended" : "opposite",
          encodedPages: composited.info.pages,
          nominalFrames: pair[variant].timeline.mapping.length,
          deviceCanvas: {
            width: composited.info.width,
            height: composited.info.pageHeight,
            channels: composited.info.channels,
          },
          encodedStackSha256: sha256(composited.data),
          nominalOrderedFrameDigestSha256: sha256(Buffer.from(
            pair[variant].timeline.mapping.map((page, nominalFrame) => (
              `${variant}:${effect}:n${nominalFrame}\0${pageDigests[page]}`
            )).join("\n"),
          )),
        };
      }
    }

    assetReports.push({
      effect,
      state: pair.dark.asset.state,
      encodedPagesPerVariant: pair.dark.metadata.pages,
      nominalFramesPerVariant: pair.dark.timeline.mapping.length,
      encodedPageUseCounts: nominalByPage.map((frames) => frames.length),
      dark: presentSourceAsset(pair.dark),
      light: presentSourceAsset(pair.light),
      compositing: compositorReports,
    });
  }

  const expectedNominalFrames = EXPECTED_SOURCE_EFFECTS.length * SOURCE_NOMINAL_FRAME_COUNT * 2;
  const expectedEncodedPages = manifest.assets.reduce((sum, asset) => sum + asset.pages, 0);
  if (inspectedNominalFrames !== expectedNominalFrames) {
    errors.push(`source nominal-frame coverage is ${inspectedNominalFrames}/${expectedNominalFrames}`);
  }
  if (inspectedEncodedPages !== expectedEncodedPages) {
    errors.push(`source encoded-page coverage is ${inspectedEncodedPages}/${expectedEncodedPages}`);
  }
  const finalizedPixels = finalizePixelAccumulator(pixelAudit);
  errors.push(...finalizedPixels.errors.map((error) => `pixels: ${error}`));
  return {
    ok: errors.length === 0,
    manifest: {
      path: "preview/source-lab/motion/manifest.json",
      sha256: await hashFile(manifestPath),
      schemaVersion: manifest.schemaVersion,
      frameRate: manifest.frameRate,
      nominalFrameCount: manifest.nominalFrameCount,
      presentationDurationMs: manifest.presentationDurationMs,
      rasterScale: manifest.rasterScale,
      frameWidth: manifest.frameWidth,
      frameHeight: manifest.frameHeight,
      displayWidthCssPx: manifest.displayWidthCssPx,
      encoder: manifest.encoder,
      inputs: inputReports,
      assetCount: manifest.assets.length,
    },
    expectedNominalFrames,
    inspectedNominalFrames,
    expectedEncodedPages,
    inspectedEncodedPages,
    effects: assetReports,
    pixelAudit: finalizedPixels,
    compositing: {
      path: DISPLAY_PATHS.sourcePreview,
      surfaces: STAGES,
      sequences: [...sequences.values()].map(finishSequence),
    },
    errors,
  };
}

function presentSourceAsset(entry) {
  return {
    path: entry.asset.path,
    bytes: entry.bytes,
    sha256: entry.fileSha256,
    manifestSha256: entry.asset.sha256,
    format: entry.metadata.format,
    width: entry.metadata.width,
    stackedHeight: entry.metadata.height,
    pageHeight: entry.pageHeight,
    encodedPages: entry.metadata.pages,
    delaysMs: entry.metadata.delay,
    durationMs: entry.durationMs,
    loop: entry.metadata.loop,
    channels: entry.metadata.channels,
    hasAlpha: entry.metadata.hasAlpha,
    nominalToEncodedPageSha256: sha256(Buffer.from(entry.timeline.mapping.join(","))),
    ok: entry.assetErrors.length === 0,
    errors: entry.assetErrors,
  };
}

async function inspectSourceMotionCss() {
  const relativePaths = ["preview/styles.css", "preview/index.html", "preview/app.mjs"];
  const [css, html, app] = await Promise.all(relativePaths.map((relative) => (
    readFile(path.join(repositoryRoot, relative), "utf8")
  )));
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const artAncestorTokens = [
    ".source-motion-lab",
    ".source-motion-grid",
    ".source-motion-preview-column",
    ".source-motion-previews",
    ".source-motion-stage",
    "[data-source-motion-image]",
    ".theme-panes",
    ".preview-shell",
  ];
  const forbiddenMatches = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of stripped.matchAll(rulePattern)) {
    const selector = match[1].trim();
    const declarations = match[2];
    const selectorParts = selector.split(",").map((part) => part.trim());
    const relevant = artAncestorTokens.some((token) => selector.includes(token))
      || selectorParts.some((part) => (
        /^(?:\*|html|body|main|img)(?:$|[.#[:\s>+~])/u.test(part)
        || /(?:^|[\s>+~])(?:\*|html|body|main|img)(?:$|[.#[:\s>+~])/u.test(part)
      ));
    if (!relevant) continue;
    const targetsImage = selector.includes("[data-source-motion-image]")
      || /(?:^|[\s>+~])img(?:$|[.#[:])/u.test(selector);
    for (const declaration of declarations.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      const forbiddenFilter = property === "filter" || property === "-webkit-filter";
      const forbiddenImageShadow = targetsImage
        && (property === "box-shadow" || property === "-webkit-box-shadow");
      const forbiddenOpacity = property === "opacity" && !/^(?:1|1\.0+)$/u.test(value);
      const forbiddenBlend = property === "mix-blend-mode" && value.toLowerCase() !== "normal";
      if (
        forbiddenFilter
        || forbiddenImageShadow
        || forbiddenOpacity
        || forbiddenBlend
        || /drop-shadow\s*\(/iu.test(value)
      ) {
        forbiddenMatches.push({ selector, property, value });
      }
    }
  }
  const imageRule = [...stripped.matchAll(rulePattern)].find((match) => (
    match[1].trim() === ".source-motion-stage img"
  ));
  const parsedRules = [...stripped.matchAll(rulePattern)];
  const rootRule = parsedRules.find((match) => match[1].trim() === ":root") ?? null;
  const lightSurfaceRule = parsedRules.find((match) => (
    match[1].includes('[data-surface-theme="light"]')
  )) ?? null;
  const stageSurfaceValue = (rule) => (
    rule?.[2].match(/--stage-surface\s*:\s*(#[0-9a-f]{6})\s*;/iu)?.[1]?.toLowerCase() ?? null
  );
  const cssStageSurfaces = {
    dark: stageSurfaceValue(rootRule),
    light: stageSurfaceValue(lightSurfaceRule),
  };
  const imageRenderingAuto = imageRule != null && /image-rendering\s*:\s*auto\s*;/iu.test(imageRule[2]);
  const heightAuto = imageRule != null && /height\s*:\s*auto\s*;/iu.test(imageRule[2]);
  const displayWidthMatch = imageRule?.[2].match(/width\s*:\s*min\(\s*([0-9.]+)px\s*,/iu) ?? null;
  const displayWidthCssPx = displayWidthMatch ? Number(displayWidthMatch[1]) : null;
  const inlineStyleMatches = [...html.matchAll(/<[^>]*(?:source-motion|data-source-motion-image)[^>]*>/giu)]
    .filter((match) => {
      const style = match[0].match(/\bstyle\s*=\s*["']([^"']*)["']/iu)?.[1] ?? "";
      return /(?:^|;)\s*(?:filter|-webkit-filter|box-shadow|-webkit-box-shadow|opacity|mix-blend-mode)\s*:/iu.test(style)
        || /drop-shadow\s*\(/iu.test(style);
    })
    .map((match) => match[0].replace(/\s+/gu, " "));
  const scriptFilterMatches = [...app.matchAll(/(?:motionImage|motionStage)[^\n;]*(?:\.(?:filter|webkitFilter|boxShadow|opacity|mixBlendMode)|setProperty\s*\(\s*["'](?:filter|-webkit-filter|box-shadow|opacity|mix-blend-mode)|setAttribute\s*\(\s*["']style)/giu)]
    .map((match) => match[0].trim());
  const errors = [];
  if (forbiddenMatches.length > THRESHOLDS.maximumSourceMotionCssFilterMatches) {
    errors.push(`${forbiddenMatches.length} source-motion CSS filter/drop-shadow declarations found`);
  }
  if (!imageRenderingAuto) errors.push(".source-motion-stage img does not explicitly use image-rendering: auto");
  if (!heightAuto) errors.push(".source-motion-stage img does not explicitly use height: auto");
  if (displayWidthCssPx !== SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX) {
    errors.push(`source-motion CSS display width is ${displayWidthCssPx}px; expected ${SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX}px`);
  }
  for (const stage of ["dark", "light"]) {
    if (cssStageSurfaces[stage] !== STAGES[stage].css) {
      errors.push(`${stage} CSS stage surface is ${cssStageSurfaces[stage]}; expected ${STAGES[stage].css}`);
    }
  }
  if (inlineStyleMatches.length > 0) errors.push(`${inlineStyleMatches.length} source-motion images have inline style attributes`);
  if (scriptFilterMatches.length > 0) errors.push(`${scriptFilterMatches.length} source-motion script filter assignments found`);
  return {
    ok: errors.length === 0,
    files: Object.fromEntries(await Promise.all(relativePaths.map(async (relative) => [
      relative,
      { sha256: await hashFile(path.join(repositoryRoot, relative)) },
    ]))),
    matchedImageRule: imageRule ? {
      selector: imageRule[1].trim(),
      declarations: imageRule[2].trim().replace(/\s+/gu, " "),
    } : null,
    imageRenderingAuto,
    heightAuto,
    computedStyleContract: {
      filter: "none",
      webkitFilter: "none",
      boxShadow: "none",
      opacity: 1,
      mixBlendMode: "normal",
      imageRendering: "auto",
      widthCssPx: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
      height: "auto",
      verification: "static cascade and runtime assignment scan over the image and every known ancestor selector",
    },
    displayContract: {
      cssWidthPx: displayWidthCssPx,
      devicePixelRatio: DISPLAY_PATHS.sourcePreview.devicePixelRatio,
      expectedDeviceCanvas: {
        width: DISPLAY_PATHS.sourcePreview.deviceWidthPx,
        height: DISPLAY_PATHS.sourcePreview.deviceHeightPx,
      },
      assetCanvas: {
        width: SOURCE_MOTION_FRAME_WIDTH,
        height: SOURCE_MOTION_FRAME_HEIGHT,
      },
      exactAtTargetDevicePixelRatio: displayWidthCssPx * DISPLAY_PATHS.sourcePreview.devicePixelRatio
        === SOURCE_MOTION_FRAME_WIDTH,
    },
    stageSurfaceContract: {
      css: cssStageSurfaces,
      compositor: Object.fromEntries(Object.entries(STAGES).map(([stage, config]) => [stage, config.css])),
      exact: Object.keys(STAGES).every((stage) => cssStageSurfaces[stage] === STAGES[stage].css),
    },
    forbiddenFilterOrDropShadowMatches: forbiddenMatches,
    inlineStyleMatches,
    scriptFilterMatches,
    errors,
  };
}

const PIXEL_FONT_5X7 = Object.freeze({
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 12, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "=": [0, 31, 0, 31, 0, 0, 0],
  "@": [14, 17, 23, 21, 23, 16, 15],
  "_": [0, 0, 0, 0, 0, 0, 31],
  "?": [14, 17, 1, 2, 4, 0, 4],
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 16, 30, 1, 1, 30],
  6: [14, 16, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
});

function bitmapTextSvg(width, height, lines, {
  color = "#f3f5f5",
  scale = 2,
  x = 10,
  y = 8,
  lineGap = 3,
} = {}) {
  const rectangles = [];
  const advance = 6 * scale;
  const lineHeight = 7 * scale + lineGap;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = String(lines[lineIndex]).toUpperCase();
    for (let characterIndex = 0; characterIndex < text.length; characterIndex += 1) {
      const glyph = PIXEL_FONT_5X7[text[characterIndex]] ?? PIXEL_FONT_5X7["?"];
      const left = x + characterIndex * advance;
      if (left + 5 * scale > width) break;
      for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          if ((glyph[row] & (1 << (4 - column))) === 0) continue;
          rectangles.push(`<rect x="${left + column * scale}" y="${y + lineIndex * lineHeight + row * scale}" width="${scale}" height="${scale}"/>`);
        }
      }
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="${color}">${rectangles.join("")}</g></svg>`);
}

function normalizeVisualCandidate(section, category, candidate, variant = candidate.variant ?? "dark") {
  const rgb = candidate.rgb
    ?? (variant === "dark" ? candidate.darkRgb : candidate.lightRgb)
    ?? [0, 0, 0];
  return {
    section,
    category,
    candidate: {
      ...candidate,
      variant,
      rgb,
      classification: candidate.classification ?? category,
    },
  };
}

function visualCaseKey(entry) {
  const { candidate, category, section } = entry;
  return `${section}:${category}:${candidate.variant}:${candidate.frame}:${candidate.x}:${candidate.y}`;
}

function selectVisualCases(report) {
  const selected = [];
  for (const [section, audit] of [
    ["shipping", report.shipping.pixelAudit],
    ["source", report.sourceMotion.pixelAudit],
  ]) {
    const proposals = [];
    for (const category of ["hiddenRgb", "gutter", "alphaMismatch"]) {
      const candidate = audit.integrityFailureSamples[category][0];
      if (candidate) proposals.push(normalizeVisualCandidate(section, category, candidate));
    }
    const outerByClass = Object.values(
      audit.outerEdgeContaminationCandidates.worstCasesByClassification,
    ).flatMap((candidates) => candidates.slice(0, 1));
    for (const candidate of outerByClass) {
      proposals.push(normalizeVisualCandidate(section, candidate.classification, candidate, "dark"));
      proposals.push(normalizeVisualCandidate(section, candidate.classification, candidate, "light"));
    }
    const firstIntentionalByExclusion = Object.values(
      audit.intentionalOuterEdgeFeatureExclusions.representativeCasesByExclusion,
    ).flatMap((candidates) => candidates.slice(0, 1));
    for (const candidate of firstIntentionalByExclusion) {
      proposals.push(normalizeVisualCandidate(section, candidate.classification, candidate, "dark"));
      proposals.push(normalizeVisualCandidate(section, candidate.classification, candidate, "light"));
    }
    const unexplainedMatte = audit.worstMatteCandidates.find(({ unexplained }) => unexplained);
    if (unexplainedMatte) proposals.push(normalizeVisualCandidate(section, "unexplainedMatte", unexplainedMatte));
    if (audit.worstMatteCandidates[0]) {
      proposals.push(normalizeVisualCandidate(section, "matteCandidate", audit.worstMatteCandidates[0]));
    }
    if (audit.worstUnclassifiedRelations[0]) {
      proposals.push(normalizeVisualCandidate(section, "unclassifiedRelation", audit.worstUnclassifiedRelations[0], "dark"));
    }
    if (audit.representativeSemiAlphaEdges[0]) {
      proposals.push(normalizeVisualCandidate(
        section,
        "representativeSemiAlphaEdge",
        audit.representativeSemiAlphaEdges[0],
      ));
    }
    for (const candidate of audit.worstMatteCandidates) {
      if (proposals.length >= 3) break;
      proposals.push(normalizeVisualCandidate(section, "matteCandidate", candidate));
    }
    const seen = new Set();
    for (const proposal of proposals) {
      const key = visualCaseKey(proposal);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(proposal);
      if (seen.size >= 24) break;
    }
  }
  return selected;
}

async function readVisualFrame(entry) {
  const { candidate, section } = entry;
  if (section === "shipping") {
    const match = /page-(\d+):r(\d+)c(\d+)/u.exec(candidate.frame);
    if (!match) throw new Error(`Could not parse shipping visual frame ${candidate.frame}`);
    const [, pageText, rowText, columnText] = match;
    const row = Number(rowText);
    const column = Number(columnText);
    const decoded = await sharp(
      path.join(repositoryRoot, SHIPPING_VARIANTS[candidate.variant].atlasPath),
      {
        animated: true,
        failOn: "error",
        page: Number(pageText),
        pages: 1,
      },
    ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
      rgba: extractCell(decoded.data, row, column),
      atlasPage: decoded.data,
      row,
      column,
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      canonicalX: candidate.x,
      canonicalY: candidate.y,
      shortLabel: `ship p${pageText} r${rowText}c${columnText}`,
    };
  }

  const match = /^([^:]+):encoded-(\d+)/u.exec(candidate.frame);
  if (!match) throw new Error(`Could not parse source visual frame ${candidate.frame}`);
  const [, effect, pageText] = match;
  const decoded = await sharp(
    path.join(repositoryRoot, `preview/source-lab/motion/${candidate.variant}/${effect}.webp`),
    {
      animated: true,
      failOn: "error",
      page: Number(pageText),
      pages: 1,
    },
  ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = decoded.info.width;
  const height = decoded.info.height;
  return {
    rgba: decoded.data,
    width,
    height,
    canonicalX: candidate.x,
    canonicalY: candidate.y,
    shortLabel: `source ${effect} p${pageText}`,
  };
}

async function makeReviewTile(entry, frame, display, stage) {
  const sourceDisplay = display === "sourcePreview";
  const tileWidth = sourceDisplay ? 600 : 300;
  const tileHeight = sourceDisplay ? 700 : 330;
  const target = DISPLAY_PATHS[display];
  const rgba = sourceDisplay
    ? nearestResizeRgba(
      frame.rgba,
      frame.width,
      frame.height,
      target.deviceWidthPx,
      target.deviceHeightPx,
      target.samplingLatticeWidthPx ?? target.deviceWidthPx,
      target.samplingLatticeHeightPx ?? target.deviceHeightPx,
    )
    : renderShippingHostFrame(frame.atlasPage, frame.row, frame.column, target);
  const flattened = flattenStraightRgba(rgba, STAGES[stage].rgb);
  const framePng = await sharp(flattened, {
    raw: { width: target.deviceWidthPx, height: target.deviceHeightPx, channels: 3 },
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
  const frameLeft = Math.floor((tileWidth - target.deviceWidthPx) / 2);
  const frameTop = 40;
  const oracleCenter = !sourceDisplay && target.id === CODEX_DEFAULT_DPR2_DISPLAY.id
    ? displayedCenterForOracleSource(frame.row, frame.column, frame.canonicalX, frame.canonicalY)
    : null;
  const markerX = frameLeft + (oracleCenter?.x ?? displayedCenterForSourceIndex(
    frame.canonicalX,
    frame.width,
    target.deviceWidthPx,
    target.samplingLatticeWidthPx ?? target.deviceWidthPx,
  ));
  const markerY = frameTop + (oracleCenter?.y ?? displayedCenterForSourceIndex(
    frame.canonicalY,
    frame.height,
    target.deviceHeightPx,
    target.samplingLatticeHeightPx ?? target.deviceHeightPx,
  ));
  const cropRadius = Math.max(4, Math.round(7 * target.deviceWidthPx / frame.width));
  const cropLeft = Math.max(0, Math.min(target.deviceWidthPx - cropRadius * 2, Math.round(markerX - frameLeft) - cropRadius));
  const cropTop = Math.max(0, Math.min(target.deviceHeightPx - cropRadius * 2, Math.round(markerY - frameTop) - cropRadius));
  const zoom = await sharp(flattened, {
    raw: { width: target.deviceWidthPx, height: target.deviceHeightPx, channels: 3 },
  }).extract({
    left: cropLeft,
    top: cropTop,
    width: cropRadius * 2,
    height: cropRadius * 2,
  }).resize(84, 84, { kernel: "nearest" }).png({ compressionLevel: 9, palette: false }).toBuffer();
  const role = SHIPPING_VARIANTS[entry.candidate.variant].intendedStage === stage ? "intended" : "opposite";
  const foreground = stage === "dark" ? "#f5f7f7" : "#111617";
  const zoomLeft = tileWidth - 94;
  const zoomTop = frameTop + target.deviceHeightPx - 94;
  const marker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}">
    <circle cx="${round(markerX, 3)}" cy="${round(markerY, 3)}" r="9" fill="none" stroke="#f9705c" stroke-width="2"/>
    <rect x="${zoomLeft - 2}" y="${zoomTop - 2}" width="88" height="88" rx="5" fill="none" stroke="#f9705c" stroke-width="2"/>
  </svg>`);
  const label = bitmapTextSvg(tileWidth, 36, [
    `${target.cssWidthPx}PX @2X ${role} ${stage}`,
  ], { color: foreground, scale: 2, x: 8, y: 8 });
  const footer = bitmapTextSvg(tileWidth, 42, [
    `A${entry.candidate.alpha ?? "?"} RGB ${entry.candidate.rgb.join(",")}`,
    String(entry.candidate.classification).slice(0, 40),
  ], { color: foreground, scale: 1, x: 8, y: 7, lineGap: 3 });
  return sharp({
    create: {
      width: tileWidth,
      height: tileHeight,
      channels: 3,
      background: {
        r: STAGES[stage].rgb[0],
        g: STAGES[stage].rgb[1],
        b: STAGES[stage].rgb[2],
      },
    },
  }).composite([
    { input: framePng, left: frameLeft, top: frameTop },
    { input: zoom, left: zoomLeft, top: zoomTop },
    { input: marker, left: 0, top: 0 },
    { input: label, left: 0, top: 0 },
    { input: footer, left: 0, top: tileHeight - 42 },
  ]).png({ compressionLevel: 9, palette: false }).toBuffer();
}

async function buildWorstCasesImage(report) {
  const selected = selectVisualCases(report);
  const labelWidth = 190;
  const headerHeight = 70;
  const shippingColumns = [
    ["shipping96", "intended"],
    ["shipping96", "opposite"],
    ["shippingDefaultDpr2", "intended"],
    ["shippingDefaultDpr2", "opposite"],
  ];
  const sourceColumns = [
    ["sourcePreview", "intended"],
    ["sourcePreview", "opposite"],
  ];
  const width = labelWidth + 1200;
  const rowHeights = selected.map(({ section }) => section === "source" ? 712 : 342);
  const height = headerHeight + rowHeights.reduce((sum, value) => sum + value, 0);
  const composites = [];
  composites.push({
    input: bitmapTextSvg(width, headerHeight, [
      "EXHAUSTIVE EDGE QA WORST CASES",
      "RED CIRCLE IS MEASURED PIXEL - INSET IS NEAREST MAGNIFICATION",
    ], { scale: 2, x: 16, y: 12, lineGap: 7 }),
    left: 0,
    top: 0,
  });

  let rowTop = headerHeight;
  for (let row = 0; row < selected.length; row += 1) {
    const entry = selected[row];
    const frame = await readVisualFrame(entry);
    const rowHeight = rowHeights[row];
    const candidate = entry.candidate;
    composites.push({
      input: bitmapTextSvg(labelWidth, rowHeight, [
        `${entry.section.toUpperCase()} ${row + 1}`,
        candidate.variant,
        frame.shortLabel,
        `x${candidate.x} y${candidate.y}`,
        entry.category,
        candidate.unexplained ? "UNEXPLAINED" : candidate.classification,
      ], { scale: 2, x: 12, y: 18, lineGap: 7 }),
      left: 0,
      top: rowTop,
    });
    const columns = entry.section === "source" ? sourceColumns : shippingColumns;
    const tileWidth = entry.section === "source" ? 600 : 300;
    for (let column = 0; column < columns.length; column += 1) {
      const [display, role] = columns[column];
      const intended = SHIPPING_VARIANTS[candidate.variant].intendedStage;
      const stage = role === "intended" ? intended : (intended === "dark" ? "light" : "dark");
      composites.push({
        input: await makeReviewTile(entry, frame, display, stage),
        left: labelWidth + column * tileWidth,
        top: rowTop,
      });
    }
    rowTop += rowHeight;
  }

  const image = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 13, g: 17, b: 18 },
    },
  }).composite(composites).png({ compressionLevel: 9, palette: false }).toBuffer();
  return {
    image,
    report: {
      path: "qa/exhaustive-edge-worst-cases.png",
      sha256: sha256(image),
      width,
      height,
      caseCount: selected.length,
      labelRenderer: "embedded deterministic 5x7 bitmap glyphs",
      columns: {
        shipping: shippingColumns.map(([display, role]) => ({ display, role })),
        source: sourceColumns.map(([display, role]) => ({ display, role })),
      },
      cases: selected.map(({ section, category, candidate }) => ({
        section,
        category,
        frame: candidate.frame,
        variant: candidate.variant,
        x: candidate.x,
        y: candidate.y,
        alpha: candidate.alpha,
        rgb: candidate.rgb,
        classification: candidate.classification,
        unexplained: candidate.unexplained ?? false,
      })),
    },
  };
}

async function buildReport() {
  const contractErrors = [];
  if (
    ATLAS_WIDTH !== 1536
    || ATLAS_HEIGHT !== 2288
    || CELL_WIDTH !== 192
    || CELL_HEIGHT !== 208
    || COLUMNS !== 8
    || ROW_COUNT !== 11
  ) {
    contractErrors.push("v2 atlas geometry no longer matches 1536x2288 / 8x11 / 192x208");
  }
  if (REQUIRED_CELL_COUNT !== 73 || UNUSED_CELL_COUNT !== 15) {
    contractErrors.push(`cell reachability is ${REQUIRED_CELL_COUNT} required / ${UNUSED_CELL_COUNT} unused`);
  }
  const decoderValidation = await inspectAnimatedDecoder();
  const structuralCss = await inspectSourceMotionCss();
  const shipping = await inspectShipping();
  const sourceMotion = await inspectSourceMotion();
  const expectedShippingFramesPerSequence = REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT;
  const expectedSourceFramesPerSequence = EXPECTED_SOURCE_EFFECTS.length * SOURCE_NOMINAL_FRAME_COUNT;
  const expectedShippingSequences = Object.keys(SHIPPING_VARIANTS).length
    * Object.keys(DISPLAY_PATHS).filter((id) => id.startsWith("shipping")).length
    * Object.keys(STAGES).length;
  const expectedSourceSequences = Object.keys(SHIPPING_VARIANTS).length * Object.keys(STAGES).length;
  if (
    shipping.compositing.sequences.length !== expectedShippingSequences
    || shipping.compositing.sequences.some(({ frameCount }) => frameCount !== expectedShippingFramesPerSequence)
  ) {
    contractErrors.push("shipping mathematical-composite sequence coverage is incomplete");
  }
  if (
    sourceMotion.compositing.sequences.length !== expectedSourceSequences
    || sourceMotion.compositing.sequences.some(({ frameCount }) => frameCount !== expectedSourceFramesPerSequence)
  ) {
    contractErrors.push("source-motion mathematical-composite sequence coverage is incomplete");
  }
  for (const sequence of [...shipping.compositing.sequences, ...sourceMotion.compositing.sequences]) {
    if (!/^[0-9a-f]{64}$/u.test(sequence.orderedFrameDigestSha256)) {
      contractErrors.push(`${sequence.label} mathematical-composite digest is invalid`);
    }
    if (sequence.compositedPixels !== sequence.frameCount * sequence.pixelsPerFrame) {
      contractErrors.push(`${sequence.label} mathematical-composite pixel count is inconsistent`);
    }
  }
  const errors = [
    ...contractErrors,
    ...decoderValidation.errors.map((error) => `decoder: ${error}`),
    ...structuralCss.errors.map((error) => `css: ${error}`),
    ...shipping.errors.map((error) => `shipping: ${error}`),
    ...sourceMotion.errors.map((error) => `source-motion: ${error}`),
  ];
  return {
    schemaVersion: 1,
    kind: "exhaustive-edge-and-compositing-qa",
    ok: errors.length === 0,
    contract: {
      atlas: {
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        columns: COLUMNS,
        rows: ROW_COUNT,
        cellWidth: CELL_WIDTH,
        cellHeight: CELL_HEIGHT,
        requiredColumnsByRow: REQUIRED_COLUMNS_BY_ROW,
        requiredCellCount: REQUIRED_CELL_COUNT,
        unusedCellCount: UNUSED_CELL_COUNT,
      },
      shippingTimeline: {
        pages: FLUID_ATLAS_FRAME_COUNT,
        delaysMs: fluidAtlasDelays(),
        loopDurationMs: FLUID_ATLAS_LOOP_MS,
      },
      sourceTimeline: {
        effects: EXPECTED_SOURCE_EFFECTS,
        framesPerEffect: SOURCE_NOMINAL_FRAME_COUNT,
        expectedEncodedPages: sourceMotion.expectedEncodedPages,
        frameRate: SOURCE_NOMINAL_FRAME_RATE,
        durationMs: SOURCE_DURATION_MS,
        nominalDelaysMs: SOURCE_NOMINAL_DELAYS_MS,
        inspectionMethod: "decode each browser-equivalent coalesced page once, then expand duration-coalesced pages onto all nominal 60Hz sample slots",
      },
      safetyGutterPx: {
        shipping: SAFETY_GUTTER_PX,
        sourceMotion: SAFETY_GUTTER_PX * SOURCE_MOTION_RASTER_SCALE,
      },
      stageColors: STAGES,
      displayPaths: DISPLAY_PATHS,
    },
    thresholds: THRESHOLDS,
    decoderValidation,
    structuralCss,
    shipping,
    sourceMotion,
    coverage: {
      shippingCellPages: shipping.inspectedCellPages,
      expectedShippingCellPages: REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2,
      shippingUnusedCellPages: shipping.unusedAudit.inspectedCellPages,
      expectedShippingUnusedCellPages: UNUSED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2,
      sourceMotionNominalFrames: sourceMotion.inspectedNominalFrames,
      expectedSourceMotionNominalFrames: EXPECTED_SOURCE_EFFECTS.length * SOURCE_NOMINAL_FRAME_COUNT * 2,
      sourceMotionEncodedPages: sourceMotion.inspectedEncodedPages,
      expectedSourceMotionEncodedPages: sourceMotion.expectedEncodedPages,
      mathematicallyCompositedShippingOutputs: shipping.compositing.sequences.reduce(
        (sum, sequence) => sum + sequence.frameCount,
        0,
      ),
      mathematicallyCompositedSourceOutputs: sourceMotion.compositing.sequences.reduce(
        (sum, sequence) => sum + sequence.frameCount,
        0,
      ),
      omitted: {
        shippingCellPages: REQUIRED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2
          - shipping.inspectedCellPages,
        shippingUnusedCellPages: UNUSED_CELL_COUNT * FLUID_ATLAS_FRAME_COUNT * 2
          - shipping.unusedAudit.inspectedCellPages,
        sourceMotionNominalFrames: EXPECTED_SOURCE_EFFECTS.length * SOURCE_NOMINAL_FRAME_COUNT * 2
          - sourceMotion.inspectedNominalFrames,
        sourceMotionEncodedPages: sourceMotion.expectedEncodedPages - sourceMotion.inspectedEncodedPages,
      },
      skippedFrames: 0,
      errorCount: errors.length,
    },
    errors,
  };
}

async function main() {
  const report = await buildReport();
  const review = await buildWorstCasesImage(report);
  report.humanReviewArtifact = review.report;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    await verifyRecordedInputHashes(report);
    let current = null;
    let currentReview = null;
    try {
      current = await readFile(reportPath, "utf8");
      currentReview = await readFile(reviewImagePath);
    } catch {
      // The mismatch below reports the missing seal without leaking a local path.
    }
    if (current !== serialized || !currentReview?.equals(review.image)) {
      console.error("FAIL: exhaustive edge QA report/image is missing or stale; run npm run qa:exhaustive");
      process.exitCode = 1;
      return;
    }
  } else {
    await writeExhaustiveArtifactsAtomically({
      report,
      serializedReport: serialized,
      reviewImage: review.image,
    });
  }

  const shippingEdges = report.shipping.pixelAudit;
  const sourceEdges = report.sourceMotion.pixelAudit;
  console.log(
    `${report.ok ? "PASS" : "FAIL"}: exhaustive edge QA; `
      + `${report.coverage.shippingCellPages}/${report.coverage.expectedShippingCellPages} shipping cell-pages, `
      + `${report.coverage.sourceMotionNominalFrames}/${report.coverage.expectedSourceMotionNominalFrames} source frames, `
      + `${shippingEdges.hiddenRgbPixels + report.shipping.unusedAudit.hiddenRgbPixels + sourceEdges.hiddenRgbPixels} hidden-RGB pixels, `
      + `${shippingEdges.gutterNonZeroRgbaPixels + sourceEdges.gutterNonZeroRgbaPixels} gutter pixels, `
      + `${report.errors.length} errors`,
  );
  for (const error of report.errors) console.error(`error: ${error}`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  ANMF_REGRESSION_FIXTURE,
  buildReport,
  chromiumPixelatedSourceIndex,
  finalizePixelAccumulator,
  inspectFramePair,
  inspectSourceMotionCss,
  makePixelAccumulator,
  parseAnimatedWebpFrameHeaders,
  renderShippingHostFrame,
  timelineMap,
  verifyDecoderRegressionFixture,
  verifyRecordedInputHashes,
  writeExhaustiveArtifactsAtomically,
};
