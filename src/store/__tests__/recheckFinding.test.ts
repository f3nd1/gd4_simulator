// recheckFinding — the clarification-stage "Re-check this finding" action.
// It resolves a finding to its Evidence Folder scope + requirement line(s),
// guards that an Option A run exists to re-check against, then reuses
// runEvidenceAssessment's retryRefs engine. These tests cover the pure guard /
// resolution logic and the no-op detection (the full retry, which needs Drive
// + AI, is exercised live in the browser). Invariants:
//   1. A finding with no Option A run for its scope is not re-checkable.
//   2. A finding that traces to no PPD-row ref is not re-checkable.
//   3. When the underlying run no-ops (no auditor/Drive), the action reports the
//      real blocker and NEVER fabricates a "still not met" verdict.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");

import type { Finding, PPDReviewRow, EvidenceAssessmentRow } from "../../types";

const SCOPE = "6.3"; // 6.3.1's sub-criterion (not a split sub, so scope == sub)

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-cc", auditCycleId: "cycle-1", gd4ItemId: "6.3.1", issue: "Monitoring gap",
    type: "AFI", severity: "Medium", owner: "", dueDate: "", repeatFinding: false,
    overdue: false, managementDecisionNeeded: false, status: "Open",
    source: "Audit", clause: "6.3.1.DS1", ...over,
  };
}
const ppdRow = (over: Partial<PPDReviewRow> = {}): PPDReviewRow => ({
  ref: "6.3.1.DS1", gd4ItemId: "6.3.1", requirementText: "Agents are monitored.",
  verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], chunkIds: [], ...over,
});
const evRow = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "6.3.1.DS1", gd4ItemId: "6.3.1", requirementText: "Agents are monitored.",
  ppdExtract: "x", ppdVerdict: "Adequate", evidenceSummary: "Log sighted.",
  evidenceFiles: [], evidenceChunkIds: [], verdict: "Not met", comment: "Gap.", ...over,
});

beforeEach(() => {
  useWorkspaceStore.setState({
    customFindings: [],
    ppdReviewResults: {},
    evidenceAssessments: {},
    auditors: [],
    activeAuditorId: undefined,
    busy: null,
    auditBlockedReason: null,
  });
});

describe("recheckFinding — guards", () => {
  it("refuses an unknown / demo finding id", async () => {
    const r = await useWorkspaceStore.getState().recheckFinding("nope");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/cannot be re-checked/i);
  });

  it("refuses when there is no Option A evidence run for the item's scope", async () => {
    useWorkspaceStore.setState({ customFindings: [finding()] });
    const r = await useWorkspaceStore.getState().recheckFinding("F-cc");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no Option A evidence run/i);
  });

  it("refuses when the finding traces to no re-checkable requirement-line ref", async () => {
    useWorkspaceStore.setState({
      customFindings: [finding({ clause: "6.3.1.DSX", linkedSourceRefs: [] })],
      ppdReviewResults: { [SCOPE]: { subCriterionId: SCOPE, runAt: "t", live: true, rows: [ppdRow()], fileLedger: [] } },
      evidenceAssessments: { [SCOPE]: { subCriterionId: SCOPE, runAt: "t", live: true, rows: [evRow()], runId: "EV-6.3-X" } },
    });
    const r = await useWorkspaceStore.getState().recheckFinding("F-cc");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/does not trace to a specific evidence line/i);
  });
});

describe("recheckFinding — no-op detection (never fabricates a verdict)", () => {
  it("an eligible finding whose re-run cannot start (no auditor) reports the blocker, not a false 'still Not met'", async () => {
    useWorkspaceStore.setState({
      customFindings: [finding()],
      ppdReviewResults: { [SCOPE]: { subCriterionId: SCOPE, runAt: "t", live: true, rows: [ppdRow()], fileLedger: [] } },
      evidenceAssessments: { [SCOPE]: { subCriterionId: SCOPE, runAt: "t0", live: true, rows: [evRow()], runId: "EV-6.3-X" } },
      auditors: [], activeAuditorId: undefined, // runEvidenceAssessment's auditor gate blocks the run
    });
    const r = await useWorkspaceStore.getState().recheckFinding("F-cc");
    expect(r.ok).toBe(false);
    // The real blocker surfaced, never a fabricated verdict line.
    expect(r.message).not.toMatch(/still Not met|now Met/);
    // The stored assessment was not mutated (runAt unchanged).
    expect(useWorkspaceStore.getState().evidenceAssessments[SCOPE].runAt).toBe("t0");
  });
});
