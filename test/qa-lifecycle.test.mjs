import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

const EXPECTED_PREPARE_STEPS = Object.freeze([
  "npm run build",
  "npm run validate",
  "npm run qa:animated",
  "npm run qa:animated:check",
  "npm run qa:phases:check",
  "npm run qa:exhaustive",
  "npm run qa:exhaustive:check",
  "npm run qa:themes",
  "npm run qa:edges",
  "npm run qa:runtime",
  "npm run qa:source-motion",
  "npm run qa:blind:check",
  "npm run qa:official",
  "npm test",
]);

const AUTOMATIC_REPOSITORY_WRITERS = Object.freeze([
  "npm run build",
  "npm run validate",
  "npm run qa:animated",
  "npm run qa:exhaustive",
  "npm run qa:themes",
  "npm run qa:runtime",
  "npm run qa:source-motion",
]);

const REVIEW_SENSITIVE_REPOSITORY_WRITERS = Object.freeze([
  "npm run build:source-motion",
  "npm run qa:review",
]);

function steps(scriptName) {
  const command = packageJson.scripts?.[scriptName];
  assert.equal(typeof command, "string", `package script ${scriptName} must exist`);
  return command.split(" && ");
}

test("QA preparation owns the complete deterministic generator and check chain", () => {
  const prepareSteps = steps("qa:prepare");
  assert.deepEqual(prepareSteps, EXPECTED_PREPARE_STEPS);
  assert.equal(prepareSteps.at(-1), "npm test");

  for (const writer of AUTOMATIC_REPOSITORY_WRITERS) {
    assert.equal(
      prepareSteps.filter((step) => step === writer).length,
      1,
      `${writer} must occur exactly once in qa:prepare`,
    );
  }
});

test("QA verification and sealing share an immutable review-and-evidence suffix", () => {
  const qaSteps = steps("qa");
  const sealSteps = steps("qa:seal");
  const sharedPrefix = ["npm run qa:prepare", "npm run qa:review:check"];

  assert.deepEqual(qaSteps, [...sharedPrefix, "npm run qa:evidence"]);
  assert.deepEqual(sealSteps, [...sharedPrefix, "node scripts/qa-evidence.mjs --seal"]);
  assert.equal(qaSteps.at(-2), "npm run qa:review:check");
  assert.equal(qaSteps.at(-1), "npm run qa:evidence");
  assert.equal(sealSteps.at(-2), "npm run qa:review:check");
  assert.equal(sealSteps.at(-1), "node scripts/qa-evidence.mjs --seal");

  for (const writer of AUTOMATIC_REPOSITORY_WRITERS) {
    assert.equal(qaSteps.includes(writer), false, `${writer} must be delegated to qa:prepare`);
    assert.equal(sealSteps.includes(writer), false, `${writer} must be delegated to qa:prepare`);
  }

  for (const writer of REVIEW_SENSITIVE_REPOSITORY_WRITERS) {
    assert.equal(
      steps("qa:prepare").includes(writer),
      false,
      `${writer} must remain an explicit maintainer action outside automatic preparation`,
    );
    assert.equal(qaSteps.includes(writer), false, `${writer} must not run during ordinary verification`);
    assert.equal(sealSteps.includes(writer), false, `${writer} must not run while sealing evidence`);
  }
});
