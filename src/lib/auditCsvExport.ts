import type { AuditRunRecord, AuditFileRecord, AuditAISummaryLine } from "../types";

// Escapes a single CSV cell: wraps in double-quotes when the value contains
// commas, quotes or line breaks; escapes inner double-quotes by doubling them.
export function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

// Triggers a browser file-save of the given CSV text.
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns a filesystem-safe filename for audit CSV exports.
// Example: "gd4-audit-file-ledger-4.5-both-2026-06-29.csv"
export function auditCsvFilename(
  prefix: string,
  run: { subCriterionId: string; scope: string; startedAt: string }
): string {
  const date = run.startedAt ? run.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9.\-_]/g, "-");
  return `${safe(prefix)}-${safe(run.subCriterionId)}-${safe(run.scope)}-${date}.csv`;
}

// Exports the per-file evidence ledger from an audit run as a CSV string.
export function exportFileLedgerCsv(run: AuditRunRecord): string {
  const headers = [
    "auditRunId", "auditDateTime", "auditScope",
    "subCriterionId", "subCriterionTitle",
    "fileId", "fileName", "fileType", "mimeType",
    "googleDriveModifiedTime", "bucket",
    "readStatus", "auditStatus", "processingMode",
    "cited", "citedByLineIds",
    "usedForApproach", "usedForProcesses", "usedForSystemsOutcomes", "usedForReview",
    "charCount", "summaryCharCount",
    "suspectedScannedPdf", "extractedTextQuality",
    "skipReason", "failReason", "chunkIds",
  ];

  const rows = run.fileLedger.map((f: AuditFileRecord) => [
    run.runId,
    run.startedAt,
    run.scope,
    run.subCriterionId,
    run.subCriterionTitle,
    f.driveFileId ?? "",
    f.name,
    f.fileKind,
    f.mimeType,
    f.driveModifiedTime ?? "",
    f.bucket,
    f.readStatus,
    f.auditStatus,
    f.processingMode ?? "new",
    f.auditStatus === "cited" ? "yes" : "no",
    (f.citedByLineIds ?? []).join("; "),
    f.usedForDimensions?.approach ? "yes" : "no",
    f.usedForDimensions?.processes ? "yes" : "no",
    f.usedForDimensions?.systemsOutcomes ? "yes" : "no",
    f.usedForDimensions?.review ? "yes" : "no",
    f.charCount ?? "",
    f.summaryCharCount ?? "",
    f.suspectedScannedPdf ? "yes" : "no",
    f.extractedTextQuality ?? "",
    f.skipReason ?? "",
    f.failReason ?? "",
    (f.chunkIds ?? []).join("; "),
  ]);

  return toCsv(headers, rows);
}

// Exports the per-checklist-line AI audit summary from an audit run as a CSV string.
export function exportAISummaryCsv(run: AuditRunRecord): string {
  const headers = [
    "auditRunId", "auditScope", "subCriterionId",
    "checklistLineId", "sourceRef", "checklistText",
    "result",
    "approachStatus", "processesStatus", "systemsOutcomesStatus", "reviewStatus",
    "citedChunkIds", "citedFileNames",
    "overallReason", "warning",
  ];

  const rows = run.aiSummary.map((l: AuditAISummaryLine) => [
    run.runId,
    run.scope,
    run.subCriterionId,
    l.lineId,
    l.sourceRef ?? "",
    l.lineText,
    l.result,
    l.approachStatus,
    l.processesStatus,
    l.systemsOutcomesStatus,
    l.reviewStatus,
    l.citedChunkIds.join("; "),
    l.citedFileNames.join("; "),
    l.overallReason ?? "",
    l.warning ?? "",
  ]);

  return toCsv(headers, rows);
}

// Builds a minimal AuditRunRecord from live AuditProgressState for CSV export
// during or immediately after a run (before the full record is persisted).
export function progressToRunRecord(p: {
  folderId: string;
  subCriterionId: string;
  folderName: string;
  scope?: string;
  stage: string;
  startedAt?: number;
  auditLive?: boolean;
  aiModel?: string;
  filesFound?: AuditFileRecord[];
  verdictLines?: AuditAISummaryLine[];
  linesAssessed?: number;
  findingsDetected?: number;
  batchTotal?: number;
  chunksCount?: number;
  errorMessage?: string;
  folderWarnings?: string[];
}): AuditRunRecord {
  return {
    runId: p.subCriterionId + "-" + (p.startedAt ?? Date.now()).toString(36),
    folderId: p.folderId,
    subCriterionId: p.subCriterionId,
    subCriterionTitle: p.folderName,
    scope: (p.scope ?? "both") as AuditRunRecord["scope"],
    status: p.stage === "complete" ? "completed" : p.stage === "error" ? "failed" : "cancelled",
    startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : new Date().toISOString(),
    endedAt: new Date().toISOString(),
    auditLive: p.auditLive ?? false,
    aiModel: p.aiModel,
    fileLedger: p.filesFound ?? [],
    aiSummary: p.verdictLines ?? [],
    linesAssessed: p.linesAssessed ?? 0,
    findingsDetected: p.findingsDetected ?? 0,
    batchCount: p.batchTotal ?? 0,
    chunkCount: p.chunksCount ?? 0,
    errorMessage: p.errorMessage,
    folderWarnings: p.folderWarnings,
  };
}

// ── Findings register CSV ────────────────────────────────────────────────────
// Full-fidelity export: classification as shown on screen, PLUS the audit
// trail (source, run id, created) and the closure narrative — an exported
// register must be able to stand alone as a CAR tracking sheet.
import type { Finding } from "../types";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";

export type FindingClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted" };

export function buildFindingsRegisterCsv(
  findings: Finding[],
  closures: Record<string, FindingClosureLite>
): string {
  const headers = [
    "ID", "GD4 item", "Issue", "Type", "NC severity", "Risk category",
    "Owner", "Due date", "Status", "Source", "Audit run", "Created at",
    "Root cause", "Corrective action", "Preventive action", "Closure evidence",
  ];
  const rows = findings.map((f) => {
    const c = closures[f.id] ?? {};
    return [
      f.id,
      f.gd4ItemId,
      f.issue,
      resolveFindingType(f),
      resolveNcSeverity(f) ?? "",
      f.riskCategory ?? "",
      f.owner,
      f.dueDate,
      c.human === "Accepted" ? "Closed" : "Open",
      f.source ?? "",
      f.auditRunId ?? f.createdFromAuditRunId ?? "",
      f.createdAt ?? "",
      c.root ?? f.rootCause ?? "",
      c.corr ?? f.corrective ?? "",
      c.prev ?? f.preventive ?? "",
      c.evid ?? "",
    ];
  });
  return toCsv(headers, rows);
}
