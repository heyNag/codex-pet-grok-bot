import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  verifyRecordedInputHashes,
  writeExhaustiveArtifactsAtomically,
} from "../scripts/exhaustive-edge-qa.mjs";
import { verifyExhaustiveStructuralCssFileHashes } from "../scripts/qa-evidence.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function makeFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "codex-pet-qa-freshness-"));
  await mkdir(path.join(rootDir, "preview"), { recursive: true });
  await mkdir(path.join(rootDir, "pet", "fixture"), { recursive: true });
  await mkdir(path.join(rootDir, "qa"), { recursive: true });

  const css = Buffer.from(".pet { image-rendering: pixelated; }\n");
  const index = Buffer.from("<!doctype html><title>fixture</title>\n");
  const app = Buffer.from("export const version = 1;\n");
  const atlas = Buffer.from("fixture atlas\n");
  await writeFile(path.join(rootDir, "preview", "styles.css"), css);
  await writeFile(path.join(rootDir, "preview", "index.html"), index);
  await writeFile(path.join(rootDir, "preview", "app.mjs"), app);
  await writeFile(path.join(rootDir, "pet", "fixture", "spritesheet.webp"), atlas);
  await writeFile(path.join(rootDir, "qa", "exhaustive-edge-qa.json"), "old report\n");
  await writeFile(path.join(rootDir, "qa", "exhaustive-edge-worst-cases.png"), "old image\n");

  const report = {
    decoderValidation: {
      assets: [{
        path: "pet/fixture/spritesheet.webp",
        encodedSha256: sha256(atlas),
      }],
    },
    structuralCss: {
      files: {
        "preview/styles.css": { sha256: sha256(css) },
        "preview/index.html": { sha256: sha256(index) },
        "preview/app.mjs": { sha256: sha256(app) },
      },
    },
  };
  return { rootDir, report };
}

test("exhaustive output transaction rejects a post-build input change without touching outputs", async (t) => {
  const { rootDir, report } = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  assert.equal((await verifyRecordedInputHashes(report, { rootDir })).length, 4);
  await writeFile(path.join(rootDir, "preview", "app.mjs"), "export const version = 2;\n");

  await assert.rejects(
    writeExhaustiveArtifactsAtomically({
      rootDir,
      report,
      serializedReport: "new report\n",
      reviewImage: Buffer.from("new image\n"),
    }),
    /preview\/app\.mjs changed while exhaustive QA was running/u,
  );
  assert.equal(
    await readFile(path.join(rootDir, "qa", "exhaustive-edge-qa.json"), "utf8"),
    "old report\n",
  );
  assert.equal(
    await readFile(path.join(rootDir, "qa", "exhaustive-edge-worst-cases.png"), "utf8"),
    "old image\n",
  );
});

test("exhaustive output transaction rolls both replacements back when an input changes before final verification", async (t) => {
  const { rootDir, report } = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(
    writeExhaustiveArtifactsAtomically({
      rootDir,
      report,
      serializedReport: "new report\n",
      reviewImage: Buffer.from("new image\n"),
      beforeFinalInputVerification: async () => {
        assert.equal(
          await readFile(path.join(rootDir, "qa", "exhaustive-edge-qa.json"), "utf8"),
          "new report\n",
        );
        assert.equal(
          await readFile(path.join(rootDir, "qa", "exhaustive-edge-worst-cases.png"), "utf8"),
          "new image\n",
        );
        await writeFile(path.join(rootDir, "preview", "app.mjs"), "export const version = 2;\n");
      },
    }),
    /preview\/app\.mjs changed while exhaustive QA was running/u,
  );
  assert.equal(
    await readFile(path.join(rootDir, "qa", "exhaustive-edge-qa.json"), "utf8"),
    "old report\n",
  );
  assert.equal(
    await readFile(path.join(rootDir, "qa", "exhaustive-edge-worst-cases.png"), "utf8"),
    "old image\n",
  );
});

test("evidence verification independently binds every structural CSS record to current bytes", async (t) => {
  const { rootDir, report } = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  assert.equal(
    (await verifyExhaustiveStructuralCssFileHashes(report, { rootDir })).length,
    3,
  );
  await writeFile(path.join(rootDir, "preview", "app.mjs"), "export const version = 2;\n");
  await assert.rejects(
    verifyExhaustiveStructuralCssFileHashes(report, { rootDir }),
    /exhaustive edge QA structural CSS SHA is stale for preview\/app\.mjs/u,
  );
});

test("evidence verification rejects missing or extra structural CSS file records", async (t) => {
  const { rootDir, report } = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const missing = structuredClone(report);
  delete missing.structuralCss.files["preview/app.mjs"];
  await assert.rejects(
    verifyExhaustiveStructuralCssFileHashes(missing, { rootDir }),
    /structural CSS file set must be exactly preview\/styles\.css, preview\/index\.html, preview\/app\.mjs/u,
  );

  const extraBytes = Buffer.from("extra\n");
  await writeFile(path.join(rootDir, "preview", "extra.css"), extraBytes);
  const extra = structuredClone(report);
  extra.structuralCss.files["preview/extra.css"] = { sha256: sha256(extraBytes) };
  await assert.rejects(
    verifyExhaustiveStructuralCssFileHashes(extra, { rootDir }),
    /structural CSS file set must be exactly preview\/styles\.css, preview\/index\.html, preview\/app\.mjs/u,
  );
});
