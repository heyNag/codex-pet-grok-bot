#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
const reportPath = path.join(repositoryRoot, "qa", "official-hatch-qa.json");
const timedRows = ROWS.filter((row) => row.index <= 8);
const args = process.argv.slice(2);
const sealMode = args.includes("--seal");
const unknownArgs = args.filter((argument) => argument !== "--seal");

if (unknownArgs.length > 0) {
  throw new Error("Usage: node scripts/verify-official-hatch-qa.mjs [--seal]");
}

const variants = Object.freeze({
  dark: Object.freeze({
    atlasPath: "qa/authoring-atlas-dark.webp",
    framesRoot: "qa/official-frames-dark",
    previewsRoot: "qa/official-previews-dark",
  }),
  light: Object.freeze({
    atlasPath: "qa/authoring-atlas-light.webp",
    framesRoot: "qa/official-frames-light",
    previewsRoot: "qa/official-previews-light",
  }),
});

const officialScriptNames = Object.freeze([
  "validate_atlas.py",
  "make_contact_sheet.py",
  "make_direction_qa_sheet.py",
  "make_direction_blind_qa_sheet.py",
  "combine_direction_blind_verdicts.py",
  "validate_direction_blind_verdicts.py",
  "measure_direction_continuity.py",
  "render_animation_previews.py",
]);

const officialScriptShas = Object.freeze({
  "validate_atlas.py": "ebbbc77cfbd27ef8476ac6fda716e864cf372a2ed4c2beb27ebdb2487e972194",
  "make_contact_sheet.py": "51e2085b8acb172dcdd5fff9993bdee413f3851b714229ca095dc99cd551aa96",
  "make_direction_qa_sheet.py": "823e81e0aece24d1d6537889c9daaa2660208ff52604509b24fd5e24e7302acb",
  "make_direction_blind_qa_sheet.py": "52f2a29251872449fed51c7744c3f9f503274ee288eb23efc29a2c568b0d52bd",
  "combine_direction_blind_verdicts.py": "4dad56adaad032a4e6d070494b0ab2ca316429cf69363450f9fbf7135d1c2d42",
  "validate_direction_blind_verdicts.py": "7871667432918e0ffcdbb9beaf88a01c0af4b9e2809c5000f7b533a9ddc6e13d",
  "measure_direction_continuity.py": "e24b7065af82eab5638f1fcdeb627d497391a2f1e9ba19801827d1db3a6d8c2d",
  "render_animation_previews.py": "911e8813e1b79b7f9da44fae8a667c044818e8c71f41eaa4b280e91c78cde61e",
});
const officialV2NeutralCellDiagnostic = "idle row 0 column 6 is empty or too sparse (0 pixels)";

const sealedReport = sealMode ? null : JSON.parse(await readFile(reportPath, "utf8"));
const scriptEvidence = sealMode
  ? await readOfficialScriptEvidence()
  : verifySealedOfficialScriptEvidence(sealedReport);

const themes = {};
for (const [name, variant] of Object.entries(variants)) {
  themes[name] = await verifyVariant(name, variant);
}

const report = {
  schemaVersion: 1,
  kind: "codex-pet-official-hatch-qa-seal",
  ok: true,
  officialScripts: scriptEvidence,
  verification: [
    "official validation reports inspect all 88 cells and contain only the audited v2 neutral-cell diagnostic",
    "all 57 timed PNG frames per theme round-trip byte-for-byte to their current atlas cells",
    "all 9 official GIFs per theme have the expected frame counts and duration tables",
    "direction continuity passes all 16 wraparound pairs without warnings or alpha holes",
  ],
  limitations: [
    "The bundled validator marks idle row 0 column 6 as a required neutral-look cell even though the v2 contract assigns neutral/no-vector gaze to idle and leaves that cell unused. The exact single diagnostic is retained and audited; every runtime-required cell passes.",
    "The bundled official GIF renderer uses GIF's indexed palette and binary transparency, so GIFs are lightweight visual QA only; lossless animated WebPs remain the color/alpha-fidelity previews.",
  ],
  themes,
};

if (sealMode) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`official hatch QA verified and sealed at ${path.relative(repositoryRoot, reportPath)}`);
} else {
  requireCondition(deepEqual(report, sealedReport), "official hatch QA seal is stale or incomplete");
  console.log(`PASS: portable read-only official hatch QA recheck (${path.relative(repositoryRoot, reportPath)})`);
}

async function readOfficialScriptEvidence() {
  const scriptsRoot = path.resolve(
    process.env.HATCH_PET_SCRIPTS_ROOT
      ?? "/Applications/ChatGPT.app/Contents/Resources/skills/skills/.curated/hatch-pet/scripts",
  );
  const evidence = {};
  for (const name of officialScriptNames) {
    const scriptPath = path.join(scriptsRoot, name);
    const bytes = await readFile(scriptPath);
    const actualSha = sha256(bytes);
    requireCondition(
      actualSha === officialScriptShas[name],
      `${name} is not the independently audited official hatch-pet script`,
    );
    evidence[name] = { path: `hatch-pet/scripts/${name}`, sha256: actualSha };
  }
  return evidence;
}

function verifySealedOfficialScriptEvidence(existingReport) {
  requireCondition(existingReport?.schemaVersion === 1, "official hatch QA seal schema must be 1");
  requireCondition(existingReport?.kind === "codex-pet-official-hatch-qa-seal", "official hatch QA seal kind is wrong");
  requireCondition(existingReport?.ok === true, "official hatch QA seal must pass");
  const records = existingReport.officialScripts;
  requireCondition(records && typeof records === "object", "official hatch QA script evidence is missing");
  requireCondition(
    deepEqual(Object.keys(records).sort(), [...officialScriptNames].sort()),
    "official hatch QA script set is wrong",
  );
  for (const name of officialScriptNames) {
    requireArtifactSuffix(records[name]?.path, name, `official script ${name}`);
    requireCondition(
      records[name]?.sha256 === officialScriptShas[name],
      `official script ${name} is not the independently audited hatch tool`,
    );
  }
  return records;
}

async function verifyVariant(name, variant) {
  const atlasAbsolute = absolute(variant.atlasPath);
  const atlasBytes = await readFile(atlasAbsolute);
  const atlasDecoded = await sharp(atlasBytes, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  requireCondition(
    atlasDecoded.info.width === ATLAS_WIDTH
      && atlasDecoded.info.height === ATLAS_HEIGHT
      && atlasDecoded.info.channels === 4,
    `${name} atlas must be ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA`,
  );
  const atlasSha256 = sha256(atlasBytes);

  const frameManifestPath = `${variant.framesRoot}/manifest.json`;
  const frameManifestBytes = await readFile(absolute(frameManifestPath));
  const frameManifest = JSON.parse(frameManifestBytes.toString("utf8"));
  requireCondition(frameManifest.variant === name, `${name} frame manifest variant is wrong`);
  requireCondition(frameManifest.atlas?.sha256 === atlasSha256, `${name} frame manifest is stale`);
  requireCondition(frameManifest.frames?.length === 57, `${name} frame manifest must contain 57 timed frames`);

  for (const frame of frameManifest.frames) {
    const expected = extractCell(atlasDecoded.data, atlasDecoded.info.width, frame.row, frame.column);
    const pngBytes = await readFile(absolute(frame.path));
    requireCondition(sha256(pngBytes) === frame.pngSha256, `${frame.path} does not match its manifest hash`);
    const pngDecoded = await sharp(pngBytes, { failOn: "error" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    requireCondition(
      pngDecoded.info.width === CELL_WIDTH
        && pngDecoded.info.height === CELL_HEIGHT
        && pngDecoded.info.channels === 4
        && pngDecoded.data.equals(expected),
      `${frame.path} is not byte-identical to atlas r${frame.row}c${frame.column}`,
    );
  }

  const officialValidationPath = `qa/official-validation-${name}.json`;
  let officialValidationBytes = await readFile(absolute(officialValidationPath));
  let officialValidation = JSON.parse(officialValidationBytes.toString("utf8"));
  requireCondition(
    path.resolve(repositoryRoot, officialValidation.file) === absolute(variant.atlasPath),
    `${name} official validation atlas must resolve to ${variant.atlasPath}`,
  );
  if (sealMode && officialValidation.file !== variant.atlasPath) {
    officialValidation = { ...officialValidation, file: variant.atlasPath };
    officialValidationBytes = Buffer.from(`${JSON.stringify(officialValidation, null, 2)}\n`, "utf8");
    await writeFile(absolute(officialValidationPath), officialValidationBytes);
  }
  requireCondition(
    officialValidation.ok === false
      && officialValidation.sprite_version_number === 2
      && officialValidation.width === ATLAS_WIDTH
      && officialValidation.height === ATLAS_HEIGHT
      && officialValidation.mode === "RGBA"
      && officialValidation.columns === 8
      && officialValidation.rows === 11
      && officialValidation.transparent_rgb_residue_pixels === 0
      && equalArrays(officialValidation.errors, [officialV2NeutralCellDiagnostic])
      && officialValidation.warnings?.length === 0,
    `${name} official validation report must contain only the audited v2 neutral-cell diagnostic`,
  );
  requireCondition(
    officialValidation.cells?.length === 88
      && officialValidation.cells.some((cell) => (
        cell.row === 0
        && cell.column === 6
        && cell.used === true
        && cell.nontransparent_pixels === 0
      )),
    `${name} official validation did not bind the known diagnostic to idle r0c6`,
  );

  const continuityPath = `qa/look-continuity-${name}.json`;
  const continuityBytes = await readFile(absolute(continuityPath));
  const continuity = JSON.parse(continuityBytes.toString("utf8"));
  requireCondition(
    continuity.ok === true
      && continuity.reviewRequired === false
      && continuity.pairs?.length === 16
      && continuity.warnings?.length === 0
      && continuity.alphaHoles?.length === 0,
    `${name} direction continuity requires review`,
  );

  const previews = [];
  for (const row of timedRows) {
    const previewPath = `${variant.previewsRoot}/${row.id}.gif`;
    const previewBytes = await readFile(absolute(previewPath));
    const metadata = await sharp(previewBytes, { animated: true, failOn: "error" }).metadata();
    requireCondition(
      metadata.format === "gif"
        && metadata.width === CELL_WIDTH
        && metadata.pageHeight === CELL_HEIGHT
        && metadata.pages === row.durations.length
        && metadata.loop === 0
        && equalArrays(metadata.delay, row.durations),
      `${previewPath} does not match ${row.id}'s official timing table`,
    );
    previews.push({
      state: row.id,
      path: previewPath,
      sha256: sha256(previewBytes),
      bytes: previewBytes.length,
      frames: metadata.pages,
      durationsMs: metadata.delay,
      loop: metadata.loop,
    });
  }

  const contact = await imageEvidence(`qa/contact-sheet-${name}.png`);
  const directions = await imageEvidence(`qa/look-directions-${name}.png`);

  return {
    atlas: {
      path: variant.atlasPath,
      sha256: atlasSha256,
      decodedRgbaSha256: sha256(atlasDecoded.data),
      width: atlasDecoded.info.width,
      height: atlasDecoded.info.height,
      channels: atlasDecoded.info.channels,
    },
    officialValidation: {
      path: officialValidationPath,
      sha256: sha256(officialValidationBytes),
      ok: false,
      warnings: 0,
      errors: 1,
      acceptedKnownNeutralCellMismatch: true,
    },
    frameExtraction: {
      path: frameManifestPath,
      sha256: sha256(frameManifestBytes),
      frameCount: frameManifest.frames.length,
      pixelIdentityVerified: true,
    },
    contactSheet: contact,
    lookDirectionSheet: directions,
    lookContinuity: {
      path: continuityPath,
      sha256: sha256(continuityBytes),
      ok: true,
      pairCount: continuity.pairs.length,
      warnings: 0,
      alphaHoles: 0,
    },
    animatedPreviews: previews,
  };
}

async function imageEvidence(relativePath) {
  const bytes = await readFile(absolute(relativePath));
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  requireCondition(metadata.format === "png", `${relativePath} must be PNG`);
  return {
    path: relativePath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: metadata.width,
    height: metadata.height,
  };
}

function extractCell(atlasPixels, atlasWidth, row, column) {
  const rgba = Buffer.alloc(CELL_WIDTH * CELL_HEIGHT * 4);
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const sourceStart = (((row * CELL_HEIGHT + y) * atlasWidth) + column * CELL_WIDTH) * 4;
    const targetStart = y * CELL_WIDTH * 4;
    atlasPixels.copy(rgba, targetStart, sourceStart, sourceStart + CELL_WIDTH * 4);
  }
  return rgba;
}

function equalArrays(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function absolute(relativePath) {
  return path.join(repositoryRoot, relativePath);
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

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
