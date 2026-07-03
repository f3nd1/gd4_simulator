// Pure helpers for the PPD Requirements Review page's sub-criterion selection
// and saved-state summary — extracted so the "which sub-criterion do we show,
// and what does its saved run say" logic is unit-testable without the store.

import type { PPDReviewResult, PPDReviewRow } from "../types";

// Which sub-criterion the PPD page should show. The URL ?item= wins (a shared
// link / an Evidence-Folder "Run review" click); otherwise fall back to the
// last one the user viewed (persisted), otherwise the most recently RUN
// sub-criterion that has saved results — so returning to the page via the
// bare sidebar link shows the last work instead of a blank slate. "" only
// when nothing has ever been reviewed and no param is present.
export function resolvePpdSelection(
  paramItem: string | null,
  lastViewed: string | null,
  results: Record<string, PPDReviewResult>
): string {
  if (paramItem) return paramItem;
  if (lastViewed && (results[lastViewed] || lastViewed)) return lastViewed;
  return mostRecentlyRunSubCriterion(results);
}

// The sub-criterion whose saved PPD run is newest (by runAt), or "" if none.
export function mostRecentlyRunSubCriterion(results: Record<string, PPDReviewResult>): string {
  let bestId = "";
  let bestAt = "";
  for (const [id, r] of Object.entries(results)) {
    const at = r.runAt ?? "";
    if (!bestId || at > bestAt) { bestId = id; bestAt = at; }
  }
  return bestId;
}

// Counts for the "Last reviewed … · N adequate / N partial / N gaps" summary.
export function ppdResultSummary(rows: PPDReviewRow[] | undefined): {
  adequate: number; partial: number; gaps: number; notAssessed: number; total: number;
} {
  const r = rows ?? [];
  return {
    adequate: r.filter((x) => x.verdict === "Adequate").length,
    partial: r.filter((x) => x.verdict === "Partial").length,
    gaps: r.filter((x) => x.verdict === "Not documented").length,
    notAssessed: r.filter((x) => x.verdict === "Not assessed").length,
    total: r.length,
  };
}
