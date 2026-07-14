// The two hard gates on saving an official band (2026-07-14, user-confirmed),
// now under the APSR percentage-matrix model:
//   1. every one of the four dimensions must be scored (0% or a band 1-5) —
//      an incomplete matrix has no defensible total, no save;
//   2. a written justification is REQUIRED — no rationale, no save.
// The band itself is CALCULATED from the matrix (sum of dimension percentages
// → final band), never passed in. The old "disagreement gate" is retired: the
// matrix IS the band now, so there is nothing for it to disagree with.
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
// The auditor's worked example: A=20 + P=20 + S=10 + R=0 = 50% → Band 3.
const WORKED = { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 } as const;

beforeEach(() => {
  useChecklistModuleStore.setState({ entries: {} });
});

describe("setHolisticBand — mandatory justification", () => {
  it("rejects a save with no rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });
  it("rejects a whitespace-only rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "   ", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });
  it("saves with a rationale, trimmed", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "  Approach and Processes at Band 4; Systems at Band 2; Review not evident. ", source: "human" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.rationale).toBe("Approach and Processes at Band 4; Systems at Band 2; Review not evident.");
  });
});

describe("setHolisticBand — complete-matrix gate + calculated band", () => {
  it("rejects an incomplete matrix (a dimension left unscored) even with a rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: { approach: 4, processes: 4, systemsOutcomes: 2 }, rationale: "Review not yet scored.", source: "human" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });

  it("calculates the band, total% and snapshots the matrix from the worked example (50% → Band 3)", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "A=20, P=20, S=10, R=0 = 50%.", source: "human" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.band).toBe(3);
    expect(hb.totalPct).toBe(50);
    expect(hb.matrixScores).toEqual(WORKED);
  });

  it("accepts R=0 as a real scored dimension (0% is a valid input, distinct from unscored)", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: { approach: 5, processes: 5, systemsOutcomes: 5, review: 0 }, rationale: "Review absent; rest excellent.", source: "human" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.totalPct).toBe(75); // 25+25+25+0
    expect(hb.band).toBe(4);
  });
});

describe("setLineApsrDimension — tags an EXISTING confirmed line, no regeneration (fix b)", () => {
  const LINE_ID = "L1";
  beforeEach(() => {
    useChecklistModuleStore.setState({
      entries: {
        [ITEM]: {
          gd4ItemId: ITEM,
          generic: [],
          pendingGenerated: [],
          specific: [{ id: LINE_ID, text: "A manual line with no dimension tag", status: "Not met", evidence: [], generatedBy: "manual" }],
        },
      },
    });
  });

  it("tags a manual line that never had a dimension (no other writer sets it)", () => {
    useChecklistModuleStore.getState().setLineApsrDimension(ITEM, LINE_ID, "Review");
    const line = useChecklistModuleStore.getState().entries[ITEM]!.specific[0];
    expect(line.apsrDimension).toBe("Review");
  });

  it("re-tags an already-tagged line without touching its text/status/evidence", () => {
    useChecklistModuleStore.setState((s) => ({
      entries: { ...s.entries, [ITEM]: { ...s.entries[ITEM]!, specific: [{ ...s.entries[ITEM]!.specific[0], apsrDimension: "Approach" }] } },
    }));
    useChecklistModuleStore.getState().setLineApsrDimension(ITEM, LINE_ID, "Systems & Outcomes");
    const line = useChecklistModuleStore.getState().entries[ITEM]!.specific[0];
    expect(line.apsrDimension).toBe("Systems & Outcomes");
    expect(line.text).toBe("A manual line with no dimension tag");
    expect(line.status).toBe("Not met");
  });

  it("un-tags when passed undefined", () => {
    useChecklistModuleStore.getState().setLineApsrDimension(ITEM, LINE_ID, "Processes");
    useChecklistModuleStore.getState().setLineApsrDimension(ITEM, LINE_ID, undefined);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.specific[0].apsrDimension).toBeUndefined();
  });

  it("leaves every other line's dimension tag alone", () => {
    useChecklistModuleStore.setState((s) => ({
      entries: {
        ...s.entries,
        [ITEM]: { ...s.entries[ITEM]!, specific: [...s.entries[ITEM]!.specific, { id: "L2", text: "Another line", status: "Met", evidence: [], generatedBy: "manual", apsrDimension: "Approach" as const }] },
      },
    }));
    useChecklistModuleStore.getState().setLineApsrDimension(ITEM, LINE_ID, "Review");
    const specific = useChecklistModuleStore.getState().entries[ITEM]!.specific;
    expect(specific.find((l) => l.id === "L2")!.apsrDimension).toBe("Approach");
    expect(specific.find((l) => l.id === LINE_ID)!.apsrDimension).toBe("Review");
  });
});

describe("setApsrMatrix — the official per-dimension input", () => {
  it("stores each dimension score independently, including a genuine 0", () => {
    const s = useChecklistModuleStore.getState();
    s.setApsrMatrix(ITEM, "approach", 4);
    s.setApsrMatrix(ITEM, "review", 0);
    const m = useChecklistModuleStore.getState().entries[ITEM]!.apsrMatrix!;
    expect(m.approach).toBe(4);
    expect(m.review).toBe(0);
    expect(m.processes).toBeUndefined();
  });
  it("un-sets a dimension when passed undefined", () => {
    const s = useChecklistModuleStore.getState();
    s.setApsrMatrix(ITEM, "approach", 4);
    s.setApsrMatrix(ITEM, "approach", undefined);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.apsrMatrix!.approach).toBeUndefined();
  });
});
