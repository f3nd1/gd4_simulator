import { describe, it, expect } from "vitest";
import { navDoneMap, NAV_DONE_PATHS, type NavDoneSignals } from "../navProgress";

const ALL_FALSE: NavDoneSignals = {
  cyclePeriodSet: false, auditorsAdded: false, foldersLinked: false, checklistScored: false,
  ppdReviewed: false, allFindingsClosed: false, allScoresConfirmed: false, cycleLocked: false, exported: false,
};

describe("navDoneMap — ticks are backed by real signals only", () => {
  it("maps every signal to its sidebar path", () => {
    const m = navDoneMap({ ...ALL_FALSE, auditorsAdded: true, cycleLocked: true });
    expect(m["/auditors"]).toBe(true);
    expect(m["/finalisation"]).toBe(true);
    expect(m["/audit-cycle"]).toBe(false); // signal exists but not complete → no tick
  });

  it("only ever produces keys for signal-backed steps — never for number-only steps", () => {
    const m = navDoneMap(ALL_FALSE);
    const keys = Object.keys(m).sort();
    // Distinct paths only: foldersLinked and ppdReviewed now share /evidence-folder.
    expect(keys).toEqual([...new Set(Object.values(NAV_DONE_PATHS))].sort());
    // Number-only steps must never appear (no fabricated tick surface).
    for (const p of ["/profile-of-pei", "/start-audit", "/findings", "/management-review", "/final-report", "/", "/settings"]) {
      expect(p in m).toBe(false);
    }
  });

  it("all-false input yields no ticks (every value false, none omitted)", () => {
    const m = navDoneMap(ALL_FALSE);
    expect(Object.values(m).every((v) => v === false)).toBe(true);
    // 9 signals, but foldersLinked + ppdReviewed share /evidence-folder → 8 paths.
    expect(Object.keys(m)).toHaveLength(8);
  });

  it("either foldersLinked OR ppdReviewed ticks /evidence-folder", () => {
    expect(navDoneMap({ ...ALL_FALSE, foldersLinked: true })["/evidence-folder"]).toBe(true);
    expect(navDoneMap({ ...ALL_FALSE, ppdReviewed: true })["/evidence-folder"]).toBe(true);
    expect(navDoneMap(ALL_FALSE)["/evidence-folder"]).toBe(false);
  });
});
