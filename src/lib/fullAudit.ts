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

// Live progress of the full audit, rendered by the full-screen overlay.
export type FullAuditProgress = {
  status: "running" | "complete" | "cancelled";
  current: number;         // 1-based index of the sub-criterion being audited
  total: number;
  currentSubCriterionId: string;
  currentName: string;
  // Completion log, newest last: "✓ 1.1 Vision & Mission — done", …
  log: string[];
};
