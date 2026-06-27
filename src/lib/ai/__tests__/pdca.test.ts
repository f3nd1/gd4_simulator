import { describe, it, expect } from "vitest";
import { derivePdcaStatus, pdcaReason } from "../simulateAI";
import type { PdcaBreakdown } from "../../../types";

function mk(p: Partial<Record<keyof PdcaBreakdown, { status: string; note?: string }>>): PdcaBreakdown {
  return {
    plan: { status: "Adequate", note: "", ...(p.plan as object) } as PdcaBreakdown["plan"],
    do: { status: "Implemented", note: "", ...(p.do as object) } as PdcaBreakdown["do"],
    check: { status: "Yes", note: "", ...(p.check as object) } as PdcaBreakdown["check"],
    act: { status: "Yes", note: "", ...(p.act as object) } as PdcaBreakdown["act"],
  };
}

describe("derivePdcaStatus — Plan hard-gating", () => {
  it("a generic policy caps the line to Not met even with full implementation/control/review", () => {
    expect(derivePdcaStatus(mk({ plan: { status: "Generic" } }))).toBe("Not met");
  });

  it("a missing policy caps the line to Not met regardless of evidence", () => {
    expect(derivePdcaStatus(mk({ plan: { status: "Missing" }, do: { status: "Implemented" }, check: { status: "Yes" }, act: { status: "Yes" } }))).toBe("Not met");
  });

  it("adequate policy but no implementation evidence is Not met (policy on paper only)", () => {
    expect(derivePdcaStatus(mk({ plan: { status: "Adequate" }, do: { status: "None" } }))).toBe("Not met");
  });

  it("Met requires the FULL cycle: adequate plan + implemented + control + review", () => {
    expect(derivePdcaStatus(mk({}))).toBe("Met");
  });

  it("implemented but missing a control is only Partial", () => {
    expect(derivePdcaStatus(mk({ check: { status: "No" } }))).toBe("Partial");
  });

  it("implemented but missing a review is only Partial", () => {
    expect(derivePdcaStatus(mk({ act: { status: "No" } }))).toBe("Partial");
  });

  it("partial implementation is Partial when the plan is adequate", () => {
    expect(derivePdcaStatus(mk({ do: { status: "Partial" }, check: { status: "No" }, act: { status: "No" } }))).toBe("Partial");
  });
});

describe("pdcaReason", () => {
  it("surfaces the policy critique (sustainable / too generic) in plain text", () => {
    const r = pdcaReason(mk({ plan: { status: "Generic", note: "boilerplate, not specific to this PEI" } }));
    expect(r).toContain("Plan (policy): Generic");
    expect(r).toContain("not specific to this PEI");
    expect(r).toContain("Do (implementation)");
    expect(r).toContain("Check (control)");
    expect(r).toContain("Act (review)");
  });
});
