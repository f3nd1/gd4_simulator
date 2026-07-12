// Run provenance for the surfaces people act on and screenshot (Scorecard,
// Final Report, exports): what was assessed, when, by which model(s), with
// what coverage, and how much of it was offline-estimated. Pure and
// store-free so the summary line is unit-testable.

export type ProvenanceItem = { started: boolean; checklistOverride?: unknown };
export type ProvenanceFolder = {
  lastAuditAt?: string;
  lastAuditLive?: boolean;
  lastAuditAuditor?: string;
};

export type RunProvenance = {
  assessedItems: number;   // GD4 items with a real band signal
  totalItems: number;
  auditedSubCriteria: number; // evidence folders with at least one audit run
  totalSubCriteria: number;
  earliestAuditAt?: string; // ISO of the oldest folder audit
  latestAuditAt?: string;   // ISO of the newest folder audit
  offlineSubCriteria: number; // folders whose last audit was the offline estimate
  models: string[];         // distinct model ids seen in the AI log (newest first)
  auditors: string[];       // distinct attributed auditors
};

export function buildProvenance(
  items: ProvenanceItem[],
  folders: ProvenanceFolder[],
  modelIds: Array<string | undefined>,
): RunProvenance {
  const audited = folders.filter((f) => !!f.lastAuditAt);
  const auditTimes = audited.map((f) => f.lastAuditAt!).sort();
  const models = [...new Set(modelIds.filter((m): m is string => !!m))];
  const auditors: string[] = [];
  for (const f of audited) {
    const a = (f.lastAuditAuditor ?? "").replace(/\s*\(.*\)$/, "").trim();
    if (a && a !== "Unassigned" && !auditors.includes(a)) auditors.push(a);
  }
  return {
    assessedItems: items.filter((i) => i.started || i.checklistOverride).length,
    totalItems: items.length,
    auditedSubCriteria: audited.length,
    totalSubCriteria: folders.length,
    earliestAuditAt: auditTimes[0],
    latestAuditAt: auditTimes[auditTimes.length - 1],
    offlineSubCriteria: audited.filter((f) => f.lastAuditLive === false).length,
    models: models.slice(0, 3),
    auditors: auditors.slice(0, 4),
  };
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

// One line a sceptical reader can check the numbers against:
// "Assessed 28 of 31 items · 18 of 23 sub-criteria audited (28 Jun – 04 Jul 2026)
//  · 2 offline-estimate · model gpt-5-mini · auditor Rachel Tan"
export function provenanceLine(p: RunProvenance): string {
  const parts: string[] = [];
  parts.push(`Assessed ${p.assessedItems} of ${p.totalItems} GD4 items`);
  if (p.totalSubCriteria > 0) {
    const range = p.latestAuditAt
      ? p.earliestAuditAt && shortDate(p.earliestAuditAt) !== shortDate(p.latestAuditAt)
        ? ` (${shortDate(p.earliestAuditAt)} – ${shortDate(p.latestAuditAt)})`
        : ` (${shortDate(p.latestAuditAt)})`
      : "";
    parts.push(`${p.auditedSubCriteria} of ${p.totalSubCriteria} sub-criteria audited${range}`);
  }
  if (p.offlineSubCriteria > 0) parts.push(`⚠ ${p.offlineSubCriteria} offline-estimate (no AI)`);
  if (p.models.length) parts.push(`model ${p.models.join(", ")}`);
  if (p.auditors.length) parts.push(`auditor ${p.auditors.join(", ")}`);
  return parts.join(" · ");
}
