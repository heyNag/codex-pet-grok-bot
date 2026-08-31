#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SHOWCASE_PATH = path.join(repositoryRoot, "preview", "readme-showcase.webp");
export const SHOWCASE_MANIFEST_PATH = path.join(repositoryRoot, "preview", "readme-showcase.json");
export const SHOWCASE_WIDTH = 1200;
export const SHOWCASE_HEIGHT = 480;

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ATLAS_WIDTH = 1536;
const PANEL_WIDTH = SHOWCASE_WIDTH / 2;
const ART_WIDTH = CELL_WIDTH * 2;
const ART_HEIGHT = CELL_HEIGHT * 2;
const ART_TOP = Math.round((SHOWCASE_HEIGHT - ART_HEIGHT) / 2);
const DARK_ART_LEFT = Math.round((PANEL_WIDTH - ART_WIDTH) / 2);
const LIGHT_ART_LEFT = PANEL_WIDTH + DARK_ART_LEFT;

const variants = Object.freeze([
  {
    name: "dark",
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-dark", "spritesheet.webp"),
  },
  {
    name: "light",
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-light", "spritesheet.webp"),
  },
]);

const series = (row, columns, delays) => columns.map((column, index) => ({
  row,
  column,
  delay: delays[index],
}));

export const SHOWCASE_SEQUENCE = Object.freeze([
  ...series(0, [0, 1, 2, 3, 4, 5], [900, 180, 180, 240, 240, 800]),
  ...series(3, [0, 1, 2, 3], [350, 220, 220, 650]),
  ...series(7, [0, 1, 2, 3, 4, 5], [240, 240, 240, 240, 240, 650]),
  ...series(6, [0, 1, 2, 3, 4, 5], [300, 300, 300, 300, 300, 700]),
  ...series(8, [0, 1, 2, 3, 4, 5], [300, 300, 300, 300, 300, 900]),
  ...series(9, [0, 1, 2, 3, 4, 5, 6, 7], Array(8).fill(160)),
  ...series(10, [0, 1, 2, 3, 4, 5, 6, 7], Array(8).fill(160)),
  { row: 0, column: 0, delay: 1000 },
]);

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
  const atlasEntries = await Promise.all(variants.map(async (variant) => {
    const bytes = await readFile(variant.atlasPath);
    const decoded = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== ATLAS_WIDTH || decoded.info.channels !== 4) {
      throw new Error(`Unexpected ${variant.name} atlas metadata`);
    }
    return [variant.name, {
      bytes,
      pixels: decoded.data,
      path: path.relative(repositoryRoot, variant.atlasPath),
    }];
  }));
  const atlases = new Map(atlasEntries);

  const resizedCells = new Map();
  const frames = [];
  const delays = [];

  for (const pose of SHOWCASE_SEQUENCE) {
    const composites = [{ input: backgroundSvg, left: 0, top: 0 }];
    for (const variant of variants) {
      const key = `${variant.name}:${pose.row}:${pose.column}`;
      let cell = resizedCells.get(key);
      if (!cell) {
        const rawCell = extractCell(atlases.get(variant.name).pixels, pose.row, pose.column);
        cell = await sharp(rawCell, {
          raw: { width: CELL_WIDTH, height: CELL_HEIGHT, channels: 4 },
        })
          .resize(ART_WIDTH, ART_HEIGHT, { fit: "fill", kernel: sharp.kernel.lanczos3 })
          .png({ compressionLevel: 9, palette: false })
          .toBuffer();
        resizedCells.set(key, cell);
      }
      composites.push({
        input: cell,
        left: variant.name === "dark" ? DARK_ART_LEFT : LIGHT_ART_LEFT,
        top: ART_TOP,
      });
    }

    frames.push(await sharp({
      create: {
        width: SHOWCASE_WIDTH,
        height: SHOWCASE_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).composite(composites).raw().toBuffer());
    delays.push(pose.delay);
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
    effort: 3,
    exact: true,
    loop: 0,
  }).toBuffer();

  return {
    image,
    manifest: {
      schemaVersion: 1,
      inputs: Object.fromEntries(variants.map((variant) => {
        const atlas = atlases.get(variant.name);
        return [variant.name, { path: atlas.path, sha256: sha256(atlas.bytes) }];
      })),
      output: {
        path: path.relative(repositoryRoot, SHOWCASE_PATH),
        sha256: sha256(image),
        width: SHOWCASE_WIDTH,
        height: SHOWCASE_HEIGHT,
        frames: SHOWCASE_SEQUENCE.length,
        loop: 0,
        delays: SHOWCASE_SEQUENCE.map((frame) => frame.delay),
      },
    },
  };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function extractCell(atlas, row, column) {
  const cell = Buffer.alloc(CELL_WIDTH * CELL_HEIGHT * 4);
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const sourceStart = ((row * CELL_HEIGHT + y) * ATLAS_WIDTH + column * CELL_WIDTH) * 4;
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
