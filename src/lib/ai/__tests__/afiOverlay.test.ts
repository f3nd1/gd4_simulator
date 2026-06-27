import { describe, it, expect } from "vitest";
import { applyAfiOverlay } from "../simulateAI";
import type { Finding, SpecificChecklistLine } from "../../../types";

function line(text: string): SpecificChecklistLine {
  return { id: Math.random().toString(36).slice(2), text, status: "Not Started", evidence: [], generatedBy: "manual" };
}

function finding(gd4ItemId: string, issue: string): Finding {
  return {
    id: "AFI-TEST",
    auditCycleId: "cycle-1",
    gd4ItemId,
    issue,
    type: "AFI",
    severity: "Medium",
    owner: "",
    dueDate: "",
    repeatFinding: false,
    overdue: false,
    managementDecisionNeeded: false,
    status: "Open",
  };
}

describe("applyAfiOverlay", () => {
  it("tags a line whose text overlaps with the finding's issue keywords", () => {
    const lines: SpecificChecklistLine[] = [line("The policy document must be updated and approved by management.")];
    const f: Finding = finding("1.1.1", "Policy document is outdated and has not been approved.");
    const result = applyAfiOverlay("1.1.1", lines, [f]);
    expect(result[0].afiTag).toBe("AFI-TEST");
  });

  it("does not tag a line with no keyword overlap", () => {
    const lines: SpecificChecklistLine[] = [line("Attendance records are maintained for every student session.")];
    const f: Finding = finding("1.1.1", "Fee protection scheme receipt is missing for several payments.");
    const result = applyAfiOverlay("1.1.1", lines, [f]);
    expect(result[0].afiTag).toBeUndefined();
  });

  it("does not overwrite an existing afiTag", () => {
    const existing: SpecificChecklistLine = { ...line("Document approved and updated"), afiTag: "AFI-EXISTING" };
    const f: Finding = finding("1.1.1", "Document must be approved and updated.");
    const result = applyAfiOverlay("1.1.1", [existing], [f]);
    expect(result[0].afiTag).toBe("AFI-EXISTING");
  });

  it("returns lines unchanged when no finding matches the item", () => {
    const lines: SpecificChecklistLine[] = [line("Staff training records are maintained.")];
    const f: Finding = finding("2.1.1", "Staff training records are missing.");
    const result = applyAfiOverlay("1.1.1", lines, [f]);
    expect(result[0].afiTag).toBeUndefined();
  });

  it("only the first matching finding is used per item (Array.find picks first)", () => {
    const lines: SpecificChecklistLine[] = [line("Policy review governance records are signed.")];
    const f1 = { ...finding("1.1.1", "Policy review process not documented."), id: "AFI-1" };
    const result = applyAfiOverlay("1.1.1", lines, [f1]);
    // Tag comes from f1 (the only one passed)
    expect(result[0].afiTag).toBe("AFI-1");
  });
});
