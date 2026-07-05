import type { EvidenceFolder } from "../types";
import { GD4_SUB_CRITERIA } from "./gd4Requirements";

// One evidence folder per GD4 sub-criterion (24 total), named after the
// official criterion/sub-criterion numbering and title so the folder
// structure maps 1:1 onto the official GD4 criteria, not an invented
// department-based grouping.
export function seedFolders(): EvidenceFolder[] {
  return GD4_SUB_CRITERIA.map((s) => ({
    id: `FOLD-${s.id}`,
    auditCycleId: "cycle-1",
    criterionId: s.criterionId,
    subCriterionId: s.id,
    folderName: `${s.id} ${s.title}`,
    sourceSystem: "Google Drive",
    folderLink: "",
    owner: "SQ",
    status: "In Progress",
    lastCheckedDate: "",
  }));
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
  const order = new Map(GD4_SUB_CRITERIA.map((s, i) => [s.id, i]));
  const kept = existing.filter((f) => order.has(f.subCriterionId));
  const present = new Set(kept.map((f) => f.subCriterionId));
  const added = seedFolders().filter((f) => !present.has(f.subCriterionId));
  return [...kept, ...added].sort(
    (a, b) => (order.get(a.subCriterionId) ?? 0) - (order.get(b.subCriterionId) ?? 0)
  );
}
