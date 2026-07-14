import { describe, it, expect } from "vitest";
import {
  lineSufficiency,
  lineCompleteness,
  needsReassessment,
  bandEvidenceAdvisories,
  computeChecklistOverrides,
  bandToScore,
  findingDimension,
  apsrMatrixResult,
  finalBandFromPct,
  pctForScore,
  weakestDimensions,
  fastestPathToNextBand,
} from "../checklistBanding";
import { EDUTRUST_BANDS, bandTitle } from "../../data/edutrustRubric";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SpecificChecklistLine, SubChecklistEvidenceItem, SubCriterionChecklistEntry, EvidenceSufficiency, ApsrBreakdown, Band } from "../../types";

function ev(sufficiency: EvidenceSufficiency, apsr?: ApsrBreakdown): SubChecklistEvidenceItem {
  return { id: "e", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency, apsr };
}

function apsr(over: Partial<{ approach: string; processes: string; systemsOutcomes: string; review: string }>): ApsrBreakdown {
  return {
    approach: { status: (over.approach as ApsrBreakdown["approach"]["status"]) || "Meeting", note: "" },
    processes: { status: (over.processes as ApsrBreakdown["processes"]["status"]) || "Deployed", note: "" },
    systemsOutcomes: { status: (over.systemsOutcomes as ApsrBreakdown["systemsOutcomes"]["status"]) || "Evident", note: "" },
    review: { status: (over.review as ApsrBreakdown["review"]["status"]) || "Evident", note: "" },
  };
}

function line(status: SpecificChecklistLine["status"], evidence: SubChecklistEvidenceItem[] = []): SpecificChecklistLine {
  return { id: Math.random().toString(36).slice(2), text: "x", status, evidence, generatedBy: "manual" };
}

function entry(over: Partial<SubCriterionChecklistEntry> & { gd4ItemId: string }): SubCriterionChecklistEntry {
  return { generic: [], specific: [], pendingGenerated: [], ...over };
}

describe("official EduTrust rubric table (edutrustRubric.ts)", () => {
  it("has exactly 5 bands with the official level names, in order", () => {
    expect(EDUTRUST_BANDS.map((b) => [b.band, b.name])).toEqual([
      [1, "Not evident"],
      [2, "Beginning"],
      [3, "Meeting Expectation"],
      [4, "Exceeding"],
      [5, "Excellent"],
    ]);
  });
  it("every level carries all four dimension descriptors, verbatim spot-checks", () => {
    for (const b of EDUTRUST_BANDS) {
      expect(b.approach.length).toBeGreaterThan(0);
      expect(b.processes.length).toBeGreaterThan(0);
      expect(b.systemsOutcomes.length).toBeGreaterThan(0);
      expect(b.review.length).toBeGreaterThan(0);
    }
    // Verbatim anchors from the Guidance Document v4 §23 table:
    expect(EDUTRUST_BANDS[0].approach).toBe("No organised approach to item requirements is evident");
    expect(EDUTRUST_BANDS[2].review).toBe("There is evidence that the systems and processes are regularly reviewed and action plans for improvement are implemented");
    expect(EDUTRUST_BANDS[4].review).toBe("Many to most trends and current performance levels are evaluated against relevant comparisons and/or benchmarks");
  });
  it("bandTitle formats the canonical caption", () => {
    expect(bandTitle(3)).toBe("Band 3 — Meeting Expectation");
  });
});

describe("lineSufficiency", () => {
  it("is Missing with no evidence", () => expect(lineSufficiency(line("Met"))).toBe("Missing"));
  it("is Missing if any evidence item is Missing", () => expect(lineSufficiency(line("Met", [ev("Present"), ev("Missing")]))).toBe("Missing"));
  it("is Weak if any evidence is Weak (and none Missing)", () => expect(lineSufficiency(line("Met", [ev("Present"), ev("Weak")]))).toBe("Weak"));
  it("is Present when all evidence is Present", () => expect(lineSufficiency(line("Met", [ev("Present")]))).toBe("Present"));
});

describe("lineCompleteness — evidence context, never a band input", () => {
  it("counts assessed/met/partial/notMet and excludes Not Applicable", () => {
    const c = lineCompleteness([line("Met"), line("Partial"), line("Not met"), line("Not Started"), line("Not Applicable")]);
    expect(c).toEqual({ total: 4, assessed: 3, met: 1, partial: 1, notMet: 1, na: 1 });
  });
  it("empty → zeros", () => {
    expect(lineCompleteness([]).total).toBe(0);
    expect(lineCompleteness([]).assessed).toBe(0);
  });
});

describe("needsReassessment — old-model items are flagged, never silently re-banded", () => {
  it("true for an item with specific lines and no holistic band", () => {
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1", specific: [line("Met")] }))).toBe(true);
  });
  it("false once a holistic band is set", () => {
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1", specific: [line("Met")], holisticBand: { band: 3, matrixScores: { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 }, totalPct: 50, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }))).toBe(false);
  });
  it("false for an untouched item (no lines at all)", () => {
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1" }))).toBe(false);
  });
  it("true for an old holistic-model band (band set but no APSR matrixScores) — must be re-assessed under the percentage method", () => {
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1", specific: [line("Met")], holisticBand: { band: 4, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } as never }))).toBe(true);
  });
});

describe("computeChecklistOverrides — the holistic band feeds scoring; nothing is computed", () => {
  it("produces an override only for items with a holistic band", () => {
    const entries = {
      "6.2.1": entry({ gd4ItemId: "6.2.1", specific: [line("Met", [ev("Present")])], holisticBand: { band: 4, matrixScores: { approach: 4, processes: 4, systemsOutcomes: 4, review: 4 }, totalPct: 80, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }),
      // old-model item: lines but no holistic band → NO override (needs re-assessment)
      "6.3.1": entry({ gd4ItemId: "6.3.1", specific: [line("Met", [ev("Present")]), line("Met", [ev("Present")])] }),
    };
    const map = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
    expect(map["6.2.1"]).toEqual({ eff: bandToScore(4), band: 4 });
    expect(map["6.3.1"]).toBeUndefined();
  });
  it("the override band is exactly the selected band — no caps, ladders or coverage math", () => {
    // Band 5 with zero evidence would have been floored to Band 1 by the old
    // engine; under the holistic model the human judgment stands (the
    // advisories below flag it instead).
    const entries = { "1.1.1": entry({ gd4ItemId: "1.1.1", specific: [line("Met")], holisticBand: { band: 5, matrixScores: { approach: 5, processes: 5, systemsOutcomes: 5, review: 5 }, totalPct: 100, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }) };
    expect(computeChecklistOverrides(entries, GD4_REQUIREMENTS)["1.1.1"].band).toBe(5);
  });
  it("skips unknown item ids", () => {
    const entries = { "9.9.9": entry({ gd4ItemId: "9.9.9", holisticBand: { band: 3, matrixScores: { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 }, totalPct: 50, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }) };
    expect(computeChecklistOverrides(entries, GD4_REQUIREMENTS)).toEqual({});
  });
});

describe("bandEvidenceAdvisories — advisory only, ported from the old hard caps", () => {
  const b = (n: number) => n as Band;
  it("no evidence anywhere + band > 1 → unverifiable advisory", () => {
    const a = bandEvidenceAdvisories([line("Met"), line("Met")], b(4));
    expect(a).toHaveLength(1);
    expect(a[0]).toContain("no evidence is attached");
    expect(a[0]).toContain("Band 4 — Exceeding");
  });
  it("a Missing-evidence line + band > 2 → strengthen advisory", () => {
    const a = bandEvidenceAdvisories([line("Met", [ev("Present")]), line("Met", [ev("Missing")])], b(3));
    expect(a.some((x) => x.includes("Missing"))).toBe(true);
  });
  it("all evidence Weak + band > 3 → stronger-records advisory", () => {
    const a = bandEvidenceAdvisories([line("Met", [ev("Weak")])], b(4));
    expect(a.some((x) => x.includes("Weak"))).toBe(true);
  });
  it("mass Not-Applicable + band > 3 → re-check NA advisory", () => {
    const a = bandEvidenceAdvisories([line("Met", [ev("Present")]), line("Not Applicable"), line("Not Applicable")], b(5));
    expect(a.some((x) => x.includes("Not Applicable"))).toBe(true);
  });
  it("well-evidenced selection → no advisories", () => {
    expect(bandEvidenceAdvisories([line("Met", [ev("Present")]), line("Met", [ev("Present")])], b(5))).toEqual([]);
  });
  it("Band 1 with nothing on file → no advisory needed (the band already says it)", () => {
    expect(bandEvidenceAdvisories([line("Met")], b(1))).toEqual([]);
  });
});

describe("findingDimension — splits procedure (policy) from evidence (implementation)", () => {
  it("weak/absent Approach → Procedure (the documented policy is the gap)", () => {
    expect(findingDimension(line("Not met", [ev("Missing", apsr({ approach: "Not evident" }))]))).toBe("Procedure");
    expect(findingDimension(line("Partial", [ev("Weak", apsr({ approach: "Beginning" }))]))).toBe("Procedure");
  });
  it("Approach met but Processes not deployed → Evidence (implementation is the gap)", () => {
    expect(findingDimension(line("Not met", [ev("Missing", apsr({ approach: "Meeting", processes: "Not evident" }))]))).toBe("Evidence");
  });
  it("Approach + Processes fine but Systems & Outcomes weak → Outcomes", () => {
    expect(findingDimension(line("Partial", [ev("Weak", apsr({ systemsOutcomes: "Limited" }))]))).toBe("Outcomes");
  });
  it("only Review missing → Review", () => {
    expect(findingDimension(line("Partial", [ev("Present", apsr({ review: "Not evident" }))]))).toBe("Review");
  });
  it("no APSR + marked Met with no evidence → Unverified", () => {
    expect(findingDimension(line("Met"))).toBe("Unverified");
  });
  it("no APSR + Not met → Evidence", () => {
    expect(findingDimension(line("Not met"))).toBe("Evidence");
  });
});

describe("pctForScore — each dimension score converts to its percentage (Band N × 5%, 0 → 0%)", () => {
  it("0 is a genuine 0% (below Band 1), not folded into a band", () => expect(pctForScore(0)).toBe(0));
  it("Band N → N × 5%", () => {
    expect(pctForScore(1)).toBe(5);
    expect(pctForScore(2)).toBe(10);
    expect(pctForScore(4)).toBe(20);
    expect(pctForScore(5)).toBe(25);
  });
});

describe("finalBandFromPct — inferred five equal 20-point ranges (0-20=B1 … 81-100=B5)", () => {
  it("maps the range boundaries", () => {
    expect(finalBandFromPct(0)).toBe(1);
    expect(finalBandFromPct(20)).toBe(1);
    expect(finalBandFromPct(40)).toBe(2);
    expect(finalBandFromPct(50)).toBe(3);
    expect(finalBandFromPct(60)).toBe(3);
    expect(finalBandFromPct(80)).toBe(4);
    expect(finalBandFromPct(100)).toBe(5);
  });
  it("clamps out-of-range input to 1..5", () => {
    expect(finalBandFromPct(-10)).toBe(1);
    expect(finalBandFromPct(999)).toBe(5);
  });
});

describe("apsrMatrixResult — sums the four dimension percentages → total → final band", () => {
  it("reproduces the SSG auditor's worked example: A=20 + P=20 + S=10 + R=0 = 50% → Band 3", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4, systemsOutcomes: 2, review: 0 });
    expect(r.pcts).toEqual({ approach: 20, processes: 20, systemsOutcomes: 10, review: 0 });
    expect(r.total).toBe(50);
    expect(r.band).toBe(3);
    expect(r.complete).toBe(true);
  });
  it("all-Band-5 → 100% → Band 5", () => {
    const r = apsrMatrixResult({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 });
    expect(r.total).toBe(100);
    expect(r.band).toBe(5);
  });
  it("incomplete (not all four scored) → complete false, total counts only what is scored", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4 });
    expect(r.complete).toBe(false);
    expect(r.total).toBe(40);
  });
  it("undefined → zeros, not complete", () => {
    const r = apsrMatrixResult(undefined);
    expect(r.total).toBe(0);
    expect(r.complete).toBe(false);
  });
  it("R=0 counts as a scored dimension (0% is a real input, distinct from unscored)", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4, systemsOutcomes: 4, review: 0 });
    expect(r.complete).toBe(true);
    expect(r.total).toBe(60);
    expect(r.band).toBe(3);
  });
});

describe("editable scale — the %-per-band and thresholds are not hardcoded", () => {
  // Double the max per dimension (50%): band N → N×10%, so the same picks that
  // gave 50% now give 100%, and with default thresholds that is Band 5.
  const doubled = { maxPctPerDimension: 50, bandThresholds: [20, 40, 60, 80] as [number, number, number, number] };
  it("pctForScore respects the max-per-dimension setting", () => {
    expect(pctForScore(4, doubled)).toBe(40); // 4 × (50/5)
    expect(pctForScore(0, doubled)).toBe(0);
  });
  it("apsrMatrixResult re-bands the worked example when the scale changes", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4, systemsOutcomes: 2, review: 0 }, doubled);
    expect(r.total).toBe(100); // 40+40+20+0
    expect(r.band).toBe(5);    // vs Band 3 at the default scale
  });
  it("finalBandFromPct respects custom thresholds", () => {
    const skewed = { maxPctPerDimension: 25, bandThresholds: [10, 20, 30, 40] as [number, number, number, number] };
    expect(finalBandFromPct(50, skewed)).toBe(5); // above the last threshold
    expect(finalBandFromPct(10, skewed)).toBe(1);
    expect(finalBandFromPct(25, skewed)).toBe(3);
  });
});

describe("bandToScore round-trips back into the same band", () => {
  it("each band maps to a score in its own bucket", () => {
    expect(bandToScore(1)).toBeLessThan(40);
    expect(bandToScore(5)).toBeGreaterThanOrEqual(85);
  });
});

describe("weakestDimensions — the tied-lowest dimension(s), for the improvement panel", () => {
  it("picks the single lowest dimension", () => {
    expect(weakestDimensions({ approach: 20, processes: 20, systemsOutcomes: 10, review: 0 })).toEqual(["review"]);
  });
  it("ties are all returned", () => {
    expect(weakestDimensions({ approach: 10, processes: 10, systemsOutcomes: 25, review: 25 })).toEqual(["approach", "processes"]);
  });
  it("all four when every dimension is equal (incl. all-zero/unscored)", () => {
    expect(weakestDimensions({ approach: 0, processes: 0, systemsOutcomes: 0, review: 0 })).toEqual(["approach", "processes", "systemsOutcomes", "review"]);
    expect(weakestDimensions({ approach: 25, processes: 25, systemsOutcomes: 25, review: 25 })).toEqual(["approach", "processes", "systemsOutcomes", "review"]);
  });
});

describe("fastestPathToNextBand — pure arithmetic over the matrix, no AI call", () => {
  it("null when already Band 5 (nothing to reach)", () => {
    const r = apsrMatrixResult({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 });
    expect(fastestPathToNextBand(r)).toBeNull();
  });
  it("null when the matrix isn't fully scored", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4 });
    expect(fastestPathToNextBand(r)).toBeNull();
  });
  it("worked example (50% → Band 3): Review (0%) is the cheapest single dimension to raise", () => {
    const r = apsrMatrixResult({ approach: 4, processes: 4, systemsOutcomes: 2, review: 0 });
    const path = fastestPathToNextBand(r);
    expect(path).not.toBeNull();
    expect(path!.nextBand).toBe(4);
    expect(path!.stepPct).toBe(5); // 25/5
    expect(path!.shortfallPct).toBe(11); // threshold 60, total 50 -> 60-50+1
    // 11% needed, 5% per step -> ceil(11/5) = 3 steps -> 3 cheapest dimensions
    expect(path!.dims).toEqual(["review", "systemsOutcomes", "approach"].sort((a, b) => r.pcts[a as keyof typeof r.pcts] - r.pcts[b as keyof typeof r.pcts]));
  });
  it("a single band-step is enough when already close to the threshold", () => {
    // total 55%, next threshold 60 -> shortfall 6%, one 5%-step isn't quite
    // enough on its own (needs 2), confirming ceil() rounds up, not down.
    const r = apsrMatrixResult({ approach: 5, processes: 4, systemsOutcomes: 2, review: 0 }); // 25+20+10+0=55
    const path = fastestPathToNextBand(r)!;
    expect(r.total).toBe(55);
    expect(path.shortfallPct).toBe(6);
    expect(path.dims.length).toBe(2); // ceil(6/5) = 2
    expect(path.dims[0]).toBe("review"); // lowest first
  });
});
