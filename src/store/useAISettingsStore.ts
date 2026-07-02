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
      // API key — it is blanked here and re-attached from the local slot on
      // rehydrate (see onRehydrateStorage).
      partialize: (s) => ({ ...s, apiKey: "" }),
      onRehydrateStorage: () => (state) => {
        // Pre-v2 blobs (localStorage AND the remote Supabase copy) still
        // carry the key inline. Capture it into the local-only slot once,
        // then overwrite the in-memory value from the slot — the deferred
        // setState also triggers a persist write, which re-serialises the
        // store through partialize and scrubs the key out of both persisted
        // copies.
        const carried = state?.apiKey || "";
        if (carried && !loadLocalApiKey()) saveLocalApiKey(carried);
        const key = carried || loadLocalApiKey();
        setTimeout(() => useAISettingsStore.setState({ apiKey: key }), 0);
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
