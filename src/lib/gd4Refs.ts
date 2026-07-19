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

// One-time ref carry-over for the 2026-07-19 split of 6.1.1.DS1.c into two
// audit points (DS1.c = compiling AFIs, new DS1.d = developing CAPs). Splitting
// c pushed the later sub-points down one letter, so a ref STORED under the old
// numbering must follow its CONTENT to the new letter, or it would resolve to
// the wrong requirement point (e.g. the old DS1.e "CAP Approval" line would
// otherwise land on the new DS1.e "defining owners"). Only the three shifted
// refs move; a/b/c keep their letters and the new d has no legacy data.
// Matched on the NORMALISED form so prefixed/mixed-case stored variants
// ("DS: 6.1.1.DS1.E") also carry over; a non-match is returned unchanged.
//
// NOT IDEMPOTENT (old f -> g), so it must be applied EXACTLY ONCE, only from a
// version-gated store migration — never re-run on already-migrated data.
const DS1_SPLIT_REMAP: Record<string, string> = {
  "6.1.1.DS1.D": "6.1.1.DS1.e", // defining owners & completion timelines
  "6.1.1.DS1.E": "6.1.1.DS1.f", // approving all CAPs prior to implementation (CAP Approval)
  "6.1.1.DS1.F": "6.1.1.DS1.g", // monitoring the implementation of the CAPs
};
export function migrateDs1Ref(ref: string): string {
  return DS1_SPLIT_REMAP[normalizeAuditRef(ref)] ?? ref;
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
