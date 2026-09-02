import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VARIANT_NAMES,
  checkFinalVisualReviewReports,
  createFinalVisualReviewReport,
  finalReviewArtifactPaths,
  serializeFinalVisualReview,
  writeFinalVisualReviewReports,
} from "../scripts/seal-final-visual-review.mjs";

const REVIEWED_AT = "2026-08-31T22:30:00.000Z";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function makeFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "codex-pet-final-review-"));
  const artifactPaths = [...new Set(
    VARIANT_NAMES.flatMap((variant) => finalReviewArtifactPaths(variant)),
  )];
  await Promise.all(artifactPaths.map(async (relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `fixture:${relativePath}\n`);
  }));
  return rootDir;
}

test("final visual-review reports use the exact artifact order and explicit shipping and authoring identities", async (t) => {
  const rootDir = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const report = await createFinalVisualReviewReport({
    rootDir,
    variant: "dark",
    reviewedAt: REVIEWED_AT,
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.petId, "grok-bot-dark");
  assert.deepEqual(report.reviewer, {
    kind: "human-guided-agent-visual-audit",
    name: "Codex",
  });
  assert.equal(report.reviewedAt, REVIEWED_AT);
  assert.equal(report.coverage.installedRows.length, 9);
  assert.equal(report.coverage.gazeAngles.length, 16);
  assert.equal(report.coverage.characterStates.length, 39);
  assert.equal(report.coverage.effects.length, 14);
  assert.equal(report.reviewedArtifacts.length, 41);
  assert.deepEqual(
    report.reviewedArtifacts.map((artifact) => artifact.path),
    finalReviewArtifactPaths("dark"),
  );

  const shippingBytes = await readFile(path.join(rootDir, "pet/grok-bot-dark/spritesheet.webp"));
  const authoringBytes = await readFile(path.join(rootDir, "qa/authoring-atlas-dark.webp"));
  assert.equal(report.shippingAtlasSha256, sha256(shippingBytes));
  assert.equal(report.authoringAtlasSha256, sha256(authoringBytes));
  assert.equal(
    serializeFinalVisualReview(report),
    serializeFinalVisualReview(await createFinalVisualReviewReport({
      rootDir,
      variant: "dark",
      reviewedAt: REVIEWED_AT,
    })),
  );
});

test("write and check modes are idempotent and detect stale reviewed artifacts", async (t) => {
  const rootDir = await makeFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await writeFinalVisualReviewReports({ rootDir, reviewedAt: REVIEWED_AT });
  await assert.doesNotReject(checkFinalVisualReviewReports({ rootDir }));

  const darkPath = path.join(rootDir, "qa/final-visual-review-dark.json");
  const first = await readFile(darkPath, "utf8");
  await writeFinalVisualReviewReports({ rootDir, reviewedAt: REVIEWED_AT });
  assert.equal(await readFile(darkPath, "utf8"), first);

  await writeFile(path.join(rootDir, "qa/contact-sheet-dark.png"), "changed\n");
  await assert.rejects(
    checkFinalVisualReviewReports({ rootDir }),
    /final-visual-review-dark\.json is stale or non-canonical/,
  );
});
