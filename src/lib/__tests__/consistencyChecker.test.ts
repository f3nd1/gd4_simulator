import { describe, it, expect } from "vitest";
import { runConsistencyChecks, checkSentinelSync, type ConsistencyRuleId, type ConsistencyInput } from "../consistencyChecker";
import { buildScored } from "../scoring";
import { buildFinalReport } from "../finalReport";
import { computeChecklistOverrides, DEFAULT_APSR_SCALE } from "../checklistBanding";
import { blankEvidence } from "../../data/seedEvidence";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import { OPTION_A_NOT_ASSESSED_NOTE } from "../optionAChecklistWrite";
import { NOT_ASSESSED_FINDING, NOT_ASSESSED_AFI } from "../finalReport";
import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine, SubChecklistEvidenceItem, ApsrBreakdown, ApsrMatrixScores, HolisticBandRecord } from "../../types";

const ISO = "2026-07-15T00:00:00.000Z";
const SCALE = DEFAULT_APSR_SCALE;

// Build the checker input from entries + findings the SAME way the app does:
// compute the overrides, score, build the Final Report, then hand all four to
// the engine.
function inputsFrom(entries: Record<string, SubCriterionChecklistEntry>, findings: Finding[] = []): ConsistencyInput {
  const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS, SCALE);
  const scored = buildScored({ evidence: blankEvidence(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides, customFindings: findings });
  const report = buildFinalReport(scored, entries, findings, {}, SCALE);
  return { entries, findings, report, apsrScale: SCALE };
}
const fired = (issues: { ruleId: ConsistencyRuleId }[], rule: ConsistencyRuleId) => issues.some((i) => i.ruleId === rule);

function ev(over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem {
  return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", ...over };
}
function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
  return { text: "x", status: "Met", evidence: [], generatedBy: "ai", ...over };
}
function apsrWith(over: Partial<ApsrBreakdown>): ApsrBreakdown {
  return {
    approach: { status: "Not evident", note: "" },
    processes: { status: "Not evident", note: "" },
    systemsOutcomes: { status: "Not evident", note: "" },
    review: { status: "Not evident", note: "" },
    ...over,
  };
}
function finding(over: Partial<Finding> & { id: string }): Finding {
  return { auditCycleId: "c1", gd4ItemId: "6.2.1", issue: "Gap", type: "AFI", severity: "Medium", owner: "", dueDate: "", repeatFinding: false, overdue: false, managementDecisionNeeded: false, status: "Open", ...over };
}
function bandRec(matrixScores: Partial<ApsrMatrixScores>, totalPct: number, band: 1 | 2 | 3 | 4 | 5): HolisticBandRecord {
  return { band, totalPct, matrixScores: matrixScores as ApsrMatrixScores, rationale: "x", source: "human", decidedAt: ISO };
}

describe("Consistency Checker - the five known-bad seed cases each fire their rule", () => {
  it("Seed 1 -> R1: a band saved with zero backing lines", () => {
    const entries = {
      "6.2.1": { gd4ItemId: "6.2.1", specific: [], holisticBand: bandRec({ approach: 5, processes: 3, systemsOutcomes: 3, review: 1 }, 60, 3), pendingGenerated: [] },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R1")).toBe(true);
  });

  it("Seed 2 -> R3: derived finding text truncated mid-abbreviation ('(e.')", () => {
    const entries = {
      "6.2.1": {
        gd4ItemId: "6.2.1",
        specific: [
          line({ id: "L1", clause: "6.2.1.DS2", sourceRef: "6.2.1.DS2", status: "Not met", evidence: [ev({ sufficiency: "Missing", apsr: apsrWith({ review: { status: "Not evident", note: "Documented, as shown in the policy (e.g. minutes and agendas)." } }) })] }),
        ],
        holisticBand: bandRec({ approach: 4, processes: 1, systemsOutcomes: 1, review: 1 }, 35, 2),
        pendingGenerated: [],
      },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R3")).toBe(true);
  });

  it("Seed 3 -> R4: a Weakness-labelled row whose dimension status is positive", () => {
    const entries = {
      "6.2.1": {
        gd4ItemId: "6.2.1",
        specific: [
          line({ id: "L1", clause: "6.2.1.DS1.b", sourceRef: "6.2.1.DS1.b", status: "Not met", evidence: [ev({ sufficiency: "Missing", apsr: apsrWith({ approach: { status: "Meeting", note: "The approach is well documented and fully approved." } }) })] }),
        ],
        holisticBand: bandRec({ approach: 4, processes: 1, systemsOutcomes: 1, review: 1 }, 35, 2),
        pendingGenerated: [],
      },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R4")).toBe(true);
  });

  it("Seed 4 -> R2: an open finding whose source line has moved to Met", () => {
    const entries = {
      "6.2.1": {
        gd4ItemId: "6.2.1",
        specific: [
          line({
            id: "L1", clause: "6.2.1.DS2", sourceRef: "6.2.1.DS2", status: "Met",
            draftFinding: { gd4ItemId: "6.2.1", clause: "6.2.1.DS2", issue: "Follow-up log missing", severity: "Medium", suggestedAction: "File it", savedFindingId: "F-STALE" },
            evidence: [ev({ sufficiency: "Present", apsr: apsrWith({ review: { status: "Evident", note: "The follow-up action log is complete." } }) })],
          }),
        ],
        holisticBand: bandRec({ approach: 5, processes: 3, systemsOutcomes: 3, review: 1 }, 60, 3),
        pendingGenerated: [],
      },
    };
    const findings = [finding({ id: "F-STALE", clause: "6.2.1.DS2", status: "Open" })];
    const issues = runConsistencyChecks(inputsFrom(entries, findings));
    expect(fired(issues, "R2")).toBe(true);
  });

  it("Seed 5 -> R5: all lines assessed but the item reads as not started", () => {
    const entries = {
      "6.2.1": {
        gd4ItemId: "6.2.1",
        // Every line assessed, but NO band saved -> no override -> band 0 -> "not started".
        specific: [
          line({ id: "L1", clause: "6.2.1.DS1.b", status: "Met", evidence: [] }),
          line({ id: "L2", clause: "6.2.1.DS2", status: "Not met", evidence: [] }),
        ],
        pendingGenerated: [],
      },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R5")).toBe(true);
  });
});

describe("Consistency Checker - a clean, internally consistent workspace produces zero flags", () => {
  it("no rule fires on a coherent item + fresh finding", () => {
    const entries = {
      "6.2.1": {
        gd4ItemId: "6.2.1",
        specific: [
          // Approach strength: Met + Present, positive status - all consistent.
          line({ id: "L1", clause: "6.2.1.DS1.b", sourceRef: "6.2.1.DS1.b", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrWith({ approach: { status: "Meeting", note: "The management review agenda and inputs are fully documented." } }) })] }),
          // Review weakness: Not met + Missing, negative status - all consistent. Carries a fresh, still-open finding.
          line({
            id: "L2", clause: "6.2.1.DS2", sourceRef: "6.2.1.DS2", status: "Not met",
            draftFinding: { gd4ItemId: "6.2.1", clause: "6.2.1.DS2", issue: "No effectiveness check", severity: "Medium", suggestedAction: "Introduce an annual effectiveness check.", savedFindingId: "F-CLEAN" },
            evidence: [ev({ sufficiency: "Missing", suggestedAction: "Introduce an annual effectiveness check.", apsr: apsrWith({ review: { status: "Not evident", note: "No management-review effectiveness check is on file." } }) })],
          }),
        ],
        holisticBand: bandRec({ approach: 5, processes: 3, systemsOutcomes: 3, review: 1 }, 60, 3),
        pendingGenerated: [],
      },
    };
    const findings = [finding({ id: "F-CLEAN", clause: "6.2.1.DS2", status: "Open" })];
    const issues = runConsistencyChecks(inputsFrom(entries, findings));
    expect(issues).toEqual([]);
  });
});

describe("Consistency Checker - the remaining rules each fire on their own bad case", () => {
  it("R6: a saved band/percentage stale against its own matrix under the current scale", () => {
    const entries = {
      "6.2.1": { gd4ItemId: "6.2.1", specific: [line({ id: "L1", clause: "6.2.1.DS2", status: "Not met" })], holisticBand: bandRec({ approach: 5, processes: 3, systemsOutcomes: 3, review: 1 }, 40, 2), pendingGenerated: [] },
    };
    // Matrix sums to 60% -> Band 3, but the stored snapshot says 40% / Band 2.
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R6")).toBe(true);
  });

  it("R7: an override band saved from an incomplete matrix", () => {
    const entries = {
      // Only one dimension scored -> matrix incomplete. 25% -> Band 2, so the snapshot itself is not stale (isolates R7 from R6).
      "6.2.1": { gd4ItemId: "6.2.1", specific: [line({ id: "L1", clause: "6.2.1.DS2", status: "Not met" })], holisticBand: bandRec({ approach: 5 }, 25, 2), pendingGenerated: [] },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R7")).toBe(true);
  });

  it("R9: two open findings for the same line/gap", () => {
    const entries = { "6.2.1": { gd4ItemId: "6.2.1", specific: [], pendingGenerated: [] } };
    const findings = [
      finding({ id: "F-1", clause: "6.2.1.DS2", status: "Open" }),
      finding({ id: "F-2", clause: "6.2.1.DS2", status: "Open" }),
    ];
    const issues = runConsistencyChecks(inputsFrom(entries, findings));
    expect(fired(issues, "R9")).toBe(true);
  });

  it("R10: a stored line status outside the allowed vocabulary", () => {
    const entries = {
      "6.2.1": { gd4ItemId: "6.2.1", specific: [line({ id: "L1", clause: "6.2.1.DS2", status: "Sort of met" as never })], pendingGenerated: [] },
    };
    const issues = runConsistencyChecks(inputsFrom(entries));
    expect(fired(issues, "R10")).toBe(true);
  });

  it("R8: the sentinel-sync check flags drifted copies but passes the real constants", () => {
    // The real three constants are in sync, so the engine does not flag R8 on a clean workspace.
    expect(checkSentinelSync(OPTION_A_NOT_ASSESSED_NOTE, NOT_ASSESSED_FINDING, NOT_ASSESSED_AFI)).toBe(true);
    // A drifted display copy (detection prefix removed) is caught.
    expect(checkSentinelSync(OPTION_A_NOT_ASSESSED_NOTE, "Run the staged audit to assess this dimension.", NOT_ASSESSED_AFI)).toBe(false);
    // A drifted AFI tail (no longer contained in the finding) is caught.
    expect(checkSentinelSync(OPTION_A_NOT_ASSESSED_NOTE, NOT_ASSESSED_FINDING, "Do something entirely different.")).toBe(false);
  });
});
