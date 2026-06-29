// AI-powered grouped finding writer.
// Consumes a ChecklistLineGroup (from findingGrouper.ts) and returns a fully
// populated GroupedFindingWriterResult for one finding draft.
// The live path calls OpenAI; the simulate path uses deterministic heuristics
// for offline/no-key use. Both return the same shape.

import type { ChecklistLineGroup, GD4Requirement, AISettings } from "../../types";
import { chatComplete, type AIUsage } from "./aiClient";
import { lineSufficiency, lineApsr } from "../checklistBanding";
import { buildEvidenceStatusSummary } from "../findingGrouper";
import { buildSystemPrompt, buildDomainBlock } from "./skills";
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
  promptSent?: string;
};


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
      const apsrParts = [`  APSR: Approach=${apsr.approach.status}, Processes=${apsr.processes.status}, Systems & Outcomes=${apsr.systemsOutcomes.status}, Review=${apsr.review.status}`];
      if (apsr.approach.note) apsrParts.push(`  Approach note: ${apsr.approach.note}`);
      if (apsr.processes.note) apsrParts.push(`  Processes note: ${apsr.processes.note}`);
      if (apsr.systemsOutcomes.note) apsrParts.push(`  Systems & Outcomes note: ${apsr.systemsOutcomes.note}`);
      if (apsr.review.note) apsrParts.push(`  Review note: ${apsr.review.note}`);
      parts.push(...apsrParts);
    }
    // Include evidence item names/descriptions so the AI can reference specific records
    if (l.evidence.length > 0) {
      parts.push(`  Evidence items (${l.evidence.length}):`);
      l.evidence.slice(0, 6).forEach((ev, ei) => {
        const desc = [ev.title ?? "", ev.sufficiency ? `[${ev.sufficiency}]` : ""].filter(Boolean).join(" ");
        parts.push(`    ${ei + 1}. ${desc || "(unnamed item)"}`);
      });
      if (l.evidence.length > 6) parts.push(`    … and ${l.evidence.length - 6} more`);
    } else {
      parts.push(`  Evidence items: none attached`);
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

  // Build line-specific rootCause using actual checklist text from failing lines
  const notMetLines = group.lines.filter((l) => l.status === "Not met");
  const partialLines = group.lines.filter((l) => l.status === "Partial");
  const primaryLine = notMetLines[0] ?? partialLines[0] ?? group.lines[0];
  const primaryLineText = primaryLine?.text ?? `the ${dim.toLowerCase()} requirement`;
  const missingEvidence = primaryLine?.evidence.length === 0;

  const rootCause = missingEvidence
    ? `No evidence records were found for "${primaryLineText}" under ${itemRef}. The ${dim.toLowerCase()} requirement has not been implemented or the records have not been maintained in a retrievable location. No systematic mechanism exists in the management cycle to detect and remediate this gap.`
    : `The evidence for "${primaryLineText}" under ${itemRef} is incomplete or insufficient. The ${dim.toLowerCase()} practice may occur in isolation but is not consistently documented, reviewed, or tracked — so it cannot be verified or sustained across audit periods.`;

  const corrective = notMetLines.length > 0
    ? `Within 30 days, create and formally approve the missing ${dim.toLowerCase()} records for: ${notMetLines.slice(0, 3).map((l) => `"${l.text?.slice(0, 80) ?? "checklist point"}"`).join("; ")}${notMetLines.length > 3 ? ` and ${notMetLines.length - 3} more` : ""}. File them against the affected GD4 references (${refs}).`
    : `Strengthen and supplement the partial evidence for the ${lineCount} checklist point${lineCount > 1 ? "s" : ""} under ${refs}. Replace any weak records with complete, dated, and approved documentation covering the full period.`;

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
  const domainBlock = buildDomainBlock(domainSkill);

  const systemPrompt =
    `You are a GD4 EduTrust internal audit expert. Your task is to write one structured finding draft based on a group of failing checklist lines from an audit. You MUST base everything on the checklist evidence provided — do NOT invent or assume information that is not in the lines. For the root cause: apply 5-Why methodology — reach the systemic Level 3 root cause (a governance, training, data-collection, or review gap), not the symptom. For the criteria section: quote the GD4 requirement text EXACTLY, word-for-word — do not paraphrase or summarise it. Also cite the exact regulatory provision (Act, clause, or SSG instrument) in addition to the GD4 item number. For the effect section: name the specific band ceiling with a concrete Band 4–5 benchmark so the institution knows what "fixed" looks like. Where the checklist lines mention a sample, express the gap as a rate (N of M). Flag any evidence-timeliness issues visible in the line notes (recently created documents, short coverage periods).` +
    buildSystemPrompt("findingWriter", null, "runLiveGroupedFindingWriter") +
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
  "criteria": "EXACT word-for-word quote of what GD4 requires — copy the requirement text verbatim from the GD4 item, do NOT paraphrase or summarise. Include the item number and the exact regulatory clause or SSG instrument.",
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
    promptSent: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
  };
}
