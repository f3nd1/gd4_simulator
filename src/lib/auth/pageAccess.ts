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

// The configuration rows that CAN be locked, and the page each one belongs
// to. Whether a given one IS locked now lives in public.locked_stores and is
// read at runtime (lib/auth/storeLocks.ts) — this is the catalogue the
// People screen offers, not the state. No path here may be in
// NORMAL_USER_PATHS: a normal user who reached one of these screens could
// type an edit and have it silently refused, which is worse than not seeing
// the page. A test pins that.
export const LOCKABLE_STORES: Record<string, { path: string; what: string }> = {
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

// The rows a normal user writes in ordinary use, which is why they can never
// be locked. Refused by a CHECK CONSTRAINT on locked_stores rather than by a
// policy, so it binds everybody including an admin and including the Supabase
// dashboard: locking one would give every process owner a permanent sync
// error and break the one page they have.
//
// Shown on the People screen, collapsed, rather than left out. A control that
// is simply absent gets asked about later; one that says why it is absent
// does not.
export const NEVER_LOCKABLE: Record<string, string> = {
  "ucc-gd4-workspace:v3": "Every page writes this constantly, including the self-check",
  "ucc-gd4-checklist:v2": "Written on every page load, before anyone touches anything",
  "ucc-gd4-finding-drafts:v1": "Written on every page load, before anyone touches anything",
  "ucc-gd4-changelog:v1": "Written on every page load, before anyone touches anything",
  "ucc-gd4-checklist-verdicts:v1": "Written by a self-check run",
};

// What each never-lockable row belongs to, for the collapsed list.
export const NEVER_LOCKABLE_LABEL: Record<string, string> = {
  "ucc-gd4-workspace:v3": "The whole workspace: cycle, findings, evidence, self-check results",
  "ucc-gd4-checklist:v2": "Sub-Criterion Checklist lines",
  "ucc-gd4-finding-drafts:v1": "Grouped finding drafts",
  "ucc-gd4-changelog:v1": "The change log",
  "ucc-gd4-checklist-verdicts:v1": "Audit Checklist Library verdicts",
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

// What a given admin-only page actually gets RIGHT NOW: a database refusal,
// or only a hidden link. Takes the live lock set, because the answer changes
// the moment somebody toggles one; passing nothing means "not known yet",
// which the screen must say rather than guess.
export function protectionFor(path: string, lockedKeys?: ReadonlySet<string>): PageProtection | "unknown" {
  const keys = Object.entries(LOCKABLE_STORES).filter(([, v]) => v.path === path).map(([k]) => k);
  if (keys.length === 0) return "hidden-only";
  if (!lockedKeys) return "unknown";
  return keys.some((k) => lockedKeys.has(k)) ? "locked" : "hidden-only";
}

export const PROTECTION_LABEL: Record<PageProtection | "unknown", string> = {
  locked: "Locked at the database",
  "hidden-only": "Hidden only",
  unknown: "Checking…",
};

export const PROTECTION_MEANING: Record<PageProtection | "unknown", string> = {
  unknown: "The lock list could not be read, so this is not known. It is not a claim that the page is open.",
  locked: "A normal user cannot change this even with the page open in front of them. The database refuses the save.",
  "hidden-only": "The link is hidden and the address refuses, but the data behind it is still readable, and is written by the app for everyone.",
};

// Said once, at the top of the panel, because it is the thing most likely to
// be assumed wrong.
export const EVERYTHING_ELSE_NOTE =
  "Every other page in the workspace is admin-only too, including the audit stages. A process owner only ever needs the self-check.";

export const READ_CAVEAT =
  "Everyone who can sign in can read all of this data, whichever pages they can see. Hiding a page hides the page, never the data. That includes the OpenAI key, which cannot be hidden while a self-check has to use it.";
