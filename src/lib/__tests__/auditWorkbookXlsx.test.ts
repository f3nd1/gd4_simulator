import { describe, it, expect } from "vitest";
import {
  findingTypeCell, findingStatusCell, areaIndependence, longDate, timeRange,
  programmeDays, auditDays, findingsForRef, checklistFindingCells,
} from "../auditWorkbookXlsx";
import { rpnFormula, isAuditDayType, programmeFill, C, LEGEND_CHECKLIST } from "../workbookStyle";
import { DEFAULT_AREA_ASSIGNMENTS } from "../../data/areaAssignments";
import { DEFAULT_AUDITORS } from "../../data/auditors";
import type { AuditSession } from "../auditPlan";
import type { Finding, AuditorProfile } from "../../types";

const sess = (p: Partial<AuditSession>): AuditSession => ({
  id: Math.random().toString(36), day: "2026-10-12", startTime: "09:30", endTime: "12:30", durationMins: 180,
  auditeeFunction: "", auditorNames: "", scopeIds: [], notes: "", kind: "audit",
  activityType: "Priority IQA: C4 / C5", activity: "IQA", focus: "x", status: "Tentative", criterionLabel: "C4", ...p,
});
const finding = (p: Partial<Finding>): Finding => ({
  id: "F-1", auditCycleId: "c", gd4ItemId: "4.1.1", issue: "No counselling record for 3 of 10 sampled students",
  type: "AFI", severity: "High", owner: "", dueDate: "", repeatFinding: false, overdue: false,
  managementDecisionNeeded: false, status: "Open", ...p,
});

describe("RPN is a formula, never a number", () => {
  it("is byte-identical to the approved workbook's", () => {
    // The approved file's every RPN cell holds exactly this. A stored number
    // would go stale the moment S or L changed.
    expect(rpnFormula("N8", "O8")).toBe('IF(AND(ISNUMBER(N8),ISNUMBER(O8)),N8*O8,"")');
    expect(rpnFormula("R5", "S5")).toBe('IF(AND(ISNUMBER(R5),ISNUMBER(S5)),R5*S5,"")');
  });

  it("is blank until both S and L are entered", () => {
    // What the formula evaluates to, stated as the rule it encodes.
    const evaluate = (s: number | "", l: number | "") => (typeof s === "number" && typeof l === "number" ? s * l : "");
    expect(evaluate(3, 2)).toBe(6);
    expect(evaluate(5, 4)).toBe(20);
    expect(evaluate(3, "")).toBe("");
    expect(evaluate("", "")).toBe("");
  });

  it("colours at the approved thresholds", () => {
    expect(C.rpnMid).toBe("FFFF9900");   // amber from 8
    expect(C.rpnHigh).toBe("FFC00000");  // red from 15
  });
});

describe("Finding Type maps onto what the app already holds", () => {
  it("never invents a type: Min NC and Maj NC are NC plus a severity", () => {
    expect(findingTypeCell(finding({ findingType: "NC", ncSeverity: "Major" }))).toBe("Maj NC");
    expect(findingTypeCell(finding({ findingType: "NC", ncSeverity: "Minor" }))).toBe("Min NC");
    expect(findingTypeCell(finding({ findingType: "OFI" }))).toBe("OFI");
    expect(findingTypeCell(finding({ findingType: "OBS" }))).toBe("OBS");
  });

  it("exports a nonconformity with no severity as Min NC, which is what the app already believes", () => {
    // resolveNcSeverity() returns Minor for a bare NC, so exporting a bare
    // "NC" would make the workbook and the app disagree about one finding.
    expect(findingTypeCell(finding({ findingType: "NC" }))).toBe("Min NC");
    expect(LEGEND_CHECKLIST).toMatch(/no severity recorded is exported as Min NC/);
  });

  it("maps closure onto the file's three-value status", () => {
    expect(findingStatusCell(finding({}), {})).toBe("Open");
    expect(findingStatusCell(finding({ acknowledgedBy: "R. Tan", acknowledgedAt: "2026-04-02" }), {})).toBe("In Progress");
    expect(findingStatusCell(finding({ id: "F-9" }), { "F-9": { human: "Accepted" } })).toBe("Resolved");
  });
});

describe("the checklist's finding columns cannot contradict the Findings Log", () => {
  it("is blank when no finding traces to the line", () => {
    expect(checklistFindingCells([], "4.1.1.DS1", {}).finding).toBe("");
  });

  it("shows the one finding that traces to it", () => {
    const f = finding({ clause: "4.1.1.DS1", findingType: "NC", ncSeverity: "Major", observation: "3 of 10 missing" });
    const cells = checklistFindingCells([f], "4.1.1.DS1", {});
    expect(cells.findingType).toBe("Maj NC");
    expect(cells.finding).toContain("3 of 10 missing");
    expect(cells.single).toBe(true);
  });

  it("refuses to pick one when several trace to the line, and leaves S and L empty", () => {
    // An RPN for "one of two findings" is a number that means nothing.
    const a = finding({ id: "F-1", clause: "4.1.1.DS1" });
    const b = finding({ id: "F-2", linkedSourceRefs: ["4.1.1.DS1"] });
    const cells = checklistFindingCells([a, b], "4.1.1.DS1", {});
    expect(cells.finding).toBe("2 findings — see Findings Log (F-1, F-2)");
    expect(cells.findingType).toBe("");
    expect(cells.severity).toBe("");
    expect(cells.likelihood).toBe("");
  });

  it("matches a ref through either route, case-insensitively", () => {
    expect(findingsForRef([finding({ clause: "4.1.1.ds1" })], "4.1.1.DS1").length).toBe(1);
    expect(findingsForRef([finding({ linkedSourceRefs: ["4.1.1.DS1"] })], "4.1.1.DS1").length).toBe(1);
    expect(findingsForRef([finding({ clause: "4.1.1.DS2" })], "4.1.1.DS1").length).toBe(0);
  });
});

describe("independence never claims what it cannot show", () => {
  it("says it cannot check while a department is unrecorded", () => {
    // Every seeded profile has departmentId unset, so this is the real state
    // until the team fills the dropdown in.
    const r = areaIndependence("2.4.1", DEFAULT_AREA_ASSIGNMENTS, DEFAULT_AUDITORS);
    expect(r.status).toBe("unknown");
    expect(r.text).toMatch(/Cannot check: department not recorded/);
  });

  it("flags an auditor from the owning department once departments are set", () => {
    // 2.4.1 is owned by SQ and Felix audits it.
    const withDepts: AuditorProfile[] = DEFAULT_AUDITORS.map((a) => (a.id === "AUD-FELIX" ? { ...a, departmentId: "SQ" } : { ...a, departmentId: "HR" }));
    const r = areaIndependence("2.4.1", DEFAULT_AREA_ASSIGNMENTS, withDepts);
    expect(r.status).toBe("conflict");
    expect(r.text).toContain("Felix");
    expect(r.text).toContain("SGL-SQ");
  });

  it("says independent only when every auditor's department is known and differs", () => {
    const withDepts: AuditorProfile[] = DEFAULT_AUDITORS.map((a) => ({ ...a, departmentId: "HR" }));
    expect(areaIndependence("2.4.1", DEFAULT_AREA_ASSIGNMENTS, withDepts).status).toBe("independent");
  });

  it("says so when no auditors are assigned rather than passing", () => {
    expect(areaIndependence("2.4.1", {}, DEFAULT_AUDITORS).status).toBe("unknown");
  });
});

describe("the Programme and Schedule split", () => {
  it("puts only IQA days on the schedule", () => {
    expect(isAuditDayType("Priority IQA: C4 / C5")).toBe(true);
    expect(isAuditDayType("Other IQA")).toBe(true);
    expect(isAuditDayType("PPD / findings review")).toBe(false);
    expect(isAuditDayType("Self-check / evidence prep")).toBe(false);
    expect(isAuditDayType("Buffer / contingency")).toBe(false);
  });

  it("names an audit day by its criterion and areas, not by its first session", () => {
    // Taking the first timed session printed "Opening meeting" as the whole
    // day's activity on the Programme sheet.
    const days = programmeDays([
      sess({ startTime: "09:30", activity: "Opening meeting", scopeIds: [] }),
      sess({ startTime: "10:00", activity: "IQA", scopeIds: ["4.1"] }),
      sess({ startTime: "13:30", activity: "IQA", scopeIds: ["4.2.1"] }),
    ]);
    expect(days.length).toBe(1);
    expect(days[0].activity).toBe("IQA C4");
    expect(days[0].focus).toBe("Areas 4.1, 4.2.1");
  });

  it("lets a whole-day row name its own day", () => {
    const days = programmeDays([sess({ kind: "programme", startTime: "", activity: "Department self-check", focus: "Upload evidence", criterionLabel: "" })]);
    expect(days[0].activity).toBe("Department self-check");
    expect(days[0].focus).toBe("Upload evidence");
  });

  it("groups audit-day sessions under their date", () => {
    const days = auditDays([sess({ day: "2026-10-12" }), sess({ day: "2026-10-12", startTime: "13:30" }), sess({ day: "2026-10-16", activityType: "Buffer / contingency" })]);
    expect(days.length).toBe(1);
    expect(days[0].sessions.length).toBe(2);
    expect(days[0].label).toContain("Mon 12 Oct 2026");
  });

  it("colours each activity type as the approved file does", () => {
    expect(programmeFill("Self-check / evidence prep")).toBe(C.selfCheck);
    expect(programmeFill("Priority IQA: C4 / C5")).toBe(C.priorityIqa);
    expect(programmeFill("Other IQA")).toBe(C.otherIqa);
    expect(programmeFill("Buffer / contingency")).toBe(C.buffer);
    // An activity type UCC invents later is left plain rather than guessed at.
    expect(programmeFill("Something new")).toBeUndefined();
  });
});

describe("formatting the approved file uses", () => {
  it("writes a date with no comma after the weekday", () => {
    expect(longDate("2026-10-01")).toBe("Thu 01 Oct 2026");
  });

  it("writes times without a colon, as the file does", () => {
    expect(timeRange(sess({ startTime: "09:30", endTime: "12:30" }))).toBe("0930 – 1230");
    expect(timeRange(sess({ startTime: "" }))).toBe("");
  });
});
