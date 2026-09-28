// THE HARD RULE: a re-read must never reach the calibration library.
//
// logHumanDecision auto-promotes any entry with changed: true and a non-empty
// reason into calibrationExamples, and calibration memories are injected into
// later AI prompts as LEARNED CORRECTIONS. If a re-read could promote, then
// re-reading until the answer changed would not only alter this run, it would
// teach the tool to prefer that answer in every future run. That is the
// compounding version of the problem the re-read trace exists to prevent.
//
// These tests drive recheckFileLines END TO END rather than testing
// logHumanDecision, because the rule is about the action, not about one
// function: a second route into the library added later must fail here too.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");

import type { AuditFileRecord, EvidenceAssessmentResult, EvidenceAssessmentRow } from "../../types";

const SCOPE = "6.3";
const FILE_ID = "drive-abc";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "6.3.1.DS1", gd4ItemId: "6.3.1", requirementText: "Agents are monitored.",
  ppdExtract: "x", ppdVerdict: "Adequate", evidenceSummary: "Log sighted.",
  evidenceFiles: [], evidenceChunkIds: ["C001"], verdict: "Not met", comment: "Gap.", ...over,
});
const ledger = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
  path: "2. Actual Evidence/Agent Log.pdf", name: "Agent Log.pdf", mimeType: "application/pdf",
  fileKind: "PDF", bucket: "evidence", readStatus: "read", auditStatus: "cited",
  charCount: 900, driveFileId: FILE_ID, chunkIds: ["C001"], ...over,
});
const result = (over: Partial<EvidenceAssessmentResult> = {}): EvidenceAssessmentResult => ({
  subCriterionId: SCOPE, rows: [row()], runAt: "2026-09-27T01:00:00.000Z", live: true,
  runId: "EV-6.3-FIRST", chunkFileNames: { C001: "Agent Log.pdf" }, fileLedger: [ledger()], ...over,
});

/** Stands in for the real run: writes a completed result with a NEW runAt and
 *  the verdict the re-read produced, which is what recheckFileLines checks for.
 *  The real one needs Drive and an AI key; everything after it is real code. */
let fakeRunTick = 0;
function fakeRunWritingVerdict(verdict: EvidenceAssessmentRow["verdict"]) {
  return async (scope: string) => {
    // Strictly increasing: recheckFileLines detects a completed run by runAt
    // changing, and two fakes in the same millisecond would look like a run
    // that never happened.
    fakeRunTick += 1000;
    const cur = useWorkspaceStore.getState().evidenceAssessments[scope]!;
    useWorkspaceStore.setState({
      evidenceAssessments: {
        ...useWorkspaceStore.getState().evidenceAssessments,
        [scope]: { ...cur, rows: cur.rows.map((r) => ({ ...r, verdict })), runAt: new Date(Date.now() + fakeRunTick).toISOString(), runId: "EV-6.3-SECOND" },
      },
    });
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    evidenceAssessments: { [SCOPE]: result() },
    calibrationExamples: [],
    calibrationMemories: [],
    humanDecisionLog: [],
    fileTextCache: {},
    busy: null,
    auditBlockedReason: null,
  });
});

describe("a re-read never reaches the calibration library", () => {
  it("adds nothing to it, even when the verdict flips to Met", async () => {
    useWorkspaceStore.setState({ runEvidenceAssessment: fakeRunWritingVerdict("Met") });
    const before = {
      examples: useWorkspaceStore.getState().calibrationExamples,
      memories: useWorkspaceStore.getState().calibrationMemories,
    };
    const r = await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    expect(r.ok, r.message).toBe(true);
    // The verdict really did move, so this is not passing by doing nothing.
    expect(useWorkspaceStore.getState().evidenceAssessments[SCOPE]!.rows[0].verdict).toBe("Met");
    expect(useWorkspaceStore.getState().calibrationExamples).toEqual(before.examples);
    expect(useWorkspaceStore.getState().calibrationMemories).toEqual(before.memories);
  });

  it("writes no promotable human-decision entry either", async () => {
    useWorkspaceStore.setState({ runEvidenceAssessment: fakeRunWritingVerdict("Met") });
    await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    // A re-read may legitimately be logged as a decision one day. What it may
    // never be is a CHANGED one with a reason, because that is the shape
    // logHumanDecision promotes.
    for (const e of useWorkspaceStore.getState().humanDecisionLog) {
      expect(e.changed && e.reason.trim().length > 0, `${e.module}: ${e.reason}`).toBe(false);
    }
  });

  it("adds nothing when the re-read cannot run at all", async () => {
    // The blocked path writes no result, so it must also write no learning.
    useWorkspaceStore.setState({ runEvidenceAssessment: async () => {} });
    const r = await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    expect(r.ok).toBe(false);
    expect(useWorkspaceStore.getState().calibrationExamples).toEqual([]);
    expect(useWorkspaceStore.getState().calibrationMemories).toEqual([]);
  });

  // POSITIVE CONTROL. Without this, the three tests above would still pass if
  // the promotion mechanism were removed or renamed, and they would be proving
  // nothing. This shows the library IS reachable and that the assertions above
  // can see it.
  it("the library is genuinely reachable, so the checks above mean something", () => {
    useWorkspaceStore.getState().logHumanDecision({
      module: "Line Status", subjectId: "6.3.1.DS1", aiOutput: "Not met", humanDecision: "Met",
      changed: true, decisionType: "Overridden", reason: "The log was in the second folder.",
    });
    expect(useWorkspaceStore.getState().calibrationExamples.length).toBe(1);
  });
});

// The structural half: the rule is about every route, so the action's own code
// must not call a library writer at all. A behavioural test can only see the
// routes it drives; this one sees the whole action.
describe("no calibration writer is called from the re-read action", () => {
  const SRC = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
  const action = SRC.slice(SRC.indexOf("recheckFileLines: async"), SRC.indexOf("recheckFinding: async"));

  it("found the action, so the slice below is real", () => {
    expect(action.length).toBeGreaterThan(500);
    expect(action).toContain("runEvidenceAssessment");
  });

  it.each(["addCalibrationMemory", "logHumanDecision", "calibrationExamples", "calibrationMemories"])(
    "never touches %s",
    (writer) => {
      const code = action.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(code).not.toContain(writer);
    },
  );
});

// The trace itself, driven through the same real action. It lives on the
// RESULT rather than in the human-decision log or the run history, because both
// of those can be cleared from the UI and a trace that can be deleted is not
// one.
describe("the re-read records itself on the result", () => {
  it("records the file, the lines and the verdict each line carried before", async () => {
    useWorkspaceStore.setState({ runEvidenceAssessment: fakeRunWritingVerdict("Met") });
    await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    const rr = useWorkspaceStore.getState().evidenceAssessments[SCOPE]!.rereads!;
    expect(rr).toHaveLength(1);
    expect(rr[0].fileName).toBe("Agent Log.pdf");
    expect(rr[0].driveFileId).toBe(FILE_ID);
    expect(rr[0].refs).toEqual(["6.3.1.DS1"]);
    expect(rr[0].previousRunId).toBe("EV-6.3-FIRST");
    // The whole point: what the line said BEFORE, snapshotted, so the
    // comparison does not depend on the run history surviving.
    expect(rr[0].previousVerdicts).toEqual({ "6.3.1.DS1": "Not met" });
  });

  it("accumulates across re-reads rather than replacing the last one", async () => {
    useWorkspaceStore.setState({ runEvidenceAssessment: fakeRunWritingVerdict("Partial") });
    await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    useWorkspaceStore.setState({ runEvidenceAssessment: fakeRunWritingVerdict("Met") });
    await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    const rr = useWorkspaceStore.getState().evidenceAssessments[SCOPE]!.rereads!;
    expect(rr).toHaveLength(2);
    // Re-reading until the answer changes is exactly the shape this makes
    // legible: Not met, then Partial, then Met, all on the record.
    expect(rr.map((x) => x.previousVerdicts["6.3.1.DS1"])).toEqual(["Not met", "Partial"]);
  });

  it("records nothing when the re-read could not run", async () => {
    useWorkspaceStore.setState({ runEvidenceAssessment: async () => {} });
    await useWorkspaceStore.getState().recheckFileLines(SCOPE, FILE_ID);
    expect(useWorkspaceStore.getState().evidenceAssessments[SCOPE]!.rereads).toBeUndefined();
  });

  it("a full whole-area run leaves no rereads field, which is how the count clears", () => {
    // finish() builds the stored result from scratch and never copies rereads
    // forward. A fresh whole-area check genuinely has no re-reads behind it.
    const finish = SRC_FOR_FULL_RUN.slice(SRC_FOR_FULL_RUN.indexOf("const finish = (rows: EvidenceAssessmentRow[] | null, live: boolean"));
    const stored = finish.slice(finish.indexOf("evidenceAssessments: rows"), finish.indexOf("evidenceAssessmentHistory: prev"));
    expect(stored).toContain("subCriterionId, rows, runAt: runAtIso");
    expect(stored).not.toContain("rereads");
  });
});

const SRC_FOR_FULL_RUN = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
