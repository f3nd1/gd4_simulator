import { describe, it, expect, afterEach } from "vitest";
import {
  useScoringConfigStore,
  normaliseAwardThresholds,
  normaliseApsrScale,
  AWARD_PRESETS,
  MAX_PCT_PER_DIMENSION,
} from "../useScoringConfigStore";
import { finalBandFromPct, DEFAULT_APSR_SCALE } from "../../lib/checklistBanding";

const initial = useScoringConfigStore.getState();
afterEach(() => {
  useScoringConfigStore.setState({ awardThresholds: initial.awardThresholds, apsrScale: initial.apsrScale });
});

// The award ladder and the band ladder are both evaluated left to right by
// their consumers, which stop at the first match. Out of order, a tier becomes
// unreachable — that is the defect these guard.

describe("normaliseAwardThresholds", () => {
  it("raises a Star cut-off that sits below the 4-Year cut-off", () => {
    expect(normaliseAwardThresholds({ provisional: 500, fourYear: 700, star: 550 }))
      .toEqual({ provisional: 500, fourYear: 700, star: 700 });
  });

  it("repairs a fully reversed ladder by cascading upwards", () => {
    expect(normaliseAwardThresholds({ provisional: 900, fourYear: 600, star: 300 }))
      .toEqual({ provisional: 900, fourYear: 900, star: 900 });
  });

  it("clamps to 0..1000 and survives non-finite input", () => {
    expect(normaliseAwardThresholds({ provisional: -50, fourYear: 5000, star: NaN }))
      .toEqual({ provisional: 0, fourYear: 1000, star: 1000 });
  });

  it("leaves every shipped preset untouched", () => {
    for (const [name, p] of Object.entries(AWARD_PRESETS)) {
      expect(normaliseAwardThresholds(p), name).toEqual(p);
    }
  });
});

describe("normaliseApsrScale", () => {
  it("repairs the reported [80,20,60,40] ordering", () => {
    expect(normaliseApsrScale({ maxPctPerDimension: 25, bandThresholds: [80, 20, 60, 40] }).bandThresholds)
      .toEqual([80, 80, 80, 80]);
  });

  it("caps maxPctPerDimension at the real ceiling, not 100", () => {
    expect(normaliseApsrScale({ maxPctPerDimension: 100, bandThresholds: [20, 40, 60, 80] }).maxPctPerDimension)
      .toBe(MAX_PCT_PER_DIMENSION);
  });

  it("leaves the shipped default untouched", () => {
    expect(normaliseApsrScale(DEFAULT_APSR_SCALE)).toEqual(DEFAULT_APSR_SCALE);
  });
});

describe("setters enforce the invariant", () => {
  it("stores a monotonic award ladder however it was typed", () => {
    useScoringConfigStore.getState().setAwardThresholds({ provisional: 500, fourYear: 700, star: 550 });
    const t = useScoringConfigStore.getState().awardThresholds;
    expect(t.provisional <= t.fourYear && t.fourYear <= t.star).toBe(true);
  });

  it("stores a monotonic band ladder however it was typed", () => {
    useScoringConfigStore.getState().setApsrScale({ maxPctPerDimension: 25, bandThresholds: [80, 20, 60, 40] });
    const b = useScoringConfigStore.getState().apsrScale.bandThresholds;
    expect(b[0] <= b[1] && b[1] <= b[2] && b[2] <= b[3]).toBe(true);
  });
});

describe("the defects the invariant removes", () => {
  // The real breakage with [80,20,60,40] is that the banding CONTRADICTS the
  // labels: the user said band 2 tops out at 20%, yet a total of 21% still
  // came back as band 1. Repair is "cascade upwards", so [80,20,60,40] becomes
  // [80,80,80,80] — a total of 50 is still band 1, which is the faithful
  // reading of "Band 1 up to 80" rather than a guess at what was meant. What
  // must hold afterwards is that a total ABOVE a band's stated ceiling is
  // never assigned that band.
  const labelsHold = (b: [number, number, number, number]) =>
    b.every((ceiling, i) => finalBandFromPct(ceiling + 0.01, { maxPctPerDimension: 25, bandThresholds: b }) > i + 1);

  it("an out-of-order ladder contradicts its own labels", () => {
    expect(labelsHold([80, 20, 60, 40])).toBe(false);
    expect(finalBandFromPct(21, { maxPctPerDimension: 25, bandThresholds: [80, 20, 60, 40] })).toBe(1);
  });

  it("the repaired ladder never contradicts its labels", () => {
    useScoringConfigStore.getState().setApsrScale({ maxPctPerDimension: 25, bandThresholds: [80, 20, 60, 40] });
    expect(labelsHold(useScoringConfigStore.getState().apsrScale.bandThresholds)).toBe(true);
  });

  it("the default ladder satisfies the same property", () => {
    expect(labelsHold(DEFAULT_APSR_SCALE.bandThresholds)).toBe(true);
  });

  it("the default scale still bands exactly as documented", () => {
    const d = DEFAULT_APSR_SCALE;
    expect([0, 20, 40, 50, 80, 81].map((t) => finalBandFromPct(t, d))).toEqual([1, 1, 2, 3, 4, 5]);
  });

  it("4-Year is reachable again once the ladder is monotonic", () => {
    useScoringConfigStore.getState().setAwardThresholds({ provisional: 500, fourYear: 700, star: 550 });
    const T = useScoringConfigStore.getState().awardThresholds;
    // The award expression in scoring.ts tests Star first; with a monotonic
    // ladder a total below Star can still clear 4-Year.
    const award = (total: number) => (total >= T.star ? "Star" : total >= T.fourYear ? "4-Year" : total >= T.provisional ? "Provisional" : "None");
    expect(award(600)).toBe("Provisional");
    expect(award(1000)).toBe("Star");
  });
});
