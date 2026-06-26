import type { EvidenceFolder } from "../types";
import { GD4_SUB_CRITERIA } from "./gd4Requirements";

// One evidence folder per GD4 sub-criterion (24 total), named after the
// official criterion/sub-criterion numbering and title so the folder
// structure maps 1:1 onto the official GD4 criteria, not an invented
// department-based grouping.
export const FOLDER_STRUCTURE = GD4_SUB_CRITERIA.map((s) => `${s.id} ${s.title}`);

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
    missingEvidenceCount: 0,
    lastCheckedDate: "",
  }));
}
