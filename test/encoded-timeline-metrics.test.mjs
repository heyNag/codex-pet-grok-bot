import assert from "node:assert/strict";
import test from "node:test";
import { animationTimeline } from "../src/animation-timeline.mjs";
import {
  cyclicScalarTemporalMetrics,
  encodedTimelineFromDelays,
  timeWeightedAcceleration,
  timeWeightedLinearResidual,
} from "../src/encoded-timeline-metrics.mjs";

test("encoded delay arrays remain the timing source of truth", () => {
  const delays = animationTimeline(60, 1000).map(({ durationMs }) => durationMs);
  const timeline = encodedTimelineFromDelays(delays);

  assert.equal(timeline.frameCount, 60);
  assert.equal(timeline.loopMs, 1000);
  assert.deepEqual(new Set(delays), new Set([16, 17]));
  assert.equal(delays.filter((duration) => duration === 17).length, 40);
  assert.equal(delays.filter((duration) => duration === 16).length, 20);
  assert.equal(timeline.frames.at(-1).endMs, 1000);
  assert.deepEqual(
    timeline.frames.map(({ startMs, durationMs }) => ({ startMs, durationMs })),
    animationTimeline(60, 1000).map(({ startMs, durationMs }) => ({ startMs, durationMs })),
  );
  assert.ok(Object.isFrozen(timeline));
  assert.ok(Object.isFrozen(timeline.frames));
  assert.ok(timeline.frames.every(Object.isFrozen));
});

test("time-weighted residual does not invent curvature on unequal intervals", () => {
  // A unit-speed line sampled at t=-17, 0, +16 is perfectly straight. The
  // ordinary unweighted second difference would incorrectly report 1 here.
  assert.equal(timeWeightedLinearResidual(-17, 0, 16, 17, 16), 0);
  assert.equal(-17 - 2 * 0 + 16, -1);
});

test("non-uniform-grid acceleration is exact for a quadratic", () => {
  const previousIntervalMs = 17;
  const nextIntervalMs = 16;
  const f = (timeMs) => 3 * timeMs ** 2 + 2 * timeMs - 5;
  assert.equal(timeWeightedAcceleration(
    f(-previousIntervalMs),
    f(0),
    f(nextIntervalMs),
    previousIntervalMs,
    nextIntervalMs,
  ), 6);
});

test("cyclic metrics use each encoded interval and stay finite at the seam", () => {
  const delays = animationTimeline(60, 1000).map(({ durationMs }) => durationMs);
  const timeline = encodedTimelineFromDelays(delays);
  const values = timeline.frames.map(({ phase }) => Math.sin(phase * Math.PI * 2));
  const metrics = cyclicScalarTemporalMetrics(values, delays);

  assert.equal(metrics.frameCount, 60);
  assert.equal(metrics.loopMs, 1000);
  assert.equal(metrics.samples[0].previousIntervalMs, delays.at(-1));
  assert.equal(metrics.samples[0].nextIntervalMs, delays[0]);
  assert.ok(Object.values(metrics)
    .filter((value) => typeof value === "number")
    .every(Number.isFinite));
  assert.ok(metrics.maximumAbsoluteSpeedPerMs > 0);
  assert.ok(metrics.maximumAbsoluteAccelerationPerMs2 > 0);
  assert.ok(Object.isFrozen(metrics));
  assert.ok(Object.isFrozen(metrics.samples));
  assert.ok(metrics.samples.every(Object.isFrozen));
});

test("invalid encoded clocks and scalar series fail closed", () => {
  for (const delays of [[], [0], [16.5], [Infinity], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => encodedTimelineFromDelays(delays), RangeError);
  }
  assert.throws(() => cyclicScalarTemporalMetrics([0, 1, 2], [16, 17]), RangeError);
  assert.throws(() => cyclicScalarTemporalMetrics([0, NaN, 2], [16, 17, 17]), RangeError);
  assert.throws(() => timeWeightedLinearResidual(0, 1, 2, 0, 16), RangeError);
  assert.throws(() => timeWeightedAcceleration(0, 1, 2, 17, Infinity), RangeError);
});
