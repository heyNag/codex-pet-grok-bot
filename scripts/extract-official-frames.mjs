#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  ROWS,
} from "../src/spec.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qaRoot = path.join(repositoryRoot, "qa");
const timedRows = ROWS.filter((row) => row.index <= 8);
const pixelBytesPerCell = CELL_WIDTH * CELL_HEIGHT * 4;

const variants = Object.freeze({
  dark: Object.freeze({
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-dark", "spritesheet.webp"),
    outputRoot: path.join(qaRoot, "official-frames-dark"),
  }),
  light: Object.freeze({
    atlasPath: path.join(repositoryRoot, "pet", "grok-bot-light", "spritesheet.webp"),
    outputRoot: path.join(qaRoot, "official-frames-light"),
  }),
});

const requested = process.argv.slice(2);
const selectedNames = requested.length === 0 || requested.includes("--all")
  ? Object.keys(variants)
  : requested;

for (const name of selectedNames) {
  if (!Object.hasOwn(variants, name)) {
    throw new Error(`Unknown variant "${name}". Expected dark, light, or --all.`);
  }
}

for (const name of selectedNames) {
  await extractVariant(name, variants[name]);
}

async function extractVariant(name, variant) {
  const atlasBytes = await readFile(variant.atlasPath);
  const decoded = await sharp(atlasBytes, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width !== ATLAS_WIDTH || height !== ATLAS_HEIGHT || channels !== 4) {
    throw new Error(
      `${name} atlas must decode to ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA; `
        + `received ${width}x${height} with ${channels} channels`,
    );
  }

  await rm(variant.outputRoot, { recursive: true, force: true });
  await mkdir(variant.outputRoot, { recursive: true });

  const frames = [];
  for (const row of timedRows) {
    const expectedFrameCount = row.index === 0 ? row.durations.length + 1 : row.durations.length;
    if (row.frames.length !== expectedFrameCount) {
      throw new Error(
        `${row.id} has ${row.frames.length} authored frames, expected ${expectedFrameCount}`,
      );
    }

    // Idle c6 is the separately selected neutral-look cell, not part of the
    // timed six-frame idle preview. The official renderer expects only frames
    // represented by the row's duration table.
    const timedFrameCount = row.durations.length;
    const rowDirectory = path.join(variant.outputRoot, row.id);
    await mkdir(rowDirectory, { recursive: true });
    for (let column = 0; column < timedFrameCount; column += 1) {
      const rgba = extractCell(decoded.data, width, row.index, column);
      const outputPath = path.join(rowDirectory, `${String(column).padStart(2, "0")}.png`);
      await sharp(rgba, {
        raw: { width: CELL_WIDTH, height: CELL_HEIGHT, channels: 4 },
      })
        .png({ compressionLevel: 9, palette: false })
        .toFile(outputPath);

      const pngBytes = await readFile(outputPath);
      const roundTrip = await sharp(pngBytes, { failOn: "error" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        roundTrip.info.width !== CELL_WIDTH
        || roundTrip.info.height !== CELL_HEIGHT
        || roundTrip.info.channels !== 4
        || !roundTrip.data.equals(rgba)
      ) {
        throw new Error(`${path.relative(repositoryRoot, outputPath)} is not pixel-identical to atlas r${row.index}c${column}`);
      }

      frames.push({
        state: row.id,
        row: row.index,
        column,
        durationMs: row.durations[column],
        atlasFrameName: row.frames[column].name,
        path: path.relative(repositoryRoot, outputPath),
        pngSha256: sha256(pngBytes),
        rgbaSha256: sha256(rgba),
      });
    }
  }

  const manifest = {
    schemaVersion: 1,
    kind: "codex-pet-official-preview-frame-extraction",
    variant: name,
    atlas: {
      path: path.relative(repositoryRoot, variant.atlasPath),
      sha256: sha256(atlasBytes),
      decodedRgbaSha256: sha256(decoded.data),
      width,
      height,
      channels,
    },
    cell: { width: CELL_WIDTH, height: CELL_HEIGHT, channels: 4, bytes: pixelBytesPerCell },
    extractionPolicy: {
      timedRows: timedRows.map((row) => row.id),
      idleNeutralLookCellExcluded: { row: 0, column: 6 },
      verification: "every extracted PNG was decoded and compared byte-for-byte with its source atlas cell",
    },
    frames,
  };
  const manifestPath = path.join(variant.outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `${name}: extracted and pixel-verified ${frames.length} timed frames from ${manifest.atlas.sha256}`,
  );
}

function extractCell(atlasPixels, atlasWidth, row, column) {
  const rgba = Buffer.alloc(pixelBytesPerCell);
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    const sourceStart = (((row * CELL_HEIGHT + y) * atlasWidth) + column * CELL_WIDTH) * 4;
    const targetStart = y * CELL_WIDTH * 4;
    atlasPixels.copy(rgba, targetStart, sourceStart, sourceStart + CELL_WIDTH * 4);
  }
  return rgba;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
