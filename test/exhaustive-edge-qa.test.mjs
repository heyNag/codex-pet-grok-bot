import assert from "node:assert/strict";
import test from "node:test";
import {
  ANMF_REGRESSION_FIXTURE,
  finalizePixelAccumulator,
  inspectFramePair,
  inspectSourceMotionCss,
  makePixelAccumulator,
  parseAnimatedWebpFrameHeaders,
  timelineMap,
  verifyDecoderRegressionFixture,
} from "../scripts/exhaustive-edge-qa.mjs";

const FIXTURE_CONTEXT = Object.freeze({
  kind: "shipping",
  variant: "fixture",
  page: 0,
  row: 0,
  column: 0,
  weight: 1,
});

function blankPair(width, height) {
  return {
    dark: Buffer.alloc(width * height * 4),
    light: Buffer.alloc(width * height * 4),
    width,
    height,
  };
}

function setPixel(buffer, width, x, y, rgba) {
  const offset = (y * width + x) * 4;
  buffer.set(rgba, offset);
}

function inspectFixture({ dark, light, width, height }, { gutterPx = 0 } = {}) {
  const accumulator = makePixelAccumulator();
  inspectFramePair(
    dark,
    light,
    width,
    height,
    { ...FIXTURE_CONTEXT, gutterPx },
    accumulator,
  );
  return finalizePixelAccumulator(accumulator);
}

function outerBoundaryFixture(darkEdge, lightEdge) {
  const fixture = blankPair(5, 5);
  setPixel(fixture.dark, fixture.width, 2, 2, darkEdge);
  setPixel(fixture.light, fixture.width, 2, 2, lightEdge);
  setPixel(fixture.dark, fixture.width, 3, 2, [255, 255, 255, 255]);
  setPixel(fixture.light, fixture.width, 3, 2, [0, 0, 0, 255]);
  return fixture;
}

function compositeRgb(rgb, alpha, background) {
  return rgb.map((value, channel) => Math.floor(
    (value * alpha + background[channel] * (255 - alpha) + 127) / 255,
  ));
}

function assertOuterRejection(report, classification) {
  assert.equal(report.ok, false);
  assert.equal(report.outerEdgeContaminationCandidates.total, 1);
  assert.equal(report.outerEdgeContaminationCandidates[classification], 1);
  assert.equal(report.outerEdgeContaminationCandidates.worstCases.length, 1);
  assert.equal(
    report.outerEdgeContaminationCandidates.worstCases[0].classification,
    classification,
  );
  assert.match(report.errors.join("\n"), /reciprocal outer-edge keyline\/halo pixels detected/u);
}

test("animated WebP frame headers retain crop, blend, and disposal semantics", () => {
  const fixture = Buffer.from(ANMF_REGRESSION_FIXTURE.base64, "base64");
  assert.equal(fixture.length, 260);
  assert.deepEqual(
    parseAnimatedWebpFrameHeaders(fixture),
    ANMF_REGRESSION_FIXTURE.frames.map((frame, index) => ({ index, ...frame })),
  );
});

test("Sharp returns full-canvas coalesced RGBA for every stack and page-specific read", async () => {
  const result = await verifyDecoderRegressionFixture();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.pages.length, 4);
  assert.equal(result.pages.every(({ pageSpecificComparison }) => (
    pageSpecificComparison.equal
      && pageSpecificComparison.differingBytes === 0
      && pageSpecificComparison.maximumChannelDelta === 0
  )), true);
  assert.deepEqual(
    result.pages.map(({ sha256 }) => sha256),
    ANMF_REGRESSION_FIXTURE.pageSha256,
  );
  assert.equal(result.semanticPixels.every(({ exact }) => exact), true);
});

test("timeline mapping exposes encoded pages that no nominal sample can reach", () => {
  const result = timelineMap([2, 2, 2, 2], [5, 3]);
  const useCounts = Array.from({ length: 4 }, (_, page) => (
    result.mapping.filter((mappedPage) => mappedPage === page).length
  ));

  assert.equal(result.encodedDurationMs, 8);
  assert.equal(result.nominalDurationMs, 8);
  assert.deepEqual(result.encodedEnds, [2, 4, 6, 8]);
  assert.deepEqual(result.mapping, [0, 2]);
  assert.deepEqual(useCounts, [1, 0, 1, 0]);
  assert.deepEqual(
    useCounts.flatMap((count, page) => (count === 0 ? [page] : [])),
    [1, 3],
  );
});

test("source-motion art has no filter, shadow, opacity, blend, or resampling override", async () => {
  const report = await inspectSourceMotionCss();

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.deepEqual(report.forbiddenFilterOrDropShadowMatches, []);
  assert.deepEqual(report.inlineStyleMatches, []);
  assert.deepEqual(report.scriptFilterMatches, []);
  assert.equal(report.imageRenderingAuto, true);
  assert.equal(report.heightAuto, true);
  assert.equal(report.displayContract.cssWidthPx, 288);
  assert.deepEqual(report.displayContract.expectedDeviceCanvas, { width: 576, height: 624 });
  assert.equal(report.displayContract.exactAtTargetDevicePixelRatio, true);
  assert.equal(report.stageSurfaceContract.exact, true);
});

test("pixel audit rejects hidden RGB in a fully transparent pixel", () => {
  const fixture = blankPair(3, 3);
  setPixel(fixture.dark, fixture.width, 1, 1, [1, 2, 3, 0]);

  const report = inspectFixture(fixture);

  assert.equal(report.ok, false);
  assert.equal(report.hiddenRgbPixels, 1);
  assert.deepEqual(report.errors, ["1 transparent pixels retain hidden RGB"]);
});

test("pixel audit rejects any non-zero RGBA entering the safety gutter", () => {
  const fixture = blankPair(5, 5);
  setPixel(fixture.dark, fixture.width, 0, 2, [100, 0, 0, 255]);
  setPixel(fixture.light, fixture.width, 0, 2, [100, 0, 0, 255]);

  const report = inspectFixture(fixture, { gutterPx: 1 });

  assert.equal(report.ok, false);
  assert.equal(report.gutterPixelsAcrossVariants, 32);
  assert.equal(report.gutterNonZeroRgbaPixels, 2);
  assert.deepEqual(report.errors, ["2 non-zero RGBA pixels enter a required safety gutter"]);
});

test("pixel audit rejects unequal dark and light alpha", () => {
  const fixture = blankPair(3, 3);
  setPixel(fixture.dark, fixture.width, 1, 1, [255, 255, 255, 128]);
  setPixel(fixture.light, fixture.width, 1, 1, [0, 0, 0, 127]);

  const report = inspectFixture(fixture);

  assert.equal(report.ok, false);
  assert.equal(report.alphaMismatchPixels, 1);
  assert.deepEqual(report.errors, ["1 dark/light pixel pairs have unequal alpha"]);
});

test("natural straight-alpha shell antialiasing remains valid", () => {
  const fixture = blankPair(7, 7);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) {
      const opaque = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, opaque ? 255 : 128]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, opaque ? 255 : 128]);
    }
  }

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.relation.inverseRgb, 16);
  assert.equal(report.matteCandidates.total, 0);
  assert.equal(report.outerEdgeContaminationCandidates.total, 0);
});

test("former straight-alpha reversed semitransparent keyline is rejected", () => {
  const report = inspectFixture(outerBoundaryFixture(
    [0, 0, 0, 128],
    [255, 255, 255, 128],
  ));

  assertOuterRejection(report, "reversedSemitransparent");
  assert.equal(report.relation.inverseRgb, 1);
});

test("a connected thin reversed keyline strip remains rejected", () => {
  const fixture = blankPair(9, 9);
  for (let y = 2; y <= 6; y += 1) {
    setPixel(fixture.dark, fixture.width, 3, y, [0, 0, 0, 128]);
    setPixel(fixture.light, fixture.width, 3, y, [255, 255, 255, 128]);
    for (let x = 4; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, 255]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, 255]);
    }
  }

  const report = inspectFixture(fixture);

  assert.equal(report.ok, false);
  assert.equal(report.outerEdgeContaminationCandidates.reversedSemitransparent, 5);
  assert.equal(report.intentionalOuterEdgeFeatureExclusions.compactInverseFeature, 0);
});

test("opaque reversed outer keyline is rejected", () => {
  const report = inspectFixture(outerBoundaryFixture(
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ));

  assertOuterRejection(report, "reversedOpaque");
});

test("same-neutral outer halo is rejected", () => {
  const report = inspectFixture(outerBoundaryFixture(
    [96, 96, 96, 128],
    [96, 96, 96, 128],
  ));

  assertOuterRejection(report, "sameNeutralHalo");
  assert.equal(report.relation.sameRgb, 1);
});

test("reciprocal premultiplied or stage-matted shell is rejected", () => {
  const alpha = 128;
  const darkMatted = compositeRgb([255, 255, 255], alpha, [8, 11, 12]);
  const lightMatted = compositeRgb([0, 0, 0], alpha, [243, 241, 233]);
  const report = inspectFixture(outerBoundaryFixture(
    [...darkMatted, alpha],
    [...lightMatted, alpha],
  ));

  assertOuterRejection(report, "reciprocalPremattedShell");
  assert.deepEqual(
    report.outerEdgeContaminationCandidates.worstCases[0].expectedPremattedDark,
    darkMatted,
  );
  assert.deepEqual(
    report.outerEdgeContaminationCandidates.worstCases[0].expectedPremattedLight,
    lightMatted,
  );
});

test("intentional internal inverted eye is not treated as an outer keyline", () => {
  const fixture = blankPair(11, 11);
  for (let y = 1; y <= 9; y += 1) {
    for (let x = 1; x <= 9; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, 255]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, 255]);
    }
  }
  setPixel(fixture.dark, fixture.width, 5, 5, [0, 0, 0, 255]);
  setPixel(fixture.light, fixture.width, 5, 5, [255, 255, 255, 255]);

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.outerEdgeContaminationCandidates.total, 0);
  assert.equal(report.visiblePairPixels, 81);
});

test("clipped inverse eye antialiasing at the silhouette is not treated as an outer keyline", () => {
  const fixture = blankPair(9, 9);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, 255]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, 255]);
    }
  }

  // The opaque eye core at x=5 and its straight-alpha edge at x=6 touch the
  // transparent exterior at x=7. A shell-only topology detector would call
  // the edge a reversed keyline; the adjacent inverse feature core proves it
  // is intentional art at the silhouette.
  setPixel(fixture.dark, fixture.width, 5, 4, [0, 0, 0, 255]);
  setPixel(fixture.light, fixture.width, 5, 4, [255, 255, 255, 255]);
  setPixel(fixture.dark, fixture.width, 6, 4, [0, 0, 0, 128]);
  setPixel(fixture.light, fixture.width, 6, 4, [255, 255, 255, 128]);

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.outerEdgeContaminationCandidates.total, 0);
  assert.equal(report.relation.inverseRgb, 1);
  assert.equal(report.matteCandidates.total, 0);
});

test("a low-opacity compact clipped eye remains an intentional feature", () => {
  const fixture = blankPair(9, 9);
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, 255]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, 255]);
    }
  }
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 4; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [0, 0, 0, 96]);
      setPixel(fixture.light, fixture.width, x, y, [255, 255, 255, 96]);
    }
  }

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.outerEdgeContaminationCandidates.total, 0);
  assert.equal(report.intentionalOuterEdgeFeatureExclusions.compactInverseFeature > 0, true);
  assert.equal(
    report.intentionalOuterEdgeFeatureExclusions.representativeCases
      .some((entry) => entry.intentionalInverseFeature?.pixelCount === 9),
    true,
  );
  assert.equal(
    report.intentionalOuterEdgeFeatureExclusions.representativeCasesByExclusion
      .compactInverseFeature.length > 0,
    true,
  );
});

test("a neutral body-to-eye crossover beside a compact eye is intentional", () => {
  const fixture = blankPair(9, 9);
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [255, 255, 255, 255]);
      setPixel(fixture.light, fixture.width, x, y, [0, 0, 0, 255]);
    }
  }
  setPixel(fixture.dark, fixture.width, 6, 3, [127, 127, 127, 96]);
  setPixel(fixture.light, fixture.width, 6, 3, [127, 127, 127, 96]);
  for (let y = 4; y <= 6; y += 1) {
    for (let x = 4; x <= 6; x += 1) {
      setPixel(fixture.dark, fixture.width, x, y, [0, 0, 0, 96]);
      setPixel(fixture.light, fixture.width, x, y, [255, 255, 255, 96]);
    }
  }

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.outerEdgeContaminationCandidates.sameNeutralHalo, 0);
  assert.equal(report.intentionalOuterEdgeFeatureExclusions.compactInverseFeature > 0, true);
});

test("a neutral low-alpha tail connected to paired chroma is intentional", () => {
  const fixture = outerBoundaryFixture(
    [255, 255, 255, 1],
    [255, 255, 255, 1],
  );
  setPixel(fixture.dark, fixture.width, 2, 1, [147, 192, 249, 45]);
  setPixel(fixture.light, fixture.width, 2, 1, [56, 102, 158, 45]);

  const report = inspectFixture(fixture);

  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.outerEdgeContaminationCandidates.sameNeutralHalo, 0);
  assert.equal(report.intentionalOuterEdgeFeatureExclusions.pairedChromaContinuation, 1);
  assert.equal(
    report.intentionalOuterEdgeFeatureExclusions.representativeCasesByExclusion
      .pairedChromaContinuation.length,
    1,
  );
});
