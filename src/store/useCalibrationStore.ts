// Match assessments for the AI Calibration page: per real benchmark AFI, was
// the same gap caught by the app's AI? Persisted to localStorage only — this
// is a measurement tool's working state, not audit data.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ConsistencyTestResult, ABTestResult } from "../lib/calibrationTesting";

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
  // Consistency tab: latest repeatability test per sub-criterion (scratch —
  // measurement results only, never audit data). Delete/clear touch ONLY
  // these scratch records, never the real audit stores.
  consistencyTests: Record<string, ConsistencyTestResult>;
  setConsistencyTest: (r: ConsistencyTestResult) => void;
  deleteConsistencyTest: (subCriterionId: string) => void;
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
      setConsistencyTest: (r) => set((s) => ({ consistencyTests: { ...s.consistencyTests, [r.subCriterionId]: r } })),
      deleteConsistencyTest: (id) => set((s) => { const { [id]: _drop, ...rest } = s.consistencyTests; return { consistencyTests: rest }; }),
      clearConsistencyTests: () => set({ consistencyTests: {} }),
      abTests: {},
      setAbTest: (r) => set((s) => ({ abTests: { ...s.abTests, [r.subCriterionId]: r } })),
      deleteAbTest: (id) => set((s) => { const { [id]: _drop, ...rest } = s.abTests; return { abTests: rest }; }),
      clearAbTests: () => set({ abTests: {} }),
      appliedRecommendations: [],
      logAppliedRecommendation: (entry) =>
        set((s) => ({ appliedRecommendations: [{ ...entry, appliedAt: new Date().toISOString() }, ...s.appliedRecommendations].slice(0, APPLIED_CAP) })),
    }),
    { name: "ucc-gd4-calibration:v1", storage: createJSONStorage(() => localStorage) }
  )
);
