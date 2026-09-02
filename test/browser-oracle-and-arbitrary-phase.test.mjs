import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateSync } from "node:zlib";
import { verifyArbitraryPhaseTraceIntegrity } from "../scripts/arbitrary-phase-report-integrity.mjs";
import {
  analyzeArbitraryPhaseRgbaSequence,
  analyzeAuthoredCellCycle,
  analyzeAuthoredStateEdge,
  analyzeContinuityAlias,
  analyzeSampledContinuity,
  authoredCellCycleProfile,
  authoredCellOrderedMetricTraceSha256,
  authoredStateEdgeProfile,
  sampledContinuityMetricTrace,
} from "../scripts/arbitrary-phase-qa.mjs";
import {
  CODEX_DEFAULT_DPR2_DISPLAY,
  CODEX_DEFAULT_DPR2_ORACLE_REPORT,
  codexDefaultDpr2CellMap,
  decodeCodexDefaultDpr2CompactMap,
  renderCodexDefaultDpr2Frame,
} from "../scripts/codex-default-dpr2-oracle.mjs";
import { analyzeTemporalRgbaSequence } from "../scripts/animated-atlas-qa.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("exact default DPR2 oracle is independently screenshot-bound and losslessly round-tripped", async () => {
  const report = CODEX_DEFAULT_DPR2_ORACLE_REPORT;
  const diagnostic = await readFile(path.join(root, report.screenshotProbe.diagnosticPath));
  const compressed = await readFile(path.join(root, report.sourceMaps.compressedPath));

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.renderer.browser, "Chrome/151.0.7922.174");
  assert.equal(report.target.cssWidthExpression, "7.04rem");
  assert.deepEqual(report.target.measuredDeviceFootprint, { width: 225, height: 244 });
  assert.equal(CODEX_DEFAULT_DPR2_DISPLAY.devicePixelRatio, 2);
  assert.equal(sha256(diagnostic), report.screenshotProbe.diagnosticSha256);
  assert.equal(sha256(compressed), report.sourceMaps.compressedSha256);
  assert.equal(report.sourceMaps.rawSha256, report.sourceMaps.roundTripRawSha256);
  assert.equal(report.sourceMaps.allCellCount, 88);
  assert.equal(report.target.originContract.fixtureCssOriginsAreIntegers, true);
  assert.equal(report.target.originContract.capturedHostOriginsAreIntegers, true);
  assert.ok(report.target.actualHostElements.length >= 1);
  for (const { rect, deviceOrigin, dpr, backgroundSize, imageRendering, backgroundPositionUsesAtlasGrid } of report.target.actualHostElements) {
    assert.equal(deviceOrigin.x, rect.x * dpr);
    assert.equal(deviceOrigin.y, rect.y * dpr);
    assert.equal(rect.width, 112.6328125);
    assert.equal(rect.height, 122.015625);
    assert.equal(backgroundSize, "800% 1100%");
    assert.equal(imageRendering, "pixelated");
    assert.equal(backgroundPositionUsesAtlasGrid, true);
  }
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.target), true);
  assert.equal(Object.isFrozen(report.target.originContract), true);
});

test("browser-oracle map exports are immutable copies and decoder rejects out-of-cell coordinates", async () => {
  const first = codexDefaultDpr2CellMap(0, 0);
  const original = Buffer.from(first);
  first.fill(255);
  assert.deepEqual(codexDefaultDpr2CellMap(0, 0), original);

  const report = CODEX_DEFAULT_DPR2_ORACLE_REPORT;
  const compressed = await readFile(path.join(root, report.sourceMaps.compressedPath));
  const corrupt = Buffer.from(inflateSync(compressed));
  corrupt[18] = 192;
  assert.throws(
    () => decodeCodexDefaultDpr2CompactMap(corrupt),
    /outside its 192x208 cell/u,
  );
});

test("exact browser sampler rejects a self-derived separable coordinate helper", () => {
  let differingPixels = 0;
  let nonSeparableY = 0;
  for (let row = 0; row < 11; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const map = codexDefaultDpr2CellMap(row, column);
      const baseX = Array.from({ length: 225 }, (_, x) => map[x * 2]);
      const baseY = Array.from({ length: 244 }, (_, y) => map[(y * 225) * 2 + 1]);
      for (let pixel = 0; pixel < 225 * 244; pixel += 1) {
        const x = pixel % 225;
        const y = Math.floor(pixel / 225);
        if (map[pixel * 2] !== baseX[x]) differingPixels += 1;
        if (map[pixel * 2 + 1] !== baseY[y]) nonSeparableY += 1;
      }
    }
  }
  assert.equal(differingPixels, CODEX_DEFAULT_DPR2_ORACLE_REPORT.sourceMaps.nonSeparablePixels.x);
  assert.equal(differingPixels, 2276);
  assert.equal(nonSeparableY, 0);
});

test("browser-oracle renderer consumes every captured two-dimensional coordinate", () => {
  const atlas = Buffer.alloc(1536 * 2288 * 4);
  const row = 6;
  const column = 5;
  for (let y = 0; y < 208; y += 1) {
    for (let x = 0; x < 192; x += 1) {
      const offset = ((row * 208 + y) * 1536 + column * 192 + x) * 4;
      atlas[offset] = x;
      atlas[offset + 1] = y;
      atlas[offset + 2] = (x + y) % 256;
      atlas[offset + 3] = 255;
    }
  }
  const map = codexDefaultDpr2CellMap(row, column);
  const rendered = renderCodexDefaultDpr2Frame(atlas, row, column);
  for (let pixel = 0; pixel < 225 * 244; pixel += 1) {
    assert.deepEqual(
      [...rendered.subarray(pixel * 4, pixel * 4 + 4)],
      [map[pixel * 2], map[pixel * 2 + 1], (map[pixel * 2] + map[pixel * 2 + 1]) % 256, 255],
    );
  }
});

function skippedPhaseFixture() {
  const width = 192;
  const height = 208;
  return Array.from({ length: 60 }, (_, phase) => {
    const frame = Buffer.alloc(width * height * 4);
    const travel = phase <= 29 ? phase : phase < 59 ? 58 - phase : 0;
    // Keep p58->p59 active while the return-position silhouette stays loop-stable.
    const red = phase === 59 ? 10 : 8;
    for (let y = 172; y < 196; y += 1) {
      for (let x = 20 + travel; x < 40 + travel; x += 1) {
        const offset = (y * width + x) * 4;
        frame[offset] = red;
        frame[offset + 1] = 11;
        frame[offset + 2] = 12;
        frame[offset + 3] = 128;
      }
    }
    return frame;
  });
}

test("arbitrary phase gate catches slow skipped-phase drift that adjacency QA accepts", () => {
  const frames = skippedPhaseFixture();
  const adjacency = analyzeTemporalRgbaSequence({ frames, variant: "dark", row: 0 });
  const arbitrary = analyzeArbitraryPhaseRgbaSequence({ frames, theme: "dark", row: 0 });

  assert.equal(frames.length, 60);
  assert.deepEqual(adjacency.errors, []);
  assert.equal(adjacency.cell.motionExists, true);
  assert.equal(adjacency.cell.fullCycleMotion.mode, "per-internal-transition");
  assert.equal(adjacency.cell.fullCycleMotion.passesSelectedGate, true);
  assert.equal(adjacency.cell.temporalAdjacency.completeCoverage, true);
  assert.equal(adjacency.cell.temporalAdjacency.upperBoundSafe, true);
  assert.equal(adjacency.cell.temporalAdjacency.failingTransitionCount, 0);
  assert.equal(adjacency.cell.isolatedFrameExcursions.failingFrameCount, 0);
  assert.equal(adjacency.cell.loopNotWorse, true);
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.pairCount, 60 * 59);
  const longSkip = arbitrary.failures.find(({ id }) => id === "p0->p29");
  assert.ok(longSkip);
  assert.deepEqual(longSkip.flags, ["silhouetteIou", "silhouetteCentroidDistancePx"]);
  assert.equal(longSkip.metrics.silhouetteIou, 0);
  assert.equal(longSkip.metrics.silhouetteCentroidDistancePx, 29);
});

function localMotionFixture({ width = 40, height = 28, amplitude = 10, tint = [245, 245, 245] } = {}) {
  return Array.from({ length: 30 }, (_, phase) => {
    const frame = Buffer.alloc(width * height * 4);
    const wave = Math.sin(phase / 30 * Math.PI * 2);
    const centerX = 16 + Math.round(wave * amplitude);
    for (let y = 10; y < 18; y += 1) {
      for (let x = centerX - 4; x < centerX + 4; x += 1) {
        const offset = (y * width + x) * 4;
        frame[offset] = tint[0];
        frame[offset + 1] = tint[1];
        frame[offset + 2] = tint[2];
        frame[offset + 3] = 255;
      }
    }
    return frame;
  });
}

test("per-cell authored baseline catches high-motion local collapse hidden by a family floor", () => {
  const width = 40;
  const height = 28;
  const authored = localMotionFixture({ width, height, amplitude: 10 });
  const collapsed = localMotionFixture({ width, height, amplitude: 2 });
  const baseline = authoredCellCycleProfile({ frames: authored, width, height, theme: "dark" });
  const result = analyzeAuthoredCellCycle({ frames: collapsed, baseline, width, height, theme: "dark" });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some(({ metric, direction }) => metric === "silhouetteCentroidDiameterPx" && direction === "below"));
  assert.ok(result.failures.some(({ metric, direction }) => metric === "perceptualDiameterRms" && direction === "below"));
});

test("per-cell orderedMetricTraceSha256 seal rejects a mutation that remains inside the 96%-104% envelope", () => {
  const width = 40;
  const height = 28;
  const identifier = "fixture-cell";
  const authored = localMotionFixture({ width, height, amplitude: 10 });
  const mutated = authored.map((frame) => Buffer.from(frame));
  mutated[0][(12 * width + 16) * 4] ^= 1;
  const baseline = authoredCellCycleProfile({ frames: authored, width, height, theme: "dark" });
  const expectedOrderedMetricTraceSha256 = authoredCellOrderedMetricTraceSha256({
    frames: authored,
    width,
    height,
    theme: "dark",
    identifier,
  });

  const envelopeOnly = analyzeAuthoredCellCycle({
    frames: mutated,
    baseline,
    width,
    height,
    theme: "dark",
  });
  assert.equal(envelopeOnly.ok, true, "the mutation must remain inside every local profile envelope");
  assert.deepEqual(envelopeOnly.failures, []);

  const sealed = analyzeAuthoredCellCycle({
    frames: mutated,
    baseline,
    expectedOrderedMetricTraceSha256,
    identifier,
    width,
    height,
    theme: "dark",
  });
  assert.equal(sealed.ok, false);
  assert.notEqual(sealed.orderedMetricTraceSha256, expectedOrderedMetricTraceSha256);
  assert.deepEqual(sealed.failures.map(({ metric }) => metric), ["orderedMetricTraceSha256"]);
});

test("same-phase semantic baseline catches identical nonstatic state sequences", () => {
  const width = 40;
  const height = 28;
  const left = localMotionFixture({ width, height, amplitude: 8, tint: [245, 245, 245] });
  const authoredRight = localMotionFixture({ width, height, amplitude: 8, tint: [65, 190, 255] });
  const baseline = authoredStateEdgeProfile({
    leftFrames: left,
    rightFrames: authoredRight,
    width,
    height,
    theme: "dark",
  });
  const result = analyzeAuthoredStateEdge({
    leftFrames: left,
    rightFrames: left,
    baseline,
    width,
    height,
    theme: "dark",
  });

  assert.equal(result.ok, false);
  assert.ok(result.profile[3] > 0, "shared internal motion still leaves a nonzero cross-phase maximum");
  assert.equal(result.profile[7], 0, "same-phase semantic energy collapses to zero");
  assert.ok(result.failures.some(({ metric, direction }) => metric === "samePhasePerceptualRms" && direction === "below"));
});

test("source continuity alias rejects a one-pixel mutation in one decoder phase", () => {
  const left = localMotionFixture({});
  const right = left.map((frame) => Buffer.from(frame));
  right[17][(12 * 40 + 16) * 4] ^= 1;

  const result = analyzeContinuityAlias({ leftFrames: left, rightFrames: right });
  assert.equal(result.ok, false);
  assert.deepEqual(result.differingPhases, [17]);
});

function renderCellThroughMap(source, map) {
  const rendered = Buffer.alloc(225 * 244 * 4);
  for (let pixel = 0; pixel < 225 * 244; pixel += 1) {
    const sourceOffset = (map[pixel * 2 + 1] * 192 + map[pixel * 2]) * 4;
    source.copy(rendered, pixel * 4, sourceOffset, sourceOffset + 4);
  }
  return rendered;
}

test("sampled-continuity trace rejects a separable-map substitution", () => {
  const exactMap = codexDefaultDpr2CellMap(0, 0);
  const separableMap = Buffer.alloc(exactMap.length);
  const baseX = Array.from({ length: 225 }, (_, x) => exactMap[x * 2]);
  const baseY = Array.from({ length: 244 }, (_, y) => exactMap[(y * 225) * 2 + 1]);
  for (let pixel = 0; pixel < 225 * 244; pixel += 1) {
    separableMap[pixel * 2] = baseX[pixel % 225];
    separableMap[pixel * 2 + 1] = baseY[Math.floor(pixel / 225)];
  }
  assert.notDeepEqual(separableMap, exactMap, "fixture cell must contain browser-specific nonseparable samples");

  const sources = Array.from({ length: 30 }, (_, phase) => {
    const source = Buffer.alloc(192 * 208 * 4);
    for (let y = 0; y < 208; y += 1) {
      for (let x = 0; x < 192; x += 1) {
        const offset = (y * 192 + x) * 4;
        source[offset] = (x * 5 + phase * 3) % 256;
        source[offset + 1] = (y * 7 + phase * 11) % 256;
        source[offset + 2] = (x + y + phase * 13) % 256;
        source[offset + 3] = 255;
      }
    }
    return source;
  });
  const exact = sources.map((source) => renderCellThroughMap(source, exactMap));
  const substituted = sources.map((source) => renderCellThroughMap(source, separableMap));
  const expectedTraceSha256 = sampledContinuityMetricTrace({
    leftFrames: exact,
    rightFrames: exact,
    width: 225,
    height: 244,
    theme: "dark",
  });
  const result = analyzeSampledContinuity({
    leftFrames: exact,
    rightFrames: substituted,
    expectedTraceSha256,
    width: 225,
    height: 244,
    theme: "dark",
  });
  assert.equal(result.ok, false);
  assert.notEqual(result.actualTraceSha256, expectedTraceSha256);
});

test("sealed arbitrary-phase report rejects valid-looking baseline-binding and aggregate trace tampering", async (t) => {
  const report = JSON.parse(await readFile(path.join(root, "qa/arbitrary-phase-qa.json")));
  const baseline = JSON.parse(gunzipSync(
    await readFile(path.join(root, "qa/arbitrary-phase-baselines.json.gz")),
  ));
  assert.deepEqual(
    verifyArbitraryPhaseTraceIntegrity({ report, baseline }),
    {
      ok: true,
      exactPhasePairCount: 27_140_880,
      exactItemTraceCount: 7_544,
      hostGraphOrderedSha256: "8970e497ceced7b3a0a1b031c6a75bdbe544011887fe69a93798675bb0dad736",
    },
  );

  const mutations = [
    [
      "browser-map binding",
      (candidate) => { candidate.browserOracle.rawRoundTripSha256 = "5".repeat(64); },
      /browser map binding does not match/u,
    ],
    [
      "decoded-atlas binding",
      (candidate) => { candidate.paths.source.themes.dark.atlas.decodedFullPageStackSha256 = "6".repeat(64); },
      /source\/dark decoded atlas binding does not match/u,
    ],
    [
      "row aggregate",
      (candidate) => { candidate.paths.source.themes.dark.within.byRow[0].orderedMetricTraceSha256 = "0".repeat(64); },
      /source\/dark\/row0 ordered metric trace does not match/u,
    ],
    [
      "all-cell aggregate",
      (candidate) => { candidate.paths.source.themes.dark.within.allReachableCells.orderedMetricTraceSha256 = "1".repeat(64); },
      /source\/dark all-cell ordered metric trace does not match/u,
    ],
    [
      "cell-profile aggregate",
      (candidate) => { candidate.paths.source.themes.dark.within.fullCycleMateriality.authoredPerCellBaseline.orderedProfileTraceSha256 = "2".repeat(64); },
      /source\/dark ordered cell-profile trace does not match/u,
    ],
    [
      "edge aggregate",
      (candidate) => { candidate.paths.codexDefaultDpr2.themes.light.stateSwitchFamilies.timedToGaze.orderedMetricTraceSha256 = "3".repeat(64); },
      /codexDefaultDpr2\/light\/timedToGaze ordered all-phase metric trace does not match/u,
    ],
    [
      "edge-profile aggregate",
      (candidate) => { candidate.paths.codexDefaultDpr2.themes.light.stateSwitchFamilies.timedToGaze.authoredPerEdgeBaseline.orderedProfileTraceSha256 = "4".repeat(64); },
      /codexDefaultDpr2\/light\/timedToGaze ordered edge-profile trace does not match/u,
    ],
  ];
  for (const [name, mutate, expected] of mutations) {
    await t.test(name, () => {
      const candidate = structuredClone(report);
      mutate(candidate);
      assert.throws(
        () => verifyArbitraryPhaseTraceIntegrity({ report: candidate, baseline }),
        expected,
      );
    });
  }
});
