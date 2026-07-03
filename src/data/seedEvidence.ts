import type { ItemEvidence, EvidenceLevel } from "../types";
import { GD4_REQUIREMENTS } from "./gd4Requirements";

// Weak-area overrides taken from the April 2026 internal mock audit, in the
// order [approach, processes, systemsOutcomes, review]. Items not listed
// default to good across the board. This is real seed data carried over from
// the existing prototype, ported to the official rubric dimension names (the
// old "review"/"outcome" tuple slots are swapped to match: old slot 2 -> new
// review, old slot 3 -> new systemsOutcomes).
export const WEAK: Record<string, [EvidenceLevel, EvidenceLevel, EvidenceLevel, EvidenceLevel]> = {
  "2.3.1": ["good", "good", "Missing", "Partial"],
  "2.4.2": ["good", "good", "Partial", "Missing"],
  "2.4.3": ["Partial", "good", "Missing", "Partial"],
  "3.1.1": ["Partial", "good", "Partial", "Partial"],
  "4.1.1": ["Partial", "Partial", "Partial", "Partial"],
  "4.4.1": ["Partial", "good", "good", "Partial"],
  "4.5.1": ["good", "good", "Partial", "Missing"],
  "4.6.1": ["Partial", "Partial", "Partial", "Missing"],
  "5.1.1": ["Partial", "good", "Partial", "Partial"],
  "5.1.2": ["Missing", "Partial", "Partial", "Missing"],
  "5.2.1": ["Partial", "good", "Partial", "Partial"],
  "5.2.2": ["Partial", "good", "good", "Partial"],
  "5.4.1": ["Partial", "Partial", "Partial", "Partial"],
  "5.5.1": ["Partial", "good", "Partial", "Missing"],
  "6.2.1": ["good", "Partial", "good", "Partial"],
  "2.4.1": ["good", "good", "good", "Partial"],
};

// True blank default for a new workspace: every GD4 item exists in the
// evidence map (so consumers never have to guard against a missing key) but
// carries no rated evidence yet. The realistic sample ratings below only
// load when the user explicitly clicks "Use demo data".
export function blankEvidence(): Record<string, ItemEvidence> {
  const e: Record<string, ItemEvidence> = {};
  GD4_REQUIREMENTS.forEach((it) => {
    e[it.id] = { approach: "Missing", processes: "Missing", systemsOutcomes: "Missing", review: "Missing", owner: "", age: 0, trace: 0, drive: "" };
  });
  return e;
}

export function seedEvidence(): Record<string, ItemEvidence> {
  const e: Record<string, ItemEvidence> = {};
  GD4_REQUIREMENTS.forEach((it) => {
    const w = WEAK[it.id] || (["good", "good", "good", "good"] as const);
    e[it.id] = {
      approach: w[0],
      processes: w[1],
      systemsOutcomes: w[2],
      review: w[3],
      owner: "SQ",
      age: WEAK[it.id] ? 150 : 45,
      trace: WEAK[it.id] ? 55 : 82,
      drive: "",
    };
  });
  return e;
}
