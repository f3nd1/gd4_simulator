import { describe, it, expect } from "vitest";
import { getBand, needsJustification, aiScore, levelValue, buildScored, type ScoringInput } from "../scoring";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { ItemEvidence, EvidenceLevel } from "../../types";

function mkEv(level: EvidenceLevel, drive: boolean): ItemEvidence {
  return { approach: level, processes: level, systemsOutcomes: level, review: level, owner: "SQ", age: 10, trace: 100, drive: drive ? "https://drive.google.com/x" : undefined };
}

// Build a full evidence map for all 35 items at a given level/drive.
function fullEvidence(level: EvidenceLevel, drive: boolean): Record<string, ItemEvidence> {
  const m: Record<string, ItemEvidence> = {};
  for (const r of GD4_REQUIREMENTS) m[r.id] = mkEv(level, drive);
  return m;
}

function input(evidence: Record<string, ItemEvidence>, awardThresholds?: ScoringInput["awardThresholds"]): ScoringInput {
  return { evidence, reviewer: {}, confirmed: {}, closures: {}, awardThresholds };
}

describe("getBand thresholds", () => {
  it("maps scores to bands", () => {
    expect(getBand(90)).toBe(5);
    expect(getBand(70)).toBe(4);
    expect(getBand(55)).toBe(3);
    expect(getBand(40)).toBe(2);
    expect(getBand(0)).toBe(1);
  });
});

describe("levelValue / aiScore", () => {
  it("levelValue", () => {
    expect(levelValue("good")).toBe(1);
    expect(levelValue("Partial")).toBe(0.5);
    expect(levelValue("Missing")).toBe(0);
  });
  it("aiScore is 100 when all limbs good", () => {
    expect(aiScore(mkEv("good", true))).toBe(100);
  });
  it("aiScore is 0 when all limbs missing", () => {
    expect(aiScore(mkEv("Missing", false))).toBe(0);
  });
});

describe("buildScored tolerates a partial evidence map (persisted-state drift)", () => {
  // Regression: a persisted workspace whose evidence map predates an item id
  // (the GD4 re-align added/renamed/removed items) left a current id absent.
  // buildScored indexed it without a guard, so aiScore read
  // `undefined.approach` and white-screened the whole app.
  it("does not throw when an item's evidence entry is missing", () => {
    const evidence = fullEvidence("good", true);
    delete evidence["7.1.1"];       // simulate a current item with no evidence entry
    delete evidence["2.1.1"];       // and a split item
    expect(() => buildScored(input(evidence))).not.toThrow();
  });
  it("treats a missing evidence entry as an unstarted item (all limbs missing)", () => {
    const evidence = fullEvidence("good", true);
    delete evidence["7.1.1"];
    const scored = buildScored(input(evidence));
    const item = scored.items.find((i) => i.id === "7.1.1")!;
    expect(item.ais).toBe(0);
    expect(item.started).toBe(false);
  });
});

describe("needsJustification", () => {
  it("requires justification for a big gap (>=5)", () => {
    expect(needsJustification(60, 70, false)).toBe(true);
  });
  it("no justification for a small non-gate change", () => {
    expect(needsJustification(60, 62, false)).toBe(false);
  });
  it("gate item: requires justification when scored ABOVE the AI", () => {
    expect(needsJustification(60, 62, true)).toBe(true);
  });
  it("gate item: requires justification when scored BELOW the AI too (the fix)", () => {
    expect(needsJustification(60, 58, true)).toBe(true);
  });
  it("gate item: equal score needs none", () => {
    expect(needsJustification(60, 60, true)).toBe(false);
  });
});

describe("buildScored — evidence cap", () => {
  it("no Drive link caps every item at Band 1 even with perfect limbs", () => {
    const s = buildScored(input(fullEvidence("good", false)));
    expect(s.items.every((i) => i.band === 1)).toBe(true);
  });
  it("full evidence + Drive link → all Band 5, max total, gate passes", () => {
    const s = buildScored(input(fullEvidence("good", true)));
    expect(s.items.every((i) => i.band === 5)).toBe(true);
    expect(s.total).toBe(1000);
    expect(s.gatePass).toBe(true);
  });
});

describe("buildScored — award tiers honour configurable thresholds", () => {
  it("max score is Star under default thresholds", () => {
    const s = buildScored(input(fullEvidence("good", true)));
    expect(s.award).toContain("Star");
  });
  it("max score is NOT Star if the star threshold is raised above it", () => {
    const s = buildScored(input(fullEvidence("good", true), { provisional: 500, fourYear: 700, star: 1001 }));
    expect(s.award).not.toContain("Star");
    expect(s.award).toContain("4-Year");
  });
  it("zero-evidence workspace scores zero and is Not certified", () => {
    // Each criterion's effective score is 0, so the all-zero special case
    // awards nothing. With no evidence the gate groups also fail (Band 0/1 < 3),
    // so the award string includes the gate-fail suffix.
    const s = buildScored(input(fullEvidence("Missing", false)));
    expect(s.total).toBe(0);
    expect(s.award).toMatch(/Not certified/);
    expect(s.gatePass).toBe(false);
  });
});

describe("buildScored — gate failure caps the award", () => {
  it("failing Criterion 5 (gate) blocks/cap a high score", () => {
    const evidence = fullEvidence("good", true);
    // Knock Criterion 5 items down to no evidence → band 1 → gate fails.
    for (const r of GD4_REQUIREMENTS) if (r.criterion === "5") evidence[r.id] = mkEv("Missing", false);
    const s = buildScored(input(evidence));
    expect(s.gatePass).toBe(false);
    expect(s.gateFail.some((g) => g.id === "Criterion 5")).toBe(true);
  });
});

// 2026-07-19: 4.2.1 and 4.2.2 are gated INDEPENDENTLY (Felix's explicit
// instruction), not averaged as one "Sub-criterion 4.2" group — this is the
// behaviour change locked in by these tests.
describe("buildScored — 4.2.1 and 4.2.2 are independent gates, not averaged", () => {
  it("Band 4 on 4.2.1 does NOT rescue a Band 2 on 4.2.2 (avg would be 3, but each must independently clear 3)", () => {
    const evidence = fullEvidence("good", true);
    // 4.2.1 -> Band 4 (aiScore 72.5, rounds to 73, >=70 <85).
    evidence["4.2.1"] = { approach: "Partial", processes: "Partial", systemsOutcomes: "good", review: "good", owner: "SQ", age: 10, trace: 100, drive: "https://drive.google.com/x" };
    // 4.2.2 -> Band 2 (aiScore 45, >=40 <55).
    evidence["4.2.2"] = { approach: "Missing", processes: "Missing", systemsOutcomes: "good", review: "good", owner: "SQ", age: 10, trace: 100, drive: "https://drive.google.com/x" };
    const s = buildScored(input(evidence));
    expect(s.items.find((i) => i.id === "4.2.1")?.band).toBe(4);
    expect(s.items.find((i) => i.id === "4.2.2")?.band).toBe(2);
    // Averaged, (4+2)/2 = 3 would PASS the old single "Sub-criterion 4.2"
    // group — the independent-gate behaviour must fail it instead.
    expect(s.gateFail.some((g) => g.id === "4.2.2")).toBe(true);
    expect(s.gateFail.some((g) => g.id === "4.2.1")).toBe(false);
    expect(s.gatePass).toBe(false);
  });

  it("both at Band 3+ independently: gate passes on 4.2.1/4.2.2 (all-good baseline)", () => {
    const s = buildScored(input(fullEvidence("good", true)));
    expect(s.items.find((i) => i.id === "4.2.1")?.band).toBe(5);
    expect(s.items.find((i) => i.id === "4.2.2")?.band).toBe(5);
    expect(s.gateFail.some((g) => g.id === "4.2.1" || g.id === "4.2.2")).toBe(false);
  });
});

// Batch 1 scoring-honesty fixes: criterion points come from CAPPED item
// bands (not raw eff), and a failed gate denies the tier outright.
describe("buildScored — award computed from capped bands", () => {
  it("all-good limbs with NO Drive evidence: Band-1 caps flow through to the total and award", () => {
    const s = buildScored(input(fullEvidence("good", false)));
    expect(s.items.every((i) => i.band === 1)).toBe(true);
    // Every criterion at uniform Band 1 = exactly 1/5 of its points → 200/1000.
    // Previously the UNCAPPED eff average (100) fed the criterion band, so
    // this same workspace totalled 1000 and was awarded Star.
    expect(s.total).toBe(200);
    expect(s.award).toMatch(/Not certified/);
    expect(s.award).not.toMatch(/Star|4-Year|Provisional/);
  });

  it("gate failure forces the award to Not certified even at a Star-level total", () => {
    const evidence = fullEvidence("good", true);
    for (const r of GD4_REQUIREMENTS) if (r.criterion === "5") evidence[r.id] = mkEv("Missing", false);
    const s = buildScored(input(evidence));
    // Criterion 5 drops to Band 1 (−160 points) but the total still clears
    // the Star threshold — the failed gate must deny the tier anyway.
    expect(s.total).toBeGreaterThanOrEqual(750);
    expect(s.gatePass).toBe(false);
    expect(s.award).toBe("Not certified — critical gate not met");
  });
});
