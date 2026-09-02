import { createHash } from "node:crypto";

const ROW_COUNTS = Object.freeze([6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
const PATH_IDS = Object.freeze(["source", "codexDefaultDpr2"]);
const THEMES = Object.freeze(["dark", "light"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PHASE_COUNT = 60;

const CELLS = Object.freeze(
  ROW_COUNTS.flatMap((count, row) => (
    Array.from({ length: count }, (_, column) => Object.freeze([row, column]))
  )),
);
const TIMED_CELLS = Object.freeze(CELLS.filter(([row]) => row < 9));
const GAZES = Object.freeze(
  [9, 10].flatMap((row) => (
    Array.from({ length: 8 }, (_, column) => Object.freeze([row, column]))
  )),
);
const GAZE_INDEX = new Map(GAZES.map((cell, index) => [cell.join(","), index]));

function familyDefinitions() {
  const timedCellAdvance = TIMED_CELLS.map(([row, column]) => (
    [[row, column], [row, (column + 1) % ROW_COUNTS[row]]]
  ));
  const timedEffectiveReset = [
    ...TIMED_CELLS.flatMap((left) => (
      Array.from({ length: 9 }, (_, rightRow) => rightRow)
        .filter((rightRow) => left[0] !== rightRow)
        .map((rightRow) => [left, [rightRow, 0]])
    )),
    ...Array.from({ length: ROW_COUNTS[0] - 2 }, (_, index) => (
      [[0, index + 1], [0, 0]]
    )),
  ];
  return {
    timedCellAdvance,
    timedEffectiveReset,
    timedToGaze: TIMED_CELLS.flatMap((left) => GAZES.map((right) => [left, right])),
    gazeToTimed: GAZES.flatMap((left) => (
      Array.from({ length: 9 }, (_, rightRow) => [left, [rightRow, 0]])
    )),
    adjacentGaze: GAZES.flatMap((left) => GAZES
      .filter((right) => {
        const delta = (GAZE_INDEX.get(left.join(",")) - GAZE_INDEX.get(right.join(",")) + 16) % 16;
        return delta === 1 || delta === 15;
      })
      .map((right) => [left, right])),
    nonNeighborGaze: GAZES.flatMap((left) => GAZES
      .filter((right) => {
        const delta = (GAZE_INDEX.get(left.join(",")) - GAZE_INDEX.get(right.join(",")) + 16) % 16;
        return ![0, 1, 15].includes(delta);
      })
      .map((right) => [left, right])),
  };
}

const FAMILY_DEFINITIONS = Object.freeze(familyDefinitions());

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireIntegrity(condition, message) {
  if (!condition) throw new Error(`arbitrary-phase trace integrity: ${message}`);
}

function requireDigest(value, label) {
  requireIntegrity(typeof value === "string" && SHA256_PATTERN.test(value), `${label} is not a SHA-256 digest`);
  return value;
}

function digestOfDigests(digests, label) {
  const trace = createHash("sha256");
  for (const [index, digest] of digests.entries()) {
    trace.update(Buffer.from(requireDigest(digest, `${label}[${index}]`), "hex"));
  }
  return trace.digest("hex");
}

function profileTrace(identifiers, profiles, label) {
  requireIntegrity(profiles.length === identifiers.length, `${label} profile count changed`);
  const trace = createHash("sha256");
  for (let index = 0; index < identifiers.length; index += 1) {
    const profile = profiles[index];
    requireIntegrity(Array.isArray(profile), `${label}[${index}] profile is missing`);
    requireIntegrity(profile.every(Number.isFinite), `${label}[${index}] profile contains a non-finite value`);
    trace.update(`${identifiers[index]}|${profile.map((value) => value.toFixed(9)).join("|")}\n`);
  }
  return trace.digest("hex");
}

function cellId([row, column]) {
  return `r${row}c${column}`;
}

function edgeId([left, right]) {
  return `${cellId(left)}->${cellId(right)}`;
}

function graphTraceSha256() {
  const trace = createHash("sha256");
  for (const [family, edges] of Object.entries(FAMILY_DEFINITIONS)) {
    for (const edge of edges) trace.update(`${family}|${edgeId(edge)}\n`);
  }
  return trace.digest("hex");
}

function requireEqualDigest(actual, expected, label) {
  requireDigest(actual, label);
  requireIntegrity(actual === expected, `${label} does not match the sealed per-item baseline`);
}

export function verifyArbitraryPhaseTraceIntegrity({ report, baseline }) {
  requireIntegrity(report && typeof report === "object", "report is missing");
  requireIntegrity(baseline && typeof baseline === "object", "baseline is missing");

  const expectedCellOrder = CELLS.map(cellId);
  requireIntegrity(
    JSON.stringify(baseline.cellOrder) === JSON.stringify(expectedCellOrder),
    "baseline cell order does not match the host graph",
  );
  requireIntegrity(
    baseline.hostGraphOrderedSha256 === graphTraceSha256(),
    "baseline host-graph order does not match the independently recomputed graph",
  );
  requireEqualDigest(
    report.browserOracle?.rawRoundTripSha256,
    requireDigest(baseline.inputs?.browserMapRawSha256, "baseline browser map"),
    "browser map binding",
  );

  let exactPhasePairCount = 0;
  let exactItemTraceCount = 0;
  for (const pathId of PATH_IDS) {
    const pathReport = report.paths?.[pathId];
    requireIntegrity(pathReport && typeof pathReport === "object", `${pathId} report path is missing`);
    for (const theme of THEMES) {
      const branch = baseline.paths?.[pathId]?.[theme];
      const themeReport = pathReport.themes?.[theme];
      requireIntegrity(branch && typeof branch === "object", `${pathId}/${theme} baseline branch is missing`);
      requireIntegrity(themeReport && typeof themeReport === "object", `${pathId}/${theme} report branch is missing`);
      const baselineAtlas = baseline.inputs?.atlases?.[theme];
      requireIntegrity(baselineAtlas && typeof baselineAtlas === "object", `${theme} baseline atlas binding is missing`);
      requireEqualDigest(
        themeReport.atlas?.fileSha256,
        requireDigest(baselineAtlas.fileSha256, `${theme} baseline atlas file`),
        `${pathId}/${theme} atlas file binding`,
      );
      requireEqualDigest(
        themeReport.atlas?.decodedFullPageStackSha256,
        requireDigest(baselineAtlas.decodedFullPageStackSha256, `${theme} baseline decoded atlas`),
        `${pathId}/${theme} decoded atlas binding`,
      );

      const cellDigests = branch.cells?.orderedMetricTraceSha256;
      const cellProfiles = branch.cells?.profiles;
      requireIntegrity(Array.isArray(cellDigests) && cellDigests.length === CELLS.length, `${pathId}/${theme} cell trace count changed`);
      requireIntegrity(Array.isArray(cellProfiles) && cellProfiles.length === CELLS.length, `${pathId}/${theme} cell profile count changed`);

      const rowDigests = [];
      let cellOffset = 0;
      for (let row = 0; row < ROW_COUNTS.length; row += 1) {
        const rowCellDigests = cellDigests.slice(cellOffset, cellOffset + ROW_COUNTS[row]);
        const expectedRowDigest = digestOfDigests(rowCellDigests, `${pathId}/${theme}/row${row}/cellTrace`);
        requireEqualDigest(
          themeReport.within?.byRow?.[row]?.orderedMetricTraceSha256,
          expectedRowDigest,
          `${pathId}/${theme}/row${row} ordered metric trace`,
        );
        rowDigests.push(expectedRowDigest);
        cellOffset += ROW_COUNTS[row];
      }
      requireEqualDigest(
        themeReport.within?.allReachableCells?.orderedMetricTraceSha256,
        digestOfDigests(rowDigests, `${pathId}/${theme}/rowTrace`),
        `${pathId}/${theme} all-cell ordered metric trace`,
      );
      requireEqualDigest(
        themeReport.within?.fullCycleMateriality?.authoredPerCellBaseline?.orderedProfileTraceSha256,
        profileTrace(expectedCellOrder, cellProfiles, `${pathId}/${theme}/cellProfile`),
        `${pathId}/${theme} ordered cell-profile trace`,
      );
      exactPhasePairCount += CELLS.length * PHASE_COUNT * (PHASE_COUNT - 1);
      exactItemTraceCount += CELLS.length;

      for (const [family, edges] of Object.entries(FAMILY_DEFINITIONS)) {
        const edgeBranch = branch.edges?.[family];
        const familyReport = themeReport.stateSwitchFamilies?.[family];
        const edgeDigests = edgeBranch?.orderedMetricTraceSha256;
        const edgeProfiles = edgeBranch?.profiles;
        requireIntegrity(Array.isArray(edgeDigests) && edgeDigests.length === edges.length, `${pathId}/${theme}/${family} edge trace count changed`);
        requireIntegrity(Array.isArray(edgeProfiles) && edgeProfiles.length === edges.length, `${pathId}/${theme}/${family} edge profile count changed`);
        requireEqualDigest(
          familyReport?.orderedMetricTraceSha256,
          digestOfDigests(edgeDigests, `${pathId}/${theme}/${family}/edgeTrace`),
          `${pathId}/${theme}/${family} ordered all-phase metric trace`,
        );
        requireEqualDigest(
          familyReport?.authoredPerEdgeBaseline?.orderedProfileTraceSha256,
          profileTrace(edges.map(edgeId), edgeProfiles, `${pathId}/${theme}/${family}/edgeProfile`),
          `${pathId}/${theme}/${family} ordered edge-profile trace`,
        );
        exactPhasePairCount += edges.length * PHASE_COUNT * PHASE_COUNT;
        exactItemTraceCount += edges.length;
      }
    }
  }

  return Object.freeze({
    ok: true,
    exactPhasePairCount,
    exactItemTraceCount,
    hostGraphOrderedSha256: sha256(
      Object.entries(FAMILY_DEFINITIONS)
        .flatMap(([family, edges]) => edges.map((edge) => `${family}|${edgeId(edge)}\n`))
        .join(""),
    ),
  });
}
