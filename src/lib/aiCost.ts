// Shared USD cost-estimate convention — extracted from AIReview.tsx so any
// other surface needing a ballpark spend figure (e.g. the vision-budget
// blocking prompt) reuses the SAME per-model rates and $ formatting instead
// of inventing a second estimate that could disagree with the AI Review Log.

// Rough USD price per 1,000,000 tokens (input / output), matched by model-name
// prefix. These are ESTIMATES for a ballpark spend figure — adjust here if
// OpenAI's pricing changes. Order matters: more specific patterns first.
export const AI_PRICING: { match: RegExp; in: number; out: number }[] = [
  { match: /gpt-5-nano/, in: 0.05, out: 0.4 },
  { match: /gpt-5-mini/, in: 0.25, out: 2 },
  { match: /gpt-5/, in: 1.25, out: 10 },
  { match: /gpt-4o-mini/, in: 0.15, out: 0.6 },
  { match: /gpt-4o/, in: 2.5, out: 10 },
  { match: /gpt-4\.1-nano/, in: 0.1, out: 0.4 },
  { match: /gpt-4\.1-mini/, in: 0.4, out: 1.6 },
  { match: /gpt-4\.1/, in: 2, out: 8 },
  { match: /gpt-4-turbo/, in: 10, out: 30 },
];
export const AI_DEFAULT_RATE = { in: 0.5, out: 1.5 };

export function aiRateFor(model?: string) {
  if (!model) return AI_DEFAULT_RATE;
  return AI_PRICING.find((p) => p.match.test(model)) ?? AI_DEFAULT_RATE;
}

export function fmtUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
