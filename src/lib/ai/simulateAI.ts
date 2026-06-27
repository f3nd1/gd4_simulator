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

import type { AgentDefinition, Finding, GD4Requirement, ItemEvidence, SpecificChecklistLine, ApsrBreakdown } from "../../types";
import { aiScore } from "../scoring";
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
// (requirements guide 10.1, 10.4). The score/band themselves are taken
// as-is from scoring.ts — sourced from the Sub-Criterion Checklist outcome
// when one exists, otherwise from the evidence-matrix fallback, which is
// already capped there (review/processes/missing-Drive-link rules) — this
// function only ever turns that fixed figure into narrative text, never
// recomputes or second-guesses it.
export function simulateItemReview(agent: AgentDefinition, item: { id: string; eff: number; band: number }, ev: ItemEvidence): SimulatedItemVerdict {
  const score = item.eff;
  const band = item.band;

  const gaps: string[] = [];
  if (ev.approach !== "good") gaps.push("approach evidence");
  if (ev.processes !== "good") gaps.push("processes evidence");
  if (ev.systemsOutcomes !== "good") gaps.push("systems & outcomes evidence");
  if (ev.review !== "good") gaps.push("review evidence");
  if (!ev.drive) gaps.push("a linked evidence document (Drive folder)");

  const confidence = ev.trace >= 75 && gaps.length === 0 ? "High" : gaps.length <= 1 ? "Medium" : "Low";
  const justification =
    gaps.length === 0
      ? `Evidence is complete across all four limbs and a Drive evidence link is on file; weighted score ${score} supports Band ${band}.`
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

// Drives the Evidence Folder page's "Run audit" action: given the text
// actually extracted from a Drive folder's readable files (see
// lib/drive/driveClient.ts) and the checklist lines it should support, marks
// each line Met/Partial/Not met by simple keyword overlap. Offline fallback
// only — mirrors every other simulate* function's role as the no-network
// stand-in for the live OpenAI call in agentRuntime.ts.
export type FolderAuditLineVerdict = { lineId: string; status: "Met" | "Partial" | "Not met"; reason: string; sources?: string[]; apsr?: ApsrBreakdown };

// Derives the overall Met/Partial/Not met from an APSR breakdown with Approach
// hard-gating: a "Beginning" or "Not evident" Approach (the documented policy &
// procedure) caps the line at "Not met" no matter how much else exists — you
// cannot pass on implementation alone when the documented approach itself falls
// short. Met requires the full rubric: a Meeting-level Approach, deployed
// Processes, evident Systems & Outcomes, and an evident Review.
export function deriveApsrStatus(p: ApsrBreakdown): "Met" | "Partial" | "Not met" {
  if (p.approach.status !== "Meeting") return "Not met"; // Approach gates everything
  if (p.processes.status === "Not evident") return "Not met"; // documented but not deployed
  if (p.processes.status === "Deployed" && p.systemsOutcomes.status === "Evident" && p.review.status === "Evident") return "Met";
  return "Partial"; // deployed but outcomes and/or review not yet evident
}

// Renders an APSR breakdown as a one-line, human-readable critique for the
// auditor note (the "comment on whether the procedure is sustainable / too
// generic" lives in approach.note).
export function apsrReason(p: ApsrBreakdown): string {
  return `Approach (documented policy): ${p.approach.status} — ${p.approach.note} | Processes (implementation): ${p.processes.status} — ${p.processes.note} | Systems & Outcomes: ${p.systemsOutcomes.status}${p.systemsOutcomes.note ? ` — ${p.systemsOutcomes.note}` : ""} | Review: ${p.review.status}${p.review.note ? ` — ${p.review.note}` : ""}`;
}

const STOPWORDS = new Set(["which", "where", "their", "there", "every", "shall", "should", "these", "those", "about", "within"]);

function keywordsOf(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((k) => !STOPWORDS.has(k))));
}

export function simulateFolderAudit(lines: { id: string; text: string }[], docText: string): FolderAuditLineVerdict[] {
  if (!docText.trim()) {
    return lines.map((l) => ({ lineId: l.id, status: "Not met" as const, reason: "No readable text was extracted from the folder's files." }));
  }
  const hay = docText.toLowerCase();
  return lines.map((l) => {
    const kws = keywordsOf(l.text);
    if (kws.length === 0) return { lineId: l.id, status: "Not met" as const, reason: "Checklist line has no specific keywords to match against." };
    const hits = kws.filter((k) => hay.includes(k));
    const ratio = hits.length / kws.length;
    if (ratio >= 0.6) return { lineId: l.id, status: "Met" as const, reason: `Matched terms in the scanned documents: ${hits.slice(0, 4).join(", ")}.` };
    if (ratio > 0) return { lineId: l.id, status: "Partial" as const, reason: `Only partial overlap found in the scanned documents: ${hits.slice(0, 4).join(", ")}.` };
    return { lineId: l.id, status: "Not met" as const, reason: "No matching terms found in the scanned documents." };
  });
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
