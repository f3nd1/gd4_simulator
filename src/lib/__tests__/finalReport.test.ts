import { describe, it, expect } from "vitest";
import { buildFinalReport } from "../finalReport";
import { OPTION_A_NOT_ASSESSED_NOTE } from "../optionAChecklistWrite";
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

  it("(a-Task1) the overall summary is analytical/prescriptive: diagnoses the pattern + one priority action, and NEVER repeats the band number or %", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const s = item.overallSummary!;
    // approach 5 (strong), review 1 (weak) → diagnosis contrasts the two.
    expect(s).toContain("The approach is clearly documented");
    expect(s).toMatch(/reviewed for effectiveness/i);
    // Prescriptive: names a single highest-priority step, phrased as an action
    // (a verb), not a bare list of dimension names to "raise".
    expect(s).toContain("The single highest-priority step is to");
    // Must NOT restate the band/% already shown in the panel header above it.
    expect(s).not.toMatch(/Band \d/);
    expect(s).not.toMatch(/\d+%/);
    expect(s).not.toMatch(/\bAFIs?\b/); // no "Closing N AFIs" restatement either
  });

  it("(b-Task2) a strength row under a sub-Band-5 item now carries a maintenance AFI, not a blank", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    // This ENTRY's holistic matrix sums to 60% → Band 3 (below 5).
    expect(item.bandTotalPct).toBe(60);
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const strengthRow = processes.rows.find((r) => r.lineId === "L3")!;
    expect(strengthRow.verdict).toBe("strength");
    expect(strengthRow.itemRef).toBe("6.2.1.DS2");
    expect(strengthRow.finding).toBe("Management review minutes are documented and evidenced for every quarter.");
    // Task 2: strengths are not automatically audit-proof below Band 5.
    expect(strengthRow.afi).toBe("Keep this in place and re-evidence it at each review cycle so it stays audit-ready.");
  });

  it("(b) a weakness row carries the clean real diagnosis (label lives in the UI, not the text) with the real AFI text", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const weaknessRow = processes.rows.find((r) => r.lineId === "L4")!;
    expect(weaknessRow.verdict).toBe("weakness");
    expect(weaknessRow.itemRef).toBe("6.2.1.DS3");
    expect(weaknessRow.finding).toBe("There is no follow-up action log for the Q3 management review.");
    expect(weaknessRow.finding).not.toMatch(/weakness/i);
    expect(weaknessRow.afi).toBe("File the missing follow-up action log for Q3.");
  });

  it("(c) a clause ref shared across two dimensions produces two DISTINCT rows, one per dimension, never merged", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processesRow = item.findingsGroups.find((g) => g.key === "processes")!.rows.find((r) => r.itemRef === "6.2.1.DS2")!;
    const outcomesRow = item.findingsGroups.find((g) => g.key === "systemsOutcomes")!.rows.find((r) => r.itemRef === "6.2.1.DS2")!;
    expect(processesRow.lineId).toBe("L3");
    expect(processesRow.verdict).toBe("strength");
    expect(outcomesRow.lineId).toBe("L5");
    expect(outcomesRow.verdict).toBe("weakness");
    expect(outcomesRow.finding).toBe("Outcome trend data is not tracked across review cycles.");
    expect(outcomesRow.afi).toBe("Add outcome trend data for the last two review cycles.");
  });

  it("(d) a weakness line with no recorded diagnosis/action still gets an honest fallback row, never dropped", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const review = item.findingsGroups.find((g) => g.key === "review")!;
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0].lineId).toBe("L6");
    expect(review.rows[0].verdict).toBe("weakness");
    expect(review.rows[0].finding).toBe("No detailed diagnosis recorded for this line.");
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

describe("buildFinalReport — 'not assessed' is a distinct third state, never a weakness (Task 5)", () => {
  function ev(over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem {
    return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", ...over };
  }
  function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
    return { text: "x", status: "Met", evidence: [], generatedBy: "ai", ...over };
  }
  // The exact APSR shape Option A writes: Approach/Processes carry the real
  // assessment; Systems & Outcomes and Review carry the not-assessed sentinel.
  function optionAApsr(): ApsrBreakdown {
    return {
      approach: { status: "Meeting", note: "Policy documents the review approach." },
      processes: { status: "Deployed", note: "Records show the review being run." },
      systemsOutcomes: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
      review: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
    };
  }

  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "6.3.1",
    specific: [
      // A line tagged to Systems & Outcomes, Not met — WITHOUT the third
      // state this would read as a red "Weakness" even though Option A never
      // assessed the dimension.
      line({ id: "S1", clause: "6.3.1.DS1", apsrDimension: "Systems & Outcomes", status: "Not met", evidence: [ev({ sufficiency: "Missing", apsr: optionAApsr() })] }),
      // A line tagged to Review, Met — WITHOUT the third state this would read
      // as a green strength quoting the not-assessed note. Same fact, two
      // colours: exactly the bug being fixed.
      line({ id: "R1", clause: "6.3.1.DS2", apsrDimension: "Review", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: optionAApsr() })] }),
      // A genuinely-assessed Processes weakness stays a weakness.
      line({ id: "P1", clause: "6.3.1.DS3", apsrDimension: "Processes", status: "Not met", evidence: [ev({ sufficiency: "Missing", suggestedAction: "File the records.", apsr: optionAApsr() })] }),
    ],
    holisticBand: {
      band: 2, totalPct: 35,
      matrixScores: { approach: 4, processes: 1, systemsOutcomes: 1, review: 1 },
      rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("a line whose dimension note is the Option A not-assessed sentinel renders as 'not-assessed', regardless of the line's status", () => {
    const report = buildFinalReport(scored, { "6.3.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.3.1")!;
    const soRow = item.findingsGroups.find((g) => g.key === "systemsOutcomes")!.rows[0];
    const reviewRow = item.findingsGroups.find((g) => g.key === "review")!.rows[0];
    // Not met (S1) and Met (R1) — same underlying not-assessed state, so BOTH
    // must be "not-assessed", never "weakness" or "strength".
    expect(soRow.verdict).toBe("not-assessed");
    expect(reviewRow.verdict).toBe("not-assessed");
    // Consistent, house-style finding text with no em dash, no "Weakness".
    expect(soRow.finding).toBe(reviewRow.finding);
    expect(soRow.finding).not.toMatch(/weakness/i);
    expect(soRow.finding).not.toContain("—");
    // The AFI column is never blank on a non-strength row (Task 4): a
    // not-assessed row carries the actionable "run the staged audit / attach
    // evidence" step, not undefined.
    expect(soRow.afi).toBe("Run the staged audit or attach outcome or review evidence to assess this dimension.");
    expect(reviewRow.afi).toBe(soRow.afi);
  });

  it("a genuinely-assessed line on the same item is still a weakness (the sentinel check does not swallow real findings)", () => {
    const report = buildFinalReport(scored, { "6.3.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.3.1")!;
    const pRow = item.findingsGroups.find((g) => g.key === "processes")!.rows[0];
    expect(pRow.verdict).toBe("weakness");
    expect(pRow.afi).toBe("File the records.");
  });

  it("(Task 1) the overall summary is a tight diagnosis + one priority action, with no band/% restatement", () => {
    const report = buildFinalReport(scored, { "6.3.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.3.1")!;
    const s = item.overallSummary!;
    const sentenceCount = s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    expect(sentenceCount).toBeGreaterThanOrEqual(2);
    expect(sentenceCount).toBeLessThanOrEqual(4);
    // approach 4 (strong) vs processes/systemsOutcomes/review 1 (weak): the
    // classic "documented but not acted on / measured / reviewed" pattern.
    expect(s).toContain("The approach is clearly documented");
    expect(s).toContain("The single highest-priority step is to");
    expect(s).not.toMatch(/Band \d/);
    expect(s).not.toMatch(/\d+%/);
  });
});
