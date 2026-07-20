// autoScoreAssessedItems — the Full Auto post-sweep band pass. Invariants:
//   1. SETTING OFF = byte-identical: with autoScoreBands off the helper touches
//      nothing — no AI call, no band write — so computeChecklistOverrides +
//      buildScored are byte-identical and a pre-existing human band is intact.
//   2. NO FORCE-SAVE: with the setting on but no AI available, every assessed
//      item is skipped and reported by id + reason, and NO band is written
//      (the two setHolisticBand gates are never bypassed).
//   3. ONLY ASSESSED ITEMS: only requirement items that actually have checklist
//      lines under a swept sub-criterion are considered.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { useScoringConfigStore } = await import("../useScoringConfigStore");
const { useAISettingsStore } = await import("../useAISettingsStore");
const { computeChecklistOverrides } = await import("../../lib/checklistBanding");
const { buildScored } = await import("../../lib/scoring");
const { GD4_REQUIREMENTS } = await import("../../data/gd4Requirements");

import type { SubCriterionChecklistEntry } from "../../types";

const ITEM = "6.2.1";
const SUB = "6.2";
const WORKED = { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 } as const;

function linedEntry(bandSource?: "human"): SubCriterionChecklistEntry {
  return {
    gd4ItemId: ITEM,
    pendingGenerated: [],
    specific: [{ id: "L1", text: "A real assessed line", status: "Met", evidence: [], generatedBy: "ai" }],
    ...(bandSource
      ? { holisticBand: { band: 3, matrixScores: { ...WORKED }, totalPct: 50, rationale: "My own reasoning.", source: bandSource, decidedAt: "2026-07-17T00:00:00.000Z" } }
      : {}),
  };
}

const digest = () => {
  const overrides = computeChecklistOverrides(useChecklistModuleStore.getState().entries, GD4_REQUIREMENTS);
  const s = buildScored({ evidence: {}, reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides });
  return JSON.stringify({ overrides, total: s.total, award: s.award, gates: s.gates, bands: s.items.map((i) => [i.id, i.band, i.eff]) });
};

beforeEach(() => {
  // No AI in the test environment: suggestBand short-circuits to null.
  useAISettingsStore.setState({ enabled: false, apiKey: "" });
  useScoringConfigStore.setState({ autoScoreBands: false });
});

describe("autoScoreAssessedItems — setting OFF is byte-identical", () => {
  it("touches nothing and leaves a pre-existing human band + the scoring digest identical", async () => {
    useChecklistModuleStore.setState({ entries: { [ITEM]: linedEntry("human") } });
    const before = digest();
    useScoringConfigStore.setState({ autoScoreBands: false });
    const r = await useWorkspaceStore.getState().autoScoreAssessedItems([SUB]);
    expect(r).toEqual({ set: [], skipped: [] });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.source).toBe("human"); // untouched
    expect(digest()).toBe(before);
  });
});

describe("autoScoreAssessedItems — setting ON but no AI: skip, never force-save", () => {
  it("reports the assessed item as skipped and writes no band", async () => {
    useChecklistModuleStore.setState({ entries: { [ITEM]: linedEntry() } }); // no band yet
    const before = digest();
    useScoringConfigStore.setState({ autoScoreBands: true });
    const r = await useWorkspaceStore.getState().autoScoreAssessedItems([SUB]);
    expect(r.set).toEqual([]);
    expect(r.skipped).toEqual([{ itemId: ITEM, reason: "AI band suggestion unavailable" }]);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.holisticBand).toBeUndefined();
    expect(digest()).toBe(before); // no band written → scoring unchanged
  });
});

describe("autoScoreAssessedItems — only items with checklist lines are attempted, but every item is accounted for", () => {
  it("never AI-attempts a sibling with no checklist entry, but reports it skipped with a reason (it used to vanish silently)", async () => {
    // 2.2 holds two requirement items (2.2.1, 2.2.2); only seed one with lines.
    useChecklistModuleStore.setState({ entries: { "2.2.1": { ...linedEntry(), gd4ItemId: "2.2.1", specific: [{ id: "L1", text: "line", status: "Met", evidence: [], generatedBy: "ai" }] } } });
    useScoringConfigStore.setState({ autoScoreBands: true });
    const r = await useWorkspaceStore.getState().autoScoreAssessedItems(["2.2"]);
    expect(r.set).toEqual([]);
    // 2.2.1 was attempted (AI unavailable here); 2.2.2 was not attempted but
    // is still reported — a run's band section must account for every item.
    expect(r.skipped.find((s) => s.itemId === "2.2.1")!.reason).toBe("AI band suggestion unavailable");
    expect(r.skipped.find((s) => s.itemId === "2.2.2")!.reason).toMatch(/no checklist lines/);
    expect(r.skipped).toHaveLength(2);
  });
});

describe("autoScoreAssessedItems — split run scopes (4.2.1 / 4.2.2) resolve to their item", () => {
  // The 2026-07-20 bug: subIds are RUN SCOPES, and for the split sub 4.2 they
  // are ITEM ids ("4.2.1"). Filtering GD4_REQUIREMENTS by r.subCriterionId
  // found zero items for them, so a completed 4.2.1 run's band + narrative
  // silently skipped and the result never reached the Final Report.
  it("scope '4.2.1' finds item 4.2.1 (attempted; skipped here only because no AI is available)", async () => {
    useChecklistModuleStore.setState({ entries: { "4.2.1": { ...linedEntry(), gd4ItemId: "4.2.1", specific: [{ id: "L1", text: "line", status: "Met", evidence: [], generatedBy: "ai" }] } } });
    useScoringConfigStore.setState({ autoScoreBands: true });
    const r = await useWorkspaceStore.getState().autoScoreAssessedItems(["4.2.1"]);
    expect(r.skipped).toEqual([{ itemId: "4.2.1", reason: "AI band suggestion unavailable" }]);
  });
  it("scope '4.2.2' with no checklist lines is reported, never silently dropped", async () => {
    useChecklistModuleStore.setState({ entries: {} });
    useScoringConfigStore.setState({ autoScoreBands: true });
    const r = await useWorkspaceStore.getState().autoScoreAssessedItems(["4.2.2"]);
    expect(r.skipped).toEqual([{ itemId: "4.2.2", reason: expect.stringMatching(/no checklist lines/) }]);
  });
});
