import { describe, it, expect } from "vitest";
import { buildRuleInjection, changeSummaryOf, scoreCompareText, isWorseThanChampion, caughtRate, DEFAULT_RULE_CONTENT, type RuleContent, type RuleVersion } from "../ruleTuning";

const content = (over: Partial<RuleContent> = {}): RuleContent => ({ ...DEFAULT_RULE_CONTENT, perCriterionMetPartial: {}, perCriterionGuidance: {}, ...over });
const version = (over: Partial<RuleVersion> = {}): RuleVersion => ({ id: "v", createdAt: "2026-07-04T00:00:00Z", content: content(), ...over });

describe("buildRuleInjection", () => {
  it("returns empty for the default baseline (no-op)", () => {
    expect(buildRuleInjection(DEFAULT_RULE_CONTENT, "6")).toBe("");
    expect(buildRuleInjection(DEFAULT_RULE_CONTENT)).toBe("");
  });
  it("injects the global Met/Partial rule, labelled with scope and the core-wins statement", () => {
    const s = buildRuleInjection(content({ metPartial: "Met needs every promise evidenced." }), "6.2");
    expect(s).toContain("added to the assessment prompt for Criterion 6");
    expect(s).toContain("do NOT override the core");
    expect(s).toContain("Met needs every promise evidenced.");
  });
  it("prefers a per-criterion Met/Partial override over the global one", () => {
    const s = buildRuleInjection(content({ metPartial: "GLOBAL", perCriterionMetPartial: { "6": "C6 SPECIFIC" } }), "6.3");
    expect(s).toContain("C6 SPECIFIC");
    expect(s).not.toContain("GLOBAL");
  });
  it("includes per-criterion guidance only for that criterion", () => {
    const c = content({ perCriterionGuidance: { "6": "watch document control" } });
    expect(buildRuleInjection(c, "6.1")).toContain("watch document control");
    expect(buildRuleInjection(c, "2.1")).toBe(""); // criterion 2 has nothing
  });
});

describe("changeSummaryOf", () => {
  it("names the changed field and flags added / stricter", () => {
    expect(changeSummaryOf(content(), content({ metPartial: "x" }))).toContain("global Met/Partial rule (added)");
    const stricter = changeSummaryOf(content({ metPartial: "documented" }), content({ metPartial: "must be documented and every promise evidenced" }));
    expect(stricter).toContain("stricter");
    expect(changeSummaryOf(content({ perCriterionGuidance: {} }), content({ perCriterionGuidance: { "6": "note" } }))).toContain("C6 guidance (added)");
  });
  it("reports no changes when identical", () => {
    expect(changeSummaryOf(content({ metPartial: "same" }), content({ metPartial: "same" }))).toBe("No changes.");
  });
});

describe("scoreCompareText", () => {
  it("both up → better", () => {
    const s = scoreCompareText(version({ consistencyPct: 85, benchmarkCaught: 38, benchmarkTotal: 54 }), version({ consistencyPct: 40, benchmarkCaught: 35, benchmarkTotal: 54 }));
    expect(s).toContain("consistency +45%");
    expect(s).toContain("accuracy +3 caught");
    expect(s).toContain("better");
  });
  it("consistency up but accuracy down → mixed", () => {
    const s = scoreCompareText(version({ consistencyPct: 90, benchmarkCaught: 30, benchmarkTotal: 54 }), version({ consistencyPct: 40, benchmarkCaught: 35, benchmarkTotal: 54 }));
    expect(s).toContain("moved opposite ways");
  });
  it("says not-comparable when no shared measured dimension", () => {
    expect(scoreCompareText(version({ consistencyPct: 80 }), version({ benchmarkCaught: 30, benchmarkTotal: 54 }))).toContain("Not directly comparable");
  });
});

describe("isWorseThanChampion", () => {
  it("warns when a measured dimension dropped with no offsetting gain", () => {
    expect(isWorseThanChampion(version({ consistencyPct: 60 }), version({ consistencyPct: 85 }))).toBe(true);
    expect(isWorseThanChampion(version({ benchmarkCaught: 30, benchmarkTotal: 54 }), version({ benchmarkCaught: 38, benchmarkTotal: 54 }))).toBe(true);
  });
  it("does not warn when better or when there is no comparable data", () => {
    expect(isWorseThanChampion(version({ consistencyPct: 90 }), version({ consistencyPct: 85 }))).toBe(false);
    expect(isWorseThanChampion(version({ consistencyPct: 60 }), version({ benchmarkCaught: 30, benchmarkTotal: 54 }))).toBe(false); // different dimensions
    expect(isWorseThanChampion(version(), version())).toBe(false); // nothing measured
  });
  it("does not warn when one dimension dropped but the other improved", () => {
    expect(isWorseThanChampion(version({ consistencyPct: 60, benchmarkCaught: 40, benchmarkTotal: 54 }), version({ consistencyPct: 85, benchmarkCaught: 35, benchmarkTotal: 54 }))).toBe(false);
  });
});

describe("caughtRate", () => {
  it("is a fraction or null", () => {
    expect(caughtRate({ benchmarkCaught: 27, benchmarkTotal: 54 })).toBe(0.5);
    expect(caughtRate({ benchmarkCaught: null, benchmarkTotal: 54 })).toBeNull();
    expect(caughtRate({ benchmarkCaught: 5, benchmarkTotal: 0 })).toBeNull();
  });
});
