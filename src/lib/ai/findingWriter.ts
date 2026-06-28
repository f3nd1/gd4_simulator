// AI-powered grouped finding writer.
// Consumes a ChecklistLineGroup (from findingGrouper.ts) and returns a fully
// populated GroupedFindingWriterResult for one finding draft.
// The live path calls OpenAI; the simulate path uses deterministic heuristics
// for offline/no-key use. Both return the same shape.

import type { ChecklistLineGroup, GD4Requirement, AISettings } from "../../types";
import { chatComplete, type AIUsage } from "./aiClient";
import { lineSufficiency, lineApsr } from "../checklistBanding";
import { buildEvidenceStatusSummary } from "../findingGrouper";
import apsrRubricSkill from "../../data/skills/apsr-rubric.md?raw";
import findingSpecificitySkill from "../../data/skills/finding-specificity.md?raw";
import findingWritingSkill from "../../data/skills/finding-writing.md?raw";
import evidenceStandardsSkill from "../../data/skills/evidence-standards.md?raw";
import { domainExpertiseFor } from "../../data/skills/domainExpertise";

export type GroupedFindingWriterResult = {
  title: string;
  observation: string;
  criteria: string;
  effect: string;
  rootCause: string;
  corrective: string;
  preventive: string;
  apsrBullets: {
    approach: string[];
    processes: string[];
    systemsOutcomes: string[];
    review: string[];
  };
  evidenceStatusSummary: string;
  live: boolean;
  usage?: AIUsage;
};

// Private skill-injection helper (mirrors the private `skills()` in agentRuntime.ts —
// not exported there, so we duplicate the ~4-line function here).
const SKILL_CAP = 3000;
function skills(...docs: string[]): string {
  const content = docs.map((d) => d.trim().slice(0, SKILL_CAP)).join("\n\n---\n\n");
  return content ? `\n\n## Auditor knowledge base (apply this expertise to your assessment)\n\n${content}` : "";
}

// Extracts the first valid JSON object from a potentially noisy model reply.
function extractFirstJSON(text: string): Record<string, unknown> {
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (text[i] === "}") { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { start = -1; } } }
  }
  return {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function strArr(v: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length > 0 ? out : fallback;
}

// Build a concise context block from the group lines for the prompt.
function buildGroupContext(group: ChecklistLineGroup): string {
  const lineBlocks = group.lines.map((l, i) => {
    const apsr = lineApsr(l);
    const suf = lineSufficiency(l);
    const parts: string[] = [
      `Line ${i + 1}: ${l.text ?? "(no text)"}`,
      `  Status: ${l.status}`,
      `  Evidence sufficiency: ${suf}`,
    ];
    if (l.sourceRef) parts.push(`  GD4 ref: ${l.sourceRef}`);
    if (l.sourceText) parts.push(`  GD4 text: ${l.sourceText}`);
    if (apsr) {
      parts.push(`  APSR: Approach=${apsr.approach.status}, Processes=${apsr.processes.status}, Systems & Outcomes=${apsr.systemsOutcomes.status}, Review=${apsr.review.status}`);
    }
    return parts.join("\n");
  }).join("\n\n");

  return [
    `Gap type: ${group.gapType}`,
    `Primary APSR dimension: ${group.primaryApsrDimension}`,
    `Severity: ${group.severity}`,
    `Risk category: ${group.riskCategory}`,
    `Source refs: ${group.sourceRefs.join(", ") || "(none)"}`,
    `\nFailing checklist lines (${group.lines.length}):\n`,
    lineBlocks,
  ].join("\n");
}

// Offline / no-key simulation — deterministic, no AI call.
export function simulateGroupedFindingWriter(
  group: ChecklistLineGroup,
  req: GD4Requirement
): GroupedFindingWriterResult {
  const itemRef = req.itemNumber ?? req.subCriterionId;
  const gapLabel = group.gapType.replace("/", " / ");
  const lineCount = group.lines.length;
  const refs = group.sourceRefs.join(", ") || `${itemRef}`;
  const dim = group.primaryApsrDimension;

  const title = `GD4 ${itemRef} — ${gapLabel} gap${lineCount > 1 ? ` across ${lineCount} checklist points` : ""}`;

  const observationParts: string[] = [];
  if (group.lines.length > 0) {
    const notMet = group.lines.filter((l) => l.status === "Not met");
    const partial = group.lines.filter((l) => l.status === "Partial");
    if (notMet.length > 0) observationParts.push(`${notMet.length} of ${lineCount} checklist point${lineCount > 1 ? "s" : ""} rated 'Not met'`);
    if (partial.length > 0) observationParts.push(`${partial.length} rated 'Partial'`);
    const firstLine = group.lines[0];
    if (firstLine?.sourceText) observationParts.push(`under ${refs}: "${firstLine.sourceText.slice(0, 200)}"`);
  }
  const observation = observationParts.length > 0
    ? `Auditor review identified: ${observationParts.join("; ")}.`
    : `Checklist review identified a ${gapLabel} gap under ${refs}.`;

  const criteria = group.sourceTexts.length > 0
    ? `GD4 ${itemRef} requires: "${group.sourceTexts[0].slice(0, 300)}"`
    : `GD4 ${itemRef} requires documented ${dim.toLowerCase()} evidence for this criterion.`;

  const severityNote = req.gateSensitive
    ? "This is a mandatory gate requirement; non-compliance cannot be offset by other criteria."
    : "Under the APSR rubric, a gap in the primary dimension caps this sub-criterion and may prevent a Band 3 or above outcome.";
  const effect = `${severityNote} The identified gap in ${gapLabel} will limit the institution's EduTrust band for sub-criterion ${req.subCriterionId}.`;

  const rootCause = `The ${dim.toLowerCase()} requirement under ${itemRef} has not been fully established or evidenced. No systematic mechanism ensures this gap is detected and remediated within the management cycle.`;

  const corrective = `Produce and file the missing ${gapLabel} evidence for the affected checklist points (${refs}) within 30 days. For 'Not met' points, create the required ${dim.toLowerCase()} documentation and have it formally approved.`;

  const preventive = `Add a standing agenda item to the Management Review to verify ${dim.toLowerCase()} compliance for this requirement each semester. Assign a named owner responsible for maintaining and updating the required documentation.`;

  // APSR bullets — one per dimension based on what lines tell us
  const apsrBullets = {
    approach: [`Beginning / ${dim === "Approach" ? "Required approach documentation is absent or incomplete" : "Documented approach was provided"} / Gap: ${gapLabel} / Evidence: checklist review / Action: draft and approve required documentation`],
    processes: [`${dim === "Processes" ? "Weak" : "Deployed"} / ${dim === "Processes" ? "Process records are absent or insufficient" : "Process records were provided"} / Gap: ${gapLabel} / Evidence: checklist review / Action: establish records and verification mechanism`],
    systemsOutcomes: [`${dim === "Systems & Outcomes" ? "Limited" : "Evident"} / ${dim === "Systems & Outcomes" ? "Outcome data is not collected or analysed" : "Outcome data was sighted"} / Gap: ${gapLabel} / Evidence: checklist review / Action: implement outcome data collection`],
    review: [`${dim === "Review" ? "Not evident" : "Evident"} / ${dim === "Review" ? "No formal review of this area was evidenced" : "Review activity was sighted"} / Gap: ${gapLabel} / Evidence: checklist review / Action: schedule regular management review of this requirement`],
  };

  return {
    title,
    observation,
    criteria,
    effect,
    rootCause,
    corrective,
    preventive,
    apsrBullets,
    evidenceStatusSummary: buildEvidenceStatusSummary(group.lines),
    live: false,
  };
}

// Live AI path — calls OpenAI to produce a fully-formed finding draft.
export async function runLiveGroupedFindingWriter(
  group: ChecklistLineGroup,
  req: GD4Requirement,
  settings: AISettings,
  opts?: { onUsage?: (u: AIUsage) => void }
): Promise<GroupedFindingWriterResult> {
  const itemRef = req.itemNumber ?? req.subCriterionId;
  const groupContext = buildGroupContext(group);
  const evidenceSummary = buildEvidenceStatusSummary(group.lines);

  // Specialist domain knowledge for this finding's criterion, so the finding's
  // root cause, corrective and preventive actions are written with the depth of
  // an auditor who specialises in that area rather than generic advice.
  const domainSkill = domainExpertiseFor(req.subCriterionId ?? req.itemNumber);
  const domainBlock = domainSkill
    ? `\n\n## Specialist domain expertise for this criterion\n\nWrite this finding with the precision of the specialist below — use its specific cross-checks, regulatory points and red flags so the observation, root cause and corrective/preventive actions are concrete and domain-accurate, not generic.\n\n${domainSkill.trim()}`
    : "";

  const systemPrompt =
    `You are a GD4 EduTrust internal audit expert. Your task is to write one structured finding draft based on a group of failing checklist lines from an audit. You MUST base everything on the checklist evidence provided — do NOT invent or assume information that is not in the lines.` +
    skills(apsrRubricSkill, evidenceStandardsSkill, findingSpecificitySkill, findingWritingSkill) +
    domainBlock;

  const userPrompt = `
Write a structured finding draft for the following group of failing checklist lines.

## Sub-criterion context
Sub-criterion: ${req.subCriterionId} — ${req.area ?? ""}
GD4 item: ${itemRef}
Gate-sensitive: ${req.gateSensitive ? "Yes (mandatory — non-compliance cannot be offset)" : "No"}

## Failing lines
${groupContext}

## Evidence status
${evidenceSummary}

Return ONLY a JSON object with these exact keys:
{
  "title": "GD4 [item] — [Gap in plain English]",
  "observation": "What the auditor found (WHO/WHAT/WHEN/HOW MANY — be specific, cite checklist refs)",
  "criteria": "What GD4 requires (quote or closely paraphrase, include the item number)",
  "effect": "Why the gap matters (regulatory/band consequence, name the APSR dimension cap)",
  "rootCause": "System root cause — ask why 3 times, write level 3",
  "corrective": "Time-bound, verifiable action to fix the specific gap now",
  "preventive": "Process/system change to prevent recurrence",
  "apsrBullets": {
    "approach": ["Rating / What was found / Gap / Evidence / Improvement needed"],
    "processes": ["Rating / What was found / Gap / Evidence / Improvement needed"],
    "systemsOutcomes": ["Rating / What was found / Gap / Evidence / Improvement needed"],
    "review": ["Rating / What was found / Gap / Evidence / Improvement needed"]
  }
}

Each apsrBullets array may contain 1–3 bullet strings. Do not add extra keys.
`.trim();

  let rawContent: string;
  let usage: AIUsage | undefined;
  try {
    rawContent = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      settings,
      {
        temperature: 0.25,
        onUsage: (u) => {
          usage = u;
          opts?.onUsage?.(u);
        },
      }
    );
  } catch (err) {
    // Fall back to simulation on any AI error so the draft pipeline never stalls.
    const sim = simulateGroupedFindingWriter(group, req);
    return { ...sim, live: false };
  }

  const parsed = extractFirstJSON(rawContent);

  const fallback = simulateGroupedFindingWriter(group, req);
  const apsrRaw = parsed.apsrBullets && typeof parsed.apsrBullets === "object" ? parsed.apsrBullets as Record<string, unknown> : {};

  return {
    title:       str(parsed.title,       fallback.title),
    observation: str(parsed.observation, fallback.observation),
    criteria:    str(parsed.criteria,    fallback.criteria),
    effect:      str(parsed.effect,      fallback.effect),
    rootCause:   str(parsed.rootCause,   fallback.rootCause),
    corrective:  str(parsed.corrective,  fallback.corrective),
    preventive:  str(parsed.preventive,  fallback.preventive),
    apsrBullets: {
      approach:       strArr(apsrRaw.approach,       fallback.apsrBullets.approach),
      processes:      strArr(apsrRaw.processes,      fallback.apsrBullets.processes),
      systemsOutcomes:strArr(apsrRaw.systemsOutcomes,fallback.apsrBullets.systemsOutcomes),
      review:         strArr(apsrRaw.review,          fallback.apsrBullets.review),
    },
    evidenceStatusSummary: buildEvidenceStatusSummary(group.lines),
    live: true,
    usage,
  };
}
