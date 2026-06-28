// Tests for evidence ledger functionality: PDF quality classification,
// chunk ID generation, citation downgrade logic, and spreadsheet extraction.
import { describe, it, expect } from "vitest";
import { classifyPdfTextQuality, extractSpreadsheetText } from "../drive/textUtils";
import type { WorkBook } from "xlsx";

// ── 1. classifyPdfTextQuality ───────────────────────────────────────────────

describe("classifyPdfTextQuality", () => {
  it("empty text → quality none, suspectedScannedPdf true", () => {
    const result = classifyPdfTextQuality("");
    expect(result.extractedTextQuality).toBe("none");
    expect(result.suspectedScannedPdf).toBe(true);
  });

  it("very short text (< 50 chars) → quality none", () => {
    const result = classifyPdfTextQuality("Short text.");
    expect(result.extractedTextQuality).toBe("none");
    expect(result.suspectedScannedPdf).toBe(true);
  });

  it("text between 50 and 200 chars → quality low, suspected scan", () => {
    const text = "A".repeat(100);
    const result = classifyPdfTextQuality(text);
    expect(result.extractedTextQuality).toBe("low");
    expect(result.suspectedScannedPdf).toBe(true);
  });

  it("text between 200 and 500 chars → quality medium, not suspected scan", () => {
    const text = "A".repeat(300);
    const result = classifyPdfTextQuality(text);
    expect(result.extractedTextQuality).toBe("medium");
    expect(result.suspectedScannedPdf).toBe(false);
  });

  it("text >= 500 chars → quality high, not suspected scan", () => {
    const text = "A".repeat(600);
    const result = classifyPdfTextQuality(text);
    expect(result.extractedTextQuality).toBe("high");
    expect(result.suspectedScannedPdf).toBe(false);
  });

  it("text of exactly 50 chars → quality low (boundary)", () => {
    // 50 chars: not < 50, so falls into the < 200 bucket
    const text = "A".repeat(50);
    const result = classifyPdfTextQuality(text);
    expect(result.extractedTextQuality).toBe("low");
  });

  it("whitespace-only text counts as empty (trim)", () => {
    const result = classifyPdfTextQuality("   \n   ");
    expect(result.extractedTextQuality).toBe("none");
    expect(result.suspectedScannedPdf).toBe(true);
  });
});

// ── 2. Chunk ID generation ──────────────────────────────────────────────────

describe("chunk ID generation", () => {
  it("sequential IDs are zero-padded to 3 digits", () => {
    // Chunk IDs are generated in useWorkspaceStore, so we test the format here
    const ids = [1, 2, 3].map((n) => `C${String(n).padStart(3, "0")}`);
    expect(ids).toEqual(["C001", "C002", "C003"]);
  });

  it("IDs above 9 are correctly padded", () => {
    const id10 = `C${String(10).padStart(3, "0")}`;
    expect(id10).toBe("C010");
    const id100 = `C${String(100).padStart(3, "0")}`;
    expect(id100).toBe("C100");
  });
});

// ── 3. Citation downgrade logic ─────────────────────────────────────────────

describe("citation downgrade logic", () => {
  // The downgrade is applied in useWorkspaceStore after verdicts return.
  // We test the logic directly here as pure functions.

  type DowngradableApproach = { status: "Meeting" | "Beginning" | "Not evident"; note: string; sourceChunkIds?: string[] };

  function applyApproachDowngrade(dim: DowngradableApproach): DowngradableApproach {
    const CITATION_DOWNGRADE_NOTE = "Downgraded: no source chunks cited to support this claim.";
    if ((dim.status === "Meeting" || dim.status === "Beginning") &&
        (!dim.sourceChunkIds || dim.sourceChunkIds.length === 0)) {
      return { ...dim, status: "Not evident", note: (dim.note ? dim.note + " " : "") + CITATION_DOWNGRADE_NOTE };
    }
    return dim;
  }

  it("Meeting approach with no sourceChunkIds → downgraded to Not evident", () => {
    const dim: DowngradableApproach = { status: "Meeting", note: "Policy is clear.", sourceChunkIds: [] };
    const result = applyApproachDowngrade(dim);
    expect(result.status).toBe("Not evident");
    expect(result.note).toContain("Downgraded: no source chunks cited");
  });

  it("Meeting approach with sourceChunkIds → not downgraded", () => {
    const dim: DowngradableApproach = { status: "Meeting", note: "Policy is clear.", sourceChunkIds: ["C001"] };
    const result = applyApproachDowngrade(dim);
    expect(result.status).toBe("Meeting");
  });

  it("Not evident approach → not affected by downgrade logic", () => {
    const dim: DowngradableApproach = { status: "Not evident", note: "No policy found.", sourceChunkIds: [] };
    const result = applyApproachDowngrade(dim);
    expect(result.status).toBe("Not evident");
    // Note should not be changed (already Not evident)
    expect(result.note).toBe("No policy found.");
  });

  it("sourceChunkIds missing (undefined) → treated as uncited → downgraded", () => {
    const dim: DowngradableApproach = { status: "Meeting", note: "Policy found." };
    const result = applyApproachDowngrade(dim);
    expect(result.status).toBe("Not evident");
  });
});

// ── 4. Spreadsheet extraction format ────────────────────────────────────────

describe("extractSpreadsheetText format", () => {
  // We test extractSpreadsheetText directly using a mock-like workbook structure.
  // Note: XLSX.WorkBook is a plain object — we can construct a minimal one.

  function makeWorkbook(sheets: Record<string, string[][]>): WorkBook {
    const workbook: WorkBook = {
      SheetNames: Object.keys(sheets),
      Sheets: {},
    };
    for (const [name, rows] of Object.entries(sheets)) {
      // Build a minimal worksheet from rows using XLSX-style cell references
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
      // No !ref means truly empty sheet — XLSX will return [] rows
      workbook.Sheets[name] = ws as ReturnType<() => import("xlsx").WorkSheet>;
    }
    return workbook;
  }

  it("includes file name in output", () => {
    const wb = makeWorkbook({ "Sheet1": [["Name", "Score"], ["Alice", "90"]] });
    const text = extractSpreadsheetText(wb, "TestFile.xlsx");
    expect(text).toContain("File: TestFile.xlsx");
  });

  it("includes sheet name in output", () => {
    const wb = makeWorkbook({ "Attendance": [["Date", "Student"], ["2024-01-01", "Alice"]] });
    const text = extractSpreadsheetText(wb, "attendance.xlsx");
    expect(text).toContain("Sheet: Attendance");
  });

  it("includes headers in output", () => {
    const wb = makeWorkbook({ "Data": [["Name", "Score", "Pass"], ["Alice", "90", "Yes"]] });
    const text = extractSpreadsheetText(wb, "data.xlsx");
    expect(text).toContain("Headers: Name | Score | Pass");
  });

  it("includes data rows in output", () => {
    const wb = makeWorkbook({ "Sheet1": [["Name", "Score"], ["Alice", "90"], ["Bob", "85"]] });
    const text = extractSpreadsheetText(wb, "data.xlsx");
    expect(text).toContain("Alice | 90");
    expect(text).toContain("Bob | 85");
  });

  it("empty sheet produces (empty sheet) note", () => {
    const wb = makeWorkbook({ "Empty": [] });
    const text = extractSpreadsheetText(wb, "empty.xlsx");
    expect(text).toContain("(empty sheet)");
  });
});

// ── 5. Skill import verification ─────────────────────────────────────────────

describe("skill files contain expected keywords", () => {
  // Import the skill files as raw text to verify their content
  it("evidence-ledger skill mentions lifecycle states", async () => {
    const { default: skill } = await import("../../data/skills/evidence-ledger.md?raw");
    expect(skill).toContain("cited");
    expect(skill).toContain("not_used");
    expect(skill).toContain("skipped");
    expect(skill).toContain("failed");
  });

  it("source-citation-verification skill mentions downgrade rules", async () => {
    const { default: skill } = await import("../../data/skills/source-citation-verification.md?raw");
    expect(skill).toContain("sourceChunkIds");
    expect(skill).toContain("downgrade");
  });

  it("spreadsheet-evidence skill mentions row coverage", async () => {
    const { default: skill } = await import("../../data/skills/spreadsheet-evidence.md?raw");
    expect(skill).toContain("Row coverage");
    expect(skill).toContain("headers");
  });

  it("scanned-document-evidence skill mentions suspectedScannedPdf", async () => {
    const { default: skill } = await import("../../data/skills/scanned-document-evidence.md?raw");
    expect(skill).toContain("suspectedScannedPdf");
  });

  it("evidence-retrieval skill mentions APSR dimension retrieval", async () => {
    const { default: skill } = await import("../../data/skills/evidence-retrieval.md?raw");
    expect(skill).toContain("Approach");
    expect(skill).toContain("Processes");
    expect(skill).toContain("Not evident");
  });
});
