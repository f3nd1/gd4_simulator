// Builds the read-only Final Report: overall + per-criterion + per-item
// banding, strengths, AFIs/gaps, and a deterministic "how to reach a higher
// band" analysis derived from the same checklist banding the score uses, plus
// the findings register with closure (root cause / corrective action) detail.
import type { Scored } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine } from "../types";
import { lineSufficiency, lineCompleteness, needsReassessment, bandEvidenceAdvisories, type LineCompleteness } from "./checklistBanding";
import { bandTitle } from "../data/edutrustRubric";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";
import { GD4_REQUIREMENTS } from "./../data/gd4Requirements";

export type ClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted"; aiNeed?: string };

export type ItemReport = {
  id: string;
  title: string;
  gate: boolean;
  band: number;
  started: boolean;
  hasChecklist: boolean;
  // Requirement-line completeness — evidence context, not a band input.
  completeness: LineCompleteness;
  // True when the item has old-model checklist data but no holistic band yet
  // — its band needs re-assessment under the official §23 rubric.
  needsReassessment: boolean;
  // The reviewer's recorded justifications, carried wherever the band shows:
  // why this band (mandatory at selection), and — when their own APSR working
  // disagreed by ≥1 band — why the official judgment differs from it.
  bandRationale?: string;
  bandMismatchReason?: string;
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
  const specific: SpecificChecklistLine[] = entry?.specific || [];
  const hasChecklist = specific.length > 0;
  const completeness = lineCompleteness(specific);
  const reassess = entry ? needsReassessment(entry) : false;
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

  // The band is a holistic judgment (official §23 rubric) — improvement
  // advice points at the evidence gaps and the target band's official
  // descriptors, never at a coverage-% formula (the retired engine's model).
  const targetBand = Math.min(band + 1, 5);
  const howToImprove: string[] = [];
  if (!hasChecklist) {
    howToImprove.push("Generate the Sub-Criterion Checklist for this item (run the Evidence Folder audit, or generate it on the Sub-Criterion Checklist page), then attach evidence and set its holistic band.");
  } else if (reassess) {
    howToImprove.push("Re-assess this item's band under the official EduTrust §23 rubric: open the Sub-Criterion Checklist and select the band level whose four dimension descriptors best fit the evidence.");
  } else if (band >= 5) {
    howToImprove.push("Already at Band 5 — keep evidence current and the review cadence going to hold it.");
  } else {
    const hb = entry?.holisticBand;
    if (hb) howToImprove.push(...bandEvidenceAdvisories(specific, hb.band));
    if (notMet.length) howToImprove.push(`Close the requirement-line gaps: ${brief(notMet.map(lineLabel))}.`);
    if (missingEv.length) howToImprove.push(`Attach or strengthen evidence on: ${brief(missingEv.map(lineLabel))}.`);
    howToImprove.push(`Then compare the evidence against the official ${bandTitle(targetBand as 1 | 2 | 3 | 4 | 5)} descriptors on the Sub-Criterion Checklist and re-judge the band.`);
  }

  return {
    id,
    title,
    gate,
    band,
    started,
    hasChecklist,
    completeness,
    needsReassessment: reassess,
    bandRationale: entry?.holisticBand?.rationale,
    bandMismatchReason: entry?.holisticBand?.mismatchReason,
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
      // Resolved NC/OFI/OBS classification (which applyPanelConclusion updates),
      // not the raw legacy fields — the report must agree with the Findings
      // register and Export Centre, both of which already resolve.
      severity: resolveNcSeverity(f) ?? f.severity,
      type: resolveFindingType(f),
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
