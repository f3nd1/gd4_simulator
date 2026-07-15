import { describe, it, expect } from "vitest";
import { buildFinalReport } from "../finalReport";
import { buildScored } from "../scoring";
import { blankEvidence } from "../../data/seedEvidence";
import { GD4_CRITERIA } from "../../data/gd4Requirements";
import type { Finding, SubCriterionChecklistEntry, SpecificChecklistLine, SubChecklistEvidenceItem, ApsrBreakdown } from "../../types";

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

describe("buildFinalReport — dimensionSummaries (numbered gap/fix pairs + strength reasons)", () => {
  function ev(over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem {
    return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", ...over };
  }
  function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
    return { text: "x", status: "Met", evidence: [], generatedBy: "ai", ...over };
  }
  function apsrFor(dimKey: "approach" | "processes" | "systemsOutcomes" | "review", note: string): ApsrBreakdown {
    return {
      approach: { status: "Meeting", note: dimKey === "approach" ? note : "" },
      processes: { status: "Deployed", note: dimKey === "processes" ? note : "" },
      systemsOutcomes: { status: "Evident", note: dimKey === "systemsOutcomes" ? note : "" },
      review: { status: "Evident", note: dimKey === "review" ? note : "" },
    };
  }

  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "2.1.1",
    specific: [
      // Approach: TWO Met/sufficient lines with real text -> strength, first one's text quoted.
      line({ id: "L1", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "The HR policy names the recruitment owner and approval chain.") })] }),
      line({ id: "L2", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "A second, unrelated strength note.") })] }),
      // Processes: TWO DISTINCT real gaps, each with its own diagnosis and fix.
      line({
        id: "L3", apsrDimension: "Processes", status: "Not met",
        evidence: [ev({
          sufficiency: "Missing",
          suggestedAction: "Add the missing shortlisting matrix for the two recent appointments.",
          apsr: apsrFor("processes", "There are no shortlisting matrices on file for any appointment this cycle."),
        })],
      }),
      line({
        id: "L4", apsrDimension: "Processes", status: "Partial",
        evidence: [ev({
          sufficiency: "Weak",
          suggestedAction: "File the missing appraisal forms for the two staff hired in Q2.",
          apsr: apsrFor("processes", "Appraisal records exist for most staff but two recent hires have none on file."),
        })],
      }),
      // Review: a real gap line with NO recorded diagnosis or action -> honest per-line fallback.
      line({ id: "L5", apsrDimension: "Review", status: "Not met", evidence: [] }),
      // Untagged line — must not feed any dimension.
      line({ id: "L6", apsrDimension: undefined, status: "Not met", evidence: [] }),
    ],
    holisticBand: {
      band: 2, totalPct: 30,
      matrixScores: { approach: 5, processes: 1, systemsOutcomes: 0, review: 1 },
      rationale: "Approach: Band 5. Processes: Band 1. Systems & Outcomes: Band 0. Review: Band 1. Overall: Band 2.",
      source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("returns all four scored dimensions", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    expect(item.dimensionSummaries.map((d) => d.key)).toEqual(["approach", "processes", "systemsOutcomes", "review"]);
  });

  it("a genuine strength dimension gets a one-sentence reason, not a bare label, quoting the real per-line text", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const approach = item.dimensionSummaries.find((d) => d.key === "approach")!;
    expect(approach.band).toBe(5);
    expect(approach.gaps).toEqual([]);
    expect(approach.strengthReason).toBe("The HR policy names the recruitment owner and approval chain.");
    expect(approach.noLinesTagged).toBe(false);
  });

  it("a dimension with TWO distinct real gaps reports TWO separate gap/fix pairs, never merged into one paragraph", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const processes = item.dimensionSummaries.find((d) => d.key === "processes")!;
    expect(processes.gaps).toHaveLength(2);
    expect(processes.gaps[0]).toEqual({
      lineId: "L3",
      gap: "There are no shortlisting matrices on file for any appointment this cycle.",
      fix: "Add the missing shortlisting matrix for the two recent appointments.",
    });
    expect(processes.gaps[1]).toEqual({
      lineId: "L4",
      gap: "Appraisal records exist for most staff but two recent hires have none on file.",
      fix: "File the missing appraisal forms for the two staff hired in Q2.",
    });
    expect(processes.strengthReason).toBeUndefined();
    expect(processes.noLinesTagged).toBe(false);
  });

  it("a real gap line with no recorded diagnosis still gets its own honest entry, never dropped", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const review = item.dimensionSummaries.find((d) => d.key === "review")!;
    expect(review.gaps).toHaveLength(1);
    expect(review.gaps[0].lineId).toBe("L5");
    expect(review.gaps[0].gap).toBe("No detailed diagnosis recorded for this line.");
    expect(review.gaps[0].fix).toBeUndefined();
  });

  it("a scored-but-untagged dimension shows the honest 'no lines tagged' placeholder, never a fabricated strength", () => {
    const report = buildFinalReport(scored, { "2.1.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    const outcomes = item.dimensionSummaries.find((d) => d.key === "systemsOutcomes")!;
    expect(outcomes.band).toBe(0);
    expect(outcomes.gaps).toEqual([]);
    expect(outcomes.strengthReason).toBeUndefined();
    expect(outcomes.noLinesTagged).toBe(true);
  });

  it("an item with no holisticBand.matrixScores yet has an empty dimensionSummaries — never a fabricated breakdown", () => {
    const report = buildFinalReport(scored, {}, [], {});
    const item = report.items.find((i) => i.id === "2.1.1")!;
    expect(item.dimensionSummaries).toEqual([]);
  });
});
