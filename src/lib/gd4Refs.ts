// Canonical GD4 ref normalisation + finding dedupe keys, shared by every
// module that joins on a requirement ref (staged-audit row matching in
// useWorkspaceStore, checklist finding raising in useChecklistModuleStore,
// Option A compile). Both sides of ANY ref comparison must go through the
// same normalizeAuditRef or refs that match in one place silently miss in
// another.

import type { Finding, FindingTypeCode } from "../types";

// Checklist lines' sourceRef is AI-echoed and can drift in format
// ("DS: 6.1.1.DS1.a", stray spaces, lower case) — strip label prefixes,
// collapse whitespace, upper-case.
export function normalizeAuditRef(ref: string): string {
  return ref.trim().replace(/^(ref|source|gd4|ds|ee|n)\s*[:#]\s*/i, "").replace(/\s+/g, "").toUpperCase();
}

// Stable composite identity of a finding: which GD4 item, which requirement
// line (normalized ref), and what kind of finding (NC/OFI/OBS). Two findings
// with the same key describe the same gap — the register should only ever
// hold one. Returns null when there is no usable ref (the caller falls back
// to a text-prefix key), so ref-less findings never collide on an empty ref.
export function findingDedupeKey(
  gd4ItemId: string,
  ref: string | undefined,
  findingType: FindingTypeCode | undefined
): string | null {
  const norm = ref ? normalizeAuditRef(ref) : "";
  if (!norm) return null;
  return `${gd4ItemId}::${norm}::${findingType ?? ""}`;
}

// The dedupe key of an existing Finding in the register. The source ref is
// stamped into linkedSourceRefs[0] on creation (both pipelines); clause is
// the fallback for findings created before that convention.
export function findingKeyOf(
  f: Pick<Finding, "gd4ItemId" | "clause" | "linkedSourceRefs" | "findingType">
): string | null {
  return findingDedupeKey(f.gd4ItemId, f.linkedSourceRefs?.[0] ?? f.clause, f.findingType);
}
