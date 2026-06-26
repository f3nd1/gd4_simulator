import { create } from "zustand";
import { persist } from "zustand/middleware";

// Deliberately the one store that never routes through workspaceStorage: it
// holds the connection details every other store needs to even reach
// Supabase, so persisting it there would be circular. Always browser-local.
export type SupabaseSettingsState = {
  url: string;
  publishableKey: string;
  setUrl: (url: string) => void;
  setPublishableKey: (publishableKey: string) => void;
  clear: () => void;
};

export const useSupabaseSettingsStore = create<SupabaseSettingsState>()(
  persist(
    (set) => ({
      url: "",
      publishableKey: "",
      setUrl: (url) => set({ url: url.trim() }),
      setPublishableKey: (publishableKey) => set({ publishableKey: publishableKey.trim() }),
      clear: () => set({ url: "", publishableKey: "" }),
    }),
    { name: "ucc-gd4-supabase-settings:v1" }
  )
);
