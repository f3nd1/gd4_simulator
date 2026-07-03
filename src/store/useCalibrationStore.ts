// Match assessments for the AI Calibration page: per real benchmark AFI, was
// the same gap caught by the app's AI? Persisted to localStorage only — this
// is a measurement tool's working state, not audit data.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

type CalibrationState = {
  matches: Record<string, MatchAssessment>;
  setMatch: (afiId: string, status: MatchStatus, justification: string, humanOverride: boolean) => void;
  // AI-run result: only applied when the row has no human override.
  setAiMatch: (afiId: string, status: MatchStatus, justification: string) => void;
  clearMatches: () => void;
};

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set, get) => ({
      matches: {},
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
      clearMatches: () => set({ matches: {} }),
    }),
    { name: "ucc-gd4-calibration:v1", storage: createJSONStorage(() => localStorage) }
  )
);
