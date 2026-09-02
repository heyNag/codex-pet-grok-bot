#!/usr/bin/env node

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
import {
  ALPHA_EDGE_THRESHOLDS,
  alphaEdgeQualityErrors,
  finalizeAlphaEdgeMetrics,
  measureAlphaEdgeCell,
  summarizeAlphaEdgeMeasurements,
} from "./alpha-edge-quality.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VARIANTS = Object.freeze({
  dark: "qa/authoring-atlas-dark.webp",
  light: "qa/authoring-atlas-light.webp",
});

export async function inspectAlphaEdgeQuality(atlasPath) {
  const decoded = await sharp(atlasPath, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== ATLAS_WIDTH || decoded.info.height !== ATLAS_HEIGHT || decoded.info.channels !== 4) {
    throw new Error(`Expected a ${ATLAS_WIDTH}x${ATLAS_HEIGHT} RGBA atlas; decoded ${decoded.info.width}x${decoded.info.height} with ${decoded.info.channels} channels`);
  }

  const cells = [];
  for (const row of ROWS) {
    for (let column = 0; column < row.frames.length; column += 1) {
      const rgba = Buffer.allocUnsafe(CELL_WIDTH * CELL_HEIGHT * 4);
      let target = 0;
      for (let y = 0; y < CELL_HEIGHT; y += 1) {
        const source = ((row.index * CELL_HEIGHT + y) * decoded.info.width + column * CELL_WIDTH) * 4;
        decoded.data.copy(rgba, target, source, source + CELL_WIDTH * 4);
        target += CELL_WIDTH * 4;
      }
      const measurement = measureAlphaEdgeCell(rgba, CELL_WIDTH, CELL_HEIGHT);
      cells.push({
        row: row.index,
        column,
        state: row.id,
        metrics: finalizeAlphaEdgeMetrics(measurement),
        measurement,
      });
    }
  }

  const summary = summarizeAlphaEdgeMeasurements(cells.map((cell) => cell.measurement));
  const errors = alphaEdgeQualityErrors(summary, cells);
  return {
    ok: errors.length === 0,
    populatedCellCount: cells.length,
    thresholds: ALPHA_EDGE_THRESHOLDS,
    summary,
    cells: cells.map(({ measurement: _measurement, ...cell }) => cell),
    errors,
  };
}

async function main() {
  const reports = {};
  for (const [variant, relativeAtlasPath] of Object.entries(VARIANTS)) {
    reports[variant] = await inspectAlphaEdgeQuality(path.join(repositoryRoot, relativeAtlasPath));
    const { summary } = reports[variant];
    console.log(
      `${reports[variant].ok ? "PASS" : "FAIL"}: ${variant} alpha edges; `
      + `${(summary.semiAlphaWithinFringeFraction * 100).toFixed(2)}% within ${ALPHA_EDGE_THRESHOLDS.fringeDepthPx}px, `
      + `p95 ${summary.semiAlphaDepthP95Px}px, outer median ${summary.outerEdgeAlphaMedian}/255, `
      + `${(summary.opaqueInteriorFraction * 100).toFixed(2)}% opaque interior`,
    );
    for (const error of reports[variant].errors) console.error(`error: ${variant}: ${error}`);
  }
  if (Object.values(reports).some((report) => !report.ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
