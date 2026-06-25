import type { ItemEvidence, EvidenceLevel } from "../types";
import { GD4_REQUIREMENTS } from "./gd4Requirements";

// Weak-area overrides taken from the April 2026 internal mock audit, in the
// order [ppd, impl, review, outcome]. Items not listed default to good across
// the board. This is real seed data carried over from the existing prototype.
export const WEAK: Record<string, [EvidenceLevel, EvidenceLevel, EvidenceLevel, EvidenceLevel]> = {
  "2.3.1": ["good", "good", "Partial", "Missing"],
  "2.4.2": ["good", "good", "Missing", "Partial"],
  "2.4.3": ["Partial", "good", "Partial", "Missing"],
  "3.1.1": ["Partial", "good", "Partial", "Partial"],
  "4.1.1": ["Partial", "Partial", "Partial", "Partial"],
  "4.4.1": ["Partial", "good", "Partial", "good"],
  "4.5.1": ["good", "good", "Missing", "Partial"],
  "4.6.1": ["Partial", "Partial", "Missing", "Partial"],
  "5.1.1": ["Partial", "good", "Partial", "Partial"],
  "5.1.2": ["Missing", "Partial", "Missing", "Partial"],
  "5.2.1": ["Partial", "good", "Partial", "Partial"],
  "5.2.2": ["Partial", "good", "Partial", "good"],
  "5.4.1": ["Partial", "Partial", "Partial", "Partial"],
  "5.5.1": ["Partial", "good", "Missing", "Partial"],
  "6.2.1": ["good", "Partial", "Partial", "good"],
  "2.4.1": ["good", "good", "Partial", "good"],
};

export function seedEvidence(): Record<string, ItemEvidence> {
  const e: Record<string, ItemEvidence> = {};
  GD4_REQUIREMENTS.forEach((it) => {
    const w = WEAK[it.id] || (["good", "good", "good", "good"] as const);
    e[it.id] = {
      ppd: w[0],
      impl: w[1],
      review: w[2],
      outcome: w[3],
      owner: "SQ",
      age: WEAK[it.id] ? 150 : 45,
      trace: WEAK[it.id] ? 55 : 82,
      drive: "",
    };
  });
  return e;
}
