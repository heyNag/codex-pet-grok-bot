import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { ROWS } from "../src/spec.mjs";
import {
  FLUID_ATLAS_FRAME_COUNT,
  FLUID_ATLAS_LOOP_MS,
  fluidAtlasDelays,
  fluidAtlasTimeline,
  fluidPoseAt,
  fluidPoseAtPhase,
  fluidRowPoseAt,
  fluidRowPoseAtPhase,
} from "../src/fluid-atlas.mjs";

test("continuous samplers preserve every checkpoint pose exactly", () => {
  const poses = ROWS.flatMap((row) => Array.from({ length: 30 }, (_, phase) => {
    const timed = fluidRowPoseAtPhase(row, phase / 30);
    return timed
      ? { ...timed, name: `fluid-${row.id}-${String(phase).padStart(2, "0")}` }
      : row.frames.map((pose) => fluidPoseAtPhase(pose, row.id, phase / 30));
  }));
  assert.equal(createHash("sha256").update(JSON.stringify(poses)).digest("hex"),
    "51b47c12ea93946baa165070bd41e021930623ced4c1076a4ba6311186ae4e60");
});

test("the denser control preserves the old loop and all old sample phases", () => {
  const timeline = animationTimeline(60, 990);
  assert.equal(timeline.reduce((sum, frame) => sum + frame.durationMs, 0), 990);
  assert.deepEqual(new Set(timeline.map((frame) => frame.durationMs)), new Set([17, 16]));
  for (let index = 0; index < 30; index += 1) {
    assert.equal(timeline[index * 2].phase, index / 30);
    for (const row of ROWS) {
      const actual = fluidRowPoseAtPhase(row, timeline[index * 2].phase);
      const expected = fluidRowPoseAtPhase(row, index / 30);
      if (actual) {
        assert.deepEqual(actual, expected);
      } else {
        for (const pose of row.frames) {
          assert.deepEqual(fluidPoseAtPhase(pose, row.id, timeline[index * 2].phase),
            fluidPoseAtPhase(pose, row.id, index / 30));
        }
      }
    }
  }
});

test("60 Hz uses exact cumulative integer timing with no loop drift", () => {
  const timeline = animationTimeline(60, 1000);
  assert.equal(timeline.reduce((sum, frame) => sum + frame.durationMs, 0), 1000);
  assert.equal(timeline.filter(({ durationMs }) => durationMs === 17).length, 40);
  assert.equal(timeline.filter(({ durationMs }) => durationMs === 16).length, 20);
  for (const frame of timeline) {
    assert.ok(Math.abs(frame.startMs - frame.index * 1000 / 60) <= 0.5);
    assert.equal(frame.phase, frame.startMs / 1000);
    assert.ok(Object.isFrozen(frame));
  }
  assert.ok(Object.isFrozen(timeline));
});

test("production frame-index samplers use the exact encoded start phases", () => {
  const timeline = animationTimeline(FLUID_ATLAS_FRAME_COUNT, FLUID_ATLAS_LOOP_MS);
  assert.deepEqual(fluidAtlasTimeline(), timeline);
  assert.deepEqual(fluidAtlasDelays(), timeline.map(({ durationMs }) => durationMs));

  for (const frame of timeline) {
    for (const row of ROWS) {
      const indexedRow = fluidRowPoseAt(row, frame.index);
      const phaseRow = fluidRowPoseAtPhase(row, frame.phase);
      if (indexedRow) {
        assert.deepEqual(
          { ...indexedRow, name: phaseRow.name },
          phaseRow,
        );
        continue;
      }
      for (const pose of row.frames) {
        assert.deepEqual(
          fluidPoseAt(pose, row.id, frame.index),
          fluidPoseAtPhase(pose, row.id, frame.phase),
        );
      }
    }
  }
});

test("invalid clocks and phases are rejected instead of silently wrapping", () => {
  for (const args of [[0, 990], [2.5, 990], [60, 59], [60, 990.5], [NaN, 990]]) {
    assert.throws(() => animationTimeline(...args), RangeError);
  }
  for (const phase of [-0.1, 1, Infinity, NaN]) {
    assert.throws(() => fluidRowPoseAtPhase(ROWS[0], phase), RangeError);
    assert.throws(() => fluidPoseAtPhase(ROWS[9].frames[0], ROWS[9].id, phase), RangeError);
  }
});
