// applyOutcomeReviewLegs — the checklist write for the on-demand Outcomes &
// Review pass. Two invariants under test:
//   1. SURGICAL WRITE: only the Systems & Outcomes and Review APSR legs on a
//      line's audited evidence item change; status, sufficiency, the other
//      two legs, and never-audited lines are untouched.
//   2. NO BAND MOVEMENT (the critical scoring-safety guarantee): the
//      certification band flows solely from holisticBand.matrixScores via
//      computeChecklistOverrides, so applying the pass legs leaves
//      computeChecklistOverrides output and buildScored results
//      byte-identical.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { computeChecklistOverrides } = await import("../../lib/checklistBanding");
const { buildScored } = await import("../../lib/scoring");
const { OPTION_A_NOT_ASSESSED_NOTE } = await import("../../lib/optionAChecklistWrite");
const { GD4_REQUIREMENTS } = await import("../../data/gd4Requirements");

import type { ApsrBreakdown, SubCriterionChecklistEntry } from "../../types";

const ITEM = "6.2.1";

const optionAApsr = (): ApsrBreakdown => ({
  approach: { status: "Meeting", note: "PPD documents the review cycle.", sourceChunkIds: ["C001"] },
  processes: { status: "Deployed", note: "MR minutes evidenced.", sourceChunkIds: ["C002"] },
  systemsOutcomes: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE, sourceChunkIds: [] },
  review: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE, sourceChunkIds: [] },
});

function seedEntry(): SubCriterionChecklistEntry {
  return {
    gd4ItemId: ITEM,
    pendingGenerated: [],
    specific: [
      {
        id: "L1",
        text: "Conduct management reviews at planned intervals",
        status: "Met",
        generatedBy: "ai",
        sourceRef: "6.2.1.DS1",
        evidence: [
          { id: "EV1", title: "PPD + Evidence assessment EV-6.2-TEST", type: "Record/Log", owner: "", date: "2026-07-17", approved: false, reviewed: false, sufficiency: "Present", apsr: optionAApsr(), runId: "EV-6.2-TEST" },
        ],
      },
      // Never-audited manual line: no APSR snapshot to update — must be skipped.
      { id: "L2", text: "A manual line", status: "Not met", generatedBy: "manual", evidence: [] },
    ],
    holisticBand: {
      band: 3,
      matrixScores: { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 },
      totalPct: 50,
      rationale: "A=20, P=20, S=10, R=0 = 50%.",
      source: "human",
      decidedAt: "2026-07-17T00:00:00.000Z",
    },
  };
}

const NEW_SO: ApsrBreakdown["systemsOutcomes"] = { status: "Evident", note: "KPI dashboard covers the review period.", sourceChunkIds: ["C009"] };
const NEW_REVIEW: ApsrBreakdown["review"] = { status: "Evident", note: "Management review minutes with improvement actions.", sourceChunkIds: ["C009"] };

beforeEach(() => {
  useChecklistModuleStore.setState({ entries: { [ITEM]: seedEntry() } });
});

describe("applyOutcomeReviewLegs — surgical write", () => {
  it("updates ONLY the S&O and Review legs on the audited evidence item; everything else is untouched", () => {
    const n = useChecklistModuleStore.getState().applyOutcomeReviewLegs([
      { itemId: ITEM, lineId: "L1", systemsOutcomes: NEW_SO, review: NEW_REVIEW },
    ]);
    expect(n).toBe(1);
    const line = useChecklistModuleStore.getState().entries[ITEM]!.specific.find((l) => l.id === "L1")!;
    const apsr = line.evidence[0].apsr!;
    expect(apsr.systemsOutcomes).toEqual(NEW_SO);
    expect(apsr.review).toEqual(NEW_REVIEW);
    // The Option A legs and the line's scoring inputs are untouched.
    expect(apsr.approach).toEqual(optionAApsr().approach);
    expect(apsr.processes).toEqual(optionAApsr().processes);
    expect(line.status).toBe("Met");
    expect(line.evidence[0].sufficiency).toBe("Present");
    expect(line.evidence[0].evidenceVerdict).toBeUndefined();
  });

  it("skips a line with no APSR snapshot (never audited) and reports only real writes", () => {
    const n = useChecklistModuleStore.getState().applyOutcomeReviewLegs([
      { itemId: ITEM, lineId: "L2", systemsOutcomes: NEW_SO, review: NEW_REVIEW },
      { itemId: ITEM, lineId: "L-missing", systemsOutcomes: NEW_SO, review: NEW_REVIEW },
    ]);
    expect(n).toBe(0);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.specific.find((l) => l.id === "L2")!.evidence).toEqual([]);
  });
});

describe("applyOutcomeReviewLegs — NO band movement (byte-identical scoring)", () => {
  it("computeChecklistOverrides and buildScored are byte-identical before and after applying the pass legs", () => {
    const before = useChecklistModuleStore.getState().entries;
    const overridesBefore = computeChecklistOverrides(before, GD4_REQUIREMENTS);
    const scoredBefore = buildScored({ evidence: {}, reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overridesBefore });

    const n = useChecklistModuleStore.getState().applyOutcomeReviewLegs([
      { itemId: ITEM, lineId: "L1", systemsOutcomes: NEW_SO, review: NEW_REVIEW },
    ]);
    expect(n).toBe(1);

    const after = useChecklistModuleStore.getState().entries;
    const overridesAfter = computeChecklistOverrides(after, GD4_REQUIREMENTS);
    const scoredAfter = buildScored({ evidence: {}, reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overridesAfter });

    expect(JSON.stringify(overridesAfter)).toBe(JSON.stringify(overridesBefore));
    const digest = (s: ReturnType<typeof buildScored>) =>
      JSON.stringify({ total: s.total, award: s.award, gates: s.gates, bands: s.items.map((i) => [i.id, i.band, i.eff]) });
    expect(digest(scoredAfter)).toBe(digest(scoredBefore));
  });
});
