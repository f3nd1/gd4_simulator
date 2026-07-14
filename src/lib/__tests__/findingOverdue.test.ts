import { describe, it, expect } from "vitest";
import { isFindingOverdue } from "../findingClassification";

// Fixed reference "now" so the test is deterministic (not clock-dependent).
const NOW = new Date("2026-07-14T12:00:00Z").getTime();

describe("isFindingOverdue — computed from dueDate, never the hardcoded flag", () => {
  it("is overdue when open and the due date is in the past", () => {
    expect(isFindingOverdue("2026-07-01", false, NOW)).toBe(true);
  });
  it("is NOT overdue once closed, even if the due date passed", () => {
    expect(isFindingOverdue("2026-07-01", true, NOW)).toBe(false);
  });
  it("is NOT overdue when the due date is still in the future", () => {
    expect(isFindingOverdue("2026-08-01", false, NOW)).toBe(false);
  });
  it("due end-of-day: today's date is not yet overdue at midday", () => {
    expect(isFindingOverdue("2026-07-14", false, NOW)).toBe(false);
  });
  it("no due date → never overdue (can't be late for an undated action)", () => {
    expect(isFindingOverdue(undefined, false, NOW)).toBe(false);
    expect(isFindingOverdue("", false, NOW)).toBe(false);
  });
  it("garbage date → not overdue, not a crash", () => {
    expect(isFindingOverdue("not-a-date", false, NOW)).toBe(false);
  });
});
