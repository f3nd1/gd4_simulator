import { describe, it, expect } from "vitest";
import { buildRunTranscript, fileLine, RUN_LOG_CAP_PER_PASS } from "../runTranscript";
import type { AiCallRecord, AuditFileRecord, EvidenceAssessmentResult, PPDReviewResult } from "../../types";

const T0 = 1_700_000_000_000;

const file = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
  path: "e/Board Minutes.pdf", name: "Board Minutes.pdf", mimeType: "application/pdf",
  fileKind: "PDF", bucket: "evidence", readStatus: "read", auditStatus: "audited", charCount: 1234, ...over,
});

const call = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  seq: 1, pass: "records/extract", label: "window 1 of 2", startedAt: T0,
  durationMs: 4200, outcome: "ok", promptChars: 100, responseChars: 50, ...over,
});

const ev = (over: Partial<EvidenceAssessmentResult> = {}): EvidenceAssessmentResult => ({
  subCriterionId: "5.5", rows: [], runAt: new Date(T0).toISOString(), live: true,
  fileLedger: [file()], aiCallLog: [call()], ...over,
} as EvidenceAssessmentResult);

const ppd = (over: Partial<PPDReviewResult> = {}): PPDReviewResult => ({
  subCriterionId: "5.5", rows: [], runAt: new Date(T0).toISOString(), live: true,
  fileLedger: [file({ name: "Policy.pdf", bucket: "policy" })], aiCallLog: [call({ pass: "procedure/extract" })], ...over,
} as PPDReviewResult);

const logOf = (n: number) => Array.from({ length: n }, (_, i) => ({ at: T0 + i * 1000, text: `line ${i}` }));

describe("the chronology is built from the uncapped sources", () => {
  it("lists every file, however many, in ledger order", () => {
    const files = Array.from({ length: 38 }, (_, i) => file({ name: `f${i}.pdf` }));
    const { rows } = buildRunTranscript({ evidence: ev({ fileLedger: files }) });
    const fileRows = rows.filter((r) => r.kind === "file");
    // 38 files with a 60-line commentary cap: the whole point is that the file
    // list does not lose its beginning the way the commentary does.
    expect(fileRows).toHaveLength(38);
    expect(fileRows[0].label).toContain("f0.pdf");
    expect(fileRows[37].label).toContain("f37.pdf");
  });

  it("lists every AI call, in sequence order, however many", () => {
    const calls = Array.from({ length: 120 }, (_, i) => call({ seq: 120 - i, startedAt: T0 + i }));
    const { rows } = buildRunTranscript({ evidence: ev({ aiCallLog: calls }) });
    const seqs = rows.filter((r) => r.kind === "call").map((r) => Number(r.label.split(".")[0]));
    expect(seqs).toHaveLength(120);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("puts a real clock on calls and none on files", () => {
    const { rows } = buildRunTranscript({ evidence: ev() });
    expect(rows.find((r) => r.kind === "call")!.at).toBe(T0);
    // The ledger records order, not a time. An invented one would be worse.
    expect(rows.find((r) => r.kind === "file")!.at).toBeUndefined();
  });

  it("keeps the two passes in order, procedure first", () => {
    const { rows } = buildRunTranscript({ ppd: ppd(), evidence: ev() });
    const heads = rows.filter((r) => r.kind === "pass").map((r) => r.pass);
    expect(heads).toEqual(["procedure", "records"]);
  });
});

describe("a missing narrative line is said out loud", () => {
  it("warns when the commentary hit its cap and lost its beginning", () => {
    const { rows } = buildRunTranscript({ evidence: ev({ runLog: logOf(RUN_LOG_CAP_PER_PASS) }) });
    const gap = rows.find((r) => r.kind === "gap");
    expect(gap, "a full commentary must announce its own truncation").toBeDefined();
    expect(gap!.label).toMatch(/earliest commentary lines .* were dropped/i);
    expect(gap!.detail).toContain(String(RUN_LOG_CAP_PER_PASS));
    // And it must not leave the reader thinking the rest is suspect too.
    expect(gap!.detail).toMatch(/documents and the requests above are complete/i);
  });

  it("stays quiet when the commentary fits", () => {
    const { rows } = buildRunTranscript({ evidence: ev({ runLog: logOf(12) }) });
    expect(rows.filter((r) => r.kind === "gap" && /dropped/i.test(r.label))).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "narrative")).toHaveLength(12);
  });

  it("says so when no commentary was kept at all", () => {
    const { rows } = buildRunTranscript({ evidence: ev({ runLog: undefined }) });
    expect(rows.some((r) => r.kind === "gap" && /No running commentary/i.test(r.label))).toBe(true);
  });

  it("says so when the requests were not kept, as on an archived run", () => {
    // partialize strips aiCallLog and runLog from history but keeps the
    // ledger, so this is the shape of every run you scroll back to.
    const { rows } = buildRunTranscript({ evidence: ev({ aiCallLog: undefined, runLog: undefined }) });
    expect(rows.some((r) => r.kind === "gap" && /No record of the individual requests/i.test(r.label))).toBe(true);
    expect(rows.filter((r) => r.kind === "file")).toHaveLength(1);
  });
});

describe("what a verdict actually became", () => {
  const judged = call({ seq: 2, pass: "records/judge", verdicts: [{ ref: "5.5.1.DS1", verdict: "Met" }] });

  it("shows the recorded verdict beside the model's when a gate moved it", () => {
    const r = buildRunTranscript({
      evidence: ev({ aiCallLog: [judged], rows: [{ gdRef: "5.5.1.DS1", verdict: "Partial" }] as never }),
    });
    const v = r.rows.find((x) => x.verdicts)!.verdicts![0];
    expect(v).toMatchObject({ model: "Met", final: "Partial", changed: true });
    expect(r.summary).toContain("1 verdict changed");
  });

  it("does not cry change when the two agree", () => {
    const r = buildRunTranscript({
      evidence: ev({ aiCallLog: [judged], rows: [{ gdRef: "5.5.1.DS1", verdict: "Met" }] as never }),
    });
    expect(r.rows.find((x) => x.verdicts)!.verdicts![0].changed).toBe(false);
    expect(r.summary).not.toContain("changed");
  });

  it("matches refs through the one normaliser, not by raw string", () => {
    const r = buildRunTranscript({
      evidence: ev({
        aiCallLog: [call({ seq: 2, pass: "records/judge", verdicts: [{ ref: " ref: 5.5.1.ds1 ", verdict: "Met" }] })],
        rows: [{ gdRef: "5.5.1.DS1", verdict: "Not met" }] as never,
      }),
    });
    expect(r.rows.find((x) => x.verdicts)!.verdicts![0].final).toBe("Not met");
  });
});

describe("a file's line never overstates what was read", () => {
  it("marks a partly read file as such, in numbers", () => {
    const l = fileLine(file({ partialRead: { kind: "rows", read: 200, total: 5000 } }));
    expect(l.detail).toContain("ONLY 200 of 5,000 rows read");
    expect(l.tone).toBe("warn");
  });

  it("says a skipped file was skipped, with its reason", () => {
    const l = fileLine(file({ readStatus: "skipped", skipReason: "no readable text" }));
    expect(l.label).toMatch(/^Skipped/);
    expect(l.detail).toBe("no readable text");
  });

  it("does not call a file read when the run never reached it", () => {
    const l = fileLine(file({ readStatus: "found" }));
    expect(l.label).toMatch(/^Never opened/);
    expect(l.tone).toBe("warn");
  });

  it("names the reason missing rather than implying there was none", () => {
    expect(fileLine(file({ readStatus: "failed" })).detail).toMatch(/No reason was recorded/);
  });
});

describe("the record holds no document text", () => {
  it("carries names, counts and verdicts only", () => {
    const { rows } = buildRunTranscript({
      ppd: ppd({ promptSent: "SECRET STUDENT NRIC S1234567A" } as never),
      evidence: ev({ promptSent: "SECRET STUDENT NRIC S1234567A", runLog: logOf(3) } as never),
    });
    expect(JSON.stringify(rows)).not.toContain("S1234567A");
  });
});
