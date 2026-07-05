// Pure utility functions for text processing — no browser APIs, no workers.
// Split out from driveClient.ts so they can be imported in Node/Vitest tests
// without triggering the pdfjs Worker instantiation at module load time.

import * as XLSX from "xlsx";
import JSZip from "jszip";

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

// ── PowerPoint (.pptx) text extraction ──────────────────────────────────────
// A .pptx is a ZIP of OpenXML parts. The readable text on every slide —
// titles, body placeholders, text boxes and table cells — lives in DrawingML
// text runs (<a:t>…</a:t>) inside ppt/slides/slideN.xml; speaker notes live in
// ppt/notesSlides/notesSlideN.xml. We pull those runs (no browser DOMParser, so
// this stays Node/Vitest-testable) rather than the whole XML, and preserve
// slide order. Returns "" when the deck has no extractable text (e.g. slides
// that are just images of text) so the caller can honestly flag it unreadable
// instead of passing blank evidence.

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Pull the concatenated text of every <a:t> run in one slide/notes XML part,
// in document order. This captures titles, body text, text-box text and table
// cell text (tables are DrawingML too), which is all we need for auditing.
function slideRunsToText(xml: string): string {
  const runs: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXmlEntities(m[1]).trim();
    if (t) runs.push(t);
  }
  return runs.join(" ").replace(/[ \t]+/g, " ").trim();
}

// Numeric suffix of a part name like "ppt/slides/slide12.xml" → 12, so slides
// and notes are ordered as the author sees them rather than lexically.
function partNumber(name: string): number {
  const m = name.match(/(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}

export async function extractPptxText(buffer: ArrayBuffer, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const noteNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const notesByNum = new Map<number, string>();
  for (const n of noteNames) notesByNum.set(partNumber(n), n);

  const blocks: string[] = [];
  for (const slideName of slideNames) {
    const num = partNumber(slideName);
    const slideXml = await zip.files[slideName].async("string");
    const slideText = slideRunsToText(slideXml);

    let notesText = "";
    const noteName = notesByNum.get(num);
    if (noteName) notesText = slideRunsToText(await zip.files[noteName].async("string"));

    if (!slideText && !notesText) continue; // image-only / empty slide — omit
    let block = `--- Slide ${num} ---`;
    if (slideText) block += `\n${slideText}`;
    if (notesText) block += `\n[Speaker notes] ${notesText}`;
    blocks.push(block);
  }

  if (blocks.length === 0) return ""; // no extractable text anywhere in the deck
  return `File: ${fileName}\n\n${blocks.join("\n\n")}`;
}
