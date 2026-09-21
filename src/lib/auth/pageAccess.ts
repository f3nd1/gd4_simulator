// Which pages a normal user sees, and how honest the screen must be about
// what that does.
//
// READ THIS BEFORE CHANGING ANYTHING HERE: hiding a page is NOT protection.
// Measured on the real build, a normal user signing in and loading only the
// Dashboard reads ALL sixteen workspace rows, because the read policy is per
// table, not per row. Everything on this list is still readable by anyone on
// the sign-in list, whatever the sidebar shows them.
//
// What IS protection is the write lock: workspace_state is one row per store
// key, so writes can be refused per row in Postgres
// (public.is_admin_only_row, supabase/06-second-admin-and-locked-stores.sql).
// The two lists below say which pages get that and which only get hidden,
// and the People screen prints the difference rather than letting anybody
// assume a hidden page is a locked one.

export type PageProtection = "locked" | "hidden-only";

// Admin-only. A DENY-list rather than an allow-list would be wrong here: a
// page added later would silently become visible to everyone. This is the
// full set, and a new page is admin-only until it is deliberately left out.
export const ADMIN_ONLY_PATHS = [
  "/settings",
  "/gd4-scoring-setup",
  "/people",
  "/profile-of-pei",
  "/checklist-library",
  "/pre-check-setup",
  "/ai-calibration",
  "/prompt-review",
  "/ai-memories",
  "/change-log",
] as const;

// The rows Postgres refuses a normal user's write on, and the page each one
// belongs to. Every path here MUST also be in ADMIN_ONLY_PATHS: a normal user
// who reached one of these screens could type an edit and have it silently
// refused, which is worse than not seeing the page. A test pins that.
export const LOCKED_STORE_KEYS: Record<string, { path: string; what: string }> = {
  "ucc-gd4-ai-settings:v1":        { path: "/settings",           what: "The OpenAI key and model choices" },
  "ucc-gd4-google-drive:v1":       { path: "/settings",           what: "The Google Drive Client ID" },
  "ucc-gd4-scoring-config:v1":     { path: "/gd4-scoring-setup",  what: "Award thresholds and scoring weights" },
  "ucc-gd4-calibration:v1":        { path: "/ai-calibration",     what: "Benchmark match assessments" },
  "ucc-gd4-custom-benchmark:v1":   { path: "/ai-calibration",     what: "The benchmark AFI list" },
  "ucc-gd4-rule-tuning:v1":        { path: "/ai-calibration",     what: "Rule injections and champions" },
  "ucc-gd4-prompt-review:v1":      { path: "/prompt-review",      what: "Prompts and their review records" },
  "ucc-gd4-domain-checklist:v1":   { path: "/checklist-library",  what: "Edits to the criterion checklists the AI is given" },
  "ucc-gd4-precheck-checklist:v1": { path: "/pre-check-setup",    what: "The pre-analysis checklist items" },
  "profile-of-pei-v2":             { path: "/profile-of-pei",     what: "The PEI profile used as AI context" },
};

// The rows a normal user writes in ordinary use, which is why they are NOT
// locked. The first three are written on every page load with no action at
// all; the fourth is written by a self-check run. Locking any of them would
// give every normal user a permanent sync error for no gain.
export const NEVER_LOCKABLE: Record<string, string> = {
  "ucc-gd4-workspace:v3": "Written constantly by every page, including the self-check",
  "ucc-gd4-checklist:v2": "Written on every page load",
  "ucc-gd4-finding-drafts:v1": "Written on every page load",
  "ucc-gd4-changelog:v1": "Written on every page load",
  "ucc-gd4-checklist-verdicts:v1": "Written by a self-check run",
};

export function isAdminOnlyPath(path: string): boolean {
  return (ADMIN_ONLY_PATHS as readonly string[]).includes(path);
}

// What a given admin-only page actually gets: a database refusal, or only a
// hidden link. Shown per page on the People screen, in those words.
export function protectionFor(path: string): PageProtection {
  return Object.values(LOCKED_STORE_KEYS).some((v) => v.path === path) ? "locked" : "hidden-only";
}

export const PROTECTION_LABEL: Record<PageProtection, string> = {
  locked: "Locked at the database",
  "hidden-only": "Hidden only",
};

export const PROTECTION_MEANING: Record<PageProtection, string> = {
  locked: "A normal user cannot change this even with the page open in front of them. The database refuses the save.",
  "hidden-only": "The link is hidden and the address refuses, but the data behind it is still readable, and is written by the app for everyone.",
};

// Said once, at the top of the panel, because it is the thing most likely to
// be assumed wrong.
export const READ_CAVEAT =
  "Everyone who can sign in can read all of this data, whichever pages they can see. Hiding a page hides the page, never the data. That includes the OpenAI key, which cannot be hidden while a self-check has to use it.";
