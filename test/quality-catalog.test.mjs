import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  QUALITY_CHECKPOINT_CONTRACT,
  qualityCheckpointFrameHashSeal,
  qualityCheckpointFrameHashes,
  qualityCheckpointTimeline,
} from "../scripts/quality-checkpoint.mjs";
import { QUALITY_SOURCE_PATHS, qualitySourceHashes, sha256, writeQualityCatalog } from "../scripts/quality-catalog.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-quality-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "generated");
  await mkdir(output);
  async function put(file, contents) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  for (const file of QUALITY_SOURCE_PATHS) await put(file, file);
  const hashes = await qualitySourceHashes(root);
  for (const theme of ["dark", "light"]) {
    const checkpoint = Buffer.from(`checkpoint:${theme}`);
    for (const id of ["checkpoint", "control-60"]) {
      const bytes = id === "checkpoint" ? checkpoint : Buffer.from(`candidate:${theme}`);
      await put(`generated/${id}-${theme}.webp`, bytes);
      const frameCount = id === "checkpoint" ? QUALITY_CHECKPOINT_CONTRACT.frames : 1;
      for (let frame = 0; frame < frameCount; frame += 1) await put(`generated/${id}-${theme}/${frame}.webp`, bytes);
      if (id === "checkpoint") {
        const timeline = qualityCheckpointTimeline();
        const decodedFrameHashes = qualityCheckpointFrameHashes(theme);
        await put(`generated/${id}-${theme}.json`, JSON.stringify({
          ...QUALITY_CHECKPOINT_CONTRACT, theme,
          delays: timeline.map(({ durationMs }) => durationMs), timeline,
          bytes: bytes.length, sha256: sha256(bytes), decodedFrameHashes,
          decodedFrameHashSeal: qualityCheckpointFrameHashSeal(decodedFrameHashes),
        }));
      } else {
        await put(`generated/${id}-${theme}.json`, JSON.stringify({
          id, theme, label: id, frames: 1, delays: [990], loopMs: 990,
          bytes: bytes.length, sha256: sha256(bytes), sourceHashes: hashes,
          checkpointSha256: sha256(checkpoint),
          checkpointDecodedFrameHashSeal: qualityCheckpointFrameHashSeal(qualityCheckpointFrameHashes(theme)),
        }));
      }
    }
  }
  return { root, output, put };
}

test("catalog includes only complete matching candidates and checkpoint", async (t) => {
  const { root, output } = await fixture(t);
  const result = await writeQualityCatalog(root, output);
  assert.deepEqual(result.included, ["checkpoint", "control-60"]);
  assert.equal(result.omitted.length, 2);
  assert.match(await readFile(path.join(output, "catalog.mjs"), "utf8"), /^export default /);
});

test("a changed generator binding hides the candidate rather than mixing revisions", async (t) => {
  const { root, output, put } = await fixture(t);
  await put("scripts/build-quality-lab.mjs", "changed-generator");
  const result = await writeQualityCatalog(root, output);
  assert.deepEqual(result.included, ["checkpoint"]);
  assert.match(result.omitted.find(({ id }) => id === "control-60").reason, /Stale source binding/);
});

test("changed encoded assets or missing inspection pages are not advertised", async (t) => {
  const { root, output, put } = await fixture(t);
  await put("generated/control-60-dark.webp", "corrupt");
  assert.deepEqual((await writeQualityCatalog(root, output)).included, ["checkpoint"]);
  await put("generated/control-60-dark.webp", "candidate:dark");
  await rm(path.join(output, "control-60-light/0.webp"));
  assert.deepEqual((await writeQualityCatalog(root, output)).included, ["checkpoint"]);
});

test("shipping assets are not the frozen comparison source", async (t) => {
  const { root, output, put } = await fixture(t);
  await put("pet/grok-bot-dark/spritesheet.webp", "new-shipping-atlas");
  await put("pet/grok-bot-light/spritesheet.webp", "another-shipping-atlas");
  assert.deepEqual((await writeQualityCatalog(root, output)).included, ["checkpoint", "control-60"]);
});

test("a changed frozen decoded frame seal invalidates the whole comparison", async (t) => {
  const { root, output, put } = await fixture(t);
  const file = "generated/checkpoint-dark.json";
  const manifest = JSON.parse(await readFile(path.join(root, file), "utf8"));
  manifest.decodedFrameHashes[0] = sha256("changed-frame");
  await put(file, JSON.stringify(manifest));
  assert.deepEqual((await writeQualityCatalog(root, output)).included, []);
});
