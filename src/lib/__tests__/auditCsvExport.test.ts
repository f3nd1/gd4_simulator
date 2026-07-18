import { describe, it, expect } from "vitest";
import {
  csvCell,
  auditCsvFilename,
  exportFileLedgerCsv,
  exportFileLedgerCsvFor,
  exportAISummaryCsv,
  exportOptionASummaryCsv,
  progressToRunRecord,
  buildRunLogCsv,
} from "../auditCsvExport";
import type { AuditFileRecord, AuditAISummaryLine, AuditRunRecord, PPDReviewRow, EvidenceAssessmentRow, RunLogEntry } from "../../types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<AuditFileRecord> = {}): AuditFileRecord {
  return {
    path: "1. Policy & Procedure/policy.pdf",
    name: "policy.pdf",
    mimeType: "application/pdf",
    fileKind: "pdf",
    bucket: "policy",
    readStatus: "read",
    auditStatus: "cited",
    ...overrides,
  };
}

function makeVerdict(overrides: Partial<AuditAISummaryLine> = {}): AuditAISummaryLine {
  return {
    lineId: "4.5.1.DS1",
    lineText: "The institution has a documented student support policy.",
    result: "Met",
    approachStatus: "Meeting",
    processesStatus: "Meeting",
    systemsOutcomesStatus: "Beginning",
    reviewStatus: "Not evident",
    citedChunkIds: ["C001", "C002"],
    citedFileNames: ["policy.pdf", "report.xlsx"],
    ...overrides,
  };
}

function makeRun(overrides: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    runId: "4.5-test-run",
    folderId: "folder-123",
    subCriterionId: "4.5",
    subCriterionTitle: "Student Support Services",
    scope: "both",
    status: "completed",
    startedAt: "2026-06-28T10:00:00.000Z",
    endedAt: "2026-06-28T10:05:00.000Z",
    auditLive: true,
    aiModel: "gpt-4o",
    fileLedger: [makeFile()],
    aiSummary: [makeVerdict()],
    linesAssessed: 5,
    findingsDetected: 1,
    batchCount: 1,
    chunkCount: 8,
    ...overrides,
  };
}

// ── csvCell ────────────────────────────────────────────────────────────────

describe("csvCell", () => {
  it("returns plain strings unchanged", () => {
    expect(csvCell("hello")).toBe("hello");
  });

  it("wraps value in quotes when it contains a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("wraps value in quotes when it contains a double-quote and escapes inner quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps value in quotes when it contains a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps value in quotes when it contains a carriage return", () => {
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("returns empty string for null", () => {
    expect(csvCell(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(csvCell(undefined)).toBe("");
  });

  it("converts numbers to strings", () => {
    expect(csvCell(42)).toBe("42");
  });

  it("converts booleans to strings", () => {
    expect(csvCell(true)).toBe("true");
  });

  it("handles zero without quoting", () => {
    expect(csvCell(0)).toBe("0");
  });
});

// ── auditCsvFilename ───────────────────────────────────────────────────────

describe("auditCsvFilename", () => {
  const run = { subCriterionId: "4.5", scope: "both", startedAt: "2026-06-28T10:00:00.000Z" };

  it("produces a well-formed filename", () => {
    const name = auditCsvFilename("gd4-audit-file-ledger", run);
    expect(name).toBe("gd4-audit-file-ledger-4.5-both-2026-06-28.csv");
  });

  it("replaces unsafe characters in subCriterionId with dashes", () => {
    const name = auditCsvFilename("prefix", { ...run, subCriterionId: "4 5/X" });
    expect(name).toMatch(/^prefix-4-5-X-both-/);
  });

  it("replaces unsafe characters in scope with dashes", () => {
    const name = auditCsvFilename("prefix", { ...run, scope: "policy only" });
    expect(name).toMatch(/-policy-only-/);
  });

  it("uses today's date when startedAt is empty", () => {
    const name = auditCsvFilename("x", { subCriterionId: "1.1", scope: "both", startedAt: "" });
    // Just check it ends with a date-like segment and .csv
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("always ends with .csv", () => {
    const name = auditCsvFilename("prefix", run);
    expect(name.endsWith(".csv")).toBe(true);
  });
});

// ── exportFileLedgerCsv ────────────────────────────────────────────────────

describe("exportFileLedgerCsv", () => {
  it("produces a string with CRLF line endings", () => {
    const csv = exportFileLedgerCsv(makeRun());
    expect(csv).toContain("\r\n");
  });

  it("includes the expected header columns", () => {
    const csv = exportFileLedgerCsv(makeRun());
    const header = csv.split("\r\n")[0];
    expect(header).toContain("auditRunId");
    expect(header).toContain("fileName");
    expect(header).toContain("auditStatus");
    expect(header).toContain("processingMode");
    expect(header).toContain("cited");
    expect(header).toContain("usedForApproach");
    expect(header).toContain("suspectedScannedPdf");
    expect(header).toContain("chunkIds");
  });

  it("outputs one data row per file", () => {
    const run = makeRun({ fileLedger: [makeFile(), makeFile({ name: "report.pdf", path: "2. Evidence/report.pdf" })] });
    const lines = exportFileLedgerCsv(run).split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it("marks cited files as yes in the cited column", () => {
    const csv = exportFileLedgerCsv(makeRun());
    const dataRow = csv.split("\r\n")[1];
    const cols = dataRow.split(",");
    const headers = csv.split("\r\n")[0].split(",");
    const citedIdx = headers.indexOf("cited");
    expect(cols[citedIdx]).toBe("yes");
  });

  it("marks non-cited files as no in the cited column", () => {
    const run = makeRun({ fileLedger: [makeFile({ auditStatus: "not_used" })] });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    const citedIdx = headers.indexOf("cited");
    expect(dataRow[citedIdx]).toBe("no");
  });

  it("records the read method (text vs vision) per file", () => {
    const run = makeRun({ fileLedger: [makeFile({ readMethod: "vision" })] });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    const idx = headers.indexOf("readMethod");
    expect(idx).toBeGreaterThan(-1);
    expect(dataRow[idx]).toBe("vision");
  });

  it("populates processingMode as new by default", () => {
    const run = makeRun({ fileLedger: [makeFile({ processingMode: undefined })] });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    const pmIdx = headers.indexOf("processingMode");
    expect(dataRow[pmIdx]).toBe("new");
  });

  it("writes reused for cached files", () => {
    const run = makeRun({ fileLedger: [makeFile({ processingMode: "reused" })] });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    const pmIdx = headers.indexOf("processingMode");
    expect(dataRow[pmIdx]).toBe("reused");
  });

  it("serialises citedByLineIds joined by semicolons", () => {
    const run = makeRun({ fileLedger: [makeFile({ citedByLineIds: ["L1", "L2", "L3"] })] });
    const csv = exportFileLedgerCsv(run);
    expect(csv).toContain("L1; L2; L3");
  });

  it("writes yes/no for usedForDimension columns", () => {
    const file = makeFile({
      usedForDimensions: { approach: true, processes: false, systemsOutcomes: true, review: false },
    });
    const run = makeRun({ fileLedger: [file] });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    expect(dataRow[headers.indexOf("usedForApproach")]).toBe("yes");
    expect(dataRow[headers.indexOf("usedForProcesses")]).toBe("no");
    expect(dataRow[headers.indexOf("usedForSystemsOutcomes")]).toBe("yes");
    expect(dataRow[headers.indexOf("usedForReview")]).toBe("no");
  });

  it("writes the run scope to every row", () => {
    const run = makeRun({ scope: "policy" });
    const csv = exportFileLedgerCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    expect(dataRow[headers.indexOf("auditScope")]).toBe("policy");
  });

  it("handles empty fileLedger (header only)", () => {
    const run = makeRun({ fileLedger: [] });
    const csv = exportFileLedgerCsv(run);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("auditRunId");
  });
});

// ── exportAISummaryCsv ─────────────────────────────────────────────────────

describe("exportAISummaryCsv", () => {
  it("includes expected header columns", () => {
    const csv = exportAISummaryCsv(makeRun());
    const header = csv.split("\r\n")[0];
    expect(header).toContain("checklistLineId");
    expect(header).toContain("result");
    expect(header).toContain("approachStatus");
    expect(header).toContain("processesStatus");
    expect(header).toContain("systemsOutcomesStatus");
    expect(header).toContain("reviewStatus");
    expect(header).toContain("citedChunkIds");
    expect(header).toContain("citedFileNames");
    expect(header).toContain("overallReason");
  });

  it("outputs one data row per verdict line", () => {
    const run = makeRun({ aiSummary: [makeVerdict(), makeVerdict({ lineId: "4.5.2.DS1" })] });
    const lines = exportAISummaryCsv(run).split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it("serialises citedChunkIds joined by semicolons", () => {
    const csv = exportAISummaryCsv(makeRun());
    expect(csv).toContain("C001; C002");
  });

  it("serialises citedFileNames joined by semicolons", () => {
    const csv = exportAISummaryCsv(makeRun());
    expect(csv).toContain("policy.pdf; report.xlsx");
  });

  it("writes the result correctly", () => {
    const run = makeRun({ aiSummary: [makeVerdict({ result: "Not met" })] });
    const csv = exportAISummaryCsv(run);
    expect(csv).toContain("Not met");
  });

  it("handles empty aiSummary (header only)", () => {
    const run = makeRun({ aiSummary: [] });
    const csv = exportAISummaryCsv(run);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(1);
  });

  it("writes the audit scope from the run record", () => {
    const run = makeRun({ scope: "evidence" });
    const csv = exportAISummaryCsv(run);
    const headers = csv.split("\r\n")[0].split(",");
    const dataRow = csv.split("\r\n")[1].split(",");
    expect(dataRow[headers.indexOf("auditScope")]).toBe("evidence");
  });

  it("escapes lineText containing commas", () => {
    const run = makeRun({ aiSummary: [makeVerdict({ lineText: "Requires planning, review, and reporting." })] });
    const csv = exportAISummaryCsv(run);
    expect(csv).toContain('"Requires planning, review, and reporting."');
  });
});

// ── progressToRunRecord ────────────────────────────────────────────────────

describe("progressToRunRecord", () => {
  const base = {
    folderId: "f-001",
    subCriterionId: "4.5",
    folderName: "Student Support Services",
    scope: "both" as const,
    stage: "complete",
    startedAt: Date.now(),
    auditLive: true,
    aiModel: "gpt-4o",
    filesFound: [makeFile()],
    verdictLines: [makeVerdict()],
    linesAssessed: 5,
    findingsDetected: 1,
    batchTotal: 2,
    chunksCount: 8,
  };

  it("produces a completed status for stage complete", () => {
    const rec = progressToRunRecord(base);
    expect(rec.status).toBe("completed");
  });

  it("produces a failed status for stage error", () => {
    const rec = progressToRunRecord({ ...base, stage: "error" });
    expect(rec.status).toBe("failed");
  });

  it("produces a cancelled status for any other stage", () => {
    const rec = progressToRunRecord({ ...base, stage: "reading" });
    expect(rec.status).toBe("cancelled");
  });

  it("copies fileLedger from filesFound", () => {
    const rec = progressToRunRecord(base);
    expect(rec.fileLedger).toHaveLength(1);
    expect(rec.fileLedger[0].name).toBe("policy.pdf");
  });

  it("copies aiSummary from verdictLines", () => {
    const rec = progressToRunRecord(base);
    expect(rec.aiSummary).toHaveLength(1);
    expect(rec.aiSummary[0].lineId).toBe("4.5.1.DS1");
  });

  it("copies scope correctly", () => {
    const rec = progressToRunRecord({ ...base, scope: "policy" });
    expect(rec.scope).toBe("policy");
  });

  it("defaults scope to both when omitted", () => {
    const { scope, ...rest } = base;
    const rec = progressToRunRecord(rest);
    expect(rec.scope).toBe("both");
  });

  it("uses startedAt to set the ISO startedAt on the record", () => {
    const rec = progressToRunRecord(base);
    expect(rec.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sets linesAssessed and findingsDetected", () => {
    const rec = progressToRunRecord(base);
    expect(rec.linesAssessed).toBe(5);
    expect(rec.findingsDetected).toBe(1);
  });

  it("sets batchCount from batchTotal", () => {
    const rec = progressToRunRecord(base);
    expect(rec.batchCount).toBe(2);
  });

  it("sets chunkCount from chunksCount", () => {
    const rec = progressToRunRecord(base);
    expect(rec.chunkCount).toBe(8);
  });

  it("has a non-empty runId", () => {
    const rec = progressToRunRecord(base);
    expect(rec.runId.length).toBeGreaterThan(0);
  });

  it("handles missing optional fields gracefully", () => {
    const rec = progressToRunRecord({
      folderId: "f-001",
      subCriterionId: "1.1",
      folderName: "Test",
      stage: "complete",
    });
    expect(rec.fileLedger).toEqual([]);
    expect(rec.aiSummary).toEqual([]);
    expect(rec.linesAssessed).toBe(0);
    expect(rec.findingsDetected).toBe(0);
  });
});

// ── Option A (PPD + Evidence) exports ───────────────────────────────────────

function makePpdRow(overrides: Partial<PPDReviewRow> = {}): PPDReviewRow {
  return {
    ref: "4.1.1.DS1", gd4ItemId: "4.1.1", requirementText: "Pre-course counselling is documented",
    verdict: "Adequate", shortComment: "PPD covers counselling", fullComment: "full", chunkIds: [],
    ...overrides,
  };
}
function makeEvRow(overrides: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow {
  return {
    gdRef: "4.1.1.DS1", gd4ItemId: "4.1.1", requirementText: "Pre-course counselling is documented",
    ppdExtract: "x", ppdVerdict: "Adequate",
    evidenceSummary: "Counselling records found", evidenceFiles: [{ name: "counselling.pdf", url: "u" }],
    evidenceChunkIds: ["C003"], verdict: "Met", comment: "records present",
    ...overrides,
  };
}

describe("exportOptionASummaryCsv — per-line PPD + evidence summary", () => {
  it("emits one row per PPD line joining the evidence verdict, reasoning and citations", () => {
    const csv = exportOptionASummaryCsv({ runId: "AR-4.1-Z", subCriterionId: "4.1" }, [makePpdRow()], [makeEvRow()]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 line
    const h = lines[0].split(",");
    const d = lines[1].split(",");
    const at = (col: string) => d[h.indexOf(col)];
    expect(at("auditScope")).toBe("A");
    expect(at("lineRef")).toBe("4.1.1.DS1");
    expect(at("ppdVerdict")).toBe("Adequate");
    expect(at("evidenceVerdict")).toBe("Met");
    expect(at("citedChunkIds")).toBe("C003");
    expect(at("citedFileNames")).toBe("counselling.pdf");
  });

  it("leaves APSR-dimension columns blank (Option A does not capture them — not fabricated)", () => {
    const csv = exportOptionASummaryCsv({ runId: "r", subCriterionId: "4.1" }, [makePpdRow()], [makeEvRow()]);
    const h = csv.split("\r\n")[0].split(",");
    const d = csv.split("\r\n")[1].split(",");
    for (const col of ["approachStatus", "processesStatus", "systemsOutcomesStatus", "reviewStatus"]) {
      expect(d[h.indexOf(col)]).toBe("");
    }
  });

  it("still emits a PPD line when no evidence assessment exists (evidence columns blank)", () => {
    const csv = exportOptionASummaryCsv({ subCriterionId: "4.1" }, [makePpdRow()], []);
    const h = csv.split("\r\n")[0].split(",");
    const d = csv.split("\r\n")[1].split(",");
    expect(d[h.indexOf("ppdVerdict")]).toBe("Adequate");
    expect(d[h.indexOf("evidenceVerdict")]).toBe("");
  });
});

describe("exportFileLedgerCsvFor — Option A ledger matches the staged ledger columns", () => {
  it("produces the SAME header columns as exportFileLedgerCsv, so A and B compare directly", () => {
    const ledger = [makeFile({ bucket: "evidence", readMethod: "vision" })];
    const optionA = exportFileLedgerCsvFor(ledger, { runId: "AR-4.1-Z", startedAt: "2026-07-06T00:00:00Z", scope: "A", subCriterionId: "4.1", subCriterionTitle: "Counselling" });
    const staged = exportFileLedgerCsv(makeRun({ fileLedger: ledger }));
    expect(optionA.split("\r\n")[0]).toBe(staged.split("\r\n")[0]); // identical headers
    const h = optionA.split("\r\n")[0].split(",");
    const d = optionA.split("\r\n")[1].split(",");
    expect(d[h.indexOf("readMethod")]).toBe("vision");
    expect(d[h.indexOf("auditRunId")]).toBe("AR-4.1-Z");
  });
});

describe("buildRunLogCsv — automated-run audit trail", () => {
  const fullAuto: RunLogEntry = {
    id: "RUN-1",
    mode: "full-auto",
    subCriterionIds: ["6.2", "1.1"],
    startedAt: "2026-07-18T10:00:00Z",
    endedAt: "2026-07-18T10:05:00Z",
    status: "complete",
    perSub: [
      { subCriterionId: "6.2", path: "A", status: "done", steps: { ppdRan: true, evidenceRan: true, findingsCompiled: 3, outcomeReviewApplied: true } },
      { subCriterionId: "1.1", path: "B", status: "done" }, // Option B: no steps
    ],
    bandsSet: [{ itemId: "6.2.1", band: 3, totalPct: 50 }],
    bandsSkipped: [],
    summary: "Full audit complete.",
  };

  it("emits one row per per-sub outcome with the real step outcomes", () => {
    const csv = buildRunLogCsv([fullAuto]);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(3); // header + 2 sub-criteria
    const h = lines[0].split(",");
    const a = lines[1].split(",");
    expect(a[h.indexOf("subCriterionId")]).toBe("6.2");
    expect(a[h.indexOf("ppdRan")]).toBe("yes");
    expect(a[h.indexOf("findingsCompiled")]).toBe("3");
    // Bands joined to their sub-criterion by exact id-prefix.
    expect(a[h.indexOf("bandsForSubCriterion")]).toBe("6.2.1:B3(50%)");
  });

  it("leaves Option B step columns BLANK (no steps captured — never a fabricated 'no')", () => {
    const csv = buildRunLogCsv([fullAuto]);
    const lines = csv.split("\r\n");
    const h = lines[0].split(",");
    const b = lines[2].split(",");
    expect(b[h.indexOf("subCriterionId")]).toBe("1.1");
    expect(b[h.indexOf("ppdRan")]).toBe("");
    expect(b[h.indexOf("evidenceRan")]).toBe("");
    expect(b[h.indexOf("findingsCompiled")]).toBe("");
  });

  it("does NOT cross-attach a band from a different sub-criterion", () => {
    const csv = buildRunLogCsv([fullAuto]);
    const b = csv.split("\r\n")[2].split(","); // the 1.1 row
    const h = csv.split("\r\n")[0].split(",");
    expect(b[h.indexOf("bandsForSubCriterion")]).toBe(""); // 6.2.1 must not leak onto 1.1
  });

  it("returns a header-only CSV for an empty log", () => {
    expect(buildRunLogCsv([]).split("\r\n").length).toBe(1);
  });
});
