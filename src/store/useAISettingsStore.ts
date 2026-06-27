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

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      provider: "openai",
      apiKey: "",
      model: "gpt-5-mini",
      utilityModel: "gpt-5-nano",
      enabled: false,

      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      setUtilityModel: (utilityModel) => set({ utilityModel }),
      setEnabled: (enabled) => set({ enabled }),
      clearApiKey: () => set({ apiKey: "", enabled: false }),
    }),
    {
      name: "ucc-gd4-ai-settings:v1",
      storage: workspaceStorage,
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
