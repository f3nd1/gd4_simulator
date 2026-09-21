// The internal audit set as ONE workbook with three sheets, matching the
// format of the ISO 9001 / 27001 workbook UCC already runs its audits from.
//
// One file rather than three CSVs because the three parts cross-reference each
// other by session number. Exported separately they drift the moment one is
// re-exported and another is not, and the reader has to reassemble them.
//
// The existing CSV exports are untouched and stay the round-trip format: the
// Audit Checklist Library's CSV imports straight back into the app, and this
// workbook deliberately does not.
//
// `xlsx` is already a direct dependency (it reads Drive spreadsheets and
// uploads), so nothing new is pulled in to write one.

import * as XLSX from "xlsx";
import type { Finding, AuditCycle, AuditorProfile, Department } from "../types";
import {
  type AuditPlanHeader, type AuditSession,
  sortedSessions, sessionSlot, dayNumbers, sessionScopes,
} from "./auditPlan";
import { departmentPair, documentStamp, scopeDocumentViews } from "./departments";
import { acknowledgementState, acknowledgementSummary, shortDate } from "./findingAcknowledgement";
import { resolveFindingType, resolveNcSeverity, isFindingClosed, type ClosureLike } from "./findingClassification";
import { buildRequirementRows } from "./requirementsReference";
import { scopeTitle, scopeIdForItem } from "./evidenceScope";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";

export const SHEET_NAMES = ["Audit plan", "Checklist", "Findings log"] as const;

// The status an auditor ticks on the checklist during the audit. Deliberately
// NOT the app's Met / Partial / Not met: "sighted" is about whether the
// document was produced, which is a different question from whether it
// satisfies the requirement, and collapsing the two would let a produced-but-
// inadequate document read as a pass.
export const CHECKLIST_STATUS_OPTIONS = "Sighted / Partly / Not provided / Not applicable";

export type WorkbookInput = {
  cycle: AuditCycle;
  header: AuditPlanHeader;
  sessions: AuditSession[];
  auditors: AuditorProfile[];
  departments: Department[];
  findings: Finding[];
  closures: Record<string, ClosureLike>;
  policyDocEdits: Record<string, { version?: string; updatedAt?: string }>;
  generatedAt?: Date;
};

type Row = (string | number)[];

const divisionOf = (departments: Department[]) => (a: string) => departments.find((d) => d.acronym === a)?.divisionId;

// ── Sheet 1: plan header block, then the timed schedule ──────────────────
export function planSheetRows(i: WorkbookInput): Row[] {
  const div = divisionOf(i.departments);
  const rows: Row[] = [
    ["EduTrust GD4 internal audit plan and schedule"],
    ["Internal audit working paper. Not an SSG or EduTrust submission."],
    [],
    ["Organisation", i.header.organisation],
    ["Audit cycle", i.cycle.name],
    ["Audit type", i.cycle.type],
    ["Scope", i.cycle.scope],
    ["Period", [i.cycle.periodStart, i.cycle.periodEnd].filter(Boolean).join(" to ")],
    ["Evidence cut-off", i.cycle.evidenceCutOffDate],
    ["Lead auditor", i.header.leadAuditor],
    ["Auditors", i.auditors.map((a) => `${a.name}${a.departmentId ? ` (${departmentPair(a.departmentId, div)})` : ""}`).join("; ")],
    ["Audit hours", i.header.auditHours],
    ["Exclusions", i.header.exclusions],
    ["Notes", i.header.notes],
    [],
    ["Department key"],
    ["Acronym", "With division", "Full name", "Person in charge"],
    ...i.departments.map((d): Row => [d.acronym, departmentPair(d.acronym, div), d.fullName, d.personInCharge]),
    [],
    ["Schedule"],
    ["Day", "Date", "Session", "Time", "Mins", "Auditee function", "Areas to audit", "Requirement refs", "Department", "Controlled documents", "Auditors", "Expected records and evidence"],
  ];

  const days = dayNumbers(i.sessions);
  sortedSessions(i.sessions).forEach((s, idx) => {
    const scopes = sessionScopes(s);
    rows.push([
      s.day ? `Day ${days.get(s.day)}` : "",
      s.day,
      idx + 1,
      sessionSlot(s),
      s.durationMins || "",
      s.auditeeFunction,
      scopes.map((x) => `${x.scopeId} ${x.title}`).join("; "),
      // Real requirement references from the GD4 data, not typed per audit.
      scopes.flatMap((x) => buildRequirementRows(x.scopeId).map((r) => r.ref)).join("; "),
      [...new Set(scopes.map((x) => departmentPair(x.department, div)))].filter(Boolean).join("; "),
      scopes.flatMap((x) => documentLabels(x.scopeId, i.policyDocEdits)).join("; "),
      s.auditorNames,
      scopes.flatMap((x) => expectedEvidenceFor(x.scopeId)).join("; "),
    ]);
  });
  return rows;
}

function documentLabels(scopeId: string, edits: WorkbookInput["policyDocEdits"]): string[] {
  return scopeDocumentViews(scopeId, edits).map((d) => {
    const stamp = documentStamp(d);
    return stamp ? `${d.code} (${stamp})` : d.code;
  });
}

function expectedEvidenceFor(scopeId: string): string[] {
  return buildRequirementRows(scopeId)
    .filter((r) => r.section.startsWith("Expected evidence"))
    .map((r) => r.text);
}

// ── Sheet 2: one row per requirement line to request or check ────────────
//
// Built from the SAME buildRequirementRows() the Official requirements view
// uses, so the checklist cannot say the requirement differently from the rest
// of the app. The verdict columns are left blank for the auditor to fill in on
// the day; nothing in this sheet carries an AI verdict.
export function checklistSheetRows(i: WorkbookInput): Row[] {
  const div = divisionOf(i.departments);
  const days = dayNumbers(i.sessions);
  const rows: Row[] = [
    ["EduTrust GD4 internal audit checklist"],
    [`Status options: ${CHECKLIST_STATUS_OPTIONS}. Filled in during the audit; nothing here is pre-judged.`],
    [],
    ["Day", "Session", "Auditee", "GD4 area", "Item", "Requirement ref", "Section", "Item to request or check", "Controlled document", "Department", "Status", "Audit notes", "Remarks"],
  ];

  sortedSessions(i.sessions).forEach((s, idx) => {
    for (const scope of sessionScopes(s)) {
      const docs = documentLabels(scope.scopeId, i.policyDocEdits).join("; ");
      const dept = departmentPair(scope.department, div);
      for (const r of buildRequirementRows(scope.scopeId)) {
        rows.push([
          s.day ? `Day ${days.get(s.day)}` : "",
          idx + 1,
          s.auditeeFunction,
          `${scope.scopeId} ${scope.title}`,
          r.itemId,
          r.ref,
          r.section,
          r.text,
          docs,
          dept,
          "",  // Status — the auditor's, on the day
          "",  // Audit notes
          "",  // Remarks
        ]);
      }
    }
  });
  return rows;
}

// ── Sheet 3: the findings log ────────────────────────────────────────────
//
// Carries NO "Official / Unofficial" column. It carries acknowledgement
// instead: who at the auditee accepted the finding, when, what was agreed and
// by when. An acknowledged nonconformity is still printed as a nonconformity.
//
// "Raised by" prints the auditor for a human finding and says plainly that the
// AI raised the others, so a reader can never mistake an AI verdict for an
// auditor's observation.
export function findingsSheetRows(i: WorkbookInput): Row[] {
  const days = dayNumbers(i.sessions);
  const sessions = sortedSessions(i.sessions);
  const rows: Row[] = [
    ["EduTrust GD4 internal audit findings log"],
    ["Acknowledgement records that the auditee accepted a finding and what was agreed. It never changes the finding: a nonconformity stays a nonconformity."],
    [],
    ["No.", "Day", "Session", "Requirement ref", "GD4 area", "Type", "Severity", "Description", "Objective evidence", "Raised by", "Acknowledged by", "Date acknowledged", "Agreed action", "Agreed due", "Status"],
  ];

  i.findings.forEach((f, idx) => {
    // The finding's GD4 area, resolved with the app's own item->scope
    // function. Never by truncating the id: criterion 2's sub-criteria are
    // three-part, so "2.1" matches nothing and silently yields an empty area.
    const scopeId = scopeOfFinding(f);
    const where = sessions.findIndex((s) => (s.scopeIds ?? []).includes(scopeId));
    const s = where >= 0 ? sessions[where] : undefined;
    const type = resolveFindingType(f);
    const sev = resolveNcSeverity(f);
    rows.push([
      idx + 1,
      s?.day ? `Day ${days.get(s.day)}` : "",
      where >= 0 ? where + 1 : "",
      f.clause || f.gd4ItemId,
      scopeId ? `${scopeId} ${scopeTitle(scopeId)}` : "",
      type ?? "",
      sev ?? "",
      f.observation || f.issue,
      f.evidenceReference || "",
      raisedByLabel(f),
      f.acknowledgedBy || "",
      f.acknowledgedAt ? shortDate(f.acknowledgedAt) : "",
      f.agreedAction || "",
      f.agreedDueDate ? shortDate(f.agreedDueDate) : "",
      statusLabel(f, i.closures),
    ]);
  });
  return rows;
}

// The finding's GD4 area, resolved with the app's own item->scope function.
// Never by truncating the id: criterion 2's sub-criteria are three-part, so
// "2.1" matches nothing and would silently print an empty area.
function scopeOfFinding(f: Finding): string {
  const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
  return req ? scopeIdForItem(req.id, req.subCriterionId) : "";
}

export function raisedByLabel(f: Finding): string {
  if (f.raisedBy?.auditorName) return f.raisedBy.auditorName;
  // No auditor on the record. Say which machine path produced it rather than
  // leaving a blank a reader could fill in with an assumption.
  return f.source === "Manual" ? "Auditor (not named)" : "AI audit (not an auditor observation)";
}

function statusLabel(f: Finding, closures: Record<string, ClosureLike>): string {
  if (isFindingClosed(f, closures)) return "Closed";
  if (acknowledgementState(f) !== "acknowledged") return "Open, not acknowledged";
  // Lower-case only the leading "Acknowledged", never the whole summary: it
  // carries a person's name, and "R. Tan" must not print as "r. tan".
  return `Open, a${acknowledgementSummary(f).slice(1)}`;
}

// ── The workbook ─────────────────────────────────────────────────────────
export function buildAuditWorkbook(i: WorkbookInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const sheets: Row[][] = [planSheetRows(i), checklistSheetRows(i), findingsSheetRows(i)];
  SHEET_NAMES.forEach((name, n) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), name));
  return wb;
}

export function workbookFileName(cycle: AuditCycle, at: Date = new Date()): string {
  const safe = (cycle.name || "GD4").replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `GD4_Internal_Audit_${safe}_${at.toISOString().slice(0, 10)}.xlsx`;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function workbookBytes(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
