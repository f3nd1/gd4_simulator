import { describe, it, expect } from "vitest";
import {
  REVIEW_PERSPECTIVES, perspectiveOf, perspectiveLabel, DEFAULT_PERSPECTIVE,
  assemblePanel, isValidPanel, shouldAutoRunPanel, panelCostEstimate, findingReviewHash,
  detectPanelDisagreement, buildDebateScript, debateBubbleLine, chibiColorsFor,
  MIN_PANEL, MAX_PANEL,
} from "../reviewPanel";
import type { PanelAuditorReview, PanelReviewResult } from "../../types";
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
  it("scales one call per auditor plus one synthesis, with a disagreement worst case", () => {
    const c = panelCostEstimate(5, 35);
    expect(c.perFinding).toBe(6);       // 5 panellists + synthesis
    expect(c.perFindingMax).toBe(11);   // + 5 rebuttals on disagreement
    expect(c.total).toBe(210);
    expect(c.totalMax).toBe(385);
    expect(c.text).toContain("6 calls per finding");
    expect(c.text).toContain("210–385 calls");
  });
  it("finding hash changes when the finding text changes, stable otherwise", () => {
    const a = finding({ observation: "x" });
    const b = finding({ observation: "x" });
    const c = finding({ observation: "y" });
    expect(findingReviewHash(a)).toBe(findingReviewHash(b));
    expect(findingReviewHash(a)).not.toBe(findingReviewHash(c));
  });
});

describe("detectPanelDisagreement", () => {
  function rev(position: PanelAuditorReview["position"], over: Partial<PanelAuditorReview> = {}): PanelAuditorReview {
    return { auditorId: "a", auditorName: "A", perspective: "strict-auditor", perspectiveLabel: "Strict Auditor", analysis: "x", position, ...over };
  }
  it("agrees when classification/severity/root-cause align (synonyms collapse)", () => {
    const r = detectPanelDisagreement([
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "process" }),
      rev({ classification: "Non-conformity", severity: "High", rootCauseDirection: "control workflow" }),
    ]);
    expect(r.disagree).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });
  it("flags a classification split (finding vs no issue)", () => {
    const r = detectPanelDisagreement([
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "process" }),
      rev({ classification: "No issue", severity: "None", rootCauseDirection: "none" }),
    ]);
    expect(r.disagree).toBe(true);
    expect(r.reasons.some((x) => /classification/i.test(x))).toBe(true);
  });
  it("flags a severity split (major vs minor) with same classification", () => {
    const r = detectPanelDisagreement([
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "process" }),
      rev({ classification: "NC", severity: "Minor", rootCauseDirection: "process" }),
    ]);
    expect(r.disagree).toBe(true);
    expect(r.reasons.some((x) => /severity/i.test(x))).toBe(true);
  });
  it("flags contradictory root-cause directions", () => {
    const r = detectPanelDisagreement([
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "documentation gap" }),
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "staff training" }),
    ]);
    expect(r.disagree).toBe(true);
    expect(r.reasons.some((x) => /root-cause/i.test(x))).toBe(true);
  });
  it("ignores failed / position-less panellists and needs 2+ positions", () => {
    expect(detectPanelDisagreement([rev({ classification: "NC", severity: "Major", rootCauseDirection: "process" })]).disagree).toBe(false);
    const r = detectPanelDisagreement([
      rev({ classification: "NC", severity: "Major", rootCauseDirection: "process" }),
      rev(undefined, { failed: true, analysis: "" }),
    ]);
    expect(r.disagree).toBe(false);
  });
});

describe("chibi debate script (presentation-only)", () => {
  function pr(id: string, over: Partial<PanelAuditorReview> = {}): PanelAuditorReview {
    return {
      auditorId: id, auditorName: id, perspective: "strict-auditor", perspectiveLabel: "Strict Auditor",
      analysis: "No signed samples are on file. The rest of this review is longer detail.",
      position: { classification: "NC", severity: "Major", rootCauseDirection: "process" },
      ...over,
    };
  }
  function result(reviews: PanelAuditorReview[], over: Partial<PanelReviewResult> = {}): PanelReviewResult {
    return {
      reviews,
      synthesis: { summary: "Summary.", riskImpact: "", rootCause: "", immediateCorrection: "", correctiveAction: "", evidenceForClosure: "", finalClassification: "NC (Major) — not demonstrable." },
      runAt: "2026-07-03T00:00:00Z", live: true, findingHash: "h", ...over,
    };
  }

  it("bubble line takes the first sentence and clamps long ones", () => {
    expect(debateBubbleLine("First point. Second point.")).toBe("First point.");
    expect(debateBubbleLine("x".repeat(200)).length).toBeLessThanOrEqual(110);
    expect(debateBubbleLine("")).toBe("");
  });

  it("agreement: one review step per usable panellist, then synthesis with an 'agreed' caption", () => {
    const steps = buildDebateScript(result([pr("A"), pr("B"), pr("C")]));
    expect(steps.map((s) => s.kind)).toEqual(["review", "review", "review", "synthesis"]);
    expect(steps[0].bubble).toBe("No signed samples are on file.");
    expect(steps[0].positionPill).toBe("NC · Major");
    expect(steps[3].caption).toContain("agreed at Round 1");
    expect(steps[3].bubble).toContain("not demonstrable");
  });

  it("disagreement: rebuttal steps play after Round 1, and failed panellists are skipped", () => {
    const steps = buildDebateScript(result(
      [
        pr("A", { rebuttal: "I hold the NC. More words." }),
        pr("B", { rebuttal: "I revise to Minor. More words." }),
        pr("C", { failed: true, analysis: "" }),
      ],
      { discussionTriggered: true }
    ));
    expect(steps.map((s) => s.kind)).toEqual(["review", "review", "rebuttal", "rebuttal", "synthesis"]);
    expect(steps[2].bubble).toBe("I hold the NC.");
    expect(steps[2].caption).toContain("responds to the others");
    expect(steps[4].caption).toContain("After the discussion");
    // Failed panellist C contributes no steps.
    expect(steps.some((s) => s.caption.includes("C ("))).toBe(false);
  });

  it("chibi colours are stable per identity and never collide within a panel", () => {
    const a = chibiColorsFor(["AUD-1", "AUD-2", "AUD-3", "AUD-4", "AUD-5"]);
    const b = chibiColorsFor(["AUD-1", "AUD-2", "AUD-3", "AUD-4", "AUD-5"]);
    expect(a).toEqual(b);                       // stable
    expect(new Set(a).size).toBe(5);            // distinct
    expect(chibiColorsFor(["AUD-1"])[0]).toBe(a[0]); // identity-derived, not seat-derived
  });
});
