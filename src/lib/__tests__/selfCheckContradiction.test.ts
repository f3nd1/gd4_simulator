// No two statements about what was assessed may disagree, and a dimension is
// scored ONLY when this run genuinely looked at it.
//
// The history behind both rules: ASSESSED_HERE was one hardcoded constant
// answering two questions at once, so the same row read "not assessed" in one
// column and "Checked against your own documents" in the next. And before that,
// scoring the two dimensions from the "Not evident" placeholder understated a
// genuinely Band 4 area as Band 3 (9f63527). Scoring is now tied to checking:
// both, or neither.
import { describe, it, expect } from "vitest";
import {
  buildBandWorking, bandGraphic, bandGraphicSvg, dimensionsNote, selfCheckTotal, selfCheckTotalWorking,
  SCREEN_BAND_PALETTE, TWO_DIMENSIONS_NOTE, THREE_FOLDERS_NOTE,
} from "../selfCheckBanding";

const scores = { approach: 3, processes: 2, systemsOutcomes: 4, review: 4 } as const;
const CHECKED = { systemsOutcomes: true, review: true };
const NOT = { systemsOutcomes: false, review: false };

describe("a dimension is scored exactly when it was checked", () => {
  it("scores all four once the results-and-review pass has produced verdicts", () => {
    const w = buildBandWorking(scores, {}, undefined, CHECKED);
    for (const r of w.rows) {
      expect(r.assessedHere).toBe(true);
      expect(r.checkedHere).toBe(true);
      expect(r.band).toBeDefined();
    }
  });

  it("never scores the two nobody looked at", () => {
    const w = buildBandWorking(scores, {}, undefined, NOT);
    for (const key of ["systemsOutcomes", "review"] as const) {
      const row = w.rows.find((r) => r.key === key)!;
      expect(row.assessedHere).toBe(false);
      expect(row.checkedHere).toBe(false);
      expect(row.band).toBeUndefined();
      expect(row.pct).toBe(0);
      expect(row.descriptor).toBe("");
    }
    // Approach and Processes are unaffected either way.
    for (const key of ["approach", "processes"] as const) {
      expect(w.rows.find((r) => r.key === key)!.band).toBeDefined();
    }
  });

  // An old stored result, or an export built without the flag, must not claim
  // a pass that may never have happened.
  it("defaults to not checked when nobody says otherwise", () => {
    expect(buildBandWorking(scores, {}).rows.find((r) => r.key === "review")!.checkedHere).toBe(false);
  });
});

describe("the band, and the gate on it", () => {
  it("gives a band only when all four carry one", () => {
    expect(selfCheckTotal(buildBandWorking(scores, {}, undefined, NOT))).toBeNull();
    expect(selfCheckTotal(undefined)).toBeNull();
    const t = selfCheckTotal(buildBandWorking(scores, {}, undefined, CHECKED))!;
    expect(t).not.toBeNull();
    // 15 + 10 + 20 + 20 = 65% -> Band 4, above the Band 3 ceiling two
    // dimensions imposed.
    expect(t.totalPct).toBe(65);
    expect(t.band).toBe(4);
    expect(selfCheckTotalWorking(t)).toBe("15% + 10% + 20% + 20% = 65% of 100%");
  });

  // The ceiling this change exists to lift, and the fact that it cuts both
  // ways: a weak pair pulls the total DOWN, it does not only raise it.
  it("lifts the ceiling, and can also lower the band", () => {
    const perfectTwo = selfCheckTotal(buildBandWorking({ approach: 5, processes: 5 }, {}, undefined, NOT));
    expect(perfectTwo).toBeNull(); // no band at all, which is the old behaviour
    const allFive = selfCheckTotal(buildBandWorking({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 }, {}, undefined, CHECKED))!;
    expect(allFive.band).toBe(5);
    const weakPair = selfCheckTotal(buildBandWorking({ approach: 3, processes: 2, systemsOutcomes: 1, review: 1 }, {}, undefined, CHECKED))!;
    expect(weakPair.totalPct).toBe(35);
    expect(weakPair.band).toBe(2);
  });

  // A band of 0 cannot arise: runHolisticBandSuggestion rejects anything
  // outside 1..5. If one ever did, it is missing data, not a score.
  it("refuses a band when a dimension somehow carries zero", () => {
    expect(selfCheckTotal(buildBandWorking({ approach: 3, processes: 2, systemsOutcomes: 0, review: 3 }, {}, undefined, CHECKED))).toBeNull();
  });
});

describe("every surface reads the same fact", () => {
  const svgOf = (checked: typeof CHECKED, sc: typeof scores = scores) =>
    bandGraphicSvg(bandGraphic(buildBandWorking(sc, {}, undefined, checked)), SCREEN_BAND_PALETTE);

  it("says not assessed only about a dimension nobody looked at", () => {
    expect(svgOf(NOT)).toContain("not assessed by this check");
    expect(svgOf(CHECKED)).not.toContain("not assessed");
  });

  it("picks the all-four note only when all four were scored", () => {
    expect(dimensionsNote(buildBandWorking(scores, {}, undefined, CHECKED))).toBe(THREE_FOLDERS_NOTE);
    expect(dimensionsNote(buildBandWorking(scores, {}, undefined, NOT))).toBe(TWO_DIMENSIONS_NOTE);
    expect(dimensionsNote(undefined)).toBe(TWO_DIMENSIONS_NOTE);
  });

  // The failure this file exists to prevent: a page that says both things.
  it("cannot call a dimension not assessed and also score it", () => {
    const w = buildBandWorking(scores, {}, undefined, CHECKED);
    const text = `${svgOf(CHECKED)} ${dimensionsNote(w)}`;
    expect(w.rows.every((r) => r.assessedHere)).toBe(true);
    expect(text).not.toMatch(/not assessed/);
  });

  it("and cannot show a band while calling two of them not assessed", () => {
    const w = buildBandWorking(scores, {}, undefined, NOT);
    expect(selfCheckTotal(w)).toBeNull();
    expect(dimensionsNote(w)).toBe(TWO_DIMENSIONS_NOTE);
  });
});
