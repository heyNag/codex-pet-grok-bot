import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  SHOWCASE_HEIGHT,
  SHOWCASE_MANIFEST_PATH,
  SHOWCASE_PATH,
  SHOWCASE_SEQUENCE,
  SHOWCASE_WIDTH,
} from "../scripts/build-readme-showcase.mjs";

test("the README showcase is current and contains the full two-theme loop", async () => {
  const [committed, manifest] = await Promise.all([
    readFile(SHOWCASE_PATH),
    readFile(SHOWCASE_MANIFEST_PATH, "utf8").then(JSON.parse),
  ]);
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(sha256(committed), manifest.output.sha256);
  for (const input of Object.values(manifest.inputs)) {
    const absolute = path.resolve(path.dirname(SHOWCASE_PATH), "..", input.path);
    assert.equal(sha256(await readFile(absolute)), input.sha256, `${input.path} changed without refreshing the README showcase`);
  }

  const metadata = await sharp(committed, { animated: true }).metadata();
  assert.equal(metadata.width, SHOWCASE_WIDTH);
  assert.equal(metadata.pageHeight, SHOWCASE_HEIGHT);
  assert.equal(metadata.pages, SHOWCASE_SEQUENCE.length);
  assert.equal(metadata.loop, 0);
  assert.deepEqual(metadata.delay, SHOWCASE_SEQUENCE.map((frame) => frame.delay));
  assert.deepEqual(manifest.output, {
    path: "preview/readme-showcase.webp",
    sha256: sha256(committed),
    width: SHOWCASE_WIDTH,
    height: SHOWCASE_HEIGHT,
    frames: SHOWCASE_SEQUENCE.length,
    loop: 0,
    delays: SHOWCASE_SEQUENCE.map((frame) => frame.delay),
  });
});
