// No two statements about what was assessed may disagree.
//
// They did: ASSESSED_HERE was one hardcoded constant driving both "does this
// page score it" and "did this run look at it", so the same row read
// "not assessed" in the Earned column and "Checked against your own documents"
// in the next one. They are now separate facts, and every surface reads the
// same one.
import { describe, it, expect } from "vitest";
import { buildBandWorking, bandGraphic, bandGraphicSvg, dimensionsNote, SCREEN_BAND_PALETTE, TWO_DIMENSIONS_NOTE, THREE_FOLDERS_NOTE } from "../selfCheckBanding";

const scores = { approach: 4, processes: 3, systemsOutcomes: 2, review: 3 } as const;
const CHECKED = { systemsOutcomes: true, review: true };
const NOT = { systemsOutcomes: false, review: false };

describe("scored here and checked here are different facts", () => {
  it("never scores Systems & Outcomes or Review, checked or not", () => {
    for (const checked of [CHECKED, NOT]) {
      const w = buildBandWorking(scores, {}, undefined, checked);
      for (const key of ["systemsOutcomes", "review"] as const) {
        const row = w.rows.find((r) => r.key === key)!;
        expect(row.assessedHere).toBe(false);
        expect(row.band).toBeUndefined();
        expect(row.pct).toBe(0);
        expect(row.descriptor).toBe("");
      }
    }
  });

  it("marks them checked only when the pass produced verdicts", () => {
    const yes = buildBandWorking(scores, {}, undefined, CHECKED);
    const no = buildBandWorking(scores, {}, undefined, NOT);
    for (const key of ["systemsOutcomes", "review"] as const) {
      expect(yes.rows.find((r) => r.key === key)!.checkedHere).toBe(true);
      expect(no.rows.find((r) => r.key === key)!.checkedHere).toBe(false);
    }
    // The two this page DOES score are always both.
    for (const key of ["approach", "processes"] as const) {
      expect(no.rows.find((r) => r.key === key)!.checkedHere).toBe(true);
      expect(no.rows.find((r) => r.key === key)!.assessedHere).toBe(true);
    }
  });

  // An old stored result, or an export built without the flag, must not claim
  // a pass that may never have happened.
  it("defaults to not checked when nobody says otherwise", () => {
    const w = buildBandWorking(scores, {});
    expect(w.rows.find((r) => r.key === "review")!.checkedHere).toBe(false);
  });
});

describe("the drawn panel says the same thing as the table", () => {
  const textOf = (checked: typeof CHECKED) =>
    bandGraphicSvg(bandGraphic(buildBandWorking(scores, {}, undefined, checked)), SCREEN_BAND_PALETTE);

  it("says checked-not-scored, not not-assessed, once the pass has run", () => {
    const svg = textOf(CHECKED);
    expect(svg).toContain("checked, not scored here");
    expect(svg).not.toContain("not assessed by this check");
  });

  it("still says not assessed when the pass did not run", () => {
    const svg = textOf(NOT);
    expect(svg).toContain("not assessed by this check");
    expect(svg).not.toContain("checked, not scored here");
  });
});

describe("the note under the panel comes from the panel", () => {
  it("picks the three-pass note only when a dimension was checked", () => {
    expect(dimensionsNote(buildBandWorking(scores, {}, undefined, CHECKED))).toBe(THREE_FOLDERS_NOTE);
    expect(dimensionsNote(buildBandWorking(scores, {}, undefined, NOT))).toBe(TWO_DIMENSIONS_NOTE);
    expect(dimensionsNote(undefined)).toBe(TWO_DIMENSIONS_NOTE);
  });

  // The failure this whole file exists to prevent.
  it("cannot say 'not assessed' about a dimension it also calls checked", () => {
    const w = buildBandWorking(scores, {}, undefined, CHECKED);
    const svg = bandGraphicSvg(bandGraphic(w), SCREEN_BAND_PALETTE);
    const note = dimensionsNote(w);
    const claimsChecked = w.rows.some((r) => !r.assessedHere && r.checkedHere);
    expect(claimsChecked).toBe(true);
    expect(`${svg} ${note}`).not.toMatch(/not assessed/);
  });
});
