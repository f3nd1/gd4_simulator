// Deterministic check that a finding's `criteria` field actually quotes the
// official GD4 requirement text it claims to quote. The finding-writer
// prompts demand "EXACT word-for-word" quoting, but for a long time nothing
// verified compliance — a paraphrased or invented "requirement" could reach
// the findings register, the one artifact that is supposed to carry the
// standard's own words. GD4 text is static data in this repo, so this is
// verifiable without any AI call.
//
// Rule: the criteria text is VERIFIED when it contains, verbatim (after
// whitespace/quote/case normalisation — the same tolerances the quote
// verifier uses), at least one of the official source texts the finding
// traces to (the checklist lines' GD4 sourceText, or the requirement text
// itself). Conservative on purpose: a paraphrase fails; per CLAUDE.md rule 4
// a false "verified" that hides a reworded requirement is worse than a
// false "unverified" the auditor double-checks.

function normalise(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Minimum length for an official text to count as evidence of quoting —
// matching a five-word fragment proves nothing.
const MIN_OFFICIAL_CHARS = 20;

export function criteriaQuotesRequirement(criteria: string, officialTexts: (string | undefined)[]): boolean {
  const crit = normalise(criteria);
  if (!crit) return false;
  for (const raw of officialTexts) {
    const official = raw ? normalise(raw) : "";
    if (official.length >= MIN_OFFICIAL_CHARS && crit.includes(official)) return true;
  }
  return false;
}
