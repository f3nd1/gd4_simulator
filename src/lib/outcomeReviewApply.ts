// On-demand Outcomes & Review pass for Option A rows: pure helpers that map
// an Option B third-pass result (OutcomeReviewRow) onto the two APSR legs
// Option A structurally leaves unassessed (Systems & Outcomes, Review), and
// join pass rows to checklist lines by official ref. Store-free so both are
// unit-testable.
//
// SCORING SAFETY: these helpers produce per-line APSR display legs ONLY.
// The certification band flows solely from holisticBand.matrixScores via
// computeChecklistOverrides (human-gated setHolisticBand) — nothing here may
// ever be wired into that path.

import type { ApsrBreakdown, OutcomeReviewRow, SpecificChecklistLine } from "../types";
import { buildStagedApsr } from "./ai/agentRuntime";
import { normalizeAuditRef } from "./gd4Refs";

export type OutcomeReviewLegs = {
  systemsOutcomes: ApsrBreakdown["systemsOutcomes"];
  review: ApsrBreakdown["review"];
};

// The two legs for one assessed row, via the SAME buildStagedApsr mapping the
// staged audit uses — never a reimplementation, so the citation-gap
// downgrades apply here exactly as in Option B. requireCitations is always
// true: this pass only ever runs live (Option A has no offline mode).
export function outcomeReviewLegs(row: OutcomeReviewRow): OutcomeReviewLegs {
  const apsr = buildStagedApsr(undefined, undefined, row, { requireCitations: true });
  return { systemsOutcomes: apsr.systemsOutcomes, review: apsr.review };
}

export type OutcomeReviewLegUpdate = { itemId: string; lineId: string } & OutcomeReviewLegs;

// Joins pass rows to checklist lines by normalized official ref — the same
// join buildOptionALineWrites uses — and returns per-line leg updates.
// notAssessed rows (stopped run / AI call failed in every window) produce NO
// update: a point that was never put in front of the AI must not overwrite a
// line's existing legs.
export function buildOutcomeReviewLegUpdates(
  rows: OutcomeReviewRow[],
  linesByItem: Record<string, Array<Pick<SpecificChecklistLine, "id" | "sourceRef" | "clause">>>
): OutcomeReviewLegUpdate[] {
  const byRef = new Map<string, OutcomeReviewRow>();
  for (const r of rows) if (!r.notAssessed) byRef.set(normalizeAuditRef(r.ref), r);
  const updates: OutcomeReviewLegUpdate[] = [];
  for (const [itemId, lines] of Object.entries(linesByItem)) {
    for (const l of lines) {
      const ref = l.sourceRef || l.clause;
      if (!ref) continue;
      const row = byRef.get(normalizeAuditRef(ref));
      if (!row) continue;
      updates.push({ itemId, lineId: l.id, ...outcomeReviewLegs(row) });
    }
  }
  return updates;
}
