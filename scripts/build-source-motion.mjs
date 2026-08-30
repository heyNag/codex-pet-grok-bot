#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFrameSvg } from "../src/grok-art.mjs";
import { ACTIVATION_SPRING, advanceActivationSpring } from "../src/grok-motion.mjs";
import { CELL_HEIGHT, CELL_WIDTH, SOURCE_EFFECT_TRANSITIONS } from "../src/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "preview", "source-lab", "motion");
const frameRate = 60;
const frameStepSeconds = 1 / frameRate;
const activeSeconds = 1.8;
const releaseSeconds = 0.8;
const totalFrames = Math.round((activeSeconds + releaseSeconds) * frameRate);
const frameDelaysMs = Object.freeze(Array.from({ length: totalFrames }, (_, frameIndex) => (
  Math.round((frameIndex + 1) * 1000 / frameRate) - Math.round(frameIndex * 1000 / frameRate)
)));
const presentationDurationMs = frameDelaysMs.reduce((total, delay) => total + delay, 0);
const inputPaths = Object.freeze([
  ".node-version",
  "src/grok-art.mjs",
  "src/grok-body-registry.mjs",
  "src/grok-eye-topologies.mjs",
  "src/grok-motion.mjs",
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
});
const currentEncoder = Object.freeze({
  node: process.version,
  sharp: sharp.versions.sharp,
  libvips: sharp.versions.vips,
  webp: sharp.versions.webp,
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
        effectPhase: Math.floor(elapsedSeconds * 1000 / 233) % 5,
      };
      const svg = Buffer.from(renderFrameSvg(pose, {
        title: `Grok Bot ${transition.effect} spring motion`,
        theme,
      }));
      rendered.push(await sharp(svg, { density: 144 })
        .resize(CELL_WIDTH, CELL_HEIGHT, { fit: "fill" })
        .ensureAlpha()
        .png({ compressionLevel: 9, palette: false })
        .toBuffer());
      advanceActivationSpring(spring, target, frameStepSeconds);
    }

    const pages = sharp({
      create: {
        width: CELL_WIDTH,
        height: CELL_HEIGHT * rendered.length,
        pageHeight: CELL_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(rendered.map((input, index) => ({
      input,
      left: 0,
      top: index * CELL_HEIGHT,
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
  encoder: currentEncoder,
  spring: ACTIVATION_SPRING,
  inputs,
  assets: assetRecords,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
