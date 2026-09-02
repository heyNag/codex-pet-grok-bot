import assert from "node:assert/strict";
import test from "node:test";
import { inspectSourceMotionStudies } from "../scripts/source-motion-qa.mjs";
import { SOURCE_MOTION_TEMPORAL_GATE } from "../scripts/source-motion-temporal-qa.mjs";
import {
  SOURCE_MOTION_ACTIVE_SECONDS,
  SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
  maximumTimelineHoldOverlapMs,
  sourceMotionFrameDelaysMs,
} from "../src/source-motion-timing.mjs";

test("the 60 Hz source-motion clock has exact integer-millisecond timing", () => {
  const delays = sourceMotionFrameDelaysMs();
  assert.equal(delays.length, 156);
  assert.deepEqual(new Set(delays), new Set([16, 17]));
  assert.equal(delays.reduce((total, delay) => total + delay, 0), 2600);
  assert.equal(
    maximumTimelineHoldOverlapMs(delays, 0, SOURCE_MOTION_ACTIVE_SECONDS * 1000),
    17,
  );
});

test("all displayed frames, adjacent transitions, and loop seams satisfy the source-motion gate", async () => {
  const report = await inspectSourceMotionStudies();
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.summary.effects, 14);
  assert.equal(report.summary.themes, 2);
  assert.equal(report.summary.assets, 28);
  assert.ok(report.summary.maximumActiveHoldMs <= SOURCE_MOTION_MAX_ACTIVE_HOLD_MS);
  assert.ok(report.assets.every(({ maximumActiveHoldMs }) => maximumActiveHoldMs <= 34));
  assert.equal(
    report.summary.displayedFrames,
    report.assets.reduce((total, asset) => total + asset.pages, 0),
    "every displayed page must own exactly one outgoing transition, including its loop seam",
  );
  assert.equal(report.summary.adjacentTransitions, report.summary.displayedFrames - report.summary.assets);
  assert.equal(report.summary.loopSeams, report.summary.assets);
  assert.equal(report.summary.eyeTransitionLandmarks, report.summary.assets * 2);
  assert.equal(report.summary.failingTemporalTransitions, 0);
  assert.equal(report.eyeTransition.passes, true);
  assert.ok(
    report.summary.maximumEyeInkStepFraction <= SOURCE_MOTION_TEMPORAL_GATE.maximumEyeInkStepFraction,
  );
  assert.ok(report.assets.every(({ temporal, pages }) => (
    temporal.transitions.length === pages
      && temporal.adjacentTransitions === pages - 1
      && temporal.loopSeams === 1
      && temporal.eyeTransitionLandmarks.length === 2
  )));
  for (const asset of report.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      asset.temporal.transitions.map(({ fromPage }) => fromPage),
      Array.from({ length: asset.pages }, (_, page) => page),
      `${asset.key} did not trace every displayed page in order`,
    );
    assert.ok(asset.temporal.transitions.every((transition, index) => (
      transition.toPage === (index + 1) % asset.pages
        && transition.seam === (index === asset.pages - 1)
        && transition.displayIntervalMs > 0
        && transition.flags.length === 0
    )), `${asset.key} contains an untraced, misordered, or failing displayed transition`);
  }
  assert.equal(report.artifacts.worstCaseSheetRows.length, report.summary.assets);
  assert.match(report.artifacts.allFrameSheetSha256, /^[a-f0-9]{64}$/);
  assert.match(report.artifacts.worstCaseSheetSha256, /^[a-f0-9]{64}$/);
});
