#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { fluidPoseAtPhase, fluidRowPoseAtPhase } from "../src/fluid-atlas.mjs";
import { renderFrameSvg } from "../src/grok-art.mjs";
import { renderSpritePixels } from "../src/sprite-raster.mjs";
import { ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT, CELL_WIDTH, ROWS } from "../src/spec.mjs";
import {
  QUALITY_CHECKPOINT_CONTRACT,
  qualityCheckpointFrameHashSeal,
  qualityCheckpointFrameHashes,
  qualityCheckpointTimeline,
} from "./quality-checkpoint.mjs";
import { qualitySourceHashes, writeQualityCatalog } from "./quality-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "preview/quality-lab/generated");
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--control", "--exact-60hz", "--coverage", "--catalog-only"].includes(arg))) {
  throw new Error("Usage: node scripts/build-quality-lab.mjs [--control] [--exact-60hz] [--coverage] [--catalog-only]");
}
if (args.has("--catalog-only")) {
  if (args.size !== 1) throw new Error("--catalog-only cannot be combined with rendering options");
  console.log(await writeQualityCatalog(root, output));
  process.exit(0);
}
const variants = [
  ...(args.size === 0 || args.has("--control") ? [{ id: "control-60", label: "60 phases · same 990 ms loop", frames: 60, loopMs: 990 }] : []),
  ...(args.size === 0 || args.has("--exact-60hz") ? [{ id: "native-60", label: "60 fps · exact 1 second loop", frames: 60, loopMs: 1000 }] : []),
  ...(args.has("--coverage") ? [{ id: "coverage-60", label: "60 fps · area-coverage raster", frames: 60, loopMs: 1000, raster: "coverage" }] : []),
];
const sourceHashes = await qualitySourceHashes(root);
const coverageRaster = args.has("--coverage") ? (await import("../src/coverage-raster.mjs")).renderCoverageSpritePixels : null;
const coverageSourceHashes = coverageRaster ? await qualitySourceHashes(root, ["src/coverage-raster.mjs"]) : null;
await mkdir(output, { recursive: true });
sharp.cache({ memory: 96, files: 20, items: 80 });
sharp.concurrency(2);

for (const theme of ["dark", "light"]) {
  const checkpointTimeline = qualityCheckpointTimeline();
  const expectedCheckpointFrames = qualityCheckpointFrameHashes(theme);
  const checkpointPages = [];
  const checkpointFrames = [];
  const checkpointDirectory = path.join(output, `checkpoint-${theme}`);
  await mkdir(checkpointDirectory, { recursive: true });
  for (const frame of checkpointTimeline) {
    const page = await renderAtlasPage(theme, frame.phase, { raster: "legacy" });
    const pixels = await sharp(page).ensureAlpha().raw().toBuffer();
    const frameHash = hash(pixels);
    if (frameHash !== expectedCheckpointFrames[frame.index]) {
      throw new Error(`Frozen checkpoint frame changed: ${theme}/${frame.index}`);
    }
    checkpointFrames.push(frameHash);
    checkpointPages.push(page);
    await sharp(pixels, { raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 } })
      .webp({ lossless: true, exact: true, effort: 4 }).toFile(path.join(checkpointDirectory, `${frame.index}.webp`));
  }
  const checkpointPath = path.join(output, `checkpoint-${theme}.webp`);
  await sharp(checkpointPages, { join: { animated: true } }).webp({
    alphaQuality: 100,
    delay: checkpointTimeline.map(({ durationMs }) => durationMs),
    effort: 4,
    exact: true,
    loop: 0,
    lossless: true,
    minSize: true,
    quality: 100,
  }).toFile(checkpointPath);
  const checkpoint = await readFile(checkpointPath);
  const checkpointMeta = await sharp(checkpoint, { animated: true }).metadata();
  if (checkpointMeta.width !== ATLAS_WIDTH || checkpointMeta.pageHeight !== ATLAS_HEIGHT
    || checkpointMeta.pages !== QUALITY_CHECKPOINT_CONTRACT.frames || checkpointMeta.loop !== 0
    || checkpointMeta.delay?.length !== checkpointTimeline.length
    || checkpointMeta.delay.some((delay, index) => delay !== checkpointTimeline[index].durationMs)) {
    throw new Error(`Encoder changed the frozen checkpoint timeline: ${theme}`);
  }
  for (const frame of checkpointTimeline) {
    const decoded = await sharp(checkpoint, { page: frame.index, pages: 1 }).ensureAlpha().raw().toBuffer();
    if (hash(decoded) !== checkpointFrames[frame.index]) {
      throw new Error(`Encoded checkpoint frame differs from inspection page: ${theme}/${frame.index}`);
    }
  }
  const checkpointFrameHashSeal = qualityCheckpointFrameHashSeal(checkpointFrames);
  await writeFile(path.join(output, `checkpoint-${theme}.json`), JSON.stringify({
    ...QUALITY_CHECKPOINT_CONTRACT,
    theme,
    delays: checkpointMeta.delay,
    timeline: checkpointTimeline,
    bytes: checkpoint.length, sha256: hash(checkpoint),
    decodedFrameHashes: checkpointFrames,
    decodedFrameHashSeal: checkpointFrameHashSeal,
    sourceHashes,
    encoding: { lossless: true, effort: 4, compositedFramesMatchInspectionPages: true },
    status: "frozen comparison reference; generated outside the pet bundles",
  }, null, 2) + "\n");

  for (const variant of variants) {
    const started = performance.now();
    const timeline = animationTimeline(variant.frames, variant.loopMs);
    const pages = [];
    const decodedFrameHashes = [];
    const frameDirectory = path.join(output, `${variant.id}-${theme}`);
    await mkdir(frameDirectory, { recursive: true });
    for (const frame of timeline) {
      const page = await renderAtlasPage(theme, frame.phase, variant);
      const pixels = await sharp(page).raw().toBuffer();
      decodedFrameHashes.push(hash(pixels));
      if (variant.loopMs === 990 && frame.index % 2 === 0 && decodedFrameHashes.at(-1) !== checkpointFrames[frame.index / 2]) {
        throw new Error(`Controlled comparison changed checkpoint phase ${frame.index / 2} for ${theme}`);
      }
      await sharp(page).webp({ lossless: true, exact: true, effort: 4 }).toFile(path.join(frameDirectory, `${frame.index}.webp`));
      pages.push(page);
      if ((frame.index + 1) % 10 === 0) console.log(`${variant.id}/${theme}: ${frame.index + 1}/${timeline.length}`);
    }
    const destination = path.join(output, `${variant.id}-${theme}.webp`);
    await sharp(pages, { join: { animated: true } }).webp({
      // Compression effort affects build time and file size, not lossless pixels.
      alphaQuality: 100, delay: timeline.map(({ durationMs }) => durationMs), effort: 4,
      exact: true, loop: 0, lossless: true, minSize: true, quality: 100,
    }).toFile(destination);
    const encoded = await readFile(destination);
    const metadata = await sharp(encoded, { animated: true }).metadata();
    if (metadata.width !== ATLAS_WIDTH || metadata.pageHeight !== ATLAS_HEIGHT
      || metadata.pages !== variant.frames || metadata.loop !== 0
      || metadata.delay?.length !== timeline.length
      || metadata.delay.some((delay, i) => delay !== timeline[i].durationMs)) {
      throw new Error(`Encoder changed the requested timeline: ${variant.id}/${theme}`);
    }
    for (const frame of timeline) {
      const decoded = await sharp(encoded, { page: frame.index, pages: 1 }).ensureAlpha().raw().toBuffer();
      if (hash(decoded) !== decodedFrameHashes[frame.index]) {
        throw new Error(`Encoded frame differs from inspection page: ${variant.id}/${theme}/${frame.index}`);
      }
    }
    await writeFile(path.join(output, `${variant.id}-${theme}.json`), JSON.stringify({
      ...variant, theme, delays: metadata.delay, timeline, bytes: (await stat(destination)).size,
      sha256: hash(encoded), decodedFrameHashes,
      sourceHashes: variant.raster === "coverage" ? coverageSourceHashes : sourceHashes,
      checkpointSha256: hash(checkpoint), checkpointDecodedFrameHashSeal: checkpointFrameHashSeal,
      preservesAllCheckpointPhases: variant.loopMs === 990,
      generationMs: Math.round(performance.now() - started),
      encoding: { lossless: true, effort: 4, compositedFramesMatchInspectionPages: true },
      status: "comparison artifact; generated outside the pet bundles",
    }, null, 2) + "\n");
    console.log(`Built ${variant.id}/${theme}: ${encoded.length} bytes, ${Math.round(performance.now() - started)} ms`);
  }
}
console.log(await writeQualityCatalog(root, output));
console.log("Quality comparison candidates are ready under preview/quality-lab/generated/.");

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function renderAtlasPage(theme, phase, variant) {
  const composites = [];
  for (const row of ROWS) {
    const rowPose = fluidRowPoseAtPhase(row, phase);
    if (rowPose) {
      const pixels = await raster(rowPose, theme, variant);
      row.frames.forEach((_, column) => composites.push({ input: pixels, left: column * CELL_WIDTH, top: row.index * CELL_HEIGHT }));
    } else {
      for (const [column, pose] of row.frames.entries()) {
        composites.push({ input: await raster(fluidPoseAtPhase(pose, row.id, phase), theme, variant), left: column * CELL_WIDTH, top: row.index * CELL_HEIGHT });
      }
    }
  }
  return sharp({ create: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png({ compressionLevel: 6, palette: false }).toBuffer();
}
function raster(pose, theme, variant) {
  const renderer = variant.raster === "coverage" ? coverageRaster : renderSpritePixels;
  return renderer(Buffer.from(renderFrameSvg(pose, { theme: `${theme}-codex`, title: "Grok Bot quality study" })));
}
