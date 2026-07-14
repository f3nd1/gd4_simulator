// Integration: the HOLISTIC band (official §23 rubric, human-selected) is the
// checklist's only scoring output. computeChecklistOverrides feeds it into
// buildScored unchanged in shape, so the §20 gate rule and the criterion
// point rollup (band/5 × criterion points) operate exactly as before — only
// the band's SOURCE changed (judgment record instead of the retired
// ladder/coverage calculation).
import { describe, it, expect } from "vitest";
import { computeChecklistOverrides, bandToScore } from "../checklistBanding";
import { buildScored, type ScoringInput } from "../scoring";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { Band, SubCriterionChecklistEntry, SpecificChecklistLine, ItemEvidence, SubChecklistEvidenceItem } from "../../types";

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

function entry(itemId: string, band?: Band): SubCriterionChecklistEntry {
  return {
    gd4ItemId: itemId,
    generic: [],
    specific: [specific(band ? "Met" : "Not met")],
    holisticBand: band ? { band, source: "human", decidedAt: "2026-07-14T00:00:00.000Z" } : undefined,
    pendingGenerated: [],
  };
}

describe("holistic band → scoring override integration", () => {
  it("a selected holistic band overrides the evidence-matrix fallback with exactly that band", () => {
    const entries: Record<string, SubCriterionChecklistEntry> = { "1.1.1": entry("1.1.1", 4) };
    const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
    expect(overrides["1.1.1"]).toEqual({ eff: bandToScore(4), band: 4 });

    const state: ScoringInput = { evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides };
    const scored = buildScored(state);
    const item = scored.items.find((i) => i.id === "1.1.1")!;
    expect(item.checklistOverride).toBe(true);
    expect(item.band).toBe(4);
  });

  it("an old-model entry (lines, no holistic band) produces NO override — it scores as not started, never a fabricated band", () => {
    const entries: Record<string, SubCriterionChecklistEntry> = { "1.1.1": entry("1.1.1") };
    const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
    expect(overrides["1.1.1"]).toBeUndefined();

    const state: ScoringInput = { evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides };
    const scored = buildScored(state);
    const item = scored.items.find((i) => i.id === "1.1.1")!;
    expect(item.checklistOverride).toBe(false);
    expect(item.started).toBe(false);
  });

  it("items without checklist entries still use the evidence-matrix band", () => {
    const overrides = computeChecklistOverrides({}, GD4_REQUIREMENTS);
    expect(Object.keys(overrides).length).toBe(0);

    const state: ScoringInput = { evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides };
    const scored = buildScored(state);
    expect(scored.items.every((i) => !i.checklistOverride)).toBe(true);
  });

  it("§20 gate reads holistic bands: Band 3 on every 4.2/4.6/Criterion-5 item passes the gate; Band 2 on one group fails it", () => {
    const gateItems = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === "4.2" || r.subCriterionId === "4.6" || r.criterion === "5");
    const passEntries: Record<string, SubCriterionChecklistEntry> = {};
    for (const r of gateItems) passEntries[r.id] = entry(r.id, 3);
    const passScored = buildScored({ evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: computeChecklistOverrides(passEntries, GD4_REQUIREMENTS) });
    expect(passScored.gatePass).toBe(true);

    const failEntries: Record<string, SubCriterionChecklistEntry> = { ...passEntries };
    for (const r of gateItems.filter((x) => x.subCriterionId === "4.2")) failEntries[r.id] = entry(r.id, 2);
    const failScored = buildScored({ evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: computeChecklistOverrides(failEntries, GD4_REQUIREMENTS) });
    expect(failScored.gatePass).toBe(false);
    expect(failScored.gateFail.some((g) => g.id === "Sub-criterion 4.2")).toBe(true);
  });

  it("criterion point rollup: a uniform Band-4 criterion scores 4/5 of its points", () => {
    const c1Items = GD4_REQUIREMENTS.filter((r) => r.criterion === "1");
    const entries: Record<string, SubCriterionChecklistEntry> = {};
    for (const r of c1Items) entries[r.id] = entry(r.id, 4);
    const scored = buildScored({ evidence: allMissing(), reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: computeChecklistOverrides(entries, GD4_REQUIREMENTS) });
    const c1 = scored.crits.find((c) => c.id === "1")!;
    expect(c1.band).toBe(4);
    expect(c1.scored).toBe(Math.round((4 / 5) * c1.points));
  });
});
