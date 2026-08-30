import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validatePet } from "../scripts/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, ".tmp", "validator-tests");

async function fixture(context, prefix, variant = "dark") {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureRoot, prefix));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const petDir = path.join(directory, "pet", `grok-bot-${variant}`);
  await mkdir(petDir, { recursive: true });
  await copyFile(path.join(root, `pet/grok-bot-${variant}/spritesheet.webp`), path.join(petDir, "spritesheet.webp"));
  await copyFile(path.join(root, `pet/grok-bot-${variant}/pet.json`), path.join(petDir, "pet.json"));
  return { directory, petDir, variant };
}

test("validator rejects a manifest path that escapes the pet directory", async (context) => {
  const { directory, petDir } = await fixture(context, "manifest-");
  const manifest = JSON.parse(await readFile(path.join(petDir, "pet.json"), "utf8"));
  manifest.spritesheetPath = "../spritesheet.webp";
  await writeFile(path.join(petDir, "pet.json"), `${JSON.stringify(manifest)}\n`);

  const report = await validatePet({ root: directory, variant: "dark", writeReport: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("spritesheetPath must resolve")));
});

test("validator rejects visible art in an unused atlas cell", async (context) => {
  const { directory, petDir } = await fixture(context, "unused-cell-");
  const atlasPath = path.join(petDir, "spritesheet.webp");
  const original = await readFile(atlasPath);
  const marker = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="#ff00ff"/></svg>');
  await sharp(original)
    .composite([{ input: marker, left: 7 * 192 + 12, top: 12 }])
    .webp({ alphaQuality: 100, effort: 6, lossless: true, quality: 100 })
    .toFile(atlasPath);

  const report = await validatePet({ root: directory, variant: "dark", writeReport: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.includes("unused cell r0c7 is not transparent"));
});

test("validator rejects a light manifest that reuses the dark pet ID", async (context) => {
  const { directory, petDir } = await fixture(context, "duplicate-id-", "light");
  const manifest = JSON.parse(await readFile(path.join(petDir, "pet.json"), "utf8"));
  manifest.id = "grok-bot-dark";
  await writeFile(path.join(petDir, "pet.json"), `${JSON.stringify(manifest)}\n`);

  const report = await validatePet({ root: directory, variant: "light", writeReport: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('pet.json id must be "grok-bot-light"'));
});
