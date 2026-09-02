import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  verifyAnimatedAtlasContract,
  verifyAnimatedDiagnosticMaximumRecord,
  verifyAnimatedDisplayed112,
  verifyAnimatedSourceIsolatedFrameSummary,
} from "../scripts/qa-evidence.mjs";

async function readAnimatedReport(variant) {
  return JSON.parse(await readFile(
    new URL(`../qa/animated-atlas-${variant}.json`, import.meta.url),
    "utf8",
  ));
}

test("evidence verifier binds each animated-atlas timing contract exactly", async () => {
  for (const variant of ["dark", "light"]) {
    const report = await readAnimatedReport(variant);
    assert.equal(
      verifyAnimatedAtlasContract(report.contract, `${variant} fixture`),
      true,
    );

    const changedDelay = structuredClone(report.contract);
    [changedDelay.frameDelaysMs[0], changedDelay.frameDelaysMs[1]] =
      [changedDelay.frameDelaysMs[1], changedDelay.frameDelaysMs[0]];
    assert.throws(
      () => verifyAnimatedAtlasContract(changedDelay, `${variant} changed-delay fixture`),
      /contract is incomplete or changed/u,
    );

    const shortenedSchedule = structuredClone(report.contract);
    shortenedSchedule.frameDelaysMs.pop();
    assert.throws(
      () => verifyAnimatedAtlasContract(shortenedSchedule, `${variant} short-delay fixture`),
      /contract is incomplete or changed/u,
    );
  }
});

test("source temporal verifier keeps sub-material isolated ratios diagnostic", async () => {
  const report = await readAnimatedReport("dark");
  const temporal = report.temporal.adjacencyUpperBounds;
  const globalDiagnostic = structuredClone(temporal);
  globalDiagnostic.maximumObservedIsolatedFrameExcursion.value =
    temporal.gate.maximumIsolatedFrameExcursionRatio + 100;
  assert.equal(
    verifyAnimatedDiagnosticMaximumRecord(
      globalDiagnostic,
      "maximumObservedIsolatedFrameExcursion",
      "source global fixture",
    ),
    true,
  );

  const cell = report.temporal.cells[0];
  const cellDiagnostic = structuredClone(cell.isolatedFrameExcursions);
  cellDiagnostic.maximumObservedRatio =
    report.contract.temporalRowUpperBounds[cell.row].maximumIsolatedFrameExcursionRatio + 100;
  assert.equal(
    verifyAnimatedSourceIsolatedFrameSummary(
      cellDiagnostic,
      cell.key,
      "source cell fixture",
    ),
    true,
  );

  const invalidDiagnostic = structuredClone(globalDiagnostic);
  invalidDiagnostic.maximumObservedIsolatedFrameExcursion.value = Number.NaN;
  assert.throws(
    () => verifyAnimatedDiagnosticMaximumRecord(
      invalidDiagnostic,
      "maximumObservedIsolatedFrameExcursion",
      "source invalid fixture",
    ),
    /is missing or non-finite/u,
  );
});

test("displayed temporal verifier gates material local energy without rejecting diagnostic spikes", async () => {
  for (const variant of ["dark", "light"]) {
    const report = await readAnimatedReport(variant);
    const displayed = report.displayedTemporal112;
    const row = "0";
    const rowGate = displayed.rowGates[row].maximumLocalEnergyRatio;

    // Low-energy transitions may have unstable ratios. They remain diagnostic;
    // only the material-transition maxima are required to satisfy the gate.
    assert.ok(displayed.rowMaximumObserved[row].localEnergyRatio > rowGate);
    assert.ok(displayed.rowMaximumObservedMaterialLocalEnergyRatio[row] <= rowGate);
    assert.equal(
      verifyAnimatedDisplayed112(displayed, `${variant} displayed fixture`),
      true,
    );

    const diagnosticSpike = structuredClone(displayed);
    diagnosticSpike.rowMaximumObserved[row].localEnergyRatio = rowGate + 100;
    assert.equal(
      verifyAnimatedDisplayed112(diagnosticSpike, `${variant} diagnostic-spike fixture`),
      true,
    );

    const globalMaterialFailure = structuredClone(displayed);
    globalMaterialFailure.maximumObservedMaterialLocalEnergyRatio.value =
      displayed.gate.maximumLocalEnergyRatio + 1;
    assert.throws(
      () => verifyAnimatedDisplayed112(
        globalMaterialFailure,
        `${variant} global-material fixture`,
      ),
      /material local-energy maximum is missing or exceeds its bound/u,
    );

    const rowMaterialFailure = structuredClone(displayed);
    rowMaterialFailure.rowMaximumObservedMaterialLocalEnergyRatio[row] = rowGate + 1;
    assert.throws(
      () => verifyAnimatedDisplayed112(rowMaterialFailure, `${variant} row-material fixture`),
      /row 0 material local-energy maximum is inconsistent or exceeds its row gate/u,
    );
  }
});
