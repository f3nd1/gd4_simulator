import type { SampleRecord, SampleRecordType } from "../types";

const TYPE_BY_CRITERION: Record<string, SampleRecordType> = {
  "1": "Academic",
  "2": "Staff",
  "3": "Academic",
  "4": "Student",
  "5": "Academic",
  "6": "QA",
  "7": "Financial",
};

// cycleId is a parameter rather than a literal so a sample records the
// cycle it was actually drawn in, and so this stays a pure, testable function.
export function generateSamples(items: { id: string; crit: string; title: string; ais: number; band: number; gate: boolean }[], cycleId: string): SampleRecord[] {
  const risky = items.filter((i) => i.band < 3 || i.gate).slice(0, 12);
  return risky.map((it, idx) => ({
    id: `SMP-${it.id}-${idx}`,
    auditCycleId: cycleId,
    gd4ItemId: it.id,
    recordType: TYPE_BY_CRITERION[it.crit] || "QA",
    reference: `${it.id} record set ${idx + 1}`,
    riskReason: it.gate ? "Gate-sensitive item" : `Evidence score ${it.ais}, below Band 3`,
    selected: true,
  }));
}
