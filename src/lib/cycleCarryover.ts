// Cycle-over-cycle carryover — the PDCA loop ISO 19011/9001 expects.
// createNewCycle previously wiped every finding, so "did last year's AFIs
// recur?" was unanswerable and Finding.repeatFinding could never be true.
// Pure helpers here; the store wires them into createNewCycle/addCustomFinding.

import type { Finding, FindingTypeCode, NcSeverity } from "../types";
import { normalizeAuditRef } from "./gd4Refs";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";

export type PriorCycleArchive = {
  cycleId: string;
  cycleName: string;
  archivedAt: string; // ISO
  findings: Finding[];
};

// A gap's cross-cycle identity: item + normalized source ref. Deliberately
// IGNORES findingType — a gap that was an OFI last cycle and returns as an NC
// is still the same recurring gap (and worse).
export function carryoverKey(f: Pick<Finding, "gd4ItemId" | "clause" | "linkedSourceRefs">): string | null {
  const ref = f.linkedSourceRefs?.[0] ?? f.clause;
  const norm = ref ? normalizeAuditRef(ref) : "";
  return norm ? `${f.gd4ItemId}::${norm}` : null;
}

// Marker prefix for the classification-drift review note. Kept as one
// constant so the append is idempotent (a finding is flagged once, not on
// every subsequent re-raise) and so any later surface can detect it.
export const CLASSIFICATION_REVIEW_MARKER = "⚠ CLASSIFICATION REVIEW";

export function classificationReviewNote(was: FindingTypeCode, now: FindingTypeCode | undefined): string {
  return `${CLASSIFICATION_REVIEW_MARKER} - this gap was raised as ${was} and a later audit pass now reads it as ${now ?? "NC"}. Review the classification before closing; no second finding was created.`;
}

// Type-blind same-gap lookup (R9 fix, 2026-07-16). findingDedupeKey includes
// the finding type, so an NC and an OFI on the same requirement point never
// match, and a verdict-class change between audit passes (Not met to Partial
// flips NC to OFI) could raise a sibling finding for one gap. This answers
// "does an OPEN gap-record already exist for this exact gap, whatever its
// classification?" using the same carryoverKey identity R9 and the
// cross-cycle carryover already use, never a third matching scheme.
// OBS findings never suppress: an OBS records a strength, and a recorded
// strength must not block a genuinely new NC/OFI for a later regression.
// Scope matches R9: status !== "Closed" (closure acceptance is a separate
// record and does not set status).
export function findOpenFindingForGap(findings: Finding[], gd4ItemId: string, ref: string | undefined): Finding | undefined {
  const key = carryoverKey({ gd4ItemId, clause: ref, linkedSourceRefs: undefined });
  if (!key) return undefined;
  return findings.find((f) => f.status !== "Closed" && resolveFindingType(f) !== "OBS" && carryoverKey(f) === key);
}

export type RepeatInfo = {
  repeatFinding: boolean;
  // Set when a repeat Minor NC is escalated to Major (recurrence of the same
  // nonconformity across cycles is the classic ISO escalation trigger).
  escalatedToMajor: boolean;
  priorFindingId?: string;
  priorLabel?: string; // e.g. "NC (Minor) in 'Pre-audit 2025'"
};

export function deriveRepeatInfo(
  candidate: Pick<Finding, "gd4ItemId" | "clause" | "linkedSourceRefs" | "findingType" | "ncSeverity">,
  archive: PriorCycleArchive | null | undefined,
): RepeatInfo {
  const none: RepeatInfo = { repeatFinding: false, escalatedToMajor: false };
  if (!archive || archive.findings.length === 0) return none;
  const key = carryoverKey(candidate);
  if (!key) return none;
  const prior = archive.findings.find((p) => carryoverKey(p) === key);
  if (!prior) return none;
  const priorType = resolveFindingType(prior);
  const priorSev = resolveNcSeverity(prior);
  const escalate =
    priorType === "NC" &&
    resolveFindingType(candidate as Finding) === "NC" &&
    (candidate.ncSeverity ?? "Minor") === "Minor";
  return {
    repeatFinding: true,
    escalatedToMajor: escalate,
    priorFindingId: prior.id,
    priorLabel: `${priorType}${priorSev ? ` (${priorSev})` : ""} in "${archive.cycleName}"`,
  };
}

// Applies the repeat derivation to a finding about to enter the register.
export function applyCarryover(f: Finding, archive: PriorCycleArchive | null | undefined): Finding {
  const info = deriveRepeatInfo(f, archive);
  if (!info.repeatFinding) return f;
  const escalation: { ncSeverity?: NcSeverity } = info.escalatedToMajor ? { ncSeverity: "Major" } : {};
  const note = `⟲ REPEAT FINDING — the same gap was raised as ${info.priorLabel} (${info.priorFindingId}).${info.escalatedToMajor ? " Recurrence of a nonconformity across cycles: severity escalated Minor → Major." : ""}`;
  return {
    ...f,
    repeatFinding: true,
    ...escalation,
    observation: f.observation ? `${note}\n\n${f.observation}` : note,
  };
}
