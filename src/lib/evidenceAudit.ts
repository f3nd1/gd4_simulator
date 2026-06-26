// Report-only "recheck all evidence" audit for the Dashboard's master
// button. Never mutates any data — it only re-derives, from current state,
// the same evidence gaps that scoring.ts/checklistBanding.ts already use to
// cap bands, and lists which items they apply to so an auditor can see at a
// glance which "passing" items are still standing on unverified evidence.
import type { ScoredItem } from "./scoring";
import type { SubCriterionChecklistEntry } from "../types";
import { lineSufficiency } from "./checklistBanding";

export type EvidenceAuditFlag = {
  id: string;
  title: string;
  band: number;
  source: "Sub-Criterion Checklist" | "Evidence Matrix";
  reason: string;
};

export function auditEvidence(items: ScoredItem[], checklistEntries: Record<string, SubCriterionChecklistEntry>): EvidenceAuditFlag[] {
  const flags: EvidenceAuditFlag[] = [];

  items.forEach((it) => {
    if (it.checklistOverride) {
      const entry = checklistEntries[it.id];
      const graded = (entry?.specific || []).filter((l) => l.status !== "Not Applicable");
      const missing = graded.filter((l) => lineSufficiency(l) === "Missing");
      if (graded.length === 0) return;
      if (missing.length === graded.length) {
        flags.push({
          id: it.id,
          title: it.title,
          band: it.band,
          source: "Sub-Criterion Checklist",
          reason: "No checklist line has any evidence attached — band is floored at Band 1 regardless of Met/Partial status.",
        });
      } else if (missing.length > 0) {
        flags.push({
          id: it.id,
          title: it.title,
          band: it.band,
          source: "Sub-Criterion Checklist",
          reason: `${missing.length} checklist line(s) marked Met/Partial with evidence missing: ${missing.map((l) => l.clause || l.id).join(", ")}.`,
        });
      }
    } else if (!it.ev.drive) {
      flags.push({
        id: it.id,
        title: it.title,
        band: it.band,
        source: "Evidence Matrix",
        reason: "No Drive evidence link attached — limb ratings alone are not evidence; band is capped at Band 1.",
      });
    }
  });

  return flags;
}
