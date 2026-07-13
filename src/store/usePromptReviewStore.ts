import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { ReviewablePrompt, PromptReviewRecord } from "../types";

// The Prompt Review feature's store: user-authored ReviewablePrompt objects
// plus the connected review→revise→log records. Persisted via workspaceStorage
// (Supabase-synced) since this is curated content, not scratch state.
//
// Champion-vs-active gate (mirrors useRuleTuningStore): a ReviewablePrompt's
// `text` is the OPERATIONAL version; an AI-drafted revision lives on the review
// record as `revisedPrompt` and only replaces `text` when promoteRevision is
// called from an explicit human click — nothing auto-promotes.

export type PromptReviewState = {
  prompts: ReviewablePrompt[];
  records: PromptReviewRecord[];
  addPrompt: (p: { name: string; purpose: string; text: string }) => string;
  updatePrompt: (id: string, updates: Partial<Pick<ReviewablePrompt, "name" | "purpose" | "text">>) => void;
  removePrompt: (id: string) => void;
  // Save a completed review; returns the new record id. A drafted revision
  // rides along in the record's revisedPrompt field here (see PromptReview's
  // saveReview) — there is no separate attach step.
  addReview: (rec: Omit<PromptReviewRecord, "id" | "timestamp">) => string;
  // Promote a drafted revision to operational: copy revisedPrompt into the
  // parent ReviewablePrompt.text and mark the record revision_live. The gate.
  promoteRevision: (recordId: string) => void;
};

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export const usePromptReviewStore = create<PromptReviewState>()(
  persist(
    (set) => ({
      prompts: [],
      records: [],

      addPrompt: (p) => {
        const id = newId("PR");
        const now = new Date().toISOString();
        set((s) => ({ prompts: [{ id, name: p.name, purpose: p.purpose, text: p.text, createdAt: now, updatedAt: now }, ...s.prompts] }));
        return id;
      },

      updatePrompt: (id, updates) =>
        set((s) => ({ prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p)) })),

      removePrompt: (id) =>
        set((s) => ({
          prompts: s.prompts.filter((p) => p.id !== id),
          records: s.records.filter((r) => r.promptId !== id),
        })),

      addReview: (rec) => {
        const id = newId("PRR");
        set((s) => ({ records: [{ ...rec, id, timestamp: new Date().toISOString() }, ...s.records] }));
        return id;
      },

      promoteRevision: (recordId) =>
        set((s) => {
          const rec = s.records.find((r) => r.id === recordId);
          if (!rec || !rec.revisedPrompt) return s;
          return {
            prompts: s.prompts.map((p) => (p.id === rec.promptId ? { ...p, text: rec.revisedPrompt as string, updatedAt: new Date().toISOString() } : p)),
            records: s.records.map((r) => (r.id === recordId ? { ...r, status: "revision_live", timestamp: new Date().toISOString() } : r)),
          };
        }),
    }),
    { name: "ucc-gd4-prompt-review:v1", storage: workspaceStorage }
  )
);
