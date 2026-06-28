// Tests for extractSpreadsheetText focusing on edge cases:
// multi-sheet workbooks, the 200-row cap, blank rows being filtered,
// and the separator between sheets.
import { describe, it, expect } from "vitest";
import { extractSpreadsheetText } from "../drive/textUtils";
import type { WorkBook } from "xlsx";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWorkbook(sheets: Record<string, string[][]>): WorkBook {
  const workbook: WorkBook = {
    SheetNames: Object.keys(sheets),
    Sheets: {},
  };
  for (const [name, rows] of Object.entries(sheets)) {
    const ws: Record<string, unknown> = {};
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cellRef = `${String.fromCharCode(65 + c)}${r + 1}`;
        ws[cellRef] = { v: rows[r][c], t: "s" };
      }
    }
    if (rows.length > 0) {
      ws["!ref"] = `A1:${String.fromCharCode(65 + rows[0].length - 1)}${rows.length}`;
    }
    workbook.Sheets[name] = ws as ReturnType<() => import("xlsx").WorkSheet>;
  }
  return workbook;
}

// ── 1. Basic extraction ────────────────────────────────────────────────────

describe("extractSpreadsheetText basic", () => {
  it("single sheet with one data row includes all parts", () => {
    const wb = makeWorkbook({
      Sheet1: [
        ["Name", "Score"],
        ["Alice", "90"],
      ],
    });
    const text = extractSpreadsheetText(wb, "test.xlsx");
    expect(text).toContain("File: test.xlsx");
    expect(text).toContain("Sheet: Sheet1");
    expect(text).toContain("Headers: Name | Score");
    expect(text).toContain("Alice | 90");
  });

  it("row numbering starts at 1", () => {
    const wb = makeWorkbook({
      Sheet1: [
        ["Item"],
        ["First"],
        ["Second"],
      ],
    });
    const text = extractSpreadsheetText(wb, "items.xlsx");
    expect(text).toContain("1. First");
    expect(text).toContain("2. Second");
  });

  it("empty sheet produces empty-sheet note, not a headers line", () => {
    const wb = makeWorkbook({ Empty: [] });
    const text = extractSpreadsheetText(wb, "empty.xlsx");
    expect(text).toContain("(empty sheet)");
    expect(text).not.toContain("Headers:");
  });
});

// ── 2. Multi-sheet workbook ────────────────────────────────────────────────

describe("extractSpreadsheetText multi-sheet", () => {
  it("both sheet names appear in output", () => {
    const wb = makeWorkbook({
      Alpha: [["X"], ["1"]],
      Beta: [["Y"], ["2"]],
    });
    const text = extractSpreadsheetText(wb, "multi.xlsx");
    expect(text).toContain("Sheet: Alpha");
    expect(text).toContain("Sheet: Beta");
  });

  it("sheets are separated by the --- divider", () => {
    const wb = makeWorkbook({
      First: [["A"], ["1"]],
      Second: [["B"], ["2"]],
    });
    const text = extractSpreadsheetText(wb, "sep.xlsx");
    expect(text).toContain("---");
    // Both file name occurrences exist (one per sheet)
    expect(text.split("File: sep.xlsx").length - 1).toBe(2);
  });
});

// ── 3. Row cap ─────────────────────────────────────────────────────────────

describe("extractSpreadsheetText row cap", () => {
  it("exactly 200 data rows are shown without truncation notice", () => {
    const dataRows = Array.from({ length: 200 }, (_, i) => [`Row${i + 1}`, `${i + 1}`]);
    const wb = makeWorkbook({ Data: [["Label", "Num"], ...dataRows] });
    const text = extractSpreadsheetText(wb, "capped.xlsx");
    expect(text).not.toContain("more rows omitted");
    expect(text).toContain("Row200");
  });

  it("201 data rows shows truncation notice for the extra row", () => {
    const dataRows = Array.from({ length: 201 }, (_, i) => [`Row${i + 1}`, `${i + 1}`]);
    const wb = makeWorkbook({ Data: [["Label", "Num"], ...dataRows] });
    const text = extractSpreadsheetText(wb, "overflow.xlsx");
    expect(text).toContain("(+1 more rows omitted)");
    expect(text).not.toContain("Row201");
  });

  it("300 data rows shows 100 omitted", () => {
    const dataRows = Array.from({ length: 300 }, (_, i) => [`Row${i + 1}`, `${i + 1}`]);
    const wb = makeWorkbook({ Data: [["Label", "Num"], ...dataRows] });
    const text = extractSpreadsheetText(wb, "big.xlsx");
    expect(text).toContain("(+100 more rows omitted)");
  });
});

// ── 4. Blank row filtering ─────────────────────────────────────────────────

describe("extractSpreadsheetText blank row filtering", () => {
  it("all-empty rows are excluded from output", () => {
    const wb = makeWorkbook({
      Sheet1: [
        ["Name", "Score"],
        ["Alice", "90"],
        ["", ""],
        ["Bob", "75"],
      ],
    });
    const text = extractSpreadsheetText(wb, "gaps.xlsx");
    // Should only have rows for Alice and Bob — blank row absent
    const rowLines = text
      .split("\n")
      .filter((l) => /^\d+\./.test(l));
    expect(rowLines).toHaveLength(2);
    expect(rowLines[0]).toContain("Alice");
    expect(rowLines[1]).toContain("Bob");
  });
});

// ── 5. File name in every sheet block ──────────────────────────────────────

describe("extractSpreadsheetText file name labelling", () => {
  it("file name appears in each sheet block of a multi-sheet file", () => {
    const wb = makeWorkbook({
      Sheet1: [["A"], ["1"]],
      Sheet2: [["B"], ["2"]],
      Sheet3: [["C"], ["3"]],
    });
    const text = extractSpreadsheetText(wb, "labelled.xlsx");
    const count = (text.match(/File: labelled\.xlsx/g) || []).length;
    expect(count).toBe(3);
  });
});
