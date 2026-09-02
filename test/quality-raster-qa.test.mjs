import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { QUALITY_SOURCE_PATHS } from "../scripts/quality-catalog.mjs";
import {
  QUALITY_CHECKPOINT_CONTRACT, qualityCheckpointFrameHashSeal,
  qualityCheckpointFrameHashes, qualityCheckpointTimeline,
} from "../scripts/quality-checkpoint.mjs";
import {
  candidateChecks, inspectCellQuad, recommendRaster, sourceBindingsCurrent,
  validateIndependentCandidateReportBindings, verifyManifestSourceBindings,
} from "../scripts/quality-raster-qa.mjs";

function metrics() {
  const surface = () => ({
    dark: { inspectedCellPhases: 4380, hiddenRgbPixels: 0, gutterNonZeroRgbaPixels: 0 },
    light: { inspectedCellPhases: 4380, hiddenRgbPixels: 0, gutterNonZeroRgbaPixels: 0 },
  });
  return {
    source: surface(), defaultDpr2: surface(),
    materials: {
      alphaMismatchPixels: 0, monochromeRoleMismatchPixels: 0, accentRoleMismatchPixels: 0,
      dark: { body: 1, feature: 1, accents: { coral: 1, blue: 1, green: 1, gold: 1, violet: 1, teal: 1 } },
      light: { body: 1, feature: 1, accents: { coral: 1, blue: 1, green: 1, gold: 1, violet: 1, teal: 1 } },
    },
  };
}

function raw(width, height, rgba = [0, 0, 0, 0]) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < bytes.length; offset += 4) bytes.set(rgba, offset);
  return bytes;
}

function accumulator() {
  const surface = () => ({
    inspectedCellPhases: 0, inspectedPixels: 0, visiblePixels: 0, opaquePixels: 0,
    semiAlphaPixels: 0, alphaSum: 0, hiddenRgbPixels: 0, gutterNonZeroRgbaPixels: 0,
    edgeComparisons: 0, alphaTotalVariation: 0, binaryBoundaryCrossings: 0,
    semitransparentBoundaryEdges: 0, alphaLevels: new Uint8Array(256),
  });
  return {
    source: { dark: surface(), light: surface() }, defaultDpr2: { dark: surface(), light: surface() },
    materials: {
      dark: { body: 0, feature: 0, accents: { coral: 0, blue: 0, green: 0, gold: 0, violet: 0, teal: 0 } },
      light: { body: 0, feature: 0, accents: { coral: 0, blue: 0, green: 0, gold: 0, violet: 0, teal: 0 } },
      alphaMismatchPixels: 0, monochromeRoleMismatchPixels: 0, accentRoleMismatchPixels: 0,
    },
  };
}

test("cell inspection catches hidden RGB, gutter occupancy, theme mismatch, and support shells", () => {
  const width = 5, height = 5;
  const nativeDark = raw(width, height), nativeLight = raw(width, height);
  const coverageDark = raw(width, height), coverageLight = raw(width, height);
  const center = (2 * width + 2) * 4;
  nativeDark.set([255, 255, 255, 255], center);
  nativeLight.set([0, 0, 0, 254], center);
  coverageDark.set([255, 255, 255, 255], center + 4);
  coverageLight.set([0, 0, 0, 255], center + 4);
  nativeDark.set([9, 0, 0, 0], 0);
  const native = accumulator(), coverage = accumulator();
  const support = { comparedPixels: 0, absoluteAlphaError: 0, maximumAlphaError: 0, alphaDifferentPixels: 0, nativeCoverageOutsideIdeal: 0, nativeCoverageInsideOnePixelShell: 0, nativeCoverageBeyondOnePixelIdeal: 0, nativeMissingIdealCoverage: 0 };
  inspectCellQuad({ nativeDark, nativeLight, coverageDark, coverageLight, atlasWidth: width, width, height, gutterPx: 1, native, coverage, support });
  assert.equal(native.source.dark.hiddenRgbPixels, 1);
  assert.equal(native.source.dark.gutterNonZeroRgbaPixels, 1);
  assert.equal(native.materials.alphaMismatchPixels, 1);
  assert.equal(support.nativeCoverageOutsideIdeal, 1);
  assert.equal(support.nativeCoverageInsideOnePixelShell, 1);
  assert.equal(support.nativeCoverageBeyondOnePixelIdeal, 0);
});

test("candidate gates reject missing palette roles and incomplete surface coverage", () => {
  const candidate = metrics();
  assert.deepEqual(candidateChecks(candidate), []);
  candidate.materials.dark.accents.teal = 0;
  candidate.defaultDpr2.light.inspectedCellPhases -= 1;
  assert.deepEqual(candidateChecks(candidate), [
    "defaultDpr2/light cell-phase coverage differs",
    "dark exact accent teal is missing",
  ]);
});

test("mixed-material exact-role diagnostics are recorded without misclassifying them as alpha failure", () => {
  const candidate = metrics();
  candidate.materials.monochromeRoleMismatchPixels = 3;
  candidate.materials.accentRoleMismatchPixels = 2;
  assert.deepEqual(candidateChecks(candidate), []);
});

test("recommendation selects clean direct-area coverage without claiming visual approval", () => {
  const support = {
    nativeCoverageBeyondOnePixelIdeal: 0, coverageBeyondOnePixelIdeal: 0,
    absoluteAlphaError: 50, alphaDifferentPixels: 2, defaultDpr2AlphaDifferentPixels: 3,
  };
  const recommendation = recommendRaster({ native: metrics(), coverage: metrics(), support, candidateEvidenceOk: true });
  assert.equal(recommendation.id, "coverage-60");
  assert.equal(recommendation.promotionReady, true);
  assert.equal(recommendation.visualSealClaimed, false);
  const stale = recommendRaster({ native: metrics(), coverage: metrics(), support, candidateEvidenceOk: false });
  assert.equal(stale.id, "coverage-60");
  assert.equal(stale.promotionReady, false);
});

test("source-binding errors are emitted once per bound manifest and scoped to the owning candidate", async () => {
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  const current = Buffer.from("current");
  const expectedCurrent = digest(current);
  const stale = digest(Buffer.from("stale"));
  const manifests = {
    "native-60": {
      dark: { sourceHashes: { "src/fluid-atlas.mjs": stale } },
      light: { sourceHashes: { "src/fluid-atlas.mjs": stale } },
    },
    "coverage-60": {
      dark: { sourceHashes: { "src/fluid-atlas.mjs": expectedCurrent } },
      light: { sourceHashes: { "src/fluid-atlas.mjs": expectedCurrent } },
    },
  };
  let reads = 0;
  const errors = await verifyManifestSourceBindings({
    ids: ["native-60", "coverage-60"], themes: ["dark", "light"], manifests,
    readSource: async () => { reads += 1; return current; },
  });
  assert.deepEqual(errors, [
    "native-60/dark source differs: src/fluid-atlas.mjs",
    "native-60/light source differs: src/fluid-atlas.mjs",
  ]);
  assert.equal(reads, 1, "the same bound source should be hashed once");
  assert.equal(sourceBindingsCurrent("native-60", errors), false);
  assert.equal(sourceBindingsCurrent("coverage-60", errors), true);
});

function independentBindingFixture() {
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const ids = ["native-60"], themes = ["dark", "light"];
  const currentSourceHashes = Object.fromEntries([
    ...QUALITY_SOURCE_PATHS, "scripts/quality-candidate-qa.mjs",
  ].map((file) => [file, digest(`source:${file}`)]));
  const candidateTimeline = animationTimeline(60, 1000);
  const candidateDelays = candidateTimeline.map(({ durationMs }) => durationMs);
  const checkpointTimeline = qualityCheckpointTimeline();
  const checkpointDelays = checkpointTimeline.map(({ durationMs }) => durationMs);
  const checkpoints = {}, manifests = { "native-60": {} };
  const assets = { checkpoint: {}, "native-60": {} };
  const reportVariants = {};
  for (const theme of themes) {
    const checkpointHashes = qualityCheckpointFrameHashes(theme);
    const checkpoint = {
      ...QUALITY_CHECKPOINT_CONTRACT, theme,
      delays: checkpointDelays, timeline: checkpointTimeline,
      decodedFrameHashes: checkpointHashes,
      decodedFrameHashSeal: qualityCheckpointFrameHashSeal(checkpointHashes),
      sha256: digest(`checkpoint:${theme}`), bytes: theme === "dark" ? 100 : 101,
    };
    const candidateHashes = Array.from({ length: 60 }, (_, phase) => digest(`candidate:${theme}:${phase}`));
    const candidate = {
      id: "native-60", theme, frames: 60, loopMs: 1000,
      delays: candidateDelays, timeline: candidateTimeline,
      preservesAllCheckpointPhases: false,
      checkpointSha256: checkpoint.sha256,
      checkpointDecodedFrameHashSeal: checkpoint.decodedFrameHashSeal,
      sourceHashes: Object.fromEntries(QUALITY_SOURCE_PATHS.map((file) => [file, currentSourceHashes[file]])),
      sha256: digest(`candidate-asset:${theme}`), bytes: theme === "dark" ? 200 : 201,
      decodedFrameHashes: candidateHashes,
    };
    const reportAsset = (manifest, label, frameHashes) => {
      const fullStackSha256 = digest(`stack:${label}`);
      return {
        path: `preview/quality-lab/generated/${label}.webp`,
        encodedSha256: manifest.sha256, bytes: manifest.bytes, ok: true, errors: [],
        metadata: {
          width: 1536, height: 2288, frameCount: manifest.frames, loop: 0,
          delays: manifest.delays,
        },
        canonical: {
          width: 1536, height: 2288, frameCount: manifest.frames, loop: 0,
          delays: manifest.delays, frameHashes, fullStackSha256,
        },
        ffmpeg: { frameCount: manifest.frames, frameHashes, fullStackSha256 },
      };
    };
    checkpoints[theme] = checkpoint;
    manifests["native-60"][theme] = candidate;
    assets.checkpoint[theme] = { sha256: checkpoint.sha256, bytes: checkpoint.bytes };
    assets["native-60"][theme] = { sha256: candidate.sha256, bytes: candidate.bytes };
    reportVariants[theme] = {
      ok: true,
      checkpoint: reportAsset(checkpoint, `checkpoint-${theme}`, checkpointHashes),
      candidate: reportAsset(candidate, `native-60-${theme}`, candidateHashes),
      phaseComparison: {
        ok: true, uniquePhases: 60, mismatchedEvenPhases: [], duplicateIntermediatePhases: [],
      },
    };
  }
  const reports = {
    "native-60": {
      schemaVersion: 1, kind: "independent-quality-candidate-qa", candidateId: "native-60",
      ok: true, errors: [], contract: { frames: 60, loopMs: 1000, preservesCheckpoint: false },
      sourceHashes: { ...currentSourceHashes }, variants: reportVariants,
    },
  };
  const catalog = [
    { id: "checkpoint", themes: checkpoints },
    { id: "native-60", themes: manifests["native-60"] },
  ];
  return { ids, themes, manifests, checkpoints, reports, catalog, assets, currentSourceHashes };
}

test("independent candidate evidence is bound to current sources, catalog, and encoded bytes", () => {
  const fixture = independentBindingFixture();
  assert.deepEqual(validateIndependentCandidateReportBindings(fixture), []);

  fixture.reports["native-60"].sourceHashes["scripts/quality-candidate-qa.mjs"] = "0".repeat(64);
  fixture.reports["native-60"].variants.light.candidate.encodedSha256 = "1".repeat(64);
  const errors = validateIndependentCandidateReportBindings(fixture);
  assert.ok(errors.includes("native-60/independent report source differs: scripts/quality-candidate-qa.mjs"));
  assert.ok(errors.includes("native-60/light candidate report encoded-asset binding differs"));
  assert.equal(sourceBindingsCurrent("native-60", errors), false);
});
