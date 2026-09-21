// The GD4 IQA workbook, built to the approved
// GD4_IQA_2026_Workbook_DRAFT.xlsx: five styled sheets with dropdowns,
// conditional formatting and the RPN formula.
//
// Built with ExcelJS, not the `xlsx` package already in the project. That was
// not a preference: SheetJS's community build silently DROPS cell styles on
// write, and writes no data validation or conditional formatting at all. I
// wrote a bold navy-filled cell with it and read the file back: bold false,
// colour gone, fill gone. The approved file is a specification of colours,
// dropdowns and conditional formats, so it cannot be produced with it.
// ExcelJS is imported dynamically so its weight only loads when someone asks
// for the workbook.
//
// The CSV round-trip export is untouched: this replaces only the workbook.

import type { Finding, AuditCycle, AuditorProfile, Department } from "../types";
import { ASSIGNMENT_GROUPS, type AreaAssignment } from "../data/areaAssignments";
import { type AuditPlanHeader, type AuditSession, sortedSessions, sessionKind } from "./auditPlan";
import { departmentPair, departmentForScope, documentsForScope, scopeDocumentViews, documentStamp } from "./departments";
import { buildRequirementRows } from "./requirementsReference";
import { scopeTitle, runScopesForSub, scopeIdForItem } from "./evidenceScope";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { independenceStatus } from "./auditorGuard";
import { resolveFindingType, resolveNcSeverity, isFindingClosed, type ClosureLike } from "./findingClassification";
import { acknowledgementState } from "./findingAcknowledgement";
import { C, FONT, DROPDOWN, LEGEND_CHECKLIST, LEGEND_FINDINGS, programmeFill, isAuditDayType, rpnFormula } from "./workbookStyle";

export const SHEETS = ["Audit Details", "Programme", "Audit Schedule", "Audit Checklist", "Findings Log"] as const;

export type WorkbookData = {
  cycle: AuditCycle;
  header: AuditPlanHeader;
  sessions: AuditSession[];
  auditors: AuditorProfile[];
  departments: Department[];
  assignments: Record<string, AreaAssignment>;
  findings: Finding[];
  closures: Record<string, ClosureLike>;
  policyDocEdits: Record<string, { version?: string; updatedAt?: string }>;
};

// ── Shared helpers ───────────────────────────────────────────────────────

const ALL_SCOPES = GD4_SUB_CRITERIA.flatMap((s) => runScopesForSub(s.id));

function nameOf(auditors: AuditorProfile[], id: string | undefined): string {
  return auditors.find((a) => a.id === id)?.name ?? "";
}

function auditorNames(auditors: AuditorProfile[], ids: string[] | undefined): string {
  return (ids ?? []).map((id) => nameOf(auditors, id)).filter(Boolean).join(", ");
}

// The Finding Type as the approved file spells it. A nonconformity with no
// severity recorded exports as "Min NC", matching what the app already
// believes: resolveNcSeverity() returns Minor for a bare NC, so exporting a
// bare "NC" would make the workbook and the app disagree about the same
// finding. The legend says so on both sheets.
export function findingTypeCell(f: Finding): string {
  const t = resolveFindingType(f);
  if (t !== "NC") return t ?? "";
  return resolveNcSeverity(f) === "Major" ? "Maj NC" : "Min NC";
}

export function findingStatusCell(f: Finding, closures: Record<string, ClosureLike>): string {
  if (isFindingClosed(f, closures)) return "Resolved";
  return acknowledgementState(f) === "acknowledged" ? "In Progress" : "Open";
}

// The area's independence answer, as a three-way status so a printed working
// paper never claims independence it cannot show.
export function areaIndependence(
  scopeId: string, assignments: Record<string, AreaAssignment>, auditors: AuditorProfile[],
): { status: "conflict" | "independent" | "unknown"; text: string } {
  const owner = departmentForScope(scopeId);
  const ids = assignments[scopeId]?.auditorIds ?? [];
  if (!ids.length) return { status: "unknown", text: "Cannot check: no auditors assigned" };
  const each = ids.map((id) => {
    const a = auditors.find((x) => x.id === id);
    return { name: a?.name ?? id, s: independenceStatus(a?.departmentId, owner) };
  });
  const conflicts = each.filter((e) => e.s === "conflict");
  if (conflicts.length) return { status: "conflict", text: `Conflict: ${conflicts.map((e) => e.name).join(", ")} from ${departmentPair(owner)}` };
  if (each.some((e) => e.s === "unknown")) {
    const who = each.filter((e) => e.s === "unknown").map((e) => e.name).join(", ");
    return { status: "unknown", text: `Cannot check: department not recorded for ${who}` };
  }
  return { status: "independent", text: `Independent of ${departmentPair(owner)}` };
}

function expectedEvidence(scopeId: string): string {
  return buildRequirementRows(scopeId)
    .filter((r) => r.section.startsWith("Expected evidence"))
    .map((r) => `• ${r.text}`)
    .join("\n");
}

function requirementRefs(scopeId: string): string {
  return buildRequirementRows(scopeId).map((r) => r.ref).join(", ");
}

function docLabel(scopeId: string, edits: WorkbookData["policyDocEdits"]): string {
  return scopeDocumentViews(scopeId, edits)
    .map((d) => (documentStamp(d) ? `${d.code} (${documentStamp(d)})` : d.code))
    .join("\n");
}

// A date as the approved file writes it: "Thu 01 Oct 2026". Falls back to the
// raw value rather than printing "Invalid Date".
export function longDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  // "Thu 01 Oct 2026". en-GB puts a comma after the weekday; the approved
  // file does not.
  return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", "");
}

export function timeRange(s: AuditSession): string {
  if (!s.startTime) return "";
  const strip = (t: string) => t.replace(":", "");
  return s.endTime ? `${strip(s.startTime)} – ${strip(s.endTime)}` : strip(s.startTime);
}

// One row per DATE for the Programme sheet, in order. The activity type is the
// day's own; a day with several takes the first, which is how the approved file
// reads.
export type ProgrammeDay = { date: string; activityType: string; criterion: string; activity: string; focus: string; status: string };

export function programmeDays(sessions: AuditSession[]): ProgrammeDay[] {
  const out: ProgrammeDay[] = [];
  const seen = new Set<string>();
  for (const s of sortedSessions(sessions)) {
    if (!s.day || seen.has(s.day)) continue;
    seen.add(s.day);
    const sameDay = sessions.filter((x) => x.day === s.day);
    // A whole-day row names its own day. An audit day has none, and taking the
    // first timed session's wording printed "Opening meeting" as the whole
    // day's activity. The approved file names an audit day by its criterion
    // and the areas it covers, which is what a programme reader needs.
    const whole = sameDay.find((x) => sessionKind(x) === "programme");
    const criterion = sameDay.map((x) => x.criterionLabel).find(Boolean) ?? "";
    const areas = [...new Set(sameDay.flatMap((x) => x.scopeIds ?? []))];
    out.push({
      date: s.day,
      activityType: (whole ?? s).activityType ?? "",
      criterion: criterion || "–",
      activity: whole?.activity ?? (criterion ? `IQA ${criterion}` : (s.activity ?? "")),
      focus: whole?.focus ?? (areas.length ? `Areas ${areas.join(", ")}` : (s.focus ?? "")),
      status: (whole ?? s).status ?? "",
    });
  }
  return out;
}

// The days that belong on the Audit Schedule, with their sessions.
export function auditDays(sessions: AuditSession[]): { date: string; label: string; sessions: AuditSession[] }[] {
  const out: { date: string; label: string; sessions: AuditSession[] }[] = [];
  for (const s of sortedSessions(sessions)) {
    if (!s.day || !s.startTime || !isAuditDayType(s.activityType ?? "")) continue;
    let day = out.find((d) => d.date === s.day);
    if (!day) {
      const lead = sessions.find((x) => x.day === s.day && x.activity) ?? s;
      day = { date: s.day, label: `${longDate(s.day)}   ·   ${lead.activity ?? ""}   ·   ${s.activityType ?? ""}`, sessions: [] };
      out.push(day);
    }
    day.sessions.push(s);
  }
  return out;
}

// Findings that trace to one requirement ref. A line may carry none, one or
// several: the grouped-finding path deliberately consolidates several failing
// lines into one finding, so many-to-many is normal.
export function findingsForRef(findings: Finding[], ref: string): Finding[] {
  const norm = (v: string) => (v || "").trim().toUpperCase();
  const target = norm(ref);
  return findings.filter((f) => norm(f.clause ?? "") === target || (f.linkedSourceRefs ?? []).some((r) => norm(r) === target));
}

// What the checklist's finding columns show for a requirement line.
//
// None, one, or a pointer. When more than one finding traces to a line the row
// must NOT pick one: it names the count and the ids and leaves S, L and RPN
// empty, because an RPN for "one of two findings" is a number meaning nothing.
// The Findings Log is the record; this is a view of it that always names its
// source so the two can never contradict each other.
export type ChecklistFindingCells = {
  findingType: string; finding: string; corrective: string; preventive: string; afi: string;
  severity: number | ""; likelihood: number | ""; single: boolean;
};

export function checklistFindingCells(
  findings: Finding[], ref: string, closures: Record<string, ClosureLike>,
): ChecklistFindingCells {
  const blank: ChecklistFindingCells = { findingType: "", finding: "", corrective: "", preventive: "", afi: "", severity: "", likelihood: "", single: false };
  const hits = findingsForRef(findings, ref);
  if (!hits.length) return blank;
  if (hits.length > 1) {
    return { ...blank, finding: `${hits.length} findings — see Findings Log (${hits.map((f) => f.id).join(", ")})` };
  }
  const f = hits[0];
  const cl = (closures[f.id] ?? {}) as { root?: string; corr?: string; prev?: string };
  return {
    findingType: findingTypeCell(f),
    finding: [f.observation || f.issue, (f.rootCause || cl.root) ? `Root cause: ${f.rootCause || cl.root}` : ""].filter(Boolean).join("\n"),
    corrective: f.corrective || cl.corr || "",
    preventive: f.preventive || cl.prev || "",
    afi: resolveFindingType(f) === "OFI" ? (f.issue ?? "") : "",
    severity: "",
    likelihood: "",
    single: true,
  };
}

// ── The workbook ─────────────────────────────────────────────────────────

type Ws = import("exceljs").Worksheet;
type Wb = import("exceljs").Workbook;

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

function bar(ws: Ws, row: number, text: string, opts: { size: number; bg: string; fg: string; span: number; height?: number }) {
  const c = ws.getCell(row, 2);
  c.value = text;
  c.font = { name: FONT, size: opts.size, bold: true, color: { argb: opts.fg } };
  c.fill = solid(opts.bg);
  c.alignment = { vertical: "middle" };
  ws.mergeCells(row, 2, row, 1 + opts.span);
  ws.getRow(row).height = opts.height ?? 24;
}

function headerRow(ws: Ws, row: number, labels: string[], startCol = 2) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, startCol + i);
    c.value = l;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: C.white } };
    c.fill = solid(C.midBlue);
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  ws.getRow(row).height = 30;
}

function bodyRow(ws: Ws, row: number, values: (string | number)[], bg: string, startCol = 2, textColour: string = C.navy) {
  values.forEach((v, i) => {
    const c = ws.getCell(row, startCol + i);
    c.value = v;
    c.font = { name: FONT, size: 9, color: { argb: textColour } };
    c.fill = solid(bg);
    c.alignment = { vertical: "top", wrapText: true };
  });
}

export async function buildWorkbook(d: WorkbookData): Promise<Wb> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "UCC GD4 audit workspace";
  wb.created = new Date();
  buildDetails(wb.addWorksheet(SHEETS[0]), d);
  buildProgramme(wb.addWorksheet(SHEETS[1]), d);
  buildSchedule(wb.addWorksheet(SHEETS[2]), d);
  const lastChecklistRow = buildChecklist(wb.addWorksheet(SHEETS[3]), d);
  buildFindings(wb.addWorksheet(SHEETS[4]), d);
  void lastChecklistRow;
  return wb;
}

function buildDetails(ws: Ws, d: WorkbookData) {
  ws.columns = [{ width: 3 }, { width: 28 }, { width: 62 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }];
  bar(ws, 2, "INTERNAL QUALITY AUDIT PLAN", { size: 20, bg: C.navy, fg: C.white, span: 2, height: 36 });
  bar(ws, 3, "EduTrust Certification Scheme · GD4", { size: 13, bg: C.navy, fg: C.paleBlue, span: 2, height: 27.75 });
  // The tentative strip. Driven by the sessions' own Status, so a plan that is
  // no longer tentative stops saying it is.
  const tentative = d.sessions.some((s) => /tentative/i.test(s.status ?? ""));
  if (tentative) {
    const c = ws.getCell(4, 2);
    c.value = "TENTATIVE · not yet confirmed";
    c.font = { name: FONT, size: 9, bold: true, color: { argb: C.redText } };
    c.fill = solid(C.amberBg);
    ws.mergeCells(4, 2, 4, 3);
  }

  const period = [d.cycle.periodStart, d.cycle.periodEnd].filter(Boolean).join(" – ");
  const rows: [string, string][] = [
    ["Organisation", d.header.organisation],
    ["Audit Cycle", d.cycle.name],
    ["Audit Type", d.cycle.type],
    ["Framework in Scope", "EduTrust Certification Scheme, GD4"],
    ["Audit Scope", d.cycle.scope],
    ["Audit Period", period],
    ["Evidence Cut-off", d.cycle.evidenceCutOffDate],
    ["Audit Hours", d.header.auditHours],
    ["Lead Auditor", d.header.leadAuditor || "TBC"],
    ["Internal Auditors", d.auditors.filter((a) => a.role !== "Process owner").map((a) => a.name).join(", ")],
    ["Note", d.header.notes || "Process owners to ensure availability of relevant staff and records for each session. Auditors must not audit their own department."],
  ];
  rows.forEach(([k, v], i) => {
    const r = 6 + i;
    const a = ws.getCell(r, 2), b = ws.getCell(r, 3);
    a.value = k; a.font = { name: FONT, size: 11, bold: true, color: { argb: C.white } }; a.fill = solid(C.midBlue);
    a.alignment = { vertical: "middle" };
    b.value = v; b.font = { name: FONT, size: 11, color: { argb: C.navy } };
    b.fill = solid(i % 2 === 0 ? C.rowB : C.white);
    b.alignment = { vertical: "middle", wrapText: true };
    ws.getRow(r).height = 21.75;
  });

  let r = 6 + rows.length + 1;
  bar(ws, r, "Department Acronym Key", { size: 11, bg: C.navy, fg: C.white, span: 2 });
  r += 1;
  // The key decodes the acronyms used elsewhere in the workbook, so the six
  // division headings (ALI, OEE, SES, SGL, SSO and GEP) are left out unless
  // they are a unit in their own right: GEP is, because UCC writes it alone.
  const divisions = new Set(d.departments.map((x) => x.divisionId).filter(Boolean));
  const keyRows = d.departments.filter((dep) => dep.divisionId || !divisions.has(dep.acronym));
  // Grouped by division, and the full name spells both halves, as the
  // approved file does: "Strategic Governance & Leadership – Corporate
  // Governance". The division ORDER follows the workspace's own department
  // directory; the approved file uses a curated order, which is a one-line
  // reorder of that directory if it matters.
  keyRows.sort((x, y) => (x.divisionId ?? x.acronym).localeCompare(y.divisionId ?? y.acronym) || x.acronym.localeCompare(y.acronym));
  keyRows.forEach((dep, i) => {
    const pair = departmentPair(dep.acronym, (x) => d.departments.find((y) => y.acronym === x)?.divisionId);
    const divName = d.departments.find((y) => y.acronym === dep.divisionId)?.fullName;
    const full = divName ? `${divName} – ${dep.fullName}` : dep.fullName;
    bodyRow(ws, r + i, [pair.replace("-", " – "), full], i % 2 === 0 ? C.rowA : C.rowB);
    ws.getCell(r + i, 2).font = { name: FONT, size: 10, bold: true, color: { argb: C.navy } };
  });
  r += keyRows.length + 1;

  bar(ws, r, "Person in Charge and Internal Auditors", { size: 11, bg: C.navy, fg: C.white, span: 6 });
  r += 1;
  headerRow(ws, r, ["Clause No.", "Name", "PIC", "Internal Auditor 1", "Internal Auditor 2", "Internal Auditor 3"]);
  r += 1;
  // One row per GROUP, as the approved file prints it: "2.4" covers its three
  // scopes on one line. Storage stays per scope; this is display only, and a
  // group whose scopes have drifted apart is shown split rather than papered
  // over, so an edit to one scope of a group cannot hide behind the others.
  const picRows = ASSIGNMENT_GROUPS.flatMap((g) => {
    const distinct = new Map<string, string[]>();
    for (const sc of g.scopes) {
      const a = d.assignments[sc] ?? { auditorIds: [] };
      const key = `${a.picId ?? ""}|${(a.auditorIds ?? []).join(",")}`;
      distinct.set(key, [...(distinct.get(key) ?? []), sc]);
    }
    return [...distinct.entries()].map(([, scopes]) => {
      const a = d.assignments[scopes[0]] ?? { auditorIds: [] };
      const label = scopes.length === g.scopes.length && g.scopes.length > 1 ? g.label : scopes.join(" / ");
      const title = scopes.length > 1 ? scopes.map((x) => scopeTitle(x)).join(" / ") : scopeTitle(scopes[0]);
      return { label, title, a };
    });
  });
  picRows.forEach((row, i) => {
    const names = (row.a.auditorIds ?? []).map((id) => nameOf(d.auditors, id));
    bodyRow(ws, r + i, [row.label, row.title, nameOf(d.auditors, row.a.picId), names[0] ?? "", names[1] ?? "", names[2] ?? ""], i % 2 === 0 ? C.rowA : C.rowB);
    ws.getCell(r + i, 4).font = { name: FONT, size: 10, bold: true, color: { argb: C.navy } };
  });
  r += picRows.length + 1;

  bar(ws, r, "Applicable Exclusions", { size: 11, bg: C.navy, fg: C.white, span: 2 });
  r += 1;
  headerRow(ws, r, ["GD4 Area", "Exclusion & Justification"]);
  r += 1;
  bodyRow(ws, r, d.header.exclusions ? ["Recorded", d.header.exclusions] : ["None", "All 30 GD4 areas are in scope. Record any exclusion here with its justification."], C.rowB);
}

function buildProgramme(ws: Ws, d: WorkbookData) {
  ws.columns = [{ width: 3 }, { width: 6 }, { width: 18 }, { width: 26 }, { width: 10 }, { width: 36 }, { width: 34 }, { width: 12 }];
  bar(ws, 1, "IQA PROGRAMME · OCTOBER TO DECEMBER 2026", { size: 14, bg: C.navy, fg: C.white, span: 7, height: 27 });
  const sub = ws.getCell(2, 2);
  sub.value = "One row per programme day. Row colour shows the activity type.";
  sub.font = { name: FONT, size: 9, color: { argb: C.navy } };
  sub.fill = solid(C.paleBlue);
  ws.mergeCells(2, 2, 2, 8);
  const legend = ws.getCell(3, 2);
  legend.value = "Legend";
  legend.font = { name: FONT, size: 9, bold: true, color: { argb: C.navy } };
  legend.fill = solid(C.grey);
  const legendText = ws.getCell(3, 3);
  legendText.value = "Row colour shows the activity type:  Self-check / evidence prep · Priority IQA · Other IQA · PPD / findings review · Rectification / CAP · Closure verification · Buffer / contingency";
  legendText.font = { name: FONT, size: 9, color: { argb: C.greyText } };
  legendText.fill = solid(C.grey);
  ws.mergeCells(3, 3, 3, 8);

  headerRow(ws, 5, ["S/N", "Date", "Activity type", "Criterion", "Activity", "Focus", "Status"]);
  programmeDays(d.sessions).forEach((day, i) => {
    const r = 6 + i;
    const fill = programmeFill(day.activityType) ?? C.white;
    // An empty cell prints as a dash, as the approved file does, so a blank
    // reads as "nothing to say" rather than as an export that dropped it.
    const dash = (v: string) => v || "–";
    bodyRow(ws, r, [i + 1, longDate(day.date), day.activityType, dash(day.criterion), dash(day.activity), dash(day.focus), day.status], fill);
    ws.getRow(r).height = 19.5;
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];
}

function buildSchedule(ws: Ws, d: WorkbookData) {
  ws.columns = [{ width: 3 }, { width: 6 }, { width: 13 }, { width: 10 }, { width: 20 }, { width: 34 }, { width: 30 }, { width: 12 }, { width: 22 }, { width: 11 }, { width: 22 }, { width: 50 }, { width: 18 }];
  bar(ws, 1, "AUDIT SCHEDULE · SESSION BY SESSION", { size: 14, bg: C.navy, fg: C.white, span: 12, height: 27 });
  const sub = ws.getCell(2, 2);
  sub.value = "Audit days only. Self-check, review, Quality Action and closure days are on the Programme sheet.";
  sub.font = { name: FONT, size: 9, color: { argb: C.navy } };
  sub.fill = solid(C.paleBlue);
  ws.mergeCells(2, 2, 2, 13);
  headerRow(ws, 4, ["S/N", "Time", "Duration", "Activity", "GD4 Area to Audit", "GD4 Requirement Refs", "Owning Dept", "Controlled Document", "PIC", "Internal Auditors", "Expected Records / Evidence", "Independence"]);

  let r = 5, sn = 0;
  for (const day of auditDays(d.sessions)) {
    bar(ws, r, day.label, { size: 10, bg: C.paleBlue, fg: C.navy, span: 12, height: 30 });
    r += 1;
    for (const s of day.sessions) {
      sn += 1;
      const scope = s.scopeIds?.[0] ?? "";
      const lunch = /lunch/i.test(s.activity ?? "");
      const a = scope ? (d.assignments[scope] ?? { auditorIds: [] }) : { auditorIds: [] };
      const ind = scope ? areaIndependence(scope, d.assignments, d.auditors) : { status: "unknown" as const, text: "–" };
      const dash = (v: string) => v || "–";
      bodyRow(ws, r, [
        sn, timeRange(s), s.durationMins ? `${s.durationMins} min` : "–",
        [s.activity, s.focus].filter(Boolean).join(" · ") || "–",
        dash(scope ? `${scope} ${scopeTitle(scope)}` : ""),
        dash(scope ? requirementRefs(scope) : ""),
        dash(scope ? departmentPair(departmentForScope(scope)).replace("-", " – ") : ""),
        dash(scope ? docLabel(scope, d.policyDocEdits) : ""),
        dash(scope ? nameOf(d.auditors, a.picId) : ""),
        dash(scope ? auditorNames(d.auditors, a.auditorIds) : ""),
        dash(scope ? expectedEvidence(scope) : ""),
        scope ? ind.text : "–",
      ], lunch ? C.grey : (sn % 2 ? C.rowB : C.rowA), 2, lunch ? C.greyText : C.navy);
      if (scope && ind.status === "conflict") ws.getCell(r, 13).font = { name: FONT, size: 9, bold: true, color: { argb: C.redText } };
      r += 1;
    }
  }
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];
}

function buildChecklist(ws: Ws, d: WorkbookData): number {
  ws.columns = [{ width: 2 }, { width: 6.7 }, { width: 14 }, { width: 16 }, { width: 56 }, { width: 13 }, { width: 14 }, { width: 36 }, { width: 12 }, { width: 50 }, { width: 44 }, { width: 44 }, { width: 34 }, { width: 6 }, { width: 6 }, { width: 8 }];
  bar(ws, 1, "AUDIT CHECKLIST · ITEMS TO REQUEST AND CHECK", { size: 16, bg: C.navy, fg: C.white, span: 15, height: 31.5 });
  const sub = ws.getCell(2, 2);
  sub.value = "Criterion 1 to 7. One section per GD4 area, with its person in charge and internal audit team.";
  sub.font = { name: FONT, size: 11, bold: true, color: { argb: C.paleBlue } };
  sub.fill = solid(C.navy);
  ws.mergeCells(2, 2, 2, 16);
  const legend = ws.getCell(3, 2);
  legend.value = LEGEND_CHECKLIST;
  legend.font = { name: FONT, size: 9, color: { argb: C.navy } };
  legend.fill = solid(C.rowA);
  ws.mergeCells(3, 2, 3, 16);
  headerRow(ws, 5, ["S/N", "GD4 Ref", "Type", "Item to Request / Check", "Responsible Dept", "Status", "Audit Notes / Remarks", "Finding Type", "Finding\n(what it is about, incl. root cause: People / Process / Technology)", "Corrective\n• People  • Process  • Technology", "Preventive\n• People  • Process  • Technology", "AFI", "S", "L", "RPN\n(S × L)"]);
  ws.getRow(5).height = 42;

  let r = 6, sn = 0;
  const firstBodyRow = 6;
  for (const crit of GD4_CRITERIA) {
    bar(ws, r, `CRITERION ${crit.id}  ·  ${crit.title.toUpperCase()}`, { size: 12, bg: C.navy, fg: C.white, span: 15 });
    r += 1;
    for (const scope of ALL_SCOPES.filter((s) => s.split(".")[0] === crit.id)) {
      const a = d.assignments[scope] ?? { auditorIds: [] };
      bar(ws, r, `${scope} ${scopeTitle(scope)}      PIC: ${nameOf(d.auditors, a.picId) || "not set"}      Internal Auditors: ${auditorNames(d.auditors, a.auditorIds) || "not set"}`, { size: 10, bg: C.paleBlue, fg: C.navy, span: 15, height: 19.5 });
      r += 1;
      const dept = departmentPair(departmentForScope(scope)).replace("-", " – ");
      // The approved workbook lists an area's lines ONCE PER SESSION that
      // audits it: nine areas are audited twice (an IQA pass and a sampling /
      // follow-up pass) and their lines appear twice, back to back, under the
      // one area bar. That is 130 of its 496 lines. A second pass needs its
      // own set of ticks, so the repeat is deliberate, not a duplicate.
      const passes = Math.max(1, d.sessions.filter((x) => (x.scopeIds ?? []).includes(scope) && x.startTime).length);
      for (let pass = 0; pass < passes; pass++)
      for (const line of buildRequirementRows(scope)) {
        sn += 1;
        const cells = checklistFindingCells(d.findings, line.ref, d.closures);
        bodyRow(ws, r, [
          sn, line.ref, line.section.startsWith("Expected evidence") ? "Expected evidence" : line.section === "Note" ? "Note" : "Describe & Show",
          line.text, dept, "", "",
          cells.findingType, cells.finding, cells.corrective, cells.preventive, cells.afi,
          cells.severity, cells.likelihood, "",
        ], sn % 2 ? C.rowB : C.white);
        const rpn = ws.getCell(r, 16);
        rpn.value = { formula: rpnFormula(`N${r}`, `O${r}`) };
        rpn.font = { name: FONT, size: 10, bold: true, color: { argb: C.navy } };
        rpn.alignment = { horizontal: "center", vertical: "middle" };
        for (const col of [14, 15]) ws.getCell(r, col).alignment = { horizontal: "center", vertical: "middle" };
        r += 1;
      }
    }
  }
  const last = r - 1;
  addChecklistRules(ws, firstBodyRow, last);
  ws.views = [{ state: "frozen", xSplit: 5, ySplit: 5 }];
  return last;
}

function addChecklistRules(ws: Ws, first: number, last: number) {
  for (let r = first; r <= last; r++) {
    ws.getCell(r, 7).dataValidation = { type: "list", allowBlank: true, formulae: [DROPDOWN.status] };
    ws.getCell(r, 9).dataValidation = { type: "list", allowBlank: true, formulae: [DROPDOWN.findingType] };
    for (const col of [14, 15]) {
      ws.getCell(r, col).dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [1, 5], showErrorMessage: true, errorTitle: "1 to 5", error: "Severity and Likelihood are whole numbers from 1 to 5." };
    }
  }
  const cf = (sqref: string, rules: unknown[]) => ws.addConditionalFormatting({ ref: sqref, rules: rules as never });
  const textRule = (formula: string, colour: string, bg?: string, priority = 1) => ({
    type: "expression", formulae: [formula], priority,
    style: { font: { bold: true, color: { argb: colour } }, ...(bg ? { fill: solid(bg) } : {}) },
  });
  cf(`G${first}:G${last}`, [
    textRule(`$G${first}="Sighted"`, C.sightedText, C.sightedBg, 1),
    textRule(`$G${first}="Partly"`, C.partlyText, C.partlyBg, 2),
    textRule(`$G${first}="Not provided"`, C.notProvidedText, C.notProvidedBg, 3),
    textRule(`$G${first}="Not applicable"`, C.notApplicableText, C.notApplicableBg, 4),
  ]);
  cf(`I${first}:I${last}`, [
    textRule(`$I${first}="Maj NC"`, C.majNc, undefined, 1),
    textRule(`$I${first}="Min NC"`, C.minNc, undefined, 2),
    textRule(`$I${first}="NC"`, C.nc, undefined, 3),
    textRule(`$I${first}="OBS"`, C.obs, undefined, 4),
    textRule(`$I${first}="OFI"`, C.ofi, undefined, 5),
  ]);
  cf(`P${first}:P${last}`, [
    textRule(`AND(ISNUMBER($P${first}),$P${first}>=15)`, C.rpnHigh, undefined, 1),
    textRule(`AND(ISNUMBER($P${first}),$P${first}>=8)`, C.rpnMid, undefined, 2),
  ]);
}

function buildFindings(ws: Ws, d: WorkbookData) {
  ws.columns = [{ width: 3 }, { width: 12 }, { width: 38 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 5 }, { width: 10 }, { width: 50 }, { width: 44 }, { width: 44 }, { width: 34 }, { width: 5 }, { width: 5 }, { width: 8 }, { width: 9 }, { width: 16 }, { width: 16 }, { width: 12 }];
  bar(ws, 1, "AUDIT FINDINGS LOG · EDUTRUST GD4 · SMS OVERSIGHT CHECKLIST FORMAT", { size: 14, bg: C.navy, fg: C.white, span: 23, height: 27 });
  const note = ws.getCell(2, 2);
  note.value = LEGEND_FINDINGS;
  note.font = { name: FONT, size: 9, color: { argb: C.greyText } };
  note.fill = solid(C.grey);
  ws.mergeCells(2, 2, 2, 24);

  const groups: [string, number, number][] = [
    ["OVERSIGHT CHECKLIST ITEM", 2, 4], ["LINKED RECORDS", 5, 7], ["APSR / PDCA SCORING (1 to 5)", 8, 11],
    ["FINDINGS, CORRECTIVE, PREVENTIVE, AFI AND RPN", 12, 20], ["AUDIT TRAIL", 21, 24],
  ];
  for (const [label, from, to] of groups) {
    const c = ws.getCell(3, from);
    c.value = label;
    c.font = { name: FONT, size: 9, bold: true, color: { argb: C.white } };
    c.fill = solid(C.navy);
    c.alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(3, from, 3, to);
  }
  headerRow(ws, 4, [
    "Standards", "Procedure", "Status", "Quality Action", "Procedure Review Checklist", "Quality Monitoring Record",
    "Plan / Approach", "Do / Processes", "Check / Systems & Outcomes", "Act / Review",
    "ID", "Type", "Finding\n(what it is about, incl. root cause: People / Process / Technology)",
    "Corrective\n• People  • Process  • Technology", "Preventive\n• People  • Process  • Technology",
    "AFI", "S", "L", "RPN\n(S × L)", "✔ Resolved", "Raised By", "Acknowledged By", "Agreed Due",
  ]);
  ws.getRow(4).height = 42;

  let r = 5;
  for (const req of GD4_REQUIREMENTS) {
    const scope = scopeIdForItem(req.id, req.subCriterionId);
    const doc = documentsForScope(scope)[0];
    const hits = d.findings.filter((f) => f.gd4ItemId === req.id);
    const lines = hits.length ? hits : [undefined];
    for (const f of lines) {
      const cl = f ? (d.closures[f.id] ?? {}) as { root?: string; corr?: string; prev?: string } : {};
      bodyRow(ws, r, [
        `GD4_${req.id}`,
        doc ? `${doc.code} ${doc.title}` : "",
        f ? findingStatusCell(f, d.closures) : "",
        "", "", "",                                   // the three SMS record ids: new, entered in SMS
        "", "", "", "",                               // APSR / PDCA, filled from the matrix when scored
        f ? f.id : "", f ? findingTypeCell(f) : "",
        f ? [f.observation || f.issue, (f.rootCause || cl.root) ? `Root cause: ${f.rootCause || cl.root}` : ""].filter(Boolean).join("\n") : "",
        f ? (f.corrective || cl.corr || "") : "",
        f ? (f.preventive || cl.prev || "") : "",
        f && resolveFindingType(f) === "OFI" ? (f.issue ?? "") : "",
        "", "", "",
        f && isFindingClosed(f, d.closures) ? "✔" : "",
        f ? (f.raisedBy?.auditorName ?? (f.source === "Manual" ? "Auditor (not named)" : f.source ? "AI audit (not an auditor observation)" : "")) : "",
        f ? (f.acknowledgedBy ?? "") : "",
        f ? (f.agreedDueDate ?? "") : "",
      ], (r % 2) ? C.rowB : C.white);
      const rpn = ws.getCell(r, 20);
      rpn.value = { formula: rpnFormula(`R${r}`, `S${r}`) };
      rpn.font = { name: FONT, size: 10, bold: true, color: { argb: C.navy } };
      rpn.alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 4).dataValidation = { type: "list", allowBlank: true, formulae: [DROPDOWN.findingStatus] };
      ws.getCell(r, 13).dataValidation = { type: "list", allowBlank: true, formulae: [DROPDOWN.findingType] };
      ws.getCell(r, 21).dataValidation = { type: "list", allowBlank: true, formulae: [DROPDOWN.resolved] };
      for (const col of [8, 9, 10, 11, 18, 19]) {
        ws.getCell(r, col).dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [1, 5], showErrorMessage: true, errorTitle: "1 to 5", error: "Scores are whole numbers from 1 to 5." };
        ws.getCell(r, col).alignment = { horizontal: "center", vertical: "middle" };
      }
      ws.getRow(r).height = 30;
      r += 1;
    }
  }
  const last = r - 1;
  const textRule = (formula: string, colour: string, priority: number) => ({
    type: "expression", formulae: [formula], priority,
    style: { font: { bold: true, color: { argb: colour } } },
  });
  ws.addConditionalFormatting({ ref: `M5:M${last}`, rules: [
    textRule('$M5="Maj NC"', C.majNc, 1), textRule('$M5="Min NC"', C.minNc, 2), textRule('$M5="NC"', C.nc, 3),
    textRule('$M5="OBS"', C.obs, 4), textRule('$M5="OFI"', C.ofi, 5),
  ] as never });
  ws.addConditionalFormatting({ ref: `T5:T${last}`, rules: [
    textRule("AND(ISNUMBER($T5),$T5>=15)", C.rpnHigh, 1), textRule("AND(ISNUMBER($T5),$T5>=8)", C.rpnMid, 2),
  ] as never });
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 4 }];
}

export async function workbookBuffer(d: WorkbookData): Promise<ArrayBuffer> {
  const wb = await buildWorkbook(d);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
