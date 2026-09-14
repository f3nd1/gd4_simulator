import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { ChecklistAuditBucket, ChecklistCheckVerdict } from "../lib/ai/agentRuntime";

// Per-check verdicts produced by the Audit Checklist Library pass.
//
// The 155 library checks have always been injected into every audit prompt for
// their criterion, but with no return path: the response schemas are keyed on
// the GD4 flat-audit-point ref, so a check could shape the model's prose and
// nothing else. This store is the output layer that was missing. It is written
// by BOTH audit paths (Option A's PPD and Evidence runs, Option B's staged
// audit) through the one shared engine pass, and read by the Audit Checklist
// Library page.
//
// DISPLAY ONLY. Nothing here is read by scoring.ts, checklistBanding.ts or
// buildBandEvidenceDigest (whose sole input is SpecificChecklistLine[]), and a
// verdict must never be written onto a checklist line — that is the same
// boundary the per-line APSR dimension classifier respects, and the Library
// page's own promise ("Nothing here scores anything by itself").
//
// Keyed by check + sub-criterion + bucket, not by check alone: a criterion-wide
// check is genuinely assessed once per sub-criterion audited, and the policy
// and evidence buckets genuinely answer different questions ("is it documented"
// vs "is it evidenced"). Collapsing them would make a later run silently
// overwrite an earlier, unrelated answer.
//
// Staleness is an explicit comparison, never a key miss: sourceHash records the
// exact check text the verdict was judged from, so a check edited afterwards is
// shown as stale rather than served as current (the same mechanism
// useWorksheetQuestionStore uses for its walkthrough questions).

export type StoredChecklistVerdict = {
  checkId: string;
  subCriterionId: string;
  bucket: ChecklistAuditBucket;
  verdict: ChecklistCheckVerdict;
  rationale: string;
  quote?: string;
  chunkIds: string[];
  sourceHash: string;
  runId?: string;
  runAt: string;
  // Which audit path produced it, so a disagreement between the two is
  // attributable rather than mysterious.
  path: "A" | "B";
  model?: string;
};

export const verdictKey = (checkId: string, subCriterionId: string, bucket: ChecklistAuditBucket): string =>
  `${checkId}::${subCriterionId}::${bucket}`;

// 155 checks x 29 sub-criteria x 2 buckets is ~9k entries at the theoretical
// maximum, which would be a localStorage problem on its own. Capped like
// useWorksheetQuestionStore, with the text fields bounded on write, so the
// worst case stays a few hundred KB.
const MAX_ENTRIES = 500;
const MAX_RATIONALE = 400;
const MAX_QUOTE = 300;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type ChecklistVerdictState = {
  entries: Record<string, StoredChecklistVerdict>;
  // One run's worth of verdicts, replacing whatever that run's keys held before.
  putRun: (verdicts: StoredChecklistVerdict[]) => void;
  clearForSub: (subCriterionId: string) => void;
  clear: () => void;
};

const trim = (merged: Record<string, StoredChecklistVerdict>): Record<string, StoredChecklistVerdict> => {
  const keys = Object.keys(merged);
  if (keys.length <= MAX_ENTRIES) return merged;
  const keep = keys.slice(keys.length - MAX_ENTRIES);
  const out: Record<string, StoredChecklistVerdict> = {};
  for (const k of keep) out[k] = merged[k];
  return out;
};

export const useChecklistVerdictStore = create<ChecklistVerdictState>()(
  persist(
    (set) => ({
      entries: {},
      putRun: (verdicts) =>
        set((s) => {
          if (verdicts.length === 0) return {};
          const next = { ...s.entries };
          for (const v of verdicts) {
            const key = verdictKey(v.checkId, v.subCriterionId, v.bucket);
            // Delete first so a re-run moves the key to the end of the
            // insertion order and the cap evicts genuinely-oldest entries.
            delete next[key];
            next[key] = {
              ...v,
              rationale: clip(v.rationale, MAX_RATIONALE),
              ...(v.quote ? { quote: clip(v.quote, MAX_QUOTE) } : {}),
            };
          }
          return { entries: trim(next) };
        }),
      clearForSub: (subCriterionId) =>
        set((s) => ({
          entries: Object.fromEntries(Object.entries(s.entries).filter(([, v]) => v.subCriterionId !== subCriterionId)),
        })),
      clear: () => set({ entries: {} }),
    }),
    { name: "ucc-gd4-checklist-verdicts:v1", storage: workspaceStorage, version: 0 }
  )
);

// Read helper for non-React callers.
export const currentChecklistVerdicts = (): Record<string, StoredChecklistVerdict> =>
  useChecklistVerdictStore.getState().entries;
