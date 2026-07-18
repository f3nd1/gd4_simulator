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
const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useScoringConfigStore } = await import("../useScoringConfigStore");
const { computeChecklistOverrides } = await import("../../lib/checklistBanding");
const { buildScored } = await import("../../lib/scoring");
const { GD4_REQUIREMENTS } = await import("../../data/gd4Requirements");

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

  it("seeds the working copy (apsrMatrix) to mirror the saved matrixScores, for human AND ai-auto saves (2026-07-18 display-bug fix)", () => {
    // The editable grid reads entry.apsrMatrix; without this, an ai-auto save
    // wrote holisticBand but left apsrMatrix empty and the grid showed dashes.
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "AI rationale.", source: "ai-auto" });
    const e1 = useChecklistModuleStore.getState().entries[ITEM]!;
    expect(e1.apsrMatrix).toEqual(WORKED);
    expect(e1.apsrMatrix).toEqual(e1.holisticBand!.matrixScores);
    // A later human save keeps the two in sync too.
    const OTHER = { approach: 5, processes: 3, systemsOutcomes: 2, review: 1 } as const;
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: OTHER, rationale: "Human reasoning.", source: "human" });
    const e2 = useChecklistModuleStore.getState().entries[ITEM]!;
    expect(e2.apsrMatrix).toEqual(OTHER);
    expect(e2.apsrMatrix).toEqual(e2.holisticBand!.matrixScores);
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

describe("applyLineDimensionTags — batched auto-tag on accepting an AI band suggestion (2026-07-15)", () => {
  beforeEach(() => {
    useChecklistModuleStore.setState({
      entries: {
        [ITEM]: {
          gd4ItemId: ITEM,
          pendingGenerated: [],
          specific: [
            { id: "L1", text: "Untagged line", status: "Not met", evidence: [], generatedBy: "ai" },
            { id: "L2", text: "Already human-tagged line", status: "Not met", evidence: [], generatedBy: "ai", apsrDimension: "Approach" },
          ],
        },
      },
    });
  });

  it("tags a currently-untagged line", () => {
    useChecklistModuleStore.getState().applyLineDimensionTags(ITEM, [{ lineId: "L1", dimension: "Processes" }]);
    const specific = useChecklistModuleStore.getState().entries[ITEM]!.specific;
    expect(specific.find((l) => l.id === "L1")!.apsrDimension).toBe("Processes");
  });

  it("never overwrites a line that already has a dimension — the human's manual pick always wins", () => {
    useChecklistModuleStore.getState().applyLineDimensionTags(ITEM, [{ lineId: "L2", dimension: "Review" }]);
    const specific = useChecklistModuleStore.getState().entries[ITEM]!.specific;
    expect(specific.find((l) => l.id === "L2")!.apsrDimension).toBe("Approach"); // unchanged
  });

  it("applies a full batch in one call, tagging only the untagged lines within it", () => {
    useChecklistModuleStore.getState().applyLineDimensionTags(ITEM, [
      { lineId: "L1", dimension: "Systems & Outcomes" },
      { lineId: "L2", dimension: "Review" }, // already tagged — must be ignored
    ]);
    const specific = useChecklistModuleStore.getState().entries[ITEM]!.specific;
    expect(specific.find((l) => l.id === "L1")!.apsrDimension).toBe("Systems & Outcomes");
    expect(specific.find((l) => l.id === "L2")!.apsrDimension).toBe("Approach");
  });

  it("is a no-op on an empty tag list", () => {
    const before = useChecklistModuleStore.getState().entries[ITEM];
    useChecklistModuleStore.getState().applyLineDimensionTags(ITEM, []);
    expect(useChecklistModuleStore.getState().entries[ITEM]).toBe(before); // same reference — no state churn
  });
});

describe("clearSpecificLines — 'Remove all' genuinely resets the item to unassessed (2026-07-15 fix)", () => {
  // Before the fix, clearSpecificLines only emptied `specific`/`pendingGenerated`,
  // leaving `holisticBand` (and its matrixScores) behind — a stale band with
  // zero supporting lines that computeChecklistOverrides still fed into the
  // certification score, and that the Final Report still rendered as a
  // populated table. "Remove all" must now clear the band and the live
  // (unsaved) matrix working state too, alongside the lines.
  beforeEach(() => {
    useChecklistModuleStore.setState({
      entries: {
        [ITEM]: {
          gd4ItemId: ITEM,
          pendingGenerated: [{ id: "P1", text: "pending", status: "Not met", evidence: [], generatedBy: "ai" }],
          specific: [{ id: "L1", text: "A real line", status: "Met", evidence: [], generatedBy: "ai" }],
          holisticBand: { band: 3, totalPct: 50, matrixScores: WORKED, rationale: "x", source: "human", decidedAt: "2026-07-15T00:00:00.000Z" },
          apsrMatrix: { approach: 4 },
        },
      },
    });
  });

  it("clears specific and pendingGenerated (existing behaviour)", () => {
    useChecklistModuleStore.getState().clearSpecificLines(ITEM);
    const e = useChecklistModuleStore.getState().entries[ITEM]!;
    expect(e.specific).toEqual([]);
    expect(e.pendingGenerated).toEqual([]);
  });

  it("also clears the saved holisticBand — no stale band/matrixScores survive", () => {
    useChecklistModuleStore.getState().clearSpecificLines(ITEM);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.holisticBand).toBeUndefined();
  });

  it("also clears the live apsrMatrix working state", () => {
    useChecklistModuleStore.getState().clearSpecificLines(ITEM);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.apsrMatrix).toBeUndefined();
  });
});

describe('setHolisticBand — "ai-auto" source (auto-score setting, 2026-07-18)', () => {
  // An automatic save must be distinguishable from a human one everywhere:
  // stored source "ai-auto", logged decisionType "Automatic" with wording
  // that can never read as a human act. Gates 1 and 2 apply unchanged.
  beforeEach(() => {
    useWorkspaceStore.setState({ humanDecisionLog: [] });
  });

  it("saves with source ai-auto and logs an Automatic entry, never a human decision", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "AI rationale from suggestion.", source: "ai-auto" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.source).toBe("ai-auto");
    expect(hb.band).toBe(3);
    const log = useWorkspaceStore.getState().humanDecisionLog;
    expect(log).toHaveLength(1);
    expect(log[0].decisionType).toBe("Automatic");
    expect(log[0].aiOutput).toContain("automatically");
    expect(log[0].humanDecision).toBe("No human decision yet — pending review");
  });

  it("Gate 2 (written justification) still rejects an ai-auto save with no rationale", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "", source: "ai-auto" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
    expect(useWorkspaceStore.getState().humanDecisionLog).toHaveLength(0);
  });

  it("Gate 1 (complete matrix) still rejects an incomplete ai-auto save", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: { approach: 4, processes: 4, systemsOutcomes: 2 }, rationale: "AI rationale.", source: "ai-auto" });
    expect(useChecklistModuleStore.getState().entries[ITEM]?.holisticBand).toBeUndefined();
  });

  it("a human re-save over an ai-auto band clears the flag and re-logs as a human decision", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "AI rationale.", source: "ai-auto" });
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "Reviewed and confirmed by me.", source: "human" });
    const hb = useChecklistModuleStore.getState().entries[ITEM]!.holisticBand!;
    expect(hb.source).toBe("human");
    const log = useWorkspaceStore.getState().humanDecisionLog;
    expect(log).toHaveLength(2);
    // Newest-first log: [0] is the human re-save.
    const human = log.find((e) => e.decisionType !== "Automatic")!;
    expect(human.decisionType).toBe("Accepted"); // same band, human confirms
    expect(human.humanDecision).toContain("Band 3");
  });

  it("human saves log exactly as before — unchanged entries for human and ai-accepted", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "My own reasoning.", source: "human" });
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: { approach: 5, processes: 4, systemsOutcomes: 2, review: 0 }, rationale: "Accepting AI scores.", source: "ai-accepted" });
    const log = useWorkspaceStore.getState().humanDecisionLog;
    expect(log.every((e) => e.decisionType !== "Automatic")).toBe(true);
    expect(log.some((e) => e.decisionType === "Accepted")).toBe(true);
  });
});

describe("auto-score setting OFF — byte-identical scoring (nothing reads the toggle)", () => {
  it("computeChecklistOverrides and buildScored are byte-identical with autoScoreBands off vs on", () => {
    useChecklistModuleStore.getState().setHolisticBand(ITEM, { matrixScores: WORKED, rationale: "A=20, P=20, S=10, R=0 = 50%.", source: "human" });
    const entries = useChecklistModuleStore.getState().entries;
    const digest = () => {
      const overrides = computeChecklistOverrides(entries, GD4_REQUIREMENTS);
      const s = buildScored({ evidence: {}, reviewer: {}, confirmed: {}, closures: {}, checklistBandOverrides: overrides });
      return JSON.stringify({ overrides, total: s.total, award: s.award, gates: s.gates, bands: s.items.map((i) => [i.id, i.band, i.eff]) });
    };
    useScoringConfigStore.setState({ autoScoreBands: false });
    const off = digest();
    useScoringConfigStore.setState({ autoScoreBands: true });
    const on = digest();
    useScoringConfigStore.setState({ autoScoreBands: false });
    expect(on).toBe(off);
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

describe("clearApsrMatrix — undo an AI-first-pass suggestion (2026-07-18)", () => {
  // The matrix cells can be re-picked but never un-set, so an accidental
  // "AI first pass (suggest scores)" click otherwise strands the four scores
  // with no removal path. Clearing must wipe the whole working matrix and
  // touch nothing else on the entry.
  it("wipes the whole working matrix back to un-set", () => {
    const s = useChecklistModuleStore.getState();
    s.setApsrMatrix(ITEM, "approach", 4);
    s.setApsrMatrix(ITEM, "processes", 4);
    s.setApsrMatrix(ITEM, "review", 0);
    s.clearApsrMatrix(ITEM);
    expect(useChecklistModuleStore.getState().entries[ITEM]!.apsrMatrix).toBeUndefined();
  });

  it("leaves the saved band, lines and pendingGenerated untouched", () => {
    useChecklistModuleStore.setState({
      entries: {
        [ITEM]: {
          gd4ItemId: ITEM,
          pendingGenerated: [{ id: "P1", text: "pending", status: "Not met", evidence: [], generatedBy: "ai" }],
          specific: [{ id: "L1", text: "A real line", status: "Met", evidence: [], generatedBy: "ai" }],
          holisticBand: { band: 3, totalPct: 50, matrixScores: WORKED, rationale: "x", source: "human", decidedAt: "2026-07-18T00:00:00.000Z" },
          apsrMatrix: { approach: 4, processes: 4, systemsOutcomes: 2, review: 0 },
        },
      },
    });
    useChecklistModuleStore.getState().clearApsrMatrix(ITEM);
    const e = useChecklistModuleStore.getState().entries[ITEM]!;
    expect(e.apsrMatrix).toBeUndefined();
    expect(e.holisticBand).toBeDefined();
    expect(e.specific).toHaveLength(1);
    expect(e.pendingGenerated).toHaveLength(1);
  });
});
