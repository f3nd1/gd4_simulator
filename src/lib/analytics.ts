// Aggregates everything the Data Dashboard and the Final Report's visual
// summary chart from: scores/bands, gate groups, findings, checklist line
// status, and evidence/audit progress. Pure — derived from existing state.
import type { Scored } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, EvidenceFolder } from "../types";

export type Analytics = {
  total: number;
  award: string;
  gatePass: boolean;
  itemsByBand: number[]; // index 0 = not started, 1..5 = band counts
  bandByCriterion: { id: string; title: string; band: number }[];
  gates: { id: string; avgBand: number; pass: boolean }[];
  findingsBySeverity: { label: string; value: number }[];
  findingsOpen: number;
  findingsClosed: number;
  progress: { foldersTotal: number; foldersLinked: number; foldersAudited: number; itemsTotal: number; itemsWithChecklist: number; itemsScored: number };
  lineStatus: { met: number; partial: number; notMet: number; na: number; notStarted: number };
};

function avgBand(scored: Scored, pred: (i: Scored["items"][number]) => boolean): number {
  const g = scored.items.filter(pred);
  if (!g.length) return 0;
  return Math.round((g.reduce((a, i) => a + i.band, 0) / g.length) * 10) / 10;
}

export function buildAnalytics(
  scored: Scored,
  entries: Record<string, SubCriterionChecklistEntry>,
  findings: Finding[],
  folders: EvidenceFolder[],
  closures: Record<string, { human?: "" | "Accepted" }>
): Analytics {
  const itemsByBand = [0, 0, 0, 0, 0, 0];
  for (const it of scored.items) {
    if (!it.started) itemsByBand[0]++;
    else itemsByBand[Math.max(1, Math.min(5, it.band))]++;
  }

  const sev = { Critical: 0, High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  let findingsClosed = 0;
  for (const f of findings) {
    sev[f.severity] = (sev[f.severity] || 0) + 1;
    if ((closures[f.id]?.human || "") === "Accepted") findingsClosed++;
  }

  const lineStatus = { met: 0, partial: 0, notMet: 0, na: 0, notStarted: 0 };
  let itemsWithChecklist = 0;
  for (const e of Object.values(entries)) {
    if (e.specific.length > 0) itemsWithChecklist++;
    for (const l of e.specific) {
      if (l.status === "Met") lineStatus.met++;
      else if (l.status === "Partial") lineStatus.partial++;
      else if (l.status === "Not Applicable") lineStatus.na++;
      else if (l.status === "Not met") lineStatus.notMet++;
      else lineStatus.notStarted++;
    }
  }

  const hasLink = (f: EvidenceFolder) => !!(f.folderLink?.trim() || f.policyLink?.trim());

  return {
    total: scored.total,
    award: scored.award,
    gatePass: scored.gatePass,
    itemsByBand,
    bandByCriterion: scored.crits.map((c) => ({ id: c.id, title: c.title, band: c.band })),
    gates: [
      { id: "Sub-criterion 4.2", avgBand: avgBand(scored, (i) => i.subCriterionId === "4.2"), pass: avgBand(scored, (i) => i.subCriterionId === "4.2") >= 3 },
      { id: "Sub-criterion 4.6", avgBand: avgBand(scored, (i) => i.subCriterionId === "4.6"), pass: avgBand(scored, (i) => i.subCriterionId === "4.6") >= 3 },
      { id: "Criterion 5", avgBand: avgBand(scored, (i) => i.crit === "5"), pass: avgBand(scored, (i) => i.crit === "5") >= 3 },
    ],
    findingsBySeverity: [
      { label: "Critical", value: sev.Critical || 0 },
      { label: "High", value: sev.High || 0 },
      { label: "Medium", value: sev.Medium || 0 },
      { label: "Low", value: sev.Low || 0 },
    ],
    findingsOpen: findings.length - findingsClosed,
    findingsClosed,
    progress: {
      foldersTotal: folders.length,
      foldersLinked: folders.filter(hasLink).length,
      foldersAudited: folders.filter((f) => f.lastAuditAt).length,
      itemsTotal: scored.items.length,
      itemsWithChecklist,
      itemsScored: scored.items.filter((i) => i.started).length,
    },
    lineStatus,
  };
}
