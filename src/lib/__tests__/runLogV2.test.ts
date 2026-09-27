import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { uncitedFiles, UNCITED_NOTE } from "../runTranscript";
import { chunkIdsForRange } from "../ai/agentRuntime";
import type { AuditFileRecord, EvidenceAssessmentResult, PPDReviewResult } from "../../types";

const f = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
  path: "2. Actual Evidence/Board Minutes.pdf", name: "Board Minutes.pdf", mimeType: "application/pdf",
  fileKind: "PDF", bucket: "evidence", readStatus: "read", auditStatus: "audited", charCount: 2000, ...over,
});

// TASK G. A window lying wholly inside one chunk's body contains no
// "[CHUNK:" header, so the marker scan reported an empty list against a
// 52,283-character prompt. Positions cannot lie that way.
describe("chunkIdsForRange", () => {
  const doc = `[CHUNK:C001] --- a ---\n${"a".repeat(30_000)}\n\n[CHUNK:C002] --- b ---\n${"b".repeat(30_000)}`;

  it("reports the chunk a header-less tail window sits inside", () => {
    // Everything after the second header: no marker in the slice at all.
    const tailStart = doc.indexOf("[CHUNK:C002]") + 200;
    expect(chunkIdsForRange(doc, tailStart, doc.length)).toEqual(["C002"]);
  });

  it("reports every chunk a window spans", () => {
    expect(chunkIdsForRange(doc, 0, doc.length)).toEqual(["C001", "C002"]);
  });

  it("never returns empty for a window inside a document that has chunks", () => {
    for (let start = 0; start < doc.length; start += 2_000) {
      expect(chunkIdsForRange(doc, start, Math.min(doc.length, start + 1_000)).length,
        `window at ${start}`).toBeGreaterThan(0);
    }
  });

  it("does not claim a chunk a window only touches the edge of", () => {
    const at = doc.indexOf("[CHUNK:C002]");
    expect(chunkIdsForRange(doc, 0, at)).toEqual(["C001"]);
  });

  it("is honest about a document with no chunk headers at all", () => {
    expect(chunkIdsForRange("plain text", 0, 10)).toEqual([]);
  });
});

// TASK G, second half. An empty answer and a failed call must not look alike.
describe("outcomes are three things, not two", () => {
  const SRC = readFileSync("src/lib/ai/agentRuntime.ts", "utf8");

  it("logs a contradiction hunt that found nothing as empty, not ok", () => {
    const hunt = SRC.slice(SRC.indexOf("const parsedArray = Array.isArray(parsed.contradictions)"));
    expect(hunt.slice(0, 500)).toMatch(/found\.length > 0 \? "ok" : "empty"/);
  });

  it("logs an unreadable reply as failed, not empty", () => {
    const hunt = SRC.slice(SRC.indexOf("const parsedArray = Array.isArray(parsed.contradictions)"));
    expect(hunt.slice(0, 500)).toMatch(/!parsedArray \? "failed"/);
    // The extract branch called an unparseable reply "empty" while its own
    // comment two lines above called it a failure.
    expect(SRC).toContain('log("failed", content, "The AI reply was empty or not valid JSON.");');
    expect(SRC).not.toContain('log("empty", content, "The AI reply was empty or not valid JSON.");');
  });
});

// TASK B. Every request to the model produces a row, and the image never does.
describe("OCR reads are logged, images are not", () => {
  const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");

  it("routes every Option A describeImage call through the logging wrapper", () => {
    // Scoped to readDriveFileWithVision, which is the self-check's reader. The
    // staged/full-audit paths keep their own inline copies of the three-tier
    // read and are not instrumented at all yet; that is stated in the report,
    // not quietly asserted away here.
    const fn = STORE.slice(STORE.indexOf("async function readDriveFileWithVision"), STORE.indexOf("function inferEvidenceType"));
    expect(fn).toMatch(/const describeAndLog = async/);
    expect(fn.replace(/const text = await describeImage\([^\n]*\n/, "")).not.toMatch(/await describeImage\(/);
  });

  it("never hands the image on, under any setting", () => {
    const w = STORE.slice(STORE.indexOf("const describeAndLog = async"), STORE.indexOf("const readScannedPdfViaVision"));
    expect(w).not.toMatch(/prompt:\s*dataUrl/);
    expect(STORE).toContain('prompt: "[image sent to the vision model; never recorded]"');
  });

  it("marks a vision call as image input rather than leaving promptChars 0 unexplained", () => {
    expect(STORE).toMatch(/input: "image", promptChars: 0/);
  });

  it("gives OCR calls and engine calls one shared sequence", () => {
    expect(STORE).toMatch(/let AI_SEQ = 0;/);
    expect(STORE).toMatch(/seqStart: AI_SEQ,/);
    expect(readFileSync("src/lib/ai/agentRuntime.ts", "utf8")).toMatch(/let aiSeq = opts\.seqStart \?\? 0;/);
  });
});

// TASK D.
describe("read but never quoted", () => {
  const ev = (over: Partial<EvidenceAssessmentResult> = {}): EvidenceAssessmentResult => ({
    subCriterionId: "5.5", rows: [], runAt: new Date().toISOString(), live: true, ...over,
  } as EvidenceAssessmentResult);

  it("surfaces a file whose chunks no verdict quoted", () => {
    const list = uncitedFiles({
      evidence: ev({
        fileLedger: [f({ name: "Quoted.pdf", chunkIds: ["C001"] }), f({ name: "Ignored.pdf", path: "e/Ignored.pdf", chunkIds: ["C006"] })],
        rows: [{ gdRef: "5.5.1.DS1", evidenceChunkIds: ["C001"] }] as never,
      }),
    });
    expect(list.map((x) => x.name)).toEqual(["Ignored.pdf"]);
    expect(list[0]).toMatchObject({ path: "e/Ignored.pdf", charCount: 2000, bucket: "evidence" });
  });

  it("counts a chunk quoted by a promise check as quoted", () => {
    const list = uncitedFiles({
      evidence: ev({
        fileLedger: [f({ chunkIds: ["C009"] })],
        rows: [{ gdRef: "x", evidenceChunkIds: [], promiseChecks: [{ chunkIds: ["C009"] }] }] as never,
      }),
    });
    expect(list).toHaveLength(0);
  });

  it("leaves skipped and failed files alone, they are already reported", () => {
    const list = uncitedFiles({
      evidence: ev({ fileLedger: [f({ readStatus: "skipped", chunkIds: [] }), f({ readStatus: "failed", chunkIds: [] })], rows: [] }),
    });
    expect(list).toHaveLength(0);
  });

  it("keeps the same file once per bucket, because the buckets are the point", () => {
    const list = uncitedFiles({
      ppd: { subCriterionId: "5.5", rows: [], runAt: "", live: true, fileLedger: [f({ bucket: "policy", driveFileId: "D1", chunkIds: ["P001"] })] } as PPDReviewResult,
      evidence: ev({ fileLedger: [f({ bucket: "evidence", driveFileId: "D1", chunkIds: ["C001"] })], rows: [] }),
    });
    expect(list.map((x) => x.bucket)).toEqual(["policy", "evidence"]);
  });

  it("does not call an uncited document a fault", () => {
    expect(UNCITED_NOTE).toMatch(/Either this area does not need them/i);
    expect(UNCITED_NOTE).not.toMatch(/fail|error|wrong/i);
  });
});

// TASK A.
describe("the record row sits under Audit support, not in the verdict strip", () => {
  const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");

  it("is a collapsed row, closed by default", () => {
    expect(PAGE).toContain('className="sc-record-drop"');
    expect(PAGE).toContain('className="sc-record-sum"');
  });

  it("is not a fourth tab beside the three support tabs", () => {
    const tabs = PAGE.slice(PAGE.indexOf("const SUPPORT_TABS"), PAGE.indexOf("type SupportTab"));
    expect(tabs).not.toMatch(/check did|transcript|record/i);
  });

  it("is not in the verdict strip either", () => {
    const strip = PAGE.slice(PAGE.indexOf('className="sc-view-tabs"'), PAGE.indexOf('className="sc-view-subheader"'));
    expect(strip).not.toContain("sc-record-drop");
    expect(strip).not.toContain("What the check did");
  });

  it("leaves the warning blocks where they were, beside the result", () => {
    // These change whether the number can be trusted; they must never end up
    // behind a collapsed row.
    const beforeSupport = PAGE.slice(0, PAGE.indexOf('className="sc-support"'));
    expect(beforeSupport).toContain("splitRunWarnings");
    expect(beforeSupport).toMatch(/partialRead|Read in part|partly/i);
  });
});
