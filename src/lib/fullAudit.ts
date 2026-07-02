// Pure planner for the Full-auto "Run full audit" sweep: which sub-criteria
// run (and via which path), and which are marked "Not assessed / no evidence"
// because they have no folder links. The Drive link parser is injected so
// this stays store-free and unit-testable (driveClient loads pdfjs, which is
// unavailable under Vitest).

export type FullAuditPlanEntry = {
  folderId: string;
  subCriterionId: string;
  folderName: string;
  path: "A" | "B";
  // False -> no Drive links: still listed (never skipped silently), marked
  // "Not assessed / no evidence" instead of run.
  hasLinks: boolean;
};

export function buildFullAuditPlan(
  folders: Array<{ id: string; subCriterionId: string; folderName: string; folderLink?: string; policyLink?: string }>,
  analysisPath: Record<string, "A" | "B">,
  isLink: (link?: string) => boolean
): FullAuditPlanEntry[] {
  return folders.map((f) => ({
    folderId: f.id,
    subCriterionId: f.subCriterionId,
    folderName: f.folderName,
    // Respect each row's Option A/B choice; default path (A) if unset.
    path: analysisPath[f.subCriterionId] ?? "A",
    hasLinks: isLink(f.folderLink) || isLink(f.policyLink),
  }));
}

// One row of the full-audit live log, colour-coded by status in the overlay:
// done (green) / skipped, no folder links (amber) / error (red) /
// waiting (grey) / running (accent, "assessing…").
export type FullAuditEntryStatus = "waiting" | "running" | "done" | "skipped" | "error";
export type FullAuditEntry = {
  subCriterionId: string;
  label: string;           // display label, number shown ONCE (see fullAuditLabel)
  status: FullAuditEntryStatus;
  note?: string;           // e.g. "no folder links", the error message, "Option A"
};

// Folder names often already start with the sub-criterion number
// ("6.2 Management Review"); naive `${id} ${name}` doubled it
// ("6.2 6.2 Management Review"). Prefix the id only when it is missing.
export function fullAuditLabel(subCriterionId: string, folderName: string): string {
  const name = folderName.trim();
  return name.startsWith(subCriterionId) ? name : `${subCriterionId} ${name}`;
}

// Live progress of the full audit, rendered by the full-screen overlay.
export type FullAuditProgress = {
  status: "running" | "complete" | "cancelled";
  current: number;         // 1-based index of the sub-criterion being audited
  total: number;
  currentSubCriterionId: string;
  currentName: string;
  // One entry per planned sub-criterion, in run order, statuses updated live.
  entries: FullAuditEntry[];
  // One-line wrap-up shown when the run ends.
  summary?: string;
};
