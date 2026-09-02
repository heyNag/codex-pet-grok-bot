import sharp from "sharp";
import { THEME_PALETTES } from "./grok-art.mjs";
import { CELL_HEIGHT, CELL_WIDTH } from "./spec.mjs";

export const COVERAGE_SUPERSAMPLE = 8;

const EXACT_ACCENT_RGB = Object.values(THEME_PALETTES["dark-codex"])
  .filter((color) => color !== "#000000" && color !== "#FFFFFF")
  .map((color) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)));

function validateSupersample(supersample) {
  if (!Number.isSafeInteger(supersample) || supersample < 1) {
    throw new RangeError("Coverage supersample must be a positive integer");
  }
}

/**
 * Reduce straight-alpha RGBA with an integer-area box filter. Accumulation is
 * premultiplied, but the returned bytes are straight-alpha RGBA. The input is
 * never mutated. No sharpening lobes can add coverage outside a source block.
 */
export function reducePremultipliedAreaRgba(pixels, { width, height, channels = 4 }, supersample) {
  validateSupersample(supersample);
  if (!Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(height) || height < 1
    || channels !== 4 || !Number.isSafeInteger(width * height * 4)) {
    throw new RangeError("Coverage raster must have positive integer dimensions and four RGBA channels");
  }
  if (width % supersample !== 0 || height % supersample !== 0) {
    throw new RangeError("Coverage raster dimensions must be divisible by the supersample");
  }
  if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
    throw new TypeError("Coverage raster must contain exactly width × height × 4 RGBA bytes");
  }
  const outputWidth = width / supersample;
  const outputHeight = height / supersample;
  const data = Buffer.alloc(outputWidth * outputHeight * 4);
  const sampleCount = supersample * supersample;
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let alpha = 0;
      let redAlpha = 0;
      let greenAlpha = 0;
      let blueAlpha = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        let offset = ((y * supersample + sy) * width + x * supersample) * 4;
        for (let sx = 0; sx < supersample; sx += 1, offset += 4) {
          const coverage = pixels[offset + 3];
          alpha += coverage;
          redAlpha += pixels[offset] * coverage;
          greenAlpha += pixels[offset + 1] * coverage;
          blueAlpha += pixels[offset + 2] * coverage;
        }
      }
      const outputOffset = (y * outputWidth + x) * 4;
      const outputAlpha = Math.round(alpha / sampleCount);
      if (outputAlpha === 0) continue;
      data[outputOffset + 3] = outputAlpha;
      // Use unrounded coverage here. Dividing by quantized outputAlpha would
      // darken low-coverage white edges and tint partially transparent accents.
      data[outputOffset] = Math.round(redAlpha / alpha);
      data[outputOffset + 1] = Math.round(greenAlpha / alpha);
      data[outputOffset + 2] = Math.round(blueAlpha / alpha);
    }
  }
  return { data, info: { width: outputWidth, height: outputHeight, channels: 4 } };
}

/** Render the existing sprite SVG without changing its geometry or expression. */
export async function renderCoverageSpritePixels(svg, { supersample = COVERAGE_SUPERSAMPLE } = {}) {
  validateSupersample(supersample);
  if (supersample > 16) throw new RangeError("Sprite coverage supersample must not exceed 16");
  if (typeof svg !== "string" && !(svg instanceof Uint8Array)) {
    throw new TypeError("Sprite coverage input must be SVG text or bytes");
  }
  // This raw-buffer boundary is intentional. Resizing in the same pipeline
  // lets SVG shrink-on-load bypass high-density rasterization entirely.
  const raster = await sharp(Buffer.from(svg), { density: 72 * supersample })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (raster.info.width !== CELL_WIDTH * supersample
    || raster.info.height !== CELL_HEIGHT * supersample || raster.info.channels !== 4) {
    throw new RangeError(`Expected a ${CELL_WIDTH * supersample} × ${CELL_HEIGHT * supersample} RGBA coverage raster; got ${raster.info.width} × ${raster.info.height} × ${raster.info.channels}`);
  }
  const reduced = reducePremultipliedAreaRgba(raster.data, raster.info, supersample);
  for (let offset = 0; offset < reduced.data.length; offset += 4) {
    if (reduced.data[offset + 3] === 0) continue;
    // Match the palette's exact solid accents after rasterizer quantization.
    // Genuine gradient and mixed-material colors remain untouched.
    for (const [red, green, blue] of EXACT_ACCENT_RGB) {
      if (Math.abs(reduced.data[offset] - red) <= 1
        && Math.abs(reduced.data[offset + 1] - green) <= 1
        && Math.abs(reduced.data[offset + 2] - blue) <= 1) {
        reduced.data[offset] = red;
        reduced.data[offset + 1] = green;
        reduced.data[offset + 2] = blue;
        break;
      }
    }
  }
  return sharp(reduced.data, { raw: reduced.info })
    .png({ compressionLevel: 9, palette: false }).toBuffer();
}
