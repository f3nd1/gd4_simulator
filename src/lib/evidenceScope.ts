import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import type { EvidenceFolder } from "../types";

// Which sub-criteria the Evidence Folder splits into one card / folder / run
// PER ITEM instead of the usual one-per-sub-criterion. Only 4.2 is split, at
// Felix's explicit request (2026-07-19): its two items (4.2.1 Student Contract,
// 4.2.2 Fee Collection and Fee Protection Scheme) gate independently and their
// evidence lives in separate Drive folders, so each needs its own links, path
// and Run audit. 2.2 has the same two-item shape but was deliberately left
// merged. Every other sub-criterion has a single item, so its scope already
// equals the sub-criterion and nothing about it changes. Keeping the split set
// here (not a hard-coded "4.2" scattered through the pipeline) confines the
// special case to one place.
export const PER_ITEM_SPLIT_SUBS = new Set<string>(["4.2"]);

export function isSplitSub(subCriterionId: string): boolean {
  return PER_ITEM_SPLIT_SUBS.has(subCriterionId);
}

// A "scope" is the unit the Evidence Folder keys a card, folder, audit run and
// Option A result on. For a split sub it is each item id (e.g. "4.2.1"); for
// every other sub it is the sub-criterion id itself. The run scopes for one
// sub-criterion, in requirement order:
export function runScopesForSub(subCriterionId: string): string[] {
  return isSplitSub(subCriterionId)
    ? GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId).map((r) => r.id)
    : [subCriterionId];
}

// The scope id an ITEM's Option A state is keyed under: the item id for an item
// of a split sub, else the sub-criterion id (a normal sub's items share one
// scope). Consumers that used `req.subCriterionId` to read run results must use
// this instead so 4.2.1 and 4.2.2 read their own results, not a merged "4.2".
export function scopeIdForItem(itemId: string, subCriterionId: string): string {
  return isSplitSub(subCriterionId) ? itemId : subCriterionId;
}

// Is this scope id an item-level (split) scope rather than a whole sub?
export function isItemScope(scopeId: string): boolean {
  const req = GD4_REQUIREMENTS.find((r) => r.id === scopeId);
  return !!req && isSplitSub(req.subCriterionId);
}

// The requirement item ids assessed under one scope: just that item for a split
// scope, else every item under the sub-criterion. This is what the audit engine
// enumerates for a run — replaces the old
// `GD4_REQUIREMENTS.filter(r => r.subCriterionId === X)`.
export function itemIdsForScope(scopeId: string): string[] {
  if (isItemScope(scopeId)) return [scopeId];
  return GD4_REQUIREMENTS.filter((r) => r.subCriterionId === scopeId).map((r) => r.id);
}

// The real sub-criterion id behind a scope (for titles, domain expertise, bucket
// routing, findings grouping) — the item's parent sub for a split scope, else
// the scope itself.
export function subOfScope(scopeId: string): string {
  return GD4_REQUIREMENTS.find((r) => r.id === scopeId)?.subCriterionId ?? scopeId;
}

// Human-readable title for a scope card: the item requirement for a split scope,
// else the sub-criterion title.
export function scopeTitle(scopeId: string): string {
  if (isItemScope(scopeId)) return GD4_REQUIREMENTS.find((r) => r.id === scopeId)?.requirement ?? scopeId;
  return GD4_SUB_CRITERIA.find((s) => s.id === scopeId)?.title ?? scopeId;
}

// The scope a folder is keyed under. A pre-split persisted folder has no
// scopeId, so it falls back to its sub-criterion — meaning every unsplit folder
// (28 of the 29 subs, 2.2 included) behaves exactly as before this change.
export function folderScopeId(f: Pick<EvidenceFolder, "scopeId" | "subCriterionId">): string {
  return f.scopeId ?? f.subCriterionId;
}

export type FilterableScope = { id: string; title: string; criterionId: string; subCriterionId: string };

// THE canonical list of filterable sub-criterion / item scopes for ANY dropdown
// or filter that lets a user pick a sub-criterion / item to narrow results by.
// Split-aware by construction (4.2 → 4.2.1, 4.2.2 via runScopesForSub), so a UI
// filter physically cannot re-merge a split sub. Every such picker MUST build
// its options from this instead of iterating GD4_SUB_CRITERIA itself — iterating
// the raw sub list is exactly what let the "4.2 merged" bug recur in four
// separate filters. `id` is the scope id to store as the filter value; pair it
// with scopeIdForItem(item) in the match predicate. Optional criterionId narrows
// to one criterion ("All" or undefined = every criterion).
export function filterableScopes(criterionId?: string): FilterableScope[] {
  return GD4_SUB_CRITERIA
    .filter((sc) => !criterionId || criterionId === "All" || sc.criterionId === criterionId)
    .flatMap((sc) => runScopesForSub(sc.id).map((scopeId) => ({
      id: scopeId,
      title: scopeTitle(scopeId),
      criterionId: sc.criterionId,
      subCriterionId: sc.id,
    })));
}
