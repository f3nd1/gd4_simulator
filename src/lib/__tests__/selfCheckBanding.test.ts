import { describe, it, expect } from "vitest";
import { buildBandWorking, bandCoverageNote, bandGraphic, ceilingNote, ROWS_DO_NOT_SUM_NOTE, DIMENSION_SOURCE, BAND_LADDER } from "../selfCheckBanding";
import { unassessedDimensions, runNamedGaps, reviewShapedGapNote, IMPROVE_HEADLINE, IMPROVE_WHY } from "../selfCheckImprove";
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

describe("the band says which requirement item it covers", () => {
  // suggestBand() is called with itemIdsForScope(scope)[0], and the committed
  // band is the first item that has one. Two of the twenty-nine sub-criteria
  // hold more than one item, and on those the number describes one item while
  // the table above it describes them all.
  it("names the item even when it is the only one", () => {
    expect(bandCoverageNote("4.1.1", ["4.1.1"])).toBe("This band covers requirement 4.1.1, which is the only requirement item in this area.");
  });

  it("says outright which items the band leaves out", () => {
    const note = bandCoverageNote("4.2.1", ["4.2.1", "4.2.2"]);
    expect(note).toContain("4.2.1 ONLY");
    expect(note).toContain("4.2.2 is not in it");
    expect(note).toContain("cover all of them");
  });

  it("lists several excluded items in plain words", () => {
    const note = bandCoverageNote("2.2.1", ["2.2.1", "2.2.2", "2.2.3"]);
    expect(note).toContain("3 requirement items");
    expect(note).toContain("2.2.2, 2.2.3 are not in it");
  });

  it("travels into both exports", () => {
    const rows = toSelfCheckRows([row({})]);
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    const note = bandCoverageNote("4.2.1", ["4.2.1", "4.2.2"]);
    expect(buildSelfCheckCsv("4.2 Fees", rows, { kind: "none" }, "overview", [], w, note)).toContain("4.2.1 ONLY");
    expect(buildSelfCheckHtml({
      areaLabel: "4.2 Fees", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w, bandCoverage: note,
    })).toContain("4.2.1 ONLY");
  });
});

describe("the graphic is drawn from the same numbers as the arithmetic", () => {
  const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });

  it("gives every dimension its own track and its own earned share", () => {
    const g = bandGraphic(w);
    expect(g.segments.map((s) => [s.label, s.pct, s.max])).toEqual([
      ["Approach", 10, 25], ["Processes", 10, 25], ["Systems & Outcomes", 5, 25], ["Review", 5, 25],
    ]);
    // The four segments are the only thing drawn as adding up, because they are
    // the only thing that does.
    expect(g.segments.reduce((n, s) => n + s.pct, 0)).toBe(g.total);
  });

  it("marks the part of the scale this check cannot reach", () => {
    const g = bandGraphic(w);
    expect(g.ceiling).toBe(60);
    expect(g.stops.filter((s) => !s.reachable).map((s) => s.band)).toEqual([4, 5]);
    expect(g.stops.find((s) => s.band === 3)!.reachable).toBe(true);
  });

  it("draws the band scale to the same thresholds the arithmetic uses", () => {
    const g = bandGraphic(w);
    expect(g.stops.map((s) => [s.from, s.to])).toEqual([[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]]);
    expect(g.band).toBe(2);
  });

  it("carries which dimensions this check assessed, so the flat ones read as unassessed rather than bad", () => {
    expect(bandGraphic(w).segments.filter((s) => !s.assessedHere).map((s) => s.key)).toEqual(["systemsOutcomes", "review"]);
  });
});

describe("the ceiling comes with a way out of it", () => {
  it("names the two dimensions in plain words, not rubric language", () => {
    const [so, rev] = unassessedDimensions(["4.1.1"]);
    expect(so.plainQuestion).toMatch(/measured and tracked/);
    expect(rev.plainQuestion).toMatch(/formally reviewed/);
  });

  // The whole point of the section: what "better" looks like, in the Guidance
  // Document's own words rather than this app's.
  it("quotes the official Band 4 and Band 5 descriptors verbatim", () => {
    const [so, rev] = unassessedDimensions(["4.1.1"]);
    expect(so.ladder.map((l) => l.band)).toEqual([3, 4, 5]);
    expect(so.ladder.find((l) => l.band === 4)!.descriptor)
      .toBe("Key systems are interacting with one another, producing desired outcomes with no conflicts");
    expect(rev.ladder.find((l) => l.band === 5)!.descriptor)
      .toBe("Many to most trends and current performance levels are evaluated against relevant comparisons and/or benchmarks");
  });

  // Review CAN be derived: 30 of the 31 requirement items carry an official
  // expected-evidence entry that literally names review.
  it("lists the official expected evidence for Review, filtered from the real list", () => {
    expect(unassessedDimensions(["4.1.1"])[1].officialEvidence).toEqual(["Procedure review records"]);
    expect(unassessedDimensions(["6.1.1"])[1].officialEvidence).toEqual(["Internal assessment process review records"]);
  });

  // Systems & Outcomes CANNOT be derived the same way, so it shows less rather
  // than inventing a list. This is the honesty constraint, pinned.
  it("shows nothing for Systems & Outcomes rather than guessing at an official list", () => {
    const so = unassessedDimensions(["4.1.1"])[0];
    expect(so.officialEvidence).toEqual([]);
    expect(so.noOfficialList).toMatch(/does not itemise outcome evidence/);
  });

  it("says plainly that Band 4 and 5 are not this page's to give", () => {
    expect(IMPROVE_HEADLINE).toMatch(/Band 4 and Band 5 are not reachable from this page/);
    expect(IMPROVE_WHY).toMatch(/full audit/);
  });

  it("gathers the run's own reported gaps, and writes none of its own", () => {
    const rows = toSelfCheckRows([row({
      verdict: "Not met",
      promiseChecks: [{ promiseText: "Academic Board minutes are kept", verdict: "not evidenced", evidence: "", chunkIds: [], rationale: "No minutes appear in the records." }],
    })]);
    const gaps = runNamedGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].text).toBe("Academic Board minutes are kept — No minutes appear in the records.");
    // A Met row has nothing to improve, and an unjudged row was never decided.
    expect(runNamedGaps(toSelfCheckRows([row({ verdict: "Met" })]))).toEqual([]);
    expect(runNamedGaps(toSelfCheckRows([row({ verdict: "Not assessed" })]))).toEqual([]);
  });

  it("names the records-shaped pattern only when the run's own gaps show it", () => {
    expect(reviewShapedGapNote([{ text: "Academic Board minutes are kept" }])).toMatch(/missing records rather than missing wording/);
    expect(reviewShapedGapNote([{ text: "the wording does not name an owner" }])).toBe("");
    expect(reviewShapedGapNote([])).toBe("");
  });
});

describe("the graphic degrades honestly into both exports", () => {
  const rows = toSelfCheckRows([row({ verdict: "Not met", promiseChecks: [{ promiseText: "KPI report is produced", verdict: "not evidenced", evidence: "", chunkIds: [], rationale: "No report found." }] })]);
  const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });

  it("puts the shape and the guidance in the CSV, where an SVG cannot go", () => {
    const csv = buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" }, "overview", [], w, "", ["4.1.1"]);
    expect(csv).toContain("The shape of this result");
    expect(csv).toContain("Systems & Outcomes,Band 1,5%,25%,NO");
    expect(csv).toContain("How to reach a higher band");
    expect(csv).toContain("Key systems are interacting with one another");
    expect(csv).toContain("Procedure review records");
    expect(csv).toContain("KPI report is produced");
  });

  it("puts the same in the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w, itemIds: ["4.1.1"],
    });
    expect(html).toContain("The shape of this result");
    expect(html).toContain("<b>NO</b>");
    expect(html).toContain("How to reach a higher band");
    expect(html).toContain("Many to most trends and current performance levels");
    expect(html).toContain("Procedure review records");
  });
});
