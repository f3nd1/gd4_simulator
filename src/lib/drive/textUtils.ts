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

// ── Embedded-image extraction (PPTX / DOCX / XLSX) ───────────────────────────
// Office files can carry raster images (screenshots of emails, scans, photos of
// signed forms) that hold their real content inside the picture, not in the
// document's text runs. The text extractors above see none of that. These
// helpers pull the embedded pictures out of the OpenXML zip so the caller can
// send them through the SAME vision path used for standalone images and scanned
// PDFs, then merge the transcription back with the typed text. Pure (JSZip only,
// no browser APIs / no AI) so they stay Node/Vitest-testable — the AI call is
// injected by the caller.

// Raster formats the vision model can read. Vector/other formats (emf, wmf, svg)
// are surfaced as unsupported rather than silently dropped, so a document with
// an un-transcribable image never looks like a genuinely short extraction.
const VISION_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

export type EmbeddedImageRef = {
  location: string; // human label for ordering, e.g. "Slide 3" or "Embedded image 2"
  dataUrl: string | null; // data: URL when a supported raster image, else null
  ext: string;
  supported: boolean; // false for vector/unknown formats vision cannot read
};

function mediaExt(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

// Numeric order of a media part like "ppt/media/image12.png" → 12, so images
// come out in author order rather than lexical ("image10" before "image2").
function mediaOrder(name: string): number {
  const m = name.match(/(\d+)\.[a-z0-9]+$/i);
  return m ? parseInt(m[1], 10) : 0;
}

async function zipImageToRef(zip: JSZip, mediaPath: string, location: string): Promise<EmbeddedImageRef> {
  const ext = mediaExt(mediaPath);
  const mime = VISION_IMAGE_MIME[ext];
  if (!mime) return { location, dataUrl: null, ext, supported: false };
  const base64 = await zip.files[mediaPath].async("base64");
  return { location, dataUrl: `data:${mime};base64,${base64}`, ext, supported: true };
}

// Resolve an OpenXML relationship Target (relative to the part's own folder,
// e.g. "../media/image1.png" from "ppt/slides/slide1.xml") to a full zip path.
function resolveZipPath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const baseDir = basePart.slice(0, basePart.lastIndexOf("/"));
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function listMedia(zip: JSZip, prefix: string): string[] {
  return Object.keys(zip.files)
    .filter((n) => n.startsWith(prefix) && !zip.files[n].dir)
    .sort((a, b) => mediaOrder(a) - mediaOrder(b));
}

// PPTX: associate each embedded image with its slide via the slide's rels part
// so the label reads "Slide N". Images referenced by multiple slides are
// transcribed once (deduped by media path). Falls back to a flat enumeration of
// ppt/media when no slide relationship resolves.
export async function extractPptxEmbeddedImages(buffer: ArrayBuffer): Promise<EmbeddedImageRef[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => partNumber(a) - partNumber(b));

  const refs: EmbeddedImageRef[] = [];
  const seenMedia = new Set<string>();
  for (const slideName of slideNames) {
    const num = partNumber(slideName);
    const relsName = slideName.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const relsFile = zip.files[relsName];
    if (!relsFile) continue;
    const relsXml = await relsFile.async("string");
    const relRe = /<Relationship\b([^>]*?)\/?>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relsXml)) !== null) {
      const attrs = rm[1];
      const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
      const type = (attrs.match(/\bType="([^"]+)"/) || [])[1] || "";
      if (!target) continue;
      if (!/image/i.test(type) && !/\/media\//i.test(target)) continue;
      const resolved = resolveZipPath(slideName, target);
      if (!zip.files[resolved] || seenMedia.has(resolved)) continue;
      seenMedia.add(resolved);
      refs.push(await zipImageToRef(zip, resolved, `Slide ${num}`));
    }
  }

  if (refs.length === 0) {
    const media = listMedia(zip, "ppt/media/");
    for (let i = 0; i < media.length; i++) refs.push(await zipImageToRef(zip, media[i], `Embedded image ${i + 1}`));
  }
  return refs;
}

// DOCX: Word does not give images a reliable page/section, so they are labelled
// by order of appearance in word/media.
export async function extractDocxEmbeddedImages(buffer: ArrayBuffer): Promise<EmbeddedImageRef[]> {
  const zip = await JSZip.loadAsync(buffer);
  const media = listMedia(zip, "word/media/");
  const refs: EmbeddedImageRef[] = [];
  for (let i = 0; i < media.length; i++) refs.push(await zipImageToRef(zip, media[i], `Embedded image ${i + 1}`));
  return refs;
}

// XLSX: images live in xl/media and are labelled by order of appearance.
export async function extractXlsxEmbeddedImages(buffer: ArrayBuffer): Promise<EmbeddedImageRef[]> {
  const zip = await JSZip.loadAsync(buffer);
  const media = listMedia(zip, "xl/media/");
  const refs: EmbeddedImageRef[] = [];
  for (let i = 0; i < media.length; i++) refs.push(await zipImageToRef(zip, media[i], `Embedded image ${i + 1}`));
  return refs;
}

// Order files smallest-first for the vision-image budget. Large multi-page
// scanned PDFs early in the Drive listing would otherwise burn the whole
// per-run vision budget before smaller/more-relevant files are read, producing
// false "no evidence found" gaps. `size` is a byte string from Drive; native
// Google Docs have no size → treated as 0 (sort first, harmless — they read as
// typed text and never touch the vision budget). Stable: equal sizes keep
// listing order. Pure copy, no mutation of the input array.
export function orderBySizeForVisionBudget<T extends { size?: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => (Number(a.size ?? 0) || 0) - (Number(b.size ?? 0) || 0));
}
