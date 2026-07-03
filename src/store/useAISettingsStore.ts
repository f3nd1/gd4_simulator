import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { AISettings } from "../types";

// Kept in its own localStorage key, separate from the main workspace blob,
// so the key can be cleared independently. Prototype/internal-testing only:
// see the warning copy on the Settings page.
export type AISettingsState = AISettings & {
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setUtilityModel: (model: string) => void;
  setEnabled: (enabled: boolean) => void;
  clearApiKey: () => void;
};

// The OpenAI API key must NEVER reach the remote Supabase blob: the Settings
// page tells users to create an open `using (true)` RLS policy on that
// table, so anything persisted through workspaceStorage is readable by
// anyone holding the public anon key. The key therefore lives in its own
// plain-localStorage slot (browser-local only) and is partialize'd out of
// the synced store state below. Model/enabled settings keep syncing.
const API_KEY_LOCAL_SLOT = "ucc-gd4-ai-api-key";

function loadLocalApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_LOCAL_SLOT) || "";
  } catch {
    return "";
  }
}

function saveLocalApiKey(apiKey: string): void {
  try {
    if (apiKey) localStorage.setItem(API_KEY_LOCAL_SLOT, apiKey);
    else localStorage.removeItem(API_KEY_LOCAL_SLOT);
  } catch {
    // localStorage unavailable/full — the key still works for this session.
  }
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      provider: "openai",
      apiKey: loadLocalApiKey(),
      model: "gpt-5-mini",
      utilityModel: "gpt-5-nano",
      enabled: false,

      setApiKey: (apiKey) => {
        saveLocalApiKey(apiKey);
        set({ apiKey });
      },
      setModel: (model) => set({ model }),
      setUtilityModel: (utilityModel) => set({ utilityModel }),
      setEnabled: (enabled) => set({ enabled }),
      clearApiKey: () => {
        saveLocalApiKey("");
        set({ apiKey: "", enabled: false });
      },
    }),
    {
      name: "ucc-gd4-ai-settings:v1",
      storage: workspaceStorage,
      // The persisted (and therefore Supabase-synced) copy never contains the
      // API key — it is blanked here and re-attached from the local slot in
      // merge() below.
      partialize: (s) => ({ ...s, apiKey: "" }),
      // Re-attach the key SYNCHRONOUSLY as the persisted blob merges in.
      // The previous deferred re-attach (onRehydrateStorage + setTimeout 0)
      // let the blob's blanked apiKey overwrite the in-memory key for a
      // window after async (Supabase) rehydration — an audit started in that
      // window read apiKey === "" and silently fell back to offline keyword
      // mode. merge() runs inline during rehydrate, so the blank never lands.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AISettingsState>;
        // Legacy pre-scrub blobs still carry the key inline: capture it into
        // the local-only slot once. The next persist write re-serialises
        // through partialize and scrubs it out of the synced copies.
        const carried = p.apiKey || "";
        if (carried && !loadLocalApiKey()) saveLocalApiKey(carried);
        return { ...current, ...p, apiKey: loadLocalApiKey() || carried || current.apiKey };
      },
      // Bump anyone still carrying the old gpt-4o-mini default onto the new
      // GPT-5 default. Only the old default is migrated — a deliberately
      // chosen GPT-4 model is left alone — and the API key/enabled flag are
      // preserved untouched.
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<AISettingsState> | undefined;
        if (version < 1 && state && state.model === "gpt-4o-mini") {
          return { ...state, model: "gpt-5-mini" } as AISettingsState;
        }
        return state as AISettingsState;
      },
    }
  )
);
