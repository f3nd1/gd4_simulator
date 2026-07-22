// runClarificationRound — the batch "clarification round" re-check built on top
// of the per-finding recheckFinding engine. These cover the pure resolution /
// weakest-verdict helpers and the driver's guards + honest round record (the
// full sequential retry, which needs Drive + AI, is exercised live in the
// browser). Invariants:
//   1. Selecting nothing re-checkable produces no round and an honest message.
//   2. Findings are grouped by scope; a scope that can't re-run is a blocker,
//      not a fabricated verdict.
//   3. A round is always recorded with accurate before/after + counts, and
//      clarificationProgress is cleared when it ends.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore, resolveRecheckTarget, weakestVerdict } = await import("../useWorkspaceStore");

import type { Finding, PPDReviewRow, EvidenceAssessmentRow } from "../../types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1", auditCycleId: "cycle-1", gd4ItemId: "6.3.1", issue: "Monitoring gap",
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
    customFindings: [], ppdReviewResults: {}, evidenceAssessments: {},
    auditors: [], activeAuditorId: undefined, busy: null, auditBlockedReason: null,
    clarificationRounds: [], clarificationProgress: null,
  });
});

describe("weakestVerdict", () => {
  it("returns the weakest of a finding's line verdicts", () => {
    expect(weakestVerdict(["Met", "Partial", "Met"])).toBe("Partial");
    expect(weakestVerdict(["Met", "Not met"])).toBe("Not met");
    expect(weakestVerdict(["Met", "Met"])).toBe("Met");
  });
  it("ignores neutral 'Not assessed' and falls back cleanly when nothing ranks", () => {
    expect(weakestVerdict(["Met", "Not assessed"])).toBe("Met");
    expect(weakestVerdict(["Not assessed"])).toBe("Not assessed");
    expect(weakestVerdict([])).toBe("—");
  });
});

describe("resolveRecheckTarget", () => {
  it("resolves a finding to its scope + traced line refs", () => {
    const r = resolveRecheckTarget(
      finding(),
      { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [ppdRow()] } },
      { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [evRow()] } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.scope).toBe("6.3"); expect(r.retryRefs).toEqual(["6.3.1.DS1"]); }
  });
  it("rejects when no Option A run exists for the scope", () => {
    const r = resolveRecheckTarget(finding(), {}, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no Option A evidence run/i);
  });
  it("rejects when the finding traces to no PPD-row ref", () => {
    const r = resolveRecheckTarget(
      finding({ clause: "9.9.9.DS9" }),
      { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [ppdRow()] } },
      { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [evRow()] } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not trace/i);
  });
});

describe("runClarificationRound — driver guards", () => {
  it("re-checks nothing and reports honestly when the selection can't be resolved", async () => {
    useWorkspaceStore.setState({ customFindings: [finding()] }); // no Option A run seeded
    const r = await useWorkspaceStore.getState().runClarificationRound(["F-1"]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nothing could be re-checked/i);
    expect(useWorkspaceStore.getState().clarificationRounds).toHaveLength(0);
    expect(useWorkspaceStore.getState().clarificationProgress).toBeNull();
  });

  it("records a round with a blocker (never a fabricated verdict) when a scope's re-run no-ops", async () => {
    // Seed a resolvable finding but NO auditor / Drive, so runEvidenceAssessment
    // no-ops. The round must still be recorded, with the scope listed as a blocker
    // and the verdict left as its real (unchanged) value.
    useWorkspaceStore.setState({
      customFindings: [finding()],
      ppdReviewResults: { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [ppdRow()] } },
      evidenceAssessments: { "6.3": { subCriterionId: "6.3", runAt: "t", live: true, rows: [evRow()] } },
    });
    const r = await useWorkspaceStore.getState().runClarificationRound(["F-1"]);
    expect(r.ok).toBe(true);
    const rounds = useWorkspaceStore.getState().clarificationRounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].roundNumber).toBe(1);
    expect(rounds[0].findingCount).toBe(1);
    expect(rounds[0].findings[0].before).toBe("Not met");
    expect(rounds[0].findings[0].after).toBe("Not met"); // unchanged — no fabrication
    expect(rounds[0].blockers?.length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().clarificationProgress).toBeNull();
  });
});
