import type { EvidenceFolder } from "../types";
import { GD4_SUB_CRITERIA } from "./gd4Requirements";
import { runScopesForSub, scopeTitle, folderScopeId } from "../lib/evidenceScope";

// One evidence folder per GD4 run-scope, named after the official numbering and
// title so the folder structure maps 1:1 onto the official GD4 criteria, not an
// invented department-based grouping. A scope is normally a sub-criterion (one
// folder per sub); a per-item split sub (4.2) instead yields one folder per item
// (4.2.1, 4.2.2), each with its own links, path and Run audit.
export function seedFolders(): EvidenceFolder[] {
  return GD4_SUB_CRITERIA.flatMap((s) =>
    runScopesForSub(s.id).map((scopeId) => {
      const perItem = scopeId !== s.id; // an item-level scope (e.g. "4.2.1")
      return {
        id: `FOLD-${scopeId}`,
        auditCycleId: "cycle-1",
        criterionId: s.criterionId,
        subCriterionId: s.id,
        // Only item-level folders carry a scopeId; sub-level folders leave it
        // absent so they stay byte-identical to pre-split persisted folders.
        ...(perItem ? { scopeId } : {}),
        folderName: perItem ? `${scopeId} ${scopeTitle(scopeId)}` : `${s.id} ${s.title}`,
        sourceSystem: "Google Drive" as const,
        folderLink: "",
        owner: "SQ",
        status: "In Progress" as const,
        lastCheckedDate: "",
      };
    })
  );
}

// Reconcile a persisted folder list against the current canonical sub-criteria.
// Used by the workspace store's persist migration when the sub-criterion
// structure changes (e.g. the GD4-Library split of 2.1 → 2.1.1 / 2.1.2):
//  • folders whose sub-criterion no longer exists are DROPPED (their links go
//    with them, so that area is re-linked and re-audited fresh — the user's
//    chosen "discard & re-audit" behaviour), and
//  • a fresh empty folder is added for every new sub-criterion.
// Folders for unchanged sub-criteria keep their links, audit stamps and history
// untouched. Results are returned in canonical sub-criterion order.
export function reconcileFolders(existing: EvidenceFolder[]): EvidenceFolder[] {
  // Reconcile by SCOPE, not sub-criterion, so the two 4.2 item folders are each
  // treated as a distinct slot. The 7->8 migration (useWorkspaceStore) splits a
  // persisted single "4.2" folder into its two item folders BEFORE this runs, so
  // the carried-over links survive; here an unmatched scope is simply seeded
  // empty, and a folder for a scope that no longer exists is dropped.
  const seeded = seedFolders();
  const order = new Map(seeded.map((f, i) => [folderScopeId(f), i]));
  const kept = existing.filter((f) => order.has(folderScopeId(f)));
  const present = new Set(kept.map((f) => folderScopeId(f)));
  const added = seeded.filter((f) => !present.has(folderScopeId(f)));
  return [...kept, ...added].sort(
    (a, b) => (order.get(folderScopeId(a)) ?? 0) - (order.get(folderScopeId(b)) ?? 0)
  );
}
