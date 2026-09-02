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
  SHOWCASE_SCENES,
  SHOWCASE_SEQUENCE,
  SHOWCASE_SOURCE_DELAYS_MS,
  SHOWCASE_SOURCE_FRAME_COUNT,
  SHOWCASE_SOURCE_LOOP_MS,
  SHOWCASE_WIDTH,
} from "../scripts/build-readme-showcase.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("the README showcase is current and contains the smooth two-theme loop", async () => {
  const [committed, manifest] = await Promise.all([
    readFile(SHOWCASE_PATH),
    readFile(SHOWCASE_MANIFEST_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.schemaVersion, 3);
  assert.equal(sha256(committed), manifest.output.sha256);
  assert.deepEqual(Object.keys(manifest.inputs).sort(), ["dark", "light"]);

  const expectedSourceDelays = SHOWCASE_SOURCE_DELAYS_MS;
  for (const input of Object.values(manifest.inputs)) {
    const absolute = path.resolve(path.dirname(SHOWCASE_PATH), "..", input.path);
    const bytes = await readFile(absolute);
    assert.equal(sha256(bytes), input.sha256, `${input.path} changed without refreshing the README showcase`);

    const metadata = await sharp(bytes, { animated: true }).metadata();
    assert.equal(metadata.width, input.width);
    assert.equal(metadata.pageHeight, input.height);
    assert.equal(metadata.pages, SHOWCASE_SOURCE_FRAME_COUNT);
    assert.equal(metadata.pages, input.frames);
    assert.equal(metadata.loop, 0);
    assert.equal(metadata.loop, input.loop);
    assert.deepEqual(metadata.delay, expectedSourceDelays);
    assert.deepEqual(metadata.delay, input.delays);
  }

  const metadata = await sharp(committed, { animated: true }).metadata();
  const expectedDelays = SHOWCASE_SEQUENCE.map((frame) => frame.delay);
  assert.equal(metadata.width, SHOWCASE_WIDTH);
  assert.equal(metadata.pageHeight, SHOWCASE_HEIGHT);
  assert.equal(metadata.pages, SHOWCASE_SEQUENCE.length);
  assert.equal(metadata.loop, 0);
  assert.deepEqual(metadata.delay, expectedDelays);

  const serializedSequence = SHOWCASE_SEQUENCE.map((frame) => ({
    scene: frame.scene,
    sourceFrame: frame.sourceFrame,
    row: frame.row,
    column: frame.column,
    ...(Number.isInteger(frame.gazeSector) ? { gazeSector: frame.gazeSector } : {}),
  }));
  assert.deepEqual(manifest.showcase, {
    sourceFramesPerScene: SHOWCASE_SOURCE_FRAME_COUNT,
    sourceLoopMsPerScene: SHOWCASE_SOURCE_LOOP_MS,
    sourceDelaysMsPerScene: SHOWCASE_SOURCE_DELAYS_MS,
    scenes: SHOWCASE_SCENES.map((scene) => scene.id),
    sequenceSha256: sha256(Buffer.from(JSON.stringify(serializedSequence))),
  });
  assert.deepEqual(manifest.output, {
    path: "preview/readme-showcase.webp",
    sha256: sha256(committed),
    width: SHOWCASE_WIDTH,
    height: SHOWCASE_HEIGHT,
    frames: SHOWCASE_SEQUENCE.length,
    durationMs: expectedDelays.reduce((total, delay) => total + delay, 0),
    loop: 0,
    delays: expectedDelays,
  });
});

test("the showcase samples every shipping page and all gaze sectors", () => {
  for (const scene of SHOWCASE_SCENES) {
    const frames = SHOWCASE_SEQUENCE.filter((frame) => frame.scene === scene.id);
    assert.equal(frames.length, SHOWCASE_SOURCE_FRAME_COUNT);
    assert.deepEqual(
      frames.map((frame) => frame.sourceFrame),
      Array.from({ length: SHOWCASE_SOURCE_FRAME_COUNT }, (_, index) => index),
    );
    assert.deepEqual(frames.map((frame) => frame.delay), SHOWCASE_SOURCE_DELAYS_MS);
    assert.equal(
      frames.reduce((durationMs, frame) => durationMs + frame.delay, 0),
      SHOWCASE_SOURCE_LOOP_MS,
    );
  }

  const gazeFrames = SHOWCASE_SEQUENCE.filter((frame) => frame.scene === "gaze");
  assert.deepEqual(
    [...new Set(gazeFrames.map((frame) => frame.gazeSector))],
    Array.from({ length: 16 }, (_, index) => index),
  );
  assert.ok(gazeFrames.every((frame) => (
    frame.row === (frame.gazeSector < 8 ? 9 : 10)
      && frame.column === frame.gazeSector % 8
  )));
});
