import { describe, it, expect } from "vitest";
import { detectRecurringPatterns, buildPromotedChecklistItemFields } from "../recurringFindings";
import type { ChecklistData, ChecklistItemDef } from "../preAnalysisChecklist";
import type { Finding } from "../../types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    auditCycleId: "cycle-1",
    gd4ItemId: "6.2.1",
    issue: "Market analysis is not documented in the PPD.",
    type: "AFI",
    severity: "Medium",
    owner: "SQ",
    dueDate: "",
    repeatFinding: false,
    overdue: false,
    managementDecisionNeeded: false,
    status: "Open",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Finding;
}

function checklistItem(over: Partial<ChecklistItemDef> = {}): ChecklistItemDef {
  return {
    id: "6.2.1-existing",
    title: "Existing item",
    description: "d",
    source: "hand-written",
    sourceKind: "gd4",
    mode: "manual",
    detectionKey: "none",
    verified: true,
    ...over,
  };
}

describe("detectRecurringPatterns — ref-based grouping (reuses carryoverKey)", () => {
  it("a single occurrence is never flagged as recurring", () => {
    const patterns = detectRecurringPatterns([finding({ id: "F-1", linkedSourceRefs: ["6.2.1.DS1.c"] })], {});
    expect(patterns).toHaveLength(0);
  });

  it("flags a genuine repeat across two distinct audit cycles, citing real finding IDs + dates", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: ["6.2.1.DS1.c"], createdAt: "2025-06-01T00:00:00.000Z" }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: ["6.2.1.ds1.c"], createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const patterns = detectRecurringPatterns(findings, {});
    expect(patterns).toHaveLength(1);
    const p = patterns[0];
    expect(p.gd4ItemId).toBe("6.2.1");
    expect(p.subCriterionId).toBe("6.2");
    expect(p.occurrences.map((o) => o.findingId).sort()).toEqual(["F-1", "F-2"]);
    expect(p.occurrences.map((o) => o.createdAt)).toContain("2025-06-01T00:00:00.000Z");
    expect(p.occurrences.map((o) => o.createdAt)).toContain("2026-06-01T00:00:00.000Z");
  });

  it("ignores findingType when matching (an OFI that returns as an NC is still the same gap)", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: ["6.2.1.DS1.c"], findingType: "OFI" }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: ["6.2.1.DS1.c"], findingType: "NC" }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(1);
  });

  it("does NOT flag two findings from the same audit cycle+run as recurring", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", auditRunId: "AR-1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
      finding({ id: "F-2", auditCycleId: "cycle-1", auditRunId: "AR-1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(0);
  });

  it("prefers auditRunId over auditCycleId for distinctness (two runs in the same cycle both count)", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", auditRunId: "AR-1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
      finding({ id: "F-2", auditCycleId: "cycle-1", auditRunId: "AR-2", linkedSourceRefs: ["6.2.1.DS1.c"] }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(1);
  });

  it("different GD4 items are never grouped together", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", gd4ItemId: "6.2.1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
      finding({ id: "F-2", auditCycleId: "cycle-2", gd4ItemId: "4.2.1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(0);
  });
});

describe("detectRecurringPatterns — ref-less fallback (exact text match only)", () => {
  it("groups ref-less findings by same GD4 item + exact normalized text", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: undefined, clause: undefined, issue: "  Follow-up actions lack timelines.  " }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: undefined, clause: undefined, issue: "follow-up actions lack timelines." }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(1);
  });

  it("does NOT fuzzy-match reworded ref-less text — a genuinely different wording is not grouped", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: undefined, clause: undefined, issue: "Follow-up actions lack timelines." }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: undefined, clause: undefined, issue: "Action items have no assigned deadline." }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(0);
  });

  it("a finding with neither a ref nor issue text is never grouped", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: undefined, clause: undefined, issue: "" }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: undefined, clause: undefined, issue: "" }),
    ];
    expect(detectRecurringPatterns(findings, {})).toHaveLength(0);
  });
});

describe("detectRecurringPatterns — already-covered suppression", () => {
  it("marks alreadyCovered when an existing item carries this pattern's exact promoted tag", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: ["6.2.1.DS1.c"] }),
    ];
    const matchKey = detectRecurringPatterns(findings, {})[0].matchKey;
    const checklists: ChecklistData = { "6.2.1": [checklistItem({ source: `Promoted from recurring finding (2 occurrences) — findings F-1, F-2 (2025-06-01, 2026-06-01) [promoted:${matchKey}]` })] };
    const patterns = detectRecurringPatterns(findings, checklists);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].alreadyCovered).toBe(true);
  });

  it("an UNRELATED existing item (no matching tag) does not suppress the pattern", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: ["6.2.1.DS1.c"] }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: ["6.2.1.DS1.c"] }),
    ];
    // The real hand-written 6.2.1 item — deliberately NOT fuzzy-matched (see module header).
    const checklists: ChecklistData = { "6.2.1": [checklistItem({ id: "6.2.1-action-timeline", title: "Follow-up actions carry owners and timelines", source: "Known SSG finding pattern — 2026 assessment, Pattern 5" })] };
    const patterns = detectRecurringPatterns(findings, checklists);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].alreadyCovered).toBe(false);
  });
});

describe("buildPromotedChecklistItemFields", () => {
  it("cites the real finding IDs and dates in source, defaults to manual/none, never sets verified", () => {
    const findings = [
      finding({ id: "F-1", auditCycleId: "cycle-1", linkedSourceRefs: ["6.2.1.DS1.c"], createdAt: "2025-06-01T00:00:00.000Z" }),
      finding({ id: "F-2", auditCycleId: "cycle-2", linkedSourceRefs: ["6.2.1.DS1.c"], createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const pattern = detectRecurringPatterns(findings, {})[0];
    const fields = buildPromotedChecklistItemFields(pattern);
    expect(fields.mode).toBe("manual");
    expect(fields.detectionKey).toBe("none");
    expect(fields.sourceKind).toBe("finding-pattern");
    expect(fields.source).toContain("F-1");
    expect(fields.source).toContain("F-2");
    expect(fields.source).toContain("2025-06-01");
    expect(fields.source).toContain("2026-06-01");
    expect(fields.source).toContain("(2 occurrences)");
    expect(fields.source).toContain(`[promoted:${pattern.matchKey}]`);
    // Omit<ChecklistItemDef, "id" | "verified"> — verified is never part of this
    // object; usePreCheckChecklistStore.addItem is solely responsible for
    // setting it to false, so there is exactly one place a promoted item can
    // ever become verified: true (the Setup page's explicit Approve action).
    expect("verified" in fields).toBe(false);
    expect("id" in fields).toBe(false);
  });
});
