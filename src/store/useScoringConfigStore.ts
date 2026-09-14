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
  // Opt-in: let a Full Auto run / Hybrid first-pass draft set the APSR band
  // matrix automatically (AI decides, human reviews AFTER instead of before).
  // DEFAULT OFF — the tool's standing contract is "AI recommends, human
  // decides the certification score" (docs/target-flow-gap-analysis.md); this
  // flips that for automatic runs only, per the user's explicit choice on the
  // GD4 Scoring Setup page (mandatory confirm dialog there — never silently).
  // Never changes bands already saved; human saves are unaffected either way.
  // See docs/auto-scoring-setting.md.
  autoScoreBands: boolean;
  setAwardThresholds: (t: AwardThresholds) => void;
  setAiStrictness: (s: AiStrictness) => void;
  setApsrScale: (s: ApsrScale) => void;
  resetApsrScale: () => void;
  applyPreset: (name: string) => void;
  setAutoScoreBands: (on: boolean) => void;
};

// /1000 totals. Average band needed = threshold / 200 (since max = 1000 = all
// Band 5). "Hard" makes the provisional→4-Year and 4-Year→Star jumps both
// large, so Star is genuinely difficult while Provisional stays attainable.
export const AWARD_PRESETS: Record<string, AwardThresholds> = {
  Standard: { provisional: 500, fourYear: 600, star: 750 },
  Hard: { provisional: 500, fourYear: 700, star: 880 },
  "Very hard": { provisional: 520, fourYear: 740, star: 920 },
};

// ─── Ladder invariants ──────────────────────────────────────────────────────
//
// Both of these settings are ORDERED LADDERS, and every consumer evaluates
// them left to right and stops at the first match:
//   scoring.ts        `total >= star ? Star : total >= fourYear ? 4-Year : …`
//   checklistBanding  `total <= t1 ? 1 : total <= t2 ? 2 : …`
// So an out-of-order ladder does not merely look odd, it silently makes tiers
// unreachable. Star below 4-Year meant a 600/1000 workspace exported as
// "EduTrust Star" while "EduTrust (4-Year)" could not be awarded at any score;
// bandThresholds [80,20,60,40] made every total up to 80% return Band 1.
//
// The page clamped each field independently, which cannot see a cross-field
// invariant, and the setters wrote straight through. Enforcing here instead
// covers every route into the store: typing, presets, a restored localStorage
// blob, and a Supabase sync from another device.
//
// Direction of repair is deliberate: values cascade UPWARDS from the lowest
// tier. Raising the higher tier makes certification harder, which is the safe
// direction for an audit tool; lowering the tier below it would quietly make
// the award easier to reach, which is the failure we are fixing.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function normaliseAwardThresholds(t: AwardThresholds): AwardThresholds {
  const provisional = clamp(t.provisional, 0, 1000);
  const fourYear = Math.max(clamp(t.fourYear, 0, 1000), provisional);
  const star = Math.max(clamp(t.star, 0, 1000), fourYear);
  return { provisional, fourYear, star };
}

// The four APSR dimensions each contribute at most `maxPctPerDimension`, and
// the total is a percentage, so the real ceiling is 100/4 = 25 — not the 100
// the page allowed. At 100 a uniformly Band-2 workspace totalled 160% and
// rendered as Band 5.
export const MAX_PCT_PER_DIMENSION = 25;

export function normaliseApsrScale(s: ApsrScale): ApsrScale {
  const [a, b, c, d] = s.bandThresholds;
  const t1 = clamp(a, 0, 100);
  const t2 = Math.max(clamp(b, 0, 100), t1);
  const t3 = Math.max(clamp(c, 0, 100), t2);
  const t4 = Math.max(clamp(d, 0, 100), t3);
  return {
    maxPctPerDimension: clamp(s.maxPctPerDimension, 0, MAX_PCT_PER_DIMENSION),
    bandThresholds: [t1, t2, t3, t4],
  };
}

export const useScoringConfigStore = create<ScoringConfigState>()(
  persist(
    (set) => ({
      awardThresholds: AWARD_PRESETS.Hard,
      aiStrictness: "Strict",
      apsrScale: { ...DEFAULT_APSR_SCALE },
      autoScoreBands: false,
      setAwardThresholds: (awardThresholds) => set({ awardThresholds: normaliseAwardThresholds(awardThresholds) }),
      setAiStrictness: (aiStrictness) => set({ aiStrictness }),
      setApsrScale: (apsrScale) => set({ apsrScale: normaliseApsrScale(apsrScale) }),
      resetApsrScale: () => set({ apsrScale: { ...DEFAULT_APSR_SCALE } }),
      applyPreset: (name) => {
        const p = AWARD_PRESETS[name];
        if (p) set({ awardThresholds: normaliseAwardThresholds({ ...p }) });
      },
      setAutoScoreBands: (autoScoreBands) => set({ autoScoreBands }),
    }),
    {
      name: "ucc-gd4-scoring-config:v1",
      storage: workspaceStorage,
      // v1: repair ladders persisted before the setters enforced order. A
      // workspace that only ever used a preset is untouched (all three presets
      // are already monotonic, as is DEFAULT_APSR_SCALE), so this only rewrites
      // hand-edited values that were genuinely producing wrong bands or awards.
      version: 1,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<ScoringConfigState>;
        return {
          ...p,
          awardThresholds: normaliseAwardThresholds(p.awardThresholds ?? AWARD_PRESETS.Hard),
          apsrScale: normaliseApsrScale(p.apsrScale ?? DEFAULT_APSR_SCALE),
        } as ScoringConfigState;
      },
    }
  )
);
