// Pure helper for the PPD Requirements Review page's saved-state summary —
// extracted so "what does the saved run say" is unit-testable without the store.

import type { PPDReviewRow } from "../types";

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
