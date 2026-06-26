import type { AgentDefinition } from "../types";

export const AGENTS: AgentDefinition[] = [
  { id: "gd4", name: "GD4 Specialist", focus: "Requirement coverage and banding", strictness: 70 },
  { id: "evid", name: "Evidence Controller", focus: "Currency, approval, traceability", strictness: 75 },
  { id: "challenge", name: "Challenge Panel", focus: "Pushes back on weak claims", strictness: 88 },
  { id: "rubric", name: "Rubric Scoring", focus: "Score and band against rubric", strictness: 65 },
];
