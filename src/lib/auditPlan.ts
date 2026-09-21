// The audit plan and schedule — the one part of UCC's internal audit set that
// had no equivalent anywhere in this app.
//
// Everything else the three-document set needs already exists: the GD4
// requirements, the Audit Checklist Library, expected evidence, the auditor
// roster, the departments directory, the findings register with its NC/OFI/OBS
// types, and now the Policy and Procedure register. What was missing was the
// timed schedule: which session, on which day, with which auditee, covering
// which GD4 areas.
//
// This models only that. Nothing here reaches the engine, a verdict or a band.

import { departmentForScope, documentsForScope } from "./departments";
import { scopeTitle } from "./evidenceScope";

// The plan's header block, mirroring the ISO 9001 / 27001 workbook UCC already
// uses. Dates, scope and the cycle owner live on AuditCycle and are NOT copied
// here — this holds only the fields that had no home.
export type AuditPlanHeader = {
  organisation: string;
  leadAuditor: string;
  auditHours: string;
  exclusions: string;
  // Free text: an internal audit plan often carries a line about distribution
  // or the opening meeting that belongs nowhere else.
  notes: string;
};

export const EMPTY_PLAN_HEADER: AuditPlanHeader = {
  organisation: "United Ceres College",
  leadAuditor: "",
  auditHours: "",
  exclusions: "",
  notes: "",
};

// One timed session. `scopeIds` are GD4 run scopes, so the areas, requirement
// references, owning department and controlled documents are all derived from
// the one source rather than typed again per audit.
// What a row in the calendar actually is. Derived from what the row CONTAINS,
// not from its Activity type text, which is the file's own vocabulary and will
// change: an area makes it an audit, a time with no area makes it a supporting
// slot (opening meeting, lunch, wrap-up), neither makes it a whole programme
// day (self-check, PPD revisions, CAP rectification, buffer).
export type SessionKind = "audit" | "support" | "programme";

export type AuditSession = {
  id: string;
  day: string;          // ISO date
  startTime: string;    // "09:00"
  durationMins: number;
  auditeeFunction: string;
  auditorNames: string;
  scopeIds: string[];
  notes: string;
  // ── Everything below arrived with the IQA calendar import. All optional, so
  // a session added by hand before this existed keeps working untouched and no
  // store migration is needed.
  kind?: SessionKind;
  dayLabel?: string;    // the file's own Day cell, kept verbatim so it round-trips
  endTime?: string;     // the file's End cell; not recomputed from the duration
  activityType?: string;
  activity?: string;
  focus?: string;
  // "Tentative" and the like, kept verbatim and shown, so a tentative plan
  // never reads as confirmed.
  status?: string;
  // Identity for re-import. Absent on a session added by hand, which is what
  // stops an import ever touching one.
  importKey?: string;
};

// Total over a session written before kind existed, and over one added by hand.
export function sessionKind(s: AuditSession): SessionKind {
  if (s.kind) return s.kind;
  if (s.scopeIds?.length) return "audit";
  return s.startTime ? "support" : "programme";
}

export function emptySession(): AuditSession {
  return { id: `SESS-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`, day: "", startTime: "", durationMins: 60, auditeeFunction: "", auditorNames: "", scopeIds: [], notes: "", kind: "audit" };
}

// Sessions in the order they actually run. Sessions with no day or time sort
// last rather than to the top, so a half-filled plan does not claim the first
// slot of the first morning.
export function sortedSessions(sessions: AuditSession[]): AuditSession[] {
  return [...sessions].sort((a, b) => {
    const ka = `${a.day || "9999"}${a.startTime || "99:99"}`;
    const kb = `${b.day || "9999"}${b.startTime || "99:99"}`;
    return ka.localeCompare(kb);
  });
}

// "09:00-10:30". Blank when there is no start time: a duration with no start
// is not a slot.
export function sessionSlot(s: AuditSession): string {
  if (!s.startTime) return "";
  // The file gives an End time of its own. Prefer it over recomputing from the
  // duration: where the two disagree the file is the plan of record, and
  // silently printing a different end time would be this app inventing one.
  if (s.endTime) return `${s.startTime}-${s.endTime}`;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.startTime);
  if (!m || !s.durationMins) return s.startTime;
  const end = Number(m[1]) * 60 + Number(m[2]) + s.durationMins;
  const hh = String(Math.floor(end / 60) % 24).padStart(2, "0");
  const mm = String(end % 60).padStart(2, "0");
  return `${s.startTime}-${hh}:${mm}`;
}

// Day 1, Day 2 … by distinct date in schedule order, so the checklist and the
// findings log can carry the same day number the plan shows.
export function dayNumbers(sessions: AuditSession[]): Map<string, number> {
  const days = [...new Set(sortedSessions(sessions).map((s) => s.day).filter(Boolean))];
  return new Map(days.map((d, i) => [d, i + 1]));
}

// Everything a session covers, resolved from its scope ids: the GD4 areas, the
// owning departments and the controlled documents. Derived, never typed.
export type SessionScopeDetail = {
  scopeId: string;
  title: string;
  department: string;
  documentCodes: string[];
};

export function sessionScopes(s: AuditSession): SessionScopeDetail[] {
  return (s.scopeIds ?? []).map((scopeId) => ({
    scopeId,
    title: scopeTitle(scopeId),
    department: departmentForScope(scopeId),
    documentCodes: documentsForScope(scopeId).map((d) => d.code),
  }));
}

// A session with no scopes audits nothing. Advisory, like every other check in
// this app: it is surfaced, it never blocks saving a plan mid-draft.
export function planWarnings(header: AuditPlanHeader, sessions: AuditSession[]): string[] {
  const out: string[] = [];
  if (!header.leadAuditor.trim()) out.push("No lead auditor named.");
  if (!sessions.length) out.push("The schedule has no sessions yet.");
  const empty = sessions.filter((s) => sessionKind(s) === "audit" && !s.scopeIds?.length).length;
  if (empty) out.push(`${empty} session${empty === 1 ? " covers" : "s cover"} no GD4 area, so nothing would be checked in ${empty === 1 ? "it" : "them"}.`);
  const undated = sessions.filter((s) => !s.day).length;
  if (undated) out.push(`${undated} session${undated === 1 ? " has" : "s have"} no date.`);
  const covered = new Set(sessions.flatMap((s) => s.scopeIds ?? []));
  const dupes = countDuplicateScopes(sessions);
  if (dupes.length) out.push(`Covered in more than one session: ${dupes.join(", ")}.`);
  if (covered.size) out.push(`${covered.size} GD4 area${covered.size === 1 ? "" : "s"} scheduled.`);
  return out;
}

function countDuplicateScopes(sessions: AuditSession[]): string[] {
  const seen = new Map<string, number>();
  for (const s of sessions) for (const id of s.scopeIds ?? []) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}
