import { describe, it, expect } from "vitest";
import {
  CALENDAR_HEADERS, rowsFromCsv, rowsFromGrid, importKeyOf, kindOf, auditorMustBe,
  independenceAgrees, buildImportPreview, applyImportPreview, calendarRowsOut,
  normaliseAuditors, countsByKind,
} from "../iqaCalendar";
import { sessionKind, sessionSlot, planWarnings, EMPTY_PLAN_HEADER, type AuditSession } from "../auditPlan";
import { departmentForScope, documentsForScope } from "../departments";
import { scopeTitle } from "../evidenceScope";

const H = CALENDAR_HEADERS.join(",");
// Built strictly to the stated column order. Three kinds of row.
//
// The title is QUOTED because scopeTitle("4.1") contains a comma
// ("Pre-Course Counselling, Student Selection and Admissions"). An unquoted
// export of that cell misaligns every column after it, which is worth a test
// of its own below.
const AUDIT = `2026-10-06,Tue,09:00,10:30,90,IQA,4,4.1,"${scopeTitle("4.1")}",SSO-AD,PPD-SSO-AD-4.1.1,IQA session,Counselling records,Not from SSO-AD,R. Lim,Tentative`;
const SUPPORT = `2026-10-06,Tue,08:30,09:00,30,Opening meeting,,,,,,Opening meeting,Scope and logistics,,All auditors,Tentative`;
const PROGRAMME = `2026-10-01,Thu,,,,Self-check,,,,,,Process owner self-check,All areas,,TBC,Tentative`;
const csv = (...lines: string[]) => [H, ...lines].join("\r\n");

const preview = (text: string, existing: AuditSession[] = []) =>
  buildImportPreview(rowsFromCsv(text).rows, existing);

describe("reading the file", () => {
  it("accepts the stated columns and reports any that are missing", () => {
    expect(rowsFromCsv(csv(AUDIT)).missingHeaders).toEqual([]);
    const short = rowsFromCsv("Date,Day\n2026-10-06,Tue");
    expect(short.missingHeaders).toContain("GD4 area");
    expect(short.missingHeaders).toContain("Status");
  });

  it("reads the same rows from a grid, so .xlsx and .csv share one path", () => {
    const grid = [[...CALENDAR_HEADERS], AUDIT.split(",")];
    expect(rowsFromGrid(grid).rows[0].cells["GD4 area"]).toBe("4.1");
  });

  it("ignores wholly blank lines rather than calling them rows that do not fit", () => {
    expect(rowsFromCsv(csv(AUDIT, ",,,,,,,,,,,,,,,")).rows.length).toBe(1);
  });
});

describe("what kind of row it is", () => {
  it("is an audit when it names a GD4 area", () => {
    expect(kindOf({ "GD4 area": "4.1", Start: "09:00" })).toBe("audit");
  });
  it("is a supporting slot when it has a time but no area", () => {
    expect(kindOf({ "GD4 area": "", Start: "12:30" })).toBe("support");
  });
  it("is a programme day when it has neither", () => {
    expect(kindOf({ "GD4 area": "", Start: "" })).toBe("programme");
  });
  it("lands all three in one session list", () => {
    const p = preview(csv(AUDIT, SUPPORT, PROGRAMME));
    expect(p.create.length).toBe(3);
    expect(countsByKind(p.create)).toEqual({ audit: 1, support: 1, programme: 1 });
  });
  it("does not warn that a lunch break or a programme day covers no GD4 area", () => {
    const p = preview(csv(SUPPORT, PROGRAMME));
    const w = planWarnings(EMPTY_PLAN_HEADER, p.create).join(" ");
    expect(w).not.toMatch(/covers? no GD4 area/);
  });
});

describe("the register is the only source of title, owner and document", () => {
  it("never stores the file's copies on the session", () => {
    const [s] = preview(csv(AUDIT)).create;
    const keys = Object.keys(s);
    for (const k of ["areaTitle", "owningDepartment", "documentCode", "auditorMustBe", "criterion"]) {
      expect(keys).not.toContain(k);
    }
  });

  it("reports a disagreement instead of choosing a side", () => {
    const wrong = AUDIT.replace("SSO-AD", "OEE-FN").replace("PPD-SSO-AD-4.1.1", "PPD-OEE-FN-9.9.9");
    const d = preview(csv(wrong)).disagreements;
    expect(d.find((x) => x.field === "Owning department")).toMatchObject({ inFile: "OEE-FN", inRegister: "SSO-AD" });
    expect(d.find((x) => x.field === "Document code")).toMatchObject({ inRegister: "PPD-SSO-AD-4.1.1" });
  });

  it("treats a blank cell as the file not saying, not as a disagreement", () => {
    const blank = `2026-10-06,Tue,09:00,10:30,90,IQA,,4.1,,,,IQA session,x,,R. Lim,Tentative`;
    expect(preview(csv(blank)).disagreements).toEqual([]);
  });

  it("does not report a difference that is only punctuation or a Criterion prefix", () => {
    const t = scopeTitle("4.1").replace(/&/g, "and");
    const soft = `2026-10-06,Tue,09:00,10:30,90,IQA,Criterion 4,4.1,"${t}",SSO-AD,PPD-SSO-AD-4.1.1,IQA,x,,R. Lim,Tentative`;
    expect(preview(csv(soft)).disagreements).toEqual([]);
  });

  it("exports title, owner and document from the register, whatever the file said", () => {
    const wrong = AUDIT.replace("SSO-AD", "OEE-FN");
    const [row] = calendarRowsOut(preview(csv(wrong)).create);
    expect(row[9]).toBe("SSO-AD");
    expect(row[8]).toBe(scopeTitle("4.1"));
    expect(row[10]).toBe(documentsForScope("4.1").map((d) => d.code).join("; "));
  });
});

describe("independence is computed, never imported", () => {
  it("states the app's own answer from the owning department", () => {
    expect(auditorMustBe("4.1")).toBe("Not from SSO-AD");
    expect(departmentForScope("4.1")).toBe("AD");
  });

  it("agrees when the file names the same department", () => {
    expect(independenceAgrees("Not from SSO-AD", "4.1")).toBe(true);
    expect(independenceAgrees("must not be from AD", "4.1")).toBe(true);
    expect(independenceAgrees("", "4.1")).toBe(true);
  });

  it("reports a row where the file names a different department", () => {
    const wrong = AUDIT.replace("Not from SSO-AD", "Not from OEE-FN");
    const [m] = preview(csv(wrong)).independence;
    expect(m).toMatchObject({ scopeId: "4.1", inFile: "Not from OEE-FN", appSays: "Not from SSO-AD" });
  });
});

describe("rows that do not fit are listed, never dropped", () => {
  it("rejects a row with no date, and says why", () => {
    const p = preview(csv(`,Tue,09:00,10:30,90,IQA,4,4.1,x,SSO-AD,y,IQA,x,,R. Lim,Tentative`));
    expect(p.create).toEqual([]);
    expect(p.rejected[0].reason).toMatch(/No date/);
  });

  it("rejects an area this app does not have, rather than inventing one", () => {
    const p = preview(csv(AUDIT.replace(",4.1,", ",9.9,")));
    expect(p.rejected[0].reason).toMatch(/not a GD4 area/);
  });

  it("rejects an unreadable date", () => {
    expect(preview(csv(AUDIT.replace("2026-10-06", "6 Oct 26"))).rejected[0].reason).toMatch(/not a YYYY-MM-DD date/);
  });

  it("rejects the second of two rows it cannot tell apart", () => {
    const p = preview(csv(AUDIT, AUDIT));
    expect(p.create.length).toBe(1);
    expect(p.rejected[0].reason).toMatch(/cannot be told apart/);
  });
});

describe("status and auditors", () => {
  it("keeps Tentative verbatim so the plan never reads as confirmed", () => {
    expect(preview(csv(AUDIT)).create[0].status).toBe("Tentative");
    expect(calendarRowsOut(preview(csv(AUDIT)).create)[0][15]).toBe("Tentative");
  });

  it("leaves TBC unassigned instead of creating an auditor called TBC", () => {
    expect(normaliseAuditors("TBC")).toBe("");
    expect(normaliseAuditors("tba")).toBe("");
    expect(normaliseAuditors("R. Lim")).toBe("R. Lim");
    expect(preview(csv(PROGRAMME)).create[0].auditorNames).toBe("");
  });
});

describe("re-import never duplicates", () => {
  it("matches every row back to the session it made", () => {
    const first = preview(csv(AUDIT, SUPPORT, PROGRAMME));
    const saved = applyImportPreview([], first);
    expect(saved.length).toBe(3);
    const again = buildImportPreview(rowsFromCsv(csv(AUDIT, SUPPORT, PROGRAMME)).rows, saved);
    expect(again.create).toEqual([]);
    expect(again.update).toEqual([]);
    expect(again.unchanged).toBe(3);
    expect(applyImportPreview(saved, again).length).toBe(3);
  });

  it("changes only the row that changed", () => {
    const saved = applyImportPreview([], preview(csv(AUDIT, SUPPORT)));
    const edited = AUDIT.replace("09:00,10:30,90", "09:00,11:00,120").replace("R. Lim", "R. Lim; F. Ng");
    const again = buildImportPreview(rowsFromCsv(csv(edited, SUPPORT)).rows, saved);
    expect(again.create).toEqual([]);
    expect(again.unchanged).toBe(1);
    expect(again.update.length).toBe(1);
    expect(again.update[0].changes).toEqual(["End: 10:30 → 11:00", "Duration: 90 → 120", "Auditors: R. Lim → R. Lim; F. Ng"]);
    // Same session, same id: anything pointing at it still points at it.
    expect(again.update[0].after.id).toBe(again.update[0].before.id);
  });

  it("changing the start time makes a NEW row and lists the old one as gone", () => {
    // The start time is part of a row's identity, so this is honestly a
    // different slot rather than an edit the app can follow.
    const saved = applyImportPreview([], preview(csv(AUDIT)));
    const moved = AUDIT.replace("09:00,10:30", "14:00,15:30");
    const again = buildImportPreview(rowsFromCsv(csv(moved)).rows, saved);
    expect(again.create.length).toBe(1);
    expect(again.removed.length).toBe(1);
    expect(applyImportPreview(saved, again).length).toBe(1);
  });

  it("lists a session from an earlier import that the new file drops", () => {
    const saved = applyImportPreview([], preview(csv(AUDIT, SUPPORT)));
    const again = buildImportPreview(rowsFromCsv(csv(AUDIT)).rows, saved);
    expect(again.removed.map((s) => s.activityType)).toEqual(["Opening meeting"]);
    expect(applyImportPreview(saved, again).length).toBe(1);
  });

  it("never touches a session added by hand", () => {
    const byHand: AuditSession = { id: "HAND-1", day: "2026-11-02", startTime: "10:00", durationMins: 60, auditeeFunction: "Finance", auditorNames: "", scopeIds: ["4.4"], notes: "", kind: "audit" };
    const p = buildImportPreview(rowsFromCsv(csv(AUDIT)).rows, [byHand]);
    expect(p.keptByHand).toBe(1);
    expect(p.removed).toEqual([]);
    expect(applyImportPreview([byHand], p).find((s) => s.id === "HAND-1")).toEqual(byHand);
  });
});

describe("round trip", () => {
  it("writes back exactly the stated columns, in order", () => {
    expect(CALENDAR_HEADERS.length).toBe(16);
    expect(calendarRowsOut(preview(csv(AUDIT)).create)[0].length).toBe(16);
  });

  it("returns every column the app stores, unchanged", () => {
    const [row] = calendarRowsOut(preview(csv(AUDIT)).create);
    // Split on commas OUTSIDE quotes, since the title carries one.
    const original = AUDIT.match(/("[^"]*"|[^,]*)/g)!.filter((_, i) => i % 2 === 0).map((c) => c.replace(/^"|"$/g, ""));
    for (const i of [0, 1, 2, 3, 4, 5, 7, 11, 12, 14, 15]) expect(row[i]).toBe(original[i]);
  });

  it("keeps the file's own End time rather than recomputing one", () => {
    const [s] = preview(csv(AUDIT.replace("09:00,10:30,90", "09:00,10:45,90"))).create;
    expect(sessionSlot(s)).toBe("09:00-10:45");
  });

  it("round-trips a programme day with its blank cells intact", () => {
    const [row] = calendarRowsOut(preview(csv(PROGRAMME)).create);
    expect(row).toEqual(["2026-10-01", "Thu", "", "", "", "Self-check", "", "", "", "", "", "Process owner self-check", "All areas", "", "", "Tentative"]);
  });
});

describe("kind survives a session written before kind existed", () => {
  it("derives it from what the session holds", () => {
    const old = (scopeIds: string[], startTime: string) =>
      ({ id: "x", day: "2026-10-06", startTime, durationMins: 0, auditeeFunction: "", auditorNames: "", scopeIds, notes: "" }) as AuditSession;
    expect(sessionKind(old(["4.1"], "09:00"))).toBe("audit");
    expect(sessionKind(old([], "12:30"))).toBe("support");
    expect(sessionKind(old([], ""))).toBe("programme");
  });
});

describe("a title containing a comma", () => {
  it("reads correctly when quoted, and is caught when it is not", () => {
    // "Pre-Course Counselling, Student Selection and Admissions" splits an
    // unquoted row into 17 cells and shifts Status into Auditors.
    expect(scopeTitle("4.1")).toContain(",");
    expect(preview(csv(AUDIT)).create[0].status).toBe("Tentative");
    const unquoted = AUDIT.replace(`"${scopeTitle("4.1")}"`, scopeTitle("4.1"));
    expect(preview(csv(unquoted)).create[0].status).not.toBe("Tentative");
  });
});

describe("identity", () => {
  it("is date, start, area and activity type, case-insensitively", () => {
    const a = importKeyOf({ Date: "2026-10-06", Start: "09:00", "GD4 area": "4.1", "Activity type": "IQA" });
    const b = importKeyOf({ Date: "2026-10-06", Start: "09:00", "GD4 area": "4.1", "Activity type": "iqa" });
    expect(a).toBe(b);
  });
});
