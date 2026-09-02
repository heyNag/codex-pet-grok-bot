import { GROK_EYE_TOPOLOGIES } from "./grok-eye-topologies.mjs";
import { animationTimeline } from "./animation-timeline.mjs";

const TAU = Math.PI * 2;

// Codex advances semantic atlas cells on its own timers. The WebP animation has
// an independent clock, so every sub-frame must remain valid at every possible
// cell-switch phase. Timed rows render one deliberately cyclic performance into
// every populated column at a given page; gaze rows preserve their directional
// cells and add only a shared, bounded micro-motion.
export const FLUID_ATLAS_FRAME_COUNT = 60;
export const FLUID_ATLAS_LOOP_MS = 1000;
// The encoded clock uses cumulative integer-millisecond timing: forty 17 ms
// pages and twenty 16 ms pages with no accumulated loop drift. There is no
// single integer frame-delay contract.
const FLUID_ATLAS_TIMELINE = animationTimeline(FLUID_ATLAS_FRAME_COUNT, FLUID_ATLAS_LOOP_MS);

const ROW_MOTION = Object.freeze({
  "gaze-000-157": Object.freeze({ cycles: 1, scaleX: 0.0014, scaleY: 0.0018, leanX: 0.10, leanY: 0.32, rotation: 0.06, gazeX: 0, gazeY: 0 }),
  "gaze-180-337": Object.freeze({ cycles: 1, scaleX: 0.0014, scaleY: 0.0018, leanX: 0.10, leanY: 0.32, rotation: 0.06, gazeX: 0, gazeY: 0 }),
});

const ROW_TIMELINE_CYCLES = Object.freeze({
  idle: 1,
  "running-right": 1,
  "running-left": 1,
  waving: 1,
  jumping: 1,
  failed: 1,
  waiting: 1,
  running: 1,
  review: 1,
});

const INTERPOLATED_NUMERIC_FIELDS = Object.freeze([
  "scaleX",
  "scaleY",
  "anchorY",
  "leanX",
  "leanY",
  "rotation",
  "skewX",
  "gazeX",
  "gazeY",
  "effectOpacity",
  "bodyOpacity",
]);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const wrap = (index, length) => (index % length + length) % length;

function catmullRom(p0, p1, p2, p3, amount) {
  const amount2 = amount * amount;
  const amount3 = amount2 * amount;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * amount
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * amount2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * amount3
  );
}

function effectiveTopology(pose) {
  const from = GROK_EYE_TOPOLOGIES[pose.topology];
  if (!from) throw new Error(`Unknown eye topology in fluid atlas: ${pose.topology}`);
  const to = Number.isInteger(pose.topologyTo) ? GROK_EYE_TOPOLOGIES[pose.topologyTo] : null;
  if (!to) return from;
  const mix = clamp(finite(pose.topologyMix), 0, 1);
  return from.map((eye, eyeIndex) => eye.map(([x, y], pointIndex) => {
    const [targetX, targetY] = to[eyeIndex][pointIndex];
    return [x + (targetX - x) * mix, y + (targetY - y) * mix];
  }));
}

function interpolateTopology(previous, from, to, after, amount) {
  const topologies = [previous, from, to, after].map(effectiveTopology);
  return topologies[1].map((eye, eyeIndex) => eye.map((_, pointIndex) => [
    catmullRom(
      topologies[0][eyeIndex][pointIndex][0],
      topologies[1][eyeIndex][pointIndex][0],
      topologies[2][eyeIndex][pointIndex][0],
      topologies[3][eyeIndex][pointIndex][0],
      amount,
    ),
    catmullRom(
      topologies[0][eyeIndex][pointIndex][1],
      topologies[1][eyeIndex][pointIndex][1],
      topologies[2][eyeIndex][pointIndex][1],
      topologies[3][eyeIndex][pointIndex][1],
      amount,
    ),
  ]));
}

function interpolateNumericField(frames, field, amount) {
  const defaults = field === "scaleX" ? 0.615
    : field === "scaleY" ? 0.625
      : field === "anchorY" ? 187
        : field === "effectOpacity" || field === "bodyOpacity" ? 1
          : 0;
  return catmullRom(
    finite(frames[0][field], defaults),
    finite(frames[1][field], defaults),
    finite(frames[2][field], defaults),
    finite(frames[3][field], defaults),
    amount,
  );
}

function weightedFramePosition(row, loopPhase, cycleCount) {
  if (row.durations.length !== row.frames.length) {
    throw new Error(`Fluid row ${row.id} must provide one duration per authored frame`);
  }
  const totalDuration = row.durations.reduce((total, duration) => total + duration, 0);
  const cyclePhase = (loopPhase * cycleCount) % 1;
  const target = cyclePhase * totalDuration;
  let elapsed = 0;
  for (let index = 0; index < row.durations.length; index += 1) {
    const duration = row.durations[index];
    if (target < elapsed + duration || index === row.durations.length - 1) {
      return {
        fromIndex: index,
        amount: clamp((target - elapsed) / duration, 0, 1),
        cyclePhase,
      };
    }
    elapsed += duration;
  }
  return { fromIndex: 0, amount: 0, cyclePhase: 0 };
}

export function fluidRowPoseAt(row, frameIndex) {
  if (!ROW_TIMELINE_CYCLES[row.id]) return null;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= FLUID_ATLAS_FRAME_COUNT) {
    throw new RangeError(`Fluid atlas frame is out of range: ${frameIndex}`);
  }
  const pose = fluidRowPoseAtPhase(row, FLUID_ATLAS_TIMELINE[frameIndex].phase);
  pose.name = `fluid-${row.id}-${String(frameIndex).padStart(2, "0")}`;
  return pose;
}

// Continuous choreography sampling lets quality studies vary the encoded clock
// without altering the shipped timeline or duplicating the animation equations.
export function fluidRowPoseAtPhase(row, loopPhase) {
  assertLoopPhase(loopPhase);
  if (!ROW_TIMELINE_CYCLES[row.id]) return null;
  const cycleCount = ROW_TIMELINE_CYCLES[row.id];
  const { fromIndex, amount, cyclePhase } = weightedFramePosition(row, loopPhase, cycleCount);
  const frames = [-1, 0, 1, 2].map((offset) => row.frames[wrap(fromIndex + offset, row.frames.length)]);
  const pose = {
    ...frames[1],
    name: `fluid-${row.id}-phase-${loopPhase.toFixed(8)}`,
    states: [...new Set(row.frames.flatMap((frame) => frame.states ?? []))],
    topology: frames[1].topology,
    topologyTo: undefined,
    topologyMix: undefined,
    fluidTopology: interpolateTopology(...frames, amount),
    fluidMotionPhase: cyclePhase,
  };

  for (const field of INTERPOLATED_NUMERIC_FIELDS) {
    pose[field] = interpolateNumericField(frames, field, amount);
  }

  // Attachments are row-stable in the installed performances. Choosing the
  // nearer authored attachment preserves exact gesture geometry while its
  // dedicated sub-frame motion keeps it alive between semantic poses.
  const nearest = amount < 0.5 ? frames[1] : frames[2];
  pose.arm = nearest.arm;
  pose.fluidArmFrom = frames[1].arm;
  pose.fluidArmTo = frames[2].arm;
  pose.fluidArmMix = amount;
  pose.effect = nearest.effect;
  pose.effectPhase = nearest.effectPhase;
  return pose;
}

export function fluidPoseAt(pose, rowId, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= FLUID_ATLAS_FRAME_COUNT) {
    throw new RangeError(`Fluid atlas frame is out of range: ${frameIndex}`);
  }
  return fluidPoseAtPhase(pose, rowId, FLUID_ATLAS_TIMELINE[frameIndex].phase);
}

export function fluidPoseAtPhase(pose, rowId, loopPhase) {
  assertLoopPhase(loopPhase);
  const motion = ROW_MOTION[rowId];
  if (!motion) throw new Error(`Unknown fluid atlas row: ${rowId}`);

  const motionPhase = (loopPhase * motion.cycles) % 1;
  const angle = motionPhase * TAU;
  // Both harmonics are zero at the loop boundary. The blend avoids a perfectly
  // sinusoidal, mechanical breath without sacrificing a seamless wrap.
  const primary = 0.74 * Math.sin(angle) + 0.26 * Math.sin(angle * 2);
  const secondary = 0.66 * Math.sin(angle) - 0.34 * Math.sin(angle * 3);
  const topologyMix = Number.isInteger(pose.topologyTo)
    ? clamp(finite(pose.topologyMix) + primary * 0.035, 0, 1)
    : pose.topologyMix;

  return {
    ...pose,
    scaleX: finite(pose.scaleX, 0.615) + primary * motion.scaleX,
    scaleY: finite(pose.scaleY, 0.625) - primary * motion.scaleY,
    leanX: finite(pose.leanX) + secondary * motion.leanX,
    leanY: finite(pose.leanY) - primary * motion.leanY,
    rotation: finite(pose.rotation) + secondary * motion.rotation,
    gazeX: clamp(finite(pose.gazeX) + secondary * motion.gazeX, -0.6, 0.6),
    gazeY: clamp(finite(pose.gazeY) + primary * motion.gazeY, -0.6, 0.6),
    topologyMix,
    fluidMotionPhase: motionPhase,
    fluidMotionPrimary: primary,
    fluidMotionSecondary: secondary,
  };
}

function assertLoopPhase(loopPhase) {
  if (!Number.isFinite(loopPhase) || loopPhase < 0 || loopPhase >= 1) {
    throw new RangeError(`Fluid loop phase must be in [0, 1): ${loopPhase}`);
  }
}

export function fluidAtlasDelays() {
  return FLUID_ATLAS_TIMELINE.map(({ durationMs }) => durationMs);
}

export function fluidAtlasTimeline() {
  return FLUID_ATLAS_TIMELINE;
}
