// In-memory only — no persistence. Dev use only.
import { create } from "zustand";

export type AIDebugEntry = {
  id: string;
  timestamp: string;
  functionName: string;
  module: string;
  systemPrompt: string;
  criterionSkill?: string;
};

type AIDebugLogStore = {
  entries: AIDebugEntry[];
  addEntry: (functionName: string, module: string, systemPrompt: string, criterionSkill?: string) => void;
  clearLog: () => void;
};

// Every entry carries a full ~40k-char system prompt and one is added per AI
// call, so an unbounded array grows ~80 MB over a 2,000-call audit day and
// eventually stalls the tab. 100 newest entries is plenty for prompt debugging.
const MAX_DEBUG_ENTRIES = 100;

export const useAIDebugLogStore = create<AIDebugLogStore>((set) => ({
  entries: [],
  addEntry: (functionName, module, systemPrompt, criterionSkill) =>
    set((s) => ({
      entries: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toISOString(),
          functionName,
          module,
          systemPrompt,
          criterionSkill,
        },
        ...s.entries,
      ].slice(0, MAX_DEBUG_ENTRIES),
    })),
  clearLog: () => set({ entries: [] }),
}));
