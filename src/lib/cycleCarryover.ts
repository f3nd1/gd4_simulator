// Cycle-over-cycle carryover — the PDCA loop ISO 19011/9001 expects.
// createNewCycle previously wiped every finding, so "did last year's AFIs
// recur?" was unanswerable and Finding.repeatFinding could never be true.
// Pure helpers here; the store wires them into createNewCycle/addCustomFinding.

import type { Finding, NcSeverity } from "../types";
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
