import { createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { supabase } from "../lib/supabaseClient";

// Single shared row per persisted store key — mirrors the one-blob shape the
// localStorage version already used, so no store/action code has to change.
const TABLE = "workspace_state";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// localStorage is always written as an offline cache and as the fallback
// when Supabase isn't configured or a request fails, so the app keeps
// working exactly as before if the database is unreachable.
const dbStorage: StateStorage = {
  getItem: async (name) => {
    if (!supabase) return localStorage.getItem(name);
    const { data, error } = await supabase.from(TABLE).select("data").eq("id", name).maybeSingle();
    if (error) {
      console.error("Supabase load failed, using local cache:", error.message);
      return localStorage.getItem(name);
    }
    return data ? JSON.stringify(data.data) : localStorage.getItem(name);
  },

  setItem: (name, value) => {
    localStorage.setItem(name, value);
    if (!supabase) return Promise.resolve();
    return new Promise<void>((resolve) => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const { error } = await supabase!.from(TABLE).upsert({ id: name, data: JSON.parse(value), updated_at: new Date().toISOString() });
        if (error) console.error("Supabase save failed:", error.message);
        resolve();
      }, 600);
    });
  },

  removeItem: async (name) => {
    localStorage.removeItem(name);
    if (supabase) await supabase.from(TABLE).delete().eq("id", name);
  },
};

export const workspaceStorage = createJSONStorage(() => dbStorage);
