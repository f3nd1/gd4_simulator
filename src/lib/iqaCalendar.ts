// Importing UCC's tentative IQA calendar into the audit plan.
//
// The file is one chronological calendar holding three kinds of row, and they
// all land in the SAME session list with a `kind`, not in two stores. A
// separate programme calendar would mean re-import had to reconcile two lists,
// the ordering between them would be lost, and the workbook's plan sheet would
// have to merge them back for printing anyway.
//
// FOUR COLUMNS ARE NEVER IMPORTED AS DATA. Area title, Owning department and
// Document code are copies of the Policy and Procedure register, and "Auditor
// must be" is a copy of a rule the app already computes from the owning
// department. Importing them would be a second source of truth that drifts.
// They are read, compared against the app's own answer, and any disagreement
// is listed back rather than silently resolved either way.

import { parseCsv } from "./domainChecklist";
import { departmentForScope, departmentPair, documentsForScope } from "./departments";
import { scopeTitle } from "./evidenceScope";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { runScopesForSub } from "./evidenceScope";
import { type AuditSession, type SessionKind, sessionKind } from "./auditPlan";

// The file's columns, in order. The export writes exactly these, so a file
// exported here re-imports unchanged.
export const CALENDAR_HEADERS = [
  "Date", "Day", "Start", "End", "Duration (min)", "Activity type", "Criterion",
  "GD4 area", "Area title", "Owning department", "Document code", "Activity",
  "Focus", "Auditor must be", "Auditors", "Status",
] as const;

// Columns the app owns. The file's copies are cross-checked, never stored.
export const DERIVED_HEADERS = ["Criterion", "Area title", "Owning department", "Document code", "Auditor must be"] as const;

const VALID_SCOPES = new Set(GD4_SUB_CRITERIA.flatMap((s) => runScopesForSub(s.id)));

// An auditor list of "TBC" means nobody has been assigned yet. Kept as
// unassigned rather than imported, so the roster never gains an auditor called
// TBC who could then be picked to run a real audit.
const UNASSIGNED = /^(tbc|tba|t\.b\.c\.?|to be confirmed|-|n\/a)$/i;

export function normaliseAuditors(raw: string): string {
  const t = (raw ?? "").trim();
  return UNASSIGNED.test(t) ? "" : t;
}

export type CalendarRow = { rowNumber: number; cells: Record<string, string> };

export type Disagreement = { rowNumber: number; scopeId: string; field: string; inFile: string; inRegister: string };
export type IndependenceMismatch = { rowNumber: number; scopeId: string; inFile: string; appSays: string };
export type Rejection = { rowNumber: number; reason: string; summary: string };

export type ImportPreview = {
  create: AuditSession[];
  update: { before: AuditSession; after: AuditSession; changes: string[] }[];
  unchanged: number;
  // Sessions this app holds that CAME from an earlier import and are not in
  // this file. Listed, never silently deleted.
  removed: AuditSession[];
  // Sessions added by hand. They carry no importKey, so an import cannot touch
  // them; counted here so the number is visible rather than implied.
  keptByHand: number;
  rejected: Rejection[];
  disagreements: Disagreement[];
  independence: IndependenceMismatch[];
};

// ── Reading the file ─────────────────────────────────────────────────────

export function rowsFromGrid(grid: string[][]): { rows: CalendarRow[]; missingHeaders: string[] } {
  const head = (grid[0] ?? []).map((h) => h.trim());
  const missingHeaders = CALENDAR_HEADERS.filter((h) => !head.includes(h));
  const rows: CalendarRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells: Record<string, string> = {};
    head.forEach((h, c) => { cells[h] = (grid[i][c] ?? "").trim(); });
    // A wholly blank line is not a row that "does not fit" — it is nothing.
    if (Object.values(cells).some((v) => v !== "")) rows.push({ rowNumber: i + 1, cells });
  }
  return { rows, missingHeaders };
}

export function rowsFromCsv(text: string): { rows: CalendarRow[]; missingHeaders: string[] } {
  return rowsFromGrid(parseCsv(text));
}

// ── Identity, for re-import ──────────────────────────────────────────────
//
// Date + start + area + activity type. Re-importing the same file matches
// every row to the session it created, so nothing is ever duplicated; an
// edited file changes only the rows that changed.
export function importKeyOf(c: Record<string, string>): string {
  return [c.Date, c.Start, c["GD4 area"], c["Activity type"]].map((v) => (v ?? "").trim().toLowerCase()).join("|");
}

export function kindOf(c: Record<string, string>): SessionKind {
  if ((c["GD4 area"] ?? "").trim()) return "audit";
  return (c.Start ?? "").trim() ? "support" : "programme";
}

// ── The app's own independence answer ────────────────────────────────────
//
// Computed from the owning department, exactly as independenceNotice() does at
// run time. The file's "Auditor must be" is compared against this and never
// stored: one rule, in one place.
export function auditorMustBe(scopeId: string): string {
  const dept = departmentForScope(scopeId);
  return dept ? `Not from ${departmentPair(dept)}` : "";
}

// Does the file's wording agree with the app's rule? Compared on the
// department acronym it names rather than on the sentence, because the two are
// written differently and only the department is the claim.
export function independenceAgrees(inFile: string, scopeId: string): boolean {
  const dept = departmentForScope(scopeId);
  if (!dept) return true;
  const said = (inFile ?? "").trim();
  if (!said) return true;   // nothing claimed is not a contradiction
  return new RegExp(`\\b${dept}\\b`, "i").test(said);
}

// ── Building the preview ─────────────────────────────────────────────────

export function buildImportPreview(rows: CalendarRow[], existing: AuditSession[]): ImportPreview {
  const out: ImportPreview = {
    create: [], update: [], unchanged: 0, removed: [], keptByHand: 0,
    rejected: [], disagreements: [], independence: [],
  };
  const byKey = new Map<string, AuditSession>();
  for (const s of existing) if (s.importKey) byKey.set(s.importKey, s);
  out.keptByHand = existing.filter((s) => !s.importKey).length;

  const seen = new Set<string>();
  const matched = new Set<string>();

  for (const { rowNumber, cells } of rows) {
    const date = (cells.Date ?? "").trim();
    const scopeId = (cells["GD4 area"] ?? "").trim();
    const kind = kindOf(cells);

    if (!date) { out.rejected.push({ rowNumber, reason: "No date, so it cannot be placed in the schedule.", summary: summarise(cells) }); continue; }
    if (!isIsoDate(date)) { out.rejected.push({ rowNumber, reason: `Date "${date}" is not a YYYY-MM-DD date.`, summary: summarise(cells) }); continue; }
    if (scopeId && !VALID_SCOPES.has(scopeId)) {
      out.rejected.push({ rowNumber, reason: `"${scopeId}" is not a GD4 area in this app. The 30 areas come from the GD4 data and cannot be added by an import.`, summary: summarise(cells) });
      continue;
    }
    const key = importKeyOf(cells);
    if (seen.has(key)) {
      out.rejected.push({ rowNumber, reason: "The same date, start time, area and activity type appear earlier in this file, so this row cannot be told apart from that one.", summary: summarise(cells) });
      continue;
    }
    seen.add(key);

    if (scopeId) {
      collectDisagreements(rowNumber, scopeId, cells, out);
      if (!independenceAgrees(cells["Auditor must be"] ?? "", scopeId)) {
        out.independence.push({ rowNumber, scopeId, inFile: (cells["Auditor must be"] ?? "").trim(), appSays: auditorMustBe(scopeId) });
      }
    }

    const prior = byKey.get(key);
    const next = sessionFromRow(cells, kind, key, prior);
    if (!prior) { out.create.push(next); continue; }
    matched.add(key);
    const changes = describeChanges(prior, next);
    if (changes.length) out.update.push({ before: prior, after: next, changes });
    else out.unchanged += 1;
  }

  out.removed = [...byKey.entries()].filter(([k]) => !matched.has(k) && !out.create.some((c) => c.importKey === k)).map(([, s]) => s);
  return out;
}

function summarise(c: Record<string, string>): string {
  return [c.Date, c.Start, c["Activity type"], c["GD4 area"], c.Activity].filter(Boolean).join(" · ").slice(0, 120);
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

function collectDisagreements(rowNumber: number, scopeId: string, c: Record<string, string>, out: ImportPreview): void {
  const checks: [string, string, string][] = [
    ["Area title", (c["Area title"] ?? "").trim(), scopeTitle(scopeId)],
    ["Owning department", (c["Owning department"] ?? "").trim(), departmentPair(departmentForScope(scopeId))],
    ["Document code", (c["Document code"] ?? "").trim(), documentsForScope(scopeId).map((d) => d.code).join("; ")],
    ["Criterion", (c.Criterion ?? "").trim(), scopeId.split(".")[0]],
  ];
  for (const [field, inFile, inRegister] of checks) {
    // A blank cell is not a disagreement: the file simply did not say.
    if (!inFile) continue;
    if (!sameish(inFile, inRegister)) out.disagreements.push({ rowNumber, scopeId, field, inFile, inRegister });
  }
}

// Compared case- and punctuation-insensitively, so "Criterion 4" against "4"
// and a stray ampersand do not each report as a disagreement. Deliberately
// exact after that normalisation rather than fuzzy: a false "these agree" is
// what would hide a real difference in ownership.
function sameish(a: string, b: string): boolean {
  const n = (v: string) => v.toLowerCase().replace(/^criterion\s*/, "").replace(/[&]/g, "and").replace(/[^a-z0-9;]+/g, " ").trim();
  return n(a) === n(b);
}

function sessionFromRow(c: Record<string, string>, kind: SessionKind, key: string, prior?: AuditSession): AuditSession {
  const scopeId = (c["GD4 area"] ?? "").trim();
  return {
    // Keep the existing id on a re-import so anything pointing at the session
    // still points at it.
    id: prior?.id ?? `SESS-${key.replace(/[^a-z0-9]+/gi, "").slice(0, 10).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    day: c.Date.trim(),
    dayLabel: (c.Day ?? "").trim(),
    startTime: (c.Start ?? "").trim(),
    endTime: (c.End ?? "").trim(),
    durationMins: Number((c["Duration (min)"] ?? "").trim()) || 0,
    // The file has no auditee column. Left blank rather than assumed from the
    // owning department: an auditee is a person or function, not a department.
    auditeeFunction: prior?.auditeeFunction ?? "",
    auditorNames: normaliseAuditors(c.Auditors ?? ""),
    scopeIds: scopeId ? [scopeId] : [],
    notes: prior?.notes ?? "",
    kind,
    activityType: (c["Activity type"] ?? "").trim(),
    activity: (c.Activity ?? "").trim(),
    focus: (c.Focus ?? "").trim(),
    status: (c.Status ?? "").trim(),
    importKey: key,
  };
}

const COMPARED: [keyof AuditSession, string][] = [
  ["day", "Date"], ["dayLabel", "Day"], ["startTime", "Start"], ["endTime", "End"],
  ["durationMins", "Duration"], ["activityType", "Activity type"], ["activity", "Activity"],
  ["focus", "Focus"], ["auditorNames", "Auditors"], ["status", "Status"],
];

export function describeChanges(before: AuditSession, after: AuditSession): string[] {
  const out: string[] = [];
  for (const [field, label] of COMPARED) {
    const a = String(before[field] ?? ""), b = String(after[field] ?? "");
    if (a !== b) out.push(`${label}: ${a || "(blank)"} → ${b || "(blank)"}`);
  }
  const sa = (before.scopeIds ?? []).join(";"), sb = (after.scopeIds ?? []).join(";");
  if (sa !== sb) out.push(`GD4 area: ${sa || "(none)"} → ${sb || "(none)"}`);
  return out;
}

// Applying a confirmed preview. Hand-added sessions pass through untouched;
// sessions from an earlier import that are no longer in the file are dropped,
// which is what the preview listed them for.
export function applyImportPreview(existing: AuditSession[], p: ImportPreview): AuditSession[] {
  const updated = new Map(p.update.map((u) => [u.before.id, u.after]));
  const removed = new Set(p.removed.map((s) => s.id));
  const kept = existing.filter((s) => !removed.has(s.id)).map((s) => updated.get(s.id) ?? s);
  return [...kept, ...p.create];
}

// ── Exporting back out, in exactly the same columns ──────────────────────
//
// The five app-owned columns are written from the register and the
// independence rule, never from whatever the file said, so an export always
// states the app's own answer.
export function calendarRowsOut(sessions: AuditSession[]): string[][] {
  return sessions.map((s) => {
    const scopeId = s.scopeIds?.[0] ?? "";
    const dept = scopeId ? departmentForScope(scopeId) : "";
    return [
      s.day ?? "",
      s.dayLabel ?? "",
      s.startTime ?? "",
      s.endTime ?? "",
      s.durationMins ? String(s.durationMins) : "",
      s.activityType ?? "",
      scopeId ? scopeId.split(".")[0] : "",
      scopeId,
      scopeId ? scopeTitle(scopeId) : "",
      dept ? departmentPair(dept) : "",
      scopeId ? documentsForScope(scopeId).map((d) => d.code).join("; ") : "",
      s.activity ?? "",
      s.focus ?? "",
      scopeId ? auditorMustBe(scopeId) : "",
      s.auditorNames ?? "",
      s.status ?? "",
    ];
  });
}

export function countsByKind(sessions: AuditSession[]): Record<SessionKind, number> {
  const out: Record<SessionKind, number> = { audit: 0, support: 0, programme: 0 };
  for (const s of sessions) out[sessionKind(s)] += 1;
  return out;
}
