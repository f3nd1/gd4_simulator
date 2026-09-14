import { describe, it, expect, afterEach, vi } from "vitest";

// Importing these stores pulls driveClient, which builds a pdfjs Worker at
// module load. Same mock header the other store tests use.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { generateSamples } = await import("../../lib/sampling");

const logged: { decisionType?: string; humanDecision?: string; changed?: boolean }[] = [];
const origLog = useWorkspaceStore.getState().logHumanDecision;

afterEach(() => {
  logged.length = 0;
  useWorkspaceStore.setState({ logHumanDecision: origLog });
  useChecklistModuleStore.setState({ entries: {} });
});

const captureLog = () =>
  useWorkspaceStore.setState({ logHumanDecision: ((e: never) => { logged.push(e); }) as never });

const line = (id: string, text: string, by: "ai" | "manual" = "ai") =>
  ({ id, text, clause: "GD4 6.2.1", status: "Not Started", evidence: [], generatedBy: by } as never);

describe("issue 10 — records carry the ACTIVE cycle, not a literal", () => {
  it("samples are stamped with the cycle they were drawn in", () => {
    const items = [{ id: "6.2.1", crit: "6", title: "t", ais: 40, band: 2, gate: false }];
    expect(generateSamples(items, "cycle-2027")[0].auditCycleId).toBe("cycle-2027");
  });

  it("does not fall back to cycle-1", () => {
    const items = [{ id: "6.2.1", crit: "6", title: "t", ais: 40, band: 2, gate: false }];
    expect(generateSamples(items, "cycle-9")[0].auditCycleId).not.toBe("cycle-1");
  });
});

describe("issue 15 — the decision log records what the human actually did", () => {
  const seed = (pending: unknown[], snapshot: { id: string; text: string }[]) =>
    useChecklistModuleStore.setState({
      entries: { "6.2.1": { gd4ItemId: "6.2.1", specific: [], pendingGenerated: pending as never, generatedSnapshot: snapshot } as never },
    });

  it("an untouched batch is Accepted", () => {
    captureLog();
    seed([line("L1", "a"), line("L2", "b")], [{ id: "L1", text: "a" }, { id: "L2", text: "b" }]);
    useChecklistModuleStore.getState().confirmGenerated("6.2.1");
    expect(logged[0].decisionType).toBe("Accepted");
    expect(logged[0].changed).toBe(false);
  });

  // The bug: removedCount was computed by filtering an array against its own
  // id set, so it was always 0 and every confirm logged "Accepted".
  it("a REMOVED AI line is counted and the decision is Edited", () => {
    captureLog();
    seed([line("L1", "a")], [{ id: "L1", text: "a" }, { id: "L2", text: "b" }]);
    useChecklistModuleStore.getState().confirmGenerated("6.2.1");
    expect(logged[0].decisionType).toBe("Edited");
    expect(logged[0].humanDecision).toContain("removed 1 AI line");
  });

  it("a REWORDED AI line is counted, which the old self-comparison could not see", () => {
    captureLog();
    seed([line("L1", "my own wording")], [{ id: "L1", text: "a" }]);
    useChecklistModuleStore.getState().confirmGenerated("6.2.1");
    expect(logged[0].decisionType).toBe("Edited");
    expect(logged[0].humanDecision).toContain("reworded 1");
  });

  it("a line the human added is recorded as theirs", () => {
    captureLog();
    seed([line("L1", "a"), line("MINE", "my line", "manual")], [{ id: "L1", text: "a" }]);
    useChecklistModuleStore.getState().confirmGenerated("6.2.1");
    expect(logged[0].humanDecision).toContain("added 1 of their own");
  });

  it("discarding the whole batch is recorded as an override, not silence", () => {
    captureLog();
    seed([line("L1", "a"), line("L2", "b")], [{ id: "L1", text: "a" }, { id: "L2", text: "b" }]);
    useChecklistModuleStore.getState().discardGenerated("6.2.1");
    expect(logged).toHaveLength(1);
    expect(logged[0].decisionType).toBe("Overridden");
    expect(logged[0].humanDecision).toContain("Discarded all 2");
  });
});
