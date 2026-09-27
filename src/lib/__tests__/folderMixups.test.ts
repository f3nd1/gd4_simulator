import { describe, it, expect } from "vitest";
import { findFolderMixups, folderMixupWarning, findMisfiledFiles } from "../driveGuard";
import { classifyRunWarning } from "../selfCheck";

const f = (name: string, driveFileId?: string) => ({ name, driveFileId, path: `folder/${name}` });

describe("findFolderMixups", () => {
  it("flags the same document read by both passes", () => {
    const out = findFolderMixups([f("Assessment Policy.docx", "A")], [f("Assessment Policy.docx", "A")]);
    expect(out).toEqual([{ kind: "same-file-both", name: "Assessment Policy.docx" }]);
  });

  // The file that started this. It matched no keyword until PPD was added:
  // this school's own prefix for a Policy & Procedure Document.
  it("flags a PPD document sitting in the records folder", () => {
    const out = findFolderMixups([], [f("PPD-SGL-SQ-6.1.1_Internal Assessment and Quality_1.2_clean.pdf", "B")]);
    expect(out).toEqual([{ kind: "procedure-in-evidence", name: "PPD-SGL-SQ-6.1.1_Internal Assessment and Quality_1.2_clean.pdf" }]);
  });

  it("flags an obvious procedure in the records folder", () => {
    expect(findFolderMixups([], [f("Refund Procedure v2.docx")])[0].kind).toBe("procedure-in-evidence");
  });

  it("says nothing about genuine records", () => {
    expect(findFolderMixups([f("Policy.docx", "A")], [f("Attendance register 2026.xlsx", "B"), f("Board minutes Q1.pdf", "C")])).toEqual([]);
  });

  it("leaves a name matching both lists alone, as the misfiled rule does", () => {
    expect(findFolderMixups([], [f("Policy review minutes.docx")])).toEqual([]);
    expect(findMisfiledFiles([{ path: "1. Policy & Procedure/Policy review minutes.docx", bucket: "policy" }])).toEqual([]);
  });

  it("reports one file once when it appears twice in the evidence ledger", () => {
    expect(findFolderMixups([], [f("Refund Procedure.docx", "D"), f("Refund Procedure.docx", "D")])).toHaveLength(1);
  });

  it("prefers the same-file finding over the name one, so a file is reported once", () => {
    const out = findFolderMixups([f("Refund Procedure.docx", "E")], [f("Refund Procedure.docx", "E")]);
    expect(out).toEqual([{ kind: "same-file-both", name: "Refund Procedure.docx" }]);
  });
});

describe("folderMixupWarning", () => {
  it("says nothing when the folders are clean", () => {
    expect(folderMixupWarning([])).toBeUndefined();
  });

  it("names both problems and states that nothing was moved", () => {
    const w = folderMixupWarning(findFolderMixups([f("Policy.docx", "A")], [f("Policy.docx", "A"), f("Refund Procedure.docx", "B")])) as string;
    expect(w).toContain("read as BOTH");
    expect(w).toContain("read like a written procedure");
    expect(w).toContain("Nothing has been moved");
  });

  // It must land in the folder bucket on Self-check, not be reported as a
  // failed run.
  it("is classified as a folder problem, not an incomplete run", () => {
    const w = folderMixupWarning(findFolderMixups([], [f("Refund Procedure.docx")])) as string;
    expect(classifyRunWarning(w)).toBe("misfiled");
  });
});
