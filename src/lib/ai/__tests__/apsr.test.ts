import { describe, it, expect } from "vitest";
import { deriveApsrStatus, apsrReason } from "../simulateAI";
import type { ApsrBreakdown } from "../../../types";

function mk(p: Partial<Record<keyof ApsrBreakdown, { status: string; note?: string }>>): ApsrBreakdown {
  return {
    approach: { status: "Meeting", note: "", ...(p.approach as object) } as ApsrBreakdown["approach"],
    processes: { status: "Deployed", note: "", ...(p.processes as object) } as ApsrBreakdown["processes"],
    systemsOutcomes: { status: "Evident", note: "", ...(p.systemsOutcomes as object) } as ApsrBreakdown["systemsOutcomes"],
    review: { status: "Evident", note: "", ...(p.review as object) } as ApsrBreakdown["review"],
  };
}

describe("deriveApsrStatus — Approach hard-gating (official EduTrust APSR rubric)", () => {
  it("a Beginning Approach caps the line to Not met even with everything else evident", () => {
    expect(deriveApsrStatus(mk({ approach: { status: "Beginning" } }))).toBe("Not met");
  });

  it("a Not-evident Approach caps the line to Not met regardless of implementation", () => {
    expect(deriveApsrStatus(mk({ approach: { status: "Not evident" }, processes: { status: "Deployed" }, systemsOutcomes: { status: "Evident" }, review: { status: "Evident" } }))).toBe("Not met");
  });

  it("Meeting Approach but no implementation (Processes Not evident) is Not met — policy on paper only", () => {
    expect(deriveApsrStatus(mk({ approach: { status: "Meeting" }, processes: { status: "Not evident" } }))).toBe("Not met");
  });

  it("Met requires the full rubric: Meeting Approach + Deployed Processes + Evident Systems & Outcomes + Evident Review", () => {
    expect(deriveApsrStatus(mk({}))).toBe("Met");
  });

  it("deployed but Systems & Outcomes not evident is only Partial", () => {
    expect(deriveApsrStatus(mk({ systemsOutcomes: { status: "Limited" } }))).toBe("Partial");
  });

  it("deployed but no Review is only Partial", () => {
    expect(deriveApsrStatus(mk({ review: { status: "Not evident" } }))).toBe("Partial");
  });

  it("weak Processes with an adequate Approach is Partial", () => {
    expect(deriveApsrStatus(mk({ processes: { status: "Weak" }, systemsOutcomes: { status: "Limited" }, review: { status: "Not evident" } }))).toBe("Partial");
  });
});

describe("apsrReason", () => {
  it("uses the official APSR dimension names and surfaces the Approach critique", () => {
    const r = apsrReason(mk({ approach: { status: "Beginning", note: "boilerplate, not specific to this PEI" } }));
    expect(r).toContain("Approach (documented policy): Beginning");
    expect(r).toContain("not specific to this PEI");
    expect(r).toContain("Processes (implementation)");
    expect(r).toContain("Systems & Outcomes");
    expect(r).toContain("Review");
  });
});
