// NC / OFI / OBS classification for findings raised from a checklist line.
// Kept separate from the pre-existing FindingType/Severity fields (see the
// comment on FindingTypeCode/NcSeverity in types/index.ts) — this is purely
// a display/categorisation concern layered on top, not audit scoring.
import type { ApsrBreakdown, Finding, FindingTypeCode, NcSeverity } from "../types";

// Status -> finding type: Not met is a nonconformity, Partial is an
// opportunity for improvement, Met is a positive observation.
export function findingTypeForStatus(status: "Met" | "Partial" | "Not met"): FindingTypeCode {
  if (status === "Not met") return "NC";
  if (status === "Partial") return "OFI";
  return "OBS";
}

// NC severity: Major when the sub-criterion is gate-sensitive (4.2, 4.6,
// Criterion 5) OR the Approach dimension is weak/absent (a documented
// approach gates the whole line under the APSR rubric); Minor otherwise.
// OFI and OBS never carry a severity.
export function ncSeverityFor(
  findingType: FindingTypeCode,
  opts: { gateSensitive: boolean; approachStatus?: ApsrBreakdown["approach"]["status"] }
): NcSeverity | null {
  if (findingType !== "NC") return null;
  if (opts.gateSensitive) return "Major";
  if (opts.approachStatus === "Not evident" || opts.approachStatus === "Beginning") return "Major";
  return "Minor";
}

// Resolves a finding's type for display, defaulting findings raised before
// this classification existed to "NC" (the pre-existing behaviour — every
// checklist-raised finding used to represent an unmet requirement).
export function resolveFindingType(f: Finding): FindingTypeCode {
  return f.findingType ?? "NC";
}

// Resolves a finding's NC severity for display: "Minor" for an NC finding
// with no severity recorded yet (pre-migration default), null for OFI/OBS.
export function resolveNcSeverity(f: Finding): NcSeverity | null {
  if (resolveFindingType(f) !== "NC") return null;
  return f.ncSeverity ?? "Minor";
}

// A finding is overdue when it carries a due date in the past AND is not yet
// closed. Finding.overdue was historically hardcoded `false` at every creation
// site (so it could never become true); compute it live from the due date
// instead. `closed` = the closure has been accepted. `now` is injectable for
// tests; defaults to the current time.
export function isFindingOverdue(dueDate: string | undefined, closed: boolean, now: number = Date.now()): boolean {
  if (closed || !dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59`).getTime(); // due end-of-day, local
  if (Number.isNaN(due)) return false;
  return due < now;
}

export function findingTypeTone(t: FindingTypeCode): "critical" | "medium" | "good" {
  return t === "NC" ? "critical" : t === "OFI" ? "medium" : "good";
}

export function ncSeverityTone(s: NcSeverity): "critical" | "high" {
  return s === "Major" ? "critical" : "high";
}
