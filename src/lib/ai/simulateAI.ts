// Offline AI agent simulation.
//
// Per the requirements guide (section 15, "Important Cautions") and the
// user's choice for this build, no network call is made to a live LLM here.
// Every verdict below is produced by deterministic, rule-based heuristics
// over the evidence already in the workspace, and is always labelled
// `live: false` so the UI can show it as an internal simulation rather than
// a real AI Agent Review output. This keeps the AI Agent Review module
// auditable: anyone can read the rule that produced a verdict.
//
// The prompts in section 10 of the requirements guide describe what a real
// LLM-backed agent would be asked to do; they are reproduced as comments so
// a future swap-in to a real model call has the exact wording to use.

import type { AgentDefinition, ChecklistLibraryItem, ChecklistStatus, ItemEvidence } from "../../types";
import type { ScoredItem } from "../scoring";
import { aiScore, getBand } from "../scoring";
import { FINDINGS } from "../../data/findings";

export type SimulatedItemVerdict = {
  score: number;
  band: number;
  confidence: "Low" | "Medium" | "High";
  justification: string;
  higherBand: string;
  by: string;
  live: false;
};

// Mirrors the "Rubric Scoring Agent" / "GD4 Specialist Agent" prompts
// (requirements guide 10.1, 10.4): band 5 needs review + outcome evidence,
// without review evidence cap at Band 3, without implementation evidence cap
// at Band 2.
export function simulateItemReview(agent: AgentDefinition, item: { id: string; ais: number; aiBand: number }, ev: ItemEvidence): SimulatedItemVerdict {
  let score = item.ais;
  let band = getBand(score);
  if (ev.review === "Missing" && band > 3) band = 3;
  if (ev.impl === "Missing" && band > 2) band = 2;

  const gaps: string[] = [];
  if (ev.ppd !== "good") gaps.push("policy/approach evidence");
  if (ev.impl !== "good") gaps.push("implementation evidence");
  if (ev.review !== "good") gaps.push("review evidence");
  if (ev.outcome !== "good") gaps.push("outcome evidence");

  const confidence = ev.trace >= 75 && gaps.length === 0 ? "High" : gaps.length <= 1 ? "Medium" : "Low";
  const justification =
    gaps.length === 0
      ? `Evidence is complete across all four limbs; weighted score ${score} supports Band ${band}.`
      : `Evidence weighted to ${score}. Weak or missing: ${gaps.join(", ")}.`;
  const higherBand = gaps.length === 0 ? "Maintain consistency across the next sampling cycle." : `Add or strengthen ${gaps[0]} and re-run this review.`;

  return { score, band, confidence, justification, higherBand, by: agent.name, live: false };
}

// Mirrors the department-level checklist first pass (no equivalent numbered
// prompt in section 10, but follows the same "no narrative without evidence"
// rule as 10.3 Challenge Panel Agent).
export function simulateChecklist(
  items: ChecklistLibraryItem[],
  lookupScoredItem: (gd4Id: string) => Pick<ScoredItem, "ais"> | undefined
): { id: string; status: ChecklistStatus; reason: string }[] {
  return items.map((c) => {
    const linked = c.link ? lookupScoredItem(c.link) : undefined;
    const hasPriorAFI = c.link ? FINDINGS.some((a) => a.gd4ItemId === c.link) : false;
    let status: ChecklistStatus = "Partial";
    let reason = "No linked evidence; needs human check.";
    if (linked) {
      if (hasPriorAFI) {
        status = "Fail";
        reason = `Linked evidence score ${linked.ais}, but a prior finding exists on this area.`;
      } else if (linked.ais >= 70) {
        status = "Pass";
        reason = `Linked evidence score ${linked.ais}.`;
      } else if (linked.ais >= 45) {
        status = "Partial";
        reason = `Linked evidence score ${linked.ais}.`;
      } else {
        status = "Fail";
        reason = `Linked evidence score ${linked.ais}.`;
      }
    }
    return { id: c.id, status, reason };
  });
}

export type SimulatedClosureVerdict = {
  verdict: "Acceptable" | "Partial" | "Maintain Finding" | "Escalate";
  reason: string;
  evidenceNeeded: string;
  live: false;
};

// Mirrors the "Closure Reviewer Agent" behaviour described in section 7.10 /
// 7.11: a documentation finding only clears when the policy document itself
// is shown updated and approved, not on narrative assurance alone (10.3).
export function simulateClosure(closure: { root?: string; corr?: string; prev?: string; evid?: string }): SimulatedClosureVerdict {
  if (!closure.evid) {
    return {
      verdict: "Maintain Finding",
      reason: "No closure evidence linked, so the finding stands.",
      evidenceNeeded: "Updated PPD clause and approval record.",
      live: false,
    };
  }
  if (closure.root && closure.corr && closure.prev) {
    return {
      verdict: "Acceptable",
      reason: "Root cause, corrective and preventive action are documented and closure evidence is linked.",
      evidenceNeeded: "None outstanding, subject to human verification.",
      live: false,
    };
  }
  if (closure.root && closure.corr) {
    return {
      verdict: "Partial",
      reason: "Corrective action is documented but preventive action is missing, so recurrence risk remains.",
      evidenceNeeded: "Preventive action to stop this recurring.",
      live: false,
    };
  }
  return {
    verdict: "Maintain Finding",
    reason: "Show the updated, approved document to clear this finding.",
    evidenceNeeded: "Root cause and corrective action narrative, plus the updated document.",
    live: false,
  };
}

export { aiScore };
