// Covers every branch of uploadedDocText.ts EXCEPT .pdf: the .pdf branch
// lazily imports driveClient.ts (pdfjs Worker side effect on module load,
// unavailable in Node/Vitest — see the comment in uploadedDocText.ts and
// CLAUDE.md). Verify that path manually in a real browser only.
import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));

import mammoth from "mammoth";
import { classifyUploadedFile, extractTextFromFile } from "../uploadedDocText";

function makeFile(name: string, type: string, content: string | ArrayBuffer): File {
  return new File([content], name, { type });
}

describe("classifyUploadedFile", () => {
  it("classifies by mime type", () => {
    expect(classifyUploadedFile(makeFile("a", "application/pdf", ""))).toBe("pdf");
    expect(classifyUploadedFile(makeFile("a", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ""))).toBe("docx");
    expect(classifyUploadedFile(makeFile("a", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ""))).toBe("xlsx");
    expect(classifyUploadedFile(makeFile("a", "application/vnd.ms-excel", ""))).toBe("xlsx");
    expect(classifyUploadedFile(makeFile("a", "text/plain", ""))).toBe("txt");
  });

  it("falls back to file extension when mime type is empty/generic", () => {
    expect(classifyUploadedFile(makeFile("report.pdf", "", ""))).toBe("pdf");
    expect(classifyUploadedFile(makeFile("report.docx", "", ""))).toBe("docx");
    expect(classifyUploadedFile(makeFile("report.xlsx", "", ""))).toBe("xlsx");
    expect(classifyUploadedFile(makeFile("report.xls", "", ""))).toBe("xlsx");
    expect(classifyUploadedFile(makeFile("report.txt", "", ""))).toBe("txt");
  });

  it("classifies an unrecognised type/extension as unsupported", () => {
    expect(classifyUploadedFile(makeFile("report.exe", "application/octet-stream", ""))).toBe("unsupported");
  });
});

describe("extractTextFromFile — .txt", () => {
  it("decodes plain text content", async () => {
    const text = await extractTextFromFile(makeFile("notes.txt", "text/plain", "Hello, world."));
    expect(text).toBe("Hello, world.");
  });
});

describe("extractTextFromFile — .xlsx", () => {
  it("extracts spreadsheet text via the shared extractSpreadsheetText path", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["Name", "Score"], ["Alice", "90"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = makeFile("data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer);
    const text = await extractTextFromFile(file);
    expect(text).toContain("Sheet: Sheet1");
    expect(text).toContain("Alice | 90");
  });
});

describe("extractTextFromFile — .docx", () => {
  it("delegates to mammoth.extractRawText", async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: "Extracted docx body.", messages: [] });
    const file = makeFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "irrelevant bytes");
    const text = await extractTextFromFile(file);
    expect(text).toBe("Extracted docx body.");
  });
});

describe("extractTextFromFile — unsupported", () => {
  it("throws a clear error rather than returning silently-empty text", async () => {
    const file = makeFile("virus.exe", "application/octet-stream", "");
    await expect(extractTextFromFile(file)).rejects.toThrow(/Unsupported file type/);
  });
});
