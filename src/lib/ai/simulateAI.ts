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

import type { AgentDefinition, Finding, GD4Requirement, ItemEvidence, SpecificChecklistLine } from "../../types";
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
  if (ev.processes === "Missing" && band > 2) band = 2;

  const gaps: string[] = [];
  if (ev.approach !== "good") gaps.push("approach evidence");
  if (ev.processes !== "good") gaps.push("processes evidence");
  if (ev.systemsOutcomes !== "good") gaps.push("systems & outcomes evidence");
  if (ev.review !== "good") gaps.push("review evidence");

  const confidence = ev.trace >= 75 && gaps.length === 0 ? "High" : gaps.length <= 1 ? "Medium" : "Low";
  const justification =
    gaps.length === 0
      ? `Evidence is complete across all four limbs; weighted score ${score} supports Band ${band}.`
      : `Evidence weighted to ${score}. Weak or missing: ${gaps.join(", ")}.`;
  const higherBand = gaps.length === 0 ? "Maintain consistency across the next sampling cycle." : `Add or strengthen ${gaps[0]} and re-run this review.`;

  return { score, band, confidence, justification, higherBand, by: agent.name, live: false };
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

// Deterministic offline fallback for the Sub-Criterion Checklist module's
// "AI first pass" button: decomposes an item's real Describe/Show bullets
// (and Notes) into atomic, citable checklist statements. Semicolon-joined
// sub-clauses within a single bullet are split into separate lines so each
// line is independently testable, mirroring how the seeded items in
// data/checklistSeed.ts were hand-decomposed from the same source text.
function splitAtomic(text: string): string[] {
  return text
    .split(/;\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function simulateChecklistGeneration(req: GD4Requirement): { text: string; clause: string }[] {
  const lines: { text: string; clause: string }[] = [];
  req.describeShow.forEach((bullet, i) => {
    const parts = splitAtomic(bullet);
    parts.forEach((part, j) => {
      const text = part.charAt(0).toUpperCase() + part.slice(1);
      const clause = `GD4 ${req.id} · Describe/Show ${i + 1}${parts.length > 1 ? "." + (j + 1) : ""}`;
      lines.push({ text: text.endsWith(".") ? text : `${text}.`, clause });
    });
  });
  req.notes.forEach((note, i) => {
    lines.push({ text: note, clause: `GD4 ${req.id} · Notes ${i + 1}` });
  });
  return lines;
}

// Tags generated/seeded lines with the real prior AFI for this item (from
// data/findings.ts plus any findings raised at runtime), when the line's
// wording overlaps with that finding's issue text. Rule-based and auditable,
// like every other offline simulation in this file — no AFI content is
// invented, only real findings are used.
export function applyAfiOverlay(itemId: string, lines: SpecificChecklistLine[], customFindings: Finding[] = []): SpecificChecklistLine[] {
  const finding = [...FINDINGS, ...customFindings].find((f) => f.type === "AFI" && f.gd4ItemId === itemId);
  if (!finding) return lines;
  const keywords = (finding.issue.toLowerCase().match(/[a-z]{5,}/g) || []).filter((k) => !["which", "where", "their", "there", "every", "shall"].includes(k));
  return lines.map((l) => {
    if (l.afiTag) return l;
    const hit = keywords.some((k) => l.text.toLowerCase().includes(k));
    return hit ? { ...l, afiTag: finding.id } : l;
  });
}

// Drafts evidence-item metadata from a pasted link alone, for the Sub-
// Criterion Checklist's "AI fill from link" button. The document itself is
// never fetched or read — every field here is guessed from the link/filename
// string and the checklist line's text, and the drafted note says so
// explicitly, so the auditor knows what still needs human verification.
export type EvidenceFillDraft = {
  title: string;
  type: string;
  date: string;
  sufficiency: "Present" | "Weak" | "Missing";
  auditorNote: string;
  live: boolean;
};

const EVIDENCE_TYPE_KEYWORDS: [string, string][] = [
  ["polic", "Policy/Procedure"],
  ["procedure", "Policy/Procedure"],
  ["sop", "Policy/Procedure"],
  ["minutes", "Minutes"],
  ["meeting", "Minutes"],
  ["log", "Record/Log"],
  ["record", "Record/Log"],
  ["register", "Record/Log"],
  ["screenshot", "System screenshot"],
  ["screen-shot", "System screenshot"],
  ["survey", "Survey/Feedback"],
  ["feedback", "Survey/Feedback"],
];

function filenameFromLink(link: string): string {
  const path = link.split("?")[0].split("#")[0];
  return path.split("/").filter(Boolean).pop() || link;
}

function guessTitle(link: string): string {
  const noExt = filenameFromLink(link).replace(/\.[a-zA-Z0-9]{2,5}$/, "");
  let decoded = noExt;
  try {
    decoded = decodeURIComponent(noExt);
  } catch {
    // leave undecoded on malformed escape sequences
  }
  const noDate = decoded.replace(/[-_.]?(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})$/, "");
  const spaced = noDate.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced.replace(/\b\w/g, (c) => c.toUpperCase()) : "Linked evidence";
}

function guessType(filename: string, lineText: string): string {
  const hay = `${filename} ${lineText}`.toLowerCase();
  const hit = EVIDENCE_TYPE_KEYWORDS.find(([kw]) => hay.includes(kw));
  return hit ? hit[1] : "Other";
}

function guessDate(filename: string): string {
  const m = filename.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
}

export function simulateEvidenceFill(link: string, lineText: string): EvidenceFillDraft {
  const filename = filenameFromLink(link);
  const weakHints = ["draft", "template", "tbc", "wip", "blank"];
  const sufficiency: EvidenceFillDraft["sufficiency"] = weakHints.some((w) => filename.toLowerCase().includes(w)) ? "Weak" : "Present";
  return {
    title: guessTitle(link),
    type: guessType(filename, lineText),
    date: guessDate(filename),
    sufficiency,
    auditorNote: `Auto-drafted from the link/filename only — the document content was not read. Confirm this evidence actually demonstrates: "${lineText}". Record strengths/weaknesses/gaps here and how to close any gap.`,
    live: false,
  };
}

export { aiScore };
