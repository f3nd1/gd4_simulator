import { describe, it, expect } from "vitest";
import { buildResumeItems } from "../resumePanel";
import type { AuditRunRecord, Finding } from "../../types";

function run(over: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    runId: "AR-1", folderId: "f1", subCriterionId: "4.2", subCriterionTitle: "Student contracts",
    scope: "both", status: "completed", startedAt: "2026-07-01T10:00:00.000Z", endedAt: "2026-07-01T11:00:00.000Z",
    auditLive: true, fileLedger: [], aiSummary: [], linesAssessed: 10, findingsDetected: 3, batchCount: 1, chunkCount: 4,
    ...over,
  } as AuditRunRecord;
}
const f = (id: string): Finding => ({ id, auditCycleId: "c", gd4ItemId: "4.2.1", issue: "x", type: "AFI", severity: "High", owner: "", dueDate: "", repeatFinding: false, overdue: false, managementDecisionNeeded: false, status: "Open" }) as Finding;

describe("buildResumeItems — the Dashboard 'pick up where you left off' panel", () => {
  it("is empty when nothing is in flight", () => {
    expect(buildResumeItems({ lastAuditRuns: {}, pendingCommitCount: 0, pendingDraftCount: 0, findings: [], closures: {} })).toEqual([]);
  });

  it("orders: pending review runs → drafts → open findings → effectiveness due → last run", () => {
    const items = buildResumeItems({
      lastAuditRuns: { f1: run() },
      pendingCommitCount: 2,
      pendingDraftCount: 3,
      findings: [f("F1"), f("F2")],
      closures: {
        F1: { human: "Accepted", effectivenessDue: "2026-06-01", effectivenessConfirmedAt: undefined },
      },
      today: "2026-07-04",
    });
    expect(items.map((i) => i.key)).toEqual(["pending-commits", "pending-drafts", "open-findings", "effectiveness-due", "last-run"]);
    expect(items[0].label).toContain("2 audit runs waiting");
    expect(items[2].label).toContain("1 finding still open"); // F2 (F1 accepted)
    expect(items[4].to).toBe("/findings?subCrit=4.2");
  });

  it("effectiveness review only counts accepted closures past due and unconfirmed", () => {
    const items = buildResumeItems({
      lastAuditRuns: {}, pendingCommitCount: 0, pendingDraftCount: 0,
      findings: [f("F1"), f("F2"), f("F3")],
      closures: {
        F1: { human: "Accepted", effectivenessDue: "2026-08-01" }, // not yet due
        F2: { human: "Accepted", effectivenessDue: "2026-06-01", effectivenessConfirmedAt: "2026-06-15" }, // confirmed
        F3: { human: "Accepted", effectivenessDue: "2026-06-01" }, // due
      },
      today: "2026-07-04",
    });
    const due = items.find((i) => i.key === "effectiveness-due");
    expect(due?.label).toContain("1 closed finding");
  });

  it("marks an offline run in the last-run line", () => {
    const items = buildResumeItems({ lastAuditRuns: { f1: run({ auditLive: false }) }, pendingCommitCount: 0, pendingDraftCount: 0, findings: [], closures: {} });
    expect(items[0].label).toContain("(offline estimate)");
  });
});
