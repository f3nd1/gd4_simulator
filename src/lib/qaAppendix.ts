// Internal-QA appendix export: the evidence that a real quality system sat
// behind these results — human oversight of AI output (decision log), the AI
// run log (what ran, live vs simulated), and closure evidence per finding.
// This is exactly what an SSG assessor probes when shown internal audit
// results. Pure builder; Export Centre triggers the download.

import type { AIReviewLogEntry, Finding, HumanDecisionEntry } from "../types";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";

export type QaClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted" };

export type QaAppendixInput = {
  cycleName: string;
  generatedAt: Date;
  humanDecisionLog: HumanDecisionEntry[];
  aiReviewLog: AIReviewLogEntry[];
  findings: Finding[];
  closures: Record<string, QaClosureLite>;
};

export function buildQaAppendixMd(input: QaAppendixInput): string {
  const lines: string[] = [];
  lines.push(`# Internal QA Appendix — ${input.cycleName}`);
  lines.push("");
  lines.push(`Generated ${input.generatedAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}. This appendix evidences the human oversight applied to AI-assisted assessment: every AI run is logged, every human acceptance/override of AI output is recorded, and finding closures carry their evidence.`);
  lines.push("");

  // ── Human oversight ────────────────────────────────────────────────────────
  const byType: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  for (const d of input.humanDecisionLog) {
    byType[d.decisionType] = (byType[d.decisionType] ?? 0) + 1;
    byModule[d.module] = (byModule[d.module] ?? 0) + 1;
  }
  lines.push(`## Human oversight of AI output (${input.humanDecisionLog.length} recorded decisions)`);
  lines.push(`By decision: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}`);
  lines.push(`By module: ${Object.entries(byModule).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}`);
  lines.push("");
  const recent = input.humanDecisionLog.slice(0, 15);
  if (recent.length) {
    lines.push(`Most recent (${recent.length}):`);
    for (const d of recent) {
      lines.push(`- ${new Date(d.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${d.module} · ${d.subjectId} · **${d.decisionType}**${d.reason ? ` — ${d.reason}` : ""}`);
    }
    lines.push("");
  }

  // ── AI run log ────────────────────────────────────────────────────────────
  const live = input.aiReviewLog.filter((e) => e.live).length;
  const failed = input.aiReviewLog.filter((e) => e.liveError).length;
  const tokens = input.aiReviewLog.reduce((n, e) => n + (e.totalTokens ?? 0), 0);
  const models = [...new Set(input.aiReviewLog.map((e) => e.model).filter(Boolean))] as string[];
  lines.push(`## AI run log (${input.aiReviewLog.length} runs retained)`);
  lines.push(`${live} live AI · ${input.aiReviewLog.length - live} simulated/offline · ${failed} with errors · ${tokens.toLocaleString()} tokens${models.length ? ` · models: ${models.join(", ")}` : ""}`);
  lines.push("");

  // ── Closure evidence ──────────────────────────────────────────────────────
  const closedWithEvidence = input.findings.filter((f) => {
    const c = input.closures[f.id];
    return c?.human === "Accepted" && !!c?.evid?.trim();
  });
  lines.push(`## Finding closures with evidence (${closedWithEvidence.length})`);
  for (const f of closedWithEvidence) {
    const c = input.closures[f.id]!;
    const sev = resolveNcSeverity(f);
    lines.push(`- **${f.id}** (${f.gd4ItemId}, ${resolveFindingType(f)}${sev ? ` ${sev}` : ""}) ${f.issue}`);
    if (c.root) lines.push(`  - Root cause: ${c.root}`);
    if (c.corr) lines.push(`  - Corrective: ${c.corr}`);
    lines.push(`  - Closure evidence: ${c.evid}`);
  }
  if (closedWithEvidence.length === 0) lines.push(`(No findings closed with evidence yet.)`);
  lines.push("");
  lines.push(`---`);
  lines.push(`_Internal simulation records. Logs are retention-capped (AI runs 200, decisions 500); older entries roll off._`);
  return lines.join("\n");
}
