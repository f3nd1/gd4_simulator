import { describe, it, expect } from "vitest";
import { partitionWritesByMode, partitionOptionAWrites, DEFAULT_AUDIT_MODE, auditModeLabel, AUDIT_MODES } from "../runModes";
import { buildFullAuditPlan, fullAuditLabel } from "../fullAudit";
import type { ChecklistLineWrite } from "../../types";

function write(over: Partial<ChecklistLineWrite>): ChecklistLineWrite {
  return {
    gd4ItemId: "1.2.1",
    existingLineId: "L1",
    status: "Met",
    evidence: { title: "t", type: "Record/Log", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", runId: "R1" },
    ...over,
  };
}

describe("three-mode gating — modes decide WHEN writes commit, not how they are computed", () => {
  const writes = [write({ existingLineId: "L1" }), write({ existingLineId: "L2", status: "Not met" })];

  it("full-auto commits everything, queues nothing", () => {
    const { commit, queue } = partitionWritesByMode("full-auto", writes);
    expect(commit).toHaveLength(2);
    expect(queue).toHaveLength(0);
  });

  it("hybrid commits NOTHING — every verdict queues as a gate for approval (Option B staged path)", () => {
    const { commit, queue } = partitionWritesByMode("hybrid", writes);
    expect(commit).toHaveLength(0);
    expect(queue).toHaveLength(2);
  });

  it("Option A: hybrid commits immediately like full-auto (per-line gate removed); manual still commits nothing", () => {
    const hybrid = partitionOptionAWrites("hybrid", writes);
    expect(hybrid.commit).toHaveLength(2);
    expect(hybrid.queue).toHaveLength(0);
    const fullAuto = partitionOptionAWrites("full-auto", writes);
    expect(fullAuto.commit).toHaveLength(2);
    expect(fullAuto.queue).toHaveLength(0);
    const manual = partitionOptionAWrites("manual", writes);
    expect(manual.commit).toHaveLength(0);
    expect(manual.queue).toHaveLength(0);
  });

  it("manual neither commits nor queues — the AI decides nothing", () => {
    const { commit, queue } = partitionWritesByMode("manual", writes);
    expect(commit).toHaveLength(0);
    expect(queue).toHaveLength(0);
  });

  it("the default mode is Hybrid, and all three modes have card copy", () => {
    expect(DEFAULT_AUDIT_MODE).toBe("hybrid");
    expect(AUDIT_MODES).toHaveLength(3);
    expect(auditModeLabel("full-auto")).toBe("Full auto");
    for (const m of AUDIT_MODES) {
      expect(m.desc.length).toBeGreaterThan(20);
      expect(m.best).toMatch(/^Best/);
    }
  });
});

describe("buildFullAuditPlan — the full-auto sweep never skips silently", () => {
  const folders = [
    { id: "f1", subCriterionId: "1.1", folderName: "Vision", folderLink: "https://drive/x", policyLink: "" },
    { id: "f2", subCriterionId: "1.2", folderName: "Strategy", folderLink: "", policyLink: "https://drive/y" },
    { id: "f3", subCriterionId: "2.1", folderName: "Admin", folderLink: "", policyLink: "" },
  ];
  const isLink = (l?: string) => !!l && l.startsWith("https://drive/");

  it("includes EVERY sub-criterion: linked ones run, unlinked ones are flagged (not dropped)", () => {
    const plan = buildFullAuditPlan(folders, {}, isLink);
    expect(plan).toHaveLength(3);
    expect(plan.filter((p) => p.hasLinks).map((p) => p.subCriterionId)).toEqual(["1.1", "1.2"]);
    expect(plan.find((p) => p.subCriterionId === "2.1")!.hasLinks).toBe(false);
  });

  it("respects each row's Option A/B choice and defaults to the staged path (B) when unset", () => {
    const plan = buildFullAuditPlan(folders, { "1.2": "A" }, isLink);
    // One-pipeline default (Batch 7): unset → B; Option A is the explicit opt-in.
    expect(plan.find((p) => p.subCriterionId === "1.1")!.path).toBe("B");
    expect(plan.find((p) => p.subCriterionId === "1.2")!.path).toBe("A");
  });

  it("log labels show the sub-criterion number once, not twice", () => {
    expect(fullAuditLabel("6.2", "6.2 Management Review")).toBe("6.2 Management Review");
    expect(fullAuditLabel("1.1", "1.1 Leadership & Corporate Governance")).toBe("1.1 Leadership & Corporate Governance");
    expect(fullAuditLabel("4.2", "Student Contracts")).toBe("4.2 Student Contracts");
  });
});
