// The two hard gates on saving an official band (2026-07-14, user-confirmed):
//   1. a written justification is REQUIRED — no rationale, no save;
//   2. when the reviewer's own complete APSR working disagrees with the
//      selected band by ≥1 full band, a mismatch reason is REQUIRED too.
// Enforced in setHolisticBand itself so the rule holds for every caller (the
// UI mirrors it), like setClosureHuman's closure gate.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useChecklistModuleStore } = await import("../useChecklistModuleStore");

const ITEM = "6.2.1";

beforeEach(() => {
  useChecklistModuleStore.setState({ entries: {} });
});

describe("setHolisticBand — mandatory justification", () => {
  it("rejects a save with no rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 3, source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });
  it("rejects a whitespace-only rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 3, rationale: "   ", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });
  it("saves with a rationale, trimmed", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 3, rationale: "  Approach and Processes meet Band 3; Review is regular. ", source: "human" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.band).toBe(3);
    expect(hb.rationale).toBe("Approach and Processes meet Band 3; Review is regular.");
  });
});

describe("setHolisticBand — the disagreement gate", () => {
  function fillWorking(scores: [number, number, number, number]) {
    const s = useChecklistModuleStore.getState();
    s.setApsrWorking(ITEM, "approach", scores[0] as 1 | 2 | 3 | 4 | 5);
    s.setApsrWorking(ITEM, "processes", scores[1] as 1 | 2 | 3 | 4 | 5);
    s.setApsrWorking(ITEM, "systemsOutcomes", scores[2] as 1 | 2 | 3 | 4 | 5);
    s.setApsrWorking(ITEM, "review", scores[3] as 1 | 2 | 3 | 4 | 5);
  }

  it("blocks a ≥1-band disagreement with the complete working until a mismatch reason is given", () => {
    fillWorking([2, 2, 2, 2]); // average Band 2
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 4, rationale: "Holistically the systems interact well.", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();

    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 4, rationale: "Holistically the systems interact well.", source: "human", mismatchReason: "The dimension scores under-weigh the integrated student-feedback system." });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.band).toBe(4);
    expect(hb.mismatchReason).toBe("The dimension scores under-weigh the integrated student-feedback system.");
    // The working is snapshotted onto the record.
    expect(hb.dimensionScores).toEqual({ approach: 2, processes: 2, systemsOutcomes: 2, review: 2 });
  });

  it("no gate when the band agrees with the working — and a stale mismatch reason is dropped", () => {
    fillWorking([3, 3, 3, 3]);
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 3, rationale: "All four dimensions read at Band 3.", source: "human", mismatchReason: "stale text that should not persist" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.band).toBe(3);
    expect(hb.mismatchReason).toBeUndefined();
  });

  it("no gate when the working is incomplete — justification alone suffices", () => {
    useChecklistModuleStore.getState().setApsrWorking(ITEM, "approach", 1);
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { band: 5, rationale: "Benchmarked outcomes across all systems.", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!.band).toBe(5);
  });
});
