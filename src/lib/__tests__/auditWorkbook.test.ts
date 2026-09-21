import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildAuditWorkbook, planSheetRows, checklistSheetRows, findingsSheetRows,
  workbookBytes, workbookFileName, raisedByLabel, SHEET_NAMES, CHECKLIST_STATUS_OPTIONS,
  type WorkbookInput,
} from "../auditWorkbook";
import { sortedSessions, sessionSlot, dayNumbers, sessionScopes, planWarnings, EMPTY_PLAN_HEADER, type AuditSession } from "../auditPlan";
import type { Finding, AuditCycle } from "../../types";

const cycle: AuditCycle = {
  id: "cycle-2", name: "GD4 2026 internal", type: "Internal", periodStart: "2026-01-01", periodEnd: "2026-12-31",
  evidenceCutOffDate: "2026-09-30", scope: "All criteria", status: "Draft", owner: "Felix", version: "v1",
  lastSavedAt: "", createdAt: "", updatedAt: "",
};
const sess = (p: Partial<AuditSession>): AuditSession => ({
  id: p.id ?? "S1", day: "2026-04-01", startTime: "09:00", durationMins: 90,
  auditeeFunction: "Admissions", auditorNames: "R. Lim", scopeIds: ["4.1"], notes: "", ...p,
});
const finding = (p: Partial<Finding>): Finding => ({
  id: "FIND-1", auditCycleId: "cycle-2", gd4ItemId: "4.1.1", issue: "No counselling record for 3 of 10 sampled students",
  type: "AFI", severity: "High", owner: "AD", dueDate: "2026-05-01", repeatFinding: false, overdue: false,
  managementDecisionNeeded: false, status: "Open", findingType: "NC", ncSeverity: "Major", ...p,
});
const input = (p: Partial<WorkbookInput> = {}): WorkbookInput => ({
  cycle, header: { ...EMPTY_PLAN_HEADER, leadAuditor: "F. Ng", auditHours: "16" },
  sessions: [sess({ id: "S1" })], auditors: [], departments: [{ id: "AD", acronym: "AD", fullName: "Admissions", personInCharge: "", divisionId: "SSO" }],
  findings: [finding({})], closures: {}, policyDocEdits: {}, ...p,
});

const cell = (rows: (string | number)[][], row: number, col: number) => String(rows[row]?.[col] ?? "");
const flat = (rows: (string | number)[][]) => rows.map((r) => r.join(" | ")).join("\n");

describe("one workbook, three sheets", () => {
  it("names the sheets after the three documents", () => {
    const wb = buildAuditWorkbook(input());
    expect(wb.SheetNames).toEqual([...SHEET_NAMES]);
  });

  it("writes a real .xlsx that reads back with all three sheets", () => {
    const back = XLSX.read(workbookBytes(buildAuditWorkbook(input())), { type: "array" });
    expect(back.SheetNames).toEqual([...SHEET_NAMES]);
    expect(XLSX.utils.sheet_to_json(back.Sheets["Findings log"], { header: 1 }).length).toBeGreaterThan(4);
  });

  it("names the file after the cycle and the date, with nothing path-unsafe in it", () => {
    const name = workbookFileName({ ...cycle, name: "GD4 2026 / internal" }, new Date("2026-04-01"));
    // A run of unsafe characters collapses to ONE underscore.
    expect(name).toBe("GD4_Internal_Audit_GD4_2026_internal_2026-04-01.xlsx");
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe("the plan sheet derives, never retypes", () => {
  it("carries the header block and the cycle's own dates", () => {
    const t = flat(planSheetRows(input()));
    expect(t).toContain("United Ceres College");
    expect(t).toContain("F. Ng");
    expect(t).toContain("2026-01-01 to 2026-12-31");
    expect(t).toContain("Audit hours | 16");
  });

  it("prints the department key with UCC's division form", () => {
    expect(flat(planSheetRows(input()))).toContain("AD | SSO-AD | Admissions");
  });

  it("fills the schedule row from the GD4 data and the registers", () => {
    const rows = planSheetRows(input());
    const line = rows.find((r) => String(r[5]) === "Admissions")!;
    expect(line[0]).toBe("Day 1");
    expect(line[3]).toBe("09:00-10:30");
    expect(String(line[6])).toContain("4.1 Pre-Course Counselling");
    // Real requirement refs and the real controlled document, not typed here.
    expect(String(line[7])).toMatch(/4\.1\.1\./);
    expect(String(line[8])).toBe("SSO-AD");
    expect(String(line[9])).toContain("PPD-SSO-AD-4.1.1");
    expect(String(line[11]).length).toBeGreaterThan(0);
  });

  it("shows a document's version when one has been recorded", () => {
    const t = flat(planSheetRows(input({ policyDocEdits: { "PPD-SSO-AD-4.1.1": { version: "V2", updatedAt: "2026-03-14" } } })));
    expect(t).toContain("PPD-SSO-AD-4.1.1 (V2 · 14 Mar 2026)");
  });

  it("says plainly that it is not an SSG submission", () => {
    expect(cell(planSheetRows(input()), 1, 0)).toMatch(/Not an SSG or EduTrust submission/);
  });
});

describe("the checklist sheet", () => {
  it("offers the sighted vocabulary, not the app's Met/Partial/Not met", () => {
    const t = flat(checklistSheetRows(input()));
    expect(t).toContain(CHECKLIST_STATUS_OPTIONS);
    expect(CHECKLIST_STATUS_OPTIONS).toBe("Sighted / Partly / Not provided / Not applicable");
  });

  it("gives one row per requirement line, with the status columns left blank", () => {
    const rows = checklistSheetRows(input());
    const body = rows.slice(4);
    expect(body.length).toBeGreaterThan(5);
    for (const r of body) {
      expect(r[10]).toBe("");   // Status — the auditor's, on the day
      expect(r[11]).toBe("");   // Audit notes
      expect(r[12]).toBe("");   // Remarks
      expect(String(r[7]).length).toBeGreaterThan(0);  // the requirement text
    }
  });

  it("carries no verdict of any kind from the app", () => {
    const t = flat(checklistSheetRows(input()));
    expect(t).not.toMatch(/\bBand \d\b/);
    expect(t).not.toMatch(/\bNot met\b|\bPartial\b/);
  });

  it("is empty of rows when no session covers anything", () => {
    const rows = checklistSheetRows(input({ sessions: [sess({ scopeIds: [] })] }));
    expect(rows.slice(4).length).toBe(0);
  });
});

describe("the findings log", () => {
  it("has no Official or Unofficial column", () => {
    const head = findingsSheetRows(input())[3].map(String);
    expect(head).not.toContain("Official");
    expect(head).not.toContain("Unofficial");
    expect(head).toContain("Acknowledged by");
    expect(head).toContain("Agreed action");
  });

  it("still prints an acknowledged nonconformity as a nonconformity", () => {
    const ack = finding({ acknowledgedBy: "R. Tan", acknowledgedAt: "2026-04-02", agreedAction: "Rewriting the procedure", agreedDueDate: "2026-06-30" });
    const row = findingsSheetRows(input({ findings: [ack] }))[4];
    expect(row[5]).toBe("NC");
    expect(row[6]).toBe("Major");
    expect(String(row[14])).toMatch(/^Open, acknowledged by R\. Tan/);
    expect(String(row[14])).not.toMatch(/closed|waived|unofficial/i);
  });

  it("names the auditor who raised it, and says when the AI did", () => {
    expect(raisedByLabel(finding({ raisedBy: { auditorId: "a1", auditorName: "R. Lim" } }))).toBe("R. Lim");
    expect(raisedByLabel(finding({ source: "Manual" }))).toBe("Auditor (not named)");
    // The rule that keeps an AI verdict out of an auditor's log.
    expect(raisedByLabel(finding({ source: "ai_audit" }))).toBe("AI audit (not an auditor observation)");
    expect(raisedByLabel(finding({ source: "PPD Review" }))).toMatch(/not an auditor observation/);
  });

  it("ties a finding back to the session that covered its area", () => {
    const row = findingsSheetRows(input())[4];
    expect(row[1]).toBe("Day 1");
    expect(row[2]).toBe(1);
    expect(String(row[4])).toContain("4.1 Pre-Course Counselling");
  });

  it("leaves day and session blank when no session covered that area", () => {
    const row = findingsSheetRows(input({ sessions: [sess({ scopeIds: ["6.1"] })] }))[4];
    expect(row[1]).toBe("");
    expect(row[2]).toBe("");
  });

  it("resolves a split sub-criterion's area without truncating the item id", () => {
    // "2.1.1" truncated to "2.1" matches nothing in this data set.
    const row = findingsSheetRows(input({ findings: [finding({ gd4ItemId: "2.1.1" })] }))[4];
    expect(String(row[4])).toContain("2.1.1");
  });
});

describe("the schedule helpers", () => {
  it("sorts by day then time, and puts undated sessions last", () => {
    const out = sortedSessions([
      sess({ id: "c", day: "", startTime: "" }),
      sess({ id: "b", day: "2026-04-01", startTime: "14:00" }),
      sess({ id: "a", day: "2026-04-01", startTime: "09:00" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("computes the end time, and rolls over the hour", () => {
    expect(sessionSlot(sess({ startTime: "09:00", durationMins: 90 }))).toBe("09:00-10:30");
    expect(sessionSlot(sess({ startTime: "09:45", durationMins: 30 }))).toBe("09:45-10:15");
    expect(sessionSlot(sess({ startTime: "", durationMins: 90 }))).toBe("");
  });

  it("numbers days by distinct date in schedule order", () => {
    const d = dayNumbers([sess({ day: "2026-04-02" }), sess({ day: "2026-04-01" }), sess({ day: "2026-04-02" })]);
    expect(d.get("2026-04-01")).toBe(1);
    expect(d.get("2026-04-02")).toBe(2);
  });

  it("resolves a session's areas to department and real documents", () => {
    const [s] = sessionScopes(sess({ scopeIds: ["1.1"] }));
    expect(s.department).toBe("CG");
    expect(s.documentCodes).toEqual(["PPD-SGL-CG-1.1.1", "PPD-OE-FN-1.1.1"]);
  });

  it("warns about a session that audits nothing, and about duplicates", () => {
    const w = planWarnings(EMPTY_PLAN_HEADER, [sess({ id: "a", scopeIds: [] }), sess({ id: "b" }), sess({ id: "c" })]);
    expect(w.join(" ")).toMatch(/1 session covers no GD4 area/);
    expect(w.join(" ")).toMatch(/Covered in more than one session: 4\.1/);
    expect(w.join(" ")).toMatch(/No lead auditor named/);
  });
});
