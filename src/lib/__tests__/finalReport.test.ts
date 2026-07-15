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

describe("buildFinalReport — findingsGroups (overall summary + per-line findings table)", () => {
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
    gd4ItemId: "6.2.1",
    specific: [
      // Approach: TWO Met/sufficient lines -> strength.
      line({ id: "L1", clause: "6.2.1.DS1.a", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "The management review procedure names its own owner and cadence.") })] }),
      line({ id: "L2", clause: "6.2.1.DS1.b", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "A second, unrelated strength note.") })] }),
      // Processes: one strength, one weakness, each with real text.
      line({ id: "L3", clause: "6.2.1.DS2", apsrDimension: "Processes", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("processes", "Management review minutes are documented and evidenced for every quarter.") })] }),
      line({
        id: "L4", clause: "6.2.1.DS3", apsrDimension: "Processes", status: "Not met",
        evidence: [ev({
          sufficiency: "Missing",
          suggestedAction: "File the missing follow-up action log for Q3.",
          apsr: apsrFor("processes", "There is no follow-up action log for the Q3 management review."),
        })],
      }),
      // Systems & Outcomes: the SAME clause ref as Processes' L3 (6.2.1.DS2)
      // backs a DIFFERENT line tagged to a different dimension, with its own
      // distinct weakness — must appear as its own row, never merged with L3.
      line({
        id: "L5", clause: "6.2.1.DS2", apsrDimension: "Systems & Outcomes", status: "Partial",
        evidence: [ev({
          sufficiency: "Weak",
          suggestedAction: "Add outcome trend data for the last two review cycles.",
          apsr: apsrFor("systemsOutcomes", "Outcome trend data is not tracked across review cycles."),
        })],
      }),
      // Review: a real gap line with NO recorded diagnosis or action -> honest per-line fallback.
      line({ id: "L6", clause: "6.2.1.EE9", apsrDimension: "Review", status: "Not met", evidence: [] }),
      // Untagged line — must not feed any dimension.
      line({ id: "L7", apsrDimension: undefined, status: "Not met", evidence: [] }),
    ],
    // pcts: approach 25, processes 15, systemsOutcomes 15, review 5 -> total
    // 60%, Band 3 (threshold 60), and Review (the unique lowest) is exactly
    // one band-step from crossing into Band 4 -- a clean single-dimension
    // "limiting factor" case for the overall summary to state plainly.
    holisticBand: {
      band: 3, totalPct: 60,
      matrixScores: { approach: 5, processes: 3, systemsOutcomes: 3, review: 1 },
      rationale: "Approach: Band 5. Processes: Band 3. Systems & Outcomes: Band 3. Review: Band 1. Overall: Band 3.",
      source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("returns all four scored dimension groups, in order", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    expect(item.findingsGroups.map((g) => g.key)).toEqual(["approach", "processes", "systemsOutcomes", "review"]);
  });

  it("(a) the overall summary states band, %, strong dimension and the limiting dimension with a real AFI count", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    expect(item.overallSummary).toContain("Band 3");
    expect(item.overallSummary).toContain("60%");
    expect(item.overallSummary).toContain("Approach"); // the strong dimension
    expect(item.overallSummary).toContain("Review"); // the limiting (cheapest-to-raise) dimension
    expect(item.overallSummary).toContain("1 AFI"); // Review's single real weakness row
    expect(item.overallSummary).toContain("Band 4"); // the next band
  });

  it("(b) a strength row states plainly what's evidenced, with a blank AFI", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const strengthRow = processes.rows.find((r) => r.lineId === "L3")!;
    expect(strengthRow.isWeakness).toBe(false);
    expect(strengthRow.itemRef).toBe("6.2.1.DS2");
    expect(strengthRow.finding).toBe("Management review minutes are documented and evidenced for every quarter.");
    expect(strengthRow.afi).toBeUndefined();
  });

  it("(b) a weakness row states 'Weakness — ' plus the real diagnosis, with the real AFI text", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const weaknessRow = processes.rows.find((r) => r.lineId === "L4")!;
    expect(weaknessRow.isWeakness).toBe(true);
    expect(weaknessRow.itemRef).toBe("6.2.1.DS3");
    expect(weaknessRow.finding).toBe("Weakness — There is no follow-up action log for the Q3 management review.");
    expect(weaknessRow.afi).toBe("File the missing follow-up action log for Q3.");
  });

  it("(c) a clause ref shared across two dimensions produces two DISTINCT rows, one per dimension, never merged", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processesRow = item.findingsGroups.find((g) => g.key === "processes")!.rows.find((r) => r.itemRef === "6.2.1.DS2")!;
    const outcomesRow = item.findingsGroups.find((g) => g.key === "systemsOutcomes")!.rows.find((r) => r.itemRef === "6.2.1.DS2")!;
    expect(processesRow.lineId).toBe("L3");
    expect(processesRow.isWeakness).toBe(false);
    expect(outcomesRow.lineId).toBe("L5");
    expect(outcomesRow.isWeakness).toBe(true);
    expect(outcomesRow.finding).toBe("Weakness — Outcome trend data is not tracked across review cycles.");
    expect(outcomesRow.afi).toBe("Add outcome trend data for the last two review cycles.");
  });

  it("(d) a weakness line with no recorded diagnosis/action still gets an honest fallback row, never dropped", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const review = item.findingsGroups.find((g) => g.key === "review")!;
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0].lineId).toBe("L6");
    expect(review.rows[0].finding).toBe("Weakness — No detailed diagnosis recorded for this line.");
    expect(review.rows[0].afi).toBe("No concrete suggested action recorded for this line.");
  });

  it("an untagged line never feeds any dimension group", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const allRowIds = item.findingsGroups.flatMap((g) => g.rows.map((r) => r.lineId));
    expect(allRowIds).not.toContain("L7");
  });

  it("an item with no holisticBand.matrixScores yet has an empty findingsGroups and no overallSummary — never a fabricated breakdown", () => {
    const report = buildFinalReport(scored, {}, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    expect(item.findingsGroups).toEqual([]);
    expect(item.overallSummary).toBeUndefined();
  });

  it("a scored dimension with zero tagged lines still gets a group with an empty rows array, never omitted", () => {
    const sparse: SubCriterionChecklistEntry = {
      gd4ItemId: "6.2.1",
      specific: [line({ id: "L1", clause: "6.2.1.DS1.a", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "Real strength text.") })] })],
      holisticBand: {
        band: 1, totalPct: 20,
        matrixScores: { approach: 5, processes: 0, systemsOutcomes: 0, review: 0 },
        rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
      },
      pendingGenerated: [],
    };
    const report = buildFinalReport(scored, { "6.2.1": sparse }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    expect(processes).toBeDefined();
    expect(processes.rows).toEqual([]);
  });
});
