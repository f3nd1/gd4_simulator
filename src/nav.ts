export type NavItem = { path: string; label: string; hint: string };
export type NavGroup = { group: string; step?: number; hint?: string; items: NavItem[] };

// Reorganized into the order an auditor actually works through a GD4 audit
// cycle, rather than the original flat 23-module list grouping. Each
// numbered group (1-6) is one stage of that workflow and matches the
// "Getting started" stepper on the Dashboard one-for-one, so a step number
// here always means the same thing there.
export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { path: "/", label: "Dashboard", hint: "Overall readiness, score and the getting-started guide" },
      { path: "/analytics", label: "Data Dashboard", hint: "Charts across scores, bands, gates, findings and progress" },
      { path: "/help", label: "Help & Guide", hint: "What every page is and how to use it" },
      { path: "/draft-workspace", label: "Draft Workspace", hint: "Save/restore versions of the whole workspace" },
    ],
  },
  {
    group: "1 · Setup",
    step: 1,
    hint: "Brief the AI on the school, then set up the audit cycle, the audit team, and the GD4 rubric reference before collecting any evidence.",
    items: [
      { path: "/profile-of-pei", label: "Profile of PEI", hint: "Structured PEI background: ERF/EduTrust status, key personnel, financials, courses, student & staff profiles — also used as AI audit context" },
      { path: "/audit-cycle", label: "Audit Cycle", hint: "Set the audit cycle dates and lifecycle status" },
      { path: "/auditors", label: "Auditor Creation", hint: "Add the auditors who will run this audit" },
      { path: "/gd4-scoring-setup", label: "GD4 Scoring Setup", hint: "Confirm scoring weights and criteria points" },
      { path: "/gd4-library", label: "GD4 Library", hint: "Reference: the full GD4 requirement text" },
    ],
  },
  {
    group: "2 · Evidence",
    step: 2,
    hint: "Attach evidence for each GD4 item — the Sub-Criterion Checklist is the recommended way to do this properly.",
    items: [
      { path: "/evidence-folder", label: "Evidence Folder", hint: "Index of evidence folders per sub-criterion" },
      { path: "/sub-checklist", label: "Sub-Criterion Checklist", hint: "Source of truth for scoring — break each item into testable lines and attach evidence" },
      { path: "/evidence-matrix", label: "Evidence Matrix", hint: "Quick first-draft rating only — not a substitute for the checklist" },
    ],
  },
  {
    group: "3 · Scoring",
    step: 3,
    hint: "See the band each item lands on, and ask the AI for an explanation of why.",
    items: [
      { path: "/scorecard", label: "Criterion Scorecard", hint: "Official band per item, criterion and overall" },
      { path: "/rubric-banding", label: "Rubric Banding", hint: "How coverage % and maturity ceiling produce each band" },
      { path: "/evidence-intelligence", label: "Evidence Intelligence", hint: "Ask an AI agent to explain/justify a score" },
    ],
  },
  {
    group: "4 · Testing & Sampling",
    step: 4,
    hint: "Pick samples and prepare interview questions to test the evidence.",
    items: [
      { path: "/sampling", label: "Sampling", hint: "Risk-based sample sizes per item" },
      { path: "/interview", label: "Interview", hint: "Interview question simulator" },
    ],
  },
  {
    group: "5 · Findings & Review",
    step: 5,
    hint: "Raise findings, decide closures, and have a human confirm or override the AI/auto score.",
    items: [
      { path: "/findings", label: "Findings", hint: "Raise and track AFIs / quality actions" },
      { path: "/afi-closure", label: "Quality Action / AFI", hint: "Decide whether a finding can be closed" },
      { path: "/ai-review", label: "AI Review Log", hint: "Log of every AI review run, live or simulated" },
      { path: "/ai-debug", label: "AI Debug Log", hint: "Dev-only log of every buildSystemPrompt() call with module and prompt snippet" },
      { path: "/human-review", label: "Human Review / Override", hint: "Confirm or override a band, with justification" },
      { path: "/re-audit", label: "Re-audit and Re-score", hint: "Re-check items that were below band or had closed findings" },
    ],
  },
  {
    group: "6 · Closeout",
    step: 6,
    hint: "Wrap up: management sign-off, final checks, then export the audit pack.",
    items: [
      { path: "/final-report", label: "Final Report", hint: "Overall + per-item banding, strengths, AFIs and how to reach a higher band" },
      { path: "/management-review", label: "Management Review", hint: "Leadership decisions needed before closeout" },
      { path: "/finalisation", label: "Finalisation Checklist", hint: "Final checks before locking the audit" },
      { path: "/export", label: "Export Centre", hint: "Export the finished audit pack" },
    ],
  },
  {
    group: "Settings",
    items: [{ path: "/settings", label: "Settings", hint: "Configure Supabase, OpenAI and Google Drive integrations" }],
  },
];
