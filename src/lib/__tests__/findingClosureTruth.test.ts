import { describe, it, expect } from "vitest";
import { isFindingClosed } from "../findingClassification";
import { isCoveredByExistingFinding, suppressesNewGap, sourceRefPrefix, groupWeakLines } from "../findingGrouper";
import type { Finding, SpecificChecklistLine } from "../../types";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "F1", auditCycleId: "cycle-1", gd4ItemId: "4.5.1",
  issue: "i", type: "AFI", severity: "Medium", owner: "SQ", dueDate: "",
  status: "Open", findingType: "NC", linkedSourceRefs: ["4.5.1.DS1.a"],
  ...over,
} as Finding);

const group = { gd4ItemId: "4.5.1", lines: [{ id: "L9" }], sourceRefs: ["4.5.1.DS1.a"] } as never;

describe("isFindingClosed — one answer from either record", () => {
  it("reads the closure record, which is where acceptance has always been stored", () => {
    expect(isFindingClosed(finding(), { F1: { human: "Accepted" } })).toBe(true);
  });

  it("reads Finding.status, which setClosureHuman now keeps in step", () => {
    expect(isFindingClosed(finding({ status: "Closed" }))).toBe(true);
  });

  it("is false when neither says closed", () => {
    expect(isFindingClosed(finding(), { F1: { human: "" } })).toBe(false);
    expect(isFindingClosed(finding())).toBe(false);
  });
});

describe("issue 4 — only an open NC or OFI suppresses a new gap", () => {
  it("an open NC still suppresses, so genuine duplicates are still prevented", () => {
    expect(isCoveredByExistingFinding(group, [finding()])).toBe(true);
  });

  it("an OBS strength does NOT suppress a later regression", () => {
    expect(isCoveredByExistingFinding(group, [finding({ findingType: "OBS" })])).toBe(false);
  });

  it("a finding closed by status does NOT suppress a recurrence", () => {
    expect(isCoveredByExistingFinding(group, [finding({ status: "Closed" })])).toBe(false);
  });

  it("a finding closed by an accepted closure does NOT suppress a recurrence", () => {
    expect(isCoveredByExistingFinding(group, [finding()], { F1: { human: "Accepted" } })).toBe(false);
  });

  it("clearing the closure restores suppression", () => {
    expect(isCoveredByExistingFinding(group, [finding()], { F1: { human: "" } })).toBe(true);
  });

  it("matches on line id as well as source ref", () => {
    const byLine = finding({ linkedSourceRefs: undefined, linkedChecklistLineIds: ["L9"] });
    expect(isCoveredByExistingFinding(group, [byLine])).toBe(true);
    expect(isCoveredByExistingFinding(group, [{ ...byLine, findingType: "OBS" }])).toBe(false);
  });

  it("suppressesNewGap is the single rule behind it", () => {
    expect(suppressesNewGap(finding())).toBe(true);
    expect(suppressesNewGap(finding({ findingType: "OBS" }))).toBe(false);
    expect(suppressesNewGap(finding(), { F1: { human: "Accepted" } })).toBe(false);
  });
});

describe("issue 16 — a ref is normalised before its suffix is stripped", () => {
  it("groups sibling points whatever the case", () => {
    expect(sourceRefPrefix("4.5.1.DS1.a")).toBe(sourceRefPrefix("4.5.1.DS1.A"));
  });

  it("tolerates the label prefix and whitespace gd4Refs documents", () => {
    expect(sourceRefPrefix("DS: 4.5.1.DS1.a")).toBe("4.5.1.DS1");
    expect(sourceRefPrefix(" 4.5.1.DS1.A ")).toBe("4.5.1.DS1");
  });

  it("leaves a ref with no sub-item suffix alone", () => {
    expect(sourceRefPrefix("6.2.1.DS2")).toBe("6.2.1.DS2");
    expect(sourceRefPrefix(undefined)).toBe("");
  });

  // The assertion that actually protects the user: mixed-case siblings of one
  // parent bullet must produce ONE finding group, not one per casing.
  it("mixed-case siblings form a single group", () => {
    const line = (id: string, ref: string): SpecificChecklistLine => ({
      id, text: id, status: "Not met", sourceRef: ref, evidence: [], apsrDimension: "Processes",
    } as unknown as SpecificChecklistLine);
    const req = { id: "4.5.1", subCriterionId: "4.5", flatAuditPoints: [] } as never;
    const groups = groupWeakLines([line("a", "4.5.1.DS1.a"), line("b", "4.5.1.DS1.B"), line("c", "DS: 4.5.1.DS1.c")], "4.5.1", req);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});
