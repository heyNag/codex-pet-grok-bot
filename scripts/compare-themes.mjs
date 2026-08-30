import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const darkPath = path.join(root, "pet/grok-bot-dark/spritesheet.webp");
const lightPath = path.join(root, "pet/grok-bot-light/spritesheet.webp");
const reportPath = path.join(root, "qa/theme-parity.json");

const ACCENT_COLORS = Object.freeze({
  coral: "#F9705C",
  blue: "#5B95F0",
  green: "#3FBE86",
  gold: "#F5B13F",
  violet: "#9A72EE",
  teal: "#35C3BD",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const key = (red, green, blue) => `${red},${green},${blue}`;

async function decode(file) {
  const bytes = await readFile(file);
  const decoded = await sharp(bytes, { failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { bytes, pixels: decoded.data, info: decoded.info };
}

const [dark, light] = await Promise.all([decode(darkPath), decode(lightPath)]);
const errors = [];
const warnings = [];

if (dark.info.width !== light.info.width || dark.info.height !== light.info.height || dark.info.channels !== 4 || light.info.channels !== 4) {
  errors.push("theme atlases must decode to equal-sized RGBA images");
}

const accentEntries = Object.entries(ACCENT_COLORS).map(([name, value]) => [name, value, rgb(value)]);
const counts = {
  dark: Object.fromEntries(accentEntries.map(([name]) => [name, 0])),
  light: Object.fromEntries(accentEntries.map(([name]) => [name, 0])),
};
counts.dark.body = 0;
counts.dark.eyes = 0;
counts.light.body = 0;
counts.light.eyes = 0;

const alphaDark = Buffer.alloc(dark.pixels.length / 4);
const alphaLight = Buffer.alloc(light.pixels.length / 4);
let alphaMismatchPixels = 0;
let unclassifiedOpaquePairs = 0;

for (let offset = 0, pixel = 0; offset < dark.pixels.length; offset += 4, pixel += 1) {
  const darkPixel = dark.pixels.subarray(offset, offset + 4);
  const lightPixel = light.pixels.subarray(offset, offset + 4);
  alphaDark[pixel] = darkPixel[3];
  alphaLight[pixel] = lightPixel[3];
  if (darkPixel[3] !== lightPixel[3]) alphaMismatchPixels += 1;
  if (darkPixel[3] === 0 && lightPixel[3] === 0) continue;

  const darkKey = key(darkPixel[0], darkPixel[1], darkPixel[2]);
  const lightKey = key(lightPixel[0], lightPixel[1], lightPixel[2]);
  if (darkKey === "255,255,255") counts.dark.body += 1;
  if (darkKey === "0,0,0") counts.dark.eyes += 1;
  if (lightKey === "0,0,0") counts.light.body += 1;
  if (lightKey === "255,255,255") counts.light.eyes += 1;
  for (const [name, , accentRgb] of accentEntries) {
    const accentKey = key(...accentRgb);
    if (darkKey === accentKey) counts.dark[name] += 1;
    if (lightKey === accentKey) counts.light[name] += 1;
  }

  if (darkPixel[3] === 255 && lightPixel[3] === 255) {
    const sameAccent = accentEntries.some(([, , accentRgb]) => darkKey === key(...accentRgb) && lightKey === darkKey);
    const darkGray = darkPixel[0] === darkPixel[1] && darkPixel[1] === darkPixel[2];
    const lightGray = lightPixel[0] === lightPixel[1] && lightPixel[1] === lightPixel[2];
    const inverseMonochrome = darkGray && lightGray && darkPixel[0] + lightPixel[0] === 255;
    if (!sameAccent && !inverseMonochrome) unclassifiedOpaquePairs += 1;
  }
}

if (alphaMismatchPixels !== 0) errors.push(`${alphaMismatchPixels} pixels differ between the theme alpha masks`);
for (const variant of ["dark", "light"]) {
  if (counts[variant].body < 10_000) errors.push(`${variant} atlas is missing a substantial exact body-color region`);
  if (counts[variant].eyes < 1_000) errors.push(`${variant} atlas is missing substantial exact opposite-color eye/effect ink`);
  for (const [name] of accentEntries) {
    if (counts[variant][name] === 0) errors.push(`${variant} atlas does not contain exact accent ${name}`);
  }
}
if (unclassifiedOpaquePairs > 0) {
  warnings.push(`${unclassifiedOpaquePairs} fully opaque overlapping pixels are composited colors rather than direct monochrome inversions or exact accents`);
}

const report = {
  schemaVersion: 1,
  ok: errors.length === 0,
  darkAtlasSha256: sha256(dark.bytes),
  lightAtlasSha256: sha256(light.bytes),
  dimensions: { width: dark.info.width, height: dark.info.height, channels: dark.info.channels },
  alphaMaskSha256: { dark: sha256(alphaDark), light: sha256(alphaLight) },
  alphaMismatchPixels,
  unclassifiedOpaquePairs,
  exactAccentColorPixels: counts,
  accentColors: ACCENT_COLORS,
  errors,
  warnings,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`${report.ok ? "PASS" : "FAIL"}: theme parity, ${alphaMismatchPixels} alpha mismatches, ${warnings.length} informational warning(s)`);
if (!report.ok) process.exitCode = 1;
