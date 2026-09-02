import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { COVERAGE_SUPERSAMPLE, reducePremultipliedAreaRgba, renderCoverageSpritePixels } from "../src/coverage-raster.mjs";
import { renderFrameSvg, THEME_PALETTES } from "../src/grok-art.mjs";
import { CELL_HEIGHT, CELL_WIDTH, ROWS } from "../src/spec.mjs";

const info2 = { width: 2, height: 2, channels: 4 };
const reduce = (pixels) => reducePremultipliedAreaRgba(Uint8Array.from(pixels.flat()), info2, 2).data;
const svg = (content, width = CELL_WIDTH, height = CELL_HEIGHT) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
const decode = (png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test("area reduction preserves straight colors at partial and nearly zero coverage", () => {
  for (const color of [[255, 255, 255], [249, 112, 92], [91, 149, 240], [0, 0, 0]]) {
    assert.deepEqual([...reduce([[...color, 2], [32, 80, 240, 0], [0, 0, 0, 0], [255, 0, 0, 0]])], [...color, 1]);
    assert.deepEqual([...reduce(Array.from({ length: 4 }, () => [...color, 127]))], [...color, 127]);
  }
});

test("transparent hidden RGB contributes nothing, and transparent output is all zero", () => {
  assert.deepEqual([...reduce([[255, 255, 255, 0], [100, 200, 50, 0], [255, 0, 0, 0], [0, 0, 255, 0]])], [0, 0, 0, 0]);
  assert.deepEqual([...reduce([[255, 255, 255, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])], [0, 0, 0, 0]);
  assert.deepEqual([...reduce([[255, 0, 0, 255], [0, 0, 255, 0], [0, 255, 0, 0], [255, 255, 255, 0]])], [255, 0, 0, 64]);
});

test("mixed translucent colors are weighted by alpha, not by the transparent matte", () => {
  const mixed = reduce([[255, 0, 0, 255], [0, 0, 255, 127], [0, 255, 0, 0], [255, 255, 255, 0]]);
  assert.deepEqual([...mixed], [170, 0, 85, 96]);
  for (const background of [0, 255]) {
    for (let channel = 0; channel < 3; channel += 1) {
      const composite = mixed[channel] * mixed[3] / 255 + background * (1 - mixed[3] / 255);
      const premultiplied = [255 * 255, 0, 255 * 127][channel] / (4 * 255);
      const ideal = premultiplied + background * (1 - (255 + 127) / (4 * 255));
      assert.ok(Math.abs(composite - ideal) <= 0.500001);
    }
  }
});

test("solid palette colors and block positions survive exactly without mutating the input", () => {
  const colors = [...new Set(Object.values(THEME_PALETTES["dark-codex"]))]
    .map((hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)));
  for (const color of colors) {
    const pixels = Buffer.from(Array.from({ length: 64 }, () => [...color, 255]).flat());
    const before = Buffer.from(pixels);
    const result = reducePremultipliedAreaRgba(pixels, { width: 8, height: 8 }, 8);
    assert.deepEqual([...result.data], [...color, 255]);
    assert.deepEqual(result.info, { width: 1, height: 1, channels: 4 });
    assert.deepEqual(pixels, before);
  }
  const pixels = Buffer.from(Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => [x < 2 ? 255 : 0, y < 2 ? 255 : 0, 0, 255]).flat()).flat());
  assert.deepEqual([...reducePremultipliedAreaRgba(pixels, { width: 4, height: 4 }, 2).data],
    [255, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
});

test("factor-one reduction is an exact copy with clean hidden RGB", () => {
  const pixels = Uint8Array.from([25, 180, 220, 127, 255, 128, 30, 0]);
  const result = reducePremultipliedAreaRgba(pixels, { width: 2, height: 1 }, 1);
  assert.deepEqual([...result.data], [25, 180, 220, 127, 0, 0, 0, 0]);
  assert.notEqual(result.data, pixels);
});

test("area coverage cannot ring or bleed into neighboring output blocks", () => {
  const pixels = Buffer.alloc(8 * 8 * 4);
  pixels.set([249, 112, 92, 255], (3 * 8 + 3) * 4);
  const { data } = reducePremultipliedAreaRgba(pixels, { width: 8, height: 8 }, 2);
  for (let offset = 0; offset < data.length; offset += 4) {
    assert.deepEqual([...data.subarray(offset, offset + 4)],
      offset === (1 * 4 + 1) * 4 ? [249, 112, 92, 64] : [0, 0, 0, 0]);
  }
});

test("invalid area dimensions, channels, factors, and byte counts are rejected", () => {
  const pixels = Buffer.alloc(16);
  for (const factor of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => reducePremultipliedAreaRgba(pixels, info2, factor), RangeError);
  }
  for (const info of [{ width: 0, height: 2 }, { width: 2.5, height: 2 }, { width: 2, height: -1 }, { width: 2, height: 2, channels: 3 }]) {
    assert.throws(() => reducePremultipliedAreaRgba(pixels, info, 2), RangeError);
  }
  assert.throws(() => reducePremultipliedAreaRgba(Buffer.alloc(24), { width: 3, height: 2 }, 2), /divisible/);
  assert.throws(() => reducePremultipliedAreaRgba(Buffer.alloc(15), info2, 2), TypeError);
  assert.throws(() => reducePremultipliedAreaRgba(new Uint16Array(16), info2, 2), TypeError);
});

test("SVG coverage materializes eightfold and outputs exact cell dimensions with clean edges", async () => {
  assert.equal(COVERAGE_SUPERSAMPLE, 8);
  const result = await decode(await renderCoverageSpritePixels(svg('<circle cx="96.25" cy="104.375" r="63.2" fill="white" opacity="0.5"/>')));
  assert.deepEqual([result.info.width, result.info.height, result.info.channels], [CELL_WIDTH, CELL_HEIGHT, 4]);
  let partial = 0;
  for (let offset = 0; offset < result.data.length; offset += 4) {
    if (result.data[offset + 3] === 0) assert.deepEqual([...result.data.subarray(offset, offset + 3)], [0, 0, 0]);
    else {
      partial += 1;
      assert.deepEqual([...result.data.subarray(offset, offset + 3)], [255, 255, 255]);
      assert.ok(result.data[offset + 3] <= 128);
    }
    const pixel = offset / 4;
    const x = pixel % CELL_WIDTH;
    const y = Math.floor(pixel / CELL_WIDTH);
    if (x < 2 || x >= CELL_WIDTH - 2 || y < 2 || y >= CELL_HEIGHT - 2) assert.equal(result.data[offset + 3], 0);
  }
  assert.ok(partial > 1000);
});

test("SVG palette accents remain exact at opaque and translucent solid interiors", async () => {
  const colors = Object.values(THEME_PALETTES["dark-codex"]);
  const rectangles = colors.map((color, index) => `<rect x="${index * 16}" y="10" width="12" height="12" fill="${color}"/><rect x="${index * 16}" y="30" width="12" height="12" fill="${color}" opacity="0.5"/>`).join("");
  const { data } = await decode(await renderCoverageSpritePixels(Buffer.from(svg(rectangles))));
  for (const [index, hex] of colors.entries()) {
    const expected = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    for (const [y, alpha] of [[15, 255], [35, 128]]) {
      const offset = (y * CELL_WIDTH + index * 16 + 5) * 4;
      assert.deepEqual([...data.subarray(offset, offset + 4)], [...expected, alpha]);
    }
  }
});

test("existing art retains dark/light coverage parity and transparent gutters", async () => {
  const results = await Promise.all(["dark-codex", "light-codex"].map(async (theme) =>
    decode(await renderCoverageSpritePixels(renderFrameSvg(ROWS[0].frames[0], { theme })))));
  for (let offset = 0; offset < results[0].data.length; offset += 4) {
    assert.equal(results[0].data[offset + 3], results[1].data[offset + 3]);
    const pixel = offset / 4;
    const x = pixel % CELL_WIDTH;
    const y = Math.floor(pixel / CELL_WIDTH);
    if (x < 2 || x >= CELL_WIDTH - 2 || y < 2 || y >= CELL_HEIGHT - 2) {
      assert.equal(results[0].data[offset + 3], 0);
    }
    if (results[0].data[offset + 3] === 0) {
      assert.deepEqual([...results[0].data.subarray(offset, offset + 3)], [0, 0, 0]);
      assert.deepEqual([...results[1].data.subarray(offset, offset + 3)], [0, 0, 0]);
    }
  }
});

test("SVG materialization rejects wrong dimensions instead of silently shrinking or stretching", async () => {
  for (const [width, height] of [[191, 208], [192, 207], [384, 416]]) {
    await assert.rejects(renderCoverageSpritePixels(svg("", width, height)), /Expected a 1536 × 1664 RGBA coverage raster/);
  }
  for (const supersample of [0, -1, 2.5, 17, NaN, Infinity]) {
    await assert.rejects(renderCoverageSpritePixels(svg(""), { supersample }), RangeError);
  }
  await assert.rejects(renderCoverageSpritePixels(42), TypeError);
});
