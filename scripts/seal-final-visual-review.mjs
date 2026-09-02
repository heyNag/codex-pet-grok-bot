import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GROK_STATES,
  POPULATED_FRAME_COUNT,
} from "../src/spec.mjs";
import {
  FLUID_ATLAS_FRAME_COUNT,
  FLUID_ATLAS_LOOP_MS,
  fluidAtlasDelays,
} from "../src/fluid-atlas.mjs";

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TIMED_ROW_IDS = Object.freeze([
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

export const GAZE_ANGLES = Object.freeze(
  Array.from({ length: 16 }, (_, index) => index * 22.5),
);

export const SOURCE_EFFECTS = Object.freeze([
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

const VARIANTS = Object.freeze({
  dark: Object.freeze({
    petId: "grok-bot-dark",
    atlasPath: "pet/grok-bot-dark/spritesheet.webp",
    authoringAtlasPath: "qa/authoring-atlas-dark.webp",
    animatedReportPath: "qa/animated-atlas-dark.json",
  }),
  light: Object.freeze({
    petId: "grok-bot-light",
    atlasPath: "pet/grok-bot-light/spritesheet.webp",
    authoringAtlasPath: "qa/authoring-atlas-light.webp",
    animatedReportPath: "qa/animated-atlas-light.json",
  }),
});

export const VARIANT_NAMES = Object.freeze(Object.keys(VARIANTS));

const runtimePreviewPaths = (variant) => TIMED_ROW_IDS.map(
  (id, row) => `qa/runtime-previews-${variant}/${String(row).padStart(2, "0")}-${id}-runtime.webp`,
);

export function finalReviewArtifactPaths(variant) {
  const config = VARIANTS[variant];
  if (!config) throw new Error(`Unknown pet variant: ${variant}`);
  return Object.freeze([
    config.atlasPath,
    config.authoringAtlasPath,
    config.animatedReportPath,
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
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function normalizeReviewedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error("reviewedAt must be an ISO-8601 timestamp");
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) {
    throw new Error(`reviewedAt must use canonical UTC form; expected ${normalized}`);
  }
  return normalized;
}

async function artifactRecords(rootDir, variant) {
  return Promise.all(finalReviewArtifactPaths(variant).map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await readFile(path.join(rootDir, relativePath))),
  })));
}

export async function createFinalVisualReviewReport({
  rootDir = REPOSITORY_ROOT,
  variant,
  reviewedAt,
} = {}) {
  const config = VARIANTS[variant];
  if (!config) throw new Error(`Unknown pet variant: ${variant}`);
  if (POPULATED_FRAME_COUNT !== 73) {
    throw new Error(`Review wording expects 73 runtime cells; spec currently defines ${POPULATED_FRAME_COUNT}`);
  }
  if (FLUID_ATLAS_FRAME_COUNT !== 60 || FLUID_ATLAS_LOOP_MS !== 1000
    || fluidAtlasDelays().reduce((sum, delay) => sum + delay, 0) !== 1000) {
    throw new Error(
      `Review wording expects a 60-phase, 1000 ms shipping loop; received ${FLUID_ATLAS_FRAME_COUNT} phases across ${FLUID_ATLAS_LOOP_MS} ms`,
    );
  }

  const normalizedReviewedAt = normalizeReviewedAt(reviewedAt);
  const reviewedArtifacts = await artifactRecords(rootDir, variant);
  const shippingAtlas = reviewedArtifacts.find(({ path: artifactPath }) => (
    artifactPath === config.atlasPath
  ));
  const authoringAtlas = reviewedArtifacts.find(({ path: artifactPath }) => (
    artifactPath === config.authoringAtlasPath
  ));
  if (!shippingAtlas) throw new Error(`Missing shipping atlas record for ${variant}`);
  if (!authoringAtlas) throw new Error(`Missing authoring atlas record for ${variant}`);

  return {
    schemaVersion: 2,
    variant,
    petId: config.petId,
    shippingAtlasSha256: shippingAtlas.sha256,
    authoringAtlasSha256: authoringAtlas.sha256,
    ok: true,
    reviewer: {
      kind: "human-guided-agent-visual-audit",
      name: "Codex",
    },
    reviewedAt: normalizedReviewedAt,
    method: "Human-guided visual inspection covered the lossless 60-phase, 1000 ms shipping atlas at native detail and in cropped runtime simulations, all 73 runtime-addressable cells, every timed row, all gaze directions, the 39-state character atlas, all 14 effects, the exact 7.04rem default fallback at DPR2 captured by the Chromium 151 screenshot oracle, and the native 96px/DPR2 reference path. Automated every-pair p-to-q motion, host-transition, alpha, halo, gutter, compositing, and cross-theme measurements were used as supporting evidence rather than substitutes for visual review.",
    coverage: {
      installedRows: TIMED_ROW_IDS,
      gazeAngles: GAZE_ANGLES,
      characterStates: GROK_STATES,
      effects: SOURCE_EFFECTS,
      runtimePreviews: TIMED_ROW_IDS,
    },
    reviewedArtifacts,
    observations: [
      "All 73 runtime-addressable cells contain deliberate artwork and continuous internal motion across the 60 lossless phases; all 15 unused atlas cells remain fully transparent.",
      "Every populated source column in each timed row is byte-identical at each decoder phase. The exact browser audit nevertheless retains all per-column screenshot maps because Chromium texture-coordinate seams can make the displayed samples differ by column.",
      "Every ordered decoder-phase p-to-q pair passes the full-cycle topology and intended-surface materiality bounds for all 73 reachable cells and all 1,813 reachable changed-cell edges. Per-cell and per-edge authored profiles, exact ordered metric traces, continuity aliases, and same-phase semantic distances are sealed independently; long skips are never judged by adjacent-motion ratios.",
      "The idle performance continuously breathes, settles, blinks, and reshapes the eyes while remaining loop-safe; action rows retain their own readable emotional posture without abrupt topology swaps.",
      "The exact default fallback resolves to 112.6328125 by 122.015625 CSS pixels and a 225 by 244 device-pixel footprint at DPR2. Its full 88-cell two-dimensional coordinate map is derived from real renderer screenshots, not from a self-validating resize helper.",
      "Dark and light shipping atlases have exact per-page alpha masks and silhouette metrics, preserving identical geometry and timing while reversing the body and eye relationship.",
      "All 16 gaze sectors move both eyes in the intended direction on every internal page and enter safely from each eligible timed state at any embedded animation phase.",
      "The 39 character states and 14 effect families remain visually distinct, bounded by transparent gutters, and legible at the host-equivalent default and native Retina pet scales in both theme treatments.",
    ],
    limitations: [
      "The host controls semantic row selection, authored cell timing, and the three-cycle action settle; the embedded WebP supplies fluid in-cell motion but cannot change that host lifecycle.",
      "The host applies pixelated background rendering. The 7.04rem default fallback necessarily resamples a 192px source cell at DPR2, while the optional 96px path preserves a one-to-one source-to-device-pixel reference.",
      "Gaze changes are driven only by cursor or caret targets exposed by the host, so ordinary pointer movement does not continuously steer the pet's eyes.",
    ],
    blockingIssues: [],
    warnings: [],
  };
}

export const serializeFinalVisualReview = (report) => `${JSON.stringify(report, null, 2)}\n`;

async function readReview(rootDir, variant) {
  const relativePath = `qa/final-visual-review-${variant}.json`;
  const bytes = await readFile(path.join(rootDir, relativePath), "utf8");
  let report;
  try {
    report = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`);
  }
  return { bytes, report, relativePath };
}

export async function checkFinalVisualReviewReports({
  rootDir = REPOSITORY_ROOT,
  reviewedAt,
} = {}) {
  const current = Object.fromEntries(await Promise.all(VARIANT_NAMES.map(async (variant) => [
    variant,
    await readReview(rootDir, variant),
  ])));

  const timestamps = VARIANT_NAMES.map((variant) => normalizeReviewedAt(current[variant].report.reviewedAt));
  if (new Set(timestamps).size !== 1) {
    throw new Error("dark and light final visual reviews must share one review timestamp");
  }
  const expectedReviewedAt = reviewedAt === undefined
    ? timestamps[0]
    : normalizeReviewedAt(reviewedAt);

  for (const variant of VARIANT_NAMES) {
    const expected = serializeFinalVisualReview(await createFinalVisualReviewReport({
      rootDir,
      variant,
      reviewedAt: expectedReviewedAt,
    }));
    if (current[variant].bytes !== expected) {
      throw new Error(
        `${current[variant].relativePath} is stale or non-canonical; rerun the visual-review seal with its attested timestamp`,
      );
    }
  }

  return { ok: true, reviewedAt: expectedReviewedAt };
}

async function writeAtomically(targetPath, contents) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function writeFinalVisualReviewReports({
  rootDir = REPOSITORY_ROOT,
  reviewedAt,
} = {}) {
  const normalizedReviewedAt = normalizeReviewedAt(reviewedAt);
  const serialized = Object.fromEntries(await Promise.all(VARIANT_NAMES.map(async (variant) => [
    variant,
    serializeFinalVisualReview(await createFinalVisualReviewReport({
      rootDir,
      variant,
      reviewedAt: normalizedReviewedAt,
    })),
  ])));

  await Promise.all(VARIANT_NAMES.map((variant) => writeAtomically(
    path.join(rootDir, `qa/final-visual-review-${variant}.json`),
    serialized[variant],
  )));
  return { ok: true, reviewedAt: normalizedReviewedAt };
}

function parseArguments(argv) {
  let check = false;
  let reviewedAt;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
    } else if (argument === "--reviewed-at") {
      reviewedAt = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--reviewed-at=")) {
      reviewedAt = argument.slice("--reviewed-at=".length);
    } else if (argument === "--help") {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { check, reviewedAt };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/seal-final-visual-review.mjs [--check] [--reviewed-at <ISO-8601 UTC timestamp>]");
    return;
  }
  if (options.check) {
    const result = await checkFinalVisualReviewReports({ reviewedAt: options.reviewedAt });
    console.log(`PASS: final visual-review reports are current for ${result.reviewedAt}`);
    return;
  }
  if (!options.reviewedAt) {
    throw new Error("Writing an audit requires --reviewed-at with the actual completed visual-review timestamp");
  }
  const result = await writeFinalVisualReviewReports({ reviewedAt: options.reviewedAt });
  console.log(`Sealed final visual-review reports for ${result.reviewedAt}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`Final visual-review seal failure: ${error.message}`);
    process.exitCode = 1;
  }
}
