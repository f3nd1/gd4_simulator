// Version history for the tunable rules layer. Persisted (Supabase + local
// via workspaceStorage) so history survives reload. Never auto-deletes; the
// original/default baseline is always the last, always-restorable version.
//
// - `activeVersionId` is what the user is editing / testing (injected into the
//   calibration scratch runs).
// - `championVersionId` is the proven-best version injected into REAL audit
//   runs — protected until the user deliberately promotes a new one.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import {
  DEFAULT_RULE_CONTENT, changeSummaryOf, buildRuleInjection, criterionOf,
  type RuleContent, type RuleVersion, type RuleChangeEntry,
} from "../lib/ruleTuning";

const ORIGINAL_ID = "rule-original";

function originalVersion(): RuleVersion {
  return { id: ORIGINAL_ID, createdAt: "2000-01-01T00:00:00.000Z", label: "Original / default", isOriginal: true, content: DEFAULT_RULE_CONTENT, changeSummary: "The built-in baseline — injects no extra rules." };
}

type RuleTuningState = {
  versions: RuleVersion[]; // newest first; original is always present (last)
  activeVersionId: string;
  championVersionId: string; // defaults to original
  changeLog: RuleChangeEntry[];

  activeContent: () => RuleContent;
  championContent: () => RuleContent;
  // Injection string for the champion (real audits) or active (tests), resolved
  // for the given sub-criterion/criterion.
  championInjection: (subOrCriterionId: string) => string;
  activeInjection: (subOrCriterionId: string) => string;

  saveVersion: (content: RuleContent, label?: string) => string; // returns new id
  revertTo: (versionId: string) => string; // clones into a new active version
  setChampion: (versionId: string) => void;
  setActive: (versionId: string) => void;
  recordConsistency: (versionId: string, pct: number | null) => void;
  recordBenchmark: (versionId: string, caught: number, total: number) => void;
};

function ts(): string {
  // Deterministic-friendly timestamp helper (Date.now is fine at runtime; the
  // rule store is not exercised in Vitest).
  return new Date().toISOString();
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `rule-${Date.now().toString(36)}-${counter}`;
}

const LOG_CAP = 300;

export const useRuleTuningStore = create<RuleTuningState>()(
  persist(
    (set, get) => ({
      versions: [originalVersion()],
      activeVersionId: ORIGINAL_ID,
      championVersionId: ORIGINAL_ID,
      changeLog: [],

      activeContent: () => get().versions.find((v) => v.id === get().activeVersionId)?.content ?? DEFAULT_RULE_CONTENT,
      championContent: () => get().versions.find((v) => v.id === get().championVersionId)?.content ?? DEFAULT_RULE_CONTENT,
      championInjection: (id) => buildRuleInjection(get().championContent(), criterionOf(id)),
      activeInjection: (id) => buildRuleInjection(get().activeContent(), criterionOf(id)),

      saveVersion: (content, label) => {
        const id = newId();
        const prev = get().activeContent();
        const summary = changeSummaryOf(prev, content);
        const version: RuleVersion = { id, createdAt: ts(), label: label?.trim() || undefined, content, changeSummary: summary, consistencyPct: null, benchmarkCaught: null, benchmarkTotal: null };
        set((s) => ({
          versions: [version, ...s.versions],
          activeVersionId: id,
          changeLog: [{ at: ts(), action: "save" as const, versionId: id, detail: `Saved ${label ? `"${label}"` : "new version"} — ${summary}` }, ...s.changeLog].slice(0, LOG_CAP),
        }));
        return id;
      },

      revertTo: (versionId) => {
        const src = get().versions.find((v) => v.id === versionId);
        if (!src) return get().activeVersionId;
        const id = newId();
        const label = `Reverted to ${src.label || src.id.slice(0, 8)}`;
        const version: RuleVersion = { id, createdAt: ts(), label, content: src.content, changeSummary: `Restored the rules from ${src.label || "an earlier version"}.`, consistencyPct: null, benchmarkCaught: null, benchmarkTotal: null };
        set((s) => ({
          versions: [version, ...s.versions],
          activeVersionId: id,
          changeLog: [{ at: ts(), action: "revert" as const, versionId: id, detail: `Reverted to ${src.label || versionId} (as a new version — nothing lost)` }, ...s.changeLog].slice(0, LOG_CAP),
        }));
        return id;
      },

      setChampion: (versionId) => {
        const v = get().versions.find((x) => x.id === versionId);
        if (!v) return;
        set((s) => ({
          championVersionId: versionId,
          changeLog: [{ at: ts(), action: "champion" as const, versionId, detail: `Promoted ${v.label || versionId} to Champion (now live for real audits)` }, ...s.changeLog].slice(0, LOG_CAP),
        }));
      },

      setActive: (versionId) => set({ activeVersionId: versionId }),

      recordConsistency: (versionId, pct) =>
        set((s) => ({ versions: s.versions.map((v) => v.id === versionId ? { ...v, consistencyPct: pct } : v) })),
      recordBenchmark: (versionId, caught, total) =>
        set((s) => ({ versions: s.versions.map((v) => v.id === versionId ? { ...v, benchmarkCaught: caught, benchmarkTotal: total } : v) })),
    }),
    {
      name: "ucc-gd4-rule-tuning:v1",
      storage: workspaceStorage,
      // Guarantee the original baseline always exists after rehydrate (older
      // blobs, or a corrupted list, can never lose the restorable default).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RuleTuningState>;
        const versions = Array.isArray(p.versions) && p.versions.length ? p.versions : current.versions;
        const withOriginal = versions.some((v) => v.id === ORIGINAL_ID) ? versions : [...versions, originalVersion()];
        return { ...current, ...p, versions: withOriginal };
      },
    }
  )
);
