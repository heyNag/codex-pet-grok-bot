import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { qualityCheckpointFrameHashSeal, qualityCheckpointFrameHashes } from "../scripts/quality-checkpoint.mjs";
import { QUALITY_SOURCE_PATHS } from "../scripts/quality-catalog.mjs";
import {
  compareGeometry, comparePhaseHashes, hashCanonicalFrames, hashRgbaFrames,
  parseAnimatedWebp, scalarTemporalMetrics, validateCandidateManifest, validateTimeline, weightedResidual,
} from "../scripts/quality-candidate-qa.mjs";

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
function chunk(kind, bytes) { const header = Buffer.alloc(8); header.write(kind); header.writeUInt32LE(bytes.length, 4); return Buffer.concat([header, bytes, Buffer.alloc(bytes.length & 1)]); }
function fixture(delays) {
  const vp8x = Buffer.alloc(10); vp8x[0] = 2; vp8x.writeUIntLE(1, 4, 3); vp8x.writeUIntLE(1, 7, 3);
  const anim = Buffer.alloc(6);
  const frames = delays.map((delay) => { const frame = Buffer.alloc(16); frame.writeUIntLE(1, 6, 3); frame.writeUIntLE(1, 9, 3); frame.writeUIntLE(delay, 12, 3); return chunk("ANMF", frame); });
  const result = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "binary"), chunk("VP8X", vp8x), chunk("ANIM", anim), ...frames]);
  result.writeUInt32LE(result.length - 8, 4); return result;
}
function split(bytes, width = 3) { return Readable.from(Array.from({ length: Math.ceil(bytes.length / width) }, (_, index) => bytes.subarray(index * width, (index + 1) * width))); }

test("candidate manifest binds its own timing, raster, and complete source set", () => {
  const sourceFiles = QUALITY_SOURCE_PATHS;
  const sources = Object.fromEntries(sourceFiles.map((file) => [file, digest(file)]));
  const timeline = animationTimeline(60, 990);
  const manifest = {
    id: "control-60", theme: "dark", frames: 60, loopMs: 990, timeline,
    delays: timeline.map(({ durationMs }) => durationMs), sourceHashes: sources,
    checkpointDecodedFrameHashSeal: qualityCheckpointFrameHashSeal(qualityCheckpointFrameHashes("dark")),
    preservesAllCheckpointPhases: true,
  };
  assert.equal(validateCandidateManifest(manifest, "control-60", "dark", sources).ok, true);
  assert.equal(validateCandidateManifest({ ...manifest, theme: "light" }, "control-60", "dark", sources).ok, false);
  assert.equal(validateCandidateManifest({ ...manifest, sourceHashes: {} }, "control-60", "dark", sources).ok, false);
  assert.equal(validateCandidateManifest({ ...manifest, sourceHashes: { ...sources, "../unrelated": digest("unrelated") } }, "control-60", "dark", sources).ok, false);
  assert.equal(validateCandidateManifest(manifest, "control-60", "dark", { ...sources, "src/spec.mjs": digest("changed") }).ok, false);
  assert.equal(validateCandidateManifest({ ...manifest, checkpointDecodedFrameHashSeal: digest("changed") }, "control-60", "dark", sources).ok, false);
  const nativeTimeline = animationTimeline(60, 1000);
  const coverageSources = { ...sources, "src/coverage-raster.mjs": digest("coverage") };
  const coverage = { ...manifest, id: "coverage-60", loopMs: 1000, raster: "coverage", timeline: nativeTimeline, delays: nativeTimeline.map(({ durationMs }) => durationMs), sourceHashes: coverageSources, preservesAllCheckpointPhases: false };
  assert.equal(validateCandidateManifest(coverage, "coverage-60", "dark", coverageSources).ok, true);
  assert.equal(validateCandidateManifest({ ...coverage, preservesAllCheckpointPhases: true }, "coverage-60", "dark", coverageSources).ok, false);
  assert.equal(validateCandidateManifest({ ...coverage, raster: undefined }, "coverage-60", "dark", coverageSources).ok, false);
  assert.equal(validateCandidateManifest({ ...coverage, timeline }, "coverage-60", "dark", coverageSources).ok, false);
});

test("RIFF timing audit separates the 990 and 1000 ms contracts", () => {
  const control = parseAnimatedWebp(fixture(animationTimeline(60, 990).map((frame) => frame.durationMs)));
  assert.equal(validateTimeline(control, 60, 990).ok, true);
  assert.deepEqual(control.delays.slice(0, 6), [17, 16, 17, 16, 17, 16]);
  assert.equal(validateTimeline(control, 60, 1000).ok, false);
  const native = parseAnimatedWebp(fixture(animationTimeline(60, 1000).map((frame) => frame.durationMs)));
  assert.equal(validateTimeline(native, 60, 1000).ok, true);
  assert.equal(validateTimeline(native, 60, 990).ok, false);
});

test("RIFF audit rejects incomplete data, invalid bounds, and zero durations", () => {
  const valid = fixture([17, 16]);
  assert.throws(() => parseAnimatedWebp(valid.subarray(0, -1)), /incomplete/u);
  assert.throws(() => parseAnimatedWebp(fixture([0])), /duration/u);
  const bad = Buffer.from(valid); bad.writeUIntLE(5, 12 + 18 + 14 + 8 + 6, 3);
  assert.throws(() => parseAnimatedWebp(bad), /bounds/u);
});

test("phase comparison requires exact old phases and genuine new phases", () => {
  const checkpoint = Array.from({ length: 30 }, (_, index) => digest(`old-${index}`));
  const candidate = checkpoint.flatMap((value, index) => [value, digest(`new-${index}`)]);
  assert.equal(comparePhaseHashes(checkpoint, candidate, { preservesCheckpoint: true }).ok, true);
  const changedEven = [...candidate]; changedEven[12] = digest("changed");
  assert.deepEqual(comparePhaseHashes(checkpoint, changedEven, { preservesCheckpoint: true }).mismatchedEvenPhases, [{ checkpoint: 6, candidate: 12 }]);
  const duplicated = [...candidate]; duplicated[13] = duplicated[12];
  assert.equal(comparePhaseHashes(checkpoint, duplicated, { preservesCheckpoint: true }).ok, false);
  const native = Array.from({ length: 60 }, (_, index) => digest(`native-${index}`));
  const comparison = comparePhaseHashes(checkpoint, native, { preservesCheckpoint: false });
  assert.equal(comparison.ok, true); assert.equal(comparison.comparedEvenPhases, 0);
  assert.throws(() => comparePhaseHashes(checkpoint.slice(1), candidate, { preservesCheckpoint: true }), /requires/u);
});

test("time-weighted curvature does not invent a spike on 17/16 ms linear motion", () => {
  assert.equal(weightedResidual(-34, 0, 32, 17, 16), 0);
  assert.equal(weightedResidual(-32, 0, 34, 16, 17), 0);
  assert.equal(weightedResidual(-34, 10, 32, 17, 16), 10);
  assert.throws(() => weightedResidual(0, 0, 0, 0, 16), /positive/u);
  const flat = scalarTemporalMetrics([3, 3, 3, 3], animationTimeline(4, 66));
  assert.deepEqual(flat, { maxStep: 0, maxSpeedPerMs: 0, maxWeightedResidual: 0, maxAccelerationPerMs2: 0 });
});

test("raw RGBA hashing streams across arbitrary chunk boundaries and rejects omissions", async () => {
  const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const result = await hashRgbaFrames(split(pixels), { width: 1, height: 1, frameCount: 2 });
  assert.equal(result.frameCount, 2);
  assert.deepEqual(result.frameHashes, [pixels.subarray(0, 4), pixels.subarray(4)].map((bytes) => createHash("sha256").update(bytes).digest("hex")));
  await assert.rejects(hashRgbaFrames(split(pixels.subarray(0, 7)), { width: 1, height: 1, frameCount: 2 }), /Truncated/u);
  await assert.rejects(hashRgbaFrames(split(Buffer.concat([pixels, Buffer.from([9])])), { width: 1, height: 1, frameCount: 2 }), /Extra/u);
});

test("canonical stream parser validates frame timestamps and full-canvas byte coverage", async () => {
  const header = Buffer.alloc(24); header.write("QWP1"); header.writeUInt32LE(1, 4); header.writeUInt32LE(1, 8); header.writeUInt32LE(2, 12); header.writeUInt32LE(0x010600, 20);
  const first = Buffer.alloc(4); first.writeUInt32LE(17); const second = Buffer.alloc(4); second.writeUInt32LE(33);
  const bytes = Buffer.concat([header, first, Buffer.from([1, 2, 3, 4]), second, Buffer.from([5, 6, 7, 8])]);
  const result = await hashCanonicalFrames(split(bytes));
  assert.deepEqual(result.delays, [17, 16]); assert.equal(result.libwebpVersion, "1.6.0");
  const wrong = Buffer.from(bytes); wrong.writeUInt32LE(17, 32);
  await assert.rejects(hashCanonicalFrames(split(wrong)), /timestamps/u);
  await assert.rejects(hashCanonicalFrames(split(bytes.subarray(0, -1))), /Truncated/u);
});

test("controlled geometry preserves checkpoint poses and reduces meaningful within-cell steps", () => {
  const report = compareGeometry(990);
  assert.equal(report.sequences.length, 25); assert.equal(report.evenPosesExact, true);
  assert.equal(report.hostCellSwitchInterpolation, false);
  for (const sequence of report.sequences.filter((sequence) => [0, 5, 6, 7, 8].includes(sequence.row))) {
    assert.ok(sequence.maxEyePointStepRatio > 0.45 && sequence.maxEyePointStepRatio < 0.6);
  }
  const native = compareGeometry(1000);
  assert.equal(native.evenPoseEqualityRequired, false); assert.equal(native.evenPosesExact, null);
});
