import { describe, it, expect } from "vitest";
import {
  REVIEW_PERSPECTIVES, perspectiveOf, perspectiveLabel, DEFAULT_PERSPECTIVE,
  assemblePanel, isValidPanel, shouldAutoRunPanel, panelCostEstimate, findingReviewHash,
  MIN_PANEL, MAX_PANEL,
} from "../reviewPanel";
import type { AuditorProfile, Finding } from "../../types";

function auditor(id: string, over: Partial<AuditorProfile> = {}): AuditorProfile {
  return { id, auditCycleId: "c1", name: id, type: "Internal", role: "Reviewer", strictness: 70, focusArea: "", checklistTemplateId: "t", ...over };
}
function finding(over: Partial<Finding> = {}): Finding {
  return { id: "F1", auditCycleId: "c1", gd4ItemId: "4.2.1", issue: "gap", type: "AFI", severity: "High", owner: "SQ", dueDate: "", repeatFinding: false, overdue: false, managementDecisionNeeded: false, status: "Open", ...over };
}

describe("review perspectives", () => {
  it("has the five fixed roles with non-trivial guidance, and defaults to strict-auditor", () => {
    expect(REVIEW_PERSPECTIVES.map((p) => p.value)).toEqual([
      "strict-auditor", "optimistic-process-owner", "risk-challenger", "academic-qa-guardian", "management-reviewer",
    ]);
    for (const p of REVIEW_PERSPECTIVES) expect(p.guidance.length).toBeGreaterThan(40);
    expect(perspectiveOf(auditor("a"))).toBe(DEFAULT_PERSPECTIVE);
    expect(perspectiveOf(auditor("a", { reviewPerspective: "risk-challenger" }))).toBe("risk-challenger");
    expect(perspectiveLabel("management-reviewer")).toBe("Management Reviewer");
  });
});

describe("panel assembly (2-5 auditors)", () => {
  const auds = [auditor("a1"), auditor("a2"), auditor("a3"), auditor("a4"), auditor("a5"), auditor("a6")];
  it("assembles the selected subset and caps at MAX_PANEL", () => {
    expect(assemblePanel(auds, ["a1", "a3"]).map((a) => a.id)).toEqual(["a1", "a3"]);
    expect(assemblePanel(auds, ["a1", "a2", "a3", "a4", "a5", "a6"])).toHaveLength(MAX_PANEL);
  });
  it("validates the 2-5 range", () => {
    expect(isValidPanel(auds, ["a1"])).toBe(false);            // below MIN
    expect(isValidPanel(auds, ["a1", "a2"])).toBe(true);       // MIN
    expect(isValidPanel(auds, ["a1", "a2", "a3", "a4", "a5"])).toBe(true); // MAX
    expect(isValidPanel(auds, [])).toBe(false);
    expect(MIN_PANEL).toBe(2);
    expect(MAX_PANEL).toBe(5);
  });
});

describe("mode gating (shouldAutoRunPanel)", () => {
  const ncMajor = finding({ findingType: "NC", ncSeverity: "Major" });
  const ncMinor = finding({ findingType: "NC", ncSeverity: "Minor" });
  const ofi = finding({ findingType: "OFI" });

  it("off never auto-runs", () => {
    expect(shouldAutoRunPanel("off", ncMajor)).toBe(false);
  });
  it("on-demand never auto-runs (manual button only)", () => {
    expect(shouldAutoRunPanel("on-demand", ncMajor)).toBe(false);
  });
  it("nc-major-auto runs ONLY for NC/Major", () => {
    expect(shouldAutoRunPanel("nc-major-auto", ncMajor)).toBe(true);
    expect(shouldAutoRunPanel("nc-major-auto", ncMinor)).toBe(false);
    expect(shouldAutoRunPanel("nc-major-auto", ofi)).toBe(false);
  });
  it("all runs for every finding", () => {
    expect(shouldAutoRunPanel("all", ncMajor)).toBe(true);
    expect(shouldAutoRunPanel("all", ofi)).toBe(true);
  });
});

describe("cost estimate + finding hash", () => {
  it("scales one call per auditor plus one synthesis", () => {
    const c = panelCostEstimate(5, 35);
    expect(c.perFinding).toBe(6);
    expect(c.total).toBe(210);
    expect(c.text).toContain("6 calls per finding");
    expect(c.text).toContain("210 calls");
  });
  it("finding hash changes when the finding text changes, stable otherwise", () => {
    const a = finding({ observation: "x" });
    const b = finding({ observation: "x" });
    const c = finding({ observation: "y" });
    expect(findingReviewHash(a)).toBe(findingReviewHash(b));
    expect(findingReviewHash(a)).not.toBe(findingReviewHash(c));
  });
});
