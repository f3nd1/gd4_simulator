// Derives a short, plain-English description of what changed from a raw git
// commit message, for the Change Log's "Summary" column. This is a best-effort
// heuristic — it strips conventional-commit noise, expands a few common
// abbreviations, and phrases the result as an action. When the message is
// empty it returns a neutral placeholder; otherwise the transformed first line
// always beats showing nothing, so there is no failure path that loses info.

// Common conventional-commit prefixes ("feat:", "fix(scope):", "chore!:" …).
const PREFIX_RE = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?!?:\s*/i;

// Abbreviation → full form, applied as whole-word replacements so "config"
// inside "configuration" is left alone. Keys are lower-cased; the replacement
// preserves the original first-letter casing of the match.
const ABBREVIATIONS: Record<string, string> = {
  repo: "repository",
  config: "configuration",
  auth: "authentication",
  ui: "interface",
  docs: "documentation",
  deps: "dependencies",
  dep: "dependency",
  env: "environment",
  btn: "button",
  msg: "message",
  nav: "navigation",
};

function expandAbbreviations(text: string): string {
  return text.replace(/\b([A-Za-z]+)\b/g, (word) => {
    const full = ABBREVIATIONS[word.toLowerCase()];
    if (!full) return word;
    // Preserve leading capital (start of sentence / proper-ish position).
    return word[0] === word[0].toUpperCase() ? full[0].toUpperCase() + full.slice(1) : full;
  });
}

// Verbs commit messages usually start with, imperative → past-tense so the
// summary reads as "what changed" rather than an instruction.
const VERB_PAST: Record<string, string> = {
  add: "Added",
  fix: "Fixed",
  remove: "Removed",
  delete: "Deleted",
  update: "Updated",
  refactor: "Refactored",
  simplify: "Simplified",
  detect: "Added detection for",
  wire: "Wired up",
  move: "Moved",
  rename: "Renamed",
  restructure: "Restructured",
  improve: "Improved",
  change: "Changed",
  make: "Made",
  create: "Created",
  build: "Built",
  support: "Added support for",
  prevent: "Prevented",
  handle: "Now handles",
  show: "Now shows",
  hide: "Now hides",
  allow: "Now allows",
};

export function summariseCommitMessage(message: string): string {
  const firstLine = (message || "").split("\n")[0].trim();
  if (!firstLine) return "No commit message recorded.";

  let text = firstLine.replace(PREFIX_RE, "").trim();
  if (!text) return firstLine;

  // Turn a leading imperative verb into past tense so it reads as a change.
  const words = text.split(/\s+/);
  const firstWordLower = words[0].toLowerCase();
  const past = VERB_PAST[firstWordLower];
  if (past) {
    text = [past, ...words.slice(1)].join(" ");
  } else {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  text = expandAbbreviations(text);
  return text;
}
