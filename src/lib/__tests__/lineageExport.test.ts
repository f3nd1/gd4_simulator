import { describe, it, expect } from "vitest";
import { buildLineageCsv, buildLineagePdfHtml, type LineageExportMeta, type LineageExportRow } from "../lineageExport";

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
  it("uses the exact requested column order per tab", () => {
    const csv = buildLineageCsv(policyMeta(), [multiFileRow()]);
    const headerLine = csv.split("\r\n")[0];
    expect(headerLine).toBe("GD4 Requirement,Ref,Policy Verdict,Policy File(s),Policy Clause,Rationale");

    const evCsv = buildLineageCsv(policyMeta({ tab: "evidence" }), [multiFileRow()]);
    expect(evCsv.split("\r\n")[0]).toBe("GD4 Requirement,Ref,Evidence Verdict,Evidence File(s),Supporting Passage,Rationale");
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

describe("buildLineagePdfHtml", () => {
  it("renders a real <table> with <td> text cells — never a canvas/image, so print output stays selectable text", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow()]);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<img");
  });

  it("includes the run header, date, overall status line, and the in-app-expand caption", () => {
    const html = buildLineagePdfHtml(policyMeta(), [multiFileRow()]);
    expect(html).toContain("6.2 Management Review");
    expect(html).toContain("2 Documented");
    expect(html).toContain("Not covered");
    expect(html).toContain("Expand rows in-app for quoted passages and per-clause rationale.");
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
});
