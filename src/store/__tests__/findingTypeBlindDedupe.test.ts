// R9 fix (2026-07-16): the finding-raise dedupe key includes findingType, so a
// verdict-class change between audit passes (Not met -> Partial flips NC ->
// OFI) used to raise a SIBLING finding for the same gap once the checklist
// lines had been recreated (regeneration / re-run) and the line stamp was
// gone. The type-blind second pass (findOpenFindingForGap, reusing the
// carryoverKey gap identity) must relink and flag for human review instead of
// creating, must never auto-relabel, and must never let an OBS (a strength
// record) or a Closed finding suppress a genuinely new raise.
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
const { findOpenFindingForGap, CLASSIFICATION_REVIEW_MARKER } = await import("../../lib/cycleCarryover");
import type { Finding, SpecificChecklistLine } from "../../types";

const ITEM = "6.3.1";
const REF = "6.3.1.DS4";

function line(over: Partial<SpecificChecklistLine> & { id: string }): SpecificChecklistLine {
  return { text: "Evaluate the effectiveness of the innovation and improvement implemented", clause: REF, sourceRef: REF, status: "Not met", evidence: [], generatedBy: "ai", ...over };
}
function seedEntry(lines: SpecificChecklistLine[]) {
  useChecklistModuleStore.setState({ entries: { [ITEM]: { gd4ItemId: ITEM, specific: lines, pendingGenerated: [] } } });
}
function openFinding(over: Partial<Finding> & { id: string }): Finding {
  return { auditCycleId: "c1", gd4ItemId: ITEM, issue: "Gap", type: "AFI", severity: "Medium", owner: "", dueDate: "", repeatFinding: false, overdue: false, managementDecisionNeeded: false, status: "Open", clause: REF, linkedSourceRefs: [REF], ...over };
}

beforeEach(() => {
  useChecklistModuleStore.setState({ entries: {} });
  useWorkspaceStore.setState({ customFindings: [], closures: {}, priorCycleFindings: null });
});

describe("type-blind dedupe - the exact R9 sequence raises no duplicate", () => {
  it("raise (Not met -> NC), recreate the line, re-raise as Partial (-> OFI): still ONE finding, flagged for review, new line relinked", () => {
    // Pass 1: a Not met line raises one NC finding.
    seedEntry([line({ id: "L1", status: "Not met" })]);
    const raised1 = useChecklistModuleStore.getState().raiseAllUnmetFindings();
    expect(raised1).toBe(1);
    const after1 = useWorkspaceStore.getState().customFindings;
    expect(after1).toHaveLength(1);
    expect(after1[0].findingType).toBe("NC");

    // Between passes: the checklist lines are RECREATED (regeneration or a
    // re-run write) - a fresh line id, no draftFinding stamp - and the later
    // pass judges the same gap Partial, which types the raise OFI.
    seedEntry([line({ id: "L2", status: "Partial" })]);
    const raised2 = useChecklistModuleStore.getState().raiseAllUnmetFindings();

    // No duplicate created, and the honest count reports 0 new.
    const after2 = useWorkspaceStore.getState().customFindings;
    expect(after2).toHaveLength(1);
    expect(raised2).toBe(0);
    // The existing finding is flagged for review, never auto-relabelled.
    expect(after2[0].findingType).toBe("NC"); // classification untouched
    expect(after2[0].observation).toContain(CLASSIFICATION_REVIEW_MARKER);
    expect(after2[0].observation).toContain("raised as NC");
    expect(after2[0].observation).toContain("now reads it as OFI");
    // The new line is relinked to the existing finding (no re-raise lock gap).
    const l2 = useChecklistModuleStore.getState().entries[ITEM].specific.find((l) => l.id === "L2")!;
    expect(l2.draftFinding?.savedFindingId).toBe(after2[0].id);
  });

  it("the flag is idempotent: a third pass over another recreated line does not stack a second marker", () => {
    seedEntry([line({ id: "L1", status: "Not met" })]);
    useChecklistModuleStore.getState().raiseAllUnmetFindings();
    seedEntry([line({ id: "L2", status: "Partial" })]);
    useChecklistModuleStore.getState().raiseAllUnmetFindings();
    seedEntry([line({ id: "L3", status: "Partial" })]);
    useChecklistModuleStore.getState().raiseAllUnmetFindings();
    const f = useWorkspaceStore.getState().customFindings;
    expect(f).toHaveLength(1);
    const occurrences = (f[0].observation ?? "").split(CLASSIFICATION_REVIEW_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("a SAME-type re-raise on a recreated line still relinks silently via the typed key (no review flag)", () => {
    seedEntry([line({ id: "L1", status: "Not met" })]);
    useChecklistModuleStore.getState().raiseAllUnmetFindings();
    seedEntry([line({ id: "L2", status: "Not met" })]);
    useChecklistModuleStore.getState().raiseAllUnmetFindings();
    const f = useWorkspaceStore.getState().customFindings;
    expect(f).toHaveLength(1);
    expect(f[0].observation ?? "").not.toContain(CLASSIFICATION_REVIEW_MARKER);
  });
});

describe("type-blind dedupe - what must NOT suppress", () => {
  it("an open OBS (strength record) never blocks a new NC for a regression on the same ref", () => {
    useWorkspaceStore.setState({ customFindings: [openFinding({ id: "F-OBS", findingType: "OBS", issue: "Well evidenced." })] });
    seedEntry([line({ id: "L1", status: "Not met" })]);
    const raised = useChecklistModuleStore.getState().raiseAllUnmetFindings();
    expect(raised).toBe(1);
    const f = useWorkspaceStore.getState().customFindings;
    expect(f).toHaveLength(2); // the OBS plus a genuinely new NC
    expect(f.find((x) => x.id === "F-OBS")!.observation ?? "").not.toContain(CLASSIFICATION_REVIEW_MARKER);
  });

  it("a CLOSED finding never suppresses - a recurrence of a closed gap raises fresh", () => {
    useWorkspaceStore.setState({ customFindings: [openFinding({ id: "F-CLOSED", findingType: "NC", status: "Closed" })] });
    seedEntry([line({ id: "L1", status: "Partial" })]);
    const raised = useChecklistModuleStore.getState().raiseAllUnmetFindings();
    expect(raised).toBe(1);
    expect(useWorkspaceStore.getState().customFindings).toHaveLength(2);
  });
});

describe("findOpenFindingForGap - the helper's own scope", () => {
  it("matches an open NC/OFI on the same item+ref, whatever the type", () => {
    const nc = openFinding({ id: "F-1", findingType: "NC" });
    expect(findOpenFindingForGap([nc], ITEM, REF)?.id).toBe("F-1");
    const ofi = openFinding({ id: "F-2", findingType: "OFI" });
    expect(findOpenFindingForGap([ofi], ITEM, REF)?.id).toBe("F-2");
    // A legacy finding with no findingType resolves to NC and still matches.
    const legacy = openFinding({ id: "F-3", findingType: undefined });
    expect(findOpenFindingForGap([legacy], ITEM, REF)?.id).toBe("F-3");
  });

  it("never matches OBS, Closed, a different ref, a different item, or a ref-less lookup", () => {
    expect(findOpenFindingForGap([openFinding({ id: "F-1", findingType: "OBS" })], ITEM, REF)).toBeUndefined();
    expect(findOpenFindingForGap([openFinding({ id: "F-2", findingType: "NC", status: "Closed" })], ITEM, REF)).toBeUndefined();
    expect(findOpenFindingForGap([openFinding({ id: "F-3", findingType: "NC" })], ITEM, "6.3.1.DS5")).toBeUndefined();
    expect(findOpenFindingForGap([openFinding({ id: "F-4", findingType: "NC" })], "6.2.1", REF)).toBeUndefined();
    expect(findOpenFindingForGap([openFinding({ id: "F-5", findingType: "NC" })], ITEM, undefined)).toBeUndefined();
  });
});
