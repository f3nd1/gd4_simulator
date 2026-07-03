// Pure filtering for the Settings model pickers — extracted so the behaviour
// that decides which model ids appear in the dropdown is unit-testable.

// Show the full list when the field is empty or already holds an exact
// suggestion (the user is browsing, not narrowing); otherwise filter to ids
// containing the typed text, case-insensitively.
export function filterModelSuggestions(suggestions: string[], value: string): string[] {
  const v = value.trim().toLowerCase();
  if (!v || suggestions.some((m) => m.toLowerCase() === v)) return suggestions;
  return suggestions.filter((m) => m.toLowerCase().includes(v));
}
