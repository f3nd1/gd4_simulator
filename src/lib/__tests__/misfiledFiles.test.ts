import { describe, it, expect } from "vitest";
import { findMisfiledFiles, misfiledWarning } from "../driveGuard";

const f = (path: string, bucket: "policy" | "evidence") => ({ path, bucket });

describe("findMisfiledFiles", () => {
  it("flags a record filed under the policy folder", () => {
    const out = findMisfiledFiles([f("1. Policy & Procedure/Board minutes Q1.pdf", "policy")]);
    expect(out).toHaveLength(1);
    expect(out[0].looksLike).toBe("evidence");
  });

  it("flags a policy filed under the evidence folder", () => {
    const out = findMisfiledFiles([f("2. Actual Evidence/Refund Policy v3.docx", "evidence")]);
    expect(out).toHaveLength(1);
    expect(out[0].looksLike).toBe("policy");
  });

  it("says nothing about correctly filed files", () => {
    expect(findMisfiledFiles([
      f("1. Policy & Procedure/Assessment Policy.docx", "policy"),
      f("2. Actual Evidence/Attendance register 2026.xlsx", "evidence"),
    ])).toEqual([]);
  });

  it("stays silent when a name matches BOTH lists — a false alarm is worse than a miss", () => {
    expect(findMisfiledFiles([f("1. Policy & Procedure/Policy review minutes.docx", "policy")])).toEqual([]);
    expect(findMisfiledFiles([f("2. Actual Evidence/Procedure sign-off register.xlsx", "evidence")])).toEqual([]);
  });

  it("stays silent when a name matches neither list", () => {
    expect(findMisfiledFiles([f("1. Policy & Procedure/Untitled document.docx", "policy")])).toEqual([]);
  });

  it("matches whole words only, so 'Policyholder' is not a policy", () => {
    expect(findMisfiledFiles([f("2. Actual Evidence/Policyholder letter.pdf", "evidence")])).toEqual([]);
  });
});

describe("misfiledWarning", () => {
  it("says nothing when nothing is misfiled", () => {
    expect(misfiledWarning([])).toBeUndefined();
  });

  it("names the files and states that nothing was moved", () => {
    const w = misfiledWarning(findMisfiledFiles([f("1. Policy & Procedure/Attendance register.xlsx", "policy")])) as string;
    expect(w).toContain("Attendance register.xlsx");
    expect(w).toContain("sits under a policy-named folder");
    expect(w).toContain("never counts as evidence");
    expect(w).toContain("nothing has been re-filed automatically");
  });
});
