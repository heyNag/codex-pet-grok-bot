import sharp from "sharp";
import { CELL_HEIGHT, CELL_WIDTH } from "./spec.mjs";

export const SPRITE_RENDER_DENSITY = 384;
const EXACT_ACCENT_RGB = Object.freeze([
  [249, 112, 92], [91, 149, 240], [63, 190, 134],
  [245, 177, 63], [154, 114, 238], [53, 195, 189],
]);

export async function renderSpritePixels(svg) {
  const raster = await sharp(svg, { density: SPRITE_RENDER_DENSITY })
    .resize(CELL_WIDTH, CELL_HEIGHT, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(raster.data);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) {
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      continue;
    }
    for (const [red, green, blue] of EXACT_ACCENT_RGB) {
      if (Math.abs(pixels[offset] - red) <= 1
        && Math.abs(pixels[offset + 1] - green) <= 1
        && Math.abs(pixels[offset + 2] - blue) <= 1) {
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blue;
        break;
      }
    }
  }
  return sharp(pixels, { raw: raster.info }).png({ compressionLevel: 9, palette: false }).toBuffer();
}
