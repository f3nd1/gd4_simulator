// Builds the read-only Final Report: overall + per-criterion + per-item
// banding, strengths, AFIs/gaps, and a deterministic "how to reach a higher
// band" analysis derived from the same checklist banding the score uses, plus
// the findings register with closure (root cause / corrective action) detail.
import type { Scored } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, GenericChecklistLine, SpecificChecklistLine } from "../types";
import { computeBand, lineSufficiency } from "./checklistBanding";
import { GD4_REQUIREMENTS } from "./../data/gd4Requirements";

export type ClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted"; aiNeed?: string };

export type ItemReport = {
  id: string;
  title: string;
  gate: boolean;
  band: number;
  started: boolean;
  hasChecklist: boolean;
  coveragePct: number;
  maturityCeiling: number;
  strengths: string[];
  gaps: string[];
  targetBand: number;
  howToImprove: string[];
};

export type FindingReport = {
  id: string;
  itemId: string;
  issue: string;
  severity: string;
  type: string;
  status: string;
  closed: boolean;
  rootCause?: string;
  corrective?: string;
  preventive?: string;
  closureEvidence?: string;
  stillNeeded?: string;
};

export type FinalReport = {
  overall: { total: number; award: string; gatePass: boolean; gateFail: string[]; openAFIs: number };
  crits: { id: string; title: string; band: number; scored: number; points: number; started: boolean }[];
  items: ItemReport[];
  findings: FindingReport[];
};

const COVERAGE_THRESHOLD: Record<number, number> = { 2: 0, 3: 50, 4: 70, 5: 85 };

function lineLabel(l: SpecificChecklistLine): string {
  return l.clause ? `${l.clause}: ${l.text}` : l.text;
}

function brief(items: string[], n = 4): string {
  return items.length > n ? `${items.slice(0, n).join("; ")}; +${items.length - n} more` : items.join("; ");
}

function analyseItem(
  id: string,
  title: string,
  gate: boolean,
  band: number,
  started: boolean,
  entry: SubCriterionChecklistEntry | undefined
): ItemReport {
  const generic: GenericChecklistLine[] = entry?.generic || [];
  const specific: SpecificChecklistLine[] = entry?.specific || [];
  const hasChecklist = specific.length > 0;
  const r = computeBand(generic, specific, gate);
  const graded = specific.filter((l) => l.status !== "Not Applicable");

  const strengths = graded
    .filter((l) => l.status === "Met" && lineSufficiency(l) === "Present")
    .map((l) => lineLabel(l));

  const notMet = graded.filter((l) => l.status !== "Met");
  const missingEv = graded.filter((l) => lineSufficiency(l) === "Missing");
  const gaps: string[] = [
    ...notMet.map((l) => `${lineLabel(l)} — ${l.status || "Not started"}`),
    ...missingEv.filter((l) => l.status === "Met").map((l) => `${lineLabel(l)} — marked Met but evidence is missing`),
  ];

  const targetBand = Math.min(band + 1, 5);
  const howToImprove: string[] = [];
  if (!hasChecklist) {
    howToImprove.push("Generate the Sub-Criterion Checklist for this item (run the Evidence Folder audit, or generate it on the Sub-Criterion Checklist page), then attach evidence.");
  } else if (band >= 5) {
    howToImprove.push("Already at Band 5 — keep evidence current and the review cadence going to hold it.");
  } else {
    if (r.evidenceCapped && r.evidenceCapWarning) howToImprove.push(r.evidenceCapWarning);
    const need = COVERAGE_THRESHOLD[targetBand] ?? 85;
    if (r.coverageCap < targetBand && notMet.length) {
      howToImprove.push(`Raise coverage from ${Math.round(r.coveragePct)}% to ≥${need}% for Band ${targetBand}: move these line(s) to Met — ${brief(notMet.map(lineLabel))}.`);
    }
    if (r.maturityCeiling < targetBand) {
      const lensId = `G${targetBand - 1}`;
      const lens = generic.find((g) => g.id === lensId)?.lens;
      howToImprove.push(`Demonstrate higher maturity: mark generic lens ${lensId}${lens ? ` (${lens})` : ""} as Met with evidence.`);
    }
    if (missingEv.length) howToImprove.push(`Attach or strengthen evidence on: ${brief(missingEv.map(lineLabel))}.`);
    if (howToImprove.length === 0) howToImprove.push(`Sustain current evidence and aim coverage toward ≥${need}% to consolidate Band ${targetBand}.`);
  }

  return {
    id,
    title,
    gate,
    band,
    started,
    hasChecklist,
    coveragePct: Math.round(r.coveragePct),
    maturityCeiling: r.maturityCeiling,
    strengths,
    gaps,
    targetBand,
    howToImprove,
  };
}

export function buildFinalReport(
  scored: Scored,
  entries: Record<string, SubCriterionChecklistEntry>,
  findings: Finding[],
  closures: Record<string, ClosureLite>
): FinalReport {
  const items = scored.items.map((it) => analyseItem(it.id, it.title, it.gate, it.band, it.started, entries[it.id]));

  const crits = scored.crits.map((c) => ({ id: c.id, title: c.title, band: c.band, scored: c.scored, points: c.points, started: c.started }));

  const findingReports: FindingReport[] = findings.map((f) => {
    const c = closures[f.id] || {};
    const reqTitle = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.requirement;
    return {
      id: f.id,
      itemId: f.gd4ItemId + (reqTitle ? ` ${reqTitle}` : ""),
      issue: f.issue,
      severity: f.severity,
      type: f.type,
      status: f.status,
      closed: (c.human || "") === "Accepted",
      rootCause: c.root,
      corrective: c.corr,
      preventive: c.prev,
      closureEvidence: c.evid,
      stillNeeded: c.aiNeed,
    };
  });

  return {
    overall: {
      total: scored.total,
      award: scored.award,
      gatePass: scored.gatePass,
      gateFail: scored.gateFail.map((g) => g.id),
      openAFIs: scored.openAFIs,
    },
    crits,
    items,
    findings: findingReports,
  };
}
