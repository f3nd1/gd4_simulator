export type NavItem = { path: string; label: string; hint: string };
export type NavGroup = { group: string; step?: number; hint?: string; items: NavItem[] };

// IA overhaul (Batch 7): 5 numbered workflow stages that mirror the actual
// audit journey (Setup → Audit & Evidence → Fieldwork → Findings & Review →
// Close out), with diagnostic/log pages moved behind the developer-tools
// toggle (see DEVELOPER_TOOL_PATHS). Every route still exists — nothing was
// deleted — but a real user with dev tools off sees a ~19-item sidebar
// instead of 34. Each numbered group matches the Dashboard's
// "Getting started" stepper one-for-one, so a step number here always means
// the same thing there. The Help page derives its structure from this NAV.
export const NAV: NavGroup[] = [
  {
    group: "Home",
    items: [
      { path: "/", label: "Dashboard", hint: "Overall readiness, score, resume panel and the getting-started guide" },
      { path: "/analytics", label: "Data Dashboard", hint: "Charts across scores, bands, gates, findings and progress" },
      { path: "/help", label: "Help & Guide", hint: "What every page is and how to use it" },
      { path: "/draft-workspace", label: "Draft Workspace", hint: "Save/restore versions of the whole workspace, and download a JSON backup" },
    ],
  },
  {
    group: "1 · Setup",
    step: 1,
    hint: "Brief the AI on the school, then set up the audit cycle and the audit team before collecting any evidence.",
    items: [
      { path: "/profile-of-pei", label: "Profile of PEI", hint: "Structured PEI background: ERF/EduTrust status, key personnel, financials, courses, student & staff profiles — also used as AI audit context" },
      { path: "/audit-cycle", label: "Audit Cycle", hint: "Set the audit cycle dates and lifecycle status" },
      { path: "/auditors", label: "Auditor Creation", hint: "Add the auditors who will run this audit" },
      { path: "/gd4-library", label: "GD4 Library", hint: "Reference: the full GD4 requirement text" },
    ],
  },
  {
    group: "2 · Audit & Evidence",
    step: 2,
    hint: "Link each sub-criterion's Drive folders and run the audit — verdicts land on the Sub-Criterion Checklist.",
    items: [
      { path: "/start-audit", label: "Start Audit", hint: "Choose how much the AI does: Full auto, Hybrid (step by step) or Manual" },
      { path: "/evidence-folder", label: "Evidence Folder", hint: "Link folders and run audits per sub-criterion — the main audit surface" },
      { path: "/sub-checklist", label: "Sub-Criterion Checklist", hint: "Source of truth for scoring — break each item into testable lines and attach evidence" },
      { path: "/ppd-review", label: "PPD Requirements Review", hint: "Advanced (Option A, PPD-first): does the PPD document each GD4 requirement line, then a combined PPD-plus-evidence verdict with a compile-to-findings action" },
      { path: "/evidence-matrix", label: "Evidence Matrix", hint: "Superseded quick-rating view — the Sub-Criterion Checklist is the real scoring surface" },
    ],
  },
  {
    group: "3 · Fieldwork",
    step: 3,
    hint: "Pick samples and prepare interview questions to test the evidence.",
    items: [
      { path: "/sampling", label: "Sampling", hint: "Risk-based sample sizes per item" },
      { path: "/interview", label: "Interview", hint: "Interview question simulator" },
    ],
  },
  {
    group: "4 · Findings & Review",
    step: 4,
    hint: "Raise findings, review them, and decide closures with evidence.",
    items: [
      { path: "/findings", label: "Findings", hint: "Raise and track AFIs / quality actions" },
      { path: "/afi-closure", label: "Quality Action / AFI", hint: "Decide whether a finding can be closed, then confirm its effectiveness" },
      { path: "/re-audit", label: "Re-audit and Re-score", hint: "Re-check items that were below band or had closed findings" },
      { path: "/ai-review", label: "AI Review Log", hint: "Log of every AI review run, live or simulated" },
      { path: "/ai-debug", label: "AI Debug Log", hint: "Log of every buildSystemPrompt() call with module and the full prompt block (in-memory, cleared on reload)" },
      { path: "/human-decision-log", label: "Human Decision Log", hint: "Audit trail of every human override or acceptance of an AI output" },
      { path: "/human-review", label: "Human Review / Override", hint: "Confirm or override a band, with justification" },
    ],
  },
  {
    group: "5 · Close out",
    step: 5,
    hint: "Score, report, sign off, finalise and export — follow the stepper across these pages in order.",
    items: [
      { path: "/scorecard", label: "Criterion Scorecard", hint: "Official band per item, criterion and overall — closeout step 1" },
      { path: "/rubric-banding", label: "Rubric Banding", hint: "How coverage % and maturity ceiling produce each band" },
      { path: "/evidence-intelligence", label: "Evidence Intelligence", hint: "Ask an AI agent to explain/justify a score" },
      { path: "/final-report", label: "Final Report", hint: "Overall + per-item banding, strengths, AFIs and how to reach a higher band — closeout step 2" },
      { path: "/management-review", label: "Management Review", hint: "Leadership decisions needed before closeout — closeout step 3" },
      { path: "/finalisation", label: "Finalisation Checklist", hint: "Final checks before locking the audit — closeout step 4" },
      { path: "/export", label: "Export Centre", hint: "Export the finished audit pack — closeout step 5" },
    ],
  },
  {
    group: "Settings",
    items: [
      { path: "/settings", label: "Settings", hint: "Configure Supabase, OpenAI and Google Drive integrations" },
      { path: "/gd4-scoring-setup", label: "GD4 Scoring Setup", hint: "Tune scoring weights, award thresholds and criteria points" },
      { path: "/ai-memories", label: "AI Memories", hint: "Manage calibration memories used to guide AI audit outputs" },
      { path: "/ai-calibration", label: "AI Calibration", hint: "Benchmark the app's AI findings against UCC's real SSG assessment reports — caught / partially caught / missed per real AFI" },
      { path: "/change-log", label: "Change Log", hint: "History of every push/pull the app recorded, with a plain-English summary of what changed" },
    ],
  },
];

// ── Developer-tools visibility ───────────────────────────────────────────
// Diagnostic and superseded surfaces: visible by default (developer mode),
// hideable for real users via Settings → "Show developer tools". Pure
// helpers so the filtering and the route guard are unit-testable.
// Batch 7 widened this list from just /change-log to every log/diagnostic
// page plus the two dead-weight views (Evidence Matrix — superseded by the
// checklist; Human Review — a read-only mirror of the Scorecard).

export const DEFAULT_SHOW_DEVELOPER_TOOLS = true;
export const DEVELOPER_TOOL_PATHS = [
  "/change-log",
  "/ai-review",
  "/ai-debug",
  "/human-decision-log",
  "/human-review",
  "/evidence-matrix",
  // Measurement/benchmark tooling (Benchmark + Consistency + A vs B tabs) —
  // an advanced feature, gated with the other diagnostic surfaces.
  "/ai-calibration",
];

// NAV with developer-only entries removed when the toggle is off. Groups that
// end up empty are dropped entirely (no headerless stubs in the sidebar).
export function visibleNav(showDeveloperTools: boolean): NavGroup[] {
  if (showDeveloperTools) return NAV;
  return NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !DEVELOPER_TOOL_PATHS.includes(i.path)) }))
    .filter((g) => g.items.length > 0);
}

// Where a hidden developer route should send the user ("/" = dashboard), or
// null when the page is allowed to render.
export function devToolsRedirect(showDeveloperTools: boolean): string | null {
  return showDeveloperTools ? null : "/";
}
