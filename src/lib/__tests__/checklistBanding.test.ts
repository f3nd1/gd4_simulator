import { describe, it, expect } from "vitest";
import {
  lineSufficiency,
  lineCompleteness,
  needsReassessment,
  bandEvidenceAdvisories,
  computeChecklistOverrides,
  bandToScore,
  findingDimension,
  apsrWorkingAverage,
  bandMismatch,
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
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1", specific: [line("Met")], holisticBand: { band: 3, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }))).toBe(false);
  });
  it("false for an untouched item (no lines at all)", () => {
    expect(needsReassessment(entry({ gd4ItemId: "6.2.1" }))).toBe(false);
  });
});

describe("computeChecklistOverrides — the holistic band feeds scoring; nothing is computed", () => {
  it("produces an override only for items with a holistic band", () => {
    const entries = {
      "6.2.1": entry({ gd4ItemId: "6.2.1", specific: [line("Met", [ev("Present")])], holisticBand: { band: 4, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }),
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
    const entries = { "1.1.1": entry({ gd4ItemId: "1.1.1", specific: [line("Met")], holisticBand: { band: 5, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }) };
    expect(computeChecklistOverrides(entries, GD4_REQUIREMENTS)["1.1.1"].band).toBe(5);
  });
  it("skips unknown item ids", () => {
    const entries = { "9.9.9": entry({ gd4ItemId: "9.9.9", holisticBand: { band: 3, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } }) };
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

describe("apsrWorkingAverage — internal working average, never the official band", () => {
  it("null until all four dimensions are scored", () => {
    expect(apsrWorkingAverage(undefined)).toBeNull();
    expect(apsrWorkingAverage({})).toBeNull();
    expect(apsrWorkingAverage({ approach: 3, processes: 3, systemsOutcomes: 3 })).toBeNull();
  });
  it("averages all four and rounds half up (3,3,4,4 → 3.5 → Band 4)", () => {
    expect(apsrWorkingAverage({ approach: 3, processes: 3, systemsOutcomes: 4, review: 4 })).toEqual({ avg: 3.5, rounded: 4 });
  });
  it("uniform scores round-trip exactly", () => {
    expect(apsrWorkingAverage({ approach: 2, processes: 2, systemsOutcomes: 2, review: 2 })!.rounded).toBe(2);
  });
});

describe("bandMismatch — the disagreement gate (≥1 full band vs rounded average)", () => {
  const working = { approach: 2 as const, processes: 2 as const, systemsOutcomes: 2 as const, review: 2 as const }; // avg Band 2
  it("fires when the selected band differs from the rounded average by ≥1", () => {
    expect(bandMismatch(4, working)).toEqual({ avg: 2, rounded: 2 });
    expect(bandMismatch(1, working)).toEqual({ avg: 2, rounded: 2 });
  });
  it("does not fire when they agree", () => {
    expect(bandMismatch(2, working)).toBeNull();
  });
  it("does not fire when the working is incomplete — nothing to compare against", () => {
    expect(bandMismatch(5, { approach: 1 })).toBeNull();
    expect(bandMismatch(5, undefined)).toBeNull();
  });
  it("rounding boundary: avg 3.5 rounds to 4, so official Band 4 agrees but Band 3 fires", () => {
    const w = { approach: 3 as const, processes: 3 as const, systemsOutcomes: 4 as const, review: 4 as const };
    expect(bandMismatch(4, w)).toBeNull();
    expect(bandMismatch(3, w)).not.toBeNull();
  });
});

describe("bandToScore round-trips back into the same band", () => {
  it("each band maps to a score in its own bucket", () => {
    expect(bandToScore(1)).toBeLessThan(40);
    expect(bandToScore(5)).toBeGreaterThanOrEqual(85);
  });
});
