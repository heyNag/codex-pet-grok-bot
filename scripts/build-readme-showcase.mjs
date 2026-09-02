#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import {
  FLUID_ATLAS_FRAME_COUNT,
  FLUID_ATLAS_LOOP_MS,
  fluidAtlasDelays,
} from "../src/fluid-atlas.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SHOWCASE_PATH = path.join(repositoryRoot, "preview", "readme-showcase.webp");
export const SHOWCASE_MANIFEST_PATH = path.join(repositoryRoot, "preview", "readme-showcase.json");
export const SHOWCASE_WIDTH = 1200;
export const SHOWCASE_HEIGHT = 480;
export const SHOWCASE_SOURCE_FRAME_COUNT = FLUID_ATLAS_FRAME_COUNT;
export const SHOWCASE_SOURCE_LOOP_MS = FLUID_ATLAS_LOOP_MS;
export const SHOWCASE_SOURCE_DELAYS_MS = Object.freeze(fluidAtlasDelays());

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 11;
const ATLAS_WIDTH = CELL_WIDTH * COLUMNS;
const ATLAS_HEIGHT = CELL_HEIGHT * ROWS;
const PANEL_WIDTH = SHOWCASE_WIDTH / 2;
const ART_WIDTH = CELL_WIDTH * 2;
const ART_HEIGHT = CELL_HEIGHT * 2;
const ART_TOP = Math.round((SHOWCASE_HEIGHT - ART_HEIGHT) / 2);
const DARK_ART_LEFT = Math.round((PANEL_WIDTH - ART_WIDTH) / 2);
const LIGHT_ART_LEFT = PANEL_WIDTH + DARK_ART_LEFT;

const variants = Object.freeze([
  Object.freeze({
    name: "dark",
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-dark", "spritesheet.webp"),
  }),
  Object.freeze({
    name: "light",
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-light", "spritesheet.webp"),
  }),
]);

// Every scene is one complete embedded atlas loop. Timed scenes keep a stable
// semantic cell while their actual shipping WebP pages supply the performance.
// The final scene walks all 16 gaze sectors while retaining the exact 60-phase
// encoded clock used by the installed pet.
export const SHOWCASE_SCENES = Object.freeze([
  Object.freeze({ id: "idle", row: 0, column: 0 }),
  Object.freeze({ id: "wave", row: 3, column: 0 }),
  Object.freeze({ id: "jump", row: 4, column: 0 }),
  Object.freeze({ id: "needs-attention", row: 5, column: 0 }),
  Object.freeze({ id: "complete", row: 8, column: 0 }),
  Object.freeze({ id: "gaze", gazeSweep: true }),
]);

const gazeCellForFrame = (sourceFrame) => {
  const sector = Math.floor((sourceFrame * 16) / SHOWCASE_SOURCE_FRAME_COUNT);
  return {
    row: sector < 8 ? 9 : 10,
    column: sector % 8,
    gazeSector: sector,
  };
};

export const SHOWCASE_SEQUENCE = Object.freeze(SHOWCASE_SCENES.flatMap((scene) => (
  Array.from({ length: SHOWCASE_SOURCE_FRAME_COUNT }, (_, sourceFrame) => Object.freeze({
    scene: scene.id,
    sourceFrame,
    ...(scene.gazeSweep ? gazeCellForFrame(sourceFrame) : {
      row: scene.row,
      column: scene.column,
    }),
    delay: SHOWCASE_SOURCE_DELAYS_MS[sourceFrame],
  }))
)));

const backgroundSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${SHOWCASE_WIDTH}" height="${SHOWCASE_HEIGHT}" viewBox="0 0 ${SHOWCASE_WIDTH} ${SHOWCASE_HEIGHT}">
    <rect width="600" height="480" fill="#0E0E10"/>
    <rect x="600" width="600" height="480" fill="#F5F5F2"/>
    <rect x="598" width="2" height="480" fill="#242428"/>
    <rect x="600" width="2" height="480" fill="#DEDEDA"/>
    <g opacity="0.92">
      <rect y="474" width="200" height="6" fill="#F9705C"/>
      <rect x="200" y="474" width="200" height="6" fill="#5B95F0"/>
      <rect x="400" y="474" width="200" height="6" fill="#3FBE86"/>
      <rect x="600" y="474" width="200" height="6" fill="#F5B13F"/>
      <rect x="800" y="474" width="200" height="6" fill="#9A72EE"/>
      <rect x="1000" y="474" width="200" height="6" fill="#35C3BD"/>
    </g>
  </svg>
`);

export async function generateReadmeShowcase() {
  const atlases = new Map();

  // Decode one atlas at a time. Each decoded animation is large, so retaining
  // only the small, lossless display cells keeps generation bounded.
  for (const variant of variants) {
    const bytes = await readFile(variant.atlasPath);
    const metadata = await sharp(bytes, { animated: true }).metadata();
    validateAtlasMetadata(variant.name, metadata);

    const decoded = await sharp(bytes, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== ATLAS_WIDTH
      || decoded.info.height !== ATLAS_HEIGHT * SHOWCASE_SOURCE_FRAME_COUNT
      || decoded.info.pageHeight !== ATLAS_HEIGHT
      || decoded.info.pages !== SHOWCASE_SOURCE_FRAME_COUNT
      || decoded.info.channels !== 4) {
      throw new Error(`Unexpected ${variant.name} decoded atlas layout`);
    }

    const cells = [];
    for (const pose of SHOWCASE_SEQUENCE) {
      const rawCell = extractCell(decoded.data, pose.sourceFrame, pose.row, pose.column);
      cells.push(await sharp(rawCell, {
        raw: { width: CELL_WIDTH, height: CELL_HEIGHT, channels: 4 },
      })
        // This exact 2x nearest-neighbor presentation preserves the installed
        // raster and its authored alpha edge instead of softening it again.
        .resize(ART_WIDTH, ART_HEIGHT, { fit: "fill", kernel: sharp.kernel.nearest })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer());
    }

    atlases.set(variant.name, {
      bytes,
      cells,
      path: path.relative(repositoryRoot, variant.atlasPath),
      metadata: {
        width: metadata.width,
        height: metadata.pageHeight,
        frames: metadata.pages,
        loop: metadata.loop,
        delays: metadata.delay,
      },
    });
  }

  const frames = [];
  const delays = [];
  for (let index = 0; index < SHOWCASE_SEQUENCE.length; index += 1) {
    frames.push(await sharp({
      create: {
        width: SHOWCASE_WIDTH,
        height: SHOWCASE_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).composite([
      { input: backgroundSvg, left: 0, top: 0 },
      { input: atlases.get("dark").cells[index], left: DARK_ART_LEFT, top: ART_TOP },
      { input: atlases.get("light").cells[index], left: LIGHT_ART_LEFT, top: ART_TOP },
    ]).raw().toBuffer());
    delays.push(SHOWCASE_SEQUENCE[index].delay);
  }

  const image = await sharp(Buffer.concat(frames), {
    raw: {
      width: SHOWCASE_WIDTH,
      height: SHOWCASE_HEIGHT * frames.length,
      pageHeight: SHOWCASE_HEIGHT,
      channels: 4,
    },
  }).webp({
    lossless: true,
    quality: 100,
    alphaQuality: 100,
    delay: delays,
    effort: 6,
    exact: true,
    loop: 0,
  }).toBuffer();

  const sequence = SHOWCASE_SEQUENCE.map((frame) => ({
    scene: frame.scene,
    sourceFrame: frame.sourceFrame,
    row: frame.row,
    column: frame.column,
    ...(Number.isInteger(frame.gazeSector) ? { gazeSector: frame.gazeSector } : {}),
  }));

  return {
    image,
    manifest: {
      schemaVersion: 3,
      inputs: Object.fromEntries(variants.map((variant) => {
        const atlas = atlases.get(variant.name);
        return [variant.name, {
          path: atlas.path,
          sha256: sha256(atlas.bytes),
          ...atlas.metadata,
        }];
      })),
      showcase: {
        sourceFramesPerScene: SHOWCASE_SOURCE_FRAME_COUNT,
        sourceLoopMsPerScene: SHOWCASE_SOURCE_LOOP_MS,
        sourceDelaysMsPerScene: SHOWCASE_SOURCE_DELAYS_MS,
        scenes: SHOWCASE_SCENES.map((scene) => scene.id),
        sequenceSha256: sha256(Buffer.from(JSON.stringify(sequence))),
      },
      output: {
        path: path.relative(repositoryRoot, SHOWCASE_PATH),
        sha256: sha256(image),
        width: SHOWCASE_WIDTH,
        height: SHOWCASE_HEIGHT,
        frames: SHOWCASE_SEQUENCE.length,
        durationMs: delays.reduce((total, delay) => total + delay, 0),
        loop: 0,
        delays,
      },
    },
  };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function validateAtlasMetadata(name, metadata) {
  const expectedDelays = SHOWCASE_SOURCE_DELAYS_MS;
  if (metadata.width !== ATLAS_WIDTH
    || metadata.pageHeight !== ATLAS_HEIGHT
    || metadata.height !== ATLAS_HEIGHT * SHOWCASE_SOURCE_FRAME_COUNT
    || metadata.pages !== SHOWCASE_SOURCE_FRAME_COUNT
    || metadata.loop !== 0
    || JSON.stringify(metadata.delay) !== JSON.stringify(expectedDelays)) {
    throw new Error(`${name} atlas must be a ${SHOWCASE_SOURCE_FRAME_COUNT}-phase, ${SHOWCASE_SOURCE_LOOP_MS} ms, infinite-loop animation with the exact cumulative delay schedule`);
  }
}

function extractCell(atlas, sourceFrame, row, column) {
  if (!Number.isInteger(sourceFrame) || sourceFrame < 0 || sourceFrame >= SHOWCASE_SOURCE_FRAME_COUNT) {
    throw new RangeError(`Showcase source frame is out of range: ${sourceFrame}`);
  }
  if (!Number.isInteger(row) || row < 0 || row >= ROWS
    || !Number.isInteger(column) || column < 0 || column >= COLUMNS) {
    throw new RangeError(`Showcase atlas cell is out of range: ${row}:${column}`);
  }

  const cell = Buffer.alloc(CELL_WIDTH * CELL_HEIGHT * 4);
  const pageOffset = sourceFrame * ATLAS_WIDTH * ATLAS_HEIGHT * 4;
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const sourceStart = pageOffset
      + ((row * CELL_HEIGHT + y) * ATLAS_WIDTH + column * CELL_WIDTH) * 4;
    const sourceEnd = sourceStart + CELL_WIDTH * 4;
    atlas.copy(cell, y * CELL_WIDTH * 4, sourceStart, sourceEnd);
  }
  return cell;
}

async function main() {
  const generated = await generateReadmeShowcase();
  if (process.argv.includes("--check")) {
    const [committedImage, committedManifest] = await Promise.all([
      readFile(SHOWCASE_PATH),
      readFile(SHOWCASE_MANIFEST_PATH, "utf8"),
    ]);
    if (!generated.image.equals(committedImage)
      || `${JSON.stringify(generated.manifest, null, 2)}\n` !== committedManifest) {
      throw new Error("preview/readme-showcase.webp is stale; regenerate it with node scripts/build-readme-showcase.mjs");
    }
    console.log("README showcase is current");
    return;
  }
  await Promise.all([
    writeFile(SHOWCASE_PATH, generated.image),
    writeFile(SHOWCASE_MANIFEST_PATH, `${JSON.stringify(generated.manifest, null, 2)}\n`, "utf8"),
  ]);
  console.log(`Built ${path.relative(repositoryRoot, SHOWCASE_PATH)} (${generated.image.length} bytes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
