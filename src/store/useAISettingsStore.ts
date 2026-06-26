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
  setEnabled: (enabled: boolean) => void;
  clearApiKey: () => void;
};

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      provider: "openai",
      apiKey: "",
      model: "gpt-4o-mini",
      enabled: false,

      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      setEnabled: (enabled) => set({ enabled }),
      clearApiKey: () => set({ apiKey: "", enabled: false }),
    }),
    { name: "ucc-gd4-ai-settings:v1", storage: workspaceStorage }
  )
);
