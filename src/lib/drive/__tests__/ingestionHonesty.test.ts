import { describe, it, expect } from "vitest";
import {
  needsVisionFallback,
  classifyPdfTextQuality,
  listingTruncationMarker,
  isListingTruncationMarker,
  resolveDriveEntry,
  FOLDER_MIME,
} from "../textUtils";

// Imported from textUtils, never driveClient: that module builds a pdfjs
// Worker at load time and cannot be imported by a test.

describe("issue 12 — a suspected scanned PDF gets vision, not just an empty one", () => {
  it("detection and action agree across the whole range", () => {
    for (const chars of [0, 49, 50, 120, 199, 200, 499, 500, 900]) {
      const q = classifyPdfTextQuality("x".repeat(chars));
      expect(needsVisionFallback(q.extractedTextQuality), `${chars} chars`).toBe(q.suspectedScannedPdf);
    }
  });

  it("covers the 50-199 char window that used to be read as text", () => {
    // A scan whose typed layer leaks only a header or a stamp.
    expect(needsVisionFallback(classifyPdfTextQuality("UNITED CERES COLLEGE  Page 1 of 8  Annex B  CONFIDENTIAL").extractedTextQuality)).toBe(true);
  });

  it("leaves a genuine text PDF on the fast path", () => {
    expect(needsVisionFallback(classifyPdfTextQuality("x".repeat(800)).extractedTextQuality)).toBe(false);
  });
});

describe("issue 11 — a cut-short listing says so", () => {
  it("produces a marker that names the folder and the reason", () => {
    const m = listingTruncationMarker("Evidence/2024", "more than 2000 items at this level were not listed");
    expect(m.name).toContain("Folder listing incomplete");
    expect(m.name).toContain("2000 items");
    expect(isListingTruncationMarker(m.mimeType)).toBe(true);
  });

  it("an ordinary file is not mistaken for a marker", () => {
    expect(isListingTruncationMarker("application/pdf")).toBe(false);
    expect(isListingTruncationMarker(undefined)).toBe(false);
  });
});

describe("issue 11 — Drive shortcuts are followed", () => {
  it("a shortcut to a folder resolves to that folder", () => {
    const r = resolveDriveEntry({ id: "sc1", mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: "REAL", targetMimeType: FOLDER_MIME } });
    expect(r).toEqual({ kind: "folder", id: "REAL", mimeType: FOLDER_MIME });
  });

  it("a shortcut to a file resolves to the real file, not the unreadable stub", () => {
    const r = resolveDriveEntry({ id: "sc2", mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: "DOC", targetMimeType: "application/pdf" } });
    expect(r).toEqual({ kind: "file", id: "DOC", mimeType: "application/pdf" });
  });

  it("a plain folder and a plain file are unaffected", () => {
    expect(resolveDriveEntry({ id: "f", mimeType: FOLDER_MIME }).kind).toBe("folder");
    expect(resolveDriveEntry({ id: "d", mimeType: "application/pdf" })).toEqual({ kind: "file", id: "d", mimeType: "application/pdf" });
  });
});
