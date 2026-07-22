export type NavItem = { path: string; label: string; hint: string };
// A group's `items` are the ordered core steps (numbered when `step` is set);
// `tools` is an optional, visually demoted "Tools & reference" tail of
// side/reference/diagnostic pages that are NOT part of the numbered path.
export type NavGroup = { group: string; step?: number; hint?: string; items: NavItem[]; tools?: NavItem[] };

// "Journey" IA (Option A): each numbered stage lists its CORE steps in the
// recommended order in `items`, with optional/reference/diagnostic pages
// demoted to a `tools` tail. The numbers are guidance, not a gate — every
// page stays clickable at any time (the sidebar never disables a step).
// Home and Settings are un-numbered anchors at the top and bottom.
// Diagnostic/log pages remain in `tools` AND in DEVELOPER_TOOL_PATHS, so they
// only appear when the developer-tools toggle is on. The Dashboard's
// "Getting started" stepper still keys off the four numbered stages, and the
// Help page derives its structure from this NAV (items + tools).
export const NAV: NavGroup[] = [
  {
    group: "Home",
    items: [
      { path: "/", label: "Dashboard", hint: "Overall readiness, score, resume panel and the getting-started guide" },
      { path: "/draft-workspace", label: "Draft Workspace", hint: "Save/restore versions of the whole workspace, and download a JSON backup" },
    ],
    tools: [
      { path: "/analytics", label: "Data Dashboard", hint: "Charts across scores, bands, gates, findings and progress" },
      { path: "/help", label: "Help & Guide", hint: "What every page is and how to use it" },
    ],
  },
  {
    group: "1 · Set up",
    step: 1,
    hint: "Brief the AI on the school, then set up the audit cycle and the audit team before collecting any evidence.",
    items: [
      { path: "/profile-of-pei", label: "Profile of PEI", hint: "Structured PEI background: ERF/EduTrust status, key personnel, financials, courses, student & staff profiles — also used as AI audit context" },
      { path: "/audit-cycle", label: "Audit Cycle", hint: "Set the audit cycle dates and lifecycle status" },
      { path: "/auditors", label: "Auditor Creation", hint: "Add the auditors who will run this audit" },
    ],
    tools: [
      { path: "/gd4-library", label: "GD4 Library", hint: "Reference: the full GD4 requirement text" },
      { path: "/pre-check-setup", label: "Pre-check Checklist Setup", hint: "Add/edit/remove the pre-analysis checklist items shown during a run's Pre-check step, per GD4 item" },
    ],
  },
  {
    group: "2 · Audit & evidence",
    step: 2,
    hint: "Link each sub-criterion's Drive folders and run the audit — verdicts land on the Sub-Criterion Checklist.",
    items: [
      { path: "/start-audit", label: "Start Audit", hint: "Choose how much the AI does: Full auto, Hybrid (step by step) or Manual" },
      { path: "/evidence-folder", label: "Evidence Folder", hint: "Link folders and run audits per sub-criterion — the main audit surface" },
      { path: "/sub-checklist", label: "Sub-Criterion Checklist", hint: "Source of truth for scoring — break each item into testable lines and attach evidence" },
    ],
    tools: [
      { path: "/sampling", label: "Sampling", hint: "Risk-based sample sizes per item — pick samples to test the evidence" },
      { path: "/interview", label: "Interview", hint: "Interview question simulator — prepare questions to test the evidence" },
      { path: "/evidence-intelligence", label: "Evidence Intelligence", hint: "Per-item evidence-quality checks (evidence age, owner, traceability, gate, drive link) computed from your data — deterministic, no AI call" },
    ],
  },
  {
    group: "3 · Findings & review",
    step: 3,
    hint: "Raise findings, review them, and decide closures with evidence.",
    items: [
      { path: "/findings", label: "Findings", hint: "Raise and track AFIs / quality actions" },
      { path: "/clarification", label: "Clarification round", hint: "After adding evidence, batch re-check several open findings at once and track each round" },
      { path: "/afi-closure", label: "Quality Action / AFI", hint: "Decide whether a finding can be closed, then confirm its effectiveness" },
    ],
    tools: [
      { path: "/ai-review", label: "AI Review Log", hint: "Log of every AI review run, live or simulated" },
      { path: "/ai-debug", label: "AI Debug Log", hint: "Log of every buildSystemPrompt() call with module and the full prompt block (in-memory, cleared on reload)" },
      { path: "/human-decision-log", label: "Human Decision Log", hint: "Audit trail of every human override or acceptance of an AI output" },
      { path: "/run-log", label: "Run Log", hint: "What an automated run (Full Auto sweep or Hybrid per-item draft) actually did — steps taken, skipped, and bands set" },
    ],
  },
  {
    group: "4 · Close out",
    step: 4,
    hint: "Score, report, sign off, finalise and export — follow the stepper across these pages in order.",
    items: [
      { path: "/scorecard", label: "Criterion Scorecard", hint: "Official band per item, criterion and overall — closeout step 1" },
      { path: "/final-report", label: "Final Report", hint: "Overall + per-item banding, strengths, AFIs and how to reach a higher band — closeout step 2" },
      { path: "/finalisation", label: "Finalisation Checklist", hint: "Final checks before locking the audit — closeout step 3" },
      { path: "/export", label: "Export Centre", hint: "Export the finished audit pack — closeout step 4" },
    ],
    tools: [
      { path: "/rubric-banding", label: "Rubric Banding", hint: "Reference: the official EduTrust §23 band rubric and each item's applied band" },
    ],
  },
  {
    group: "Settings",
    items: [
      { path: "/settings", label: "Settings", hint: "Configure Supabase, OpenAI and Google Drive integrations" },
      { path: "/gd4-scoring-setup", label: "GD4 Scoring Setup", hint: "Tune scoring weights, award thresholds and criteria points" },
    ],
    tools: [
      { path: "/ai-memories", label: "AI Memories", hint: "Manage calibration memories used to guide AI audit outputs" },
      { path: "/ai-calibration", label: "AI Calibration", hint: "Benchmark the app's AI findings against UCC's real SSG assessment reports — caught / partially caught / missed per real AFI" },
      { path: "/prompt-review", label: "Prompt Review", hint: "Review an AI output, rate it, and — if it's weak — have the AI improve the instruction (prompt) behind it, with human sign-off before it goes live" },
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
  "/run-log",
  // Measurement/benchmark tooling (Benchmark + Consistency + A vs B tabs) —
  // an advanced feature, gated with the other diagnostic surfaces.
  "/ai-calibration",
];

// NAV with developer-only entries removed when the toggle is off. Filters
// BOTH the core steps and the tools tail. Groups that end up with no items
// and no tools are dropped entirely (no headerless stubs in the sidebar).
export function visibleNav(showDeveloperTools: boolean): NavGroup[] {
  if (showDeveloperTools) return NAV;
  const keep = (i: NavItem) => !DEVELOPER_TOOL_PATHS.includes(i.path);
  return NAV
    .map((g) => ({ ...g, items: g.items.filter(keep), tools: g.tools?.filter(keep) }))
    .filter((g) => g.items.length > 0 || (g.tools?.length ?? 0) > 0);
}

// Where a hidden developer route should send the user ("/" = dashboard), or
// null when the page is allowed to render.
export function devToolsRedirect(showDeveloperTools: boolean): string | null {
  return showDeveloperTools ? null : "/";
}
