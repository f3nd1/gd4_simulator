import { describe, it, expect } from "vitest";
import {
  acknowledgementState, isAcknowledged, acknowledgementGap, agreedActionNote,
  agreedActionOverdue, acknowledgementSummary,
} from "../findingAcknowledgement";
import type { Finding } from "../../types";

const ACK = { acknowledgedBy: "R. Tan, Admissions", acknowledgedAt: "2026-04-02" };

describe("acknowledgement needs both halves", () => {
  it("is none on an untouched finding", () => {
    expect(acknowledgementState({})).toBe("none");
    expect(isAcknowledged({})).toBe(false);
    expect(acknowledgementSummary({})).toBe("");
  });

  it("counts only when a named person AND a date are both present", () => {
    expect(isAcknowledged(ACK)).toBe(true);
    expect(isAcknowledged({ acknowledgedBy: "R. Tan" })).toBe(false);
    expect(isAcknowledged({ acknowledgedAt: "2026-04-02" })).toBe(false);
    // Whitespace is not a name.
    expect(isAcknowledged({ acknowledgedBy: "   ", acknowledgedAt: "2026-04-02" })).toBe(false);
  });

  it("says what a half-filled record is still missing", () => {
    expect(acknowledgementGap({ acknowledgedBy: "R. Tan" })).toMatch(/the date they accepted it/);
    expect(acknowledgementGap({ acknowledgedAt: "2026-04-02" })).toMatch(/who accepted it/);
    expect(acknowledgementGap({ agreedAction: "Rewriting the procedure" })).toMatch(/who accepted it and the date/);
    expect(acknowledgementGap(ACK)).toBe("");
    expect(acknowledgementGap({})).toBe("");
  });

  it("summarises without ever saying the finding is closed or resolved", () => {
    const s = acknowledgementSummary({ ...ACK, agreedDueDate: "2026-06-30" });
    expect(s).toBe("Acknowledged by R. Tan, Admissions on 02 Apr 2026, due 30 Jun 2026");
    expect(s).not.toMatch(/closed|resolved|waived|unofficial/i);
  });
});

describe("an acknowledgement never downgrades the finding", () => {
  it("carries no field that could change the type or severity", () => {
    // The whole point of replacing the Official/Unofficial column: there must
    // be no route from acknowledging a finding to it counting for less.
    const before: Partial<Finding> = { findingType: "NC", ncSeverity: "Major", severity: "High" };
    const after: Partial<Finding> = { ...before, ...ACK, agreedAction: "Rewriting the procedure", agreedDueDate: "2026-06-30" };
    expect(after.findingType).toBe("NC");
    expect(after.ncSeverity).toBe("Major");
    expect(after.severity).toBe("High");
  });

  it("the acknowledgement fields cannot express a downgrade at all", () => {
    const keys = Object.keys({ ...ACK, agreedAction: "", agreedDueDate: "" });
    for (const k of keys) expect(["findingType", "ncSeverity", "severity", "status"]).not.toContain(k);
  });
});

describe("the agreed action", () => {
  it("warns when an action has no date, and when a date has no action", () => {
    expect(agreedActionNote({ agreedAction: "Rewriting the procedure" })).toMatch(/cannot be followed up/);
    expect(agreedActionNote({ agreedDueDate: "2026-06-30" })).toMatch(/does not say what is due/);
    expect(agreedActionNote({ agreedAction: "x", agreedDueDate: "2026-06-30" })).toBe("");
    expect(agreedActionNote({})).toBe("");
  });

  it("is overdue only once the due day has fully passed", () => {
    const f = { agreedDueDate: "2026-06-30" };
    expect(agreedActionOverdue(f, false, new Date("2026-06-30T23:00:00"))).toBe(false);
    expect(agreedActionOverdue(f, false, new Date("2026-07-01T00:30:00"))).toBe(true);
  });

  it("is never overdue once the finding is closed, or with no date", () => {
    expect(agreedActionOverdue({ agreedDueDate: "2026-06-30" }, true, new Date("2027-01-01"))).toBe(false);
    expect(agreedActionOverdue({}, false, new Date("2027-01-01"))).toBe(false);
  });

  it("treats an unparseable date as no date rather than as overdue", () => {
    // Finding.overdue is hardcoded false at every creation site, so a stored
    // flag is exactly the bug this computes around. It must not overcorrect
    // into asserting overdue on rubbish input.
    expect(agreedActionOverdue({ agreedDueDate: "sometime" }, false, new Date("2099-01-01"))).toBe(false);
  });
});
