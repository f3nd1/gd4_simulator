import { describe, it, expect } from "vitest";
import { buildFinalReport } from "../finalReport";
import { buildScored } from "../scoring";
import { blankEvidence } from "../../data/seedEvidence";
import { GD4_CRITERIA } from "../../data/gd4Requirements";
import type { Finding, SubCriterionChecklistEntry, SpecificChecklistLine, SubChecklistEvidenceItem } from "../../types";

// Minimal real Scored (blank evidence → every item unstarted) — the findings
// section is what these tests exercise.
const scored = buildScored({ evidence: blankEvidence(), reviewer: {}, confirmed: {}, closures: {} });

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1", auditCycleId: "cycle-1", gd4ItemId: "4.4.1", issue: "Refund table mismatch",
    type: "AFI", severity: "Medium", owner: "", dueDate: "", repeatFinding: false,
    overdue: false, managementDecisionNeeded: false, status: "Open", ...over,
  };
}

describe("buildFinalReport — findings carry the RESOLVED classification (Batch 2)", () => {
  it("uses findingType/ncSeverity (which the panel updates), not the raw legacy fields", () => {
    const f = finding({ findingType: "NC", ncSeverity: "Major", type: "AFI", severity: "Medium" });
    const report = buildFinalReport(scored, {}, [f], {});
    expect(report.findings[0].type).toBe("NC");        // not the legacy "AFI"
    expect(report.findings[0].severity).toBe("Major"); // panel/classification severity wins
  });

  it("a finding with no classification resolves to the NC/Minor default — consistent with the register", () => {
    const report = buildFinalReport(scored, {}, [finding()], {});
    expect(report.findings[0].type).toBe("NC");
    expect(report.findings[0].severity).toBe("Minor");
  });

  it("OFI/OBS findings show their type with the legacy severity as fallback", () => {
    const report = buildFinalReport(scored, {}, [finding({ findingType: "OFI", severity: "Low" })], {});
    expect(report.findings[0].type).toBe("OFI");
    expect(report.findings[0].severity).toBe("Low"); // OFI has no NC severity → legacy fallback
  });
});

describe("buildFinalReport — subCriteria rollup (Task 1)", () => {
  it("computes a band/points/started rollup for every real sub-criterion, using the SAME band/points formula the criterion level uses", () => {
    const report = buildFinalReport(scored, {}, [], {});
    const sc11 = report.subCriteria.find((s) => s.id === "1.1")!;
    expect(sc11).toBeDefined();
    expect(sc11.criterionId).toBe("1");
    expect(sc11.title.length).toBeGreaterThan(0);
    // blankEvidence -> every item unstarted (eff=0) -> "started" false, points 0,
    // but band still reads getBand(bandToScore(1))=1 (no floor, same as criterion).
    expect(sc11.started).toBe(false);
    expect(sc11.scored).toBe(0);
    expect(sc11.band).toBe(1);
  });

  it("a criterion's sub-criteria points sum back to (approximately) the criterion's own official points", () => {
    const report = buildFinalReport(scored, {}, [], {});
    for (const crit of GD4_CRITERIA) {
      const subs = report.subCriteria.filter((s) => s.criterionId === crit.id);
      if (subs.length === 0) continue;
      const total = subs.reduce((a, s) => a + s.points, 0);
      expect(total).toBeCloseTo(crit.points, 5);
    }
  });
});

describe("buildFinalReport — dimensionSummaries (Task 3, plain-language restructuring)", () => {
  function ev(over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem {
    return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", ...over };
  }
  function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
    return { text: "x", status: "Met", evidence: [], generatedBy: "ai", ...over };
  }

  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "2.1.1",
    specific: [
      // Approach: Met, sufficient evidence -> no gap, no missing/howToImprove.
      line({ id: "L1", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present" })] }),
      // Processes: real gap, with both a real diagnosis and a real suggested action.
      line({
        id: "L2", apsrDimension: "Processes", status: "Not met",
        evidence: [ev({
          sufficiency: "Missing",
          suggestedAction: "Add the missing shortlisting matrix for the two recent appointments.",
          apsr: {
            approach: { status: "Meeting", note: "" },
            processes: { status: "Not evident", note: "There are no shortlisting matrices on file for any appointment this cycle." },
            systemsOutcomes: { status: "Not evident", note: "" },
            review: { status: "Not evident", note: "" },
          },
        })],
      }),
      // Untagged line — must not feed any dimension.
      line({ id: "L3", apsrDimension: undefined, status: "Not met", evidence: [] }),
    ],
    holisticBand: {
      band: 2, totalPct: 25,
      matrixScores: { approach: 4, processes: 1, systemsOutcomes: 0, review: 0 },
      rationale: "Approach: Band 4 — policy documented (2.1.1.DS1.a). Processes: Band 1 — no implementation records (2.1.1.DS1.b). Overall: Band 2.",
      source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("returns all four scored dimensions, each reading its own real per-line data", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    expect(item.dimensionSummaries.map((d) => d.key)).toEqual(["approach", "processes", "systemsOutcomes", "review"]);
  });

  it("a Met, sufficient-evidence dimension has no gap and no missing/howToImprove text", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const approach = item.dimensionSummaries.find((d) => d.key === "approach")!;
    expect(approach.band).toBe(4);
    expect(approach.hasGap).toBe(false);
    expect(approach.missing).toBeUndefined();
    expect(approach.howToImprove).toBeUndefined();
    // Finding is the verbatim official §23 descriptor for Band 4 Approach — no citation codes.
    expect(approach.finding).not.toMatch(/2\.1\.1/);
  });

  it("a real gap surfaces the REAL per-line diagnosis and suggested action verbatim, not a template", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const processes = item.dimensionSummaries.find((d) => d.key === "processes")!;
    expect(processes.hasGap).toBe(true);
    expect(processes.missing).toBe("There are no shortlisting matrices on file for any appointment this cycle.");
    expect(processes.howToImprove).toBe("Add the missing shortlisting matrix for the two recent appointments.");
  });

  it("a scored-but-untagged dimension (no lines point to it) has no gap and no fabricated text", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const outcomes = item.dimensionSummaries.find((d) => d.key === "systemsOutcomes")!;
    expect(outcomes.band).toBe(0);
    expect(outcomes.finding).toContain("genuine 0% floor");
    expect(outcomes.hasGap).toBe(false);
    expect(outcomes.missing).toBeUndefined();
  });

  it("an item with no holisticBand.matrixScores yet has an empty dimensionSummaries — never a fabricated breakdown", () => {
    const report = buildFinalReport(scored, {}, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    expect(item.dimensionSummaries).toEqual([]);
  });
});
