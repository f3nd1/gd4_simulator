// Pure utility functions for text processing — no browser APIs, no workers.
// Split out from driveClient.ts so they can be imported in Node/Vitest tests
// without triggering the pdfjs Worker instantiation at module load time.

import * as XLSX from "xlsx";

// Classifies extracted PDF text quality to detect scanned PDFs that have
// little or no machine-readable text. Called by useWorkspaceStore after
// reading each PDF so the file record can carry quality metadata.
// This is a pure utility — it does not re-read the PDF, only analyses
// the text already extracted.
export function classifyPdfTextQuality(text: string): {
  suspectedScannedPdf: boolean;
  extractedTextQuality: "none" | "low" | "medium" | "high";
} {
  const charCount = text.trim().length;
  let extractedTextQuality: "none" | "low" | "medium" | "high";
  if (charCount < 50) {
    extractedTextQuality = "none";
  } else if (charCount < 200) {
    extractedTextQuality = "low";
  } else if (charCount < 500) {
    extractedTextQuality = "medium";
  } else {
    extractedTextQuality = "high";
  }
  const suspectedScannedPdf = extractedTextQuality === "none" || extractedTextQuality === "low";
  return { suspectedScannedPdf, extractedTextQuality };
}

// Extracts structured text from an Excel workbook, preserving sheet names,
// column headers, and row data. Caps at 200 rows per sheet so very large
// spreadsheets don't dominate the audit context budget.
// Keeps the file name and sheet structure so the AI can distinguish between
// sheets and identify the data source precisely.
export function extractSpreadsheetText(workbook: XLSX.WorkBook, fileName: string): string {
  const MAX_ROWS_PER_SHEET = 200;
  const sheetTexts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];

    if (rows.length === 0) {
      sheetTexts.push(`File: ${fileName}\nSheet: ${sheetName}\n(empty sheet)`);
      continue;
    }

    // First row as headers
    const headers = rows[0].map((h) => String(h ?? "").trim());
    const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));

    const cappedRows = dataRows.slice(0, MAX_ROWS_PER_SHEET);
    const omitted = dataRows.length - cappedRows.length;

    const rowLines = cappedRows.map((row, i) => {
      const cells = headers.map((_, ci) => String(row[ci] ?? "").trim());
      return `${i + 1}. ${cells.join(" | ")}`;
    });

    let sheetText = `File: ${fileName}\nSheet: ${sheetName}\nHeaders: ${headers.join(" | ")}\nRows:\n${rowLines.join("\n")}`;
    if (omitted > 0) {
      sheetText += `\n(+${omitted} more rows omitted)`;
    }
    sheetTexts.push(sheetText);
  }

  return sheetTexts.join("\n\n---\n\n");
}
