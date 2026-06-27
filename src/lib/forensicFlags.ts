import type { SubCriterionChecklistEntry } from "../types";

export type ForensicFlagType = "date-cluster" | "out-of-period";

export type ForensicFlag = {
  type: ForensicFlagType;
  severity: "High" | "Medium";
  description: string;
  affectedItems: string[];
};

// Scan all checklist evidence dates for clustering (≥50% within a 30-day
// window) or out-of-period dates. Both patterns are suspicious in an EduTrust
// audit because they suggest bulk document creation or records from outside
// the claimed audit period.
export function detectForensicFlags(
  checklistEntries: Record<string, SubCriterionChecklistEntry>,
  periodStart: string,
  periodEnd: string
): ForensicFlag[] {
  const flags: ForensicFlag[] = [];

  // Gather all evidence item dates across all items + lines
  const allDates: { date: string; itemId: string }[] = [];
  for (const [itemId, entry] of Object.entries(checklistEntries)) {
    for (const line of entry.specific) {
      for (const ev of line.evidence) {
        if (ev.date?.trim()) allDates.push({ date: ev.date.trim(), itemId });
      }
    }
  }

  if (allDates.length >= 3) {
    // Sliding 30-day window: find the window that contains the most dates
    const sorted = [...allDates].sort((a, b) => a.date.localeCompare(b.date));
    let maxInWindow: typeof sorted = [];
    for (let i = 0; i < sorted.length; i++) {
      const startMs = new Date(sorted[i].date).getTime();
      if (isNaN(startMs)) continue;
      const endMs = startMs + 30 * 24 * 60 * 60 * 1000;
      const inWindow = sorted.filter((d) => {
        const ms = new Date(d.date).getTime();
        return !isNaN(ms) && ms >= startMs && ms <= endMs;
      });
      if (inWindow.length > maxInWindow.length) maxInWindow = inWindow;
    }
    const pct = (maxInWindow.length / sorted.length) * 100;
    if (pct >= 50 && maxInWindow.length >= 3) {
      const windowStart = maxInWindow[0].date;
      const windowEnd = maxInWindow[maxInWindow.length - 1].date;
      flags.push({
        type: "date-cluster",
        severity: pct >= 70 ? "High" : "Medium",
        description: `${Math.round(pct)}% of evidence items (${maxInWindow.length}/${sorted.length}) are dated within a 30-day window (${windowStart} → ${windowEnd}). This may indicate bulk document creation rather than ongoing records. Verify dates reflect actual activity.`,
        affectedItems: [...new Set(maxInWindow.map((d) => d.itemId))],
      });
    }
  }

  // Out-of-period evidence
  if (periodStart && periodEnd && allDates.length > 0) {
    const pStartMs = new Date(periodStart).getTime();
    const pEndMs = new Date(periodEnd).getTime();
    const outOfPeriod = allDates.filter((d) => {
      const ms = new Date(d.date).getTime();
      return !isNaN(ms) && (ms < pStartMs || ms > pEndMs);
    });
    if (outOfPeriod.length > 0) {
      const affectedItems = [...new Set(outOfPeriod.map((d) => d.itemId))];
      flags.push({
        type: "out-of-period",
        severity: "Medium",
        description: `${outOfPeriod.length} evidence item(s) across ${affectedItems.length} sub-criterion/criteria have dates outside the audit cycle period (${periodStart} → ${periodEnd}). Out-of-period evidence may not be accepted by EduTrust assessors.`,
        affectedItems,
      });
    }
  }

  return flags;
}
