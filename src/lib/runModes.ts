// The three audit modes — one cycle-level choice made on the Start Audit
// page. Pure helpers so the mode gating is unit-testable (the stores
// transitively load pdfjs and cannot be imported under Vitest). Modes decide
// WHEN checklist writes are committed and whether the human is prompted; the
// assessment engines are unchanged.

import type { AuditMode, ChecklistLineWrite } from "../types";

export const AUDIT_MODES: Array<{ value: AuditMode; label: string; icon: string; desc: string; best: string }> = [
  {
    value: "full-auto",
    label: "Full auto",
    icon: "⚡",
    desc: "The AI runs the entire audit across all sub-criteria and commits everything: verdicts, findings and closure drafts. You just wait and read the report.",
    best: "Best for a fast first pass.",
  },
  {
    value: "hybrid",
    label: "Hybrid (step by step)",
    icon: "🤝",
    desc: "PPD + Evidence verdicts commit to the checklist automatically — review or edit any of them there, then raise findings yourself when ready. Staged-audit verdicts still stop for per-line approval.",
    best: "Best for a careful review.",
  },
  {
    value: "manual",
    label: "Manual",
    icon: "✍️",
    desc: "You enter every verdict and finding yourself. The AI only suggests when you ask, item by item.",
    best: "Best when you want full control.",
  },
];

export const DEFAULT_AUDIT_MODE: AuditMode = "hybrid";

export function auditModeLabel(mode: AuditMode): string {
  return AUDIT_MODES.find((m) => m.value === mode)?.label ?? mode;
}

// Splits a run's checklist writes by mode:
//   commit — apply to the checklist now
//   queue  — hold as PendingCommitItems for human approval (hybrid's gates)
// manual never reaches here via the engines (auto-runs are blocked in manual
// mode), but the mapping is defined anyway: nothing commits, nothing queues.
export function partitionWritesByMode(
  mode: AuditMode,
  writes: ChecklistLineWrite[]
): { commit: ChecklistLineWrite[]; queue: ChecklistLineWrite[] } {
  switch (mode) {
    case "full-auto":
      return { commit: writes, queue: [] };
    case "hybrid":
      return { commit: [], queue: writes };
    case "manual":
      return { commit: [], queue: [] };
  }
}

// Option A (PPD + Evidence) writes: the per-line approval gate was REMOVED
// for this path (2026-07) — in practice it was never completed (runs piled up
// unapproved and the checklist froze on the first run, firing the staleness
// warning the gate itself caused). In hybrid the verdicts now commit
// immediately, like full-auto; the human's override lives on the checklist
// card's editable verdict dropdown, and findings compilation still waits for
// the human's explicit Compile click (that is what keeps hybrid distinct from
// full-auto, which compiles findings automatically). Option B's staged flow
// keeps the full gate via partitionWritesByMode above.
export function partitionOptionAWrites(
  mode: AuditMode,
  writes: ChecklistLineWrite[]
): { commit: ChecklistLineWrite[]; queue: ChecklistLineWrite[] } {
  return partitionWritesByMode(mode === "hybrid" ? "full-auto" : mode, writes);
}

// Confidence note for a staged-audit verdict — no longer a gating signal
// (confidence mode was folded into hybrid), but kept as the per-gate reason
// shown in the review queue so the human knows WHY a verdict needs a look.
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
