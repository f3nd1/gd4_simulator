import { create } from "zustand";
import { blockWritesIfHydrationFailed } from "./hydrationGate";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import {
  EMPTY_DOMAIN_OVERRIDES,
  makeCustomDomainItem,
  type DomainChecklistOverrides,
  type DomainCustomItem,
} from "../lib/domainChecklist";

// The live, editable layer over the criterion domain-expertise checklists
// (src/data/skills/criterion-{1..7}-*.md). Only the DIFF is stored: an edited
// line, a hidden line, or an added check. The markdown files stay the seed, so
// an unedited install ships exactly what it always did (proved byte-for-byte
// in lib/__tests__/domainChecklist.test.ts) and a later change to a .md file
// still reaches every item nobody has touched.
//
// Human gate, matching the Pre-check checklist's rule: an ADDED check starts
// `verified: false` and is not injected into any prompt until it is explicitly
// approved here. Editing an existing built-in check applies immediately, which
// is deliberate: it mirrors editing the markdown, and draft-gating an edit
// would silently pull live guidance out of the prompt the moment someone fixed
// a typo. An edited built-in is flagged in the UI and can be reverted in one
// click instead.

export type DomainChecklistState = {
  overrides: DomainChecklistOverrides;
  editItem: (itemId: string, text: string) => void;
  revertItem: (itemId: string) => void;
  setRemoved: (itemId: string, removed: boolean) => void;
  addItem: (input: { criterionId: string; sectionKey: string; text: string; subCriteriaText?: string; note?: string }) => void;
  updateCustom: (itemId: string, text: string) => void;
  setVerified: (itemId: string, verified: boolean) => void;
  deleteCustom: (itemId: string) => void;
  replaceOverrides: (next: DomainChecklistOverrides) => void;
  resetAll: () => void;
};

export const useDomainChecklistStore = create<DomainChecklistState>()(
  persist(
    (set) => ({
      overrides: EMPTY_DOMAIN_OVERRIDES,

      editItem: (itemId, text) =>
        set((s) => ({ overrides: { ...s.overrides, edits: { ...s.overrides.edits, [itemId]: text } } })),

      // Drops the stored edit so the item falls back to the markdown seed.
      revertItem: (itemId) =>
        set((s) => {
          const edits = { ...s.overrides.edits };
          delete edits[itemId];
          return { overrides: { ...s.overrides, edits } };
        }),

      setRemoved: (itemId, removed) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            removed: removed
              ? [...new Set([...s.overrides.removed, itemId])]
              : s.overrides.removed.filter((id) => id !== itemId),
          },
        })),

      addItem: (input) =>
        set((s) => ({ overrides: { ...s.overrides, added: [...s.overrides.added, makeCustomDomainItem(input)] } })),

      updateCustom: (itemId, text) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            added: s.overrides.added.map((a) => (a.id === itemId ? { ...a, text } : a)),
          },
        })),

      // The one action that flips `verified`, in either direction, so a check
      // only ever reaches a prompt because someone deliberately approved it.
      setVerified: (itemId, verified) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            added: s.overrides.added.map((a) => (a.id === itemId ? { ...a, verified } : a)),
          },
        })),

      deleteCustom: (itemId) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            added: s.overrides.added.filter((a) => a.id !== itemId),
            removed: s.overrides.removed.filter((id) => id !== itemId),
          },
        })),

      replaceOverrides: (next) => set({ overrides: next }),

      resetAll: () => set({ overrides: EMPTY_DOMAIN_OVERRIDES }),
    }),
    { name: "ucc-gd4-domain-checklist:v1",
      onRehydrateStorage: blockWritesIfHydrationFailed("ucc-gd4-domain-checklist:v1"), storage: workspaceStorage }
  )
);

// Read helper for non-React callers (domainExpertiseFor runs inside AI engine
// code, not a component).
export function currentDomainOverrides(): DomainChecklistOverrides {
  return useDomainChecklistStore.getState().overrides;
}

export type { DomainCustomItem };
