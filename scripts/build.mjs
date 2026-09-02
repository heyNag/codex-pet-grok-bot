#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { renderFrameSvg } from "../src/grok-art.mjs";
import { renderCoverageSpritePixels } from "../src/coverage-raster.mjs";
import {
  FLUID_ATLAS_FRAME_COUNT,
  fluidAtlasDelays,
  fluidPoseAt,
  fluidRowPoseAt,
} from "../src/fluid-atlas.mjs";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  COLUMNS,
  POPULATED_FRAME_COUNT,
  ROWS,
  ROW_COUNT,
  SOURCE_EFFECT_TRANSITIONS,
  SOURCE_STATE_LIBRARY,
} from "../src/spec.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewRoot = path.join(repositoryRoot, "preview");
const rowPreviewRoot = path.join(previewRoot, "rows");
const frameDebugRoot = path.join(previewRoot, "frames");
const sourceLabRoot = path.join(previewRoot, "source-lab");
const buildPreviews = !process.argv.includes("--sprites-only");
const requestedVariant = process.argv.find((argument) => argument.startsWith("--variant="))?.split("=")[1];
const builds = [
  {
    theme: "dark-codex",
    outputPath: path.join(repositoryRoot, "pet", "grok-bot-dark", "spritesheet.webp"),
    authoringPath: path.join(repositoryRoot, "qa", "authoring-atlas-dark.webp"),
    contactPath: path.join(previewRoot, "contact-sheet.png"),
    buildRows: true,
  },
  {
    theme: "light-codex",
    outputPath: path.join(repositoryRoot, "pet", "grok-bot-light", "spritesheet.webp"),
    authoringPath: path.join(repositoryRoot, "qa", "authoring-atlas-light.webp"),
    contactPath: path.join(previewRoot, "contact-sheet-light.png"),
    buildRows: false,
  },
];
const selectedBuilds = requestedVariant == null
  ? builds
  : builds.filter((build) => build.outputPath.includes(`grok-bot-${requestedVariant}`));
if (selectedBuilds.length === 0) throw new Error(`Unknown build variant: ${requestedVariant}`);

if (buildPreviews) {
  await rm(rowPreviewRoot, { force: true, recursive: true });
  await mkdir(rowPreviewRoot, { recursive: true });
  await rm(frameDebugRoot, { force: true, recursive: true });
  await mkdir(sourceLabRoot, { recursive: true });
  await Promise.all([
    "state-atlas-dark.webp",
    "state-atlas-light.webp",
    "state-contact-dark.png",
    "state-contact-light.png",
    "effect-transitions-dark.webp",
    "effect-transitions-light.webp",
    "effect-transitions-dark.png",
    "effect-transitions-light.png",
  ].map((file) => rm(path.join(sourceLabRoot, file), { force: true })));
}

for (const build of selectedBuilds) {
  await mkdir(path.dirname(build.outputPath), { recursive: true });
  const renderedRows = [];
  const composites = [];
  for (const row of ROWS) {
    const frames = [];
    for (let column = 0; column < row.frames.length; column += 1) {
      const frame = row.frames[column];
      const svg = Buffer.from(renderFrameSvg(frame, {
        title: `${row.label}: ${frame.name}`,
        theme: build.theme,
      }));
      const pixels = await renderCoverageSpritePixels(svg);
      frames.push(pixels);
      composites.push({ input: pixels, left: column * CELL_WIDTH, top: row.index * CELL_HEIGHT });
    }
    renderedRows.push({ ...row, renderedFrames: frames });
  }

  const atlas = sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites);

  const atlasPng = await atlas.clone().png({ compressionLevel: 9, palette: false }).toBuffer();
  await sharp(atlasPng)
    .webp({ alphaQuality: 100, effort: 6, lossless: true, quality: 100 })
    .toFile(build.authoringPath);

  const animatedPages = [];
  for (let animationFrame = 0; animationFrame < FLUID_ATLAS_FRAME_COUNT; animationFrame += 1) {
    animatedPages.push(await renderFluidAtlasPage(build.theme, animationFrame));
  }
  await sharp(animatedPages, { join: { animated: true } })
    .webp({
      alphaQuality: 100,
      delay: fluidAtlasDelays(),
      // libwebp produces the same lossless bytes as effort 6 for this atlas,
      // while effort 5 avoids several minutes of redundant search per theme.
      effort: 5,
      exact: true,
      loop: 0,
      lossless: true,
      minSize: true,
      quality: 100,
    })
    .toFile(build.outputPath);

  if (buildPreviews) await buildContactSheet(atlasPng, build);
  if (buildPreviews) await buildSourceLab(build.theme, build.theme === "dark-codex" ? "dark" : "light");
  if (buildPreviews && build.buildRows) {
    for (const row of renderedRows) await buildRowPreview(row);
  }

  const metadata = await sharp(build.outputPath).metadata();
  if (
    metadata.width !== ATLAS_WIDTH
    || metadata.height !== ATLAS_HEIGHT
    || metadata.channels !== 4
    || metadata.pages !== FLUID_ATLAS_FRAME_COUNT
  ) {
    throw new Error(`Unexpected atlas metadata: ${JSON.stringify(metadata)}`);
  }

  console.log(`Built ${path.relative(repositoryRoot, build.outputPath)} (${metadata.width}×${metadata.height}, ${populatedLabel()}, ${build.theme})`);
}

async function renderFluidAtlasPage(theme, animationFrame) {
  const composites = [];
  for (const row of ROWS) {
    const rowPose = fluidRowPoseAt(row, animationFrame);
    if (rowPose) {
      const pixels = await renderPose(rowPose, theme, `${row.label}: fluid ${animationFrame}`);
      for (let column = 0; column < row.frames.length; column += 1) {
        composites.push({ input: pixels, left: column * CELL_WIDTH, top: row.index * CELL_HEIGHT });
      }
      continue;
    }

    for (let column = 0; column < row.frames.length; column += 1) {
      const pose = fluidPoseAt(row.frames[column], row.id, animationFrame);
      const pixels = await renderPose(pose, theme, `${row.label}: ${row.frames[column].name} fluid ${animationFrame}`);
      composites.push({ input: pixels, left: column * CELL_WIDTH, top: row.index * CELL_HEIGHT });
    }
  }

  return sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 6, palette: false }).toBuffer();
}

async function renderPose(pose, theme, title) {
  const svg = Buffer.from(renderFrameSvg(pose, { title, theme }));
  return renderCoverageSpritePixels(svg);
}

async function composeAtlas(frames, columns, rows) {
  const composites = frames.map((input, index) => ({
    input,
    left: index % columns * CELL_WIDTH,
    top: Math.floor(index / columns) * CELL_HEIGHT,
  }));
  return sharp({
    create: {
      width: columns * CELL_WIDTH,
      height: rows * CELL_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9, palette: false }).toBuffer();
}

async function buildSourceLab(theme, suffix) {
  const stateFrames = await Promise.all(SOURCE_STATE_LIBRARY.map((pose) => renderPose(
    pose,
    theme,
    `Grok Bot character state: ${pose.states[0]}`,
  )));
  const stateAtlasPng = await composeAtlas(stateFrames, 8, 5);
  await sharp(stateAtlasPng).webp({ lossless: true, quality: 100, alphaQuality: 100, effort: 6 })
    .toFile(path.join(sourceLabRoot, `state-atlas-${suffix}.webp`));
  await buildStateLibraryContact(stateFrames, theme, suffix);

  const transitionPoses = SOURCE_EFFECT_TRANSITIONS.flatMap((row) => row.frames);
  const transitionFrames = await Promise.all(transitionPoses.map((pose) => renderPose(
    pose,
    theme,
    `Grok Bot ${pose.states[0]} ${pose.sourceEffect} at A=${pose.sourceEffectActivation}`,
  )));
  const transitionAtlasPng = await composeAtlas(transitionFrames, 4, SOURCE_EFFECT_TRANSITIONS.length);
  await sharp(transitionAtlasPng).webp({ lossless: true, quality: 100, alphaQuality: 100, effort: 6 })
    .toFile(path.join(sourceLabRoot, `effect-transitions-${suffix}.webp`));
  await buildEffectTransitionContact(transitionFrames, theme, suffix);
}

async function buildStateLibraryContact(frames, theme, suffix) {
  const columns = 8;
  const rows = 5;
  const scale = 0.62;
  const cellWidth = Math.round(CELL_WIDTH * scale);
  const artHeight = Math.round(CELL_HEIGHT * scale);
  const labelHeight = 26;
  const width = columns * cellWidth;
  const height = rows * (artHeight + labelHeight);
  const isLight = theme === "light-codex";
  const background = checkerPattern(width, height, 14, isLight ? "#F3F3F1" : "#101010", isLight ? "#E7E7E4" : "#191919");
  const composites = [];
  for (let index = 0; index < frames.length; index += 1) {
    composites.push({
      input: await sharp(frames[index]).resize(cellWidth, artHeight, { fit: "fill" }).png().toBuffer(),
      left: index % columns * cellWidth,
      top: Math.floor(index / columns) * (artHeight + labelHeight),
    });
  }
  const labels = SOURCE_STATE_LIBRARY.map((pose, index) => {
    const x = index % columns * cellWidth + cellWidth / 2;
    const y = Math.floor(index / columns) * (artHeight + labelHeight) + artHeight + 18;
    return `<text x="${x}" y="${y}" text-anchor="middle">${escapeText(pose.states[0])}</text>`;
  }).join("");
  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>text{fill:${isLight ? "#181818" : "#F7F7F5"};font:600 12px -apple-system,BlinkMacSystemFont,sans-serif}</style>${labels}</svg>`;
  await sharp(background).composite([...composites, { input: Buffer.from(labelSvg), left: 0, top: 0 }])
    .png({ compressionLevel: 9 }).toFile(path.join(sourceLabRoot, `state-contact-${suffix}.png`));
}

async function buildEffectTransitionContact(frames, theme, suffix) {
  const columns = 4;
  const rows = SOURCE_EFFECT_TRANSITIONS.length;
  const scale = 0.58;
  const cellWidth = Math.round(CELL_WIDTH * scale);
  const cellHeight = Math.round(CELL_HEIGHT * scale);
  const labelWidth = 176;
  const headerHeight = 42;
  const width = labelWidth + columns * cellWidth;
  const height = headerHeight + rows * cellHeight;
  const isLight = theme === "light-codex";
  const background = checkerPattern(width, height, 14, isLight ? "#F3F3F1" : "#101010", isLight ? "#E7E7E4" : "#191919");
  const composites = [];
  for (let index = 0; index < frames.length; index += 1) {
    composites.push({
      input: await sharp(frames[index]).resize(cellWidth, cellHeight, { fit: "fill" }).png().toBuffer(),
      left: labelWidth + index % columns * cellWidth,
      top: headerHeight + Math.floor(index / columns) * cellHeight,
    });
  }
  const headers = [0.25, 0.50, 0.62, 0.90].map((activation, column) => `<text class="head" x="${labelWidth + column * cellWidth + cellWidth / 2}" y="27" text-anchor="middle">A=${activation.toFixed(2)}</text>`).join("");
  const rowLabels = SOURCE_EFFECT_TRANSITIONS.map((row, index) => `<text x="14" y="${headerHeight + index * cellHeight + cellHeight / 2 - 4}">${escapeText(row.effect)}</text><text class="sub" x="14" y="${headerHeight + index * cellHeight + cellHeight / 2 + 14}">${escapeText(row.state)}</text>`).join("");
  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>text{fill:${isLight ? "#181818" : "#F7F7F5"};font:700 13px -apple-system,BlinkMacSystemFont,sans-serif}.sub{fill:${isLight ? "#666" : "#AAA"};font-size:11px;font-weight:500}.head{font-size:12px}</style>${headers}${rowLabels}</svg>`;
  await sharp(background).composite([...composites, { input: Buffer.from(labelSvg), left: 0, top: 0 }])
    .png({ compressionLevel: 9 }).toFile(path.join(sourceLabRoot, `effect-transitions-${suffix}.png`));
}

function populatedLabel() {
  return `${POPULATED_FRAME_COUNT} populated cells across ${ROW_COUNT} rows`;
}

async function buildContactSheet(atlasPng, build) {
  const scale = 0.56;
  const cellWidth = Math.round(CELL_WIDTH * scale);
  const cellHeight = Math.round(CELL_HEIGHT * scale);
  const gutter = 18;
  const labelWidth = 186;
  const headerHeight = 54;
  const width = labelWidth + gutter + cellWidth * COLUMNS;
  const height = headerHeight + cellHeight * ROW_COUNT;
  const isLight = build.theme === "light-codex";
  const checker = checkerPattern(
    width,
    height,
    16,
    isLight ? "#F3F3F1" : "#111111",
    isLight ? "#E7E7E4" : "#1A1A1A",
  );
  const resizedAtlas = await sharp(atlasPng)
    .resize(cellWidth * COLUMNS, cellHeight * ROW_COUNT, { fit: "fill" })
    .png()
    .toBuffer();
  const labels = contactLabels(width, height, labelWidth, gutter, headerHeight, cellWidth, cellHeight, build.theme);
  await sharp(checker)
    .composite([
      { input: resizedAtlas, left: labelWidth + gutter, top: headerHeight },
      { input: Buffer.from(labels), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(build.contactPath);
}

async function buildRowPreview(row) {
  const gap = 12;
  const margin = 20;
  const labelHeight = 42;
  const width = margin * 2 + row.frames.length * CELL_WIDTH + (row.frames.length - 1) * gap;
  const height = margin * 2 + labelHeight + CELL_HEIGHT;
  const background = checkerPattern(width, height, 14, "#101010", "#191919");
  const frameComposites = row.renderedFrames.map((input, index) => ({
    input,
    left: margin + index * (CELL_WIDTH + gap),
    top: margin + labelHeight,
  }));
  const overlay = rowLabel(row, width, height, margin, labelHeight, gap);
  const stripPath = path.join(rowPreviewRoot, `${String(row.index).padStart(2, "0")}-${row.id}.png`);
  await sharp(background)
    .composite([...frameComposites, { input: Buffer.from(overlay), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(stripPath);

  // Lossless animated WebP preserves the semitransparent effect frames.
  // GIF's one-bit alpha turns standby/radar cells into misleading opaque dots.
  // This preview-only authoring-row animation stays best-effort so static QA
  // generation never depends on optional animated output in a libvips build.
  try {
    const animatedFrames = row.renderedFrames.slice(0, row.durations.length);
    const stack = sharp({
      create: {
        width: CELL_WIDTH,
        height: CELL_HEIGHT * animatedFrames.length,
        pageHeight: CELL_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(animatedFrames.map((input, index) => ({ input, left: 0, top: index * CELL_HEIGHT })));
    const animationDurations = row.durations;
    await stack.webp({
      lossless: true,
      quality: 100,
      alphaQuality: 100,
      delay: animationDurations,
      effort: 6,
      exact: true,
      loop: 0,
    }).toFile(path.join(rowPreviewRoot, `${String(row.index).padStart(2, "0")}-${row.id}.webp`));
  } catch (error) {
    console.warn(`Skipped animated WebP for ${row.id}: ${error.message}`);
  }
}

function checkerPattern(width, height, size = 16, dark = "#111111", light = "#1A1A1A") {
  const squares = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      squares.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${(x / size + y / size) % 2 ? light : dark}"/>`);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${squares.join("")}</svg>`);
}

function contactLabels(width, height, labelWidth, gutter, headerHeight, cellWidth, cellHeight, theme) {
  const gridX = labelWidth + gutter;
  const lines = [];
  for (let column = 0; column <= COLUMNS; column += 1) {
    const x = gridX + column * cellWidth;
    lines.push(`<path d="M${x} ${headerHeight}V${height}"/>`);
  }
  for (let row = 0; row <= ROW_COUNT; row += 1) {
    const y = headerHeight + row * cellHeight;
    lines.push(`<path d="M${gridX} ${y}H${width}"/>`);
  }
  const columnLabels = Array.from({ length: COLUMNS }, (_, column) => `<text x="${gridX + column * cellWidth + cellWidth / 2}" y="34" text-anchor="middle">${column}</text>`).join("");
  const rowLabels = ROWS.map((row) => `<text x="16" y="${headerHeight + row.index * cellHeight + cellHeight / 2 - 5}">${String(row.index).padStart(2, "0")}  ${escapeText(row.id)}</text><text class="secondary" x="16" y="${headerHeight + row.index * cellHeight + cellHeight / 2 + 15}">${row.frames.length} frames</text>`).join("");
  const isLight = theme === "light-codex";
  const primary = isLight ? "#151515" : "#F9F8F6";
  const secondary = isLight ? "#666666" : "#A8A8A8";
  const line = isLight ? "#000000" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{fill:${primary};font:600 14px -apple-system,BlinkMacSystemFont,sans-serif}.secondary{fill:${secondary};font-size:11px}path{fill:none;stroke:${line};stroke-opacity:.12;stroke-width:1}</style>${columnLabels}${rowLabels}<g>${lines.join("")}</g></svg>`;
}

function rowLabel(row, width, height, margin, labelHeight, gap) {
  const names = row.frames.map((frame, index) => `<text class="frame" x="${margin + index * (CELL_WIDTH + gap) + CELL_WIDTH / 2}" y="${height - 7}" text-anchor="middle">${escapeText(frame.name)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>.title{fill:#F9F8F6;font:700 16px -apple-system,BlinkMacSystemFont,sans-serif}.frame{fill:#A8A8A8;font:500 10px -apple-system,BlinkMacSystemFont,sans-serif}</style><text class="title" x="${margin}" y="${margin + 18}">${String(row.index).padStart(2, "0")} · ${escapeText(row.label)} · ${row.frames.length} frames</text>${names}</svg>`;
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
