import { describe, it, expect } from "vitest";
import { splitTrailingQuotes, samePassage, normalisePassage, mergeQuotes } from "../selfCheckEvidence";
import { toSelfCheckRows, toProcedureRows, toRecordsRows, tallySlices, feedsFor, buildSelfCheckHtml, buildSelfCheckCsv, countSelfCheck, SELF_CHECK_HEADERS } from "../selfCheck";
import { tallyBarSvg, bandGraphicSvg, bandGraphic, buildBandWorking, PRINT_BAND_PALETTE, PROCEDURE_FEEDS, RECORDS_FEEDS, OVERALL_FEEDS } from "../selfCheckBanding";
import type { EvidenceAssessmentRow, PPDReviewRow } from "../../types";

// The shape the judge prompts actually produce: the reasoning field ENDS with
// a verbatim excerpt and its chunk id, and the same passage comes back again
// in its own field (agentRuntime.ts:2560-2561 for the procedure pass,
// :3152/:3160 for the records pass).
const QUOTE = "Internal audits shall be conducted at least annually by auditors independent of the area audited";

const evRow = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "Conduct internal audits.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "An audit schedule and two audit reports are on file.",
  evidenceFiles: [], evidenceChunkIds: ["C002"],
  verdict: "Partial", comment: `It was not evident that the PEI had audited every function named in its PPD. Example: two of nine functions appear in the schedule. "${QUOTE}" (C002)`,
  evidenceQuote: QUOTE, ...over,
});

const ppdRow = (over: Partial<PPDReviewRow> = {}): PPDReviewRow => ({
  ref: "6.1.1.DS1", gd4ItemId: "6.1.1", subCriterionId: "6.1", requirementText: "Conduct internal audits.",
  verdict: "Partial", shortComment: "Partly documented, because the frequency is stated but the auditor independence rule is not.",
  fullComment: `It was not evident that the PEI had documented auditor independence in its PPD. "${QUOTE}" (C001)`,
  suggestedRewrite: "State who may audit which area.", chunkIds: ["C001"], supportQuote: QUOTE, ...over,
} as PPDReviewRow);

describe("the quote that arrives twice", () => {
  it("lifts the trailing excerpt out of the reasoning", () => {
    const { prose, quotes } = splitTrailingQuotes(`It was not evident that the PEI had done this. "${QUOTE}" (C002)`);
    expect(prose).toBe("It was not evident that the PEI had done this.");
    expect(quotes).toEqual([{ quote: QUOTE, chunkId: "C002" }]);
  });

  it("leaves a quote in the MIDDLE of a sentence where it is, because it is load-bearing prose", () => {
    const mid = 'The sheet says "four counsellors attended the session" but the roster names six, so the record is short.';
    expect(splitTrailingQuotes(mid)).toEqual({ prose: mid, quotes: [], cap: "" });
  });

  it("never empties the cell: prose that is nothing but a quote stays put", () => {
    const only = `"${QUOTE}" (C001)`;
    expect(splitTrailingQuotes(only).prose).toBe(only);
    expect(splitTrailingQuotes(only).quotes).toEqual([]);
  });

  it("handles curly quotes, a missing chunk id and more than one trailing excerpt", () => {
    const r = splitTrailingQuotes('Reasoning here. “first excerpt of the passage” (C001) "second excerpt of the passage"');
    expect(r.prose).toBe("Reasoning here.");
    expect(r.quotes.map((q) => q.quote)).toEqual(["first excerpt of the passage", "second excerpt of the passage"]);
  });

  // Conservative on purpose: a false "same passage" silently drops a second,
  // genuinely different citation. A missed match only repeats a line.
  it("treats the elided prose excerpt and the exact field as one passage", () => {
    expect(samePassage(`...${QUOTE.slice(10, 70)}...`, QUOTE)).toBe(true);
    expect(samePassage(`“${QUOTE}”`, QUOTE)).toBe(true);
    expect(normalisePassage("  “Some…  Passage,” ")).toBe("some passage");
  });

  it("does not merge two genuinely different quotes", () => {
    expect(samePassage(QUOTE, "The audit programme is approved by the Academic Board each January")).toBe(false);
    // A short fragment must not swallow everything it happens to sit inside.
    expect(samePassage("the audit", QUOTE)).toBe(false);
  });

  it("keeps the explicit citation, which carries the file name, over the prose copy", () => {
    const merged = mergeQuotes([{ file: "Internal Audit Procedure.docx", quote: QUOTE }], [{ quote: `...${QUOTE.slice(5)}`, chunkId: "C001" }], "fallback");
    expect(merged).toEqual([{ file: "Internal Audit Procedure.docx", quote: QUOTE }]);
  });

  it("adds a prose excerpt the pass did not return separately", () => {
    const merged = mergeQuotes([], [{ quote: QUOTE, chunkId: "C001" }], "your written procedure");
    expect(merged).toEqual([{ file: "your written procedure", quote: QUOTE }]);
  });

  // End to end, on all three tabs: the quote appears ONCE.
  it("prints the quote once per row on every tab", () => {
    const count = (s: string) => s.split(QUOTE).length - 1;
    expect(count(toSelfCheckRows([evRow()])[0].why)).toBe(0);
    expect(toSelfCheckRows([evRow()])[0].working!.citations).toHaveLength(1);
    expect(count(toProcedureRows([ppdRow()])[0].why)).toBe(0);
    expect(toProcedureRows([ppdRow()])[0].working!.citations).toHaveLength(1);
    expect(count(toRecordsRows([evRow()])[0].why)).toBe(0);
  });
});

describe("the engine's own capped-at block", () => {
  // agentRuntime.ts:3441 and :3472 append this AFTER the verbatim excerpt, so
  // the excerpt was no longer at the end of the string and the trailing-quote
  // lift missed it. One row on the real 6.1 run printed its quote twice.
  const capped = `Reasoning about the line. "${QUOTE}" (C002)\n\n[Capped at Partial: 2 PPD promises not evidenced — "Area 1 is covered"; "Area 2 is covered". It was not evident that the PEI had implemented these commitments in accordance with its documented PPD.]`;

  it("separates it from the reasoning, and finds the quote behind it", () => {
    const r = splitTrailingQuotes(capped);
    expect(r.prose).toBe("Reasoning about the line.");
    expect(r.quotes).toEqual([{ quote: QUOTE, chunkId: "C002" }]);
    expect(r.cap).toMatch(/^\[Capped at Partial: 2 PPD promises/);
  });

  it("reaches the row as its own field, never mixed into the reasoning", () => {
    const row = toSelfCheckRows([evRow({ comment: capped })])[0];
    expect(row.why).toBe("Reasoning about the line.");
    expect(row.cappedNote).toContain("Capped at Partial");
    expect(row.working!.citations).toHaveLength(1);
  });

  it("is absent, not empty-bracketed, on a line the engine did not cap", () => {
    expect(toSelfCheckRows([evRow()])[0].cappedNote).toBe("");
    expect(toProcedureRows([ppdRow()])[0].cappedNote).toBe("");
  });

  // Folded on screen, verbatim in the filed working paper. It is the engine's
  // exact wording and an auditor defending the verdict may need it.
  it("prints in full in both exports", () => {
    const rows = toSelfCheckRows([evRow({ comment: capped })]);
    expect(buildSelfCheckCsv("6.1", rows, { kind: "none" }, "overview")).toContain("Capped at Partial: 2 PPD promises not evidenced");
    expect(buildSelfCheckHtml({
      areaLabel: "6.1", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview",
    })).toContain('<div class="sc-capped">[Capped at Partial: 2 PPD promises not evidenced');
  });
});

describe("the one-line summary is engine-written or absent", () => {
  it("uses the procedure pass's mandatory one-sentence reason", () => {
    const r = toProcedureRows([ppdRow()])[0];
    expect(r.summary).toBe("Partly documented, because the frequency is stated but the auditor independence rule is not.");
    expect(r.summaryKind).toBe("verdictReason");
  });

  it("labels the records-side summary as what was FOUND, never as the reason", () => {
    const r = toSelfCheckRows([evRow()])[0];
    expect(r.summary).toBe("An audit schedule and two audit reports are on file.");
    expect(r.summaryKind).toBe("whatWasFound");
  });

  // The whole point: no truncation anywhere. An absent field yields nothing.
  it("gives no summary at all rather than cutting the reasoning short", () => {
    expect(toProcedureRows([ppdRow({ fullComment: "" })])[0].summary).toBe("");
    expect(toSelfCheckRows([evRow({ comment: "", evidenceSummary: "Only this." })])[0].summary).toBe("");
    // The records tab's why IS evidenceSummary, so there is nothing left over.
    expect(toRecordsRows([evRow()])[0].summary).toBe("");
    for (const r of [...toProcedureRows([ppdRow()]), ...toSelfCheckRows([evRow()])]) {
      if (r.summary) expect(r.why.startsWith(r.summary)).toBe(false);
    }
  });
});

describe("every tab carries a picture of its own", () => {
  it("counts the tab in its own vocabulary", () => {
    const c = { complies: 3, partly: 7, doesNot: 1, couldNotCheck: 0, total: 11 };
    expect(tallySlices(c, "overview").map((s) => [s.label, s.n])).toEqual([["complies", 3], ["partly complies", 7], ["does not comply", 1], ["could not check", 0]]);
    // The records pass never judges a middle state, so its bar has no slice for one.
    expect(tallySlices(c, "records").map((s) => s.label)).not.toContain("partly complies");
  });

  it("draws only the states that occurred, and names each count in words", () => {
    const svg = tallyBarSvg(tallySlices({ complies: 3, partly: 7, doesNot: 0, couldNotCheck: 0, total: 10 }, "overview"), PRINT_BAND_PALETTE);
    // The heading now states the finding, not the axis.
    expect(svg).toContain("7 of 10 requirement lines partly comply");
    expect(svg).toContain("complies");
    expect(svg).toContain("aria-label");
    // A state that did not occur is neither drawn nor listed.
    expect(svg).not.toMatch(/\bdoes not comply\b/);
    expect(tallyBarSvg(tallySlices({ complies: 0, partly: 0, doesNot: 0, couldNotCheck: 0, total: 0 }, "overview"), PRINT_BAND_PALETTE)).toBe("");
  });

  // optionAChecklistWrite.ts:31-41 — Approach is written from the PROCEDURE
  // verdict, Processes from the COMBINED one, which is what the OVERALL tab
  // shows. The marker used to sit on Records, which holds only half of that
  // combined verdict, and not on Overall, which produces it: wrong in both
  // directions. Records now marks nothing and says why.
  it("names what each tab feeds, and does not overstate the records tab", () => {
    expect(feedsFor("procedure")).toBe(PROCEDURE_FEEDS);
    expect(feedsFor("procedure-only")).toBe(PROCEDURE_FEEDS);
    expect(feedsFor("records")).toBe(RECORDS_FEEDS);
    expect(feedsFor("overview")).toBe(OVERALL_FEEDS);
    expect(PROCEDURE_FEEDS.key).toBe("approach");
    expect(OVERALL_FEEDS.key).toBe("processes");
    expect(RECORDS_FEEDS.key).toBeUndefined();
    expect(PROCEDURE_FEEDS.caption).toMatch(/what Approach is judged on/);
    expect(RECORDS_FEEDS.caption).toMatch(/combined verdict/);
    expect(RECORDS_FEEDS.caption).toMatch(/one half of that/);
  });

  it("marks the fed dimension with a word, not only a position", () => {
    const g = bandGraphic(buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 }));
    expect(bandGraphicSvg(g, PRINT_BAND_PALETTE, { feeds: PROCEDURE_FEEDS })).toContain("this tab");
    expect(bandGraphicSvg(g, PRINT_BAND_PALETTE)).not.toContain("this tab");
  });
});

describe("nothing the screen collapses is lost from the filed working paper", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({
    promiseText: `Promise number ${i + 1} is kept`, verdict: "not evidenced" as const,
    evidence: "", chunkIds: [], rationale: `No record of promise ${i + 1} was found.`,
  }));
  const rows = toSelfCheckRows([evRow({ promiseChecks: many })]);

  it("prints all fifteen missing elements, as a list, in the PDF", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "6.1 Internal audit", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview",
    });
    expect(html).toContain("What is missing (15)");
    expect(html.match(/<li>Promise number \d+ is kept/g)).toHaveLength(15);
    expect(html).toContain("Promise number 15 is kept");
    expect(html).toContain('<ul class="sc-missing">');
    // The quote is a quotation, once, not a repeat of the prose.
    expect(html).toContain("<blockquote>");
    expect(html.split(QUOTE).length - 1).toBe(1);
  });

  it("prints all fifteen in the CSV, one per line, plus the summary column", () => {
    const csv = buildSelfCheckCsv("6.1 Internal audit", rows, { kind: "none" }, "overview");
    expect(SELF_CHECK_HEADERS).toContain("In one line");
    expect(csv).toContain("Promise number 15 is kept");
    expect(csv).toContain("An audit schedule and two audit reports are on file.");
    expect(csv.split("Promise number").length - 1).toBe(15);
  });

  it("puts the shape of the tab in both exports, on a half-tab as well", () => {
    const procRows = toProcedureRows([ppdRow()]);
    const csv = buildSelfCheckCsv("6.1 Internal audit", procRows, { kind: "none" }, "procedure");
    expect(csv).toContain("The only requirement line partly documented");
    expect(csv).toContain(PROCEDURE_FEEDS.caption);
    const html = buildSelfCheckHtml({
      areaLabel: "6.1 Internal audit", areaDescription: "d", counts: countSelfCheck(procRows),
      band: { kind: "none" }, rows: procRows, ranAt: "x", view: "procedure",
      bandWorking: buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 }),
    });
    expect(html).toContain("The only requirement line partly documented");
    expect(html).toContain("What this tab feeds");
    expect(html).toContain(PROCEDURE_FEEDS.caption);
    // The full dimension panel belongs to the whole area, not to one half of it.
    expect(html).not.toContain("<h2>What this check assessed</h2>");
    // And the picture says which tab it is describing, for a screen reader
    // too. It used to prefix the aria-label with "Which dimension this tab
    // feeds: Approach", which was the spoken twin of the arrow drawn beside
    // the row. Both are gone; the aria-label now opens with the same full
    // caption the sighted reader gets, which says it in a sentence.
    expect(html).toMatch(new RegExp(`aria-label="${PROCEDURE_FEEDS.caption.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(html).not.toContain("Which dimension this tab feeds");
  });

  it("puts the verdict first in the printed row, so a printed page scans the same way", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "a", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview",
    });
    expect(html).toContain("<th>Result</th><th>What the requirement asks</th>");
    expect(html).toContain('<td class="sc-verdict"><b>! Partly complies</b></td>');
  });
});
