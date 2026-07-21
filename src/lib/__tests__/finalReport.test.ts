import { describe, it, expect } from "vitest";
import { buildFinalReport, firstSentence, findingGapNature, eligibleSuggestionDims, suggestionKey, buildAiSuggestionUserPrompt, filterAiSuggestions, filterDimensionNarratives, stripChunkMarkers, stripLeadingFragment, findingParagraphs, splitEvidenceNote, needsConciseSummary, qualifyingConciseRows, buildConciseUserPrompt, filterConciseSummaries, type ItemReport } from "../finalReport";
import { bandLevel } from "../../data/edutrustRubric";
import { OPTION_A_NOT_ASSESSED_NOTE } from "../optionAChecklistWrite";
import { buildScored } from "../scoring";
import { blankEvidence } from "../../data/seedEvidence";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import { computeChecklistOverrides, apsrMatrixResult } from "../checklistBanding";
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
  // `status` overrides the noted dimension's own leg status — weakness-intent
  // fixture lines must carry a realistic negative/middle leg (the row verdict
  // now derives from the leg, per the Bug A / R4 fix).
  function apsrFor(dimKey: "approach" | "processes" | "systemsOutcomes" | "review", note: string, status?: string): ApsrBreakdown {
    const base: ApsrBreakdown = {
      approach: { status: "Meeting", note: dimKey === "approach" ? note : "" },
      processes: { status: "Deployed", note: dimKey === "processes" ? note : "" },
      systemsOutcomes: { status: "Evident", note: dimKey === "systemsOutcomes" ? note : "" },
      review: { status: "Evident", note: dimKey === "review" ? note : "" },
    };
    if (status) (base[dimKey] as { status: string }).status = status;
    return base;
  }

  // Lines are grouped by their AUTHORITATIVE dimension — resolved from the
  // official source ref (resolveLineDimension), NOT the stored apsrDimension.
  // Real 6.2.1 ref → dimension: DS1.b→Approach, EE2/EE3→Processes, DS1.a→
  // Systems & Outcomes, DS2/DS4→Review.
  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "6.2.1",
    specific: [
      // Approach (DS1.b): a Met/sufficient line -> strength.
      line({ id: "L1", clause: "6.2.1.DS1.b", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("approach", "The management review procedure names its own owner and cadence.") })] }),
      // Processes (EE2): a strength.
      line({ id: "L3", clause: "6.2.1.EE2", apsrDimension: "Processes", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("processes", "Management review minutes are documented and evidenced for every quarter.") })] }),
      // Processes (EE3): a weakness with real text.
      line({
        id: "L4", clause: "6.2.1.EE3", apsrDimension: "Processes", status: "Not met",
        evidence: [ev({
          sufficiency: "Missing",
          suggestedAction: "File the missing follow-up action log for Q3.",
          apsr: apsrFor("processes", "There is no follow-up action log for the Q3 management review.", "Not evident"),
        })],
      }),
      // Systems & Outcomes (DS1.a): a weakness.
      line({
        id: "L5", clause: "6.2.1.DS1.a", apsrDimension: "Systems & Outcomes", status: "Partial",
        evidence: [ev({
          sufficiency: "Weak",
          suggestedAction: "Add outcome trend data for the last two review cycles.",
          apsr: apsrFor("systemsOutcomes", "Outcome trend data is not tracked across review cycles.", "Limited"),
        })],
      }),
      // Review (DS2): a real gap line with NO recorded diagnosis or action -> honest per-line fallback.
      line({ id: "L6", clause: "6.2.1.DS2", apsrDimension: "Review", status: "Not met", evidence: [] }),
      // Review (DS4) but MIS-TAGGED "Approach" in the stored field — the Task 3
      // fix must group it by its ref (Review), never by the wrong stored tag.
      line({ id: "L-mis", clause: "6.2.1.DS4", apsrDimension: "Approach", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: apsrFor("review", "The management-review process is reviewed annually for effectiveness.") })] }),
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

  it("(a-Task1) the overall summary names the constraining dimension from its REAL band + gives one grounded priority step, with no % restatement", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const s = item.overallSummary!;
    // approach 5 (strong) named as well-evidenced; review 1 named directly as
    // the constraint AT ITS OWN BAND (per the 2026-07-19 rework — the TLDR now
    // pulls the weak dimension's band straight from matrixScores).
    expect(s).toMatch(/Approach is well evidenced/);
    expect(s).toMatch(/review remains at Band 1 and is the main constraint/i);
    // One priority step, auditor register (no "single highest-priority step").
    expect(s).toContain("The most immediate priority is");
    // Still no OVERALL band/% restatement (the panel header shows those); a
    // per-dimension band ("Review remains at Band 1") is new, intended info.
    expect(s).not.toMatch(/\d+%/);
    expect(s).not.toMatch(/\bAFIs?\b/);
  });

  it("(b-Task2) a strength row's AFI quotes the NEXT band's rubric descriptor for ITS OWN dimension, verbatim", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    // Processes dimension is Band 3 in this ENTRY's matrix; the strength AFI
    // must cite Band 4 for Processes (verbatim from EDUTRUST_BANDS), gated on
    // the dimension's OWN band, not the item's overall band.
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const strengthRow = processes.rows.find((r) => r.lineId === "L3")!;
    expect(strengthRow.verdict).toBe("strength");
    expect(strengthRow.itemRef).toBe("6.2.1.EE2");
    expect(strengthRow.finding).toBe("Management review minutes are documented and evidenced for every quarter.");
    expect(strengthRow.afi).toBe('Band 3 strength. To reach Band 4 on Processes, the EduTrust rubric looks for: "Intended processes are well-managed by owners; desired outputs are produced by these processes". Keep this evidenced and build toward that at the next review cycle.');
  });

  it("(b-Task2b) a strength on a dimension already at Band 5 gets a BLANK AFI (nothing higher to cite)", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    // Approach is Band 5 in this ENTRY's matrix; L1 (DS1.b) is a strength there.
    const approach = item.findingsGroups.find((g) => g.key === "approach")!;
    const strengthRow = approach.rows.find((r) => r.lineId === "L1")!;
    expect(strengthRow.verdict).toBe("strength");
    expect(strengthRow.afi).toBeUndefined();
  });

  it("(b) a weakness row carries the clean real diagnosis (label lives in the UI, not the text) with the real AFI text", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const weaknessRow = processes.rows.find((r) => r.lineId === "L4")!;
    expect(weaknessRow.verdict).toBe("weakness");
    expect(weaknessRow.itemRef).toBe("6.2.1.EE3");
    expect(weaknessRow.finding).toBe("There is no follow-up action log for the Q3 management review.");
    expect(weaknessRow.finding).not.toMatch(/weakness/i);
    expect(weaknessRow.afi).toBe("File the missing follow-up action log for Q3.");
  });

  it("(Task 3) a line is grouped by its OFFICIAL ref, not its stored apsrDimension — a mis-tagged line lands under the right dimension", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    // L-mis carries a stored tag of "Approach" but its ref 6.2.1.DS4 is a Review
    // point — the report must show it under Review, and NEVER under Approach.
    const approach = item.findingsGroups.find((g) => g.key === "approach")!;
    const review = item.findingsGroups.find((g) => g.key === "review")!;
    expect(approach.rows.map((r) => r.lineId)).not.toContain("L-mis");
    expect(review.rows.map((r) => r.lineId)).toContain("L-mis");
    // The Systems & Outcomes gap line (DS1.a) also lands by ref, not by needing
    // the one "Accept" button to have tagged it.
    const outcomes = item.findingsGroups.find((g) => g.key === "systemsOutcomes")!;
    const outcomesRow = outcomes.rows.find((r) => r.lineId === "L5")!;
    expect(outcomesRow.itemRef).toBe("6.2.1.DS1.a");
    expect(outcomesRow.verdict).toBe("weakness");
    expect(outcomesRow.afi).toBe("Add outcome trend data for the last two review cycles.");
  });

  it("(d) a weakness line with no recorded diagnosis/action still gets an honest fallback row, never dropped", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const review = item.findingsGroups.find((g) => g.key === "review")!;
    const l6 = review.rows.find((r) => r.lineId === "L6")!;
    expect(l6.verdict).toBe("weakness");
    expect(l6.finding).toBe("No detailed diagnosis recorded for this line.");
    expect(l6.afi).toBe("No concrete suggested action recorded for this line.");
  });

  it("(Task 3) an untagged Option-A-style line (a ref but no apsrDimension) is still grouped by its ref, never dropped", () => {
    // Exactly what optionAChecklistWrite writes: sourceRef + text, no tag.
    const untagged: SubCriterionChecklistEntry = {
      gd4ItemId: "6.2.1",
      specific: [line({ id: "U1", sourceRef: "6.2.1.DS2", text: "Make use of the findings from the management review for continual improvement", apsrDimension: undefined, status: "Not met", evidence: [] })],
      holisticBand: { band: 2, totalPct: 35, matrixScores: { approach: 4, processes: 1, systemsOutcomes: 1, review: 1 }, rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z" },
      pendingGenerated: [],
    };
    const report = buildFinalReport(scored, { "6.2.1": untagged }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const review = item.findingsGroups.find((g) => g.key === "review")!;
    expect(review.rows.map((r) => r.lineId)).toContain("U1"); // DS2 → Review, by ref
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

  // Grouped by ref (resolveLineDimension): DS1.a→Systems & Outcomes, DS2→
  // Review, EE2→Processes — the dimensions Option A does vs does not assess.
  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "6.2.1",
    specific: [
      // Systems & Outcomes (DS1.a), Not met — WITHOUT the third state this would
      // read as a red "Weakness" even though Option A never assessed it.
      line({ id: "S1", clause: "6.2.1.DS1.a", apsrDimension: "Systems & Outcomes", status: "Not met", evidence: [ev({ sufficiency: "Missing", apsr: optionAApsr() })] }),
      // Review (DS2), Met — WITHOUT the third state this would read as a green
      // strength quoting the not-assessed note. Same fact, two colours.
      line({ id: "R1", clause: "6.2.1.DS2", apsrDimension: "Review", status: "Met", evidence: [ev({ sufficiency: "Present", apsr: optionAApsr() })] }),
      // A genuinely-assessed Processes (EE2) weakness stays a weakness — its
      // leg is "Not evident", as the real optionAApsr maps a Not met verdict.
      line({ id: "P1", clause: "6.2.1.EE2", apsrDimension: "Processes", status: "Not met", evidence: [ev({ sufficiency: "Missing", suggestedAction: "File the records.", apsr: { ...optionAApsr(), processes: { status: "Not evident", note: "No records show the review being run." } } })] }),
    ],
    holisticBand: {
      band: 2, totalPct: 35,
      matrixScores: { approach: 4, processes: 1, systemsOutcomes: 1, review: 1 },
      rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("a line whose dimension note is the Option A not-assessed sentinel renders as 'not-assessed', regardless of the line's status", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
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
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    // P1's OWN Processes row (found by lineId, not by position): cross-cutting
    // grouping means S1/R1 — which each carry a real Processes leg in this
    // optionAApsr fixture — now also appear under Processes as borrowed rows, so
    // P1 is no longer necessarily rows[0]. Its genuine weakness must survive.
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    const pRow = processes.rows.find((r) => r.lineId === "P1")!;
    expect(pRow.verdict).toBe("weakness");
    expect(pRow.afi).toBe("File the records.");
    expect(pRow.borrowed).toBeFalsy(); // EE2 → Processes is P1's HOME dimension
  });

  it("cross-cutting: a line whose home is elsewhere but which carries a real Processes leg appears under Processes too, marked borrowed", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    // S1 (home Systems & Outcomes) and R1 (home Review) each have a real
    // Processes leg in optionAApsr, so both now surface under Processes as
    // borrowed rows carrying THAT leg's assessment — the display symmetry S&O
    // always had, now extended to Approach/Processes/Review.
    const s1UnderProcesses = processes.rows.find((r) => r.lineId === "S1");
    expect(s1UnderProcesses).toBeDefined();
    expect(s1UnderProcesses!.borrowed).toBe(true);
    // Its S&O HOME row is unaffected and stays not-assessed (the S&O leg is the sentinel).
    const soRow = item.findingsGroups.find((g) => g.key === "systemsOutcomes")!.rows.find((r) => r.lineId === "S1")!;
    expect(soRow.verdict).toBe("not-assessed");
    expect(soRow.borrowed).toBeFalsy();
  });

  it("(Task 1) the overall summary names ALL constraining dimensions from real bands + grounds the priority step in a real recorded action", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const s = item.overallSummary!;
    const sentenceCount = s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    expect(sentenceCount).toBeGreaterThanOrEqual(2);
    expect(sentenceCount).toBeLessThanOrEqual(4);
    // approach 4 (strong) vs processes/systemsOutcomes/review 1 (weak): the
    // three weak dimensions are named directly, at their shared band.
    expect(s).toMatch(/Approach is well evidenced/);
    expect(s).toMatch(/processes, Systems & Outcomes and Review remain at Band 1 and are the main constraints/i);
    // Priority step is grounded in the weakest dimension's OWN recorded action
    // ("File the records."), never a generic template sentence.
    expect(s).toContain("The most immediate priority is Processes:");
    expect(s.toLowerCase()).toContain("file the records");
    expect(s).not.toMatch(/\d+%/);
  });

  it("(Task 1, 2026-07-19) a SOLID item (no weak dimension) states it is well supported and manufactures NO priority step", () => {
    // approach 4, processes 4, systemsOutcomes 3, review 3 — nothing at Band 2
    // or below, so there is no genuine gap to prioritise. The TLDR must not
    // invent one (the 6.2.1 misfire: a fixed "priority step" fired regardless).
    const solid: SubCriterionChecklistEntry = {
      ...ENTRY,
      holisticBand: { ...ENTRY.holisticBand!, matrixScores: { approach: 4, processes: 4, systemsOutcomes: 3, review: 3 } },
    };
    const report = buildFinalReport(scored, { "6.2.1": solid }, [], {});
    const s = report.items.find((i) => i.id === "6.2.1")!.overallSummary!;
    expect(s).toMatch(/soundly supported|well supported/);
    expect(s).not.toMatch(/priority/i);
    expect(s).not.toMatch(/main constraint/i);
  });
});

// Item 1 (R3/INV-05): finding/AFI text must never be cut mid-token at the
// "." inside "e.g."/"i.e." — rows show the FULL recorded text, and the one
// remaining one-sentence use (the summary's inline example) skips
// abbreviations when finding the sentence boundary.
describe("firstSentence — abbreviation-safe (R3/INV-05)", () => {
  it("does not break on e.g. / i.e. / etc.", () => {
    expect(firstSentence("Provide examples (e.g. survey results, KPI trends) for each initiative. Then file them."))
      .toBe("Provide examples (e.g. survey results, KPI trends) for each initiative.");
    expect(firstSentence("Records are partial, i.e. only Q1 is covered. Add the rest."))
      .toBe("Records are partial, i.e. only Q1 is covered.");
    expect(firstSentence("Attach minutes, logs, etc. from every cycle. More text."))
      .toBe("Attach minutes, logs, etc. from every cycle.");
  });
  it("still returns the first sentence of plain text, and caps unbounded text", () => {
    expect(firstSentence("First sentence. Second sentence.")).toBe("First sentence.");
    const long = "x".repeat(300);
    expect(firstSentence(long).endsWith("…")).toBe(true);
  });
});

describe("buildFinalReport — rows carry FULL finding/AFI text, never truncated (Item 1)", () => {
  const evF = (over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem =>
    ({ id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Missing", ...over });
  const DIAG = "Improvement records for specific initiatives (e.g. the new intake survey, the attendance tracker) are absent. Only the policy statement exists.";
  const ACTION = "Provide examples where specific feedback led to a change (e.g. a revised rubric). Then evidence the follow-through in the next cycle.";
  const entry: SubCriterionChecklistEntry = {
    gd4ItemId: "6.3.1",
    specific: [{
      id: "W1", text: "line", status: "Not met", generatedBy: "ai", clause: "6.3.1.DS1",
      evidence: [evF({
        suggestedAction: ACTION,
        apsr: {
          approach: { status: "Not evident", note: DIAG },
          processes: { status: "Deployed", note: "" },
          systemsOutcomes: { status: "Evident", note: "" },
          review: { status: "Evident", note: "" },
        },
      })],
    }],
    holisticBand: { band: 2, totalPct: 40, matrixScores: { approach: 2, processes: 2, systemsOutcomes: 2, review: 2 }, rationale: "r", source: "human", decidedAt: "2026-07-17T00:00:00.000Z" },
    pendingGenerated: [],
  };

  it("weakness rows show the complete diagnosis and action text, not a fragment ending at '(e.'", () => {
    const report = buildFinalReport(scored, { "6.3.1": entry }, [], {});
    const item = report.items.find((i) => i.id === "6.3.1")!;
    const row = item.findingsGroups.flatMap((g) => g.rows).find((r) => r.lineId === "W1")!;
    expect(row.verdict).toBe("weakness");
    expect(row.finding).toBe(DIAG);
    expect(row.afi).toBe(ACTION);
    expect(row.finding.endsWith("(e.")).toBe(false);
  });
});

// Item 4: the gap-nature pill is derived ONLY from data the finding already
// carries (source / APSR legs / dimension) — never guessed.
describe("findingGapNature (Item 4)", () => {
  const apsr = (approach: "Meeting" | "Beginning" | "Not evident", processes: "Deployed" | "Weak" | "Not evident"): ApsrBreakdown => ({
    approach: { status: approach, note: "" },
    processes: { status: processes, note: "" },
    systemsOutcomes: { status: "Not evident", note: "" },
    review: { status: "Not evident", note: "" },
  });

  it("source 'PPD Review' (internal contradictions) is always a Policy gap", () => {
    expect(findingGapNature(finding({ source: "PPD Review", apsr: apsr("Meeting", "Not evident") }))).toBe("Policy gap (PPD)");
  });
  it("Approach failing alone → Policy gap; Processes failing alone → Evidence gap", () => {
    expect(findingGapNature(finding({ apsr: apsr("Beginning", "Deployed") }))).toBe("Policy gap (PPD)");
    expect(findingGapNature(finding({ apsr: apsr("Meeting", "Weak") }))).toBe("Evidence gap");
  });
  it("both legs failing → 'Policy + evidence gap', never one hiding the other", () => {
    expect(findingGapNature(finding({ apsr: apsr("Not evident", "Not evident") }))).toBe("Policy + evidence gap");
  });
  it("no APSR → dimension fallback; no signal at all → undefined (no pill)", () => {
    expect(findingGapNature(finding({ dimension: "Procedure" }))).toBe("Policy gap (PPD)");
    expect(findingGapNature(finding({ dimension: "Unverified" }))).toBe("Evidence gap");
    expect(findingGapNature(finding({ dimension: "Outcomes" }))).toBe("Outcome gap");
    expect(findingGapNature(finding({}))).toBeUndefined();
  });
  it("rides onto the FindingReport for the report UI", () => {
    const report = buildFinalReport(scored, {}, [finding({ apsr: apsr("Meeting", "Weak") })], {});
    expect(report.findings[0].gapNature).toBe("Evidence gap");
  });
});

// Item 3: AI improvement suggestions — the pure honesty layer. Eligibility
// and the response filter guarantee a not-assessed or empty dimension can
// never gain a fabricated suggestion, whatever the model returns; the prompt
// grounds only on real assessed rows and the verbatim rubric target.
describe("AI improvement suggestions — eligibility, prompt grounding, honesty filter (Item 3)", () => {
  const group = (key: "approach" | "processes" | "systemsOutcomes" | "review", band: 0 | 1 | 2 | 3 | 4 | 5, rows: Array<{ verdict: "strength" | "weakness" | "not-assessed"; finding: string; afi?: string }>) => ({
    key, label: key === "systemsOutcomes" ? "Systems & Outcomes" : key[0].toUpperCase() + key.slice(1),
    band: band as 0 | 1 | 2 | 3 | 4 | 5, pct: 15, rubricDefined: rows.length,
    rows: rows.map((r, i) => ({ lineId: `L${i}`, itemRef: `6.2.1.DS${i + 1}`, ...r })),
  });

  const GROUPS = [
    group("approach", 3, [{ verdict: "strength" as const, finding: "The procedure names its owner and cadence." }]),
    group("processes", 2, [{ verdict: "weakness" as const, finding: "Improvement records (e.g. the intake survey) are absent.", afi: "Provide worked examples." }]),
    group("systemsOutcomes", 1, [{ verdict: "not-assessed" as const, finding: "Not assessed." }]),
    group("review", 1, []),
  ];

  it("eligibleSuggestionDims keeps only dimensions with at least one assessed row", () => {
    expect(eligibleSuggestionDims(GROUPS).map((g) => g.key)).toEqual(["approach", "processes"]);
  });

  it("buildAiSuggestionUserPrompt grounds on the FULL row text and the verbatim next-band descriptor, and omits not-assessed material", () => {
    const it2: ItemReport = {
      id: "6.2.1", title: "Management Review", criterion: "6", subCriterionId: "6.2", gate: false, band: 3,
      started: true, hasChecklist: true, completeness: { total: 2, assessed: 2, met: 1, partial: 0, notMet: 1, na: 0 },
      needsReassessment: false, findingsGroups: GROUPS,
    };
    const p = buildAiSuggestionUserPrompt(it2);
    expect(p).toContain("Improvement records (e.g. the intake survey) are absent.");
    expect(p).toContain("Recorded action: Provide worked examples.");
    // Verbatim rubric target for Processes Band 2 -> 3 is quoted from the
    // single source of truth, not paraphrased.
    expect(p).toContain(`"${bandLevel(3).processes}"`);
    // Not-assessed dimension and its text never reach the model.
    expect(p).not.toContain("systemsOutcomes");
    expect(p).not.toContain("Not assessed.");
  });

  it("filterAiSuggestions drops suggestions for not-assessed/empty dimensions and non-string values", () => {
    const out = filterAiSuggestions(
      { approach: "Do X.", processes: "Do Y.", systemsOutcomes: "Fabricated.", review: "Also fabricated.", junk: 42 },
      GROUPS
    );
    expect(out).toEqual({ approach: "Do X.", processes: "Do Y." });
    expect(filterAiSuggestions(null, GROUPS)).toEqual({});
    expect(filterAiSuggestions({ approach: "   " }, GROUPS)).toEqual({});
  });

  it("suggestionKey is the stable item::dimension storage key", () => {
    expect(suggestionKey("6.2.1", "processes")).toBe("6.2.1::processes");
  });

  it("findingParagraphs splits multi-entry notes and groups one long blob into scannable paragraphs, preserving all text", () => {
    // Multi-entry evidence merge → one paragraph per entry.
    const multi = "#1 [a·C1]:\nFirst entry.\n\n#2 [b·C2]:\nSecond entry.";
    expect(findingParagraphs(multi)).toEqual(["#1 [a·C1]:\nFirst entry.", "#2 [b·C2]:\nSecond entry."]);
    // Short single note → unchanged single paragraph.
    expect(findingParagraphs("A short finding.")).toEqual(["A short finding."]);
    // Long single blob (no structure) → grouped into ~2-sentence paragraphs, no text lost.
    const long = "One. Two. Three. Four. Five. Six.".padEnd(320, " x.");
    const paras = findingParagraphs(long);
    expect(paras.length).toBeGreaterThan(1);
    expect(paras.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("stripChunkMarkers removes internal [CHUNK:..] markers and tidies spacing", () => {
    expect(stripChunkMarkers("Outcome data [CHUNK:C003] was sighted in the register.")).toBe("Outcome data was sighted in the register.");
    expect(stripChunkMarkers("[CHUNK:C001] leading marker")).toBe("leading marker");
    expect(stripChunkMarkers("no markers here")).toBe("no markers here");
  });

  it("stripLeadingFragment (Item 3) drops a stray leading list marker but preserves real text", () => {
    // The reported failure: a Strength note that begins "g. ..." — the marker goes.
    expect(stripLeadingFragment("g. The strategic plan sets targets for key performance indicators.")).toBe("The strategic plan sets targets for key performance indicators.");
    expect(stripLeadingFragment("a) The PPD documents the approach and names the owner clearly.")).toBe("The PPD documents the approach and names the owner clearly.");
    expect(stripLeadingFragment("iv. Reviews were conducted each cycle and recorded in the register.")).toBe("Reviews were conducted each cycle and recorded in the register.");
    // Preserved: a capitalised initial, an abbreviation with no trailing space, and clean prose.
    expect(stripLeadingFragment("A. Tan reviewed the minutes and signed them off.")).toBe("A. Tan reviewed the minutes and signed them off.");
    expect(stripLeadingFragment("i.e. the reviews were minuted and retained.")).toBe("i.e. the reviews were minuted and retained.");
    expect(stripLeadingFragment("The evidence shows the process was implemented.")).toBe("The evidence shows the process was implemented.");
    // Never blanks a short cell to nothing over a false positive: no readable remainder → keep original.
    expect(stripLeadingFragment("g. short")).toBe("g. short");
  });

  it("buildAiSuggestionUserPrompt strips chunk markers from the grounding text", () => {
    const groups = [group("processes", 2, [{ verdict: "weakness" as const, finding: "Records [CHUNK:C007] were incomplete.", afi: "Add [CHUNK:C008] approval records." }])];
    const it2: ItemReport = {
      id: "6.3.1", title: "Innovation", criterion: "6", subCriterionId: "6.3", gate: false, band: 2,
      started: true, hasChecklist: true, completeness: { total: 1, assessed: 1, met: 0, partial: 0, notMet: 1, na: 0 },
      needsReassessment: false, findingsGroups: groups,
    };
    const p = buildAiSuggestionUserPrompt(it2);
    expect(p).not.toContain("[CHUNK:");
    expect(p).toContain("Records were incomplete.");
  });

  it("filterDimensionNarratives keeps only eligible dimensions and drops entries with no bandLine", () => {
    const out = filterDimensionNarratives(
      {
        approach: { strength: "Owner and cadence are named.", bandLine: "Currently Band 3 (15%)." },
        processes: { weakness: "Improvement records are absent.", bandLine: "Currently Band 2 (10%).", requiredAction: "Consider retaining intake survey records." },
        systemsOutcomes: { strength: "Fabricated — not assessed.", bandLine: "Currently Band 1 (5%)." },
        review: { bandLine: "Currently Band 1 (5%)." },
        junk: { bandLine: 42 },
      },
      GROUPS
    );
    expect(out).toEqual({
      approach: { strength: "Owner and cadence are named.", weakness: undefined, bandLine: "Currently Band 3 (15%).", requiredAction: undefined },
      processes: { strength: undefined, weakness: "Improvement records are absent.", bandLine: "Currently Band 2 (10%).", requiredAction: "Consider retaining intake survey records." },
    });
    expect(filterDimensionNarratives(null, GROUPS)).toEqual({});
    expect(filterDimensionNarratives({ approach: { strength: "x" } }, GROUPS)).toEqual({});
  });

  it("filterDimensionNarratives strips leaked markdown markers and duplicated field labels (table-break fix)", () => {
    const out = filterDimensionNarratives(
      {
        processes: {
          weakness: "**Weakness:** The records were incomplete. However, no approval was sighted.",
          bandLine: "**Band Assessment:** Current Band 1 (5%); target Band 2.",
          requiredAction: "Required Action: Ensure records capture the approver.",
        },
      },
      GROUPS
    );
    expect(out.processes.weakness).toBe("The records were incomplete. However, no approval was sighted.");
    expect(out.processes.bandLine).toBe("Current Band 1 (5%); target Band 2.");
    expect(out.processes.requiredAction).toBe("Ensure records capture the approver.");
    // A field that is ONLY a leaked label collapses to empty and is dropped.
    const empty = filterDimensionNarratives({ processes: { weakness: "**Weakness:**", bandLine: "Band 1." } }, GROUPS);
    expect(empty.processes.weakness).toBeUndefined();
  });
});

// Empty-dimension placeholder: the two empty states must be distinguishable —
// "the official rubric defines no line of this type for this item" (0) vs
// "official lines exist but none is drafted/tagged" (>0). rubricDefined is
// counted from the item's official flatAuditPoints via the SAME classifier
// the grouping uses; it is display data only, never a score input.
describe("buildFindingsGroups — rubricDefined distinguishes the two empty-dimension states", () => {
  const hb = { band: 2 as const, totalPct: 40, matrixScores: { approach: 2 as const, processes: 2 as const, systemsOutcomes: 2 as const, review: 2 as const }, rationale: "r", source: "human" as const, decidedAt: "2026-07-17T00:00:00.000Z" };

  it("6.1.1: Systems & Outcomes has rubricDefined 0 (the official rubric defines no such line), the other dimensions > 0", () => {
    const entry: SubCriterionChecklistEntry = { gd4ItemId: "6.1.1", specific: [], holisticBand: hb, pendingGenerated: [] };
    const report = buildFinalReport(scored, { "6.1.1": entry }, [], {});
    const groups = report.items.find((i) => i.id === "6.1.1")!.findingsGroups;
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.rubricDefined]));
    expect(byKey.systemsOutcomes).toBe(0);
    expect(byKey.approach).toBeGreaterThan(0);
    expect(byKey.processes).toBeGreaterThan(0);
    expect(byKey.review).toBeGreaterThan(0);
  });

  it("6.2.1: every dimension the official rubric covers reports its real point count (S&O > 0 here)", () => {
    const entry: SubCriterionChecklistEntry = { gd4ItemId: "6.2.1", specific: [], holisticBand: hb, pendingGenerated: [] };
    const report = buildFinalReport(scored, { "6.2.1": entry }, [], {});
    const so = report.items.find((i) => i.id === "6.2.1")!.findingsGroups.find((g) => g.key === "systemsOutcomes")!;
    expect(so.rubricDefined).toBeGreaterThan(0);
  });
});

// Row-model rework (Bug A + Bug B, 2026-07-17): the verdict derives from the
// SAME dimension leg the text comes from, and a scored dimension with no
// grouped lines surfaces the real leg content recorded on the item's other
// lines. Display-only: the scoring digest must be byte-identical throughout.
describe("row verdict derives from the dimension leg (Bug A / R4 fix)", () => {
  const evW = (apsr: ApsrBreakdown, over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem =>
    ({ id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Missing", apsr, ...over });
  const mk = (id: string, clause: string, status: SpecificChecklistLine["status"], apsr?: ApsrBreakdown, suff: SubChecklistEvidenceItem["sufficiency"] = "Missing"): SpecificChecklistLine =>
    ({ id, text: "x", status, generatedBy: "ai", clause, evidence: apsr ? [evW(apsr, { sufficiency: suff })] : [] });
  const legs = (approach: "Meeting" | "Beginning" | "Not evident", note: string): ApsrBreakdown => ({
    approach: { status: approach, note },
    processes: { status: "Deployed", note: "" },
    systemsOutcomes: { status: "Evident", note: "" },
    review: { status: "Evident", note: "" },
  });
  const hb = { band: 2 as const, totalPct: 40, matrixScores: { approach: 2 as const, processes: 2 as const, systemsOutcomes: 2 as const, review: 2 as const }, rationale: "r", source: "human" as const, decidedAt: "2026-07-17T00:00:00.000Z" };
  const approachRow = (line: SpecificChecklistLine) => {
    const entry: SubCriterionChecklistEntry = { gd4ItemId: "6.2.1", specific: [line], holisticBand: hb, pendingGenerated: [] };
    const report = buildFinalReport(scored, { "6.2.1": entry }, [], {});
    return report.items.find((i) => i.id === "6.2.1")!.findingsGroups.find((g) => g.key === "approach")!.rows[0];
  };

  it("positive leg on a Not met line -> Strength (the DS1.d case: label agrees with the text)", () => {
    const row = approachRow(mk("L1", "6.2.1.DS1.b", "Not met", legs("Meeting", "Documented, because the PPD requires every CAP to have an assigned owner.")));
    expect(row.verdict).toBe("strength");
    expect(row.finding).toContain("Documented, because");
  });
  it("negative leg on a Met line -> Weakness (the reverse mismatch also cured)", () => {
    expect(approachRow(mk("L1", "6.2.1.DS1.b", "Met", legs("Not evident", "No documented approach found."), "Present")).verdict).toBe("weakness");
  });
  it("middle leg value falls back to the line status, both ways", () => {
    expect(approachRow(mk("L1", "6.2.1.DS1.b", "Not met", legs("Beginning", "Partially documented."))).verdict).toBe("weakness");
    expect(approachRow(mk("L1", "6.2.1.DS1.b", "Met", legs("Beginning", "Partially documented."), "Present")).verdict).toBe("strength");
  });
  it("no APSR at all keeps the line-level rule", () => {
    expect(approachRow(mk("L1", "6.2.1.DS1.b", "Not met", undefined)).verdict).toBe("weakness");
  });
});

describe("scored-but-ungrouped dimension surfaces real leg content (Bug B)", () => {
  const NOTE = "#1 [MR-minutes.pdf · C003]: KPI dashboard covers the review period with enrolment trends.";
  const hb = { band: 2 as const, totalPct: 40, matrixScores: { approach: 2 as const, processes: 2 as const, systemsOutcomes: 2 as const, review: 2 as const }, rationale: "r", source: "human" as const, decidedAt: "2026-07-17T00:00:00.000Z" };
  // 6.1.1 has ZERO official Systems & Outcomes points; DS1.c is Approach-type.
  const withSoLeg = (soNote: string): SubCriterionChecklistEntry => ({
    gd4ItemId: "6.1.1", pendingGenerated: [],
    specific: [{
      id: "L1", text: "x", status: "Met", generatedBy: "ai", clause: "6.1.1.DS1.c",
      evidence: [{ id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present",
        apsr: {
          approach: { status: "Meeting", note: "Documented." },
          processes: { status: "Deployed", note: "" },
          systemsOutcomes: { status: "Evident", note: soNote },
          review: { status: "Evident", note: "Review records found." },
        } }],
    }],
    holisticBand: hb,
  });
  const soGroup = (entry: SubCriterionChecklistEntry) =>
    buildFinalReport(scored, { "6.1.1": entry }, [], {}).items.find((i) => i.id === "6.1.1")!.findingsGroups.find((g) => g.key === "systemsOutcomes")!;

  it("real leg notes surface as rows, flagged rowsFromLegs, attributed to the source line's ref", () => {
    const g = soGroup(withSoLeg(NOTE));
    expect(g.rowsFromLegs).toBe(true);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].itemRef).toBe("6.1.1.DS1.c");
    expect(g.rows[0].finding).toBe(NOTE); // verbatim leg note, no fabrication
    expect(g.rows[0].verdict).toBe("strength"); // Evident leg -> strength
  });
  it("the not-assessed sentinel does NOT count as real content: the group stays empty (honest placeholder)", () => {
    const g = soGroup(withSoLeg(OPTION_A_NOT_ASSESSED_NOTE));
    expect(g.rows).toHaveLength(0);
    expect(g.rowsFromLegs).toBe(false);
  });
  it("a leg-derived weakness row never gets the generic filler action (its stored action may be about another dimension)", () => {
    const entry = withSoLeg(NOTE);
    entry.specific[0].evidence[0].apsr!.systemsOutcomes = { status: "Not evident", note: "No outcome data found for the review period." };
    const g = soGroup(entry);
    expect(g.rows[0].verdict).toBe("weakness");
    expect(g.rows[0].afi).toBeUndefined();
  });
  it("the scoring digest is byte-identical with and without the new row model exercising (display-only proof)", () => {
    const entry = withSoLeg(NOTE);
    const overrides = computeChecklistOverrides({ "6.1.1": entry }, GD4_REQUIREMENTS);
    const scoredLocal = buildScored({ evidence: blankEvidence(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides });
    const digestBefore = JSON.stringify({ total: scoredLocal.total, award: scoredLocal.award, gates: scoredLocal.gates, bands: scoredLocal.items.map((i) => [i.id, i.band, i.eff]) });
    const report = buildFinalReport(scoredLocal, { "6.1.1": entry }, [], {});
    // The report's score-bearing fields are pass-throughs from `scored` —
    // buildFindingsGroups can never move them.
    expect(report.overall.total).toBe(scoredLocal.total);
    expect(report.items.find((i) => i.id === "6.1.1")!.band).toBe(scoredLocal.items.find((i) => i.id === "6.1.1")!.band);
    const scoredAfter = buildScored({ evidence: blankEvidence(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: computeChecklistOverrides({ "6.1.1": entry }, GD4_REQUIREMENTS) });
    const digestAfter = JSON.stringify({ total: scoredAfter.total, award: scoredAfter.award, gates: scoredAfter.gates, bands: scoredAfter.items.map((i) => [i.id, i.band, i.eff]) });
    expect(digestAfter).toBe(digestBefore);
  });
});

// Item 1 (2026-07-17): multi-entry evidence notes fold to their first entry
// by default in the UI — the split must round-trip the full text.
describe("splitEvidenceNote", () => {
  it("splits the staged pass's numbered merge format into its entries, preserving all text", () => {
    const note = "#1 [MR.pdf · C003]:\nKPI dashboard reviewed.\n\n#2 [Survey.xlsx · C007]:\nSatisfaction at 86 percent.\n\n#3:\nUncited window note.";
    const parts = splitEvidenceNote(note);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("#1 [MR.pdf · C003]:\nKPI dashboard reviewed.");
    expect(parts.join("\n\n")).toBe(note); // nothing lost
  });
  it("returns plain text (or a single-entry note) as one part", () => {
    expect(splitEvidenceNote("A short ordinary diagnosis.")).toEqual(["A short ordinary diagnosis."]);
    expect(splitEvidenceNote("#1 [F.pdf · C001]:\nOnly one entry.")).toEqual(["#1 [F.pdf · C001]:\nOnly one entry."]);
  });
  it("does not split on a '#' that is not a numbered entry boundary", () => {
    expect(splitEvidenceNote("Item #2 in the register is missing.\n\nSecond paragraph.")).toHaveLength(1);
  });
});

// Item 2: concise auditor-voice summaries — the pure qualification, prompt
// and honesty-filter layer. A not-assessed row can never qualify or receive
// a summary, and only requested row keys survive the model's reply.
describe("concise summaries — qualification, prompt, filter (Item 2)", () => {
  const LONG = "x".repeat(450);
  const MULTI = "#1 [F.pdf · C001]:\nFirst entry.\n\n#2 [G.pdf · C002]:\nSecond entry.";
  const hb = { band: 2 as const, totalPct: 40, matrixScores: { approach: 2 as const, processes: 2 as const, systemsOutcomes: 2 as const, review: 2 as const }, rationale: "r", source: "human" as const, decidedAt: "2026-07-17T00:00:00.000Z" };
  const entry: SubCriterionChecklistEntry = {
    gd4ItemId: "6.2.1", pendingGenerated: [],
    specific: [
      { id: "L1", text: "x", status: "Not met", generatedBy: "ai", clause: "6.2.1.EE3",
        evidence: [{ id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Missing",
          apsr: { approach: { status: "Meeting", note: "" }, processes: { status: "Not evident", note: LONG }, systemsOutcomes: { status: "Evident", note: MULTI }, review: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE } } }] },
      { id: "L2", text: "short", status: "Met", generatedBy: "ai", clause: "6.2.1.EE2",
        evidence: [{ id: "e2", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present",
          apsr: { approach: { status: "Meeting", note: "" }, processes: { status: "Deployed", note: "A short, already-concise diagnosis." }, systemsOutcomes: { status: "Evident", note: "" }, review: { status: "Evident", note: "" } } }] },
    ],
    holisticBand: hb,
  };
  const itemReport = () => buildFinalReport(scored, { "6.2.1": entry }, [], {}).items.find((i) => i.id === "6.2.1")!;

  it("needsConciseSummary: long text and multi-entry notes qualify; short text and not-assessed never do", () => {
    expect(needsConciseSummary(LONG, "weakness")).toBe(true);
    expect(needsConciseSummary(MULTI, "strength")).toBe(true);
    expect(needsConciseSummary("Short diagnosis.", "weakness")).toBe(false);
    expect(needsConciseSummary(LONG, "not-assessed")).toBe(false);
  });

  it("qualifyingConciseRows collects only qualifying rows, keyed item::dim::line, and skips not-assessed rows", () => {
    const rows = qualifyingConciseRows(itemReport());
    const keys = rows.map((q) => q.key);
    expect(keys).toContain("6.2.1::processes::L1");     // long weakness note
    expect(keys).toContain("6.2.1::systemsOutcomes::L1"); // multi-entry note (leg-surfaced)
    expect(keys.some((k) => k.endsWith("::L2"))).toBe(false); // short text stays as-is
    expect(keys.some((k) => k.includes("::review::"))).toBe(false); // not-assessed sentinel never qualifies
  });

  it("buildConciseUserPrompt grounds each row on its FULL raw text", () => {
    const p = buildConciseUserPrompt(itemReport());
    expect(p).toContain('Row key "6.2.1::processes::L1"');
    expect(p).toContain(LONG);
    expect(p).toContain(MULTI);
  });

  it("filterConciseSummaries keeps only requested keys with non-empty strings", () => {
    const out = filterConciseSummaries(
      { "6.2.1::processes::L1": "A grounded summary.", "6.2.1::review::L1": "Fabricated for a not-assessed row.", junk: 1, "6.2.1::systemsOutcomes::L1": "   " },
      itemReport()
    );
    expect(out).toEqual({ "6.2.1::processes::L1": "A grounded summary." });
  });
});

// ── Cross-cutting dimension grouping (2026-07-21): a line appears under every
// dimension its per-line APSR has real (non-sentinel) content for, not only its
// classifier-assigned home. The proof Felix needs: this is DISPLAY ONLY — the
// band, %, matrix scores and the scoring override are byte-identical, since
// none of them read the findings-table grouping. ──
describe("buildFinalReport — cross-cutting grouping is DISPLAY ONLY (byte-identical band/score)", () => {
  function ev(over: Partial<SubChecklistEvidenceItem> = {}): SubChecklistEvidenceItem {
    return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", ...over };
  }
  function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
    return { text: "x", status: "Met", evidence: [], generatedBy: "ai", ...over };
  }
  // Real Option A shape: each line carries its OWN Approach (PPD) and Processes
  // (evidence) assessment — different notes per line — so each line legitimately
  // has real content under BOTH Approach and Processes. S&O/Review are the
  // not-assessed sentinel (O&R pass not run here).
  const optionAApsr = (
    approachNote: string,
    processesNote: string,
    aStatus: ApsrBreakdown["approach"]["status"] = "Meeting",
    pStatus: ApsrBreakdown["processes"]["status"] = "Deployed",
  ): ApsrBreakdown => ({
    approach: { status: aStatus, note: approachNote },
    processes: { status: pStatus, note: processesNote },
    systemsOutcomes: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
    review: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
  });
  const ENTRY: SubCriterionChecklistEntry = {
    gd4ItemId: "6.2.1",
    specific: [
      // Home Approach (DS1.b): also has its own real Processes leg.
      line({ id: "A1", clause: "6.2.1.DS1.b", status: "Met", evidence: [ev({ apsr: optionAApsr("Policy A1 documents the approach.", "Records A1 show it running.") })] }),
      // Home Processes (EE2): also has its own real Approach leg.
      line({ id: "P1", clause: "6.2.1.EE2", status: "Met", evidence: [ev({ apsr: optionAApsr("Policy P1 documents the approach.", "Records P1 show it running.") })] }),
    ],
    holisticBand: {
      band: 3, totalPct: 60,
      matrixScores: { approach: 5, processes: 3, systemsOutcomes: 3, review: 1 },
      rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z",
    },
    pendingGenerated: [],
  };

  it("both lines now appear under BOTH Approach and Processes (cross-cutting), each carrying that dimension's own leg", () => {
    const report = buildFinalReport(scored, { "6.2.1": ENTRY }, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    const approach = item.findingsGroups.find((g) => g.key === "approach")!;
    const processes = item.findingsGroups.find((g) => g.key === "processes")!;
    // Approach shows A1 (home) + P1 (borrowed); Processes shows A1 (borrowed) + P1 (home).
    expect(approach.rows.map((r) => r.lineId).sort()).toEqual(["A1", "P1"]);
    expect(processes.rows.map((r) => r.lineId).sort()).toEqual(["A1", "P1"]);
    expect(approach.rows.find((r) => r.lineId === "A1")!.borrowed).toBeFalsy();
    expect(approach.rows.find((r) => r.lineId === "P1")!.borrowed).toBe(true);
    expect(processes.rows.find((r) => r.lineId === "P1")!.borrowed).toBeFalsy();
    expect(processes.rows.find((r) => r.lineId === "A1")!.borrowed).toBe(true);
    // The borrowed row shows the OTHER dimension's own leg text, not a duplicate.
    expect(approach.rows.find((r) => r.lineId === "P1")!.finding).toContain("Policy P1 documents the approach");
    expect(processes.rows.find((r) => r.lineId === "A1")!.finding).toContain("Records A1 show it running");
  });

  it("BYTE-IDENTICAL band: the scoring override, item band, %, and per-dimension group bands all come straight from matrixScores, unaffected by the grouping", () => {
    const entries = { "6.2.1": ENTRY };
    const expected = apsrMatrixResult(ENTRY.holisticBand!.matrixScores!);
    // 1. The scoring override that actually feeds scoring.ts is derived from
    //    matrixScores only — computeChecklistOverrides never reads findingsGroups.
    const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
    expect(overrides["6.2.1"].band).toBe(expected.band);
    expect(overrides["6.2.1"].eff).toBe({ 1: 20, 2: 45, 3: 60, 4: 75, 5: 90 }[expected.band]);
    // 2. Feed those overrides into the real scoring pipeline exactly as the app
    //    does; the item's report band then equals the matrix band. The grouping
    //    change cannot move it — buildScored/computeChecklistOverrides never see
    //    findingsGroups.
    const scoredWithBand = buildScored({ evidence: blankEvidence(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides });
    const report = buildFinalReport(scoredWithBand, entries, [], {});
    const item = report.items.find((i) => i.id === "6.2.1")!;
    expect(item.band).toBe(expected.band);
    expect(item.bandTotalPct).toBe(expected.total);
    // 3. Each dimension group's band/pct equal the matrix's own, regardless of
    //    how many (home or borrowed) rows now sit under it.
    for (const g of item.findingsGroups) {
      expect(g.band).toBe(ENTRY.holisticBand!.matrixScores![g.key]);
      expect(g.pct).toBe(expected.pcts[g.key]);
    }
  });
});
