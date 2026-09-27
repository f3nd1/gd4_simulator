import { describe, it, expect } from "vitest";
import { partialReadLabel, partiallyReadFiles, partialReadWarning, partialFilesForLine, linePartialReadNote } from "../partialRead";
import type { AuditFileRecord } from "../../types";

const f = (name: string, partialRead?: AuditFileRecord["partialRead"]): AuditFileRecord =>
  ({ path: name, name, mimeType: "x", fileKind: "Excel", bucket: "evidence", readStatus: "read", auditStatus: "pending", ...(partialRead ? { partialRead } : {}) });

describe("partial-read disclosure", () => {
  it("phrases rows and pages the same way, with thousands separators", () => {
    expect(partialReadLabel({ kind: "rows", read: 200, total: 5000 })).toBe("200 of 5,000 rows read");
    expect(partialReadLabel({ kind: "pages", read: 5, total: 40 })).toBe("5 of 40 pages read");
  });

  it("finds only the files genuinely cut short", () => {
    const ledger = [f("whole.xlsx"), f("cut.xlsx", { kind: "rows", read: 200, total: 5000 }), f("exact.xlsx", { kind: "rows", read: 12, total: 12 })];
    expect(partiallyReadFiles(ledger).map((x) => x.name)).toEqual(["cut.xlsx"]);
  });

  it("says nothing at all when no file was capped", () => {
    expect(partialReadWarning([f("whole.xlsx")])).toBeUndefined();
    expect(partialReadWarning(undefined)).toBeUndefined();
    expect(partialReadWarning([])).toBeUndefined();
  });

  it("names the files and what was missed", () => {
    const w = partialReadWarning([f("Attendance.xlsx", { kind: "rows", read: 200, total: 5000 }), f("Minutes.pdf", { kind: "pages", read: 5, total: 40 })]);
    expect(w).toContain("2 file(s) were read only in part");
    expect(w).toContain("Attendance.xlsx (200 of 5,000 rows read)");
    expect(w).toContain("Minutes.pdf (5 of 40 pages read)");
    expect(w).toContain("judged on a fraction of the record");
  });

  it("caps the list at five and says there are more", () => {
    const many = Array.from({ length: 7 }, (_, i) => f(`f${i}.xlsx`, { kind: "rows", read: 200, total: 900 }));
    const w = partialReadWarning(many) as string;
    expect(w).toContain("7 file(s)");
    expect(w).toContain("…");
    expect(w).not.toContain("f6.xlsx");
  });
});

const withChunks = (name: string, chunkIds: string[], partialRead?: AuditFileRecord["partialRead"]): AuditFileRecord =>
  ({ path: name, name, mimeType: "x", fileKind: "Excel", bucket: "evidence", readStatus: "read", auditStatus: "cited", chunkIds, ...(partialRead ? { partialRead } : {}) });

describe("per-line disclosure", () => {
  const ledger = [
    withChunks("Attendance.xlsx", ["C001", "C002"], { kind: "rows", read: 200, total: 5000 }),
    withChunks("Policy.docx", ["C003"]),
    withChunks("Other capped.xlsx", ["C009"], { kind: "rows", read: 200, total: 900 }),
  ];

  it("finds the capped file a line actually cited", () => {
    expect(partialFilesForLine(["C002"], ledger).map((f) => f.name)).toEqual(["Attendance.xlsx"]);
  });

  it("ignores a capped file the line did not cite", () => {
    expect(partialFilesForLine(["C003"], ledger)).toEqual([]);
  });

  it("matches on chunk id, not name — two Drive files can share a name", () => {
    const twins = [
      withChunks("Register.xlsx", ["C001"], { kind: "rows", read: 200, total: 5000 }),
      withChunks("Register.xlsx", ["C002"]),
    ];
    expect(partialFilesForLine(["C002"], twins)).toEqual([]);
    expect(partialFilesForLine(["C001"], twins)).toHaveLength(1);
  });

  it("returns nothing for a line citing no chunks", () => {
    expect(partialFilesForLine([], ledger)).toEqual([]);
    expect(partialFilesForLine(undefined, ledger)).toEqual([]);
  });

  it("writes a note that distinguishes an unread part from a missing record", () => {
    const note = linePartialReadNote(partialFilesForLine(["C001"], ledger)) as string;
    expect(note).toContain("Attendance.xlsx (200 of 5,000 rows read)");
    expect(note).toContain("unread part of the record rather than a missing record");
    expect(linePartialReadNote([])).toBeUndefined();
  });
});

// The Self-check file table is where a process owner looks. A capped file used
// to appear there as "✓ Read · 21,000 characters of text · quoted: yes", with
// nothing to do — a clean pass on a fortieth of the document.
describe("the Self-check file row", () => {
  it("reports a capped spreadsheet as Read in part, with the counts and an action", async () => {
    const { toFileRow } = await import("../selfCheckEvidence");
    const row = toFileRow({ ...f("Attendance register.xlsx", { kind: "rows", read: 200, total: 5000 }), charCount: 21_000 });
    expect(row.label).toBe("Read in part");
    expect(row.outcome).toBe("check");
    expect(row.detail).toContain("200 of 5,000 rows read");
    expect(row.action).toContain("raise the row limit");
  });

  it("reports a capped scan by pages, and says so ahead of the vision flag", async () => {
    const { toFileRow } = await import("../selfCheckEvidence");
    const row = toFileRow({ ...f("Scanned minutes.pdf", { kind: "pages", read: 5, total: 40 }), readMethod: "vision", suspectedScannedPdf: true, charCount: 9_000 });
    expect(row.label).toBe("Read in part");
    expect(row.detail).toContain("5 of 40 pages read");
    // The vision route is still disclosed, just not instead of the cap.
    expect(row.detail).toContain("transcribed from page images");
  });

  it("leaves a whole file exactly as it was", async () => {
    const { toFileRow } = await import("../selfCheckEvidence");
    const row = toFileRow({ ...f("Board paper.docx"), charCount: 4_000 });
    expect(row.label).toBe("Read");
    expect(row.outcome).toBe("read");
    expect(row.action).toBe("");
  });

  it("counts partly-read files separately from other things worth checking", async () => {
    const { toFileRows, countFileRows } = await import("../selfCheckEvidence");
    const counts = countFileRows(toFileRows(undefined, [
      { ...f("a.xlsx", { kind: "rows", read: 200, total: 5000 }), driveFileId: "A" },
      { ...f("b.pdf"), driveFileId: "B", readMethod: "vision" },
      { ...f("c.docx"), driveFileId: "C" },
    ]));
    expect(counts.partial).toBe(1);
    expect(counts.check).toBe(2);
    expect(counts.read).toBe(1);
  });
});
