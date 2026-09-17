import { describe, it, expect } from "vitest";
import { buildBandWorking, bandCoverageNote, bandGraphic, bandGraphicSvg, SCREEN_BAND_PALETTE, PRINT_BAND_PALETTE, TWO_DIMENSIONS_NOTE, ROWS_DO_NOT_SUM_NOTE, DIMENSION_SOURCE, BAND_LADDER } from "../selfCheckBanding";
import { unassessedDimensions, runNamedGaps, reviewShapedGapNote, IMPROVE_HEADLINE, IMPROVE_WHY } from "../selfCheckImprove";
import { VERDICT_LEGEND, PLAIN_VERDICT, PPD_PLAIN_VERDICT, RECORDS_PLAIN_VERDICT, bandLineOf, NO_BAND_LINE, buildSelfCheckHtml, buildSelfCheckCsv, toSelfCheckRows, countSelfCheck } from "../selfCheck";
import type { EvidenceAssessmentRow } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "4.1.1.DS1", gd4ItemId: "4.1.1", requirementText: "Ensure counsellors are trained.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Partial", comment: "Partly shown.", ...over,
});

describe("the self-check reports only the dimensions it actually assessed", () => {
  // The defect this pins: the model diagnoses all four dimensions from lines
  // that say outright it never opened the evidence for two of them. Feeding
  // those into a total understated a genuinely Band 4 area as Band 3 and a
  // genuinely Band 3 area as Band 2 (measured against apsrMatrixResult). The
  // two are dropped at the one place the rows are built, so NO surface can
  // print a band, a percentage or a descriptor for them.
  it("refuses the model's score for the two dimensions it never opened", () => {
    const w = buildBandWorking({ approach: 4, processes: 4, systemsOutcomes: 3, review: 3 });
    expect(w.rows.map((r) => [r.key, r.band, r.pct, r.descriptor])).toEqual([
      ["approach", 4, 20, "An effective, efficient and organised approach meeting overall requirements is evident"],
      ["processes", 4, 20, "Intended processes are well-managed by owners; desired outputs are produced by these processes"],
      ["systemsOutcomes", undefined, 0, ""],
      ["review", undefined, 0, ""],
    ]);
  });

  it("produces no total, no sum and no overall band at all", () => {
    const w = buildBandWorking({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 });
    expect(Object.keys(w).sort()).toEqual(["maxPct", "rows"]);
    expect(w).not.toHaveProperty("band");
    expect(w).not.toHaveProperty("total");
    expect(w).not.toHaveProperty("sum");
    expect(w).not.toHaveProperty("ceilingBand");
  });

  it("quotes the official descriptor for the band each assessed dimension was given", () => {
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    expect(w.rows[0].descriptor).toBe("The beginning of an organised approach is evident");
    expect(w.rows[1].descriptor).toBe("Processes are established but with weak deployment in key areas");
  });

  it("leaves an assessed dimension with no score blank rather than inventing a zero band", () => {
    const w = buildBandWorking({ approach: 3, processes: undefined, systemsOutcomes: undefined, review: undefined });
    expect(w.rows[1].band).toBeUndefined();
    expect(w.rows[1].descriptor).toBe("");
    expect(w.rows[1].pct).toBe(0);
  });

  // A score of 0 is a real state in the auditor's example (R=0%) and has no
  // descriptor, so it must not be rendered as "Band 0".
  it("handles a zero score on an assessed dimension without pretending it is a band", () => {
    const w = buildBandWorking({ approach: 0, processes: 1, systemsOutcomes: 0, review: 0 });
    expect(w.rows[0].band).toBe(0);
    expect(w.rows[0].descriptor).toBe("");
    expect(w.rows[0].pct).toBe(0);
  });

  it("marks which two dimensions this check does not assess, and says why", () => {
    const w = buildBandWorking({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 });
    expect(w.rows.filter((r) => !r.assessedHere).map((r) => r.key)).toEqual(["systemsOutcomes", "review"]);
    expect(TWO_DIMENSIONS_NOTE).toMatch(/gives no overall band/);
    expect(TWO_DIMENSIONS_NOTE).toMatch(/one to two bands/);
    expect(DIMENSION_SOURCE.systemsOutcomes).toMatch(/Not assessed by this check/);
    expect(DIMENSION_SOURCE.review).toMatch(/Not assessed by this check/);
  });

  // The per-dimension ceiling is configurable, and the exports have no access
  // to the store. Printing the default 25% beside a percentage computed from a
  // different scale was a quiet contradiction inside one table.
  it("carries the configured per-dimension ceiling, not the default", () => {
    expect(buildBandWorking({ approach: 2 } as never).maxPct).toBe(25);
    const w = buildBandWorking({ approach: 2 } as never, {}, { maxPctPerDimension: 40, bandThresholds: [20, 40, 60, 80] });
    expect(w.maxPct).toBe(40);
    expect(bandGraphic(w).segments[0].max).toBe(40);
  });

  it("says outright that the rows below do not sum to the dimensions", () => {
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/No single requirement below carries a score/);
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/Approach/);
    expect(ROWS_DO_NOT_SUM_NOTE).toMatch(/Processes/);
  });

  // The auditor's OWN band is a recorded fact about the area and survives.
  it("still reports a band the auditor committed, and none of its own", () => {
    expect(bandLineOf({ kind: "auditor", band: 4, name: "Exceeding", totalPct: 80 }))
      .toBe("Band set by your auditor: Band 4 of 5 — Exceeding (80%)");
    expect(bandLineOf({ kind: "none" })).toBe(NO_BAND_LINE);
    expect(NO_BAND_LINE).toMatch(/gives no band/);
  });

  it("carries the whole ladder, verbatim, as reference for the two dimension bands", () => {
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

  it("puts the legend and the two dimension bands in the CSV", () => {
    const csv = buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" }, "overview", [], w);
    expect(csv).toContain("What each result means");
    expect(csv).toContain("Partly complies");
    expect(csv).toContain("What this check assessed");
    expect(csv).toContain("Approach,Band 2,10%,25%,yes");
    expect(csv).toContain("NOT assessed by this check");
    expect(csv).toContain("No single requirement below carries a score");
  });

  it("puts the legend, the glyphs, the dimensions and the ladder in the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w,
    });
    expect(html).toContain("What each result means");
    expect(html).toContain("! Partly complies");
    expect(html).toContain("What this check assessed");
    expect(html).toContain("The official band scale");
    expect(html).toContain("Meeting Expectation");
  });

  // Neither export may reach a total, a band or a descriptor for a dimension
  // nobody looked at. This is the guard against the whole defect coming back
  // through a file rather than through the screen.
  it("never prints an overall band, a total, or a score for the unassessed two", () => {
    const csv = buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" }, "overview", [], w, "", ["4.1.1"]);
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w, itemIds: ["4.1.1"],
    });
    for (const doc of [csv, html]) {
      expect(doc).not.toContain("How this band was reached");
      // No overall band, so nothing on the five-band ladder is "this result"
      // and there is no ceiling to explain.
      expect(doc).not.toContain("this result");
      expect(doc).not.toMatch(/ceiling/i);
      expect(doc).not.toMatch(/= 30%/);
    }
    // The unassessed row itself: no band, no percentage earned, and an EMPTY
    // descriptor cell. "Systems and outcomes are non-existent" is the official
    // Band 1 descriptor, and printing it beside a dimension nobody opened is
    // the exact thing this change removed. (The full five-band ladder further
    // down the document still quotes it, as reference for all five bands.)
    expect(csv).toContain("Systems & Outcomes,not scored,,25%,NO,,NOT assessed by this check");
    expect(html).toMatch(/<td>Systems &amp; Outcomes<\/td>\s*<td>not scored<\/td>\s*<td><\/td><td>25%<\/td>\s*<td><b>NO<\/b><\/td>\s*<td><\/td>/);
  });

  it("omits the dimension section when there is nothing assessed to report", () => {
    expect(buildSelfCheckCsv("4.1 Admissions", rows, { kind: "none" })).not.toContain("What this check assessed");
    expect(buildSelfCheckHtml({ areaLabel: "a", areaDescription: "d", counts: countSelfCheck(rows), band: { kind: "none" }, rows, ranAt: "x" }))
      .not.toContain("What this check assessed");
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

  // Two callers, two subjects: the auditor's committed band on the card, and
  // the dimension panel below it. Calling the panel "this band" would report
  // exactly the thing this page stopped claiming.
  it("names which of the two it is captioning", () => {
    expect(bandCoverageNote("4.1.1", ["4.1.1"], "This dimension assessment"))
      .toMatch(/^This dimension assessment covers requirement 4\.1\.1/);
    expect(bandCoverageNote("4.2.1", ["4.2.1", "4.2.2"], "This dimension assessment"))
      .toMatch(/^This dimension assessment covers requirement 4\.2\.1 ONLY/);
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

describe("the graphic draws four independent dimensions and nothing else", () => {
  const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });

  it("gives every dimension its own track and its own earned share", () => {
    const g = bandGraphic(w);
    expect(g.segments.map((s) => [s.label, s.pct, s.max])).toEqual([
      ["Approach", 10, 25], ["Processes", 10, 25], ["Systems & Outcomes", 0, 25], ["Review", 0, 25],
    ]);
  });

  // The stacked total bar and the five-band scale with the result marked on it
  // are both gone: a total whose bottom half was never assessed is not a total.
  it("carries no total, no ceiling and no band scale to mark a result on", () => {
    expect(Object.keys(bandGraphic(w))).toEqual(["segments"]);
  });

  it("carries which dimensions this check assessed, so the flat ones read as unassessed rather than bad", () => {
    expect(bandGraphic(w).segments.filter((s) => !s.assessedHere).map((s) => s.key)).toEqual(["systemsOutcomes", "review"]);
  });
});

describe("the two unassessed dimensions come with what the full audit needs", () => {
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

  it("frames the section as what the full audit will look for, not as a lost band", () => {
    expect(IMPROVE_HEADLINE).toMatch(/not assessed here, and that is not a judgement on your area/);
    expect(IMPROVE_HEADLINE).not.toMatch(/reachable/);
    expect(IMPROVE_WHY).toMatch(/full audit/);
    expect(IMPROVE_WHY).toMatch(/sets the band from all four/);
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
    expect(csv).toContain("What this check assessed");
    expect(csv).toContain("Systems & Outcomes,not scored,,25%,NO");
    expect(csv).toContain("What the full audit will look for");
    expect(csv).toContain("Key systems are interacting with one another");
    expect(csv).toContain("Procedure review records");
    expect(csv).toContain("KPI report is produced");
  });

  it("puts the same in the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w, itemIds: ["4.1.1"],
    });
    expect(html).toContain("What this check assessed");
    expect(html).toContain("<b>NO</b>");
    expect(html).toContain("What the full audit will look for");
    expect(html).toContain("Many to most trends and current performance levels");
    expect(html).toContain("Procedure review records");
  });
});

describe("one drawing, two surfaces", () => {
  const g = bandGraphic(buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 }));

  // The printed page is what gets filed as working paper, so it carries the
  // picture, not a second rendering of the same result that could drift from it.
  it("draws the same geometry for screen and for print", () => {
    const screen = bandGraphicSvg(g, SCREEN_BAND_PALETTE);
    const print = bandGraphicSvg(g, PRINT_BAND_PALETTE);
    const geometryOf = (svg: string) => svg.match(/<rect[^>]*x="[\d.]+"[^>]*width="[\d.]+"/g);
    expect(geometryOf(screen)).toEqual(geometryOf(print));
  });

  // Paper is white. A dark-mode media query must never reach a printer, so the
  // print palette carries literal colours and no custom properties at all.
  it("never sends CSS custom properties, and therefore dark mode, to the printer", () => {
    const print = bandGraphicSvg(g, PRINT_BAND_PALETTE);
    expect(print).not.toContain("var(--");
    expect(print).toContain("#");
    // The screen version DOES use them, which is how its dark mode works.
    expect(bandGraphicSvg(g, SCREEN_BAND_PALETTE)).toContain("var(--g-ink)");
  });

  it("keeps a readable minimum width on screen and lets print size itself", () => {
    expect(bandGraphicSvg(g, SCREEN_BAND_PALETTE, { minWidth: 430 })).toContain("min-width:430px");
    expect(bandGraphicSvg(g, PRINT_BAND_PALETTE)).not.toContain("min-width");
  });

  // Two SVGs in one document collide on pattern ids, and the second one then
  // paints with the first one's hatch.
  it("can carry a distinct pattern id, so two copies in one document do not collide", () => {
    expect(bandGraphicSvg(g, PRINT_BAND_PALETTE, { idSuffix: "Print" })).toContain('id="scHatchPrint"');
    expect(bandGraphicSvg(g, SCREEN_BAND_PALETTE)).toContain('id="scHatch"');
  });

  it("carries the state in words as well as in pattern, so it survives greyscale", () => {
    const svg = bandGraphicSvg(g, PRINT_BAND_PALETTE);
    expect(svg).toContain("not assessed by this check");
    expect(svg).toContain("Band 2 of 5 · 10% of 25%");
    expect(svg).toContain("they are not added up into a band here");
    expect(svg).toContain("aria-label");
    // Nothing in the picture names a band for a dimension nobody opened.
    expect(svg).not.toMatch(/Band 1/);
  });

  // Two pictures on the overall tab and no more: the shape of the tab at the
  // top, and the dimension panel below the rows. One drawing each, both from
  // the shared builders, so neither can drift from its screen copy.
  it("puts the picture in the printable document, above the table of the same numbers", () => {
    const rows = toSelfCheckRows([row({})]);
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    const html = buildSelfCheckHtml({
      areaLabel: "4.1 Admissions", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", bandWorking: w, itemIds: ["4.1.1"],
    });
    expect(html).toContain('<div class="band-graphic">');
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.indexOf("The shape of this tab")).toBeLessThan(html.indexOf("<th>Result</th>"));
    expect(html.lastIndexOf("<svg")).toBeLessThan(html.indexOf("<th>Dimension</th>"));
    expect(html).not.toContain("var(--");
  });
});
