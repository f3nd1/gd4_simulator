import type { EvidenceFolder } from "../types";
import { GD4_CRITERIA } from "./gd4Requirements";

// Recommended folder structure from the requirements guide, section 7.4.
export const FOLDER_STRUCTURE = [
  "00 Audit Planning",
  "01 Leadership and Governance",
  "02 Corporate Administration",
  "03 Student Protection",
  "04 Academic Processes",
  "05 Academic Staff",
  "06 Student Support and Outcomes",
  "07 Quality Assurance",
  "08 Management Review",
  "09 AFI Closure Evidence",
  "10 Exported Reports",
  "11 Archived Drafts",
];

const FOLDER_BY_CRITERION: Record<string, string> = {
  "1": "01 Leadership and Governance",
  "2": "02 Corporate Administration",
  "3": "02 Corporate Administration",
  "4": "03 Student Protection",
  "5": "04 Academic Processes",
  "6": "07 Quality Assurance",
  "7": "06 Student Support and Outcomes",
};

export function seedFolders(): EvidenceFolder[] {
  return GD4_CRITERIA.map((c) => ({
    id: `FOLD-${c.id}`,
    auditCycleId: "cycle-1",
    criterionId: c.id,
    folderName: FOLDER_BY_CRITERION[c.id] || "00 Audit Planning",
    sourceSystem: "Google Drive",
    folderLink: "",
    owner: "SQ",
    status: "In Progress",
    missingEvidenceCount: 0,
    lastCheckedDate: "",
  }));
}
