import { describe, it, expect } from "vitest";
import { buildBandWorking, ceilingNote, ROWS_DO_NOT_SUM_NOTE, DIMENSION_SOURCE, BAND_LADDER } from "../selfCheckBanding";
import { VERDICT_LEGEND, PLAIN_VERDICT, PPD_PLAIN_VERDICT, RECORDS_PLAIN_VERDICT, buildSelfCheckHtml, buildSelfCheckCsv, toSelfCheckRows, countSelfCheck } from "../selfCheck";
import type { EvidenceAssessmentRow } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "4.1.1.DS1", gd4ItemId: "4.1.1", requirementText: "Ensure counsellors are trained.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Partial", comment: "Partly shown.", ...over,
});

describe("the band shows its working, and claims nothing it cannot show", () => {
  // The chain is: rows -> (AI judgement, NOT arithmetic) -> four dimension
  // bands -> (arithmetic) -> total -> band. Only the second half is a sum, and
  // only the second half is presented as one.
  it("turns each dimension band into its percentage and sums them", () => {
    const w = buildBandWorking({ approach: 4, processes: 4, systemsOutcomes: 2, review: 0 });
    expect(w.rows.map((r) => r.pct)).toEqual([20, 20, 10, 0]);
    expect(w.total).toBe(50);
    expect(w.sum).toBe("20% + 20% + 10% + 0% = 50%");
    // The SSG auditor's own worked example lands on Band 3.
    expect(w.band).toBe(3);
  });

  it("quotes the official descriptor for the band each dimension was given", () => {
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    expect(w.rows[0].descriptor).toBe("The beginning of an organised approach is evident");
    expect(w.rows[3].descriptor).toBe("No planned review; no improvement is made");
  });

  it("leaves a dimension with no score blank rather than inventing a zero band", () => {
    const w = buildBandWorking({ approach: 3, processes: undefined, systemsOutcomes: undefined, review: undefined });
    expect(w.rows[1].band).toBeUndefined();
    expect(w.rows[1].descriptor).toBe("");
    expect(w.rows[1].pct).toBe(0);
  });

  // A score of 0 is a real state in the auditor's example (R=0%) and has no
  // descriptor, so it must not be rendered as "Band 0".
  it("handles a zero score without pretending it is a band", () => {
    const w = buildBandWorking({ approach: 1, processes: 1, systemsOutcomes: 0, review: 0 });
    expect(w.rows[2].band).toBe(0);
    expect(w.rows[2].descriptor).toBe("");
    expect(w.total).toBe(10);
  });

  // The most important honest statement on the page: this path reads a
  // procedure and records, so two of the four dimensions are never assessed
  // here and a self-check cannot reach the top bands.
  it("marks the two dimensions this check does not assess, and states the ceiling", () => {
    const w = buildBandWorking({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 });
    expect(w.rows.filter((r) => !r.assessedHere).map((r) => r.key)).toEqual(["systemsOutcomes", "review"]);
    expect(w.ceilingTotal).toBe(60);
    expect(w.ceilingBand).toBe(3);
    expect(ceilingNote(w)).toContain("Band 3");
    expect(DIMENSION_SOURCE.systemsOutcomes).toMatch(/Not assessed by this check/);
    expect(DIMENSION_SOURCE.review).toMatch(/Not assessed by this check/);
  });

  it("says outright that the rows below do not sum to the band", () => {
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/No single requirement below carries a score/);
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/Approach/);
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/Processes/);
  });

  it("carries the whole ladder, verbatim, for the result to sit on", () => {
    expect(BAND_LADDER).toHaveLength(5);
    expect(BAND_LADDER[2].name).toBe("Meeting Expectation");
  });
});

describe("a state is never signalled by colour alone", () => {
  it("gives every verdict a glyph as well as a tone", () => {
    for (const v of Object.values(PLAIN_VERDICT)) expect(v.icon).toBeTruthy();
    for (const v of Object.values(PPD_PLAIN_VERDICT)) expect(v.icon).toBeTruthy();
    for (const v of Object.values(RECORDS_PLAIN_VERDICT)) expect(v.icon).toBeTruthy();
  });

  it("puts the glyph on the row, so it reaches the table and the print-out", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met" })]);
    expect(r.icon).toBe("✗");
  });

  it("renames the procedure states so they read as a verdict", () => {
    expect(PPD_PLAIN_VERDICT.Adequate.label).toBe("Documented");
    expect(PPD_PLAIN_VERDICT["Not documented"].label).toBe("Not documented");
    expect(RECORDS_PLAIN_VERDICT.none.label).toBe("No records found");
  });
});

describe("every tab explains its own states", () => {
  it("has a legend line for each state it can show", () => {
    expect(VERDICT_LEGEND.overview).toHaveLength(4);
    expect(VERDICT_LEGEND.procedure).toHaveLength(4);
    // The records view has no middle state, so it must not claim one.
    expect(VERDICT_LEGEND.records).toHaveLength(3);
    expect(VERDICT_LEGEND.records.map((l) => l.label)).not.toContain("Partly");
  });

  // The complaint that started this: an auditor could not tell whether these
  // meant compliant. Each legend line has to settle that in its own words.
  it("says plainly that half an answer is not compliance", () => {
    expect(VERDICT_LEGEND.procedure[0].meaning).toMatch(/does NOT mean the requirement is met/i);
    expect(VERDICT_LEGEND.records[0].meaning).toMatch(/does NOT mean the requirement is met/i);
    expect(VERDICT_LEGEND.overview[0].meaning).toMatch(/AND/);
  });
});

describe("both exports carry the working", () => {
  const rows = toSelfCheckRows([row({})]);
  const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });

  it("puts the legend and the banding arithmetic in the CSV", () => {
    const csv = buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" }, "overview", [], w);
    expect(csv).toContain("What each result means");
    expect(csv).toContain("Partly complies");
    expect(csv).toContain("10% + 10% + 5% + 5% = 30%");
    expect(csv).toContain("NOT assessed by this check");
    expect(csv).toContain("No single requirement below carries a score");
  });

  it("puts the legend, the glyphs, the arithmetic and the ladder in the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w,
    });
    expect(html).toContain("What each result means");
    expect(html).toContain("! Partly complies");
    expect(html).toContain("How this band was reached");
    expect(html).toContain("10% + 10% + 5% + 5% = 30%");
    expect(html).toContain("The official band scale");
    expect(html).toContain("Meeting Expectation");
  });

  it("omits the banding section when there is no band to explain", () => {
    expect(buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" })).not.toContain("How this band was reached");
    expect(buildSelfCheckHtml({ areaLabel: "a", areaDescription: "d", counts: countSelfCheck(rows), band: { kind: "none" }, rows, ranAt: "x" }))
      .not.toContain("How this band was reached");
  });
});
