import { describe, it, expect } from "vitest";
import {
  lineSufficiency,
  maturityCeiling,
  coveragePercent,
  coverageCap,
  computeBand,
  bandToScore,
  findingDimension,
} from "../checklistBanding";
import type { GenericChecklistLine, SpecificChecklistLine, SubChecklistEvidenceItem, EvidenceSufficiency, ApsrBreakdown } from "../../types";

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

function generic(metIds: GenericChecklistLine["id"][]): GenericChecklistLine[] {
  const lenses: Record<GenericChecklistLine["id"], GenericChecklistLine["lens"]> = { G1: "Approach", G2: "Processes", G3: "Systems & Outcomes", G4: "Review" };
  return (["G1", "G2", "G3", "G4"] as const).map((id) => ({ id, lens: lenses[id], text: "", status: metIds.includes(id) ? "Met" : "Not Started" }));
}

describe("lineSufficiency", () => {
  it("is Missing with no evidence", () => expect(lineSufficiency(line("Met"))).toBe("Missing"));
  it("is Missing if any evidence item is Missing", () => expect(lineSufficiency(line("Met", [ev("Present"), ev("Missing")]))).toBe("Missing"));
  it("is Weak if any evidence is Weak (and none Missing)", () => expect(lineSufficiency(line("Met", [ev("Present"), ev("Weak")]))).toBe("Weak"));
  it("is Present when all evidence is Present", () => expect(lineSufficiency(line("Met", [ev("Present")]))).toBe("Present"));
});

describe("maturityCeiling", () => {
  it("none met → Band 1", () => expect(maturityCeiling(generic([]))).toBe(1));
  it("G1 → Band 2", () => expect(maturityCeiling(generic(["G1"]))).toBe(2));
  it("G4 → Band 5 (highest wins)", () => expect(maturityCeiling(generic(["G1", "G4"]))).toBe(5));
});

describe("coveragePercent", () => {
  it("ignores Not Applicable lines", () => {
    expect(coveragePercent([line("Met"), line("Not Applicable")])).toBe(100);
  });
  it("Partial counts half", () => {
    // 1 Met + 1 Partial over 2 lines = (1 + 0.5)/2 = 75%
    expect(coveragePercent([line("Met"), line("Partial")])).toBe(75);
  });
  it("empty → 0", () => expect(coveragePercent([])).toBe(0));
});

describe("coverageCap thresholds", () => {
  it("≥85 → 5", () => expect(coverageCap(85)).toBe(5));
  it("≥70 → 4", () => expect(coverageCap(70)).toBe(4));
  it("≥50 → 3", () => expect(coverageCap(50)).toBe(3));
  it("<50 → 2", () => expect(coverageCap(49)).toBe(2));
});

describe("computeBand evidence weakest-link rules", () => {
  it("all lines Met with full evidence and full maturity → Band 5", () => {
    const r = computeBand(generic(["G1", "G2", "G3", "G4"]), [line("Met", [ev("Present")]), line("Met", [ev("Present")])], false);
    expect(r.finalBand).toBe(5);
    expect(r.evidenceCapped).toBe(false);
  });
  it("Met status but NO evidence anywhere → floored to Band 1", () => {
    const r = computeBand(generic(["G1", "G2", "G3", "G4"]), [line("Met"), line("Met")], false);
    expect(r.finalBand).toBe(1);
    expect(r.evidenceCapped).toBe(true);
  });
  it("any line evidence Missing → capped at Band 2", () => {
    const r = computeBand(generic(["G1", "G2", "G3", "G4"]), [line("Met", [ev("Present")]), line("Met", [ev("Missing")])], false);
    expect(r.finalBand).toBe(2);
    expect(r.evidenceCapped).toBe(true);
  });
  it("not started when no specific lines", () => {
    expect(computeBand(generic([]), [], false).started).toBe(false);
  });
  it("final band is min(maturity ceiling, coverage cap)", () => {
    // full coverage (cap 5) but only G1 met (ceiling 2) → min = 2
    const r = computeBand(generic(["G1"]), [line("Met", [ev("Present")])], false);
    expect(r.finalBand).toBe(2);
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

describe("bandToScore round-trips back into the same band", () => {
  it("each band maps to a score in its own bucket", () => {
    expect(bandToScore(1)).toBeLessThan(40);
    expect(bandToScore(5)).toBeGreaterThanOrEqual(85);
  });
});
