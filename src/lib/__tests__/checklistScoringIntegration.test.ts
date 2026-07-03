import { describe, it, expect } from "vitest";
import { computeChecklistOverrides } from "../checklistBanding";
import { buildScored, type ScoringInput } from "../scoring";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SubCriterionChecklistEntry, SpecificChecklistLine, GenericChecklistLine, ItemEvidence, SubChecklistEvidenceItem } from "../../types";

function allMissing(): Record<string, ItemEvidence> {
  const m: Record<string, ItemEvidence> = {};
  for (const r of GD4_REQUIREMENTS) m[r.id] = { approach: "Missing", processes: "Missing", systemsOutcomes: "Missing", review: "Missing", owner: "", age: 0, trace: 0 };
  return m;
}

function ev(): SubChecklistEvidenceItem {
  return { id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present" };
}

function specific(status: SpecificChecklistLine["status"]): SpecificChecklistLine {
  return { id: "L1", text: "Line text.", status, evidence: status === "Met" ? [ev()] : [], generatedBy: "manual" };
}

function generic(metIds: GenericChecklistLine["id"][]): GenericChecklistLine[] {
  const lenses: Record<GenericChecklistLine["id"], GenericChecklistLine["lens"]> = { G1: "Approach", G2: "Processes", G3: "Systems & Outcomes", G4: "Review" };
  return (["G1", "G2", "G3", "G4"] as const).map((id) => ({ id, lens: lenses[id], text: "", status: metIds.includes(id) ? "Met" : "Not Started" }));
}

function entry(itemId: string, met: boolean): SubCriterionChecklistEntry {
  return {
    gd4ItemId: itemId,
    generic: generic(met ? ["G1", "G2", "G3", "G4"] : []),
    specific: met ? [specific("Met")] : [specific("Not met")],
    pendingGenerated: [],
  };
}

describe("checklist → scoring override integration", () => {
  it("a checklist entry with all Met lines raises the band above the evidence-matrix fallback", () => {
    const entries: Record<string, SubCriterionChecklistEntry> = { "1.1.1": entry("1.1.1", true) };
    const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);

    expect(overrides["1.1.1"]).toBeDefined();
    expect(overrides["1.1.1"].band).toBeGreaterThan(1);

    const state: ScoringInput = { evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides };
    const scored = buildScored(state);
    const item = scored.items.find((i) => i.id === "1.1.1")!;

    expect(item.checklistOverride).toBe(true);
    expect(item.band).toBe(overrides["1.1.1"].band);
  });

  it("a checklist entry with Not-met lines keeps the item at Band 1", () => {
    const entries: Record<string, SubCriterionChecklistEntry> = { "1.1.1": entry("1.1.1", false) };
    const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
    expect(overrides["1.1.1"].band).toBe(1);
  });

  it("items without checklist entries still use the evidence-matrix band", () => {
    // No checklist entries at all → no overrides → fallback to evidence-matrix (all missing → band 1)
    const overrides = computeChecklistOverrides({}, GD4_REQUIREMENTS);
    expect(Object.keys(overrides).length).toBe(0);

    const state: ScoringInput = { evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides };
    const scored = buildScored(state);
    expect(scored.items.every((i) => !i.checklistOverride)).toBe(true);
  });
});
