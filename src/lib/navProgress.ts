// Journey progress ticks for the sidebar — PURE and store-free so the
// done-state rules are unit-testable. A step gets a green tick ONLY where a
// genuine done-state can be read from real app data; steps without a reliable
// signal are simply absent from the map and render number-only. Never
// approximate a done-state — an unbacked tick is treated like a fabricated
// result, so when in doubt a step is left out of `NAV_DONE_SIGNALS`.

// The real signals we can compute, one per core step that has one. Steps not
// listed here (Profile of PEI, Start Audit, Findings, Final Report) have no
// reliable completion signal and stay number-only.
export type NavDoneSignals = {
  cyclePeriodSet: boolean;      // /audit-cycle   — period start+end and scope set
  auditorsAdded: boolean;       // /auditors      — at least one auditor exists
  foldersLinked: boolean;       // /evidence-folder — at least one folder has a Drive link
  checklistScored: boolean;     // /sub-checklist — at least one item's band comes from the checklist
  ppdReviewed: boolean;         // /evidence-folder — a PPD (Option A) review has been run (the standalone page was retired; review now runs on the Evidence Folder page)
  allFindingsClosed: boolean;   // /afi-closure   — findings exist and none are still open
  allScoresConfirmed: boolean;  // /scorecard     — every item has a confirmed score
  cycleLocked: boolean;         // /finalisation  — the cycle has been locked
  exported: boolean;            // /export        — at least one export has been produced
};

// Which sidebar path each signal drives. Only these paths can ever show a tick.
export const NAV_DONE_PATHS: Record<keyof NavDoneSignals, string> = {
  cyclePeriodSet: "/audit-cycle",
  auditorsAdded: "/auditors",
  foldersLinked: "/evidence-folder",
  checklistScored: "/sub-checklist",
  // The standalone PPD Requirements Review page was retired; the Option A review
  // now runs on the Evidence Folder page, so its progress tick lives there too.
  ppdReviewed: "/evidence-folder",
  allFindingsClosed: "/afi-closure",
  allScoresConfirmed: "/scorecard",
  cycleLocked: "/finalisation",
  exported: "/export",
};

// path -> done?  Only signal-backed paths appear as keys; a `true` value means
// "show the green tick", a `false` means "signal exists but not yet complete"
// (still renders the step number). Everything else is number-only.
export function navDoneMap(s: NavDoneSignals): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  // OR-combine when two signals share a path (e.g. foldersLinked AND ppdReviewed
  // both tick /evidence-folder now that the PPD page is retired) — the step is
  // "done" if EITHER signal is complete, never overwriting a done tick.
  (Object.keys(NAV_DONE_PATHS) as (keyof NavDoneSignals)[]).forEach((k) => {
    const path = NAV_DONE_PATHS[k];
    out[path] = (out[path] ?? false) || s[k];
  });
  return out;
}
