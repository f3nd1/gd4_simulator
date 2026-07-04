// "Since you were last here" resume panel (Dashboard) — pure derivation so
// the prioritisation rules are unit-testable. Turns current workspace state
// into an ordered list of next actions with deep links; empty when there is
// genuinely nothing in flight.

import type { AuditRunRecord, Finding } from "../types";

export type ResumeItem = {
  key: string;
  label: string; // what happened / what is waiting
  action: string; // the verb on the link button
  to: string; // route (may carry a query filter)
};

export function buildResumeItems(input: {
  lastAuditRuns: Record<string, AuditRunRecord>;
  pendingCommitCount: number; // hybrid verdicts waiting for approval
  pendingDraftCount: number; // grouped finding drafts not yet confirmed
  findings: Finding[];
  closures: Record<string, { human?: string; effectivenessDue?: string; effectivenessConfirmedAt?: string }>;
  today?: string; // ISO date for testability, defaults to now
}): ResumeItem[] {
  const items: ResumeItem[] = [];
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  // 1. Verdicts waiting for approval block everything downstream — first.
  if (input.pendingCommitCount > 0) {
    items.push({
      key: "pending-commits",
      label: `${input.pendingCommitCount} audit run${input.pendingCommitCount === 1 ? "" : "s"} waiting for your review (hybrid mode) — verdicts are not committed until you accept them`,
      action: "Review runs",
      to: "/evidence-folder",
    });
  }

  // 2. Unconfirmed finding drafts — the post-audit tail people forget.
  if (input.pendingDraftCount > 0) {
    items.push({
      key: "pending-drafts",
      label: `${input.pendingDraftCount} draft finding${input.pendingDraftCount === 1 ? "" : "s"} not yet confirmed into the register`,
      action: "Review drafts",
      to: "/findings",
    });
  }

  // 3. Closure work: open findings, then overdue effectiveness reviews.
  const open = input.findings.filter((f) => input.closures[f.id]?.human !== "Accepted");
  if (open.length > 0) {
    items.push({
      key: "open-findings",
      label: `${open.length} finding${open.length === 1 ? "" : "s"} still open for closure`,
      action: "Close findings",
      to: "/afi-closure",
    });
  }
  const effectivenessDue = input.findings.filter((f) => {
    const c = input.closures[f.id];
    return c?.human === "Accepted" && c.effectivenessDue && !c.effectivenessConfirmedAt && c.effectivenessDue.slice(0, 10) <= today;
  });
  if (effectivenessDue.length > 0) {
    items.push({
      key: "effectiveness-due",
      label: `${effectivenessDue.length} closed finding${effectivenessDue.length === 1 ? "" : "s"} due an effectiveness review`,
      action: "Confirm effectiveness",
      to: "/afi-closure",
    });
  }

  // 4. Context line: the most recent audit run (where you left off).
  const runs = Object.values(input.lastAuditRuns);
  if (runs.length > 0) {
    const latest = runs.reduce((a, b) => (a.endedAt > b.endedAt ? a : b));
    const when = latest.endedAt.slice(0, 16).replace("T", " ");
    items.push({
      key: "last-run",
      label: `Last audit run: ${latest.subCriterionId} — ${latest.status}${latest.auditLive ? "" : " (offline estimate)"} · ${when} · ${latest.findingsDetected} finding${latest.findingsDetected === 1 ? "" : "s"} detected`,
      action: "View findings",
      to: `/findings?subCrit=${latest.subCriterionId}`,
    });
  }

  return items;
}
