import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repositoryRoot, "qa/codex-default-dpr2-browser-oracle.json");
const mapPath = path.join(repositoryRoot, "qa/codex-default-dpr2-browser-oracle-map.bin");
const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 11;
const ATLAS_WIDTH = CELL_WIDTH * COLUMNS;
const ATLAS_HEIGHT = CELL_HEIGHT * ROWS;

const reportBytes = readFileSync(reportPath);
const report = JSON.parse(reportBytes);
const compressedMap = readFileSync(mapPath);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (report.ok !== true || report.kind !== "codex-default-dpr2-browser-oracle") {
  throw new Error("The Codex default DPR2 browser oracle is not sealed as passing");
}
if (sha256(compressedMap) !== report.sourceMaps.compressedSha256) {
  throw new Error("The Codex default DPR2 browser-oracle map digest does not match its report");
}

const compactMap = inflateSync(compressedMap);
if (
  compactMap.length !== report.sourceMaps.compactBytes
  || sha256(compactMap) !== report.sourceMaps.compactSha256
) {
  throw new Error("The inflated Codex default DPR2 browser-oracle map is stale or corrupt");
}

export function decodeCodexDefaultDpr2CompactMap(compact) {
  if (!Buffer.isBuffer(compact)) throw new TypeError("browser-oracle compact map must be a Buffer");
  if (compact.subarray(0, 8).toString("ascii") !== "CDP2MAP1") {
    throw new Error("The Codex default DPR2 browser-oracle map has an invalid header");
  }
  const width = compact.readUInt16LE(8);
  const height = compact.readUInt16LE(10);
  const columns = compact.readUInt16LE(12);
  const rows = compact.readUInt16LE(14);
  const cellCount = compact.readUInt16LE(16);
  const cells = [];
  let offset = 18;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const baseX = compact.subarray(offset, offset + width);
    offset += width;
    const baseY = compact.subarray(offset, offset + height);
    offset += height;
    const overrideCount = compact.readUInt32LE(offset);
    offset += 4;
    const expanded = Buffer.allocUnsafe(width * height * 2);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      expanded[pixel * 2] = baseX[pixel % width];
      expanded[pixel * 2 + 1] = baseY[Math.floor(pixel / width)];
    }
    for (let index = 0; index < overrideCount; index += 1) {
      const pixel = compact.readUInt16LE(offset);
      if (pixel >= width * height) throw new Error("browser-oracle override index is invalid");
      expanded[pixel * 2] = compact[offset + 2];
      expanded[pixel * 2 + 1] = compact[offset + 3];
      offset += 4;
    }
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (expanded[pixel * 2] >= CELL_WIDTH || expanded[pixel * 2 + 1] >= CELL_HEIGHT) {
        throw new Error(`browser-oracle source coordinate is outside its ${CELL_WIDTH}x${CELL_HEIGHT} cell`);
      }
    }
    cells.push(expanded);
  }
  if (offset !== compact.length) throw new Error("browser-oracle map has trailing bytes");
  return {
    width,
    height,
    columns,
    rows,
    cellCount,
    raw: Buffer.concat(cells),
  };
}

const expanded = decodeCodexDefaultDpr2CompactMap(compactMap);
const rawMap = expanded.raw;
if (
  expanded.width !== report.sourceMaps.outputDeviceWidth
  || expanded.height !== report.sourceMaps.outputDeviceHeight
  || expanded.columns !== 8
  || expanded.rows !== 11
  || expanded.cellCount !== report.sourceMaps.allCellCount
  || rawMap.length !== report.sourceMaps.rawBytes
  || sha256(rawMap) !== report.sourceMaps.rawSha256
  || sha256(rawMap) !== report.sourceMaps.roundTripRawSha256
) throw new Error("The browser-oracle map does not losslessly reproduce the screenshot trace");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const CODEX_DEFAULT_DPR2_DISPLAY = deepFreeze({
  id: "codexDefaultDpr2",
  cssWidthExpression: report.target.cssWidthExpression,
  rootFontSizePx: report.target.rootFontSizePx,
  cssWidthPx: report.target.measuredCssRect.width,
  cssHeightPx: report.target.measuredCssRect.height,
  devicePixelRatio: report.target.devicePixelRatio,
  deviceWidthPx: report.sourceMaps.outputDeviceWidth,
  deviceHeightPx: report.sourceMaps.outputDeviceHeight,
  interpolation: "exact Chromium-151 Page.captureScreenshot source-coordinate oracle",
  renderer: { ...report.renderer },
  screenshotProbe: {
    passCount: report.screenshotProbe.passCount,
    diagnosticSha256: report.screenshotProbe.diagnosticSha256,
    orderedCellTraceSha256: report.sourceMaps.orderedCellTraceSha256,
    rawMapSha256: report.sourceMaps.rawSha256,
  },
  originContract: { ...report.target.originContract },
});

export const CODEX_DEFAULT_DPR2_ORACLE_REPORT = deepFreeze(report);

const TARGET_PIXELS = CODEX_DEFAULT_DPR2_DISPLAY.deviceWidthPx
  * CODEX_DEFAULT_DPR2_DISPLAY.deviceHeightPx;
const CELL_MAP_BYTES = TARGET_PIXELS * 2;

function assertCell(row, column) {
  if (!Number.isInteger(row) || row < 0 || row >= ROWS) {
    throw new RangeError(`row ${row} is outside the browser-oracle grid`);
  }
  if (!Number.isInteger(column) || column < 0 || column >= COLUMNS) {
    throw new RangeError(`column ${column} is outside the browser-oracle grid`);
  }
}

function cellMapView(row, column) {
  assertCell(row, column);
  const cell = row * COLUMNS + column;
  return rawMap.subarray(cell * CELL_MAP_BYTES, (cell + 1) * CELL_MAP_BYTES);
}

export function codexDefaultDpr2CellMap(row, column) {
  return Buffer.from(cellMapView(row, column));
}

export function codexDefaultDpr2SourceIndexMap(row, column) {
  const cellMap = cellMapView(row, column);
  const result = new Uint32Array(TARGET_PIXELS);
  for (let pixel = 0; pixel < TARGET_PIXELS; pixel += 1) {
    const sourceX = column * CELL_WIDTH + cellMap[pixel * 2];
    const sourceY = row * CELL_HEIGHT + cellMap[pixel * 2 + 1];
    result[pixel] = sourceY * ATLAS_WIDTH + sourceX;
  }
  return result;
}

export function renderCodexDefaultDpr2Frame(atlasPage, row, column) {
  assertCell(row, column);
  if (!Buffer.isBuffer(atlasPage) || atlasPage.length !== ATLAS_WIDTH * ATLAS_HEIGHT * 4) {
    throw new TypeError(`atlasPage must contain ${ATLAS_WIDTH * ATLAS_HEIGHT * 4} RGBA bytes`);
  }
  const cellMap = cellMapView(row, column);
  const output = Buffer.allocUnsafe(TARGET_PIXELS * 4);
  for (let pixel = 0; pixel < TARGET_PIXELS; pixel += 1) {
    const sourceX = column * CELL_WIDTH + cellMap[pixel * 2];
    const sourceY = row * CELL_HEIGHT + cellMap[pixel * 2 + 1];
    const sourceOffset = (sourceY * ATLAS_WIDTH + sourceX) * 4;
    const targetOffset = pixel * 4;
    output[targetOffset] = atlasPage[sourceOffset];
    output[targetOffset + 1] = atlasPage[sourceOffset + 1];
    output[targetOffset + 2] = atlasPage[sourceOffset + 2];
    output[targetOffset + 3] = atlasPage[sourceOffset + 3];
  }
  return output;
}
