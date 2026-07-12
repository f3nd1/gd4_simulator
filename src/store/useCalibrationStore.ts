// Match assessments for the AI Calibration page: per real benchmark AFI, was
// the same gap caught by the app's AI? Persisted to localStorage only — this
// is a measurement tool's working state, not audit data.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ConsistencyTestResult, ABTestResult } from "../lib/calibrationTesting";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";

export type MatchStatus = "caught" | "partial" | "missed" | "unassessed";

export type MatchAssessment = {
  afiId: string;
  status: MatchStatus;
  justification: string;
  // True once a human has edited the row — the next "Run match analysis"
  // must not overwrite a human override.
  humanOverride?: boolean;
  assessedAt?: string;
};

// One completed "Run match analysis" sweep: when it ran and the scoreboard
// totals it produced, so the page can show a trend over time.
export type CalibrationRunRecord = {
  runAt: string; // ISO
  caught: number;
  partial: number;
  missed: number;
  unassessed: number;
};

const RUN_HISTORY_CAP = 20;

type CalibrationState = {
  matches: Record<string, MatchAssessment>;
  // When the last "Run match analysis" finished (null = never run).
  lastRunAt: string | null;
  // Newest-first history of past sweeps' scoreboard totals.
  runHistory: CalibrationRunRecord[];
  setMatch: (afiId: string, status: MatchStatus, justification: string, humanOverride: boolean) => void;
  // AI-run result: only applied when the row has no human override.
  setAiMatch: (afiId: string, status: MatchStatus, justification: string) => void;
  // Called once per completed match-analysis sweep with the resulting totals.
  recordRun: (totals: Omit<CalibrationRunRecord, "runAt">) => void;
  // Consistency tab: FULL HISTORY of repeatability tests per sub-criterion,
  // newest first (scratch — measurement results only, never audit data).
  // Running a new test used to OVERWRITE the one record for that
  // sub-criterion, destroying the user's ability to compare before/after a
  // model swap or a code fix — exactly the comparison the model-regression
  // and extraction-collapse investigations both depended on. Delete/clear
  // touch ONLY these scratch records, never the real audit stores.
  consistencyTests: Record<string, ConsistencyTestResult[]>;
  // A brand-new run — PREPENDS a new history entry (never overwrites).
  addConsistencyTest: (r: ConsistencyTestResult) => void;
  // A retry-splice on an EXISTING record — replaces the entry with the
  // matching id in place (same record, not a new history entry).
  updateConsistencyTest: (r: ConsistencyTestResult) => void;
  // Deletes ONE history entry (by id), not the whole sub-criterion.
  deleteConsistencyTest: (subCriterionId: string, id: string) => void;
  clearConsistencyTests: () => void;
  // A vs B tab: latest comparison per sub-criterion.
  abTests: Record<string, ABTestResult>;
  setAbTest: (r: ABTestResult) => void;
  deleteAbTest: (subCriterionId: string) => void;
  clearAbTests: () => void;
  // Trail of every one-click Tuning Advisor apply: what changed, when, and
  // which test it came from.
  appliedRecommendations: AppliedRecommendation[];
  logAppliedRecommendation: (entry: Omit<AppliedRecommendation, "appliedAt">) => void;
};

export type AppliedRecommendation = {
  appliedAt: string; // ISO
  source: "consistency" | "a-vs-b" | "benchmark";
  recommendationId: string;
  summary: string; // human-readable "what changed"
};

const APPLIED_CAP = 100;

// Pure v1→v2 migration step, extracted so it's directly unit-testable (same
// pattern as useBenchmarkAfiStore's seedStaticIntoEntries): every entry that
// is still a single record (the pre-v2 shape) is wrapped into a one-entry
// history array and given a stable id (records never had one before);
// entries already an array (post-migration, or a fresh v2 write) pass
// through unchanged. Idempotent — running it twice is a no-op the second time.
export function wrapConsistencyTestsForV2(rawTests: Record<string, unknown>): Record<string, ConsistencyTestResult[]> {
  const wrapped: Record<string, ConsistencyTestResult[]> = {};
  for (const [subId, val] of Object.entries(rawTests)) {
    if (Array.isArray(val)) { wrapped[subId] = val as ConsistencyTestResult[]; continue; }
    const rec = val as ConsistencyTestResult;
    wrapped[subId] = [{ ...rec, id: rec.id ?? `${subId}-${rec.runAt}` }];
  }
  return wrapped;
}

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set, get) => ({
      matches: {},
      lastRunAt: null,
      runHistory: [],
      setMatch: (afiId, status, justification, humanOverride) =>
        set((s) => ({
          matches: { ...s.matches, [afiId]: { afiId, status, justification, humanOverride, assessedAt: new Date().toISOString() } },
        })),
      setAiMatch: (afiId, status, justification) => {
        if (get().matches[afiId]?.humanOverride) return;
        set((s) => ({
          matches: { ...s.matches, [afiId]: { afiId, status, justification, humanOverride: false, assessedAt: new Date().toISOString() } },
        }));
      },
      recordRun: (totals) =>
        set((s) => {
          const runAt = new Date().toISOString();
          return { lastRunAt: runAt, runHistory: [{ runAt, ...totals }, ...s.runHistory].slice(0, RUN_HISTORY_CAP) };
        }),
      consistencyTests: {},
      addConsistencyTest: (r) =>
        set((s) => ({ consistencyTests: { ...s.consistencyTests, [r.subCriterionId]: [r, ...(s.consistencyTests[r.subCriterionId] ?? [])] } })),
      updateConsistencyTest: (r) =>
        set((s) => ({
          consistencyTests: {
            ...s.consistencyTests,
            [r.subCriterionId]: (s.consistencyTests[r.subCriterionId] ?? []).map((existing) => (existing.id === r.id ? r : existing)),
          },
        })),
      deleteConsistencyTest: (subCriterionId, id) =>
        set((s) => {
          const remaining = (s.consistencyTests[subCriterionId] ?? []).filter((r) => r.id !== id);
          if (remaining.length === 0) { const { [subCriterionId]: _drop, ...rest } = s.consistencyTests; return { consistencyTests: rest }; }
          return { consistencyTests: { ...s.consistencyTests, [subCriterionId]: remaining } };
        }),
      clearConsistencyTests: () => set({ consistencyTests: {} }),
      abTests: {},
      setAbTest: (r) => set((s) => ({ abTests: { ...s.abTests, [r.subCriterionId]: r } })),
      deleteAbTest: (id) => set((s) => { const { [id]: _drop, ...rest } = s.abTests; return { abTests: rest }; }),
      clearAbTests: () => set({ abTests: {} }),
      appliedRecommendations: [],
      logAppliedRecommendation: (entry) =>
        set((s) => ({ appliedRecommendations: [{ ...entry, appliedAt: new Date().toISOString() }, ...s.appliedRecommendations].slice(0, APPLIED_CAP) })),
    }),
    {
      name: "ucc-gd4-calibration:v1",
      storage: createJSONStorage(() => localStorage),
      // v1: consistencyTests / abTests are keyed by sub-criterion id, which the
      // GD4 re-align changed (2.1 → 2.1.1/2.1.2, 7.2 removed, …). Drop entries
      // for sub-criteria that no longer exist so this scratch store doesn't
      // accumulate parentless keys. `matches` are keyed by stable benchmark
      // AFI ids and need no reconciliation.
      // v2: consistencyTests moves from ONE record per sub-criterion to a
      // HISTORY array per sub-criterion (abTests is untouched — Task 2 scoped
      // this to Consistency only). Every pre-existing single record is
      // wrapped into a one-entry array and given a stable id (records never
      // had one before), so no history is lost.
      version: 2,
      migrate: (persisted, fromVersion) => {
        // Permissive record shape throughout — the persisted blob predates
        // whichever fields the CURRENT version's types require, so treating
        // it as CalibrationState from the start fights the type checker for
        // no benefit. Only the final return is asserted to the real type.
        let s = persisted as Record<string, unknown> | undefined;
        if (!s) return s as unknown as CalibrationState;
        if (fromVersion < 1) {
          const validSub = new Set(GD4_SUB_CRITERIA.map((sc) => sc.id));
          const prune = (rec: unknown): Record<string, unknown> =>
            rec && typeof rec === "object" ? Object.fromEntries(Object.entries(rec as Record<string, unknown>).filter(([k]) => validSub.has(k))) : {};
          s = { ...s, consistencyTests: prune(s.consistencyTests), abTests: prune(s.abTests) };
        }
        if (fromVersion < 2) {
          s = { ...s, consistencyTests: wrapConsistencyTestsForV2((s.consistencyTests ?? {}) as Record<string, unknown>) };
        }
        return s as unknown as CalibrationState;
      },
    }
  )
);
