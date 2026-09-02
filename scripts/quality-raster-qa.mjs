#!/usr/bin/env node
// Candidate-only full-surface raster evidence. This never changes a pet bundle.
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import {
  CODEX_DEFAULT_DPR2_DISPLAY,
  codexDefaultDpr2CellMap,
} from "./codex-default-dpr2-oracle.mjs";
import {
  ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT, CELL_WIDTH, POPULATED_FRAME_COUNT, ROWS,
} from "../src/spec.mjs";
import { validateCandidateManifest } from "./quality-candidate-qa.mjs";
import { validateQualityCheckpointManifest } from "./quality-checkpoint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(root, "preview/quality-lab/generated");
const PHASES = 60;
const GUTTER_PX = 4;
const WHITE = 0xFFFFFF;
const BLACK = 0x000000;
const ACCENTS = Object.freeze([
  ["coral", 0xF9705C], ["blue", 0x5B95F0], ["green", 0x3FBE86],
  ["gold", 0xF5B13F], ["violet", 0x9A72EE], ["teal", 0x35C3BD],
]);
const ACCENT_BY_RGB = new Map(ACCENTS.map(([name, rgb], index) => [rgb, { name, index }]));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rgb24 = (bytes, offset) => bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
const sum = (values) => values.reduce((total, value) => total + value, 0);
const THEMES = Object.freeze(["dark", "light"]);
const CANDIDATE_REPORT_SOURCE = "scripts/quality-candidate-qa.mjs";
const CANDIDATE_CONTRACTS = Object.freeze({
  "native-60": Object.freeze({ frames: 60, loopMs: 1000, preservesCheckpoint: false }),
  "coverage-60": Object.freeze({ frames: 60, loopMs: 1000, preservesCheckpoint: false, raster: "coverage" }),
});

function surfaceMetrics() {
  return {
    inspectedCellPhases: 0, inspectedPixels: 0, visiblePixels: 0, opaquePixels: 0,
    semiAlphaPixels: 0, alphaSum: 0, hiddenRgbPixels: 0, gutterNonZeroRgbaPixels: 0,
    edgeComparisons: 0, alphaTotalVariation: 0, binaryBoundaryCrossings: 0,
    semitransparentBoundaryEdges: 0, alphaLevels: new Uint8Array(256),
  };
}

function materialMetrics() {
  return {
    dark: { body: 0, feature: 0, accents: Object.fromEntries(ACCENTS.map(([name]) => [name, 0])) },
    light: { body: 0, feature: 0, accents: Object.fromEntries(ACCENTS.map(([name]) => [name, 0])) },
    alphaMismatchPixels: 0, monochromeRoleMismatchPixels: 0, accentRoleMismatchPixels: 0,
  };
}

function candidateMetrics() {
  return {
    source: { dark: surfaceMetrics(), light: surfaceMetrics() },
    defaultDpr2: { dark: surfaceMetrics(), light: surfaceMetrics() },
    materials: materialMetrics(),
  };
}

function addAlphaPixel(metrics, alpha) {
  metrics.inspectedPixels += 1;
  metrics.alphaSum += alpha;
  metrics.alphaLevels[alpha] = 1;
  if (alpha === 0) return;
  metrics.visiblePixels += 1;
  if (alpha === 255) metrics.opaquePixels += 1;
  else metrics.semiAlphaPixels += 1;
}

function addAlphaEdge(metrics, left, right) {
  metrics.edgeComparisons += 1;
  metrics.alphaTotalVariation += Math.abs(left - right);
  if ((left === 0) !== (right === 0)) metrics.binaryBoundaryCrossings += 1;
  if (left !== right && ((left > 0 && left < 255) || (right > 0 && right < 255))) {
    metrics.semitransparentBoundaryEdges += 1;
  }
}

function finishSurface(metrics) {
  const levels = [];
  for (let alpha = 0; alpha < metrics.alphaLevels.length; alpha += 1) {
    if (metrics.alphaLevels[alpha]) levels.push(alpha);
  }
  return {
    ...metrics,
    alphaLevels: levels,
    alphaCoverageEquivalentPixels: Number((metrics.alphaSum / 255).toFixed(6)),
    normalizedAlphaTotalVariation: Number((metrics.alphaTotalVariation / 255).toFixed(6)),
    semiAlphaFractionOfVisible: metrics.visiblePixels
      ? Number((metrics.semiAlphaPixels / metrics.visiblePixels).toFixed(9)) : 0,
  };
}

function addMaterial(materials, dark, light, offset) {
  const darkAlpha = dark[offset + 3];
  const lightAlpha = light[offset + 3];
  if (darkAlpha !== lightAlpha) materials.alphaMismatchPixels += 1;
  if (darkAlpha === 0 && lightAlpha === 0) return;
  const darkRgb = rgb24(dark, offset);
  const lightRgb = rgb24(light, offset);
  const darkAccent = ACCENT_BY_RGB.get(darkRgb);
  const lightAccent = ACCENT_BY_RGB.get(lightRgb);
  if (darkRgb === WHITE) materials.dark.body += 1;
  if (darkRgb === BLACK) materials.dark.feature += 1;
  if (lightRgb === BLACK) materials.light.body += 1;
  if (lightRgb === WHITE) materials.light.feature += 1;
  if (darkAccent) materials.dark.accents[darkAccent.name] += 1;
  if (lightAccent) materials.light.accents[lightAccent.name] += 1;

  const eitherExactMonochrome = darkRgb === WHITE || darkRgb === BLACK
    || lightRgb === WHITE || lightRgb === BLACK;
  const exactMonochromePair = (darkRgb === WHITE && lightRgb === BLACK)
    || (darkRgb === BLACK && lightRgb === WHITE);
  if (eitherExactMonochrome && !exactMonochromePair) materials.monochromeRoleMismatchPixels += 1;
  if ((darkAccent || lightAccent) && darkAccent?.index !== lightAccent?.index) {
    materials.accentRoleMismatchPixels += 1;
  }
}

function hasCoverageWithinOnePixel(coverage, atlasWidth, originX, originY, x, y, width, height) {
  for (let dy = -1; dy <= 1; dy += 1) {
    const sampleY = y + dy;
    if (sampleY < 0 || sampleY >= height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      const sampleX = x + dx;
      if (sampleX < 0 || sampleX >= width) continue;
      const offset = ((originY + sampleY) * atlasWidth + originX + sampleX) * 4;
      if (coverage[offset + 3] !== 0) return true;
    }
  }
  return false;
}

export function inspectCellQuad({
  nativeDark, nativeLight, coverageDark, coverageLight,
  atlasWidth, originX = 0, originY = 0, width = CELL_WIDTH, height = CELL_HEIGHT,
  gutterPx = GUTTER_PX,
  native, coverage, support,
}) {
  const pairs = [
    [nativeDark, nativeLight, native],
    [coverageDark, coverageLight, coverage],
  ];
  for (const [, , candidate] of pairs) {
    candidate.source.dark.inspectedCellPhases += 1;
    candidate.source.light.inspectedCellPhases += 1;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((originY + y) * atlasWidth + originX + x) * 4;
      const inGutter = x < gutterPx || x >= width - gutterPx || y < gutterPx || y >= height - gutterPx;
      for (const [dark, light, candidate] of pairs) {
        const darkMetrics = candidate.source.dark;
        const lightMetrics = candidate.source.light;
        const darkAlpha = dark[offset + 3];
        const lightAlpha = light[offset + 3];
        addAlphaPixel(darkMetrics, darkAlpha);
        addAlphaPixel(lightMetrics, lightAlpha);
        if (darkAlpha === 0 && (dark[offset] | dark[offset + 1] | dark[offset + 2])) darkMetrics.hiddenRgbPixels += 1;
        if (lightAlpha === 0 && (light[offset] | light[offset + 1] | light[offset + 2])) lightMetrics.hiddenRgbPixels += 1;
        if (inGutter && (darkAlpha || dark[offset] || dark[offset + 1] || dark[offset + 2])) darkMetrics.gutterNonZeroRgbaPixels += 1;
        if (inGutter && (lightAlpha || light[offset] || light[offset + 1] || light[offset + 2])) lightMetrics.gutterNonZeroRgbaPixels += 1;
        if (x > 0) {
          addAlphaEdge(darkMetrics, darkAlpha, dark[offset - 1]);
          addAlphaEdge(lightMetrics, lightAlpha, light[offset - 1]);
        }
        if (y > 0) {
          addAlphaEdge(darkMetrics, darkAlpha, dark[offset - atlasWidth * 4 + 3]);
          addAlphaEdge(lightMetrics, lightAlpha, light[offset - atlasWidth * 4 + 3]);
        }
        addMaterial(candidate.materials, dark, light, offset);
      }

      const nativeAlpha = nativeDark[offset + 3];
      const idealAlpha = coverageDark[offset + 3];
      const delta = Math.abs(nativeAlpha - idealAlpha);
      support.comparedPixels += 1;
      support.absoluteAlphaError += delta;
      support.maximumAlphaError = Math.max(support.maximumAlphaError, delta);
      if (delta) support.alphaDifferentPixels += 1;
      if (nativeAlpha && !idealAlpha) {
        support.nativeCoverageOutsideIdeal += 1;
        if (hasCoverageWithinOnePixel(coverageDark, atlasWidth, originX, originY, x, y, width, height)) {
          support.nativeCoverageInsideOnePixelShell += 1;
        } else support.nativeCoverageBeyondOnePixelIdeal += 1;
      }
      if (idealAlpha && !nativeAlpha) support.nativeMissingIdealCoverage += 1;
    }
  }
}

export function inspectDefaultDpr2Cell({
  row, column, nativeDark, nativeLight, coverageDark, coverageLight,
  native, coverage, support,
}) {
  const map = codexDefaultDpr2CellMap(row, column);
  const outputWidth = CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx;
  const outputHeight = CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx;
  const sources = [nativeDark, coverageDark];
  const targets = [native.defaultDpr2.dark, coverage.defaultDpr2.dark];
  for (const target of targets) target.inspectedCellPhases += 1;
  const previousRows = targets.map(() => new Uint8Array(outputWidth));
  for (let y = 0; y < outputHeight; y += 1) {
    let left = [0, 0, 0, 0];
    for (let x = 0; x < outputWidth; x += 1) {
      const mapOffset = (y * outputWidth + x) * 2;
      const sourceX = column * CELL_WIDTH + map[mapOffset];
      const sourceY = row * CELL_HEIGHT + map[mapOffset + 1];
      const sourceOffset = (sourceY * ATLAS_WIDTH + sourceX) * 4 + 3;
      const alphas = [sources[0][sourceOffset], sources[1][sourceOffset]];
      for (let candidate = 0; candidate < targets.length; candidate += 1) {
        const target = targets[candidate];
        const alpha = alphas[candidate];
        addAlphaPixel(target, alpha);
        if (x > 0) addAlphaEdge(target, alpha, left[candidate]);
        if (y > 0) addAlphaEdge(target, alpha, previousRows[candidate][x]);
        left[candidate] = alpha;
        previousRows[candidate][x] = alpha;
      }
      const delta = Math.abs(alphas[0] - alphas[1]);
      support.defaultDpr2ComparedPixels += 1;
      support.defaultDpr2AbsoluteAlphaError += delta;
      support.defaultDpr2MaximumAlphaError = Math.max(support.defaultDpr2MaximumAlphaError, delta);
      if (delta) support.defaultDpr2AlphaDifferentPixels += 1;
      if (alphas[0] && !alphas[1]) support.defaultDpr2NativeCoverageOutsideIdeal += 1;
      if (alphas[1] && !alphas[0]) support.defaultDpr2NativeMissingIdealCoverage += 1;
    }
  }
}

function finishCandidate(candidate) {
  return {
    source: Object.fromEntries(Object.entries(candidate.source).map(([theme, metrics]) => [theme, finishSurface(metrics)])),
    defaultDpr2: Object.fromEntries(Object.entries(candidate.defaultDpr2).map(([theme, metrics]) => [theme, finishSurface(metrics)])),
    materials: candidate.materials,
  };
}

export function candidateChecks(candidate) {
  const errors = [];
  for (const surface of ["source", "defaultDpr2"]) {
    for (const theme of ["dark", "light"]) {
      const metrics = candidate[surface][theme];
      if (metrics.inspectedCellPhases !== PHASES * POPULATED_FRAME_COUNT) errors.push(`${surface}/${theme} cell-phase coverage differs`);
      if (metrics.hiddenRgbPixels) errors.push(`${surface}/${theme} has hidden RGB`);
      if (metrics.gutterNonZeroRgbaPixels) errors.push(`${surface}/${theme} enters a cell gutter`);
    }
  }
  if (candidate.materials.alphaMismatchPixels) errors.push("dark/light alpha masks differ");
  for (const theme of ["dark", "light"]) {
    if (!candidate.materials[theme].body || !candidate.materials[theme].feature) errors.push(`${theme} exact monochrome materials are missing`);
    for (const [name] of ACCENTS) if (!candidate.materials[theme].accents[name]) errors.push(`${theme} exact accent ${name} is missing`);
  }
  return errors;
}

export function recommendRaster({ native, coverage, support, candidateEvidenceOk = true }) {
  const nativeErrors = candidateChecks(native);
  const coverageErrors = candidateChecks(coverage);
  const safeSupport = support.nativeCoverageBeyondOnePixelIdeal === 0;
  const coverageIsDirectIdeal = support.coverageBeyondOnePixelIdeal === 0;
  const nativeMixedRolePixels = native.materials.monochromeRoleMismatchPixels
    + native.materials.accentRoleMismatchPixels;
  const coverageMixedRolePixels = coverage.materials.monochromeRoleMismatchPixels
    + coverage.materials.accentRoleMismatchPixels;
  const materialDiagnosticImproves = coverageMixedRolePixels <= nativeMixedRolePixels;
  const chooseCoverage = coverageErrors.length === 0 && coverageIsDirectIdeal
    && support.absoluteAlphaError > 0 && materialDiagnosticImproves;
  const selectedId = chooseCoverage ? "coverage-60" : nativeErrors.length === 0 && safeSupport ? "native-60" : null;
  return {
    id: selectedId,
    promotionReady: selectedId != null && candidateEvidenceOk,
    confidence: chooseCoverage ? "high for raster integrity; visual approval remains separate" : "insufficient",
    reasons: chooseCoverage ? [
      "The area-coverage raster preserves the direct supersampled vector support and has no resampling lobes.",
      `Native Lanczos differs from that ideal at ${support.alphaDifferentPixels} source pixels and ${support.defaultDpr2AlphaDifferentPixels} exact default-DPR2 device pixels.`,
      `Exact solid colors remain present, while mixed/composited exact-role diagnostics improve from ${nativeMixedRolePixels} pixels to ${coverageMixedRolePixels} pixels.`,
      "The selected candidate retains exact theme alpha, palette presence, hidden-RGB, and gutter invariants across the complete candidate surface.",
    ] : ["The raster integrity gates do not establish a safe coverage-raster promotion."],
    rejectedCandidate: chooseCoverage ? "native-60" : "coverage-60",
    visualSealClaimed: false,
    caveat: "This is an automated raster decision, not human visual approval and not an installed-Codex observation.",
    materialDiagnostic: { nativeMixedRolePixels, coverageMixedRolePixels, improvesOrEquals: materialDiagnosticImproves },
  };
}

async function readManifest(id, theme) {
  return JSON.parse(await readFile(path.join(generated, `${id}-${theme}.json`), "utf8"));
}

async function readPage(id, theme, phase, manifest) {
  const file = path.join(generated, `${id}-${theme}`, `${phase}.webp`);
  const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== ATLAS_WIDTH || decoded.info.height !== ATLAS_HEIGHT || decoded.info.channels !== 4) {
    throw new Error(`${id}/${theme}/${phase} decoded dimensions differ`);
  }
  const digest = sha256(decoded.data);
  if (digest !== manifest.decodedFrameHashes[phase]) throw new Error(`${id}/${theme}/${phase} decoded hash differs from its completed manifest`);
  return decoded.data;
}

export async function verifyManifestSourceBindings({ ids, themes, manifests, readSource }) {
  if (!Array.isArray(ids) || !Array.isArray(themes) || typeof readSource !== "function") {
    throw new TypeError("Source-binding verification needs candidate ids, themes, and a source reader");
  }
  const currentHashes = new Map();
  const errors = [];
  for (const id of ids) for (const theme of themes) {
    for (const [file, expected] of Object.entries(manifests[id]?.[theme]?.sourceHashes ?? {})) {
      if (!currentHashes.has(file)) currentHashes.set(file, sha256(await readSource(file)));
      if (currentHashes.get(file) !== expected) errors.push(`${id}/${theme} source differs: ${file}`);
    }
  }
  return errors;
}

export function sourceBindingsCurrent(candidateId, errors) {
  if (typeof candidateId !== "string" || !Array.isArray(errors)) throw new TypeError("Candidate id and source-binding errors are required");
  return errors.every((error) => !error.startsWith(`${candidateId}/`));
}

export function parseQualityCatalog(source) {
  if (typeof source !== "string") throw new TypeError("Quality catalog source must be text");
  const match = source.match(/^export default ([\s\S]+);\s*$/u);
  if (!match) throw new Error("Quality catalog module has an unexpected format");
  const catalog = JSON.parse(match[1]);
  if (!Array.isArray(catalog)) throw new Error("Quality catalog must export an array");
  return catalog;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function reportAssetErrors({ binding, manifest, asset, expectedPath, label }) {
  const errors = [];
  if (!binding || typeof binding !== "object") return [`${label} report asset is missing`];
  if (binding.path !== expectedPath || binding.encodedSha256 !== manifest.sha256
    || binding.bytes !== manifest.bytes || binding.encodedSha256 !== asset.sha256
    || binding.bytes !== asset.bytes) errors.push(`${label} report encoded-asset binding differs`);
  if (binding.ok !== true || !Array.isArray(binding.errors) || binding.errors.length !== 0) {
    errors.push(`${label} report asset result is not a clean pass`);
  }
  const metadata = binding.metadata;
  if (metadata?.width !== ATLAS_WIDTH || metadata?.height !== ATLAS_HEIGHT
    || metadata?.frameCount !== manifest.frames || metadata?.loop !== 0
    || !isDeepStrictEqual(metadata?.delays, manifest.delays)) {
    errors.push(`${label} report metadata differs`);
  }
  const canonical = binding.canonical;
  const secondary = binding.ffmpeg;
  if (canonical?.width !== ATLAS_WIDTH || canonical?.height !== ATLAS_HEIGHT
    || canonical?.frameCount !== manifest.frames || canonical?.loop !== 0
    || !isDeepStrictEqual(canonical?.delays, manifest.delays)
    || !isDeepStrictEqual(canonical?.frameHashes, manifest.decodedFrameHashes)
    || !validHash(canonical?.fullStackSha256)) {
    errors.push(`${label} canonical decode binding differs`);
  }
  if (secondary?.frameCount !== manifest.frames
    || !isDeepStrictEqual(secondary?.frameHashes, manifest.decodedFrameHashes)
    || secondary?.fullStackSha256 !== canonical?.fullStackSha256) {
    errors.push(`${label} secondary decode binding differs`);
  }
  return errors;
}

export function validateIndependentCandidateReportBindings({
  ids, themes, manifests, checkpoints, reports, catalog, assets, currentSourceHashes,
}) {
  if (!Array.isArray(ids) || !Array.isArray(themes) || !Array.isArray(catalog)) {
    throw new TypeError("Independent report validation needs candidate ids, themes, and a catalog");
  }
  const errors = [];
  const catalogById = new Map();
  for (const entry of catalog) {
    if (!entry || typeof entry.id !== "string" || catalogById.has(entry.id)) {
      errors.push("catalog has a missing or duplicate candidate id");
      continue;
    }
    catalogById.set(entry.id, entry);
  }
  for (const id of ids) {
    const contract = CANDIDATE_CONTRACTS[id];
    const report = reports[id];
    if (!contract) {
      errors.push(`${id}/unknown candidate contract`);
      continue;
    }
    if (report?.schemaVersion !== 1 || report?.kind !== "independent-quality-candidate-qa"
      || report?.candidateId !== id || report?.ok !== true
      || !Array.isArray(report?.errors) || report.errors.length !== 0
      || !isDeepStrictEqual(report?.contract, contract)) {
      errors.push(`${id}/independent report identity or result differs`);
    }
    const requiredReportSources = new Set([CANDIDATE_REPORT_SOURCE]);
    for (const theme of themes) {
      for (const file of Object.keys(manifests[id]?.[theme]?.sourceHashes ?? {})) requiredReportSources.add(file);
    }
    if (!exactKeys(report?.sourceHashes, requiredReportSources)) {
      errors.push(`${id}/independent report source set differs`);
    } else {
      for (const file of requiredReportSources) {
        if (!validHash(report.sourceHashes[file]) || report.sourceHashes[file] !== currentSourceHashes[file]) {
          errors.push(`${id}/independent report source differs: ${file}`);
        }
      }
    }
    const candidateCatalog = catalogById.get(id);
    const checkpointCatalog = catalogById.get("checkpoint");
    if (!candidateCatalog) errors.push(`${id}/current catalog entry is missing`);
    if (!checkpointCatalog) errors.push(`${id}/current checkpoint catalog entry is missing`);
    if (!exactKeys(report?.variants, themes)) errors.push(`${id}/independent report theme set differs`);
    for (const theme of themes) {
      const manifest = manifests[id]?.[theme];
      const checkpoint = checkpoints?.[theme];
      const candidateAsset = assets[id]?.[theme];
      const checkpointAsset = assets.checkpoint?.[theme];
      const label = `${id}/${theme}`;
      if (!manifest || !checkpoint || !candidateAsset || !checkpointAsset) {
        errors.push(`${label} current evidence input is missing`);
        continue;
      }
      if (!isDeepStrictEqual(candidateCatalog?.themes?.[theme], manifest)) {
        errors.push(`${label} current catalog manifest differs`);
      }
      if (!isDeepStrictEqual(checkpointCatalog?.themes?.[theme], checkpoint)) {
        errors.push(`${label} current checkpoint catalog manifest differs`);
      }
      const checkpointValidation = validateQualityCheckpointManifest(checkpoint, theme);
      if (!checkpointValidation.ok || manifest.checkpointSha256 !== checkpoint.sha256
        || manifest.checkpointDecodedFrameHashSeal !== checkpointValidation.expectedSeal) {
        errors.push(`${label} current checkpoint seal differs`);
      }
      const manifestValidation = validateCandidateManifest(manifest, id, theme, currentSourceHashes);
      if (!manifestValidation.ok) {
        errors.push(...manifestValidation.errors.map((error) => `${label} current manifest ${error}`));
      }
      if (candidateAsset.sha256 !== manifest.sha256 || candidateAsset.bytes !== manifest.bytes) {
        errors.push(`${label} current encoded asset differs from its manifest`);
      }
      if (checkpointAsset.sha256 !== checkpoint.sha256 || checkpointAsset.bytes !== checkpoint.bytes) {
        errors.push(`${label} current checkpoint asset differs from its manifest`);
      }
      const variant = report?.variants?.[theme];
      if (variant?.ok !== true) errors.push(`${label} independent variant is not a pass`);
      errors.push(...reportAssetErrors({
        binding: variant?.candidate, manifest, asset: candidateAsset,
        expectedPath: path.posix.join("preview/quality-lab/generated", `${id}-${theme}.webp`),
        label: `${label} candidate`,
      }));
      errors.push(...reportAssetErrors({
        binding: variant?.checkpoint, manifest: checkpoint, asset: checkpointAsset,
        expectedPath: path.posix.join("preview/quality-lab/generated", `checkpoint-${theme}.webp`),
        label: `${label} checkpoint`,
      }));
      const phaseComparison = variant?.phaseComparison;
      if (phaseComparison?.ok !== true || phaseComparison?.uniquePhases !== manifest.frames
        || !Array.isArray(phaseComparison?.mismatchedEvenPhases) || phaseComparison.mismatchedEvenPhases.length
        || !Array.isArray(phaseComparison?.duplicateIntermediatePhases) || phaseComparison.duplicateIntermediatePhases.length) {
        errors.push(`${label} independent phase comparison differs`);
      }
    }
  }
  return errors;
}

export async function runRasterQa() {
  const ids = ["native-60", "coverage-60"];
  const manifests = {};
  const independent = {};
  for (const id of ids) {
    manifests[id] = {};
    for (const theme of ["dark", "light"]) {
      const manifest = await readManifest(id, theme);
      if (manifest.id !== id || manifest.theme !== theme || manifest.frames !== PHASES || manifest.loopMs !== 1000
        || manifest.decodedFrameHashes?.length !== PHASES) throw new Error(`${id}/${theme} manifest contract differs`);
      manifests[id][theme] = manifest;
    }
    independent[id] = JSON.parse(await readFile(path.join(generated, `quality-candidate-qa-${id}.json`), "utf8"));
  }
  const native = candidateMetrics();
  const coverage = candidateMetrics();
  const support = {
    ideal: "8x premultiplied integer-area reduction of the same SVG; nonzero alpha is direct vector pixel support",
    comparedPixels: 0, absoluteAlphaError: 0, maximumAlphaError: 0, alphaDifferentPixels: 0,
    nativeCoverageOutsideIdeal: 0, nativeCoverageInsideOnePixelShell: 0,
    nativeCoverageBeyondOnePixelIdeal: 0, nativeMissingIdealCoverage: 0,
    coverageBeyondOnePixelIdeal: 0,
    defaultDpr2ComparedPixels: 0, defaultDpr2AbsoluteAlphaError: 0,
    defaultDpr2MaximumAlphaError: 0, defaultDpr2AlphaDifferentPixels: 0,
    defaultDpr2NativeCoverageOutsideIdeal: 0, defaultDpr2NativeMissingIdealCoverage: 0,
  };
  sharp.cache({ memory: 64, files: 12, items: 24 });
  sharp.concurrency(2);
  for (let phase = 0; phase < PHASES; phase += 1) {
    const [nativeDark, nativeLight, coverageDark, coverageLight] = await Promise.all([
      readPage("native-60", "dark", phase, manifests["native-60"].dark),
      readPage("native-60", "light", phase, manifests["native-60"].light),
      readPage("coverage-60", "dark", phase, manifests["coverage-60"].dark),
      readPage("coverage-60", "light", phase, manifests["coverage-60"].light),
    ]);
    for (const row of ROWS) {
      for (let column = 0; column < row.frames.length; column += 1) {
        inspectCellQuad({
          nativeDark, nativeLight, coverageDark, coverageLight,
          atlasWidth: ATLAS_WIDTH, originX: column * CELL_WIDTH, originY: row.index * CELL_HEIGHT,
          native, coverage, support,
        });
        inspectDefaultDpr2Cell({
          row: row.index, column, nativeDark, nativeLight, coverageDark, coverageLight,
          native, coverage, support,
        });
      }
    }
    process.stdout.write(`\rRaster QA: ${phase + 1}/${PHASES} phases`);
  }
  process.stdout.write("\n");
  // The exact per-source-pixel alpha parity above proves that the sealed
  // point-sampling map produces identical boundary metrics in both themes.
  for (const candidate of [native, coverage]) {
    const dark = candidate.defaultDpr2.dark;
    candidate.defaultDpr2.light = {
      ...dark,
      alphaLevels: Uint8Array.from(dark.alphaLevels),
    };
  }
  const completed = { native: finishCandidate(native), coverage: finishCandidate(coverage) };
  const sourceBindingErrors = await verifyManifestSourceBindings({
    ids, themes: ["dark", "light"], manifests,
    readSource: (file) => readFile(path.join(root, file)),
  });
  const independentOk = sourceBindingErrors.length === 0
    && ids.every((id) => independent[id].ok === true && independent[id].candidateId === id);
  const errors = [
    ...candidateChecks(completed.native).map((error) => `native-60: ${error}`),
    ...candidateChecks(completed.coverage).map((error) => `coverage-60: ${error}`),
  ];
  if (!independentOk) errors.push("independent encoded-candidate evidence is missing or failing");
  errors.push(...sourceBindingErrors);
  if (support.nativeCoverageBeyondOnePixelIdeal) errors.push("native-60 adds coverage beyond the safe one-pixel ideal-support shell");
  if (support.coverageBeyondOnePixelIdeal) errors.push("coverage-60 adds coverage beyond its direct ideal support");
  for (const id of ids) for (const theme of ["dark", "light"]) {
    const asset = await readFile(path.join(generated, `${id}-${theme}.webp`));
    if (sha256(asset) !== manifests[id][theme].sha256 || asset.length !== manifests[id][theme].bytes) {
      throw new Error(`${id}/${theme} animated asset changed during raster QA`);
    }
  }
  const recommendation = recommendRaster({ ...completed, support, candidateEvidenceOk: independentOk });
  if (!recommendation.id) errors.push("no raster candidate satisfies the automated promotion decision");
  return {
    schemaVersion: 1, kind: "full-surface-quality-raster-qa",
    status: "candidate-only; no pet bundle changed, installed, committed, or published",
    ok: errors.length === 0, errors, generatedAt: new Date().toISOString(),
    contract: {
      phases: PHASES, populatedCells: POPULATED_FRAME_COUNT,
      cellPhasesPerTheme: PHASES * POPULATED_FRAME_COUNT,
      sourcePixelsPerThemeAndCandidate: PHASES * POPULATED_FRAME_COUNT * CELL_WIDTH * CELL_HEIGHT,
      defaultDpr2PixelsPerThemeAndCandidate: PHASES * POPULATED_FRAME_COUNT
        * CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx * CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx,
      safetyGutterPx: GUTTER_PX,
      sourcePath: { width: CELL_WIDTH, height: CELL_HEIGHT, label: "native 96 CSS px at DPR2 (192x208 device px, 1:1 atlas sampling)" },
      defaultDpr2Path: CODEX_DEFAULT_DPR2_DISPLAY,
      streaming: "one phase quartet in memory; every static page hash is rebound to the completed animated-candidate manifest",
    },
    candidateEvidence: Object.fromEntries(ids.map((id) => [id, {
      ok: independent[id].ok, reportKind: independent[id].kind,
      sourceBindingsCurrent: sourceBindingsCurrent(id, sourceBindingErrors),
      manifestPaths: Object.fromEntries(["dark", "light"].map((theme) => [theme, path.relative(root, path.join(generated, `${id}-${theme}.json`))])),
      staticPageDirectories: Object.fromEntries(["dark", "light"].map((theme) => [theme, path.relative(root, path.join(generated, `${id}-${theme}`))])),
      candidateDarkSha256: manifests[id].dark.sha256, candidateLightSha256: manifests[id].light.sha256,
      decodedFrameHashes: Object.fromEntries(["dark", "light"].map((theme) => [theme, manifests[id][theme].decodedFrameHashes])),
    }])),
    candidates: { "native-60": completed.native, "coverage-60": completed.coverage },
    support, recommendation,
    limits: [
      "The default-DPR2 measurements use the sealed Chromium 151 source-coordinate oracle; they do not substitute for a new live screenshot.",
      "Exact palette tests cover direct body, feature, and accent roles. Genuine gradients and composited mixed-material pixels remain represented but are not falsely forced into solid palette buckets.",
      "Automated raster integrity and boundary measurements do not constitute a visual seal.",
    ],
  };
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/quality-raster-qa.mjs");
  const report = await runRasterQa();
  const destination = path.join(generated, "quality-raster-qa.json");
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n");
  await rename(temporary, destination);
  console.log(`${report.ok ? "PASS" : "FAIL"}: ${path.relative(root, destination)}; recommend ${report.recommendation.id ?? "none"}`);
  for (const error of report.errors) console.error(`error: ${error}`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Raster QA: ${error.message}`); process.exitCode = 1; });
}
