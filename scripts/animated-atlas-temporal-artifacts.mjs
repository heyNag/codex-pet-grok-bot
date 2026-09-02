import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { FLUID_ATLAS_FRAME_COUNT } from "../src/fluid-atlas.mjs";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  ROWS,
} from "../src/spec.mjs";

const FRAME_COUNT = FLUID_ATLAS_FRAME_COUNT;
const ALL_FRAME_LABEL_WIDTH = 176;
const ALL_FRAME_HEADER_HEIGHT = 44;
const WORST_LABEL_WIDTH = 220;
const WORST_HEADER_HEIGHT = 44;
const SURFACES = Object.freeze({
  dark: Object.freeze([8, 11, 12]),
  light: Object.freeze([243, 241, 233]),
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function requiredCells() {
  return ROWS.flatMap((row, rowIndex) => row.frames.map((_, column) => ({
    key: `r${rowIndex}c${column}`,
    row: rowIndex,
    column,
    state: row.id,
  })));
}

function fillRgb(buffer, rgb) {
  for (let offset = 0; offset < buffer.length; offset += 3) {
    buffer[offset] = rgb[0];
    buffer[offset + 1] = rgb[1];
    buffer[offset + 2] = rgb[2];
  }
}

function flattenPixel(source, offset, background, target, targetOffset) {
  const alpha = source[offset + 3];
  target[targetOffset] = Math.floor(
    (source[offset] * alpha + background[0] * (255 - alpha) + 127) / 255,
  );
  target[targetOffset + 1] = Math.floor(
    (source[offset + 1] * alpha + background[1] * (255 - alpha) + 127) / 255,
  );
  target[targetOffset + 2] = Math.floor(
    (source[offset + 2] * alpha + background[2] * (255 - alpha) + 127) / 255,
  );
}

function extractFlattenedCell(page, row, column, background) {
  const output = Buffer.allocUnsafe(CELL_WIDTH * CELL_HEIGHT * 3);
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < CELL_WIDTH; x += 1) {
      const source = ((row * CELL_HEIGHT + y) * ATLAS_WIDTH + column * CELL_WIDTH + x) * 4;
      flattenPixel(page, source, background, output, (y * CELL_WIDTH + x) * 3);
    }
  }
  return output;
}

function writeCellToAllFrameSheet(output, width, page, cellIndex, source, row, column, background) {
  const left = ALL_FRAME_LABEL_WIDTH + page * CELL_WIDTH;
  const top = ALL_FRAME_HEADER_HEIGHT + cellIndex * CELL_HEIGHT;
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < CELL_WIDTH; x += 1) {
      const sourceOffset = ((row * CELL_HEIGHT + y) * ATLAS_WIDTH + column * CELL_WIDTH + x) * 4;
      const targetOffset = ((top + y) * width + left + x) * 3;
      flattenPixel(source, sourceOffset, background, output, targetOffset);
    }
  }
}

function labelsSvg({ width, height, variant, cells }) {
  const foreground = "#f4f7f7";
  const muted = "#9eabad";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${ALL_FRAME_HEADER_HEIGHT}" fill="#0b0e0f"/>
    <rect width="${ALL_FRAME_LABEL_WIDTH}" height="${height}" fill="#0b0e0f"/>
    <text x="10" y="27" fill="${foreground}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">${variant.toUpperCase()} ALL ${FRAME_COUNT} SHIPPING PHASES</text>
    <text x="${ALL_FRAME_LABEL_WIDTH + 4}" y="27" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${Array.from({ length: FRAME_COUNT }, (_, page) => `<tspan x="${ALL_FRAME_LABEL_WIDTH + page * CELL_WIDTH + 4}">${String(page).padStart(2, "0")}</tspan>`).join("")}</text>
    ${cells.map((cell, index) => `<text x="10" y="${ALL_FRAME_HEADER_HEIGHT + index * CELL_HEIGHT + 24}" fill="${foreground}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700">${cell.key}</text><text x="10" y="${ALL_FRAME_HEADER_HEIGHT + index * CELL_HEIGHT + 43}" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${escapeXml(cell.state)}</text>`).join("")}
  </svg>`);
}

function transitionRisk(transition, rowGate) {
  const metrics = transition.metrics;
  return Math.max(
    metrics.normalizedRgbaDiff / rowGate.maximumNormalizedRgbaDiff,
    metrics.normalizedAlphaDiff / rowGate.maximumNormalizedAlphaDiff,
    metrics.perceptualRms / rowGate.maximumPerceptualRms,
    metrics.featureInkVariationFraction / rowGate.maximumFeatureInkVariationFraction,
    metrics.localEnergyRatio / rowGate.maximumLocalEnergyRatio,
  );
}

function maximumBy(candidates, score) {
  return candidates.reduce((current, candidate) => (
    current == null || score(candidate) > score(current) ? candidate : current
  ), null);
}

function selectWorstRows(variant, report) {
  const rows = [];
  for (let row = 0; row < ROWS.length; row += 1) {
    const candidates = report.temporal.cells
      .filter((cell) => cell.row === row)
      .flatMap((cell) => cell.temporalAdjacency.transitions.map((transition) => ({
        cell,
        transition,
      })));
    const selected = maximumBy(candidates, ({ transition }) => (
      transitionRisk(transition, report.contract.temporalRowUpperBounds[row])
    ));
    rows.push({ variant, reason: `row ${row} maximum gate utilization`, ...selected });
  }
  const all = report.temporal.cells.flatMap((cell) => (
    cell.temporalAdjacency.transitions.map((transition) => ({ cell, transition }))
  ));
  rows.push({
    variant,
    reason: "maximum material local-energy ratio",
    ...maximumBy(all.filter(({ transition }) => transition.metrics.perceptualRms >= 1), ({ transition }) => (
      transition.metrics.localEnergyRatio
    )),
  });
  rows.push({
    variant,
    reason: "maximum feature-ink variation",
    ...maximumBy(all, ({ transition }) => transition.metrics.featureInkVariationFraction),
  });
  rows.push({
    variant,
    reason: "maximum loop seam",
    ...maximumBy(all.filter(({ transition }) => transition.seam), ({ transition }) => (
      transition.metrics.perceptualRms
    )),
  });
  return rows;
}

function differencePanel(before, after) {
  const output = Buffer.allocUnsafe(before.length);
  for (let offset = 0; offset < before.length; offset += 3) {
    const red = Math.abs(after[offset] - before[offset]);
    const green = Math.abs(after[offset + 1] - before[offset + 1]);
    const blue = Math.abs(after[offset + 2] - before[offset + 2]);
    const magnitude = Math.max(red, green, blue) / 255;
    output[offset] = Math.round(255 * Math.min(1, magnitude * 2.5));
    output[offset + 1] = Math.round(255 * Math.max(0, magnitude - 0.25) / 0.75);
    output[offset + 2] = Math.round(255 * Math.max(0, magnitude - 0.75) / 0.25);
  }
  return output;
}

function copyRgbPanel(target, targetWidth, source, left, top) {
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    source.copy(
      target,
      ((top + y) * targetWidth + left) * 3,
      y * CELL_WIDTH * 3,
      (y + 1) * CELL_WIDTH * 3,
    );
  }
}

function worstLabelsSvg(width, height, rows) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${WORST_HEADER_HEIGHT}" fill="#0b0e0f"/>
    <rect width="${WORST_LABEL_WIDTH}" height="${height}" fill="#0b0e0f"/>
    <text x="10" y="27" fill="#f4f7f7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">SHIPPING TEMPORAL WORST TRANSITIONS - SOURCE CELL 192x208 - NO RESAMPLING</text>
    ${["BEFORE", "AFTER", "RGB DELTA"].map((label, index) => `<text x="${WORST_LABEL_WIDTH + index * CELL_WIDTH + 8}" y="27" fill="#9eabad" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${label}</text>`).join("")}
    ${rows.map((row, index) => {
      const transition = row.transition;
      const top = WORST_HEADER_HEIGHT + index * CELL_HEIGHT;
      return `<text x="10" y="${top + 24}" fill="#f4f7f7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="700">${row.variant}/${row.cell.key} p${transition.fromPage}-&gt;p${transition.toPage}</text><text x="10" y="${top + 43}" fill="#9eabad" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">${escapeXml(row.reason)}</text><text x="10" y="${top + 60}" fill="#9eabad" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">rms ${transition.metrics.perceptualRms} eye ${transition.metrics.featureInkVariationFraction}</text>`;
    }).join("")}
  </svg>`);
}

async function buildVariant(root, variant, report) {
  const cells = requiredCells();
  const width = ALL_FRAME_LABEL_WIDTH + FRAME_COUNT * CELL_WIDTH;
  const height = ALL_FRAME_HEADER_HEIGHT + cells.length * CELL_HEIGHT;
  const background = SURFACES[variant];
  const raw = Buffer.allocUnsafe(width * height * 3);
  fillRgb(raw, [11, 14, 15]);
  const selected = selectWorstRows(variant, report).map((row) => ({ ...row, frames: {} }));
  const atlasPath = path.join(root, `pet/grok-bot-${variant}/spritesheet.webp`);
  for (let page = 0; page < FRAME_COUNT; page += 1) {
    const decoded = await sharp(atlasPath, {
      animated: true,
      failOn: "error",
      page,
      pages: 1,
      sequentialRead: true,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== ATLAS_WIDTH || decoded.info.height !== ATLAS_HEIGHT) {
      throw new Error(`${variant} page ${page} did not decode as ${ATLAS_WIDTH}x${ATLAS_HEIGHT}`);
    }
    cells.forEach((cell, cellIndex) => {
      writeCellToAllFrameSheet(
        raw,
        width,
        page,
        cellIndex,
        decoded.data,
        cell.row,
        cell.column,
        background,
      );
    });
    for (const row of selected) {
      if (row.transition.fromPage === page) {
        row.frames.before = extractFlattenedCell(
          decoded.data,
          row.cell.row,
          row.cell.column,
          background,
        );
      }
      if (row.transition.toPage === page) {
        row.frames.after = extractFlattenedCell(
          decoded.data,
          row.cell.row,
          row.cell.column,
          background,
        );
      }
    }
  }
  const image = await sharp(raw, { raw: { width, height, channels: 3 } })
    .composite([{ input: labelsSvg({ width, height, variant, cells }), left: 0, top: 0 }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  return {
    image,
    selected,
    report: {
      path: `qa/animated-atlas-temporal-all-frames-${variant}.png`,
      sha256: sha256(image),
      width,
      height,
      variant,
      frameCount: FRAME_COUNT,
      requiredCellCount: cells.length,
      displayedCellFrames: cells.length * FRAME_COUNT,
      sampling: "exact decoded 192x208 source cell on intended surface; no resampling",
      intendedSurfaceRgb: background,
      rowOrder: cells,
    },
  };
}

async function buildWorstSheet(rows) {
  const width = WORST_LABEL_WIDTH + CELL_WIDTH * 3;
  const height = WORST_HEADER_HEIGHT + rows.length * CELL_HEIGHT;
  const raw = Buffer.allocUnsafe(width * height * 3);
  fillRgb(raw, [11, 14, 15]);
  rows.forEach((row, index) => {
    if (!row.frames.before || !row.frames.after) {
      throw new Error(`worst temporal row ${row.variant}/${row.cell.key} is missing a decoded frame`);
    }
    const top = WORST_HEADER_HEIGHT + index * CELL_HEIGHT;
    copyRgbPanel(raw, width, row.frames.before, WORST_LABEL_WIDTH, top);
    copyRgbPanel(raw, width, row.frames.after, WORST_LABEL_WIDTH + CELL_WIDTH, top);
    copyRgbPanel(
      raw,
      width,
      differencePanel(row.frames.before, row.frames.after),
      WORST_LABEL_WIDTH + CELL_WIDTH * 2,
      top,
    );
  });
  const image = await sharp(raw, { raw: { width, height, channels: 3 } })
    .composite([{ input: worstLabelsSvg(width, height, rows), left: 0, top: 0 }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  return {
    image,
    report: {
      path: "qa/animated-atlas-temporal-worst-cases.png",
      sha256: sha256(image),
      width,
      height,
      rowCount: rows.length,
      sampling: "exact decoded 192x208 source cell on intended surface; no resampling",
      rows: rows.map(({ variant, reason, cell, transition }) => ({
        variant,
        reason,
        cellKey: cell.key,
        row: cell.row,
        column: cell.column,
        state: cell.state,
        fromPage: transition.fromPage,
        toPage: transition.toPage,
        seam: transition.seam,
        metrics: transition.metrics,
        flags: transition.validation.flags,
      })),
    },
  };
}

export async function buildAnimatedAtlasTemporalArtifacts({ root, reports }) {
  const variants = {};
  for (const variant of ["dark", "light"]) {
    variants[variant] = await buildVariant(root, variant, reports[variant]);
  }
  const worst = await buildWorstSheet([
    ...variants.dark.selected,
    ...variants.light.selected,
  ]);
  return {
    files: new Map([
      [variants.dark.report.path, variants.dark.image],
      [variants.light.report.path, variants.light.image],
      [worst.report.path, worst.image],
    ]),
    report: {
      allFrameSheets: {
        dark: variants.dark.report,
        light: variants.light.report,
      },
      worstCaseSheet: worst.report,
    },
  };
}
