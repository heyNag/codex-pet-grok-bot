#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFrameSvg } from "../src/grok-art.mjs";
import { ACTIVATION_SPRING, advanceActivationSpring } from "../src/grok-motion.mjs";
import {
  SOURCE_MOTION_ACTIVE_SECONDS,
  SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
  SOURCE_MOTION_FRAME_HEIGHT,
  SOURCE_MOTION_FRAME_RATE,
  SOURCE_MOTION_FRAME_WIDTH,
  SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
  SOURCE_MOTION_RASTER_DENSITY,
  SOURCE_MOTION_RASTER_SCALE,
  SOURCE_MOTION_RELEASE_SECONDS,
  maximumTimelineHoldOverlapMs,
  sourceMotionFrameDelaysMs,
} from "../src/source-motion-timing.mjs";
import { SOURCE_EFFECT_TRANSITIONS } from "../src/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "preview", "source-lab", "motion");
const frameRate = SOURCE_MOTION_FRAME_RATE;
const frameStepSeconds = 1 / frameRate;
const activeSeconds = SOURCE_MOTION_ACTIVE_SECONDS;
const releaseSeconds = SOURCE_MOTION_RELEASE_SECONDS;
const totalFrames = Math.round((activeSeconds + releaseSeconds) * frameRate);
const frameDelaysMs = Object.freeze(sourceMotionFrameDelaysMs());
const presentationDurationMs = frameDelaysMs.reduce((total, delay) => total + delay, 0);
const inputPaths = Object.freeze([
  ".node-version",
  "src/grok-art.mjs",
  "src/grok-body-registry.mjs",
  "src/grok-eye-topologies.mjs",
  "src/grok-motion.mjs",
  "src/source-motion-timing.mjs",
  "src/spec.mjs",
  "scripts/build-source-motion.mjs",
  "package.json",
  "package-lock.json",
]);
const requiredEncoder = Object.freeze({
  node: "v26.8.1",
  sharp: "0.35.4",
  libvips: "8.18.6",
  webp: "1.6.0",
  rsvg: "2.62.91",
  cairo: "1.18.4",
  pixman: "0.46.4",
});
const currentEncoder = Object.freeze({
  node: process.version,
  sharp: sharp.versions.sharp,
  libvips: sharp.versions.vips,
  webp: sharp.versions.webp,
  rsvg: sharp.versions.rsvg,
  cairo: sharp.versions.cairo,
  pixman: sharp.versions.pixman,
});
const assetRecords = [];

const themes = Object.freeze([
  ["dark", "dark-codex"],
  ["light", "light-codex"],
]);

const encoderMismatches = Object.keys(requiredEncoder).filter(
  (key) => currentEncoder[key] !== requiredEncoder[key],
);
if (encoderMismatches.length > 0) {
  throw new Error(
    "Refusing to rewrite review-sensitive source-motion evidence with an unreviewed encoder. "
      + `Required ${JSON.stringify(requiredEncoder)}; received ${JSON.stringify(currentEncoder)}.`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const [suffix, theme] of themes) {
  const themeRoot = path.join(outputRoot, suffix);
  await mkdir(themeRoot, { recursive: true });
  for (const transition of SOURCE_EFFECT_TRANSITIONS) {
    const base = transition.frames[0];
    const spring = { position: 0, velocity: 0 };
    const rendered = [];

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const elapsedSeconds = frameIndex * frameStepSeconds;
      const target = elapsedSeconds < activeSeconds ? 1 : 0;
      const pose = {
        ...base,
        name: `${transition.effect}-spring-${String(frameIndex).padStart(3, "0")}`,
        sourceEffectActivation: spring.position,
        sourceSampleTimeMs: elapsedSeconds * 1000,
        sourceMotionTimeMs: elapsedSeconds * 1000,
        effectPhase: (elapsedSeconds * 1000 / 233) % 5,
      };
      const svg = Buffer.from(renderFrameSvg(pose, {
        title: `Grok Bot ${transition.effect} spring motion`,
        theme,
      }));
      rendered.push(await sharp(svg, { density: SOURCE_MOTION_RASTER_DENSITY })
        .resize(SOURCE_MOTION_FRAME_WIDTH, SOURCE_MOTION_FRAME_HEIGHT, { fit: "fill" })
        .ensureAlpha()
        .png({ compressionLevel: 9, palette: false })
        .toBuffer());
      advanceActivationSpring(spring, target, frameStepSeconds);
    }

    const pages = sharp({
      create: {
        width: SOURCE_MOTION_FRAME_WIDTH,
        height: SOURCE_MOTION_FRAME_HEIGHT * rendered.length,
        pageHeight: SOURCE_MOTION_FRAME_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(rendered.map((input, index) => ({
      input,
      left: 0,
      top: index * SOURCE_MOTION_FRAME_HEIGHT,
    })));

    const outputPath = path.join(themeRoot, `${transition.effect}.webp`);
    await pages.webp({
      lossless: true,
      quality: 100,
      alphaQuality: 100,
      delay: frameDelaysMs,
      effort: 5,
      exact: true,
      loop: 0,
    }).toFile(outputPath);
    const bytes = await readFile(outputPath);
    const metadata = await sharp(bytes, { animated: true }).metadata();
    const maximumActiveHoldMs = maximumTimelineHoldOverlapMs(
      metadata.delay,
      0,
      activeSeconds * 1000,
    );
    if (maximumActiveHoldMs > SOURCE_MOTION_MAX_ACTIVE_HOLD_MS) {
      throw new Error(
        `${suffix}/${transition.effect}.webp contains a ${maximumActiveHoldMs}ms active hold; `
          + `the maximum is ${SOURCE_MOTION_MAX_ACTIVE_HOLD_MS}ms`,
      );
    }
    assetRecords.push(Object.freeze({
      theme: suffix,
      state: transition.state,
      effect: transition.effect,
      path: path.relative(root, outputPath),
      sha256: sha256(bytes),
      pages: metadata.pages,
      pageHeight: metadata.pageHeight,
      loop: metadata.loop,
      durationMs: metadata.delay.reduce((total, delay) => total + delay, 0),
      maximumActiveHoldMs,
    }));
    process.stdout.write(`Built ${suffix}/${transition.effect}.webp (${rendered.length} exact-spring samples)\n`);
  }
}

const inputs = Object.fromEntries(await Promise.all(inputPaths.map(async (relative) => [
  relative,
  sha256(await readFile(path.join(root, relative))),
])));
const manifest = {
  schemaVersion: 1,
  kind: "grok-bot-motion-studies",
  frameRate,
  activeSeconds,
  releaseSeconds,
  nominalFrameCount: totalFrames,
  presentationDurationMs,
  maximumAllowedActiveHoldMs: SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
  rasterScale: SOURCE_MOTION_RASTER_SCALE,
  frameWidth: SOURCE_MOTION_FRAME_WIDTH,
  frameHeight: SOURCE_MOTION_FRAME_HEIGHT,
  displayWidthCssPx: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
  encoder: currentEncoder,
  spring: ACTIVATION_SPRING,
  inputs,
  assets: assetRecords,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
