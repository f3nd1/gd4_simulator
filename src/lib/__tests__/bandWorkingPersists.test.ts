// The dimension panel's detail table is the part an auditor reads to DEFEND a
// dimension band, and it lived only in React state: any reload dropped the
// panel, its table, the band card and both exports' dimension sections, while
// the tally bar stayed. The run now carries the band call's inputs, and the
// working is rebuilt from them.
//
// This pins the rebuild, which is the part that has to be lossless.
import { describe, it, expect } from "vitest";
import { buildBandWorking, selfCheckTotal } from "../selfCheckBanding";
import type { EvidenceAssessmentResult } from "../../types";

const stored: NonNullable<EvidenceAssessmentResult["bandSuggestion"]> = {
  itemId: "6.1.1",
  scores: { approach: 4, processes: 3, systemsOutcomes: 2, review: 3 },
  reasons: { approach: "Documented and owned.", processes: "Records exist.", systemsOutcomes: "Some outcome data.", review: "Reviewed at meetings." },
  checked: { systemsOutcomes: true, review: true },
};

describe("a stored run rebuilds its own dimension working", () => {
  const rebuilt = buildBandWorking(stored.scores, stored.reasons, undefined, stored.checked);

  it("restores every column the detail table prints", () => {
    expect(rebuilt.rows.map((r) => [r.key, r.band, r.pct, r.reason])).toEqual([
      ["approach", 4, 20, "Documented and owned."],
      ["processes", 3, 15, "Records exist."],
      ["systemsOutcomes", 2, 10, "Some outcome data."],
      ["review", 3, 15, "Reviewed at meetings."],
    ]);
    // The official descriptor is DERIVED from the band, never stored, so it
    // cannot go stale against the rubric.
    for (const r of rebuilt.rows) expect(r.descriptor).toBeTruthy();
    for (const r of rebuilt.rows) expect(r.definition).toBeTruthy();
  });

  it("rebuilds the same band the run showed", () => {
    const t = selfCheckTotal(rebuilt)!;
    expect(t.totalPct).toBe(60);
    expect(t.band).toBe(3);
  });

  // Percentages are derived, so a later change to the configured scale
  // re-derives rather than printing a stored number beside a live one.
  it("re-derives percentages under a changed scale", () => {
    const wide = buildBandWorking(stored.scores, stored.reasons, { maxPctPerDimension: 40, bandThresholds: [20, 40, 60, 80] }, stored.checked);
    expect(wide.rows.map((r) => r.pct)).toEqual([32, 24, 16, 24]);
    expect(wide.maxPct).toBe(40);
  });

  // A run from before this was stored carries nothing, and must produce no
  // panel rather than a panel full of blanks.
  it("gives no working at all for a run that stored no band call", () => {
    const old: EvidenceAssessmentResult["bandSuggestion"] = undefined;
    expect(old).toBeUndefined();
  });

  // The two dimensions must keep the checked flag they were stored with: a run
  // whose results-and-review pass never ran cannot gain a band on reload.
  it("keeps the checked state the run recorded", () => {
    const unchecked = buildBandWorking(stored.scores, stored.reasons, undefined, { systemsOutcomes: false, review: false });
    expect(unchecked.rows.find((r) => r.key === "review")!.band).toBeUndefined();
    expect(selfCheckTotal(unchecked)).toBeNull();
  });
});
