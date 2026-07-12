import { describe, it, expect } from "vitest";
import { buildLineageCsv, buildLineagePdfHtml, lineageColumnsFor, type LineageExportMeta, type LineageExportRow, type LineageClauseDetailItem } from "../lineageExport";

function policyMeta(overrides: Partial<LineageExportMeta> = {}): LineageExportMeta {
  return { tab: "policy", runLabel: "6.2 Management Review", runAt: "2026-07-01T00:00:00.000Z", statusLine: "2 Documented · 1 Not covered", ...overrides };
}

function multiFileRow(overrides: Partial<LineageExportRow> = {}): LineageExportRow {
  return {
    ref: "6.2.1.DS1.a",
    requirementText: "Describe the process for management review, including frequency, scope and follow-up.",
    verdictLabel: "Partly",
    fileNames: ["Handbook.pdf", "Review_Charter.pdf", "Onboarding_Pack.pdf"],
    clauseOrPassage: "4.2 Management Review Framework, Step 1: Review Cadence; 4.3 Scope of Review",
    rationale: "Follow-up tracking is not documented in any PPD passage.",
    barColor: "#d97706",
    ...overrides,
  };
}

describe("buildLineageCsv", () => {
  it("uses the exact matrix column order per tab — evidence leads Policy Promise/Clause after the requirement (the approved reframe)", () => {
    const csv = buildLineageCsv(policyMeta(), [multiFileRow()]);
    const headerLine = csv.split("\r\n")[0];
    expect(headerLine).toBe("GD4 Requirement,Ref,Policy Verdict,Policy File(s),Policy Clause,Rationale");

    const evCsv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow()]);
    expect(evCsv.split("\r\n")[0]).toBe("GD4 Requirement,Ref,Policy Promise/Clause,Evidence Verdict,Evidence File(s),Supporting Passage,Rationale,Suggested Action");
  });

  it("Policy Promise/Clause: evidence tab only — exports the PPD-side text, em-dash when absent (old stored run)", () => {
    const withPromise = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ policyPromise: "Internal assessors must not review a unit they manage." })]);
    expect(withPromise).toContain("Internal assessors must not review a unit they manage.");

    // Old stored run predating ppdExtract/ppdVerdict → em-dash, never an error/blank.
    const noPromise = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ requirementText: "Plain req.", clauseOrPassage: "", rationale: "", fileNames: [] })]);
    expect(noPromise.split("\r\n")[1]).toBe("Plain req.,6.2.1.DS1.a,—,Partly,—,—,—,—");

    // Policy tab has no Policy Promise column at all, even if the field were set.
    const policyCsv = buildLineageCsv(policyMeta(), [multiFileRow({ policyPromise: "Should not appear on the policy tab." })]);
    expect(policyCsv).not.toContain("Should not appear on the policy tab");
    expect(policyCsv.split("\r\n")[0]).not.toContain("Policy Promise");
  });

  it("includes the Suggested Action column on the evidence tab only, and shows an em-dash when unset", () => {
    const evCsv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ suggestedAction: "Add owner and timeline fields to the remaining 17 unassigned actions in the Management Review Meeting minutes." })]);
    expect(evCsv).toContain("Add owner and timeline fields to the remaining 17 unassigned actions");

    const evCsvEmpty = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow()]);
    const dataLine = evCsvEmpty.split("\r\n")[1];
    expect(dataLine.endsWith(",—")).toBe(true);

    // Policy tab has no Suggested Action column at all, even if the field were set.
    const policyCsv = buildLineageCsv(policyMeta(), [multiFileRow({ suggestedAction: "Should not appear on the policy tab." })]);
    expect(policyCsv).not.toContain("Should not appear on the policy tab");
    expect(policyCsv.split("\r\n")[0]).not.toContain("Suggested Action");
  });

  it("joins ALL cited files with '; ' — no truncation, no '+N more'", () => {
    const csv = buildLineageCsv(policyMeta(), [multiFileRow()]);
    expect(csv).toContain("Handbook.pdf; Review_Charter.pdf; Onboarding_Pack.pdf");
    expect(csv).not.toContain("+2 more");
    expect(csv).not.toContain("more file");
  });

  it("escapes commas/quotes/newlines via the shared csvCell utility (reused, not reimplemented)", () => {
    const row = multiFileRow({
      requirementText: 'Requirement with a comma, a "quoted" phrase, and a\nline break.',
      rationale: 'Rationale, also with a comma and "quotes".',
    });
    const csv = buildLineageCsv(policyMeta(), [row]);
    // A field containing a comma/quote/newline must be wrapped in quotes with doubled inner quotes.
    expect(csv).toContain('"Requirement with a comma, a ""quoted"" phrase, and a\nline break."');
    expect(csv).toContain('"Rationale, also with a comma and ""quotes""."');
  });

  it("one row per requirement line, in the order given", () => {
    const rows = [
      multiFileRow({ ref: "6.2.1.DS1.a" }),
      multiFileRow({ ref: "6.2.1.DS1.b", requirementText: "Sub-requirement b." }),
    ];
    const csv = buildLineageCsv(policyMeta(), rows);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain("6.2.1.DS1.a");
    expect(lines[2]).toContain("6.2.1.DS1.b");
  });

  it("shows an em-dash for genuinely empty file/clause/rationale cells (old-format run, gap row), never a bare blank cell", () => {
    const row = multiFileRow({ requirementText: "Simple requirement text.", fileNames: [], clauseOrPassage: "", rationale: "" });
    const csv = buildLineageCsv(policyMeta(), [row]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe("Simple requirement text.,6.2.1.DS1.a,Partly,—,—,—");
  });
});

describe("export column selection (the picker) — one registry drives picker, CSV and PDF alike", () => {
  it("no selection = every column: full parity with the old fixed export", () => {
    expect(buildLineageCsv(policyMeta(), [multiFileRow()])).toBe(buildLineageCsv(policyMeta(), [multiFileRow()], lineageColumnsFor("policy").map((c) => c.key)));
    expect(buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [multiFileRow()])).toBe(
      buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [multiFileRow()], lineageColumnsFor("evidence").map((c) => c.key)));
  });

  it("a subset selection exports exactly those columns' headers and cells, nothing else", () => {
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ policyPromise: "promise text" })], ["requirement", "verdict"]);
    expect(csv.split("\r\n")[0]).toBe("GD4 Requirement,Ref,Evidence Verdict");
    expect(csv).not.toContain("promise text");
    expect(csv).not.toContain("Handbook.pdf"); // files column unchecked → its content is gone too
    expect(csv.split("\r\n")[1]).toContain("Partly");
  });

  it("selection can only TRIM, never reorder — keys given out of matrix order still export in matrix order", () => {
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow()], ["rationale", "requirement", "policyPromise"]);
    expect(csv.split("\r\n")[0]).toBe("GD4 Requirement,Ref,Policy Promise/Clause,Rationale,Suggested Action");
  });

  it("unchecking a matrix column drops ALL its exported sub-columns (requirement drops Ref; evidence rationale drops Suggested Action)", () => {
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ suggestedAction: "fix it" })], ["verdict", "files"]);
    expect(csv.split("\r\n")[0]).toBe("Evidence Verdict,Evidence File(s)");
    expect(csv).not.toContain("Ref");
    expect(csv).not.toContain("fix it");
  });

  it("the PDF honours the same selection: only the chosen <th>/<td> columns render", () => {
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [multiFileRow({ policyPromise: "promise text" })], ["policyPromise", "verdict"]);
    expect(html).toContain("<th>Policy Promise/Clause</th>");
    expect(html).toContain("<th>Evidence Verdict</th>");
    expect(html).not.toContain("<th>GD4 Requirement</th>");
    expect(html).not.toContain("<th>Supporting Passage</th>");
    expect(html).toContain("promise text");
    expect(html).not.toContain("Handbook.pdf");
  });

  it("selected content is never truncated — selection controls WHICH columns, not how much of one", () => {
    const longRationale = "R".repeat(3000);
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow({ rationale: longRationale })], ["rationale"]);
    expect(csv).toContain(longRationale);
  });

  it("an empty selection falls back to every column (the picker UI blocks it; the builder must not emit an empty file)", () => {
    const csv = buildLineageCsv(policyMeta(), [multiFileRow()], []);
    expect(csv.split("\r\n")[0]).toBe("GD4 Requirement,Ref,Policy Verdict,Policy File(s),Policy Clause,Rationale");
  });

  it("lineageColumnsFor: evidence has 6 pickable columns incl. policyPromise; policy has 5 without it", () => {
    expect(lineageColumnsFor("evidence").map((c) => c.key)).toEqual(["requirement", "policyPromise", "verdict", "files", "clauseOrPassage", "rationale"]);
    expect(lineageColumnsFor("policy").map((c) => c.key)).toEqual(["requirement", "verdict", "files", "clauseOrPassage", "rationale"]);
  });
});

describe("buildLineagePdfHtml", () => {
  it("renders a real <table> with <td> text cells — never a canvas/image, so print output stays selectable text", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow()]);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<img");
  });

  it("includes the run header, date, overall status line, and the (now honest, detail-aware) caption", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow()]);
    expect(html).toContain("6.2 Management Review");
    expect(html).toContain("2 Documented");
    expect(html).toContain("Not covered");
    // The old static "Expand rows in-app for quoted passages..." caption no
    // longer applies now that detail CAN be included in the export itself —
    // the caption is now conditional on includeClauseDetail (see below).
    expect(html).toContain("Clause-by-clause detail for covered/partial lines is included beneath each line below.");
  });

  it("shows the full untruncated file list and clause text, not a '+N more' summary", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow()]);
    expect(html).toContain("Handbook.pdf; Review_Charter.pdf; Onboarding_Pack.pdf");
    expect(html).not.toMatch(/\+\d+ more/);
  });

  it("preserves the row's coverage colour as a left border with print-color-adjust so it survives print/PDF", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow({ barColor: "#16a34a" })]);
    expect(html).toContain("border-left:4px solid #16a34a");
    expect(html).toContain("print-color-adjust: exact");
  });

  it("escapes HTML-significant characters in cell content", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow({ requirementText: "Covers <script>alert(1)</script> & \"quotes\"" })]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints the sampling-basis caveat on both exports when provided, and omits it cleanly when absent (old callers)", () => {
    const caveat = "Assessed only the 3 files provided on 11 Jul 2026. Conclusions do not cover records that were not uploaded.";
    const csv = buildLineageCsv(policyMeta({ caveat }), [multiFileRow()]);
    expect(csv).toContain(`"Sampling basis: ${caveat}"`);
    const html = buildLineagePdfHtml(policyMeta({ caveat }), [multiFileRow()]);
    expect(html).toContain("Sampling basis:");
    expect(html).toContain("Conclusions do not cover records that were not uploaded.");
    // No caveat → both exports unchanged.
    expect(buildLineageCsv(policyMeta(), [multiFileRow()])).not.toContain("Sampling basis");
    expect(buildLineagePdfHtml(policyMeta(), [multiFileRow()])).not.toContain("Sampling basis");
  });

  it("adds a Suggested Action column+cell on the evidence tab only", () => {
    const evHtml = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [multiFileRow({ suggestedAction: "Add owner and timeline fields to the remaining 17 unassigned actions." })]);
    expect(evHtml).toContain("<th>Suggested Action</th>");
    expect(evHtml).toContain("Add owner and timeline fields to the remaining 17 unassigned actions.");

    const policyHtml = buildLineagePdfHtml(policyMeta(), [multiFileRow({ suggestedAction: "Should not appear on the policy tab." })]);
    expect(policyHtml).not.toContain("Suggested Action");
    expect(policyHtml).not.toContain("Should not appear on the policy tab");
  });
});

// Task 4: clause-by-clause detail in the export (previously flat-matrix only).
// Approach decided here (no pre-existing nested-CSV convention in this
// codebase to follow): CSV flattens each sub-part into its own row, prefixed
// "↳ ", reusing the SAME columns as the parent (no new columns); PDF nests a
// real 4-column table beneath the parent row, matching the in-app ClauseMatrix.
function evFoundItem(overrides: Partial<LineageClauseDetailItem> = {}): LineageClauseDetailItem {
  return {
    name: "Stakeholders from different functions are present and actively engaged",
    found: true,
    col2: "To foster a culture of innovation, key stakeholders are actively engaged at every level of planning.",
    fileName: "SQ Division Meeting Minutes.pdf",
    passage: '"Present: Felix (Principal, Chairman), Renzo (IT Manager), Irene (HR Officer)."',
    remarks: "Meeting minutes list cross-functional attendance with assigned roles.",
    ...overrides,
  };
}
function evNotFoundItem(overrides: Partial<LineageClauseDetailItem> = {}): LineageClauseDetailItem {
  return {
    name: "Stakeholder input is incorporated into the Vision, Mission and Long-term Goals",
    found: false,
    col2: "To foster a culture of innovation, key stakeholders are actively engaged at every level of planning.",
    remarks: "None of the provided records mention stakeholder input used to set or revise Vision/Mission.",
    ...overrides,
  };
}
function ppdClauseItem(overrides: Partial<LineageClauseDetailItem> = {}): LineageClauseDetailItem {
  return {
    name: "Stakeholders are actively engaged in planning",
    found: true,
    col2: '§ 4. Approach\n"key stakeholders are actively engaged at every level of the organisation\'s planning and execution processes"',
    fileName: "PPD-SGL-SQ-6.3.1 Innovation.pdf",
    remarks: "Clause 4 names stakeholder engagement explicitly.",
    ...overrides,
  };
}

describe("buildLineageCsv — clause-by-clause detail (Task 4)", () => {
  it("defaults to included (no 4th arg) and emits one flattened, ↳-prefixed row per sub-part directly after its parent", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem(), evNotFoundItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(4); // header + parent + 2 sub-parts
    expect(lines[2]).toContain("↳ Stakeholders from different functions are present");
    expect(lines[2]).toContain("6.2.1.DS1.a"); // ref repeated for grouping
    expect(lines[3]).toContain("↳ Stakeholder input is incorporated");
  });

  it("evidence sub-part row: Verdict=Found/Not found, File(s)=the ONE attributed file, Supporting Passage=the sub-part's own full passage, Policy Promise/Clause=col2 repeated", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row]);
    const detailLine = csv.split("\r\n")[2];
    expect(detailLine).toContain("Found");
    expect(detailLine).toContain("SQ Division Meeting Minutes.pdf");
    expect(detailLine).toContain("Present: Felix (Principal, Chairman)");
    expect(detailLine).toContain("To foster a culture of innovation");
  });

  it('not-found sub-part row shows "Not found" and no fabricated passage/file', () => {
    const row = multiFileRow({ clauseDetail: [evNotFoundItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row]);
    const detailLine = csv.split("\r\n")[2];
    expect(detailLine).toContain("Not found");
    expect(detailLine).toContain("↳ Stakeholder input is incorporated");
    expect(detailLine).not.toContain("Present: Felix"); // no passage fabricated for a not-found sub-part
  });

  it("PPD tab sub-part row: Policy Clause column carries the sub-part's OWN clause+quote (not the row-level clause list)", () => {
    const row = multiFileRow({ clauseOrPassage: "4.2 Row-level clause list", clauseDetail: [ppdClauseItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "policy" }), [row]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("4.2 Row-level clause list"); // parent row unaffected
    expect(lines[2]).toContain("§ 4. Approach");
    expect(lines[2]).toContain("key stakeholders are actively engaged");
    expect(lines[2]).toContain("PPD-SGL-SQ-6.3.1 Innovation.pdf");
  });

  it("includeClauseDetail=false omits every sub-part row, leaving only the flat parent rows", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem(), evNotFoundItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row], undefined, false);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + parent only
    expect(csv).not.toContain("↳");
  });

  it("a row with no clauseDetail (flat gap/not-checked line) adds nothing extra regardless of the flag", () => {
    const row = multiFileRow({ clauseDetail: undefined });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row], undefined, true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2); // header + parent only
  });

  it("column selection applies to sub-part rows too — deselecting files hides the sub-part's attributed file", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem()] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row], ["requirement", "verdict"]);
    expect(csv).not.toContain("SQ Division Meeting Minutes.pdf");
  });

  it("no truncation: a long sub-part passage exports in full", () => {
    const longPassage = `"${"P".repeat(3000)}"`;
    const row = multiFileRow({ clauseDetail: [evFoundItem({ passage: longPassage })] });
    const csv = buildLineageCsv(policyMeta({ tab: "evidence" }), [row]);
    expect(csv).toContain("P".repeat(3000));
  });
});

describe("buildLineagePdfHtml — clause-by-clause detail (Task 4)", () => {
  it("defaults to included and nests a REAL 4-column table beneath the parent row, matching the in-app ClauseMatrix headers", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem(), evNotFoundItem()] });
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [row]);
    expect(html).toContain("Clause by clause");
    expect(html).toContain("<th>Clause requirement</th>");
    expect(html).toContain("<th>PPD clause / extract</th>");
    expect(html).toContain("<th>File and Supporting passage</th>");
    expect(html).toContain("<th>Remarks</th>");
    expect(html).toContain("Stakeholders from different functions are present");
    expect(html).toContain("Stakeholder input is incorporated");
  });

  it("PPD tab nested table uses the PPD-specific headers (Policy clause & quote / File / Rationale)", () => {
    const row = multiFileRow({ clauseDetail: [ppdClauseItem()] });
    const html = buildLineagePdfHtml(policyMeta({ tab: "policy" }), [row]);
    expect(html).toContain("<th>Policy clause &amp; quote</th>");
    expect(html).toContain("<th>File</th>");
    expect(html).toContain("<th>Rationale</th>");
  });

  it("includeClauseDetail=false renders no nested table and the caption says so honestly", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem()] });
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [row], undefined, false);
    expect(html).not.toContain("Clause by clause");
    expect(html).not.toContain("Stakeholders from different functions are present");
    expect(html).toContain("Clause-by-clause detail was excluded from this export");
  });

  it("nested detail content is never truncated", () => {
    const longRemark = "R".repeat(3000);
    const row = multiFileRow({ clauseDetail: [evFoundItem({ remarks: longRemark })] });
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [row]);
    expect(html).toContain("R".repeat(3000));
  });

  it("a row with no clauseDetail renders no nested table beneath it", () => {
    const row = multiFileRow({ clauseDetail: undefined });
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [row]);
    expect(html).not.toContain("Clause by clause");
  });

  it("escapes HTML in nested detail content", () => {
    const row = multiFileRow({ clauseDetail: [evFoundItem({ remarks: "Covers <script>alert(1)</script>" })] });
    const html = buildLineagePdfHtml(policyMeta({ tab: "evidence" }), [row]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
