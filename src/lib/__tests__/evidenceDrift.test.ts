import { describe, it, expect } from "vitest";
import { diffEvidenceFiles } from "../evidenceDrift";
import type { AuditFileRecord } from "../../types";

function ledgerRec(name: string, driveFileId: string, driveModifiedTime: string): AuditFileRecord {
  return {
    path: `2. Actual Evidence/${name}`, name, mimeType: "application/pdf", fileKind: "PDF",
    bucket: "evidence", readStatus: "read", auditStatus: "cited", driveFileId, driveModifiedTime,
  };
}

describe("diffEvidenceFiles — evidence-changed-since-last-run detection", () => {
  it("unchanged: same files, same modifiedTime", () => {
    const ledger = [ledgerRec("A.pdf", "f1", "t1"), ledgerRec("B.pdf", "f2", "t2")];
    const current = [{ id: "f1", name: "A.pdf", modifiedTime: "t1" }, { id: "f2", name: "B.pdf", modifiedTime: "t2" }];
    const r = diffEvidenceFiles(current, ledger);
    expect(r.status).toBe("unchanged");
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.modified).toEqual([]);
  });

  it("changed: a new file added since the ledger was built", () => {
    const ledger = [ledgerRec("A.pdf", "f1", "t1")];
    const current = [{ id: "f1", name: "A.pdf", modifiedTime: "t1" }, { id: "f2", name: "New_Receipt.pdf", modifiedTime: "t2" }];
    const r = diffEvidenceFiles(current, ledger);
    expect(r.status).toBe("changed");
    expect(r.added).toEqual(["New_Receipt.pdf"]);
    expect(r.removed).toEqual([]);
    expect(r.modified).toEqual([]);
  });

  it("changed: a ledger file has since been removed from the folder", () => {
    const ledger = [ledgerRec("A.pdf", "f1", "t1"), ledgerRec("B.pdf", "f2", "t2")];
    const current = [{ id: "f1", name: "A.pdf", modifiedTime: "t1" }];
    const r = diffEvidenceFiles(current, ledger);
    expect(r.status).toBe("changed");
    expect(r.removed).toEqual(["B.pdf"]);
  });

  it("changed: a file's modifiedTime differs (edited since the run)", () => {
    const ledger = [ledgerRec("A.pdf", "f1", "t1")];
    const current = [{ id: "f1", name: "A.pdf", modifiedTime: "t1-edited" }];
    const r = diffEvidenceFiles(current, ledger);
    expect(r.status).toBe("changed");
    expect(r.modified).toEqual(["A.pdf"]);
  });

  it("matches by Drive file id, not by name — a rename alone is not flagged as added/removed", () => {
    const ledger = [ledgerRec("Old_Name.pdf", "f1", "t1")];
    const current = [{ id: "f1", name: "New_Name.pdf", modifiedTime: "t1" }];
    const r = diffEvidenceFiles(current, ledger);
    expect(r.status).toBe("unchanged");
  });
});
