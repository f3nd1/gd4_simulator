import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { AgentMemoryEntry } from "../types";

// Minimal per-agent conversation memory so a live LLM call can be given
// context from its own prior turns in this workspace. Kept in its own
// localStorage key, separate from the workspace blob and the AI settings,
// so it can be cleared independently of either.
export type AgentMemoryState = {
  memory: Record<string, AgentMemoryEntry[]>;
  addMemory: (agentId: string, entry: AgentMemoryEntry) => void;
  clearMemory: (agentId?: string) => void;
};

const MAX_TURNS_PER_AGENT = 12;

export const useAgentMemoryStore = create<AgentMemoryState>()(
  persist(
    (set) => ({
      memory: {},
      addMemory: (agentId, entry) =>
        set((s) => ({
          memory: {
            ...s.memory,
            [agentId]: [...(s.memory[agentId] || []), entry].slice(-MAX_TURNS_PER_AGENT),
          },
        })),
      clearMemory: (agentId) =>
        set((s) => (agentId ? { memory: { ...s.memory, [agentId]: [] } } : { memory: {} })),
    }),
    { name: "ucc-gd4-ai-memory:v1", storage: workspaceStorage }
  )
);
