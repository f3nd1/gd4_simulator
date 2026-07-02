// The five run automation modes — most automated first. Pure helpers so the
// mode gating is unit-testable (the stores transitively load pdfjs and cannot
// be imported under Vitest). Modes decide WHEN checklist writes are committed
// and whether the human is prompted; the assessment engines are unchanged.

import type { ChecklistLineWrite, RunMode } from "../types";

export const RUN_MODES: Array<{ value: RunMode; label: string; short: string; desc: string }> = [
  {
    value: "full_auto",
    label: "Full auto",
    short: "Full auto",
    desc: "The AI runs the whole selected path end to end and commits everything: verdicts, findings and closure drafts. You read the results after.",
  },
  {
    value: "confidence",
    label: "Auto with confidence gating",
    short: "Confidence gating",
    desc: "Runs automatically but pauses where the AI is low-confidence: no or weak evidence, missing citations, unverified quotes or contradictions. You resolve only the flagged lines; the rest commits automatically.",
  },
  {
    value: "review",
    label: "Review mode",
    short: "Review",
    desc: "Runs everything but commits nothing. All verdicts wait in a batch for you to Accept all, or accept and reject line by line.",
  },
  {
    value: "hybrid",
    label: "Hybrid (human in the loop)",
    short: "Hybrid",
    desc: "The AI drafts each verdict and stops at every gate. You approve, edit or reject each line before the next one commits.",
  },
  {
    value: "manual",
    label: "Manual",
    short: "Manual",
    desc: "The AI decides nothing. You enter every verdict and finding yourself in the Sub-Criterion Checklist; AI suggestions are available per item on request.",
  },
];

export function runModeLabel(mode: RunMode): string {
  return RUN_MODES.find((m) => m.value === mode)?.label ?? mode;
}

export const DEFAULT_RUN_MODE: RunMode = "confidence";

// Splits a run's checklist writes by mode:
//   commit — apply to the checklist now
//   queue  — hold as PendingCommitItems for human review
// manual never reaches here via the engines (runs are blocked in manual
// mode), but the mapping is defined anyway: nothing commits, nothing queues.
export function partitionWritesByMode(
  mode: RunMode,
  writes: ChecklistLineWrite[]
): { commit: ChecklistLineWrite[]; queue: ChecklistLineWrite[] } {
  switch (mode) {
    case "full_auto":
      return { commit: writes, queue: [] };
    case "confidence":
      return {
        commit: writes.filter((w) => !w.lowConfidence),
        queue: writes.filter((w) => w.lowConfidence),
      };
    case "review":
    case "hybrid":
      return { commit: [], queue: writes };
    case "manual":
      return { commit: [], queue: [] };
  }
}

// Confidence signal for a staged-audit (Option B) verdict, from the same
// honesty signals earlier batches added: a gap verdict, no cited chunks
// anywhere in the APSR, or unverified-quote annotations in the notes.
export function stagedWriteConfidence(
  status: "Met" | "Partial" | "Not met",
  apsr: { approach: { sourceChunkIds?: string[]; note: string }; processes: { sourceChunkIds?: string[]; note: string }; systemsOutcomes: { sourceChunkIds?: string[]; note: string }; review: { sourceChunkIds?: string[]; note: string } }
): { lowConfidence: boolean; reason?: string } {
  if (status !== "Met") {
    return { lowConfidence: true, reason: `Verdict ${status} — no or weak evidence found; confirm before committing.` };
  }
  const dims = [apsr.approach, apsr.processes, apsr.systemsOutcomes, apsr.review];
  const anyCitation = dims.some((d) => (d.sourceChunkIds?.length ?? 0) > 0);
  if (!anyCitation) {
    return { lowConfidence: true, reason: "No source chunks cited for any APSR dimension — verdict is uncited." };
  }
  if (dims.some((d) => d.note.includes("unverified"))) {
    return { lowConfidence: true, reason: "A quoted excerpt could not be verified against the source documents." };
  }
  return { lowConfidence: false };
}
