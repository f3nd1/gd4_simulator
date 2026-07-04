import { describe, it, expect } from "vitest";
import { carryoverKey, deriveRepeatInfo, applyCarryover, type PriorCycleArchive } from "../cycleCarryover";
import type { Finding } from "../../types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    auditCycleId: "cycle-old",
    gd4ItemId: "4.2.1",
    issue: "Refund table mismatch",
    type: "AFI",
    severity: "High",
    owner: "REG",
    dueDate: "",
    repeatFinding: false,
    overdue: false,
    managementDecisionNeeded: false,
    status: "Open",
    findingType: "NC",
    ncSeverity: "Minor",
    linkedSourceRefs: ["4.2.1.DS1.a"],
    observation: "Clause 3.8 of the contract disagrees with the PPD refund table.",
    ...over,
  } as Finding;
}

function archive(findings: Finding[]): PriorCycleArchive {
  return { cycleId: "cycle-old", cycleName: "Pre-audit 2025", archivedAt: "2025-06-01T00:00:00.000Z", findings };
}

describe("carryoverKey", () => {
  it("uses item + normalized first source ref, ignoring findingType", () => {
    const a = carryoverKey(finding({ findingType: "OFI", linkedSourceRefs: ["4.2.1.DS1.a"] }));
    const b = carryoverKey(finding({ findingType: "NC", linkedSourceRefs: ["4.2.1.ds1.a"] }));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });
  it("falls back to clause and returns null when neither exists", () => {
    expect(carryoverKey(finding({ linkedSourceRefs: undefined, clause: "4.2.1.DS2" }))).toContain("4.2.1::");
    expect(carryoverKey(finding({ linkedSourceRefs: undefined, clause: undefined }))).toBeNull();
  });
});

describe("deriveRepeatInfo", () => {
  it("returns no-repeat with no archive or no match", () => {
    expect(deriveRepeatInfo(finding(), null).repeatFinding).toBe(false);
    expect(deriveRepeatInfo(finding({ gd4ItemId: "6.1.1" }), archive([finding()])).repeatFinding).toBe(false);
  });
  it("flags a repeat and escalates a repeat Minor NC after a prior NC", () => {
    const info = deriveRepeatInfo(finding({ id: "F-NEW" }), archive([finding()]));
    expect(info.repeatFinding).toBe(true);
    expect(info.escalatedToMajor).toBe(true);
    expect(info.priorFindingId).toBe("F-1");
    expect(info.priorLabel).toContain("Pre-audit 2025");
  });
  it("does not escalate when the prior finding was an OFI or the new one is not an NC", () => {
    expect(deriveRepeatInfo(finding(), archive([finding({ findingType: "OFI", ncSeverity: null })])).escalatedToMajor).toBe(false);
    const asOfi = deriveRepeatInfo(finding({ findingType: "OFI", ncSeverity: null }), archive([finding()]));
    expect(asOfi.repeatFinding).toBe(true);
    expect(asOfi.escalatedToMajor).toBe(false);
  });
});

describe("applyCarryover", () => {
  it("marks repeatFinding, escalates Minor→Major and prefixes the observation", () => {
    const out = applyCarryover(finding({ id: "F-NEW" }), archive([finding()]));
    expect(out.repeatFinding).toBe(true);
    expect(out.ncSeverity).toBe("Major");
    expect(out.observation).toMatch(/^⟲ REPEAT FINDING/);
    expect(out.observation).toContain("F-1");
    expect(out.observation).toContain("Clause 3.8"); // original text preserved
  });
  it("leaves a non-repeat finding untouched", () => {
    const f = finding({ gd4ItemId: "6.1.1", linkedSourceRefs: ["6.1.1.DS1"] });
    expect(applyCarryover(f, archive([finding()]))).toBe(f);
  });
});
