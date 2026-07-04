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
  setVerdictTemperature: (t: number) => void;
  clearApiKey: () => void;
};

// Verdict calls are assessment calls — default to a low temperature so the
// same evidence yields the same verdict across repeated runs. Exported so the
// Settings control, the calibration test, and the fallback in agentRuntime all
// agree on the default.
export const DEFAULT_VERDICT_TEMPERATURE = 0.1;

// The OpenAI API key SYNCS through Supabase (workspaceStorage) so the same key
// is available across devices/browsers — restored at the user's request for
// this internal prototype. SECURITY TRADE-OFF: the Settings page tells users
// to create an open `using (true)` RLS policy on that table, so the synced key
// is readable by anyone holding the project's public anon key. Settings shows
// a visible warning to that effect. A plain-localStorage slot is also kept as
// an offline fallback so a browser with no Supabase config still has the key.
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
      verdictTemperature: DEFAULT_VERDICT_TEMPERATURE,

      setApiKey: (apiKey) => {
        saveLocalApiKey(apiKey);
        set({ apiKey });
      },
      setModel: (model) => set({ model }),
      setUtilityModel: (utilityModel) => set({ utilityModel }),
      setEnabled: (enabled) => set({ enabled }),
      setVerdictTemperature: (t) => set({ verdictTemperature: Math.max(0, Math.min(1, t)) }),
      clearApiKey: () => {
        saveLocalApiKey("");
        set({ apiKey: "", enabled: false });
      },
    }),
    {
      name: "ucc-gd4-ai-settings:v1",
      storage: workspaceStorage,
      // The API key IS included in the persisted (Supabase-synced) blob so it
      // follows the user across devices. (Everything is persisted as-is.)
      // merge() runs inline during rehydrate so there is no window where a
      // blank value overwrites the in-memory key.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AISettingsState>;
        // Prefer the synced key; fall back to the local slot when the synced
        // blob has none (e.g. a browser with no Supabase configured). Mirror
        // whatever we resolve back into the local slot as an offline cache.
        const key = p.apiKey || loadLocalApiKey() || current.apiKey || "";
        if (key) saveLocalApiKey(key);
        return { ...current, ...p, apiKey: key };
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
