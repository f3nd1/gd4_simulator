import { describe, it, expect } from "vitest";
import { buildFindingAnalysis } from "../checklistBanding";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SpecificChecklistLine, ApsrBreakdown, SubChecklistEvidenceItem } from "../../types";

const req = GD4_REQUIREMENTS[0];

function apsr(over: Partial<{ approach: string; processes: string; systemsOutcomes: string; review: string }>): ApsrBreakdown {
  return {
    approach: { status: (over.approach as ApsrBreakdown["approach"]["status"]) || "Meeting", note: "" },
    processes: { status: (over.processes as ApsrBreakdown["processes"]["status"]) || "Deployed", note: "" },
    systemsOutcomes: { status: (over.systemsOutcomes as ApsrBreakdown["systemsOutcomes"]["status"]) || "Evident", note: "" },
    review: { status: (over.review as ApsrBreakdown["review"]["status"]) || "Evident", note: "" },
  };
}

function line(over: Partial<SpecificChecklistLine>, evApsr?: ApsrBreakdown): SpecificChecklistLine {
  const ev: SubChecklistEvidenceItem | undefined = evApsr
    ? { id: "E1", title: "audit", type: "Audit", owner: "SQ", date: "2026-01-01", approved: false, reviewed: false, sufficiency: "Missing", apsr: evApsr }
    : undefined;
  return { id: "L1", text: "Document the process for X.", status: "Not met", evidence: ev ? [ev] : [], generatedBy: "ai", ...over };
}

describe("buildFindingAnalysis — root cause names the APSR dimension that fell short", () => {
  it("Approach Not evident -> root cause about the PPD not documenting the approach", () => {
    const a = buildFindingAnalysis(req, line({}, apsr({ approach: "Not evident" })));
    expect(a.rootCause).toMatch(/Approach/);
    expect(a.rootCause).toMatch(/PPD|Policies & Procedures/i);
    expect(a.corrective).toMatch(/document/i);
  });

  it("Approach Beginning -> root cause about being too generic / not sustainable", () => {
    const a = buildFindingAnalysis(req, line({}, apsr({ approach: "Beginning" })));
    expect(a.rootCause).toMatch(/Approach/);
    expect(a.rootCause).toMatch(/generic|boilerplate|sustainable/i);
    expect(a.corrective).toMatch(/specific/i);
  });

  it("Meeting Approach but Processes Not evident -> Processes-dimension root cause", () => {
    const a = buildFindingAnalysis(req, line({}, apsr({ approach: "Meeting", processes: "Not evident" })));
    expect(a.rootCause).toMatch(/Processes|on paper|not.*implemented|implementation/i);
  });

  it("missing Systems & Outcomes / Review -> names both", () => {
    const a = buildFindingAnalysis(req, line({}, apsr({ approach: "Meeting", processes: "Deployed", systemsOutcomes: "Limited", review: "Not evident" })));
    expect(a.rootCause).toMatch(/Systems & Outcomes/);
    expect(a.rootCause).toMatch(/Review/);
  });

  it("no APSR, marked Met but evidence missing -> unverifiable root cause", () => {
    const a = buildFindingAnalysis(req, line({ status: "Met", evidence: [] }));
    expect(a.rootCause).toMatch(/no supporting evidence|cannot be verified|unverifiable/i);
  });

  it("always returns all three actions filled", () => {
    const a = buildFindingAnalysis(req, line({}, apsr({ approach: "Beginning" })));
    expect(a.rootCause.length).toBeGreaterThan(0);
    expect(a.corrective.length).toBeGreaterThan(0);
    expect(a.preventive.length).toBeGreaterThan(0);
  });
});
