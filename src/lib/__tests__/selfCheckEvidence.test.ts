import { describe, it, expect } from "vitest";
import {
  toFileRow, toFileRows, countFileRows, unreadableWarning,
  buildWorking, notCheckedReason, expectedEvidenceFor, qualifyForUnreadable,
} from "../selfCheckEvidence";
import { toSelfCheckRows, toRecordsRows, toProcedureRows, citedText, missingText, NO_BREAKDOWN_NOTE, buildSelfCheckCsv, buildSelfCheckHtml, countSelfCheck, expectedEvidenceGroups } from "../selfCheck";
import type { AuditFileRecord, EvidenceAssessmentRow, PPDReviewRow } from "../../types";

const file = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
  path: "2. Actual Evidence/Intervention log.pdf", name: "Intervention log.pdf",
  mimeType: "application/pdf", fileKind: "pdf", bucket: "evidence",
  readStatus: "read", auditStatus: "not_used", charCount: 12400, ...over,
});

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "Implement a learning support process.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Met", comment: "Shown in the log.", ...over,
});

describe("what was actually read, told apart from what is genuinely absent", () => {
  it("marks a file the run could not open as unreadable, with what to do", () => {
    const r = toFileRow(file({ readStatus: "failed", failReason: "Drive read error — file not assessed." }));
    expect(r.outcome).toBe("unreadable");
    expect(r.label).toBe("Could not be opened");
    expect(r.action).toMatch(/shared with the audit account/i);
  });

  // The whole point of this panel: a scan that yielded nothing must not read
  // the same as a document that genuinely says nothing.
  it("tells a scan with no text apart from a plain empty file, and names the different fix", () => {
    const scan = toFileRow(file({ readStatus: "skipped", skipReason: "No extractable text (empty or unreadable).", suspectedScannedPdf: true }));
    expect(scan.outcome).toBe("unreadable");
    expect(scan.action).toMatch(/OCR/);
    const plain = toFileRow(file({ readStatus: "skipped", skipReason: "No extractable text (empty or unreadable)." }));
    expect(plain.action).toMatch(/select text/i);
    expect(plain.action).not.toBe(scan.action);
  });

  it("flags a file read by image transcription rather than reporting a clean read", () => {
    const r = toFileRow(file({ readMethod: "vision", charCount: 800 }));
    expect(r.outcome).toBe("check");
    expect(r.label).toBe("Read from images");
    expect(r.detail).toMatch(/transcribed from page images/);
  });

  it("reports a clean text read with no action needed", () => {
    const r = toFileRow(file({ extractedTextQuality: "high", auditStatus: "cited" }));
    expect(r.outcome).toBe("read");
    expect(r.action).toBe("");
    expect(r.cited).toBe(true);
  });

  // A file listed but never reached is not a file problem and not a clean read.
  it("says so when the run ended before a file was read", () => {
    expect(toFileRow(file({ readStatus: "found" })).label).toBe("Not read");
  });

  it("labels each file by the folder it came from, and does not list a shared file twice", () => {
    const rows = toFileRows(
      [file({ bucket: "policy", name: "Procedure.docx", driveFileId: "A" })],
      [file({ bucket: "evidence", name: "Log.pdf", driveFileId: "B" }), file({ bucket: "evidence", name: "Log.pdf", driveFileId: "B" })],
    );
    expect(rows.map((r) => r.bucket)).toEqual(["Written procedure", "Records"]);
    expect(rows).toHaveLength(2);
  });

  it("warns, by name, that a gap may be sitting in an unreadable file", () => {
    const counts = countFileRows(toFileRows(undefined, [file({ readStatus: "failed", name: "Scan.pdf" }), file({ name: "Log.pdf", driveFileId: "z" })]));
    expect(counts).toMatchObject({ total: 2, read: 1, unreadable: 1 });
    expect(unreadableWarning(counts)).toContain("Scan.pdf");
    expect(unreadableWarning(counts)).toMatch(/before treating a gap as real/);
    expect(unreadableWarning(countFileRows([]))).toBe("");
  });
});

describe("every verdict carries its working", () => {
  it("a pass shows the passage that satisfied it and the file it came from", () => {
    const w = buildWorking(row({ evidenceQuote: "Three students were placed on a support plan.", evidenceFiles: [{ name: "Intervention log.pdf", url: "u" }], evidenceChunkIds: ["C001"] }), undefined, { C001: "Intervention log.pdf" });
    expect(w.citations).toEqual([{ file: "Intervention log.pdf", quote: "Three students were placed on a support plan." }]);
    expect(citedText({ ...w })).toContain("Intervention log.pdf");
  });

  // A verdict with no citation is not defensible, so a cited file with no
  // verified excerpt says exactly that rather than showing nothing.
  it("says when a file was cited with no exact excerpt captured", () => {
    const w = buildWorking(row({ evidenceChunkIds: ["C001"] }), undefined, { C001: "Intervention log.pdf" });
    expect(w.citations).toHaveLength(0);
    expect(citedText(w)).toMatch(/no exact excerpt captured/);
  });

  it("names the specific element a shortfall is missing, from the run's own promise checks", () => {
    const w = buildWorking(row({
      verdict: "Partial",
      promiseChecks: [
        { promiseText: "Interventions are recorded on the Academic Intervention Form", verdict: "not evidenced", evidence: "No record found.", chunkIds: [], rationale: "No completed form appears in the records." },
        { promiseText: "Reviewed at the next progress meeting", verdict: "evidenced", evidence: "Minutes of 18 May", chunkIds: ["C002"], quote: "Progress meeting minutes of 18 May 2026" },
      ],
    }), undefined, { C002: "Minutes.docx" });
    expect(w.missing).toEqual([{ text: "Interventions are recorded on the Academic Intervention Form", why: "No completed form appears in the records." }]);
    expect(w.noBreakdown).toBe(false);
    expect(missingText(w)).toContain("Academic Intervention Form");
  });

  it("falls back to the procedure pass's clause breakdown when the records pass gave none", () => {
    const ppd: PPDReviewRow = { ref: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "x", verdict: "Partial", shortComment: "", fullComment: "", chunkIds: [], subClauses: [{ text: "who approves the plan", verdict: "not documented" }, { text: "who reviews it", verdict: "documented" }] };
    const w = buildWorking(row({ verdict: "Partial" }), ppd, {});
    expect(w.missing).toEqual([{ text: "who approves the plan", why: "Your written procedure does not cover this part." }]);
  });

  // The honest answer when the engine produced no decomposition: say so, do not
  // invent a category.
  it("admits when a shortfall has no breakdown at all", () => {
    const w = buildWorking(row({ verdict: "Not met" }), undefined, {});
    expect(w.missing).toEqual([]);
    expect(w.noBreakdown).toBe(true);
    expect(missingText(w)).toBe(NO_BREAKDOWN_NOTE);
  });

  it("tells the four could-not-check reasons apart", () => {
    expect(notCheckedReason({ assessmentFailed: true, comment: "", evidenceSummary: "" })).toMatch(/did not answer/);
    expect(notCheckedReason({ comment: "The run was stopped before this requirement line was reviewed.", evidenceSummary: "" })).toMatch(/stopped before/);
    expect(notCheckedReason({ comment: "Not assessed — nothing was judged on either side.", evidenceSummary: "" })).toMatch(/Neither pass/);
    expect(notCheckedReason({ comment: "none could be verified as an exact excerpt", evidenceSummary: "" })).toMatch(/word for word/);
    expect(notCheckedReason({ comment: "something else entirely", evidenceSummary: "" })).toBe("");
  });
});

describe("what good looks like comes only from the official list", () => {
  it("returns the published expected evidence for a real requirement", () => {
    expect(expectedEvidenceFor("6.1.1")).toContain("Internal assessment reports");
  });

  it("returns nothing at all for an id the shipped data does not have", () => {
    expect(expectedEvidenceFor("99.9.9")).toEqual([]);
  });

  it("rides on every row, so the table and both exports draw from one source", () => {
    const [r] = toSelfCheckRows([row({ gd4ItemId: "6.1.1", gdRef: "6.1.1.DS1" })]);
    expect(r.expected).toContain("Internal assessment reports");
    const [p] = toProcedureRows([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x", verdict: "Adequate", shortComment: "", fullComment: "", chunkIds: [] }]);
    expect(p.expected).toContain("Internal assessment reports");
  });
});

describe("the working is filed with the result, in both exports", () => {
  const rows = toSelfCheckRows([row({
    verdict: "Partial", gd4ItemId: "6.1.1", gdRef: "6.1.1.DS1",
    evidenceQuote: "The internal assessment was completed in March.", evidenceChunkIds: ["C001"],
    promiseChecks: [{ promiseText: "Assessors are independent of the area assessed", verdict: "not evidenced", evidence: "No record found.", chunkIds: [] }],
  })], { chunkFileNames: { C001: "Assessment report.pdf" } });
  const files = toFileRows(undefined, [file({ readStatus: "failed", name: "Scan.pdf" })]);

  it("carries the quote, the missing element and the official list into the CSV, with the file list below", () => {
    const csv = buildSelfCheckCsv("6.1 Internal Assessment", rows, { kind: "none" }, "overview", files);
    expect(csv).toContain("Evidence quoted");
    expect(csv).toContain("The internal assessment was completed in March.");
    expect(csv).toContain("Assessors are independent of the area assessed");
    expect(csv).toContain("Internal assessment reports");
    expect(csv).toContain("What was read");
    expect(csv).toContain("Scan.pdf");
  });

  it("carries the same into the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "6.1 Internal Assessment", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", files,
    });
    expect(html).toContain("Quoted:");
    expect(html).toContain("Missing:");
    expect(html).toContain("What a passing record contains");
    expect(html).toContain("Internal assessment reports");
    expect(html).toContain("What was read");
    expect(html).toContain("NOT READ");
  });

  // A run with no ledger (an older stored result) must print exactly as it did.
  it("omits the file section entirely when the run recorded no ledger", () => {
    expect(buildSelfCheckCsv("6.1 Internal Assessment", rows, { kind: "none" })).not.toContain("What was read");
    expect(buildSelfCheckHtml({ areaLabel: "a", areaDescription: "d", counts: countSelfCheck(rows), band: { kind: "none" }, rows, ranAt: "x" })).not.toContain("What was read");
  });
});

describe("one file read by both passes is one file", () => {
  // Pasting the same folder into both fields is the documented way to use this
  // page, and it makes every file appear in both ledgers. Listing it twice made
  // the run look like it had read, and failed on, twice as many documents as it
  // had, which is not something an auditor could defend.
  it("collapses it to a single row marked as both folders", () => {
    const rows = toFileRows(
      [file({ bucket: "policy", name: "Handbook.pdf", driveFileId: "A" })],
      [file({ bucket: "evidence", name: "Handbook.pdf", driveFileId: "A" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe("Both folders");
  });

  it("keeps the worse of the two outcomes, because that is the one with an action", () => {
    const rows = toFileRows(
      [file({ bucket: "policy", name: "Handbook.pdf", driveFileId: "A" })],
      [file({ bucket: "evidence", name: "Handbook.pdf", driveFileId: "A", readStatus: "failed", failReason: "Drive read error" })],
    );
    expect(rows[0].outcome).toBe("unreadable");
    expect(countFileRows(rows).unreadable).toBe(1);
    expect(unreadableWarning(countFileRows(rows))).toContain("1 file could not be read");
  });

  it("keeps a citation from either pass", () => {
    const rows = toFileRows(
      [file({ bucket: "policy", name: "Handbook.pdf", driveFileId: "A", auditStatus: "cited" })],
      [file({ bucket: "evidence", name: "Handbook.pdf", driveFileId: "A" })],
    );
    expect(rows[0].cited).toBe(true);
  });
});

describe("the official list is shown once per requirement item", () => {
  it("groups the rows of one item into a single entry", () => {
    const rows = toSelfCheckRows([
      row({ gd4ItemId: "6.1.1", gdRef: "6.1.1.DS1" }),
      row({ gd4ItemId: "6.1.1", gdRef: "6.1.1.DS2" }),
    ]);
    const groups = expectedEvidenceGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemId).toBe("6.1.1");
    expect(groups[0].items).toContain("Internal assessment reports");
  });

  it("skips an item the shipped data has no list for, rather than printing an empty heading", () => {
    expect(expectedEvidenceGroups(toSelfCheckRows([row({ gd4ItemId: "99.9.9", gdRef: "99.9.9.DS1" })]))).toEqual([]);
  });
});

describe("a gap reported beside an unread file is not a clean gap", () => {
  // The file panel and the row text sat on the same screen saying opposite
  // things: two files could not be read, while every gap row claimed every
  // document had been read. An external assessor would catch that instantly.
  it("stops the row claiming every document was read", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", comment: "The extraction pass read every provided evidence document and returned no candidate passage for this line (0 extracted)." })], { unreadableFiles: 2 });
    expect(r.why).not.toMatch(/Every document in your records folder was read/);
    expect(r.why).toMatch(/2 files could not be read/);
    expect(r.why).toMatch(/What was read/);
  });

  it("qualifies the records view the same way", () => {
    const [r] = toRecordsRows([row({ verdict: "Not met", evidenceChunkIds: [] })], { unreadableFiles: 1 });
    expect(r.why).toMatch(/1 file could not be read/);
    expect(r.why).toMatch(/may be inside it/);
  });

  it("changes nothing when every file was read", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", comment: "The extraction pass read every provided evidence document and returned no candidate passage for this line (0 extracted)." })], { unreadableFiles: 0 });
    expect(r.why).toBe("Nothing in your records spoke to this requirement. Every document in your records folder was read, and none of them mentioned it.");
    expect(qualifyForUnreadable("anything", 0)).toBe("anything");
  });

  // A pass is not qualified: the citation stands whatever else went unread.
  it("leaves a pass alone", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Met", comment: "The log shows this happening." })], { unreadableFiles: 3 });
    expect(r.why).toBe("The log shows this happening.");
  });
});

describe("the unread caveat goes only where the claim was made", () => {
  it("qualifies a 'could not check' row that made the same claim", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not assessed", comment: "Not assessed — the extraction pass read every provided evidence document and returned no candidate passage for it." })], { unreadableFiles: 2 });
    expect(r.label).toBe("Could not check");
    expect(r.why).toMatch(/2 files could not be read/);
  });

  it("appends nothing to a reason that never claimed everything was read", () => {
    expect(qualifyForUnreadable("The checking service did not answer for this one.", 3)).toBe("The checking service did not answer for this one.");
    expect(qualifyForUnreadable("", 3)).toBe("");
  });
});
