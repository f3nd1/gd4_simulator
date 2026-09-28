// The re-read trace. Re-reading one file is one click and it rewrites
// verdicts, and we have measured that verdicts move between runs on unchanged
// documents. Without a record, somebody could re-read until a line turned from
// "does not comply" to "complies" and nothing would show it.
//
// These cover the three surfaces the trace has to reach (the file row, the
// requirement line, the area) and the three exports, all counting off the SAME
// stored records so none of them can show a re-read the others do not.
import { describe, it, expect } from "vitest";
import { withRereads, rereadNoteForRef, rereadSummary, toFileRows, type SelfCheckFileRow } from "../selfCheckEvidence";
import { toSelfCheckRows, toRecordsRows, toProcedureRows, buildSelfCheckCsv, buildSelfCheckHtml, countSelfCheck, SELF_CHECK_HEADERS, SELF_CHECK_FILE_HEADERS } from "../selfCheck";
import { buildAiRunLog } from "../aiRunLogExport";
import type { AuditFileRecord, EvidenceAssessmentResult, EvidenceAssessmentRow, PPDReviewRow, RereadRecord } from "../../types";

const REF = "6.3.1.DS1";
const FILE_ID = "drive-abc";

const reread = (over: Partial<RereadRecord> = {}): RereadRecord => ({
  at: "2026-09-27T06:12:00.000Z", fileName: "Agent Log.pdf", driveFileId: FILE_ID,
  refs: [REF], previousRunId: "EV-6.3-FIRST", previousVerdicts: { [REF]: "Not met" }, ...over,
});
const led = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
  path: "2. Actual Evidence/Agent Log.pdf", name: "Agent Log.pdf", mimeType: "application/pdf",
  fileKind: "PDF", bucket: "evidence", readStatus: "read", auditStatus: "cited",
  charCount: 900, driveFileId: FILE_ID, chunkIds: ["C001"], ...over,
});
const evRow = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: REF, gd4ItemId: "6.3.1", requirementText: "Agents are monitored.",
  ppdExtract: "x", ppdVerdict: "Adequate", evidenceSummary: "Log sighted.",
  evidenceFiles: [], evidenceChunkIds: ["C001"], verdict: "Met", comment: "Shown.", ...over,
});

describe("the file row says how often it was read again", () => {
  const rows = (): SelfCheckFileRow[] => toFileRows(undefined, [led(), led({ path: "e/Other.pdf", name: "Other.pdf", driveFileId: "drive-zzz" })]);

  it("counts only the file the re-read names", () => {
    const out = withRereads(rows(), [reread()]);
    expect(out[0].rereadCount).toBe(1);
    expect(out[0].lastRereadAt).toBe("2026-09-27T06:12:00.000Z");
    expect(out[1].rereadCount).toBeUndefined();
  });

  it("accumulates, and keeps the LAST time", () => {
    const out = withRereads(rows(), [reread(), reread({ at: "2026-09-28T02:00:00.000Z" })]);
    expect(out[0].rereadCount).toBe(2);
    expect(out[0].lastRereadAt).toBe("2026-09-28T02:00:00.000Z");
  });

  it("matches on the Drive id, not the display name, when both have one", () => {
    // Same name in two folders is a real case: the id is what separates them.
    const out = withRereads(
      toFileRows(undefined, [led({ path: "e/a/Log.pdf", name: "Log.pdf", driveFileId: "id-a" }), led({ path: "e/b/Log.pdf", name: "Log.pdf", driveFileId: "id-b" })]),
      [reread({ fileName: "Log.pdf", driveFileId: "id-b" })],
    );
    expect(out.map((r) => r.rereadCount)).toEqual([undefined, 1]);
  });

  it("falls back to the name for a record written without an id", () => {
    const out = withRereads(rows(), [reread({ driveFileId: undefined })]);
    expect(out[0].rereadCount).toBe(1);
  });

  it("leaves every row untouched when nothing was re-read", () => {
    expect(withRereads(rows(), [])).toEqual(rows());
    expect(withRereads(rows(), undefined)).toEqual(rows());
  });

  it("gives every row a stable key, which the name cannot be", () => {
    const out = toFileRows(undefined, [led({ path: "e/a/Log.pdf", name: "Log.pdf", driveFileId: "id-a" }), led({ path: "e/b/Log.pdf", name: "Log.pdf", driveFileId: "id-b" })]);
    expect(out.map((r) => r.key)).toEqual(["id-a", "id-b"]);
    expect(new Set(out.map((r) => r.key)).size).toBe(2);
  });
});

describe("the requirement line says the verdict came from a re-read", () => {
  it("names the file, the date and what the line said BEFORE", () => {
    const note = rereadNoteForRef(REF, [reread()], "Met");
    expect(note).toContain("Agent Log.pdf");
    // en-SG renders the short month as "Sept", not "Sep".
    expect(note).toMatch(/27 Sept 2026/);
    expect(note).toContain("Was Not met before the first re-read, now Met.");
  });

  // THE POINT OF THE WHOLE FEATURE. Quoting the verdict from before the LAST
  // re-read shows step three of a journey and hides steps one and two: a line
  // that went Not met, Partial, Partial, Met would read "was Partial, now Met".
  it("quotes the ORIGINAL verdict, not the last hop", () => {
    const chain = [
      reread({ at: "2026-09-27T06:00:00.000Z", previousVerdicts: { [REF]: "Not met" } }),
      reread({ at: "2026-09-27T07:00:00.000Z", previousVerdicts: { [REF]: "Partial" } }),
      reread({ at: "2026-09-28T02:00:00.000Z", previousVerdicts: { [REF]: "Partial" } }),
    ];
    const note = rereadNoteForRef(REF, chain, "Met");
    expect(note).toContain("Was Not met before the first re-read, now Met.");
    expect(note).toMatch(/3 re-reads/);
    // The intermediate values must not be the ones quoted.
    expect(note).not.toMatch(/Was Partial before/);
  });

  it("ignores re-reads of other lines when finding the original", () => {
    const chain = [
      reread({ at: "2026-09-27T05:00:00.000Z", refs: ["6.3.1.DS9"], previousVerdicts: { "6.3.1.DS9": "Partial" } }),
      reread({ at: "2026-09-27T06:00:00.000Z", previousVerdicts: { [REF]: "Not met" } }),
    ];
    expect(rereadNoteForRef(REF, chain, "Met")).toContain("Was Not met before the first re-read");
  });

  it("says only what happened when no before-verdict was recorded", () => {
    const note = rereadNoteForRef(REF, [reread({ previousVerdicts: {} })], "Met");
    expect(note).toMatch(/^Re-read of Agent Log\.pdf/);
    expect(note).not.toMatch(/before the first re-read/);
  });

  it("says nothing on a line the re-read did not touch", () => {
    expect(rereadNoteForRef("6.3.1.DS2", [reread()])).toBe("");
    expect(rereadNoteForRef(REF, [])).toBe("");
  });

  it("rides on both evidence-side row builders and on neither procedure row", () => {
    const ctx = { rereads: [reread()] };
    expect(toSelfCheckRows([evRow()], ctx)[0].rereadNote).toContain("Agent Log.pdf");
    expect(toRecordsRows([evRow()], ctx)[0].rereadNote).toContain("Agent Log.pdf");
    // A file re-read reads the records folder only, so the written-procedure
    // tab must never claim one.
    const ppd: PPDReviewRow = { ref: REF, gd4ItemId: "6.3.1", requirementText: "r", verdict: "Adequate", shortComment: "s", fullComment: "f", promises: [], chunkIds: [] };
    expect(toProcedureRows([ppd], ctx)[0].rereadNote).toBeUndefined();
  });
});

describe("the area says it once, at the top", () => {
  it("counts re-reads and the files they were of", () => {
    const s = rereadSummary([reread(), reread({ at: "2026-09-28T02:00:00.000Z" }), reread({ fileName: "Other.pdf", driveFileId: "drive-zzz" })]);
    expect(s).toMatch(/3 re-reads of 2 files/);
    expect(s).toMatch(/cannot be removed/i);
  });

  it("is silent on a check that has never had one", () => {
    expect(rereadSummary([])).toBe("");
    expect(rereadSummary(undefined)).toBe("");
  });
});

describe("it travels into all three exports", () => {
  const rows = toSelfCheckRows([evRow()], { rereads: [reread()] });
  const files = toFileRows(undefined, [led()], [reread()]);

  it("the CSV carries a column on the verdict AND on the file, plus the area line", () => {
    const csv = buildSelfCheckCsv("6.3 Agents", rows, { kind: "none" }, "overview", files, undefined, undefined, [], "", false, {}, [reread()]);
    const lines = csv.split("\r\n");
    // Line 1 is the one-reading caveat; the re-read line is its own comment
    // above the headers, where sorting cannot move it.
    expect(lines[1]).toMatch(/^# This result includes 1 re-read of 1 file/);
    expect(lines[2]).toContain(SELF_CHECK_HEADERS[0]);
    expect(SELF_CHECK_HEADERS).toContain("Re-read");
    expect(SELF_CHECK_FILE_HEADERS).toContain("Re-read");
    expect(csv).toContain("Was Not met before the first re-read, now Met.");
    expect(csv).toMatch(/read again 1 time/);
  });

  it("the CSV of a check with no re-read gains no extra comment line", () => {
    const clean = buildSelfCheckCsv("6.3 Agents", toSelfCheckRows([evRow()]), { kind: "none" });
    expect(clean.split("\r\n")[1]).toContain(SELF_CHECK_HEADERS[0]);
  });

  it("the printed page carries it on the line and in the file table", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "6.3", areaDescription: "d", ranAt: "today", rows, files,
      band: { kind: "none" }, counts: countSelfCheck(rows), rereads: [reread()],
    });
    expect(html).toContain("This result includes 1 re-read of 1 file");
    expect(html).toContain("sc-reread");
    expect(html).toMatch(/Was Not met before the first re-read, now Met\./);
  });

  it("the run log carries the records themselves, on the records pass", () => {
    const ev = { subCriterionId: "6.3", rows: [evRow()], runAt: "x", live: true, rereads: [reread()] } as EvidenceAssessmentResult;
    const log = buildAiRunLog({ area: "6.3", evidence: ev });
    const pass = log.passes.find((p) => p.pass === "records")!;
    expect(pass.rereads).toEqual([reread()]);
    // The procedure pass cannot have one: a file re-read never reads that folder.
    expect(log.passes.find((p) => p.pass === "procedure")).toBeUndefined();
  });

  it("the run log of a clean check has no rereads field at all", () => {
    const ev = { subCriterionId: "6.3", rows: [evRow()], runAt: "x", live: true } as EvidenceAssessmentResult;
    expect(buildAiRunLog({ area: "6.3", evidence: ev }).passes[0].rereads).toBeUndefined();
  });
});
