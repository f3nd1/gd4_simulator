export type NavItem = { path: string; label: string };
export type NavGroup = { group: string; items: NavItem[] };

// Mirrors the 23-module list in the requirements guide, sections 6 and 9.1.
export const NAV: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      { path: "/", label: "Dashboard" },
      { path: "/draft-workspace", label: "Draft Workspace" },
      { path: "/audit-cycle", label: "Audit Cycle" },
      { path: "/auditors", label: "Auditor Creation" },
      { path: "/checklist", label: "Auditor Checklist" },
    ],
  },
  {
    group: "Evidence & Scoring",
    items: [
      { path: "/evidence-folder", label: "Evidence Folder" },
      { path: "/gd4-scoring-setup", label: "GD4 Scoring Setup" },
      { path: "/gd4-library", label: "GD4 Library" },
      { path: "/evidence-matrix", label: "Evidence Matrix" },
      { path: "/evidence-intelligence", label: "Evidence Intelligence" },
      { path: "/scorecard", label: "Criterion Scorecard" },
      { path: "/rubric-banding", label: "Rubric Banding" },
    ],
  },
  {
    group: "Testing",
    items: [
      { path: "/sampling", label: "Sampling" },
      { path: "/interview", label: "Interview" },
    ],
  },
  {
    group: "Findings & Review",
    items: [
      { path: "/findings", label: "Findings" },
      { path: "/afi-closure", label: "Quality Action / AFI" },
      { path: "/ai-review", label: "AI Agent Review" },
      { path: "/human-review", label: "Human Review / Override" },
      { path: "/re-audit", label: "Re-audit and Re-score" },
    ],
  },
  {
    group: "Closeout",
    items: [
      { path: "/version-history", label: "Version History" },
      { path: "/management-review", label: "Management Review" },
      { path: "/finalisation", label: "Finalisation Checklist" },
      { path: "/export", label: "Export Centre" },
    ],
  },
];
