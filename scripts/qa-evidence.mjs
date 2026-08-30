import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { GROK_STATES } from "../src/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = "qa/evidence.json";

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
]);

const VARIANTS = Object.freeze({
  dark: Object.freeze({
    id: "grok-bot-dark",
    displayName: "Grok Bot Dark",
    atlasPath: "pet/grok-bot-dark/spritesheet.webp",
    manifestPath: "pet/grok-bot-dark/pet.json",
    bodyColor: "#FFFFFF",
    eyeColor: "#000000",
    artifactPaths: Object.freeze([
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
    manifestPath: "pet/grok-bot-light/pet.json",
    bodyColor: "#000000",
    eyeColor: "#FFFFFF",
    artifactPaths: Object.freeze([
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

async function inspectAtlas(variant, config) {
  const bytes = await readFile(absolute(config.atlasPath));
  const decoded = await sharp(bytes, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  requireCondition(
    info.width === 1536 && info.height === 2288 && info.channels === 4,
    `${variant} atlas must decode to 1536x2288 RGBA`,
  );

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

  requireCondition(hiddenRgbPixels === 0, `${variant} atlas contains ${hiddenRgbPixels} hidden RGB pixels`);
  requireCondition(counts.body >= 10_000, `${variant} atlas is missing a substantial exact body-color region`);
  requireCondition(counts.eyes >= 1_000, `${variant} atlas is missing substantial exact eye/effect ink`);
  for (const name of Object.keys(ACCENT_COLORS)) {
    requireCondition(counts[name] > 0, `${variant} atlas does not contain exact accent ${name}`);
  }

  return Object.freeze({
    path: config.atlasPath,
    sha256: sha256(bytes),
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

async function verifyCustomValidation(variant, config, atlas, manifest) {
  const relative = `qa/validation-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} custom validator schema must be 1`);
  requireCondition(report.variant === variant, `${variant} custom validator variant is wrong`);
  requireCondition(report.petId === config.id, `${variant} custom validator petId is wrong`);
  requireCondition(report.ok === true, `${variant} custom validator must pass`);
  requireCondition(report.atlasSha256 === atlas.sha256, `${variant} custom validator is for a different atlas`);
  verifyEmbeddedShas(report, `${variant} custom validator`, { atlasSha: atlas.sha256 });
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
  requireCondition(report.spritesheet?.expectedPopulatedCells === 74, `${variant} populated-cell count is wrong`);
  requireCondition(report.spritesheet?.expectedUnusedCells === 14, `${variant} unused-cell count is wrong`);
  requireCondition(report.spritesheet?.hiddenRgbPixels === 0, `${variant} custom validator found hidden RGB`);
  requireArray(report.cells, `${variant} custom validator.cells`);
  requireCondition(report.cells.length === 88, `${variant} custom validator must inspect all 88 cells`);
  requireCondition(
    report.cells.every((cell) => cell.hiddenRgbPixels === 0),
    `${variant} custom validator contains a cell with hidden RGB`,
  );
}

async function verifyOfficialValidation(variant, config, atlas) {
  const relative = `qa/official-validation-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.ok === true, `${variant} official validator must pass`);
  requireArtifactPath(report.file, config.atlasPath, `${variant} official validator file`);
  verifyEmbeddedShas(report, `${variant} official validator`, { atlasSha: atlas.sha256 });
  requireCondition(report.sprite_version_number === 2, `${variant} official validator did not confirm v2`);
  requireCondition(String(report.format).toUpperCase() === "WEBP", `${variant} official validator format must be WEBP`);
  requireCondition(report.columns === 8 && report.rows === 11, `${variant} official validator grid is wrong`);
  requireCondition(report.width === 1536 && report.height === 2288, `${variant} official validator dimensions are wrong`);
  requireCondition(report.mode === "RGBA", `${variant} official validator mode must be RGBA`);
  requireCondition(report.transparent_rgb_residue_pixels === 0, `${variant} official validator found hidden RGB`);
  requireEmpty(report, "errors", `${variant} official validator`);
  requireEmpty(report, "warnings", `${variant} official validator`);
  requireArray(report.cells, `${variant} official validator.cells`);
  requireCondition(report.cells.length === 88, `${variant} official validator must inspect all 88 cells`);
}

async function verifyContinuity(variant, atlas) {
  const relative = `qa/look-continuity-${variant}.json`;
  const report = await readJson(relative);
  verifyEmbeddedShas(report, `${variant} look continuity`, { atlasSha: atlas.sha256 });
  requireCondition(
    report.ok === true && report.reviewRequired === false,
    `${variant} look continuity must pass without review`,
  );
  requireArray(report.pairs, `${variant} look continuity.pairs`);
  requireCondition(report.pairs.length === 16, `${variant} look continuity must cover all 16 transitions`);
  requireEmpty(report, "warnings", `${variant} look continuity`);
  requireEmpty(report, "alphaHoles", `${variant} look continuity`);
}

async function verifyDirectionSemantics(variant, config, atlas) {
  const relative = `qa/direction-semantics-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} direction semantics schema must be 1`);
  requireCondition(report.variant === undefined || report.variant === variant, `${variant} direction semantics variant is wrong`);
  requireCondition(report.petId === undefined || report.petId === config.id, `${variant} direction semantics petId is wrong`);
  requireCondition(
    embeddedSha(report, "atlasSha256", "atlas_sha256") === atlas.sha256,
    `${variant} direction semantics are for a different atlas`,
  );
  verifyEmbeddedShas(report, `${variant} direction semantics`, { atlasSha: atlas.sha256 });
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

async function verifyFinalVisualReview(variant, config, atlas) {
  const relative = `qa/final-visual-review-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} final visual review schema must be 1`);
  requireCondition(report.variant === undefined || report.variant === variant, `${variant} final visual review variant is wrong`);
  requireCondition(report.petId === undefined || report.petId === config.id, `${variant} final visual review petId is wrong`);
  requireCondition(
    embeddedSha(report, "atlasSha256", "atlas_sha256") === atlas.sha256,
    `${variant} final visual review is for a different atlas`,
  );
  verifyEmbeddedShas(report, `${variant} final visual review`, { atlasSha: atlas.sha256 });
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
  ];
  return { ok: checks.every((check) => check.pass), checks };
}

async function verifyRuntimeContinuity(variant, atlas) {
  const relative = `qa/runtime-continuity-${variant}.json`;
  const report = await readJson(relative);
  requireCondition(report.schemaVersion === 1, `${variant} runtime continuity schema must be 1`);
  requireCondition(report.kind === "codex-pet-runtime-continuity-theme", `${variant} runtime continuity kind is wrong`);
  requireCondition(report.theme === variant, `${variant} runtime continuity theme is wrong`);
  requireCondition(report.ok === true, `${variant} runtime continuity thresholds failed`);
  requireCondition(report.measurementPolicy === RUNTIME_CONTINUITY_POLICY, `${variant} runtime continuity policy changed`);
  requireCondition(deepEqual(report.thresholds, RUNTIME_CONTINUITY_THRESHOLDS), `${variant} runtime continuity thresholds changed`);
  requireCondition(report.atlas?.sha256 === atlas.sha256, `${variant} runtime continuity is for a different atlas`);
  requireCondition(report.atlas?.width === 1536 && report.atlas?.height === 2288 && report.atlas?.channels === 4, `${variant} runtime continuity atlas dimensions are wrong`);
  requireArtifactPath(report.atlas?.path, VARIANTS[variant].atlasPath, `${variant} runtime continuity atlas.path`);
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

async function verifyVariant(variant, config, atlas) {
  const { manifest, evidence: manifestEvidence } = await verifyManifest(variant, config);
  await verifyCustomValidation(variant, config, atlas, manifest);
  await verifyOfficialValidation(variant, config, atlas);
  await verifyContinuity(variant, atlas);
  await verifyDirectionSemantics(variant, config, atlas);
  await verifyFinalVisualReview(variant, config, atlas);
  await verifyRuntimeContinuity(variant, atlas);
  return {
    manifest: manifestEvidence,
    assertions: Object.freeze({
      manifestIdentity: true,
      customValidator: true,
      officialValidator: true,
      alphaClean: true,
      directionContinuity: true,
      directionSemantics: true,
      finalVisualReview: true,
      runtimeContinuity: true,
      runtimePreviewByteChecks: true,
    }),
  };
}

async function verifyThemeParity(atlases) {
  const report = await readJson("qa/theme-parity.json");
  requireCondition(report.schemaVersion === 1, "theme parity schema must be 1");
  requireCondition(report.ok === true, "theme parity must pass");
  verifyEmbeddedShas(report, "theme parity", {
    darkAtlasSha: atlases.dark.sha256,
    lightAtlasSha: atlases.light.sha256,
  });
  requireCondition(report.darkAtlasSha256 === atlases.dark.sha256, "theme parity dark atlas SHA is stale");
  requireCondition(report.lightAtlasSha256 === atlases.light.sha256, "theme parity light atlas SHA is stale");
  requireCondition(
    report.dimensions?.width === 1536
      && report.dimensions?.height === 2288
      && report.dimensions?.channels === 4,
    "theme parity dimensions are wrong",
  );
  requireCondition(atlases.dark.alphaMaskSha256 === atlases.light.alphaMaskSha256, "theme atlas alpha masks differ");
  requireCondition(report.alphaMismatchPixels === 0, "theme parity found alpha-mask mismatches");
  requireCondition(
    report.alphaMaskSha256?.dark === atlases.dark.alphaMaskSha256
      && report.alphaMaskSha256?.light === atlases.light.alphaMaskSha256,
    "theme parity alpha-mask SHA is stale",
  );
  requireCondition(deepEqual(report.accentColors, ACCENT_COLORS), "theme parity accent palette is wrong");
  requireEmpty(report, "errors", "theme parity");
  requireArray(report.warnings, "theme parity.warnings");

  for (const variant of VARIANT_NAMES) {
    const documented = report.exactAccentColorPixels?.[variant];
    const actual = atlases[variant].exactAccentColorPixels;
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

async function verifyCombinedRuntimeContinuity(atlases) {
  const report = await readJson("qa/runtime-continuity.json");
  requireCondition(report.schemaVersion === 1, "combined runtime continuity schema must be 1");
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
  requireCondition(dark.atlas?.sha256 === atlases.dark.sha256, "combined runtime continuity dark atlas SHA is stale");
  requireCondition(light.atlas?.sha256 === atlases.light.sha256, "combined runtime continuity light atlas SHA is stale");
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
    requireCondition(asset.pageHeight === 208, `${label} page height must be 208`);
    requireCondition(asset.pages >= 75 && asset.pages <= report.nominalFrameCount, `${label} page count is outside the lossless animation bounds`);
    requireCondition(asset.loop === 0, `${label} must loop continuously for the preview bench`);
    requireCondition(asset.durationMs === report.presentationDurationMs, `${label} duration is wrong`);
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

async function verifyOfficialHatchSeal(atlases) {
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
    requireArtifactPath(theme.atlas?.path, config.atlasPath, `${label}.atlas.path`);
    requireCondition(theme.atlas?.sha256 === atlases[variant].sha256, `${label} atlas SHA is stale`);
    requireCondition(theme.atlas?.width === 1536 && theme.atlas?.height === 2288 && theme.atlas?.channels === 4, `${label} atlas dimensions are wrong`);

    const atlasBytes = await readFile(absolute(config.atlasPath));
    const atlasDecoded = await sharp(atlasBytes, { failOn: "error" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    requireCondition(theme.atlas.decodedRgbaSha256 === sha256(atlasDecoded.data), `${label} decoded atlas SHA is stale`);

    const officialValidationPath = `qa/official-validation-${variant}.json`;
    requireArtifactPath(theme.officialValidation?.path, officialValidationPath, `${label}.officialValidation.path`);
    const validationBytes = await readFile(absolute(officialValidationPath));
    requireCondition(theme.officialValidation.sha256 === sha256(validationBytes), `${label} official validation hash is stale`);
    requireCondition(theme.officialValidation.ok === true && theme.officialValidation.errors === 0 && theme.officialValidation.warnings === 0, `${label} official validation summary failed`);

    const frameManifestPath = `qa/official-frames-${variant}/manifest.json`;
    requireArtifactPath(theme.frameExtraction?.path, frameManifestPath, `${label}.frameExtraction.path`);
    const frameManifestBytes = await readFile(absolute(frameManifestPath));
    requireCondition(theme.frameExtraction.sha256 === sha256(frameManifestBytes), `${label} frame manifest hash is stale`);
    requireCondition(theme.frameExtraction.frameCount === 57 && theme.frameExtraction.pixelIdentityVerified === true, `${label} frame extraction attestation is incomplete`);
    const frameManifest = JSON.parse(frameManifestBytes.toString("utf8"));
    requireCondition(frameManifest.schemaVersion === 1 && frameManifest.kind === "codex-pet-official-preview-frame-extraction", `${label} frame manifest schema is wrong`);
    requireCondition(frameManifest.variant === variant, `${label} frame manifest variant is wrong`);
    requireCondition(frameManifest.atlas?.sha256 === atlases[variant].sha256, `${label} frame manifest atlas SHA is stale`);
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

  const atlasDecoded = await sharp(await readFile(absolute(VARIANTS.dark.atlasPath)), { failOn: "error" })
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
    const allowed = axis === "horizontal" ? ["screen-left", "screen-right"] : ["up", "down"];
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
  const atlasEntries = await Promise.all(
    VARIANT_NAMES.map(async (variant) => [variant, await inspectAtlas(variant, VARIANTS[variant])]),
  );
  const atlases = Object.fromEntries(atlasEntries);
  const variantResults = {};
  for (const variant of VARIANT_NAMES) {
    variantResults[variant] = await verifyVariant(variant, VARIANTS[variant], atlases[variant]);
  }
  await verifyOfficialHatchSeal(atlases);
  await verifyThemeParity(atlases);
  await verifyCombinedRuntimeContinuity(atlases);
  await verifySourceMotionStudies();
  const blind = await verifyDarkBlindSuite(atlases.dark);

  return {
    atlases,
    variantResults,
    sharedAssertions: Object.freeze({
      themeAlphaMaskEquality: true,
      exactSourcePalettePresent: true,
      runtimeContinuity: true,
      sourceMotionStudies: true,
      officialHatchSeal: true,
      darkBlindSuite: true,
      ...blind.assertions,
    }),
    blindStimulus: blind.stimulus,
  };
}

async function buildEvidence(verified) {
  const variants = {};
  for (const variant of VARIANT_NAMES) {
    const config = VARIANTS[variant];
    variants[variant] = {
      petId: config.id,
      manifest: verified.variantResults[variant].manifest,
      atlas: {
        path: config.atlasPath,
        sha256: verified.atlases[variant].sha256,
      },
      artifacts: await artifactHashes(config.artifactPaths),
      assertions: verified.variantResults[variant].assertions,
    };
  }
  return {
    schemaVersion: 2,
    variants,
    shared: {
      artifacts: await artifactHashes(SHARED_ARTIFACT_PATHS),
      blindStimulus: verified.blindStimulus,
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
    `Sealed ${artifactCount} QA artifacts for dark ${verified.atlases.dark.sha256} and light ${verified.atlases.light.sha256}`,
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
  requireCondition(evidence.schemaVersion === 2, "QA evidence schema must be 2");
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
    `PASS: ${artifactCount} sealed QA artifacts match dark ${verified.atlases.dark.sha256} and light ${verified.atlases.light.sha256}`,
  );
}

try {
  if (process.argv.slice(2).includes("--seal")) await seal();
  else await verify();
} catch (error) {
  console.error(`QA evidence failure: ${error.message}`);
  process.exitCode = 1;
}
