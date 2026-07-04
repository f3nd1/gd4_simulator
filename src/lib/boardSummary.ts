// One-page Board/Chairman readiness summary — the stakeholder output the app
// lacked: score, award trajectory, gate status, criterion bands, top risks,
// findings counts, and the provenance a sceptical reader needs. Pure builder,
// unit-testable; the download trigger lives in Export Centre.

import type { Finding } from "../types";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";
import { provenanceLine, type RunProvenance } from "./provenance";

export type BoardSummaryInput = {
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date;
  total: number;
  award: string;
  gatePass: boolean;
  gateFailIds: string[];
  crits: Array<{ id: string; title: string; band: number }>;
  findings: Finding[];
  isClosed: (findingId: string) => boolean;
  provenance: RunProvenance;
};

export function buildBoardSummaryMd(input: BoardSummaryInput): string {
  const open = input.findings.filter((f) => !input.isClosed(f.id));
  const closed = input.findings.length - open.length;
  const majorNc = open.filter((f) => resolveFindingType(f) === "NC" && resolveNcSeverity(f) === "Major");
  const minorNc = open.filter((f) => resolveFindingType(f) === "NC" && resolveNcSeverity(f) === "Minor");
  const catAB = open.filter((f) => f.riskCategory === "A" || f.riskCategory === "B");
  // Top risks: regulatory (Cat A) first, then star-blocking (Cat B), then Major NCs.
  const topRisks = [...new Set([...catAB, ...majorNc])].slice(0, 5);

  const lines: string[] = [];
  lines.push(`# EduTrust Readiness — Board Summary`);
  lines.push("");
  lines.push(`**${input.cycleName}** · ${input.periodStart} to ${input.periodEnd} · generated ${input.generatedAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`);
  lines.push("");
  lines.push(`## Headline`);
  lines.push(`- Projected score: **${input.total} / 1000 — ${input.award}**`);
  lines.push(`- Score gate (4.2, 4.6, C5 at Band 3+): **${input.gatePass ? "MET" : `NOT MET (${input.gateFailIds.join(", ")})`}**`);
  lines.push(`- Findings: **${open.length} open** (${majorNc.length} Major NC · ${minorNc.length} Minor NC) · ${closed} closed`);
  lines.push("");
  lines.push(`## Criterion bands`);
  for (const c of input.crits) lines.push(`- C${c.id} ${c.title}: **Band ${c.band}**`);
  lines.push("");
  lines.push(`## Top risks${topRisks.length === 0 ? " — none open" : ""}`);
  for (const f of topRisks) {
    const sev = resolveNcSeverity(f);
    lines.push(`- **${f.gd4ItemId}** ${resolveFindingType(f)}${sev ? ` (${sev})` : ""}${f.riskCategory ? ` · Cat ${f.riskCategory}` : ""}: ${f.issue}`);
  }
  lines.push("");
  lines.push(`## Assessment coverage`);
  lines.push(provenanceLine(input.provenance));
  lines.push("");
  lines.push(`---`);
  lines.push(`_Internal readiness simulation prepared by the school's own audit workspace. Not an official SSG/EduTrust result._`);
  return lines.join("\n");
}
