import { describe, it, expect } from "vitest";
import { normalizeAuditRef, findingDedupeKey, findingKeyOf } from "../gd4Refs";
import { buildDraftFinding } from "../checklistBanding";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SpecificChecklistLine } from "../../types";

describe("normalizeAuditRef", () => {
  it("strips label prefixes, whitespace and case", () => {
    expect(normalizeAuditRef("DS: 6.1.1.DS1.a")).toBe("6.1.1.DS1.A");
    expect(normalizeAuditRef("  ref# 1.2.1.ds2 ")).toBe("1.2.1.DS2");
    expect(normalizeAuditRef("1.1.1.DS1")).toBe("1.1.1.DS1");
  });

  it("matches the same ref written in the two pipelines' formats", () => {
    // Option A rows carry the clean FlatAuditPoint ref; checklist lines carry
    // an AI-echoed sourceRef that can drift — both must normalize identically.
    expect(normalizeAuditRef("1.1.1.DS1")).toBe(normalizeAuditRef("ds: 1.1.1.ds1"));
    expect(normalizeAuditRef("6.2.1.DS1.a")).toBe(normalizeAuditRef("6.2.1. DS1. a"));
  });
});

describe("findingDedupeKey", () => {
  it("builds a composite key of item + normalized ref + finding type", () => {
    expect(findingDedupeKey("1.1.1", "ds: 1.1.1.ds1", "NC")).toBe("1.1.1::1.1.1.DS1::NC");
  });

  it("the same requirement raised by both pipelines produces ONE key", () => {
    const fromChecklist = findingDedupeKey("1.1.1", "DS: 1.1.1.DS1", "NC"); // line.sourceRef
    const fromCompile = findingDedupeKey("1.1.1", "1.1.1.DS1", "NC"); // row.gdRef
    expect(fromChecklist).toBe(fromCompile);
  });

  it("different finding types on the same ref are distinct findings", () => {
    expect(findingDedupeKey("1.1.1", "1.1.1.DS1", "NC")).not.toBe(findingDedupeKey("1.1.1", "1.1.1.DS1", "OFI"));
  });

  it("returns null with no usable ref, so ref-less findings never collide on an empty key", () => {
    expect(findingDedupeKey("1.1.1", undefined, "NC")).toBeNull();
    expect(findingDedupeKey("1.1.1", "   ", "NC")).toBeNull();
  });
});

describe("findingKeyOf", () => {
  it("prefers linkedSourceRefs[0], falling back to clause", () => {
    expect(findingKeyOf({ gd4ItemId: "1.1.1", linkedSourceRefs: ["1.1.1.DS1"], clause: "other", findingType: "NC" })).toBe(
      "1.1.1::1.1.1.DS1::NC"
    );
    expect(findingKeyOf({ gd4ItemId: "1.1.1", clause: "1.1.1.DS1", findingType: "NC" })).toBe("1.1.1::1.1.1.DS1::NC");
    expect(findingKeyOf({ gd4ItemId: "1.1.1", findingType: "NC" })).toBeNull();
  });

  it("a finding created from a checklist line matches the key of the Option A row for the same gap", () => {
    const findingFromLine = { gd4ItemId: "1.1.1", linkedSourceRefs: ["ds: 1.1.1.ds1"], findingType: "NC" as const };
    expect(findingKeyOf(findingFromLine)).toBe(findingDedupeKey("1.1.1", "1.1.1.DS1", "NC"));
  });
});

describe("Option A synthetic-line seed parity (buildDraftFinding)", () => {
  const req = GD4_REQUIREMENTS[0];

  function syntheticLine(status: SpecificChecklistLine["status"]): SpecificChecklistLine {
    return {
      id: `EVROW-${req.id}.DS1`,
      text: "The institution documents its strategic plan.",
      clause: `${req.id}.DS1`,
      sourceRef: `${req.id}.DS1`,
      status,
      generatedBy: "ai",
      evidence: [],
    };
  }

  it("a Not met Option A row yields the same rootCause/corrective/preventive scaffold a checklist line gets", () => {
    const draft = buildDraftFinding(req, syntheticLine("Not met"));
    expect(draft.rootCause).toBeTruthy();
    expect(draft.corrective).toBeTruthy();
    expect(draft.preventive).toBeTruthy();
    expect(draft.observation).toBeTruthy();
    expect(draft.criteria).toContain(req.requirement);
    expect(draft.effect).toBeTruthy();
    expect(draft.findingType).toBe("NC");
  });

  it("a Partial row yields an OFI with the closure seed", () => {
    const draft = buildDraftFinding(req, syntheticLine("Partial"));
    expect(draft.findingType).toBe("OFI");
    expect(draft.rootCause).toBeTruthy();
    expect(draft.corrective).toBeTruthy();
    expect(draft.preventive).toBeTruthy();
  });
});
