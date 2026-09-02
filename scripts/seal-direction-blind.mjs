#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkMode = process.argv.slice(2).includes("--check");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--check");

if (unknown.length > 0) {
  throw new Error("Usage: node scripts/seal-direction-blind.mjs [--check]");
}

const stimulusPath = "qa/direction-blind-pairs.png";
const answerKeyPath = "qa/direction-blind-answer-key.json";
const consensusPath = "qa/direction-blind-consensus.json";
const validationPath = "qa/direction-blind-validation.json";
const verdictPaths = Array.from(
  { length: 5 },
  (_, index) => `qa/direction-blind-verdict-${index + 1}.json`,
);

const stimulusSha256 = sha256(await readFile(absolute(stimulusPath)));
const answerKeyBytes = await readFile(absolute(answerKeyPath));
const answerKey = JSON.parse(answerKeyBytes.toString("utf8"));
const verdicts = await Promise.all(verdictPaths.map(async (verdictPath) => {
  const bytes = await readFile(absolute(verdictPath));
  const report = JSON.parse(bytes.toString("utf8"));
  requireCondition(
    report.stimulusSha256 === stimulusSha256,
    `${verdictPath} is for a different stimulus`,
  );
  return { path: verdictPath, sha256: sha256(bytes), report };
}));

const pairIds = answerKey.pairs.map((pair) => pair.pair);
const consensusPairs = pairIds.map((pairId) => {
  const pair = { pair: pairId };
  const votes = {};
  for (const slot of ["A", "B"]) {
    const counts = {};
    for (const verdict of verdicts) {
      const value = verdict.report.pairs.find((entry) => entry.pair === pairId)?.[slot];
      requireCondition(typeof value === "string", `${verdict.path} does not classify ${pairId} ${slot}`);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    const ranked = Object.entries(counts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    requireCondition(ranked[0][1] >= 3, `${pairId} ${slot} has no strict majority`);
    pair[slot] = ranked[0][0];
    votes[slot] = counts;
  }
  pair.reason = "strict majority of independent blind reviews";
  pair.votes = votes;
  return pair;
});

const consensus = {
  schemaVersion: 1,
  stimulusSha256,
  reviewerCount: verdicts.length,
  method: "Strict per-cell majority across five independently produced blind verdicts.",
  sourceVerdicts: verdicts.map(({ path: verdictPath, sha256: verdictSha }) => ({
    path: verdictPath,
    sha256: verdictSha,
  })),
  pairs: consensusPairs,
};
const consensusBytes = Buffer.from(`${JSON.stringify(consensus, null, 2)}\n`, "utf8");

const consensusByPair = new Map(consensusPairs.map((pair) => [pair.pair, pair]));
const validationPairs = answerKey.pairs.map((expected) => {
  const observed = consensusByPair.get(expected.pair);
  return {
    pair: expected.pair,
    axis: expected.axis,
    gate: expected.gate,
    A: classification(observed.A, expected.A),
    B: classification(observed.B, expected.B),
  };
});
const failures = validationPairs.flatMap((pair) => ["A", "B"].flatMap((slot) => (
  pair[slot].pass
    ? []
    : [`${pair.pair} ${slot} classified ${pair[slot].observed}; expected ${pair[slot].expected}`]
)));
requireCondition(failures.length === 0, failures.join("\n"));

const validation = {
  schemaVersion: 1,
  stimulusSha256,
  inputs: {
    answerKey: { path: answerKeyPath, sha256: sha256(answerKeyBytes) },
    consensus: { path: consensusPath, sha256: sha256(consensusBytes) },
  },
  ok: true,
  errors: [],
  warnings: [],
  unconfirmed: [],
  reviewRequired: false,
  pairs: validationPairs,
};
const validationBytes = Buffer.from(`${JSON.stringify(validation, null, 2)}\n`, "utf8");

if (checkMode) {
  requireCondition(
    (await readFile(absolute(consensusPath))).equals(consensusBytes),
    `${consensusPath} is stale`,
  );
  requireCondition(
    (await readFile(absolute(validationPath))).equals(validationBytes),
    `${validationPath} is stale`,
  );
  console.log("PASS: blind direction consensus and validation are current");
} else {
  await writeFile(absolute(consensusPath), consensusBytes);
  await writeFile(absolute(validationPath), validationBytes);
  console.log(`sealed ${verdicts.length} blind reviews with ${validationPairs.length} passing pairs`);
}

function classification(observed, expected) {
  return {
    observed,
    expected: expected.expected_direction,
    source_direction: expected.source_direction,
    pass: observed === expected.expected_direction,
  };
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
