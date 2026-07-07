// Extracts plain text from a locally-uploaded File — completely independent
// of Google Drive/OAuth (no network call, no access token needed). Built for
// the Benchmark tab's "upload an audit report" panel, but the dispatcher and
// parsing are generic. Reuses the exact same parsing logic Drive-sourced
// files already go through in driveClient.ts/textUtils.ts:
//   - .pdf lazily imports driveClient.ts's extractPdfText (pdfjs-based) at
//     CALL time, not module load time — driveClient.ts instantiates a pdfjs
//     Worker as a side effect of merely being imported (see its own comment
//     and CLAUDE.md), which crashes under Node/Vitest. A dynamic import()
//     keeps that side effect out of this module's static import graph, so
//     every OTHER branch here stays fully testable in Node — see
//     uploadedDocText.test.ts, which covers everything except .pdf.
//   - .docx uses mammoth directly (no embedded-image transcription — this
//     feature only needs body text, not scanned exhibits).
//   - .xlsx/.xls reuses textUtils.ts's Drive-independent extractSpreadsheetText.
//   - .txt is a plain TextDecoder read.
// Mime-type constants are duplicated (not imported) from driveClient.ts for
// the same reason — even importing a plain string constant from that module
// would pull in its pdfjs Worker side effect statically.

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractSpreadsheetText } from "./drive/textUtils";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

export type UploadedDocKind = "pdf" | "docx" | "xlsx" | "txt" | "unsupported";

export function classifyUploadedFile(file: File): UploadedDocKind {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (file.type === XLSX_MIME || file.type === XLS_MIME || name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "txt";
  return "unsupported";
}

// Never returns silently-empty text for an unsupported file — throws with a
// clear message instead, matching the app's "never silently do nothing"
// convention for anything AI-adjacent.
export async function extractTextFromFile(file: File): Promise<string> {
  const kind = classifyUploadedFile(file);
  switch (kind) {
    case "pdf": {
      const { extractPdfText } = await import("./drive/driveClient");
      return extractPdfText(await file.arrayBuffer());
    }
    case "docx": {
      const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return value;
    }
    case "xlsx": {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      return extractSpreadsheetText(wb, file.name);
    }
    case "txt":
      return new TextDecoder().decode(await file.arrayBuffer());
    case "unsupported":
      throw new Error(`Unsupported file type "${file.type || file.name}" — upload a PDF, DOCX, XLSX/XLS, or TXT file.`);
  }
}
