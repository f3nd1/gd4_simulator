// Every persisted store, its key, and the adapter it persists through.
//
// This table has been wrong in CLAUDE.md twice in one session, and both times
// the error hid real data loss: stores documented as syncing to Supabase were
// actually browser-local, and one was on zustand's default adapter, which
// throws on a full disk and blanked the app. Documentation cannot be the record
// of this. The test reads the real source, so a new store or a changed adapter
// fails here until the table below is updated deliberately.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("..", import.meta.url).pathname;

type Adapter = "workspaceStorage" | "safeLocalStorage" | "appendOnlyStorage";
// syncs: does this store's data reach Supabase, and therefore another browser?
const EXPECTED: Record<string, { key: string; adapter: Adapter; syncs: boolean }> = {
  useWorkspaceStore:         { key: "ucc-gd4-workspace:v3",          adapter: "workspaceStorage",  syncs: true },
  useChecklistModuleStore:   { key: "ucc-gd4-checklist:v2",          adapter: "workspaceStorage",  syncs: true },
  useAISettingsStore:        { key: "ucc-gd4-ai-settings:v1",        adapter: "workspaceStorage",  syncs: true },
  useScoringConfigStore:     { key: "ucc-gd4-scoring-config:v1",     adapter: "workspaceStorage",  syncs: true },
  useGoogleDriveStore:       { key: "ucc-gd4-google-drive:v1",       adapter: "workspaceStorage",  syncs: true },
  useProfileOfPeiStore:      { key: "profile-of-pei-v2",             adapter: "workspaceStorage",  syncs: true },
  usePreCheckChecklistStore: { key: "ucc-gd4-precheck-checklist:v1", adapter: "workspaceStorage",  syncs: true },
  useDomainChecklistStore:   { key: "ucc-gd4-domain-checklist:v1",   adapter: "workspaceStorage",  syncs: true },
  useChecklistVerdictStore:  { key: "ucc-gd4-checklist-verdicts:v1", adapter: "workspaceStorage",  syncs: true },
  useBenchmarkAfiStore:      { key: "ucc-gd4-custom-benchmark:v1",   adapter: "workspaceStorage",  syncs: true },
  useWorksheetQuestionStore: { key: "ucc-gd4-worksheet-cache:v1",    adapter: "workspaceStorage",  syncs: true },
  usePromptReviewStore:      { key: "ucc-gd4-prompt-review:v1",      adapter: "workspaceStorage",  syncs: true },
  useRuleTuningStore:        { key: "ucc-gd4-rule-tuning:v1",        adapter: "workspaceStorage",  syncs: true },
  useCalibrationStore:       { key: "ucc-gd4-calibration:v1",        adapter: "workspaceStorage",  syncs: true },
  useFindingDraftStore:      { key: "ucc-gd4-finding-drafts:v1",     adapter: "workspaceStorage",  syncs: true },
  useChangeLogStore:         { key: "ucc-gd4-changelog:v1",          adapter: "appendOnlyStorage", syncs: true },
  // Browser-local on purpose, and both are safe to lose on a new machine:
  useGuidanceStore:          { key: "ucc-gd4-guidance:v1",           adapter: "safeLocalStorage",  syncs: false },
  // ...and this one CANNOT sync: it holds the credentials every other store
  // needs to reach Supabase, so persisting it there would be circular.
  useSupabaseSettingsStore:  { key: "ucc-gd4-supabase-settings:v1",  adapter: "safeLocalStorage",  syncs: false },
};

const sourceOf = (name: string) => readFileSync(join(DIR, `${name}.ts`), "utf8");

function persistedStoreFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.startsWith("use") && f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((n) => /\bpersist\(/.test(sourceOf(n)));
}

describe("every persisted store's storage adapter", () => {
  it("has no store missing from the table, and no stale entry in it", () => {
    expect(persistedStoreFiles().sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("persists under the documented key", () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      expect(sourceOf(name), `${name} key`).toContain(`"${e.key}"`);
    }
  });

  it("uses the documented adapter", () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      expect(sourceOf(name), `${name} adapter`).toMatch(new RegExp(`storage:\\s*(createJSONStorage\\(\\(\\)\\s*=>\\s*)?${e.adapter}`));
    }
  });

  // The failure this whole exercise started from: a store on zustand's default
  // adapter throws QuotaExceededError out of setState and blanks the app.
  it("never falls back to zustand's default, throwing adapter", () => {
    for (const name of persistedStoreFiles()) {
      const src = sourceOf(name);
      expect(src, `${name} has no explicit storage, so it uses the throwing default`).toMatch(/storage:\s*\S/);
      expect(src, `${name} persists through a raw localStorage`).not.toMatch(/createJSONStorage\(\(\)\s*=>\s*localStorage\)/);
    }
  });

  // A store that does not sync is data that dies with the browser profile, so
  // the list of them is deliberately short and deliberately pinned.
  it("keeps browser-local storage to the two stores that genuinely cannot sync", () => {
    const local = Object.entries(EXPECTED).filter(([, e]) => !e.syncs).map(([n]) => n).sort();
    expect(local).toEqual(["useGuidanceStore", "useSupabaseSettingsStore"]);
  });
});

describe("the credentials store must not import its adapter through Supabase code", () => {
  // settings -> supabaseStorage -> supabaseClient -> settings was a real cycle
  // that left the Supabase credentials unpersisted, so nothing synced at all.
  it("takes safeLocalStorage from the leaf module", () => {
    const src = sourceOf("useSupabaseSettingsStore");
    expect(src).toContain('from "./safeLocalStorage"');
    expect(src).not.toContain('from "./supabaseStorage"');
  });
});
