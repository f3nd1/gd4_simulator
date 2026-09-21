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

// What a normal user may open. An ALLOW-list, and a very short one: normal
// users are only ever process owners, and the self-check is the whole reason
// they were given the address. Everything else in the workspace is the audit
// lead's.
//
// An allow-list rather than a deny-list because a page added later must
// default to CLOSED. A deny-list would quietly expose every new page to
// everyone until somebody remembered to add it.
//
// /self-check renders outside the workspace Layout on purpose, so a process
// owner never meets the audit chrome. That is also the seam the guard uses:
// Layout refuses for everyone who is not an admin, which is why this list
// does not have to name the thirty pages it is protecting.
export const NORMAL_USER_PATHS = ["/self-check"] as const;

// Where a process owner lands. Signing in puts everyone on "/", and sending
// them to a refusal there would be a wall on their first screen.
export const NORMAL_USER_HOME = "/self-check";

// The rows Postgres refuses a normal user's write on, and the page each one
// belongs to. No path here may be in NORMAL_USER_PATHS: a normal user
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
  return !(NORMAL_USER_PATHS as readonly string[]).includes(path);
}

// The admin-only pages worth naming on screen: the configuration ones, whose
// protection differs page by page. Everything else in the workspace is also
// admin-only now, which the panel says in one line rather than listing thirty
// rows nobody reads.
export const NOTABLE_ADMIN_PATHS = [
  "/settings",
  "/gd4-scoring-setup",
  "/profile-of-pei",
  "/checklist-library",
  "/pre-check-setup",
  "/ai-calibration",
  "/prompt-review",
  "/people",
  "/ai-memories",
  "/change-log",
] as const;

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
export const EVERYTHING_ELSE_NOTE =
  "Every other page in the workspace is admin-only too, including the audit stages. A process owner only ever needs the self-check.";

export const READ_CAVEAT =
  "Everyone who can sign in can read all of this data, whichever pages they can see. Hiding a page hides the page, never the data. That includes the OpenAI key, which cannot be hidden while a self-check has to use it.";
