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
      ],
    })),
  clearLog: () => set({ entries: [] }),
}));
