import { describe, it, expect } from "vitest";
import { supportsTemperature, effectiveVerdictTemp } from "../ai/aiClient";
import { selectLineStatusMemories, selectLineStatusCalibration } from "../labParity";
import { criteriaQuotesRequirement } from "../findingCriteriaCheck";
import { samplingCaveat, FINDINGS_SAMPLING_CAVEAT } from "../samplingCaveat";
import { recommendFromConsistency } from "../tuningAdvisor";
import type { ConsistencyTestResult } from "../calibrationTesting";
import type { CalibrationMemory, CalibrationExample } from "../../types";

describe("temperature honesty (Item 1a)", () => {
  it("knows which models honour a temperature parameter", () => {
    expect(supportsTemperature("gpt-4o-mini")).toBe(true);
    expect(supportsTemperature("gpt-4.1")).toBe(true);
    expect(supportsTemperature("gpt-5-mini")).toBe(false);
    expect(supportsTemperature("gpt-5")).toBe(false);
    expect(supportsTemperature("o3-mini")).toBe(false);
  });

  it("effectiveVerdictTemp returns the dial value for temperature models and null for models that ignore it", () => {
    expect(effectiveVerdictTemp({ model: "gpt-4o-mini", verdictTemperature: 0.3 })).toBe(0.3);
    expect(effectiveVerdictTemp({ model: "gpt-4o-mini", verdictTemperature: undefined })).toBe(0.1); // dial default
    expect(effectiveVerdictTemp({ model: "gpt-5-mini", verdictTemperature: 0.1 })).toBeNull();
    // No model set → the client's default model (gpt-5-mini) is what runs.
    expect(effectiveVerdictTemp({ model: "", verdictTemperature: 0.1 })).toBeNull();
  });
});

describe("labParity selectors — the ONE production selection, shared with the Lab (Item 1b)", () => {
  const mem = (id: string, module: string, status: string, score: number | null): CalibrationMemory => ({
    id, timestamp: "", module: module as CalibrationMemory["module"], subjectId: "s", context: "c",
    aiOutput: "a", staffCorrection: "h", keyLearning: "k",
    status: status as CalibrationMemory["status"], usageCount: 0, effectivenessScore: score, tokenCount: 10,
  });

  it("memories: active Line Status only, best-performing first, capped at 5", () => {
    const all = [
      mem("m1", "Line Status", "active", 1),
      mem("m2", "Line Status", "archived", 9),      // wrong status → out
      mem("m3", "AFI Closure", "active", 9),        // wrong module → out
      mem("m4", "Line Status", "active", 5),
      mem("m5", "Line Status", "active", null),     // null scores sort last
      mem("m6", "Line Status", "active", 3),
      mem("m7", "Line Status", "active", 4),
      mem("m8", "Line Status", "active", 2),
    ];
    const picked = selectLineStatusMemories(all);
    expect(picked.map((m) => m.id)).toEqual(["m4", "m7", "m6", "m8", "m1"]); // top 5 by score
  });

  it("calibration examples: included Line Status only, capped at 3", () => {
    const ex = (id: string, module: string, included: boolean): CalibrationExample => ({
      id, timestamp: "", module: module as CalibrationExample["module"], aiInput: "", aiOutput: "", humanCorrection: "", reason: "", included,
    } as CalibrationExample);
    const picked = selectLineStatusCalibration([
      ex("e1", "Line Status", true), ex("e2", "Line Status", false), ex("e3", "AFI Closure", true),
      ex("e4", "Line Status", true), ex("e5", "Line Status", true), ex("e6", "Line Status", true),
    ]);
    expect(picked.map((e) => e.id)).toEqual(["e1", "e4", "e5"]);
  });
});

describe("finding criteria verification (Item 6)", () => {
  const OFFICIAL = "Maintain a governance system with robust management and financial controls covering all campuses.";

  it("passes when the criteria quotes the official text verbatim (whitespace/case/curly-quote tolerant)", () => {
    const criteria = `GD4 1.1.1 requires: "maintain a governance   system with robust management and financial controls covering all campuses." (Private Education Act s.36)`;
    expect(criteriaQuotesRequirement(criteria, [OFFICIAL])).toBe(true);
  });

  it("fails a paraphrase — exact wording is the whole point of the criteria field", () => {
    const criteria = "GD4 1.1.1 requires the school to have good governance and financial controls at every campus.";
    expect(criteriaQuotesRequirement(criteria, [OFFICIAL])).toBe(false);
  });

  it("fails when there is nothing to verify against, and ignores too-short official fragments", () => {
    expect(criteriaQuotesRequirement("anything", [])).toBe(false);
    expect(criteriaQuotesRequirement("contains short bit", ["short bit"])).toBe(false); // < 20 chars proves nothing
    expect(criteriaQuotesRequirement("", [OFFICIAL])).toBe(false);
  });

  it("passes when ANY of several traced source texts is quoted", () => {
    expect(criteriaQuotesRequirement(`quote: ${OFFICIAL}`, ["some other requirement text entirely", OFFICIAL])).toBe(true);
  });
});

describe("sampling caveat (Item 10a)", () => {
  it("names the file count and run date when known", () => {
    const c = samplingCaveat(7, "2026-07-11T00:00:00.000Z");
    expect(c).toBe("Assessed only the 7 files provided on 11 Jul 2026. Conclusions do not cover records that were not uploaded.");
  });
  it("degrades honestly when count/date are unknown", () => {
    expect(samplingCaveat(undefined, undefined)).toBe("Assessed only the files provided. Conclusions do not cover records that were not uploaded.");
    expect(samplingCaveat(1, "not-a-date")).toContain("the 1 file provided.");
  });
  it("the findings register variant states the principle", () => {
    expect(FINDINGS_SAMPLING_CAVEAT).toContain("only the records provided");
  });
});

describe("tuning advisor respects the effective temperature (Item 1a)", () => {
  const base: ConsistencyTestResult = {
    id: "6.3-2026-07-11T00:00:00.000Z", subCriterionId: "6.3", path: "A", runs: 3, runAt: "2026-07-11T00:00:00.000Z",
    temperature: 0.7, lines: [
      { ref: "6.3.1.DS1", text: "req", verdicts: ["Met", "Partial", "Met"] },
    ], bands: [3, 3, 3], gapCounts: [1, 2, 1], failedRuns: [], agreementPct: 40, summary: "s",
  };

  it("still recommends lowering temperature when the model honours it", () => {
    const recs = recommendFromConsistency({ ...base, effectiveTemperature: 0.7 });
    expect(recs[0].apply).toEqual({ type: "temperature", value: 0.1 });
  });

  it("NEVER recommends the temperature dial when the model ignores it — that would be a lie", () => {
    const recs = recommendFromConsistency({ ...base, effectiveTemperature: null });
    expect(recs).toHaveLength(1);
    expect(recs[0].apply).toBeUndefined();
    expect(recs[0].title).toContain("ignores the temperature setting");
  });
});
