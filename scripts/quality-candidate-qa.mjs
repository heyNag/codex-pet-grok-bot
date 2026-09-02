#!/usr/bin/env node
// Candidate-only evidence. This never changes shipping assets or production QA.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { fluidPoseAtPhase, fluidRowPoseAtPhase } from "../src/fluid-atlas.mjs";
import { GROK_EYE_TOPOLOGIES } from "../src/grok-eye-topologies.mjs";
import { ATLAS_HEIGHT, ATLAS_WIDTH, ROWS } from "../src/spec.mjs";
import {
  QUALITY_CHECKPOINT_CONTRACT,
  qualityCheckpointFrameHashSeal,
  qualityCheckpointFrameHashes,
  validateQualityCheckpointManifest,
} from "./quality-checkpoint.mjs";
import { QUALITY_SOURCE_PATHS } from "./quality-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(root, "preview/quality-lab/generated");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const candidateContracts = Object.freeze({
  "control-60": Object.freeze({ frames: 60, loopMs: 990, preservesCheckpoint: true }),
  "native-60": Object.freeze({ frames: 60, loopMs: 1000, preservesCheckpoint: false }),
  "coverage-60": Object.freeze({ frames: 60, loopMs: 1000, preservesCheckpoint: false, raster: "coverage" }),
});
const renderSourcePaths = QUALITY_SOURCE_PATHS;

export function validateCandidateManifest(manifest, candidateId, theme, currentSourceHashes) {
  const contract = candidateContracts[candidateId];
  if (!contract) throw new Error("Unknown candidate contract");
  const errors = [];
  const timeline = animationTimeline(contract.frames, contract.loopMs);
  if (manifest?.id !== candidateId || manifest?.theme !== theme
    || manifest?.frames !== contract.frames || manifest?.loopMs !== contract.loopMs) errors.push("candidate identity or timing contract differs");
  if (!equal(manifest?.delays, timeline.map(({ durationMs }) => durationMs)) || !equal(manifest?.timeline, timeline)) errors.push("candidate manifest timing differs from the cumulative-time schedule");
  if (manifest?.preservesAllCheckpointPhases !== contract.preservesCheckpoint) errors.push("candidate checkpoint-equality claim differs");
  const checkpointSeal = qualityCheckpointFrameHashSeal(qualityCheckpointFrameHashes(theme));
  if (manifest?.checkpointDecodedFrameHashSeal !== checkpointSeal) errors.push("candidate frozen-checkpoint binding differs");
  if ((manifest?.raster ?? null) !== (contract.raster ?? null)) errors.push("candidate raster contract differs");
  const required = [...renderSourcePaths, ...(contract.raster === "coverage" ? ["src/coverage-raster.mjs"] : [])].sort();
  const bindings = manifest?.sourceHashes;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)
    || !equal(Object.keys(bindings).sort(), required)) errors.push("candidate source bindings are missing or unexpected");
  else for (const file of required) {
    if (!/^[a-f0-9]{64}$/u.test(bindings[file]) || bindings[file] !== currentSourceHashes?.[file]) errors.push(`candidate source differs: ${file}`);
  }
  return { ok: errors.length === 0, errors };
}

export function parseAnimatedWebp(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12
    || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("Invalid or incomplete RIFF WebP");
  let width, height, loop;
  const frames = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WebP chunk header");
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + size + (size & 1);
    if (end > bytes.length) throw new Error(`Truncated WebP ${kind} chunk`);
    if (kind === "VP8X") {
      if (size !== 10 || width != null || !(bytes[payload] & 2)) throw new Error("Invalid animated VP8X header");
      width = bytes.readUIntLE(payload + 4, 3) + 1;
      height = bytes.readUIntLE(payload + 7, 3) + 1;
    } else if (kind === "ANIM") {
      if (size !== 6 || loop != null) throw new Error("Invalid ANIM header");
      loop = bytes.readUInt16LE(payload + 4);
    } else if (kind === "ANMF") {
      if (size < 16) throw new Error("Truncated ANMF header");
      frames.push({
        x: bytes.readUIntLE(payload, 3) * 2,
        y: bytes.readUIntLE(payload + 3, 3) * 2,
        width: bytes.readUIntLE(payload + 6, 3) + 1,
        height: bytes.readUIntLE(payload + 9, 3) + 1,
        durationMs: bytes.readUIntLE(payload + 12, 3),
        flags: bytes[payload + 15],
      });
    }
    offset = end;
  }
  if (width == null || height == null || loop == null || !frames.length) throw new Error("Missing animation headers");
  if (frames.some((frame) => frame.durationMs < 1 || frame.x + frame.width > width || frame.y + frame.height > height)) {
    throw new Error("Invalid ANMF duration or frame bounds");
  }
  return { width, height, loop, frameCount: frames.length, delays: frames.map((frame) => frame.durationMs), frames };
}

export function validateTimeline(metadata, frameCount, loopMs) {
  const timeline = animationTimeline(frameCount, loopMs);
  const expectedDelays = timeline.map((frame) => frame.durationMs);
  const errors = [];
  if (metadata.frameCount !== frameCount) errors.push(`frame count ${metadata.frameCount} differs from ${frameCount}`);
  if (!equal(metadata.delays, expectedDelays)) errors.push("encoded delay array differs from the cumulative-time schedule");
  if (metadata.delays.reduce((total, value) => total + value, 0) !== loopMs) errors.push("encoded loop duration differs");
  if (metadata.loop !== 0) errors.push("animation must loop infinitely");
  return { ok: errors.length === 0, expectedDelays, timeline, errors };
}

export function comparePhaseHashes(checkpoint, candidate, { preservesCheckpoint }) {
  if (checkpoint.length !== 30 || candidate.length !== 60) throw new Error("Phase comparison requires 30 checkpoint and 60 candidate hashes");
  if ([...checkpoint, ...candidate].some((value) => !/^[a-f0-9]{64}$/u.test(value))) throw new Error("Invalid decoded frame hash");
  const mismatchedEvenPhases = preservesCheckpoint
    ? checkpoint.flatMap((value, index) => value === candidate[index * 2] ? [] : [{ checkpoint: index, candidate: index * 2 }])
    : [];
  const duplicateIntermediatePhases = candidate.flatMap((value, index) => index % 2 === 1
    && (value === candidate[index - 1] || value === candidate[(index + 1) % candidate.length]) ? [index] : []);
  const uniquePhases = new Set(candidate).size;
  return {
    ok: mismatchedEvenPhases.length === 0 && duplicateIntermediatePhases.length === 0 && uniquePhases === candidate.length,
    checkpointEqualityRequired: preservesCheckpoint,
    comparedEvenPhases: preservesCheckpoint ? checkpoint.length : 0,
    mismatchedEvenPhases, duplicateIntermediatePhases, uniquePhases,
    note: preservesCheckpoint ? "Every old phase must remain byte-identical; intermediate phases must be genuine."
      : "The 1000 ms experiment uses a different phase grid; it does not claim checkpoint phase equality.",
  };
}

export function weightedResidual(previous, current, next, previousDurationMs, nextDurationMs) {
  if (![previous, current, next, previousDurationMs, nextDurationMs].every(Number.isFinite)
    || previousDurationMs <= 0 || nextDurationMs <= 0) throw new RangeError("Finite values and positive time intervals are required");
  const prediction = (previous * nextDurationMs + next * previousDurationMs) / (previousDurationMs + nextDurationMs);
  return current - prediction;
}

export function scalarTemporalMetrics(values, timeline) {
  if (values.length < 3 || values.length !== timeline.length) throw new Error("A cyclic metric needs matching values and timeline");
  let maxStep = 0, maxSpeedPerMs = 0, maxWeightedResidual = 0, maxAccelerationPerMs2 = 0;
  for (let index = 0; index < values.length; index += 1) {
    const previous = (index - 1 + values.length) % values.length;
    const next = (index + 1) % values.length;
    const previousMs = timeline[previous].durationMs;
    const nextMs = timeline[index].durationMs;
    const step = values[next] - values[index];
    maxStep = Math.max(maxStep, Math.abs(step));
    maxSpeedPerMs = Math.max(maxSpeedPerMs, Math.abs(step / nextMs));
    maxWeightedResidual = Math.max(maxWeightedResidual, Math.abs(weightedResidual(values[previous], values[index], values[next], previousMs, nextMs)));
    const acceleration = 2 * ((values[next] - values[index]) / nextMs - (values[index] - values[previous]) / previousMs) / (previousMs + nextMs);
    maxAccelerationPerMs2 = Math.max(maxAccelerationPerMs2, Math.abs(acceleration));
  }
  return { maxStep, maxSpeedPerMs, maxWeightedResidual, maxAccelerationPerMs2 };
}

function effectivePoints(pose) {
  if (pose.fluidTopology) return pose.fluidTopology.flat();
  const from = GROK_EYE_TOPOLOGIES[pose.topology];
  const to = Number.isInteger(pose.topologyTo) ? GROK_EYE_TOPOLOGIES[pose.topologyTo] : null;
  const amount = to ? Math.max(0, Math.min(1, pose.topologyMix ?? 0)) : 0;
  return from.flatMap((eye, eyeIndex) => eye.map(([x, y], point) => to
    ? [x + (to[eyeIndex][point][0] - x) * amount, y + (to[eyeIndex][point][1] - y) * amount] : [x, y]));
}

function pointTemporalMetrics(poses, timeline) {
  const points = poses.map(effectivePoints);
  let maxPointStep = 0, squaredSteps = 0, maxPointSpeedPerMs = 0, maxWeightedPointResidual = 0, maxPointAccelerationPerMs2 = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = (index - 1 + points.length) % points.length;
    const next = (index + 1) % points.length;
    const previousMs = timeline[previous].durationMs;
    const nextMs = timeline[index].durationMs;
    points[index].forEach(([x, y], point) => {
      const before = points[previous][point], after = points[next][point];
      const step = Math.hypot(after[0] - x, after[1] - y);
      const residual = Math.hypot(weightedResidual(before[0], x, after[0], previousMs, nextMs), weightedResidual(before[1], y, after[1], previousMs, nextMs));
      const acceleration = Math.hypot(...[0, 1].map((axis) => 2 * ((after[axis] - points[index][point][axis]) / nextMs - (points[index][point][axis] - before[axis]) / previousMs) / (previousMs + nextMs)));
      maxPointStep = Math.max(maxPointStep, step);
      squaredSteps += step * step;
      maxPointSpeedPerMs = Math.max(maxPointSpeedPerMs, step / nextMs);
      maxWeightedPointResidual = Math.max(maxWeightedPointResidual, residual);
      maxPointAccelerationPerMs2 = Math.max(maxPointAccelerationPerMs2, acceleration);
    });
  }
  return { maxPointStep, rmsPointStep: Math.sqrt(squaredSteps / (points.length * points[0].length)), maxPointSpeedPerMs, maxWeightedPointResidual, maxPointAccelerationPerMs2 };
}

export function compareGeometry(loopMs) {
  const checkpointTimeline = animationTimeline(30, 990);
  const candidateTimeline = animationTimeline(60, loopMs);
  const fields = ["scaleX", "scaleY", "anchorY", "leanX", "leanY", "rotation", "skewX", "gazeX", "gazeY"];
  const sequences = [];
  for (const row of ROWS) {
    const timed = fluidRowPoseAtPhase(row, 0) != null;
    for (const column of timed ? [0] : row.frames.map((_, index) => index)) {
      const sample = (phase) => timed ? fluidRowPoseAtPhase(row, phase) : fluidPoseAtPhase(row.frames[column], row.id, phase);
      const checkpoint = checkpointTimeline.map(({ phase }) => sample(phase));
      const candidate = candidateTimeline.map(({ phase }) => sample(phase));
      const checkpointEyes = pointTemporalMetrics(checkpoint, checkpointTimeline);
      const candidateEyes = pointTemporalMetrics(candidate, candidateTimeline);
      const numericFields = Object.fromEntries(fields.flatMap((field) => {
        if (![...checkpoint, ...candidate].every((pose) => Number.isFinite(pose[field]))) return [];
        const before = scalarTemporalMetrics(checkpoint.map((pose) => pose[field]), checkpointTimeline);
        const after = scalarTemporalMetrics(candidate.map((pose) => pose[field]), candidateTimeline);
        return [[field, { checkpoint: before, candidate: after, maxStepRatio: before.maxStep > 1e-8 ? after.maxStep / before.maxStep : null }]];
      }));
      const stripName = ({ name, ...pose }) => pose;
      sequences.push({
        row: row.index, rowId: row.id, column: timed ? null : column,
        checkpointEyes, candidateEyes,
        maxEyePointStepRatio: checkpointEyes.maxPointStep > 1e-8 ? candidateEyes.maxPointStep / checkpointEyes.maxPointStep : null,
        numericFields,
        evenPosesExact: loopMs === 990 ? checkpoint.every((pose, index) => equal(stripName(pose), stripName(candidate[index * 2]))) : null,
      });
    }
  }
  return {
    units: "authored contour coordinates and per-field body units; rates are normalized by actual encoded milliseconds",
    sampling: "cumulative rounded frame start / loop duration; cyclic curvature uses time-weighted neighbor interpolation",
    checkpointLoopMs: 990, candidateLoopMs: loopMs, sequences,
    evenPoseEqualityRequired: loopMs === 990,
    evenPosesExact: loopMs === 990 ? sequences.every((sequence) => sequence.evenPosesExact) : null,
    hostCellSwitchInterpolation: false,
    limitation: "These metrics describe motion inside one cell. The host still changes gaze/semantic atlas cells instantaneously; a denser embedded timeline cannot interpolate from an unknown prior cell.",
  };
}

class ByteReader {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.buffer = Buffer.alloc(0); this.offset = 0; }
  async read(length, consume = null) {
    const parts = [];
    let remaining = length;
    while (remaining > 0) {
      if (this.offset === this.buffer.length) {
        const next = await this.iterator.next();
        if (next.done) throw new Error(`Truncated decoder output: missing ${remaining} bytes`);
        this.buffer = Buffer.from(next.value); this.offset = 0;
        if (!this.buffer.length) continue;
      }
      const count = Math.min(remaining, this.buffer.length - this.offset);
      const chunk = this.buffer.subarray(this.offset, this.offset + count);
      if (consume) consume(chunk); else parts.push(chunk);
      this.offset += count; remaining -= count;
    }
    return consume ? undefined : Buffer.concat(parts, length);
  }
  async expectEnd() {
    if (this.offset < this.buffer.length) throw new Error("Extra decoder output after expected frames");
    for (;;) { const next = await this.iterator.next(); if (next.done) return; if (next.value.length) throw new Error("Extra decoder output after expected frames"); }
  }
}

export async function hashRgbaFrames(stream, { width, height, frameCount }) {
  if (![width, height, frameCount].every((value) => Number.isInteger(value) && value > 0)) throw new Error("Invalid raw frame dimensions/count");
  const reader = new ByteReader(stream);
  const stack = createHash("sha256"), frameHashes = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const digest = createHash("sha256");
    await reader.read(width * height * 4, (bytes) => { digest.update(bytes); stack.update(bytes); });
    frameHashes.push(digest.digest("hex"));
  }
  await reader.expectEnd();
  return { frameCount, frameHashes, fullStackSha256: stack.digest("hex") };
}

export async function hashCanonicalFrames(stream) {
  const reader = new ByteReader(stream);
  const header = await reader.read(24);
  if (header.toString("ascii", 0, 4) !== "QWP1") throw new Error("Invalid canonical decoder protocol");
  const width = header.readUInt32LE(4), height = header.readUInt32LE(8), frameCount = header.readUInt32LE(12);
  const loop = header.readUInt32LE(16), version = header.readUInt32LE(20);
  if (!width || !height || !frameCount || width * height > 100_000_000 || frameCount > 1000) throw new Error("Unbounded canonical decoder output");
  const stack = createHash("sha256"), frameHashes = [], delays = [];
  let previousEnd = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const end = (await reader.read(4)).readUInt32LE(0);
    if (end <= previousEnd) throw new Error("Canonical decoder timestamps must increase");
    delays.push(end - previousEnd); previousEnd = end;
    const digest = createHash("sha256");
    await reader.read(width * height * 4, (bytes) => { digest.update(bytes); stack.update(bytes); });
    frameHashes.push(digest.digest("hex"));
  }
  await reader.expectEnd();
  return { width, height, frameCount, loop, delays, frameHashes, fullStackSha256: stack.digest("hex"), libwebpVersion: `${version >> 16}.${version >> 8 & 255}.${version & 255}` };
}

async function processOutput(command, args, consume) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (bytes) => { stderr = (stderr + bytes.toString()).slice(-65536); });
  const exit = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let result, failure;
  try { result = await consume(child.stdout); } catch (error) { failure = error; child.kill("SIGTERM"); }
  const status = await exit;
  if (failure) throw failure;
  if (status.error) throw status.error;
  if (status.code !== 0) throw new Error(`${path.basename(command)} failed (${status.code ?? status.signal}): ${stderr.trim()}`);
  return result;
}

const textOutput = (command, args) => processOutput(command, args, async (stream) => {
  const chunks = []; for await (const bytes of stream) chunks.push(bytes);
  return Buffer.concat(chunks).toString("utf8");
});

async function buildDecoder(directory) {
  const source = path.join(directory, "decoder.c"), binary = path.join(directory, "decoder");
  await writeFile(source, DECODER_C);
  const prefixes = [process.env.QUALITY_CANDIDATE_WEBP_PREFIX, "/opt/homebrew", "/usr/local", "/usr"].filter(Boolean);
  let prefix;
  for (const candidate of prefixes) {
    try { await access(path.join(candidate, "include/webp/demux.h")); prefix = candidate; break; } catch { /* Try the next standard development prefix. */ }
  }
  const flags = prefix ? [`-I${path.join(prefix, "include")}`, `-L${path.join(prefix, "lib")}`] : [];
  await textOutput(process.env.CC || "cc", ["-O3", "-Wall", "-Wextra", source, ...flags, "-lwebpdemux", "-lwebp", "-o", binary]);
  return binary;
}

async function inspectAsset(absolutePath, manifest, expected, decoder, benchmarkLoops) {
  const bytes = await readFile(absolutePath);
  const encodedSha256 = hash(bytes);
  if (manifest.sha256 !== encodedSha256 || manifest.bytes !== bytes.length) throw new Error(`${path.basename(absolutePath)} is incomplete or differs from its completed manifest`);
  const metadata = parseAnimatedWebp(bytes);
  const timeline = validateTimeline(metadata, expected.frames, expected.loopMs);
  if (metadata.width !== ATLAS_WIDTH || metadata.height !== ATLAS_HEIGHT || !timeline.ok) throw new Error(`${path.basename(absolutePath)} has an invalid candidate contract: ${timeline.errors.join("; ")}`);
  const canonical = await processOutput(decoder, [absolutePath], hashCanonicalFrames);
  const ffmpeg = await processOutput("ffmpeg", ["-v", "error", "-i", absolutePath, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], (stream) => hashRgbaFrames(stream, metadata));
  const errors = [];
  if (manifest.frames !== metadata.frameCount || !equal(manifest.delays, metadata.delays)
    || manifest.loopMs !== expected.loopMs) errors.push("completed manifest timing differs from encoded headers");
  if (canonical.width !== metadata.width || canonical.height !== metadata.height || canonical.frameCount !== metadata.frameCount || canonical.loop !== metadata.loop) errors.push("canonical decoder metadata differs from RIFF headers");
  if (!equal(canonical.delays, metadata.delays)) errors.push("canonical timestamps differ from ANMF delays");
  if (!equal(canonical.frameHashes, ffmpeg.frameHashes) || canonical.fullStackSha256 !== ffmpeg.fullStackSha256) errors.push("libwebp and ffmpeg coalesced RGBA differ");
  if (!equal(canonical.frameHashes, manifest.decodedFrameHashes)) errors.push("independent decoded frames differ from generation manifest");
  const benchmark = benchmarkLoops === 0 ? null : JSON.parse(await textOutput(decoder, ["--benchmark", absolutePath, String(benchmarkLoops)]));
  if (hash(await readFile(absolutePath)) !== encodedSha256) throw new Error(`${path.basename(absolutePath)} changed during QA`);
  return { path: path.relative(root, absolutePath), encodedSha256, bytes: bytes.length, metadata, timeline, canonical, ffmpeg, benchmark, ok: errors.length === 0, errors };
}

export async function runCandidateQa({ candidateId = "control-60", benchmarkLoops = 5 } = {}) {
  const contract = candidateContracts[candidateId];
  if (!contract) throw new Error("Candidate must be control-60, native-60, or coverage-60");
  if (!Number.isInteger(benchmarkLoops) || benchmarkLoops < 0 || benchmarkLoops > 20) throw new Error("benchmarkLoops must be an integer from 0 through 20");
  const sourcePaths = [...renderSourcePaths, "scripts/quality-candidate-qa.mjs", ...(contract.raster === "coverage" ? ["src/coverage-raster.mjs"] : [])];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (file) => [file, hash(await readFile(path.join(root, file)))])));
  // Manifests are written after encoding completes. Require both before decoding either.
  const manifests = Object.fromEntries(await Promise.all(["dark", "light"].map(async (theme) => [theme, {
    checkpoint: JSON.parse(await readFile(path.join(generatedDirectory, `checkpoint-${theme}.json`), "utf8")),
    candidate: JSON.parse(await readFile(path.join(generatedDirectory, `${candidateId}-${theme}.json`), "utf8")),
  }])));
  const temp = await mkdtemp(path.join(os.tmpdir(), "codex-pet-candidate-qa-"));
  try {
    const decoder = await buildDecoder(temp);
    const ffmpegVersion = (await textOutput("ffmpeg", ["-version"])).split("\n")[0];
    const variants = {}, errors = [];
    for (const theme of ["dark", "light"]) {
      const manifest = manifests[theme];
      const validation = validateCandidateManifest(manifest.candidate, candidateId, theme, sourceHashes);
      if (!validation.ok) throw new Error(`${theme} ${validation.errors.join("; ")}`);
      const checkpointValidation = validateQualityCheckpointManifest(manifest.checkpoint, theme);
      if (!checkpointValidation.ok
        || manifest.candidate.checkpointSha256 !== manifest.checkpoint.sha256
        || manifest.candidate.checkpointDecodedFrameHashSeal !== checkpointValidation.expectedSeal) {
        throw new Error(`${theme} candidate binding does not match the frozen checkpoint`);
      }
      const checkpoint = await inspectAsset(
        path.join(generatedDirectory, `checkpoint-${theme}.webp`),
        manifest.checkpoint,
        QUALITY_CHECKPOINT_CONTRACT,
        decoder,
        benchmarkLoops,
      );
      const candidate = await inspectAsset(path.join(generatedDirectory, `${candidateId}-${theme}.webp`), manifest.candidate, contract, decoder, benchmarkLoops);
      const phaseComparison = comparePhaseHashes(checkpoint.canonical.frameHashes, candidate.canonical.frameHashes, contract);
      variants[theme] = { checkpoint, candidate, phaseComparison, ok: checkpoint.ok && candidate.ok && phaseComparison.ok };
      errors.push(...checkpoint.errors.map((error) => `${theme}/checkpoint: ${error}`), ...candidate.errors.map((error) => `${theme}/candidate: ${error}`));
      if (!phaseComparison.ok) errors.push(`${theme}: candidate phases do not satisfy the comparison contract`);
    }
    const geometry = compareGeometry(contract.loopMs);
    if (contract.preservesCheckpoint && !geometry.evenPosesExact) errors.push("controlled geometry changed a checkpoint pose");
    for (const [file, digest] of Object.entries(sourceHashes)) if (hash(await readFile(path.join(root, file))) !== digest) throw new Error(`QA source changed during the audit: ${file}`);
    return {
      schemaVersion: 1, kind: "independent-quality-candidate-qa", candidateId,
      status: "comparison evidence; generated outside the pet bundles",
      ok: errors.length === 0, errors, contract,
      generatedAt: new Date().toISOString(), sourceHashes,
      decoderMethod: { canonical: "libwebp WebPAnimDecoder MODE_RGBA", secondary: "ffmpeg RGBA rawvideo with frame-rate passthrough", streaming: true, ffmpegVersion, compiler: process.env.CC || "cc" },
      benchmarkHost: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model ?? null, logicalCpuCount: os.cpus().length },
      variants, geometry,
      limits: ["CPU decode timings are local streaming measurements, not Chromium compositor or cache measurements.", "Geometry metrics compare authored motion, not raster edge quality. The coverage-raster experiment needs separate composited pixel and visual review.", "Passing candidate QA does not replace visual review or the complete shipping QA and independent evidence seal."],
    };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

const DECODER_C = String.raw`
#include <webp/demux.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/resource.h>
static double now_ms(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000.0+t.tv_nsec/1e6;}
static double cpu_ms(void){struct rusage r;getrusage(RUSAGE_SELF,&r);return r.ru_utime.tv_sec*1000.0+r.ru_utime.tv_usec/1000.0+r.ru_stime.tv_sec*1000.0+r.ru_stime.tv_usec/1000.0;}
static int cmp(const void*a,const void*b){double x=*(const double*)a,y=*(const double*)b;return(x>y)-(x<y);}
static int u32(uint32_t n){uint8_t b[4]={(uint8_t)n,(uint8_t)(n>>8),(uint8_t)(n>>16),(uint8_t)(n>>24)};return fwrite(b,1,4,stdout)==4;}
int main(int argc,char**argv){
 int bench=argc>1&&!strcmp(argv[1],"--benchmark"),loops=bench&&argc>3?atoi(argv[3]):1;
 if(argc<(bench?4:2)||loops<1||loops>20)return 2;
 const char*name=argv[bench?2:1];FILE*f=fopen(name,"rb");if(!f)return 3;
 if(fseek(f,0,SEEK_END))return 4;long size=ftell(f);rewind(f);if(size<12)return 5;
 uint8_t*bytes=malloc((size_t)size);if(!bytes||fread(bytes,1,(size_t)size,f)!=(size_t)size)return 6;fclose(f);
 WebPData data={bytes,(size_t)size};WebPAnimDecoderOptions options;if(!WebPAnimDecoderOptionsInit(&options))return 7;
 options.color_mode=MODE_RGBA;options.use_threads=0;
 WebPAnimDecoder*dec=WebPAnimDecoderNew(&data,&options);if(!dec)return 8;WebPAnimInfo info;if(!WebPAnimDecoderGetInfo(dec,&info))return 9;
 size_t frame_bytes=(size_t)info.canvas_width*info.canvas_height*4;if(!frame_bytes||info.frame_count>1000)return 10;
 double*times=calloc((size_t)loops*info.frame_count,sizeof(double));if(!times)return 11;
 if(!bench){if(fwrite("QWP1",1,4,stdout)!=4||!u32(info.canvas_width)||!u32(info.canvas_height)||!u32(info.frame_count)||!u32(info.loop_count)||!u32(WebPGetDecoderVersion()))return 12;}
 unsigned total=0;int duration=0;double start=now_ms(),cpu_start=cpu_ms();volatile uint64_t checksum=0;
 for(int loop=0;loop<loops;++loop){unsigned count=0;while(WebPAnimDecoderHasMoreFrames(dec)){uint8_t*rgba;int timestamp;double t=now_ms();if(!WebPAnimDecoderGetNext(dec,&rgba,&timestamp))return 13;times[total]=now_ms()-t;duration=timestamp;
   if(!bench&&(!u32((uint32_t)timestamp)||fwrite(rgba,1,frame_bytes,stdout)!=frame_bytes))return 14;
   checksum+=rgba[(count*104729u)%frame_bytes];++count;++total;
  }if(count!=info.frame_count)return 15;WebPAnimDecoderReset(dec);}
 double wall=now_ms()-start,cpu=cpu_ms()-cpu_start;struct rusage usage;getrusage(RUSAGE_SELF,&usage);
 if(bench){qsort(times,total,sizeof(double),cmp);long long rss=(long long)usage.ru_maxrss;
#if !defined(__APPLE__)
 rss*=1024;
#endif
 printf("{\"loops\":%d,\"framesPerLoop\":%u,\"loopDurationMs\":%d,\"wallMs\":%.4f,\"cpuMs\":%.4f,\"meanFrameMs\":%.6f,\"p50FrameMs\":%.4f,\"p95FrameMs\":%.4f,\"p99FrameMs\":%.4f,\"maximumFrameMs\":%.4f,\"streamingMaxRssBytes\":%lld,\"cpuFractionOfOneCoreAtPlaybackRate\":%.6f,\"checksum\":%llu}\n",loops,info.frame_count,duration,wall,cpu,wall/total,times[(size_t)(total*.5)],times[(size_t)(total*.95)],times[(size_t)(total*.99)],times[total-1],rss,cpu/(loops*duration),(unsigned long long)checksum);
 }WebPAnimDecoderDelete(dec);free(times);free(bytes);return 0;
}`;

async function main() {
  let candidateId = "control-60", benchmarkLoops = 5;
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--candidate") candidateId = process.argv[++index];
    else if (process.argv[index] === "--benchmark-loops") benchmarkLoops = Number(process.argv[++index]);
    else throw new Error("Usage: node scripts/quality-candidate-qa.mjs [--candidate control-60|native-60|coverage-60] [--benchmark-loops 0..20]");
  }
  const report = await runCandidateQa({ candidateId, benchmarkLoops });
  await mkdir(generatedDirectory, { recursive: true });
  const destination = path.join(generatedDirectory, `quality-candidate-qa-${candidateId}.json`);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n");
  await rename(temporary, destination);
  console.log(`${report.ok ? "PASS" : "FAIL"}: ${path.relative(root, destination)}`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Candidate QA: ${error.message}`); process.exitCode = 1; });
}
