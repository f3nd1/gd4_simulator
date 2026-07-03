import { describe, it, expect } from "vitest";
import { runFullAuditPlan, type FullAuditEntry, type FullAuditPlanEntry } from "../fullAudit";

function plan(): FullAuditPlanEntry[] {
  return [
    { folderId: "f1", subCriterionId: "6.1", folderName: "6.1 Internal Audit", path: "B", hasLinks: true },
    { folderId: "f2", subCriterionId: "6.2", folderName: "6.2 Management Review", path: "A", hasLinks: true },
    { folderId: "f3", subCriterionId: "6.3", folderName: "6.3 Continual Improvement", path: "B", hasLinks: true },
    { folderId: "f4", subCriterionId: "7.1", folderName: "7.1 Outcomes", path: "A", hasLinks: false },
  ];
}
function entriesFor(p: FullAuditPlanEntry[]): FullAuditEntry[] {
  return p.map((e) => ({ subCriterionId: e.subCriterionId, label: e.folderName, status: "waiting" as const }));
}

describe("runFullAuditPlan — one stuck or failing sub-criterion never freezes the sweep", () => {
  it("a HANGING sub-criterion is timed out, aborted, marked error, and the rest complete", async () => {
    const p = plan();
    const entries = entriesFor(p);
    const ran: string[] = [];
    let aborted = 0;
    const result = await runFullAuditPlan(p, entries, {
      run: (entry) => {
        ran.push(entry.subCriterionId);
        // 6.2 hangs forever — exactly the reported freeze.
        if (entry.subCriterionId === "6.2") return new Promise<void>(() => {});
        return Promise.resolve();
      },
      markNoLinks: () => {},
      cancelled: () => false,
      abortActiveRun: () => { aborted++; },
      onUpdate: () => {},
      timeoutMs: 30, // tiny ceiling for the test
    });

    expect(result.cancelled).toBe(false);
    expect(ran).toEqual(["6.1", "6.2", "6.3"]); // the loop advanced past the hang
    expect(aborted).toBe(1); // the hung run was actively aborted
    expect(entries.map((e) => e.status)).toEqual(["done", "error", "done", "skipped"]);
    expect(entries[1].note).toContain("timed out");
    expect(entries[3].note).toContain("no folder links"); // link-less: flagged, not dropped
  });

  it("a THROWING sub-criterion is marked error with its reason and the rest complete", async () => {
    const p = plan();
    const entries = entriesFor(p);
    const result = await runFullAuditPlan(p, entries, {
      run: async (entry) => {
        if (entry.subCriterionId === "6.2") throw new Error("Drive returned 500");
      },
      markNoLinks: () => {},
      cancelled: () => false,
      abortActiveRun: () => {},
      onUpdate: () => {},
      timeoutMs: 1000,
    });
    expect(result.cancelled).toBe(false);
    expect(entries.map((e) => e.status)).toEqual(["done", "error", "done", "skipped"]);
    expect(entries[1].note).toContain("Drive returned 500");
  });

  it("user cancel stops cleanly with partial results (no fake completions)", async () => {
    const p = plan();
    const entries = entriesFor(p);
    let done = 0;
    const result = await runFullAuditPlan(p, entries, {
      run: async () => { done++; },
      markNoLinks: () => {},
      cancelled: () => done >= 1, // cancel after the first completes
      abortActiveRun: () => {},
      onUpdate: () => {},
      timeoutMs: 1000,
    });
    expect(result.cancelled).toBe(true);
    expect(entries[0].status).toBe("error"); // in-flight when cancel landed — marked, not faked as done
    expect(entries[1].status).toBe("waiting");
  });

  it("ALWAYS reaches a terminal state: every entry ends done/skipped/error when not cancelled", async () => {
    const p = plan();
    const entries = entriesFor(p);
    await runFullAuditPlan(p, entries, {
      run: async (entry) => { if (entry.subCriterionId === "6.3") throw new Error("boom"); },
      markNoLinks: () => {},
      cancelled: () => false,
      abortActiveRun: () => {},
      onUpdate: () => {},
      timeoutMs: 1000,
    });
    expect(entries.every((e) => e.status === "done" || e.status === "skipped" || e.status === "error")).toBe(true);
  });
});
