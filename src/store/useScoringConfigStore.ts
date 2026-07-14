import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { DEFAULT_APSR_SCALE, type ApsrScale } from "../lib/checklistBanding";

// Tunable difficulty for the overall result — lives here (and on the GD4
// Scoring Setup page) rather than hardcoded in scoring.ts, so the bar for each
// EduTrust tier and how strict the AI is when marking evidence can be adjusted
// without a code change. Persisted with the workspace.
export type AwardThresholds = { provisional: number; fourYear: number; star: number };
export type AiStrictness = "Lenient" | "Standard" | "Strict";

export type ScoringConfigState = {
  awardThresholds: AwardThresholds;
  aiStrictness: AiStrictness;
  // The APSR percentage scale (max % per dimension + total→band thresholds).
  // Reconstructed from one auditor example, so it's editable, not hardcoded.
  apsrScale: ApsrScale;
  setAwardThresholds: (t: AwardThresholds) => void;
  setAiStrictness: (s: AiStrictness) => void;
  setApsrScale: (s: ApsrScale) => void;
  resetApsrScale: () => void;
  applyPreset: (name: string) => void;
};

// /1000 totals. Average band needed = threshold / 200 (since max = 1000 = all
// Band 5). "Hard" makes the provisional→4-Year and 4-Year→Star jumps both
// large, so Star is genuinely difficult while Provisional stays attainable.
export const AWARD_PRESETS: Record<string, AwardThresholds> = {
  Standard: { provisional: 500, fourYear: 600, star: 750 },
  Hard: { provisional: 500, fourYear: 700, star: 880 },
  "Very hard": { provisional: 520, fourYear: 740, star: 920 },
};

export const useScoringConfigStore = create<ScoringConfigState>()(
  persist(
    (set) => ({
      awardThresholds: AWARD_PRESETS.Hard,
      aiStrictness: "Strict",
      apsrScale: { ...DEFAULT_APSR_SCALE },
      setAwardThresholds: (awardThresholds) => set({ awardThresholds }),
      setAiStrictness: (aiStrictness) => set({ aiStrictness }),
      setApsrScale: (apsrScale) => set({ apsrScale }),
      resetApsrScale: () => set({ apsrScale: { ...DEFAULT_APSR_SCALE } }),
      applyPreset: (name) => {
        const p = AWARD_PRESETS[name];
        if (p) set({ awardThresholds: { ...p } });
      },
    }),
    { name: "ucc-gd4-scoring-config:v1", storage: workspaceStorage }
  )
);
