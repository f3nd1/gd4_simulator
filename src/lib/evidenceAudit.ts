// Report-only "recheck all evidence" audit for the Dashboard's master
// button. Never mutates any data — it only re-derives, from current state,
// the same evidence gaps that scoring.ts/checklistBanding.ts already use to
// cap bands, and lists which items they apply to so an auditor can see at a
// glance which "passing" items are still standing on unverified evidence.
import type { ScoredItem } from "./scoring";
import type { SubCriterionChecklistEntry, EvidenceFolder } from "../types";
import { lineSufficiency } from "./checklistBanding";

export type EvidenceAuditFlag = {
  id: string;
  subCriterionId: string;
  title: string;
  band: number;
  source: "Sub-Criterion Checklist" | "Evidence Folder" | "Evidence Matrix";
  reason: string;
};

export function auditEvidence(
  items: ScoredItem[],
  checklistEntries: Record<string, SubCriterionChecklistEntry>,
  folders: EvidenceFolder[]
): EvidenceAuditFlag[] {
  const flags: EvidenceAuditFlag[] = [];
  const folderBySub = new Map(folders.map((f) => [f.subCriterionId, f]));

  items.forEach((it) => {
    if (it.checklistOverride) {
      const entry = checklistEntries[it.id];
      const graded = (entry?.specific || []).filter((l) => l.status !== "Not Applicable");
      const missing = graded.filter((l) => lineSufficiency(l) === "Missing");
      if (graded.length === 0) return;
      if (missing.length === graded.length) {
        flags.push({
          id: it.id,
          subCriterionId: it.subCriterionId,
          title: it.title,
          band: it.band,
          source: "Sub-Criterion Checklist",
          reason: "No checklist line has any evidence attached — band is floored at Band 1 regardless of Met/Partial status.",
        });
      } else if (missing.length > 0) {
        flags.push({
          id: it.id,
          subCriterionId: it.subCriterionId,
          title: it.title,
          band: it.band,
          source: "Sub-Criterion Checklist",
          reason: `${missing.length} checklist line(s) marked Met/Partial with evidence missing: ${missing.map((l) => l.clause || l.id).join(", ")}.`,
        });
      }
      return;
    }

    // No checklist override yet — report against the Evidence Folder reality
    // for this sub-criterion (its link + whether it's been audited), which is
    // what the auditor actually sees on the Evidence Folder page, instead of
    // the Evidence Matrix's separate per-item drive field.
    if (it.ev.drive) return; // an Evidence Matrix link already counts as evidence

    const folder = folderBySub.get(it.subCriterionId);
    const hasFolderLink = !!folder?.folderLink?.trim();
    flags.push({
      id: it.id,
      subCriterionId: it.subCriterionId,
      title: it.title,
      band: it.band,
      source: "Evidence Folder",
      reason: !hasFolderLink
        ? "No evidence folder linked for this sub-criterion yet — add a Drive link and run audit."
        : folder?.lastAuditAt
          ? "Evidence folder was audited but produced no scored checklist line for this item — open it to review."
          : "Evidence folder is linked but not audited yet — run audit to read it and score this item.",
    });
  });

  return flags;
}
