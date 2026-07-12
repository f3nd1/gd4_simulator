import { describe, it, expect, afterEach } from "vitest";
import { useCalibrationStore, wrapConsistencyTestsForV2 } from "../../store/useCalibrationStore";
import type { ConsistencyTestResult } from "../calibrationTesting";

// Consistency test records: history-per-sub-criterion storage (Task 2 of
// the "gpt-5-mini whole-run failure" investigation) — running a new test on
// an already-tested sub-criterion used to silently OVERWRITE the previous
// record, destroying the before/after comparison the whole measurement
// exercise depends on.

function rec(overrides: Partial<ConsistencyTestResult> = {}): ConsistencyTestResult {
  return {
    id: "6.1-1000", subCriterionId: "6.1", path: "A", runs: 3, runAt: "2026-07-12T00:00:00.000Z",
    lines: [{ ref: "6.1.1.DS1.a", text: "req", verdicts: ["Met", "Met", "Met"] }],
    bands: [3, 3, 3], gapCounts: [1, 1, 1], failedRuns: [], agreementPct: 100, summary: "s",
    ...overrides,
  };
}

afterEach(() => {
  useCalibrationStore.setState({ consistencyTests: {} });
});

describe("useCalibrationStore — consistency test history (add/update/delete)", () => {
  it("addConsistencyTest PREPENDS a new record instead of overwriting the sub-criterion's existing one", () => {
    const older = rec({ id: "6.1-1000", runAt: "2026-07-12T09:00:00.000Z", agreementPct: 14 });
    const newer = rec({ id: "6.1-2000", runAt: "2026-07-12T10:00:00.000Z", agreementPct: 71 });
    useCalibrationStore.getState().addConsistencyTest(older);
    useCalibrationStore.getState().addConsistencyTest(newer);
    const list = useCalibrationStore.getState().consistencyTests["6.1"];
    expect(list).toHaveLength(2); // both survive — neither overwrote the other
    expect(list[0].id).toBe("6.1-2000"); // newest first
    expect(list[1].id).toBe("6.1-1000");
  });

  it("addConsistencyTest keeps OTHER sub-criteria's history untouched", () => {
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-1", subCriterionId: "6.1" }));
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "3.1-1", subCriterionId: "3.1" }));
    expect(useCalibrationStore.getState().consistencyTests["6.1"]).toHaveLength(1);
    expect(useCalibrationStore.getState().consistencyTests["3.1"]).toHaveLength(1);
  });

  it("updateConsistencyTest (retry-splice) replaces the entry with the matching id IN PLACE — no new history entry", () => {
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-1000", agreementPct: 14 }));
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-2000", agreementPct: 71 }));
    useCalibrationStore.getState().updateConsistencyTest(rec({ id: "6.1-1000", agreementPct: 90, summary: "retried" }));
    const list = useCalibrationStore.getState().consistencyTests["6.1"];
    expect(list).toHaveLength(2); // still 2 — update is not an add
    const updated = list.find((r) => r.id === "6.1-1000")!;
    expect(updated.agreementPct).toBe(90);
    expect(updated.summary).toBe("retried");
    expect(list.find((r) => r.id === "6.1-2000")!.agreementPct).toBe(71); // untouched
  });

  it("deleteConsistencyTest removes ONLY the matching id, keeping the rest of the sub-criterion's history", () => {
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-1000" }));
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-2000" }));
    useCalibrationStore.getState().deleteConsistencyTest("6.1", "6.1-1000");
    const list = useCalibrationStore.getState().consistencyTests["6.1"];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("6.1-2000");
  });

  it("deleting the LAST entry for a sub-criterion removes the key entirely (no dangling empty array)", () => {
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-1000" }));
    useCalibrationStore.getState().deleteConsistencyTest("6.1", "6.1-1000");
    expect("6.1" in useCalibrationStore.getState().consistencyTests).toBe(false);
  });

  it("clearConsistencyTests wipes every sub-criterion's history", () => {
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "6.1-1", subCriterionId: "6.1" }));
    useCalibrationStore.getState().addConsistencyTest(rec({ id: "3.1-1", subCriterionId: "3.1" }));
    useCalibrationStore.getState().clearConsistencyTests();
    expect(useCalibrationStore.getState().consistencyTests).toEqual({});
  });
});

describe("wrapConsistencyTestsForV2 — pre-existing single records migrate WITHOUT data loss", () => {
  it("wraps a legacy single-record shape (pre-history) into a one-entry array with an assigned id", () => {
    const legacy = { "6.1": { subCriterionId: "6.1", path: "A", runs: 3, runAt: "2026-06-01T00:00:00.000Z", lines: [], bands: [], gapCounts: [], failedRuns: [], agreementPct: 86, summary: "s" } };
    const wrapped = wrapConsistencyTestsForV2(legacy);
    expect(wrapped["6.1"]).toHaveLength(1);
    expect(wrapped["6.1"][0].agreementPct).toBe(86); // no data lost
    expect(wrapped["6.1"][0].id).toBe("6.1-2026-06-01T00:00:00.000Z"); // stable, derived id assigned
  });

  it("is idempotent — an already-migrated (array) entry passes through unchanged", () => {
    const alreadyMigrated = { "6.1": [rec({ id: "6.1-999" })] };
    const wrapped = wrapConsistencyTestsForV2(alreadyMigrated);
    expect(wrapped).toEqual(alreadyMigrated);
  });

  it("a record that already carries an id keeps it (never reassigned)", () => {
    const legacy = { "6.1": { ...rec({ id: "explicit-id" }) } };
    // Force the legacy (non-array) shape while keeping the existing id.
    const wrapped = wrapConsistencyTestsForV2(legacy as unknown as Record<string, unknown>);
    expect(wrapped["6.1"][0].id).toBe("explicit-id");
  });

  it("multiple sub-criteria all migrate correctly in one pass", () => {
    const legacy = {
      "6.1": { ...rec({ id: undefined as unknown as string, subCriterionId: "6.1", runAt: "2026-06-01T00:00:00.000Z" }) },
      "3.1": { ...rec({ id: undefined as unknown as string, subCriterionId: "3.1", runAt: "2026-06-02T00:00:00.000Z" }) },
    };
    const wrapped = wrapConsistencyTestsForV2(legacy);
    expect(Object.keys(wrapped).sort()).toEqual(["3.1", "6.1"]);
    expect(wrapped["6.1"][0].id).toBe("6.1-2026-06-01T00:00:00.000Z");
    expect(wrapped["3.1"][0].id).toBe("3.1-2026-06-02T00:00:00.000Z");
  });
});
