import { describe, it, expect } from "vitest";
import { buildFindingAnalysis } from "../checklistBanding";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SpecificChecklistLine, PdcaBreakdown, SubChecklistEvidenceItem } from "../../types";

const req = GD4_REQUIREMENTS[0];

function pdca(over: Partial<{ plan: string; do: string; check: string; act: string }>): PdcaBreakdown {
  return {
    plan: { status: (over.plan as PdcaBreakdown["plan"]["status"]) || "Adequate", note: "" },
    do: { status: (over.do as PdcaBreakdown["do"]["status"]) || "Implemented", note: "" },
    check: { status: (over.check as PdcaBreakdown["check"]["status"]) || "Yes", note: "" },
    act: { status: (over.act as PdcaBreakdown["act"]["status"]) || "Yes", note: "" },
  };
}

function line(over: Partial<SpecificChecklistLine>, evPdca?: PdcaBreakdown): SpecificChecklistLine {
  const ev: SubChecklistEvidenceItem | undefined = evPdca
    ? { id: "E1", title: "audit", type: "Audit", owner: "SQ", date: "2026-01-01", approved: false, reviewed: false, sufficiency: "Missing", pdca: evPdca }
    : undefined;
  return { id: "L1", text: "Document the process for X.", status: "Not met", evidence: ev ? [ev] : [], generatedBy: "ai", ...over };
}

describe("buildFindingAnalysis — root cause names the PDCA stage that failed", () => {
  it("missing policy -> Plan-stage root cause about the PPD", () => {
    const a = buildFindingAnalysis(req, line({}, pdca({ plan: "Missing" })));
    expect(a.rootCause).toMatch(/Plan stage/i);
    expect(a.rootCause).toMatch(/PPD|Policies & Procedures/i);
    expect(a.corrective).toMatch(/write/i);
  });

  it("generic policy -> Plan-stage root cause about being too generic / not sustainable", () => {
    const a = buildFindingAnalysis(req, line({}, pdca({ plan: "Generic" })));
    expect(a.rootCause).toMatch(/generic|boilerplate|sustainable/i);
    expect(a.corrective).toMatch(/specific/i);
  });

  it("adequate policy but no implementation -> Do-stage root cause", () => {
    const a = buildFindingAnalysis(req, line({}, pdca({ plan: "Adequate", do: "None" })));
    expect(a.rootCause).toMatch(/Do stage|on paper|not.*carried out|implementation/i);
  });

  it("missing control / review -> names the missing control and review loop", () => {
    const a = buildFindingAnalysis(req, line({}, pdca({ plan: "Adequate", do: "Implemented", check: "No", act: "No" })));
    expect(a.rootCause).toMatch(/control/i);
    expect(a.rootCause).toMatch(/review/i);
  });

  it("no PDCA, marked Met but evidence missing -> unverifiable root cause", () => {
    const a = buildFindingAnalysis(req, line({ status: "Met", evidence: [] }));
    expect(a.rootCause).toMatch(/no supporting evidence|cannot be verified|unverifiable/i);
  });

  it("always returns all three actions filled", () => {
    const a = buildFindingAnalysis(req, line({}, pdca({ plan: "Generic" })));
    expect(a.rootCause.length).toBeGreaterThan(0);
    expect(a.corrective.length).toBeGreaterThan(0);
    expect(a.preventive.length).toBeGreaterThan(0);
  });
});
