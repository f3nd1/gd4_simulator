import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findFolderMixups, folderMixupWarning } from "../driveGuard";
import type { AuditFileRecord } from "../../types";

const f = (over: Partial<AuditFileRecord>): AuditFileRecord => ({
  path: "x", name: "x", mimeType: "application/pdf", fileKind: "PDF",
  bucket: "evidence", readStatus: "read", auditStatus: "audited", ...over,
});

// THE TRAP. De-duplicating across buckets would silently switch this warning
// off, because it is built from the same document appearing in BOTH ledgers.
// That is the opposite of what it exists to do, so it gets its own test.
describe("the both-folders warning survives de-duplication", () => {
  const sameFile = { name: "PPD-SGL-SQ-5.5.1_Student Assessment.pdf", driveFileId: "D-SAME" };

  it("still fires when one folder link is pasted into both boxes", () => {
    // Both passes read the same folder, so the same document lands in each
    // ledger. De-duplication is per bucket, so both entries survive.
    const policy = [f({ ...sameFile, bucket: "policy", path: "1. Policy/PPD.pdf" })];
    const evidence = [f({ ...sameFile, bucket: "evidence", path: "1. Policy/PPD.pdf" })];
    const mixups = findFolderMixups(policy, evidence);
    expect(mixups.some((m) => m.kind === "same-file-both")).toBe(true);
    expect(folderMixupWarning(mixups)).toBeTruthy();
  });

  it("still fires for a procedure-looking file sitting in the evidence folder", () => {
    const mixups = findFolderMixups([], [f({ name: "PPD-SGL-SQ-6.1.1.pdf", path: "2. Evidence/PPD-SGL-SQ-6.1.1.pdf" })]);
    expect(mixups.some((m) => m.kind === "procedure-in-evidence")).toBe(true);
  });

  it("is not defeated by the duplicate marker the de-duplication adds", () => {
    // A within-bucket duplicate carries duplicateOf and shares its twin's
    // chunk ids. That must not make the cross-bucket check overlook it.
    const policy = [f({ ...sameFile, bucket: "policy", path: "1. Policy/PPD.pdf", chunkIds: ["P001"] })];
    const evidence = [
      f({ ...sameFile, bucket: "evidence", path: "2. Evidence/PPD.pdf", chunkIds: ["C001"] }),
      f({ ...sameFile, bucket: "evidence", path: "2. Evidence/copy/PPD.pdf", chunkIds: ["C001"], duplicateOf: "2. Evidence/PPD.pdf" }),
    ];
    expect(findFolderMixups(policy, evidence).some((m) => m.kind === "same-file-both")).toBe(true);
  });
});

describe("de-duplication is bucket-scoped in the source, not just in intent", () => {
  const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");

  it("keeps two separate maps, one per pass", () => {
    expect(STORE).toContain("const seenPolicyContent = new Map<string, { fi: number; chunkIds: string[] }>();");
    expect(STORE).toContain("const seenContent = new Map<string, { fi: number; chunkIds: string[] }>();");
  });

  it("never lets the policy pass read the evidence pass's map, or the reverse", () => {
    const ppd = STORE.slice(STORE.indexOf("runPPDReview: async"), STORE.indexOf("runEvidenceAssessment: async"));
    const ev = STORE.slice(STORE.indexOf("runEvidenceAssessment: async"), STORE.indexOf("runOutcomeReviewPass: async"));
    expect(ppd).not.toContain("seenContent");
    expect(ev).not.toContain("seenPolicyContent");
  });

  it("matches on content, never on name", () => {
    expect(STORE).toContain("const ckey = contentKey(body);");
    expect(STORE).not.toMatch(/seen(Policy)?Content\.get\((file)?[Nn]ame\)/);
  });

  it("keeps every folder the document was found in", () => {
    // One read, all paths shown: nothing may disappear from the audit trail.
    expect(STORE).toMatch(/alsoAt: \[\.\.\.\(fileRecords\[already\.fi\]\.alsoAt \?\? \[\]\), file\.path\]/);
    expect([...STORE.matchAll(/duplicateOf: fileRecords\[already\.fi\]\.path/g)]).toHaveLength(2);
  });

  it("gives a duplicate the SAME chunk ids, so a citation covers both copies", () => {
    // Otherwise the never-quoted list would accuse a file whose text was in
    // fact quoted, under its twin's chunk ids.
    expect([...STORE.matchAll(/chunkIds: already\.chunkIds/g)]).toHaveLength(2);
  });
});
