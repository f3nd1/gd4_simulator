// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, Confidence, GD4Requirement, ApsrBreakdown, GeneratedChecklistLine, FlatAuditPoint, PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, StagedCoverageStatus, PPDVerdict, PPDReviewRow, EvidenceVerdict, PPDSubClause, PPDPromise, PPDContradiction, PromiseCheck } from "../../types";
import { chatComplete, AIClientError, addUsage, verdictTemp, type AIUsage } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";
import { deriveApsrStatus, apsrReason } from "./simulateAI";
import { buildSystemPrompt, buildDomainBlock, type SkillCalibrationExample, type SkillCalibrationMemory } from "./skills";
import { domainExpertiseFor } from "../../data/skills/domainExpertise";
import type { AuditorProfile, PanelAuditorReview, PanelCallLog, PanelReviewPosition, PanelReviewResult, PanelSynthesis } from "../../types";
import { perspectiveOf, perspectiveLabel, perspectiveGuidance, detectPanelDisagreement } from "../reviewPanel";
import { normalizeAuditRef } from "../gd4Refs";

export { AIClientError };

// Extracts the first valid JSON object from a model response (which may have
// preamble text before the object). Uses a non-greedy scan over brace depth
// to avoid the greedy-regex problem of matching the outermost { to the last }
// when the response contains multiple objects.
function extractFirstJSONObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJSONObject(text: string, requiredKeys?: string[]): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (requiredKeys && requiredKeys.some((k) => !(k in v))) return null;
        return v as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    return null;
  };
  return tryParse(text) ?? (extractFirstJSONObject(text) ? tryParse(extractFirstJSONObject(text)!) : null) ?? {};
}

export async function runLiveItemReview(
  agent: AgentDefinition,
  item: { id: string; eff: number; band: number; checklistOverride: boolean },
  ev: ItemEvidence,
  settings: AISettings
): Promise<Omit<SimulatedItemVerdict, "live"> & { live: true; usage?: AIUsage }> {
  const itemDomainSkill = domainExpertiseFor(item.id);
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.${buildSystemPrompt("bandRecommend", null, "runLiveItemReview", item.id, itemDomainSkill)}${buildDomainBlock(itemDomainSkill)}`;
  const user = `Item ${item.id}. Fixed evidence score: ${item.eff}/100, fixed band: ${item.band} (source: ${item.checklistOverride ? "Sub-Criterion Checklist outcome" : "evidence matrix quick rating"}). Evidence: approach=${ev.approach}, processes=${ev.processes}, systemsOutcomes=${ev.systemsOutcomes}, review=${ev.review}, traceability=${ev.trace}%, evidence age=${ev.age} days, owner=${ev.owner || "(unassigned)"}, Drive evidence link=${ev.drive ? ev.drive : "MISSING — no link has been provided"}.`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { onUsage: (u) => { usage = u; } }
  );
  const parsed = parseJSONObject(content, ["justification", "higherBand", "confidence"]);

  return {
    score: item.eff,
    band: item.band,
    confidence: (parsed.confidence as Confidence) || "Medium",
    justification: (parsed.justification as string) || content,
    higherBand: (parsed.higherBand as string) || "Add or strengthen the weakest evidence limb and re-run this review.",
    by: agent.name,
    live: true,
    usage,
  };
}

function extractFirstJSONArray(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "]") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJSONArray(text: string): unknown[] {
  const tryArr = (s: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as Record<string, unknown>).lines)) return (parsed as Record<string, unknown>).lines as unknown[];
    } catch {
      // fall through
    }
    return null;
  };
  return tryArr(text) ?? (extractFirstJSONArray(text) ? tryArr(extractFirstJSONArray(text)!) : null) ?? [];
}

// Result type for runLiveChecklistGeneration — valid lines plus a count of
// any AI-proposed lines that were rejected for lacking source traceability.
export type ChecklistGenerationResult = {
  lines: GeneratedChecklistLine[];
  rejectedCount: number;
  rejectedIdeas?: { text: string; reason: string }[];
  promptSent?: string;
};

// Converts a GD4 item's official text into traceable, testable checklist lines.
// The prompt is strict: the model must not invent requirements beyond the
// official Describe/Show, Notes and Expected Evidence supplied; every line must
// cite its exact GD4 source point so it can be displayed and validated.
// Lines returned by the model without a sourceText are rejected automatically
// (counted in rejectedCount) so invented lines never reach the checklist.
export async function runLiveChecklistGeneration(
  req: GD4Requirement,
  settings: AISettings,
  onUsage?: (u: AIUsage) => void
): Promise<ChecklistGenerationResult> {
  const VALID_SOURCE_TYPES: GeneratedChecklistLine["sourceType"][] = ["describeShow", "note", "expectedEvidence", "requirement", "intent"];
  const VALID_APSR: GeneratedChecklistLine["apsrDimension"][] = ["Approach", "Processes", "Systems & Outcomes", "Review"];

  const system = `You are converting official GD4 EduTrust item text into traceable, testable audit checklist lines. You are NOT creating a new audit checklist from scratch. Every line you generate MUST be directly supported by one official source point provided in the prompt, identified by its ref (e.g. "1.1.1.DS1.a"). If you cannot point to the exact source point, do not create the line.

STRICT RULES — violations cause your output to be discarded:
1. Do NOT invent requirements that do not appear in the official source points provided.
2. Do NOT add generic internal-audit checks (e.g. "check if the process is effective").
3. Do NOT add "good practice" items unless those exact words appear in the official GD4 wording.
4. Do NOT infer extra requirements from PEI context or your general knowledge.
5. The text field of each checklist line must use the exact wording from the source point — word for word. Do NOT rephrase, summarise, or rewrite. Copy the source text directly into the text field. The only permitted prefix is "Verify that:" or "Confirm evidence of:" when it aids clarity, but the remainder must be verbatim source text.
6. Avoid creating multiple nearly-identical lines for the same source point; one clear line per source point.
7. The sourceRef must be the exact ref string from the source point (e.g. "1.1.1.DS1.a"). The sourceText must contain verbatim text from that source point. Empty sourceText or sourceRef invalidates the line.

APSR dimension classification:
- Approach: documented policy, procedure, plan, framework, method, responsibility, workflow
- Processes: implementation records, logs, forms, screenshots, registers, actual use of the process
- Systems & Outcomes: results, KPIs, trends, targets, outcomes, performance data, analysis
- Review: review records, minutes, evaluation, improvement actions, effectiveness review

Also list any ideas you considered and rejected in rejectedIdeas with the reason.

Respond with JSON only (no preamble):
{"lines": [{"text": string, "clause": string, "sourceRef": string, "sourceType": "describeShow"|"note"|"expectedEvidence", "sourceText": string, "apsrDimension": "Approach"|"Processes"|"Systems & Outcomes"|"Review"}], "rejectedIdeas": [{"text": string, "reason": string}]}${buildSystemPrompt("checklistScoring", null, "runLiveChecklistGeneration", req.id, domainExpertiseFor(req.id))}${buildDomainBlock(domainExpertiseFor(req.id))}`;

  // Build the source points list. Use flatAuditPoints when available so the AI
  // sees the same granular sub-items that the offline fallback uses; otherwise
  // fall back to the flat DS/EE/Notes arrays.
  const sourceBlock =
    req.flatAuditPoints && req.flatAuditPoints.length > 0
      ? req.flatAuditPoints
          .map((p) => {
            const prefix =
              p.sourceType === "describeShow"
                ? "DS"
                : p.sourceType === "expectedEvidence"
                  ? "EE"
                  : "N";
            const label = p.parentText ? `${p.parentText} → ${p.text}` : p.text;
            return `${prefix}:${p.ref}. ${label}`;
          })
          .join("\n")
      : [
          ...req.describeShow.map((d, i) => `DS:${req.id}.DS${i + 1}. ${d}`),
          ...req.expectedEvidence.map((e, i) => `EE:${req.id}.EE${i + 1}. ${e}`),
          ...req.notes.map((n, i) => `N:${req.id}.N${i + 1}. ${n}`),
        ].join("\n");

  const user = `GD4 item ${req.id} — ${req.requirement}

Intent: ${req.intent}

Official source points (each line = one auditable requirement; ref = official GD4 reference):
${sourceBlock}${req.gateSensitive ? "\n\nNote: This item is gate-sensitive — a minimum Band 3 average applies to this sub-criterion under the official GD4 standard. Lines must be especially precise and unambiguous." : ""}`;

  // Generative (fixed, ignores verdictTemperature): this GENERATES checklist
  // lines from requirement text — a bit of variation helps phrase distinct
  // testable lines. Not a Met/Partial verdict, and not exercised by the
  // consistency test (scratch runs assess flatAuditPoints directly).
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { temperature: 0.3, onUsage }
  );

  const parsed = parseJSONObject(content);
  const rawLines = Array.isArray(parsed.lines) ? (parsed.lines as unknown[]) : [];
  const rawRejected = Array.isArray(parsed.rejectedIdeas) ? (parsed.rejectedIdeas as unknown[]) : [];

  const lines: GeneratedChecklistLine[] = [];
  rawLines.forEach((x) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const sourceText = typeof r.sourceText === "string" ? r.sourceText.trim() : "";
    const sourceType = VALID_SOURCE_TYPES.includes(r.sourceType as GeneratedChecklistLine["sourceType"])
      ? (r.sourceType as GeneratedChecklistLine["sourceType"])
      : null;
    const apsrDimension = VALID_APSR.includes(r.apsrDimension as GeneratedChecklistLine["apsrDimension"])
      ? (r.apsrDimension as GeneratedChecklistLine["apsrDimension"])
      : null;
    const sourceRef = typeof r.sourceRef === "string" ? r.sourceRef.trim() : "";
    // Reject any line the model produced without a valid sourceText, sourceType, sourceRef or apsrDimension.
    if (!text || !sourceText || !sourceType || !apsrDimension || !sourceRef) return;
    // Derive originalIndex from sourceRef (e.g. "1.1.1.DS2" → index 1; sub-items "1.1.1.DS1.a" → null)
    const dsSimple = /\.DS(\d+)$/.exec(sourceRef);
    const eeSimple = /\.EE(\d+)$/.exec(sourceRef);
    const nSimple = /\.N(\d+)$/.exec(sourceRef);
    const derivedIndex = dsSimple
      ? parseInt(dsSimple[1], 10) - 1
      : eeSimple
        ? parseInt(eeSimple[1], 10) - 1
        : nSimple
          ? parseInt(nSimple[1], 10) - 1
          : null;
    lines.push({
      text: text.endsWith(".") ? text : `${text}.`,
      clause: typeof r.clause === "string" && r.clause ? r.clause : `GD4 ${sourceRef}`,
      sourceType,
      sourceIndex: derivedIndex,
      sourceText,
      apsrDimension,
      sourceRef,
    });
  });

  const rejectedCount = rawLines.length - lines.length;
  const rejectedIdeas = rawRejected
    .filter((r): r is Record<string, string> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string")
    .map((r) => ({ text: r.text, reason: r.reason || "Not directly supported by official GD4 wording" }));

  return { lines, rejectedCount, rejectedIdeas, promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}` };
}

export async function runLiveClosureReview(
  closure: { root?: string; corr?: string; prev?: string; evid?: string },
  settings: AISettings,
  calibration?: SkillCalibrationExample[],
  criterionId?: string
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true; usage?: AIUsage }> {
  // Closure review previously got NO criterion specialist knowledge — the one
  // reviewer deciding whether a fix is adequate judged it generically. Inject
  // the same domain block every other per-item call gets.
  const domainSkill = domainExpertiseFor(criterionId);
  const domainBlock = buildDomainBlock(domainSkill);
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described, and never let well-written narrative substitute for missing evidence. If no closure evidence link is provided, you must return "Maintain Finding" regardless of how complete or convincing the narrative sounds. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.${buildSystemPrompt("afiClosure", null, "runLiveClosureReview", criterionId, domainSkill, calibration)}${domainBlock}`;
  const user = `Root cause: ${closure.root || "(none provided)"}\nCorrective action: ${closure.corr || "(none provided)"}\nPreventive action: ${closure.prev || "(none provided)"}\nClosure evidence link: ${closure.evid || "(none provided — no evidence is linked)"}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { onUsage: (u) => { usage = u; } }
  );
  const parsed = parseJSONObject(content);

  // Hard guardrail mirroring simulateClosure's rule in simulateAI.ts: a
  // missing closure evidence link forces "Maintain Finding" regardless of
  // what the model returned, the same way the score/band for item review is
  // never left to the model alone.
  if (!closure.evid) {
    return {
      verdict: "Maintain Finding",
      reason: "No closure evidence linked, so the finding stands regardless of the narrative.",
      evidenceNeeded: (parsed.evidenceNeeded as string) || "Link the evidence that supports this closure.",
      live: true,
      usage,
    };
  }

  return {
    verdict: (parsed.verdict as SimulatedClosureVerdict["verdict"]) || "Maintain Finding",
    reason: (parsed.reason as string) || content,
    evidenceNeeded: (parsed.evidenceNeeded as string) || "Specify the evidence still needed.",
    live: true,
    usage,
  };
}

// Automation: drafts a root cause + corrective + preventive action for a
// finding so the auditor starts from a first draft instead of a blank form.
// These are SUGGESTIONS to edit, never a closure — the prompt is explicit that
// they are proposals and the Closure Reviewer still requires real evidence to
// actually clear the finding.
export async function runLiveClosureDraft(
  finding: { issue: string; gd4ItemId: string },
  settings: AISettings,
  context?: { standard?: string; apsr?: string; calibration?: SkillCalibrationExample[] }
): Promise<{ root: string; corr: string; prev: string; usage?: AIUsage; promptSent?: string }> {
  const closureDomainSkill = domainExpertiseFor(finding.gd4ItemId);
  const system = `You are an EduTrust GD4 quality-action assistant. Given an audit finding (and, where provided, the official GD4 requirement it relates to and the APSR breakdown of which rubric dimension fell short), propose: a ROOT CAUSE that names WHY the gap exists — use the 5-Why methodology to reach the systemic level (Level 3): distinguish an Approach gap (policy/procedure missing or too generic) from a Processes gap (documented but not implemented) from a Systems & Outcomes gap (no desired outcomes produced) from a Review gap (no evaluation for continual improvement) — name the governance, training, data-collection, or review gap as the root cause, not the symptom — then a CORRECTIVE action that fixes this specific gap now (time-bound, names the record/document and responsible role), and a PREVENTIVE action that changes the system so the gap cannot recur (must be different from the corrective action — a new checkpoint, policy section, or standing review item). Be concrete and specific to the requirement; reference the actual evidence/records that should exist. These are draft suggestions the auditor will edit and must still evidence — do not claim the finding is closed. Respond with JSON only: {"root": string, "corr": string, "prev": string}.${buildSystemPrompt("afiClosure", null, "runLiveClosureDraft", finding.gd4ItemId, closureDomainSkill, context?.calibration)}${buildDomainBlock(closureDomainSkill)}`;
  const user = `Finding (GD4 ${finding.gd4ItemId}): ${finding.issue}${context?.standard ? `\n\nOfficial GD4 requirement:\n${context.standard}` : ""}${context?.apsr ? `\n\nAPSR assessment of this line:\n${context.apsr}` : ""}`;
  // Higher temperature for drafting (natural, varied narrative) vs deterministic verdicts.
  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.7, onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["root", "corr", "prev"]);
  return {
    root: (parsed.root as string) || "",
    corr: (parsed.corr as string) || "",
    prev: (parsed.prev as string) || "",
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// Drafts evidence metadata from a pasted link for the Sub-Criterion
// Checklist's "AI fill from link" button. The model is given only the link
// string and the checklist line text — never the document itself, which
// this app has no way to fetch — so the prompt explicitly forbids inventing
// document content and requires the drafted note to flag what is unverified.
export async function runLiveEvidenceFill(
  link: string,
  lineText: string,
  settings: AISettings
): Promise<Omit<EvidenceFillDraft, "live"> & { live: true; usage?: AIUsage; promptSent?: string }> {
  const system = `You are an evidence intake assistant for an EduTrust GD4 internal audit. You are given only a document link/filename and the checklist line it is meant to support — you cannot open or read the document, so never assume or invent its content. Suggest plausible metadata from the link/filename alone, and draft a short auditor note (1-2 sentences) that explicitly tells the human auditor what they still need to verify themselves. Respond with JSON only: {"title": string, "type": "Policy/Procedure" | "Record/Log" | "System screenshot" | "Minutes" | "Survey/Feedback" | "Other", "date": string (YYYY-MM-DD, or "" when the date cannot be determined from the link/filename — NEVER guess a date), "sufficiency": "Present" | "Weak" | "Missing", "auditorNote": string}.${buildSystemPrompt("evidenceTracking", null, "runLiveEvidenceFill")}`;
  const user = `Evidence link: ${link}\nChecklist line this evidence is meant to support: ${lineText}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content);

  // Validate against the allowed set and default UNFAVOURABLY: a missing or
  // malformed sufficiency must never self-certify as "Present" (the only
  // favourable default in the app was here), and an unknown date stays blank
  // rather than being stamped with today (fabricated dates would feed the
  // evidence-timeliness checks).
  const sufficiency: EvidenceFillDraft["sufficiency"] =
    parsed.sufficiency === "Present" || parsed.sufficiency === "Weak" || parsed.sufficiency === "Missing"
      ? parsed.sufficiency : "Missing";
  const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : "";
  return {
    title: (parsed.title as string) || link,
    type: (parsed.type as string) || "Other",
    date,
    sufficiency,
    auditorNote: (parsed.auditorNote as string) || `Verify this evidence actually demonstrates: "${lineText}".`,
    live: true,
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// Drives the Evidence Folder page's "Run audit" action once real Drive text
// has been extracted (see lib/drive/driveClient.ts and
// useWorkspaceStore.auditFolderContents). Unlike every other live function
// in this file, the model genuinely is given real document content here —
// the honesty constraint becomes the opposite one: it must judge each line
// ONLY against the text actually provided, not invent or assume anything
// about parts of the folder that weren't readable/exported.
const STRICTNESS_CLAUSE: Record<string, string> = {
  Lenient: " Calibration: give reasonable benefit of the doubt on each APSR dimension — if the documents broadly address it, lean towards the more favourable rating.",
  Standard: "",
  Strict:
    " Calibration: be conservative and hard to satisfy on every APSR dimension. Rate approach.status \"Meeting\" ONLY when the documented policy/procedure is genuinely specific, complete and sustainable; rate processes.status \"Deployed\" ONLY when records explicitly show it implemented; rate systemsOutcomes.status \"Evident\" ONLY when the desired outcomes are actually produced; rate review.status \"Evident\" ONLY when there is a real review for continual improvement. When in doubt, choose the lower rating — a high band must be genuinely earned.",
};

export type FolderAuditOpts = {
  strictness?: "Lenient" | "Standard" | "Strict";
  // The official GD4 requirement context for this sub-criterion (intent +
  // Describe/Show + Notes + expected evidence) so lines are judged against the
  // real standard, not just their own short wording.
  standard?: string;
  // The criterion / sub-criterion / item id this folder belongs to (e.g. "4.2"
  // or "4"). Used to inject the matching specialist domain-expertise skill so
  // the audit reasons like an auditor who specialises in that criterion.
  criterionId?: string;
  // When set, this is a second "challenge" pass: re-examine these prior
  // verdicts and downgrade any not fully and explicitly evidenced.
  challenge?: { lineId: string; status: string }[];
  // Called as each parallel audit batch completes so the UI can show live
  // batch progress ("Auditing batch 2 of 5"). current is 1-based.
  onBatchProgress?: (current: number, total: number) => void;
  // Calibration examples from the Human Decision Log to inject into the prompt.
  calibration?: SkillCalibrationExample[];
  memories?: SkillCalibrationMemory[];
};

// Wall-clock-safe ceiling on how much extracted document text is sent to one
// audit call. Shared with the store so its condense-to-fit pass targets the
// SAME budget — otherwise the store could condense to just over this and the
// audit would re-truncate (and show an alarming "files may be missing" note)
// even though every document was already read and summarised. ~32k chars is
// Store-level condensing budget (chars). The store pre-condenses documents to
// fit the whole folder into this limit before calling runLiveFolderAudit.
export const FOLDER_DOC_CAP = 60_000;

// Per-batch document budget (chars). Raised from 20k to 60k so the AI sees the
// full evidence folder rather than silently discarding the tail. Models with
// 128k context windows handle this comfortably; total input stays under ~20k tokens
// (system prompt ~5k + doc ~15k).
const BATCH_DOC_CAP = 60_000;

// Per-batch timeout. With 4 lines × 4 dims × ≤25-word notes ≈ 400 output
// tokens, a standard model finishes in ~15–40 s. 90 s leaves a generous buffer
// while still being short enough for the 1-retry strategy to recover transient
// slowdowns within a tolerable wall-clock window.
const AUDIT_BATCH_TIMEOUT_MS = 90_000;

// ─── Auditor Review Panel ─────────────────────────────────────────────────────
// A panel of the user's own auditor profiles reviews one finding from their
// assigned perspectives, then a synthesis call combines them into one balanced
// conclusion that fills the closure scaffold. Reuses the base auditor skills +
// criterion skill; each call is logged to the AI Debug Log via buildSystemPrompt.

export type PanelFindingInput = {
  issue: string;
  gd4ItemId: string;
  clause?: string;
  observation?: string;
  criteria?: string;
  evidenceStatusSummary?: string;
  findingTypeLabel?: string;   // e.g. "NC (Major)"
  // Raw source text (evidence/PPD) if available, for quote verification.
  sourceText?: string;
  // The stable hash the store computed for cache invalidation.
  findingHash: string;
};

function strictnessWordFrom(n: number): "lenient" | "standard" | "strict" {
  return n >= 78 ? "strict" : n <= 45 ? "lenient" : "standard";
}

export async function runAuditorPanel(
  finding: PanelFindingInput,
  panel: AuditorProfile[],
  settings: AISettings,
  opts: { onProgress?: (detail: string) => void; signal?: AbortSignal; onUsage?: (u: AIUsage) => void } = {}
): Promise<PanelReviewResult> {
  const criterionId = finding.gd4ItemId;
  const domainSkill = domainExpertiseFor(criterionId);
  const domainBlock = buildDomainBlock(domainSkill);
  const findingBlock = [
    `Finding (GD4 ${finding.gd4ItemId}${finding.clause ? `, clause ${finding.clause}` : ""}): ${finding.issue}`,
    finding.findingTypeLabel ? `Current classification: ${finding.findingTypeLabel}` : "",
    finding.observation ? `Observation:\n${finding.observation}` : "",
    finding.criteria ? `What GD4 requires:\n${finding.criteria}` : "",
    finding.evidenceStatusSummary ? `Available / missing evidence:\n${finding.evidenceStatusSummary}` : "",
  ].filter(Boolean).join("\n\n");
  const verifyAgainst = [finding.sourceText, finding.observation, finding.criteria, finding.evidenceStatusSummary].filter(Boolean).join("\n");

  const warnings: string[] = [];
  const reviews: PanelAuditorReview[] = [];
  // Every AI sub-call, captured with its REAL input prompt (system + user) and
  // output so each is inspectable in the AI Review Log — not just the synthesis.
  const callLog: PanelCallLog[] = [];

  // One review call per panellist. A failed call is noted and skipped — the
  // synthesis proceeds from whoever succeeded, so one bad call never hangs
  // or aborts the panel.
  for (const auditor of panel) {
    if (opts.signal?.aborted) { warnings.push("Panel review cancelled before all auditors were consulted."); break; }
    const perspective = perspectiveOf(auditor);
    const label = perspectiveLabel(perspective);
    opts.onProgress?.(`${auditor.name} reviewing as ${label}…`);
    const strictness = strictnessWordFrom(auditor.strictness);
    const system = `You are ${auditor.name}, ${auditor.role || "an auditor"} on a GD4 EduTrust review panel${auditor.focusArea ? `, specialising in ${auditor.focusArea}` : ""}. You are reviewing ONE audit finding through a specific lens.

REVIEW PERSPECTIVE — ${label}: ${perspectiveGuidance(perspective)}

Apply a ${strictness} standard. Review the finding ONLY through your perspective above — do not try to cover every angle; the panel's other members cover theirs. Base every point on the finding text and the stated evidence; do not invent documents or quote anything not present. Use neutral, factual language (state what exists or is absent; do not use praise words). Keep the analysis to 3-6 sentences.

Also state your STRUCTURED POSITION so the panel can detect disagreement:
- classification: the type you would assign — one of "NC", "OFI", "Observation" or "No issue".
- severity: "Major", "Minor" or "None".
- rootCauseDirection: one short phrase naming the direction — one of documentation, process, training, data, review, or none.

Respond with JSON only: {"analysis": string, "classification": string, "severity": string, "rootCauseDirection": string}.${buildSystemPrompt("findingWriter", null, `runAuditorPanel · ${auditor.name} (${label})`, criterionId, domainSkill)}${domainBlock}`;
    try {
      let callUsage: AIUsage | undefined;
      const content = await chatComplete(
        [{ role: "system", content: system }, { role: "user", content: findingBlock }],
        settings,
        { temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      const analysisRaw = typeof parsed.analysis === "string" && parsed.analysis.trim() ? parsed.analysis.trim() : content.trim();
      const analysis = verifyAgainst ? flagUnverifiedQuotes(analysisRaw, verifyAgainst) : analysisRaw;
      const ps = (k: string) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "");
      const position: PanelReviewPosition = {
        classification: ps("classification"),
        severity: ps("severity"),
        rootCauseDirection: ps("rootCauseDirection"),
      };
      reviews.push({ auditorId: auditor.id, auditorName: auditor.name, perspective, perspectiveLabel: label, analysis, position });
      callLog.push({
        kind: "round1",
        label: `Panel · ${auditor.name} · ${label} · Round 1`,
        promptSent: `SYSTEM:\n${system}\n\nUSER:\n${findingBlock}`,
        output: content,
        verdict: position.classification ? `${position.classification}${position.severity && position.severity.toLowerCase() !== "none" ? ` (${position.severity})` : ""}` : "Reviewed",
        usage: callUsage,
      });
    } catch (err) {
      if (opts.signal?.aborted) { warnings.push("Panel review cancelled mid-run."); break; }
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`${auditor.name} (${label}) review failed — ${msg}. Synthesised from the remaining panellists.`);
      reviews.push({ auditorId: auditor.id, auditorName: auditor.name, perspective, perspectiveLabel: label, analysis: "", failed: true, error: msg });
      callLog.push({
        kind: "round1",
        label: `Panel · ${auditor.name} · ${label} · Round 1`,
        promptSent: `SYSTEM:\n${system}\n\nUSER:\n${findingBlock}`,
        output: `Call failed — ${msg}`,
        verdict: "Call failed",
        failed: true,
      });
    }
  }

  // ── Round 2 — rebuttal (only when the Round-1 positions materially disagree).
  // Each surviving panellist is shown the OTHERS' Round-1 views and asked to
  // respond from their own lens: agree, challenge, or revise — and flag where
  // and why they disagree. Their perspective/strictness is unchanged.
  let discussionTriggered = false;
  const round1Usable = reviews.filter((r) => !r.failed && r.analysis);
  const disagreement = detectPanelDisagreement(reviews);
  if (disagreement.disagree && round1Usable.length >= 2 && !opts.signal?.aborted) {
    discussionTriggered = true;
    warnings.push(`Panellists disagreed, so a rebuttal round was held. ${disagreement.reasons.join(" ")}`);
    for (const auditor of panel) {
      if (opts.signal?.aborted) { warnings.push("Rebuttal round cancelled before all auditors responded."); break; }
      const review = reviews.find((r) => r.auditorId === auditor.id);
      if (!review || review.failed || !review.analysis) continue; // skip failed Round-1 panellists
      const others = round1Usable.filter((r) => r.auditorId !== auditor.id);
      if (others.length === 0) continue;
      const perspective = review.perspective;
      const label = review.perspectiveLabel;
      opts.onProgress?.(`${auditor.name} responding to the panel as ${label}…`);
      const strictness = strictnessWordFrom(auditor.strictness);
      const othersDigest = others.map((r) => {
        const pos = r.position ? ` (position: ${r.position.classification || "—"} / ${r.position.severity || "—"} / ${r.position.rootCauseDirection || "—"})` : "";
        return `[${r.auditorName} — ${r.perspectiveLabel}]${pos}\n${r.analysis}`;
      }).join("\n\n");
      const rebSystem = `You are ${auditor.name}, ${auditor.role || "an auditor"} on a GD4 EduTrust review panel${auditor.focusArea ? `, specialising in ${auditor.focusArea}` : ""}. You already gave your independent view of ONE finding. The panel disagreed, so you are now in a discussion round.

REVIEW PERSPECTIVE — ${label}: ${perspectiveGuidance(perspective)}

Apply a ${strictness} standard and KEEP your perspective. Read the other panellists' views below and respond from your own lens: state clearly where you AGREE, where you CHALLENGE them (and why), and whether you REVISE any part of your own position. Explicitly name the points of disagreement. Do not simply repeat your first review and do not adopt another lens. Base every point on the finding text and stated evidence; do not invent documents. Keep it to 3-6 sentences.

Respond with JSON only: {"rebuttal": string}.${buildSystemPrompt("findingWriter", null, `runAuditorPanel · rebuttal · ${auditor.name} (${label})`, criterionId, domainSkill)}${domainBlock}`;
      const rebUser = `The finding under review:\n${findingBlock}\n\nYour Round-1 view:\n${review.analysis}\n\nThe other panellists' Round-1 views:\n${othersDigest}\n\nRespond to the panel.`;
      try {
        let callUsage: AIUsage | undefined;
        const content = await chatComplete(
          [{ role: "system", content: rebSystem }, { role: "user", content: rebUser }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const rebRaw = typeof parsed.rebuttal === "string" && parsed.rebuttal.trim() ? parsed.rebuttal.trim() : content.trim();
        review.rebuttal = verifyAgainst ? flagUnverifiedQuotes(rebRaw, verifyAgainst) : rebRaw;
        callLog.push({
          kind: "rebuttal",
          label: `Panel · ${auditor.name} · ${label} · rebuttal`,
          promptSent: `SYSTEM:\n${rebSystem}\n\nUSER:\n${rebUser}`,
          output: content,
          verdict: "Rebuttal",
          usage: callUsage,
        });
      } catch (err) {
        if (opts.signal?.aborted) { warnings.push("Rebuttal round cancelled mid-run."); break; }
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${auditor.name} (${label}) rebuttal failed — ${msg}. Synthesised from their Round-1 view.`);
        callLog.push({
          kind: "rebuttal",
          label: `Panel · ${auditor.name} · ${label} · rebuttal`,
          promptSent: `SYSTEM:\n${rebSystem}\n\nUSER:\n${rebUser}`,
          output: `Call failed — ${msg}`,
          verdict: "Call failed",
          failed: true,
        });
      }
    }
  }

  const usable = reviews.filter((r) => !r.failed && r.analysis);
  const emptySynthesis: PanelSynthesis = {
    summary: "The panel could not be synthesised — every panellist review failed. Re-run the panel once the AI connection is restored.",
    riskImpact: "", rootCause: "", immediateCorrection: "", correctiveAction: "", evidenceForClosure: "", finalClassification: "",
  };

  let synthesis = emptySynthesis;
  if (usable.length > 0 && !opts.signal?.aborted) {
    opts.onProgress?.("Synthesising the panel's conclusion…");
    const panelDigest = usable.map((r) => {
      const base = `[${r.auditorName} — ${r.perspectiveLabel}]\n${r.analysis}`;
      return r.rebuttal ? `${base}\nAfter discussion: ${r.rebuttal}` : base;
    }).join("\n\n");
    const synthSystem = `You are the chair of a GD4 EduTrust audit review panel. You are given several panellists' reviews of ONE finding, each from a different perspective (strict auditor, process owner, risk challenger, academic/QA guardian, management reviewer)${discussionTriggered ? ", along with their post-discussion responses after a rebuttal round in which they disagreed" : ""}. Combine them into ONE balanced, evidence-based conclusion — reconcile the disagreement, weigh the post-discussion views, do not overstate, and do not simply repeat each panellist.

The ROOT CAUSE must name a SYSTEM or PROCESS cause (a governance, documentation, training, data-collection or review gap) — never "human error", "forgot", "poor communication" or blame of an individual.

Respond with JSON only, all fields plain text:
{"summary": "Balanced Finding Summary", "riskImpact": "Risk / Impact", "rootCause": "system/process root cause", "immediateCorrection": "Immediate Correction", "correctiveAction": "Corrective Action", "evidenceForClosure": "Evidence Required for Closure", "finalClassification": "MUST start with exactly one of: NC (Major), NC (Minor), OFI, OBS — followed by an em-dash and a brief justification, no overstatement. Use no other classification word (no CAR, no improvement)."}.${buildSystemPrompt("afiClosure", null, "runAuditorPanel · synthesis", criterionId, domainSkill)}${domainBlock}`;
    const synthUser = `The finding under review:\n${findingBlock}\n\nPanellists' reviews:\n${panelDigest}\n\nWrite the panel's combined conclusion.`;
    try {
      let callUsage: AIUsage | undefined;
      const content = await chatComplete(
        [{ role: "system", content: synthSystem }, { role: "user", content: synthUser }],
        settings,
        { temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const p = parseJSONObject(content);
      const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
      const vq = (t: string) => (verifyAgainst && t ? flagUnverifiedQuotes(t, verifyAgainst) : t);
      synthesis = {
        summary: vq(s("summary")) || emptySynthesis.summary,
        riskImpact: vq(s("riskImpact")),
        rootCause: vq(s("rootCause")),
        immediateCorrection: vq(s("immediateCorrection")),
        correctiveAction: vq(s("correctiveAction")),
        evidenceForClosure: vq(s("evidenceForClosure")),
        finalClassification: s("finalClassification"),
      };
      callLog.push({
        kind: "synthesis",
        label: "Panel · chair synthesis",
        promptSent: `SYSTEM:\n${synthSystem}\n\nUSER:\n${synthUser}`,
        output: content,
        verdict: synthesis.finalClassification || "Synthesised",
        usage: callUsage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!opts.signal?.aborted) warnings.push(`Synthesis call failed — ${msg}. Showing the individual reviews only.`);
      callLog.push({
        kind: "synthesis",
        label: "Panel · chair synthesis",
        promptSent: `SYSTEM:\n${synthSystem}\n\nUSER:\n${synthUser}`,
        output: `Call failed — ${msg}`,
        verdict: "Call failed",
        failed: true,
      });
    }
  }

  return {
    reviews,
    synthesis,
    runAt: new Date().toISOString(),
    live: true,
    runWarnings: warnings.length > 0 ? warnings : undefined,
    findingHash: finding.findingHash,
    discussionTriggered,
    callLog,
  };
}

// Retry once on timeout or 5xx before giving up on a batch. A single retry
// with a short backoff handles transient API slowdowns without hanging the
// audit for several minutes.
const AUDIT_BATCH_MAX_RETRIES = 1;
const AUDIT_BATCH_RETRY_DELAY_MS = 6_000;

// Maximum checklist lines per audit call. 4 lines × 4 APSR dims × ≤25-word
// notes ≈ 400 output tokens → finishes in 15–40 s per call. A 30-line audit
// becomes 8 parallel batches; all complete well within the 90 s ceiling.
const AUDIT_BATCH_SIZE = 4;

export type FolderAuditResult = {
  verdicts: FolderAuditLineVerdict[];
  parseWarnings: string[];
  truncationNote?: string;
  // AI-detected file mis-filing warnings (e.g. a record found in the Policy
  // folder, or a pure policy doc found in the Evidence folder).
  folderWarnings: string[];
  // Model + token usage for this audit (undefined offline).
  usage?: AIUsage;
  // Line ids for which AI calls timed out after retries. Those lines receive
  // placeholder "Not met" verdicts and should be re-audited.
  timedOutLineIds?: string[];
};

// One chatComplete call for a single batch of lines against the same docText.
// Shared prompt construction (system + user) is identical across batches so
// the model sees the same documents for every line it assesses.
async function runLiveFolderAuditBatch(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts
): Promise<FolderAuditResult> {
  const strictness = opts.strictness || "Standard";
  // Specialist domain expertise for this criterion (corporate finance for C1,
  // student-protection for C4, pedagogy/assessment for C5, etc.) so the audit
  // applies the deep, criterion-specific knowledge a human specialist would.
  const domainSkill = domainExpertiseFor(opts.criterionId);
  // APSR assessment using the official EduTrust Scoring Rubric dimensions
  // (GD4 §23): Approach → Processes → Systems & Outcomes → Review, assessed in
  // that order. The overall Met/Partial/Not met is NOT decided by the model — it
  // is derived in code by deriveApsrStatus (Approach hard-gates), the same way
  // the score/band are never left to the model alone.
  const base = `You are a GD4 internal auditor applying the official EduTrust Scoring Rubric, which assesses four dimensions — Approach, Processes, Systems & Outcomes, Review (APSR). You are given the official GD4 requirement, the institution's documents split into a "=== POLICY & PROCEDURE ===" section and an "=== ACTUAL EVIDENCE ===" section (each chunk headed by a chunk ID and its file path and type, e.g. "[CHUNK:C001] --- path [kind] ---"), and checklist statements. Assess each statement on the four rubric dimensions IN ORDER, using ONLY the text given and never assuming content that isn't there:
1. APPROACH (documented policies and procedures — the methods, tools and techniques used to meet the requirement). Read the POLICY & PROCEDURE text against the requirement WORD BY WORD. approach.status: "Meeting" only if the documented approach is specific, complete against the requirement AND sustainable (states who does what, when and how, repeatable year on year); "Beginning" if it is vague, boilerplate, copy-paste, not specific to this institution, or not sustainable; "Not evident" if no documented approach addresses it. Be critical — comment in approach.note on why it is or isn't sustainable / too generic.
2. PROCESSES (actual implementation of those policies and procedures). Using ONLY the ACTUAL EVIDENCE text, processes.status: "Deployed" if records show it implemented and managed, "Weak" if deployment is weak/partial, "Not evident" if there is no implementation evidence (a documented approach on paper is NOT implementation).
3. SYSTEMS & OUTCOMES (the desired outcomes derived from that implementation). systemsOutcomes.status: "Evident" if the desired outcomes/results are actually produced, "Limited" if outcomes are limited, "Not evident" if none.
4. REVIEW (evaluation of the appropriateness, relevance and effectiveness of the approach and process for continual improvement). review.status: "Evident" if there is a real review with improvement action, "Not evident" otherwise.
Each "note" must be a critical AUDITOR ANALYSIS, not a description or summary of the document. Never merely restate what the document contains. For approach.note: judge HOW WELL the documented approach meets THIS requirement — name specifically which Describe/Show expectations it covers and which it omits or addresses only weakly, say whether it is genuinely specific to this institution or boilerplate/generic, whether it is sustainable (repeatable, with named owners and timing) or ad hoc, and end with ONE concrete improvement the institution should make. For processes/systemsOutcomes/review notes: state what evidence WOULD prove the dimension and what is actually missing, not a paraphrase of any text found. A note that only describes the document's contents is a failure — write the auditor's judgement of its adequacy and gaps.
For EVERY non-empty positive claim (i.e. status is not "Not evident"), cite the specific chunk ID(s) from the document headers (e.g. "C001", "C002") in "sourceChunkIds" on that dimension. If no chunk directly supports a positive status, leave sourceChunkIds as an empty array — do NOT invent chunk IDs. Also populate the top-level "sources" array with file paths for backward compatibility. Cross-check file types: if a file in the POLICY & PROCEDURE section looks like an operational record, log, attendance sheet, minutes or filled-in form (not a policy/SOP/procedure/plan/framework), or a file in the ACTUAL EVIDENCE section looks like a pure undated policy document with no implementation records, add a one-sentence warning per problematic file to "folderWarnings" (e.g. "Policy folder: 'HR_Attendance_Log_Jan.xlsx' appears to be an attendance record, not a procedure — move to Actual Evidence"). Also flag evidence-timeliness issues: documents dated within 4 weeks of audit, records that don't span the full review period, and any claims about outcomes that lack a stated survey response rate.${STRICTNESS_CLAUSE[strictness] || ""}${buildSystemPrompt("evidenceReview", null, "runLiveFolderAuditBatch", opts.criterionId, domainSkill, opts.calibration, opts.memories)}`;
  const challengeRule = opts.challenge
    ? ` This is a SECOND, stricter review pass. Earlier overall verdicts are given; re-examine each and DOWNGRADE any generous rating — in particular, demote approach.status from "Meeting" to "Beginning" unless the documented approach is genuinely specific and sustainable, and demote processes.status unless implementation is explicitly evidenced.`
    : "";
  // Inject the criterion's specialist domain knowledge as its own prominent
  // block (not mixed into the generic skill bundle) so it is never truncated
  // and clearly frames the auditor persona for this criterion.
  const domainBlock = domainSkill
    ? `\n\n## Apply this specialist domain expertise for THIS criterion\n\nAudit this folder with the depth of the specialist below. Use its specific cross-checks, red flags and calibration — generic observations are not acceptable where this expertise lets you be precise.\n\n${domainSkill.trim()}`
    : "";
  const system = `${base}${domainBlock}${challengeRule} Each "note" must be 2–3 targeted sentences: name the specific file, record, role, or procedure gap you found; state precisely what is missing and what the institution must do to fix it; include dates, counts, or named roles where visible in the documents. Write as an auditor's direct assessment — never merely describe or summarise the document's contents. Respond with JSON only: {"lines": [{"lineId": string, "approach": {"status": "Meeting"|"Beginning"|"Not evident", "note": string, "sourceChunkIds": string[]}, "processes": {"status": "Deployed"|"Weak"|"Not evident", "note": string, "sourceChunkIds": string[]}, "systemsOutcomes": {"status": "Evident"|"Limited"|"Not evident", "note": string, "sourceChunkIds": string[]}, "review": {"status": "Evident"|"Not evident", "note": string, "sourceChunkIds": string[]}, "overallReason": string, "sources": string[]}], "folderWarnings": ["optional one-sentence warnings about mis-filed documents"]}.`;

  const DOC_CAP = BATCH_DOC_CAP;
  const truncated = docText.length > DOC_CAP;
  const truncationNote = truncated
    ? `Document text (${docText.length.toLocaleString()} chars) exceeds the ${DOC_CAP.toLocaleString()}-char per-call limit; last ${(docText.length - DOC_CAP).toLocaleString()} chars were not sent to the AI. The store-level condensing budget is ${FOLDER_DOC_CAP.toLocaleString()} chars — if docText is still larger, split this folder or remove duplicates and re-run.`
    : undefined;
  const truncationHint = truncated
    ? ` (NOTE: only the first ${DOC_CAP.toLocaleString()} of ${docText.length.toLocaleString()} characters are included below — some content is missing)`
    : "";

  const standardBlock = opts.standard ? `The official GD4 requirement this folder must satisfy (judge the APPROACH against THIS standard, word by word):\n"""\n${opts.standard.slice(0, 4000)}\n"""\n\n` : "";
  const priorBlock = opts.challenge ? `Earlier (first-pass) overall verdicts to re-examine and toughen:\n${opts.challenge.map((c) => `[${c.lineId}] ${c.status}`).join("\n")}\n\n` : "";
  const user = `${standardBlock}${priorBlock}Document text extracted from the folder (split into POLICY & PROCEDURE and ACTUAL EVIDENCE; each chunk headed by file path + type${truncationHint}):\n"""\n${docText.slice(0, DOC_CAP)}\n"""\n\nChecklist statements to assess:\n${lines
    .map((l) => `[${l.id}] ${l.text}`)
    .join("\n")}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS },
  );
  const arr = parseJSONArray(content);
  // Extract optional folderWarnings from the same response object (backward
  // compatible — older/simpler model responses that return a plain array won't
  // have this key and will safely produce an empty warnings list).
  const parsedTop = parseJSONObject(content);
  const folderWarnings = Array.isArray(parsedTop.folderWarnings)
    ? (parsedTop.folderWarnings as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  type RawLeg = { status?: unknown; note?: unknown; sourceChunkIds?: unknown };
  type RawLine = { lineId: string; approach?: RawLeg; processes?: RawLeg; systemsOutcomes?: RawLeg; review?: RawLeg; sources?: unknown; overallReason?: unknown };
  const byId = new Map(
    arr
      .filter((x): x is RawLine => !!x && typeof x === "object" && typeof (x as { lineId?: unknown }).lineId === "string")
      .map((x) => [x.lineId, x])
  );

  // Coerce each dimension into the typed APSR shape, defaulting to the WORST
  // value so a missing/garbled dimension never accidentally credits the line.
  // Track any dimension that fell back so the caller can log a warning.
  // Also extracts sourceChunkIds — the chunk IDs the model cited for each dimension.
  const parseWarnings: string[] = [];
  const leg = <T extends string>(raw: RawLeg | undefined, allowed: readonly T[], fallback: T, dimName: string, lineId: string): { status: T; note: string; sourceChunkIds?: string[] } => {
    const s = raw?.status;
    const ok = (allowed as readonly string[]).includes(s as string);
    if (!ok) parseWarnings.push(`Line ${lineId} — ${dimName} status "${String(s)}" not in allowed set; defaulted to "${fallback}"`);
    const sourceChunkIds = Array.isArray(raw?.sourceChunkIds)
      ? (raw!.sourceChunkIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    return { status: ok ? (s as T) : fallback, note: typeof raw?.note === "string" ? raw.note : "", sourceChunkIds };
  };

  const verdicts = lines.map((l) => {
    const v = byId.get(l.id);
    const apsr: ApsrBreakdown = {
      approach: leg(v?.approach, ["Meeting", "Beginning", "Not evident"] as const, "Not evident", "approach", l.id),
      processes: leg(v?.processes, ["Deployed", "Weak", "Not evident"] as const, "Not evident", "processes", l.id),
      systemsOutcomes: leg(v?.systemsOutcomes, ["Evident", "Limited", "Not evident"] as const, "Not evident", "systemsOutcomes", l.id),
      review: leg(v?.review, ["Evident", "Not evident"] as const, "Not evident", "review", l.id),
    };
    const status = deriveApsrStatus(apsr);
    const sources = Array.isArray(v?.sources) ? (v!.sources as unknown[]).filter((s): s is string => typeof s === "string") : undefined;
    const reason = v ? apsrReason(apsr) : "The model did not return a verdict for this line; treated as unmet pending re-run.";
    const overallReason = typeof v?.overallReason === "string" ? v.overallReason : undefined;
    return { lineId: l.id, status, reason, sources, apsr, overallReason };
  });

  return { verdicts, parseWarnings, truncationNote, folderWarnings, usage };
}

// Outcome type for runBatchWithRetry — either a successful result or a record
// of which lines failed so placeholders can be inserted without losing the
// verdicts from all the OTHER batches that succeeded.
type BatchOutcome =
  | { ok: true; result: FolderAuditResult; batchLines: { id: string; text: string }[] }
  | { ok: false; batchLines: { id: string; text: string }[]; error: string };

// Runs a single batch with up to AUDIT_BATCH_MAX_RETRIES retries on timeout or
// transient server errors. Auth/bad-request errors are not retried (permanent).
// Returns a BatchOutcome rather than throwing so the caller can collect partial
// results from the other concurrent batches.
async function runBatchWithRetry(
  batchLines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  batchOpts: FolderAuditOpts
): Promise<BatchOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt <= AUDIT_BATCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, AUDIT_BATCH_RETRY_DELAY_MS));
    try {
      const result = await runLiveFolderAuditBatch(batchLines, docText, settings, batchOpts);
      return { ok: true, result, batchLines };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Only retry transient failures. Auth / bad-request are permanent.
      const retryable =
        err instanceof AIClientError &&
        (lastError.includes("timed out") || /50[0-9]/.test(lastError));
      if (!retryable || attempt >= AUDIT_BATCH_MAX_RETRIES) break;
    }
  }
  return { ok: false, batchLines, error: lastError };
}

export async function runLiveFolderAudit(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts = {}
): Promise<FolderAuditResult> {
  const batches: { id: string; text: string }[][] = [];
  for (let i = 0; i < lines.length; i += AUDIT_BATCH_SIZE) {
    batches.push(lines.slice(i, i + AUDIT_BATCH_SIZE));
  }

  opts.onBatchProgress?.(0, batches.length);
  let completed = 0;

  // Single batch: propagate errors to the store's existing catch block.
  // Retry still applies via runBatchWithRetry.
  if (batches.length === 1) {
    const outcome = await runBatchWithRetry(lines, docText, settings, opts);
    opts.onBatchProgress?.(1, 1);
    if (!outcome.ok) throw new AIClientError(outcome.error);
    return outcome.result;
  }

  // Multi-batch: run all in parallel, but resilient — a single timeout does
  // NOT cancel sibling batches. A failed batch's lines get NO verdict at all
  // (they are reported via timedOutLineIds and left "not assessed") — a
  // fabricated "Not met" placeholder must never reach the checklist or raise
  // findings. The completed work from other batches is kept.
  const outcomes = await Promise.all(
    batches.map(async (batchLines) => {
      // For the challenge pass, only surface prior verdicts that belong to the
      // lines in THIS batch — sending irrelevant verdicts wastes tokens and
      // confuses the model about which lines it should re-examine.
      const batchLineIds = new Set(batchLines.map((l) => l.id));
      const batchOpts: FolderAuditOpts = opts.challenge
        ? { ...opts, challenge: opts.challenge.filter((c) => batchLineIds.has(c.lineId)) }
        : opts;
      const outcome = await runBatchWithRetry(batchLines, docText, settings, batchOpts);
      opts.onBatchProgress?.(++completed, batches.length);
      return outcome;
    })
  );

  const succeeded = outcomes.filter((o): o is BatchOutcome & { ok: true } => o.ok);
  const failed = outcomes.filter((o): o is BatchOutcome & { ok: false } => !o.ok);
  const timedOutLineIds = failed.flatMap((o) => o.batchLines.map((l) => l.id));

  // Merge: verdicts and warnings flatten; truncationNote is shared (all batches
  // see the same docText, so truncation either fires in all or none);
  // folderWarnings deduplicated because every batch sees the same documents and
  // would emit the same mis-filing warning independently; usage summed.
  return {
    verdicts: succeeded.flatMap((o) => o.result.verdicts),
    parseWarnings: succeeded.flatMap((o) => o.result.parseWarnings),
    truncationNote: succeeded.find((o) => o.result.truncationNote)?.result.truncationNote,
    folderWarnings: [...new Set(succeeded.flatMap((o) => o.result.folderWarnings))],
    usage: succeeded.reduce<AIUsage | undefined>((acc, o) => addUsage(acc, o.result.usage), undefined),
    timedOutLineIds: timedOutLineIds.length ? timedOutLineIds : undefined,
  };
}

// Cross-criterion strategic analysis: synthesises criterion bands, open
// findings, and the audit journal into strategic priorities, systemic issues,
// a path to 4-Year Star, and immediate actions. This is the only AI function
// that looks across ALL criteria at once — every other function is per-item.
export async function runLiveCrossCriterionAnalysis(
  input: {
    journal: string;
    findings: Array<{
      gd4ItemId: string;
      issue: string;
      observation?: string;
      effect?: string;
      dimension?: string;
      riskCategory?: string;
    }>;
    criterionBands: Array<{ id: string; title: string; band: number }>;
    totalScore: number;
    award: string;
  },
  settings: AISettings
): Promise<{
  priorities: string[];
  systemicIssues: string[];
  starPath: string;
  immediateActions: string[];
  usage?: AIUsage;
}> {
  const system = `You are a senior EduTrust strategic consultant reviewing a complete internal audit result for a Singapore PEI. Analyse the criterion bands, open findings, and audit journal to produce: (1) top 3 strategic priorities (most impactful gaps to address first), (2) systemic issues (cross-cutting root causes that appear in multiple criteria — use root-cause methodology to find the underlying governance/training/data gap, not the symptoms), (3) a concrete path to 4-Year (Star) — what specifically needs to change at each band level with concrete benchmarks for Band 4–5 behaviour, (4) the single most urgent immediate action. Be specific to the GD4 standard, cite criterion and sub-criterion numbers. Do not soften or hedge. Respond with JSON only: {"priorities": string[], "systemicIssues": string[], "starPath": string, "immediateActions": string[]}.${buildSystemPrompt("bandRecommend", null, "runLiveCrossCriterionAnalysis")}`;

  const criterionBandLines = input.criterionBands.map((c) => `C${c.id} Band ${c.band} — ${c.title}`).join("\n");

  const catCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const f of input.findings) if (f.riskCategory && f.riskCategory in catCounts) catCounts[f.riskCategory]++;
  const catSummary = Object.entries(catCounts)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `Cat ${c}: ${n}`)
    .join(", ");

  const topFindings = input.findings
    .filter((f) => f.riskCategory === "A" || f.riskCategory === "B")
    .slice(0, 5)
    .map((f) => `[${f.gd4ItemId}${f.riskCategory ? ` Cat${f.riskCategory}` : ""}] ${f.issue}${f.observation ? ` — ${f.observation.slice(0, 200)}` : ""}${f.effect ? ` Effect: ${f.effect.slice(0, 200)}` : ""}`)
    .join("\n");

  const journalBlock = input.journal ? input.journal.slice(0, 3000) : "(no audit journal entries)";

  const user = `Criterion bands:\n${criterionBandLines}\n\nOverall score: ${input.totalScore}/1000 — Award: ${input.award}\nOpen findings by category: ${catSummary || "none"} (total ${input.findings.length})\n\nTop Category A+B findings:\n${topFindings || "(none)"}\n\nAudit journal (latest entries):\n${journalBlock}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["priorities", "systemicIssues", "starPath", "immediateActions"]);

  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

  return {
    priorities: toStrArr(parsed.priorities),
    systemicIssues: toStrArr(parsed.systemicIssues),
    starPath: typeof parsed.starPath === "string" ? parsed.starPath : "",
    immediateActions: toStrArr(parsed.immediateActions),
    usage,
  };
}

// Drafts the three structured body sections of a finding — Observation,
// Criteria, Effect — using the finding-specificity skill so the AI writes
// with the required specificity: WHO, WHAT, WHEN, HOW MANY, GD4 clause, and
// a concrete regulatory/certification consequence. Where exact counts or names
// are unknown, the AI uses explicit [placeholder] markers so the auditor knows
// what to fill in. These are drafts — the auditor edits before finalising.
export async function runLiveFindingObservation(
  req: { id: string; requirement: string; describeShow: string[]; expectedEvidence: string[] },
  line: { text: string; status: string },
  dimension: string,
  apsr: ApsrBreakdown | undefined,
  settings: AISettings
): Promise<{ observation: string; criteria: string; effect: string; usage?: AIUsage; promptSent?: string }> {
  const apsrSummary = apsr
    ? [
        `Approach: ${apsr.approach.status}${apsr.approach.note ? ` — ${apsr.approach.note}` : ""}`,
        `Processes: ${apsr.processes.status}${apsr.processes.note ? ` — ${apsr.processes.note}` : ""}`,
        `Systems & Outcomes: ${apsr.systemsOutcomes.status}${apsr.systemsOutcomes.note ? ` — ${apsr.systemsOutcomes.note}` : ""}`,
        `Review: ${apsr.review.status}${apsr.review.note ? ` — ${apsr.review.note}` : ""}`,
      ].join("; ")
    : "No APSR breakdown available (offline/manual finding).";

  const system = `You are an EduTrust GD4 audit finding writer. Given a checklist line that failed, its GD4 requirement, its APSR assessment, and the rubric dimension that fell short, write three sections of a formal audit finding:

1. OBSERVATION — what was found. Must follow the WHO/WHAT/WHEN/HOW MANY rule: name the responsible role (use [Role Name] if unknown), the specific document or record type, the period reviewed, and the count of gaps (use [N of M reviewed] if the exact count is unavailable). Use the APSR notes to be specific about what was absent or insufficient. This must be a factual observation of the gap, not a statement of the requirement.

2. CRITERIA — what the standard requires. Cite GD4 ${req.id} precisely. Include the specific describeShow expectation that was not met and the expected evidence.

3. EFFECT — the regulatory, certification, or operational consequence of this gap. Name the specific EduTrust band ceiling or SSG compliance risk. Be direct, not generic.

Use [bracketed placeholders] wherever you need specific data (names, dates, counts) that the auditor must fill in. Do not soften or hedge the observation.
Apply root-cause methodology: distinguish symptom → immediate cause → systemic root cause, and use 5-Why thinking to reach the system-level cause in the observation. State any sample denominator if visible in the APSR notes. Cite the specific regulatory provision (not just the GD4 item) in the criteria section where applicable. In the effect section, name the specific band ceiling and the concrete regulatory or certification consequence using benchmarking reference points.
Write all finding sections (Observation, Criteria, Effect) in factual, neutral language. State what was found and what the standard requires. Do not characterise evidence as adequate, inadequate, good, or poor — only state what exists or is absent. Avoid phrases like "the policy is adequate" or "well-written" — instead say "a policy document was provided" or "no policy document was found". The reader will judge adequacy — you only state facts.
Respond with JSON only: {"observation": string, "criteria": string, "effect": string}.${buildSystemPrompt("findingWriter", null, "runLiveFindingObservation", req.id, domainExpertiseFor(req.id))}${buildDomainBlock(domainExpertiseFor(req.id))}`;

  const user = `GD4 ${req.id}: ${req.requirement}
Describe/Show: ${req.describeShow.slice(0, 3).join("; ")}
Expected evidence: ${req.expectedEvidence.length ? req.expectedEvidence.join("; ") : "(not specified)"}

Checklist line: "${line.text}" — status: ${line.status}
APSR assessment: ${apsrSummary}
Dimension (APSR leg that fell short): ${dimension}`;

  let usage: AIUsage | undefined;
  // Generative (fixed): writes the finding OBSERVATION prose (WHO/WHAT/WHEN
  // narrative), not a verdict — natural varied wording is desirable here.
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.5, onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["observation", "criteria", "effect"]);
  return {
    observation: (parsed.observation as string) || `${line.text} — status: ${line.status}. [Auditor: add WHO, WHAT, WHEN, and HOW MANY specifics here.]`,
    criteria: (parsed.criteria as string) || `GD4 ${req.id} requires: ${req.requirement}`,
    effect: (parsed.effect as string) || `This gap must be resolved before the EduTrust assessment. See the dimension (${dimension}) for the applicable band ceiling.`,
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Staged folder audit — three focused AI stages + deterministic APSR builder.
//
// The key constraint: policy documents can only satisfy Approach; evidence
// documents satisfy Processes; outcome data satisfies Systems & Outcomes; review
// records satisfy Review. The old single-pass audit let the model decide APSR in
// one undifferentiated call. The staged approach enforces these boundaries in code.
// ──────────────────────────────────────────────────────────────────────────────

export type StagedPolicyAuditResult = {
  rows: PolicyCoverageRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

export type StagedEvidenceAuditResult = {
  rows: EvidenceCoverageRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

export type StagedOutcomeReviewAuditResult = {
  rows: OutcomeReviewRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

const STAGED_BATCH_SIZE = 8; // audit points per AI call (each is smaller than a full checklist line)

// Shared assessor-register rule appended to every staged-audit prompt. Brings
// the staged (Option B) notes to the same standard as the Option A prompts —
// Technique 1 (decompose and name the missing obligation), Technique 4 (named
// example with dates/versions) and Technique 5 (SSG phrasing register). Write
// the note as an assessor writes a finding, never as a summary.
const SSG_NOTE_REGISTER = ` Write the "note" the way an SSG EduTrust assessor writes a finding — specific, decomposed, evidenced — NEVER as a generic summary:
- DECOMPOSE the requirement into its distinct obligations and name WHICH specific obligation is missing, weak, or met — e.g. "the documents cover the code of conduct but not the non-collection of monies from students", not merely "the requirement is partially met". Where the point has (a)/(b)/(c) parts, say which part fails.
- Every "Partial"/"No"/"Not evident" note MUST open with the SSG register — "It was not evident that the PEI had [documented / implemented / established] …" — and MUST cite at least one concrete example: the specific document name, section, version, date or record entry that demonstrates the gap; or, where the topic is wholly absent, name what was searched and found absent.
- Where dates or versions can be compared (a record dated after the period it governs; a document that never moves past V0; evidence created only just before the audit), PERFORM the comparison and state it explicitly in the note.
- A negative note that does not name the specific missing obligation AND give a concrete example is unsupported and unacceptable — do not write "no relevant evidence found" or "the requirement is not met" on their own.
- Positive notes stay factual and specific (which record, which section, which date) — no praise adjectives ("good", "robust", "comprehensive", "well-structured").`;

// Sliding window constants. Windows overlap so evidence that straddles a
// boundary is not missed. Each window is sent as a separate AI call set and
// the results merged (best verdict wins across windows).
const WINDOW_SIZE = 55_000;
const WINDOW_OVERLAP = 5_000;

type DocWindow = { text: string; start: number; end: number; index: number; total: number };

function buildDocWindows(text: string): DocWindow[] {
  if (!text || text.length <= WINDOW_SIZE) {
    return [{ text, start: 0, end: text.length, index: 0, total: 1 }];
  }
  const windows: DocWindow[] = [];
  const step = WINDOW_SIZE - WINDOW_OVERLAP;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + WINDOW_SIZE, text.length);
    windows.push({ text: text.slice(start, end), start, end, index: windows.length, total: 0 });
    if (end >= text.length) break;
    start += step;
  }
  const total = windows.length;
  for (const w of windows) w.total = total;
  return windows;
}

// Coverage priority: Yes > Partial > No. Returns the better of the two.
function mergeCoverage(a: StagedCoverageStatus, b: StagedCoverageStatus): StagedCoverageStatus {
  if (a === "Yes" || b === "Yes") return "Yes";
  if (a === "Partial" || b === "Partial") return "Partial";
  return "No";
}

// Tracks the specific note (and the chunk IDs that supported it) each window
// contributed for one audit-point ref, so the final note can cite every
// window that found something — with a source citation — rather than
// silently discarding all but the single "best" window's text.
type WindowNote = { window: number; note: string; chunkIds: string[] };

function pushWindowNote(parts: WindowNote[], windowIndex: number, note: string, chunkIds: string[]): WindowNote[] {
  const trimmed = note.trim();
  if (!trimmed) return parts;
  return [...parts, { window: windowIndex + 1, note: trimmed, chunkIds }];
}

// For a NEGATIVE (gap) verdict the SSG-register prompt still asks the model to
// write a specific "It was not evident that the PEI had… Example: …" note. We
// used to discard those notes (keeping only positive-coverage notes), so every
// gap — exactly the lines that become findings — fell back to a generic string
// like "No implementation evidence found…", which is why Option B read generic.
// Keep the single MOST SUBSTANTIVE negative note (longest wins as a proxy for
// "carries the named example"); across windows the fullest observation survives
// rather than a bare "not found in this window".
function betterNegNote(prev: WindowNote | undefined, windowIndex: number, note: string, chunkIds: string[]): WindowNote | undefined {
  const trimmed = note.trim();
  if (!trimmed) return prev;
  const candidate: WindowNote = { window: windowIndex + 1, note: trimmed, chunkIds };
  if (!prev || trimmed.length > prev.note.length) return candidate;
  return prev;
}

// Renders the accumulated per-window notes for one ref as one numbered,
// blank-line-separated paragraph per contributing window:
//   #1 [filename.pdf · C001]: <note text>
//
//   #2 [other.pdf · C003]: <note text>
// `resolveFile` maps a chunk ID back to its source file name (from the
// evidence file ledger) — when it can't resolve a chunk (or a window cited
// none), the bracketed citation is simply omitted for that entry.
// IMPORTANT: `p.note` is used verbatim — never slice/truncate it here or in
// any caller that assembles the final APSR/checklist/finding text. The only
// place notes are shortened is the compact one-line "Gap detail" bullet list
// in useWorkspaceStore.ts (noteSummary()), which is a deliberately abbreviated
// overview and separate from this full-observation rendering.
function renderWindowNotes(parts: WindowNote[], fallback: string, resolveFile?: (chunkId: string) => string | undefined): string {
  if (parts.length === 0) return fallback;
  // Numbered by POSITION in this contributing list (i + 1), not by
  // `p.window` (the note's absolute position in the whole sliding-window
  // sweep). Using the absolute window number meant the very first window to
  // find nothing (e.g. window 1 covered="No") left a gap: window 2's note
  // would render as "#2:" with no "#1:" ever appearing. Every list must
  // start at #1 regardless of which windows actually contributed.
  return parts.map((p, i) => {
    const citation = p.chunkIds
      .map((cid) => {
        const file = resolveFile?.(cid);
        return file ? `${file} · ${cid}` : cid;
      })
      .join(", ");
    const label = citation ? `#${i + 1} [${citation}]` : `#${i + 1}`;
    return `${label}:\n${p.note}`;
  }).join("\n\n");
}

function buildStagedPointsBlock(auditPoints: FlatAuditPoint[]): string {
  return auditPoints.map((p, i) =>
    `[${p.ref}] (${i + 1}) ${p.text}${p.parentText ? ` [parent: ${p.parentText}]` : ""}`
  ).join("\n");
}

// Stage 2: Policy Adequacy Audit.
// Reads POLICY documents only; checks if each FlatAuditPoint has a documented
// approach. Does NOT look at evidence documents or outcome data.
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedPolicyAudit(
  auditPoints: FlatAuditPoint[],
  policyDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; signal?: AbortSignal; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
): Promise<StagedPolicyAuditResult> {
  if (auditPoints.length === 0 || !policyDocText.trim()) {
    return { rows: auditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as StagedCoverageStatus, note: "No policy documents provided.", chunkIds: [] })), windowsProcessed: 0, totalCharsAssessed: 0, totalCharsAvailable: 0, fullCoverage: true };
  }
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // Built per actual AI call (inside the window/batch loop below) rather than
  // once for the whole function — buildSystemPrompt() has a dev-only debug-log
  // side effect, and the debug log is meant to show every real chatComplete()
  // call. Building it once here (as before) meant only one entry ever appeared
  // for a stage that can make many real calls across windows. The label is the
  // only thing that varies between calls; the resulting prompt text sent to the
  // AI is unchanged from before.
  const buildSystem = (label: string) => `You are auditing ONLY the POLICY & PROCEDURE documents for a GD4 EduTrust sub-criterion. Your task for each audit point: does this institution's policy documentation DOCUMENT an approach that addresses this requirement? You are assessing APPROACH only — not whether it is implemented, not whether outcomes are achieved.

Decide deterministically by counting which of the four specifics are documented — WHO owns it, WHAT they do, WHEN/how often, and WHAT record results — the same policy text must always yield the same verdict:
"Yes" = all four specifics are documented (named owner, the action, timing/frequency, and the resulting record). Full, specific, sustainable.
"Partial" = the requirement is addressed but ONE OR MORE of the four specifics is missing or is boilerplate not specific to this institution. Name which specific is missing.
"No" = the policy does not address this requirement at all.
BOUNDARY RULE (Yes vs Partial): if you can name even one missing specific (owner / action / timing / record), it is "Partial", not "Yes". When unsure between "Yes" and "Partial", choose "Partial" (resolve down).

IMPORTANT: Do NOT credit evidence of implementation (records, logs, filled forms) as policy. A record of doing something is NOT a documented approach.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the coverage verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(policyDocText);
  const totalCharsAvailable = policyDocText.length;

  // Accumulate best verdict per ref across all windows. `notes` collects one
  // entry per window that found specific (non-"No") coverage, so the final
  // note can cite every contributing window instead of discarding all but
  // whichever window happened to win the coverage-priority merge.
  const bestByRef = new Map<string, { covered: StagedCoverageStatus; notes: WindowNote[]; negNote?: WindowNote; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // Stop = user skip/cancel (shouldStop) or an aborted signal. A stopped run
  // must report itself as partial and must NOT fabricate verdicts for points
  // it never put in front of the AI.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      // Emit progress before EVERY batch, not just once per window. Each window
      // makes `batches.length` sequential AI calls; the store uses this callback
      // to refresh the audit heartbeat, so emitting only once per window let the
      // stuck-detector fire mid-window during normal (slow) operation, which
      // misled users into hitting "Skip pass" and cutting the run short.
      opts.onProgress?.(`Policy audit — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      const pointsBlock = buildStagedPointsBlock(batch);
      const user = `Policy & Procedure documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for APPROACH coverage:\n${pointsBlock}`;
      const system = buildSystem(windows.length > 1 ? `runStagedPolicyAudit (window ${win.index + 1}/${win.total})` : "runStagedPolicyAudit");
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        for (const p of batch) {
          const r = byRef.get(normalizeAuditRef(p.ref));
          const covered = (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus)
            ? (r!.covered as StagedCoverageStatus) : "No";
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, {
              covered,
              notes: covered !== "No" ? pushWindowNote([], win.index, note, chunkIds) : [],
              negNote: covered === "No" ? betterNegNote(undefined, win.index, note, chunkIds) : undefined,
              chunkIds,
            });
          } else {
            const merged = mergeCoverage(prev.covered, covered);
            const mergedNotes = covered !== "No" ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedNeg = covered === "No" ? betterNegNote(prev.negNote, win.index, note, chunkIds) : prev.negNote;
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            bestByRef.set(p.ref, { covered: merged, notes: mergedNotes, negNote: mergedNeg, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        // A cancel/abort surfaces here as a thrown "AI call cancelled." — that
        // is a stop, not a failure: no error row, no "No" fabrication.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Policy window ${win.index + 1}/${win.total}` : "Policy AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedPolicyAudit]", errNote);
        // Do NOT seed a "No" for the failed batch's points — an API failure is
        // not an assessed gap. Points that never get a verdict in ANY window
        // become "Not assessed" rows below, exactly like a stopped run.
      }
    }
    // A window whose batch sweep was cut short is NOT a completed window —
    // counting it (as before) made a stopped run report fullCoverage=true.
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  const rows: PolicyCoverageRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    // A stopped run OR a batch whose AI call failed in every window leaves the
    // point with no verdict at all — mark it Not assessed instead of
    // fabricating a "No" (a false negative that would flow into checklist
    // statuses and findings).
    if (!best) {
      const reason = stoppedEarly
        ? "the run was stopped before this audit point was reviewed"
        : "the AI call for this audit point failed in every window it was sent to";
      return { ref: p.ref, pointText: p.text, covered: "No" as StagedCoverageStatus, note: `Not assessed — ${reason}. No verdict was produced.`, chunkIds: [], notAssessed: true };
    }
    const fallback = `No relevant policy evidence found in the ${windowsCompleted} window(s) reviewed.`;
    // Positive-coverage notes win; for a pure gap, surface the retained
    // negative note (specific SSG observation) instead of the generic fallback.
    const noteParts = best.notes.length ? best.notes : best.negNote ? [best.negNote] : [];
    return {
      ref: p.ref, pointText: p.text,
      covered: best.covered,
      note: renderWindowNotes(noteParts, fallback, opts.resolveChunkFile),
      chunkIds: best.chunkIds,
    };
  });

  const notAssessedCount = rows.filter((r) => r.notAssessed).length;
  // Full coverage means every window completed AND every point actually got a
  // verdict — a run where a batch failed in all windows is PARTIAL even though
  // the window loop technically finished.
  const fullCoverage = !stoppedEarly && windowsCompleted === windows.length && notAssessedCount === 0;
  const truncationNote = !fullCoverage
    ? `Policy content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). Assessed ${auditPoints.length - notAssessedCount} of ${auditPoints.length} audit points.${notAssessedCount > 0 ? ` ${notAssessedCount} audit point(s) were NOT assessed (${stoppedEarly ? "run stopped early" : "AI call failures"}); results are PARTIAL.` : ` ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`}`
    : undefined;

  return { rows, usage, promptSent: firstPromptSent, truncationNote, windowsProcessed: windowsCompleted, totalCharsAssessed, totalCharsAvailable, fullCoverage, windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}

// Stage 3: Evidence Implementation Audit.
// Reads EVIDENCE documents only; checks if each FlatAuditPoint has actual
// implementation evidence. Receives policy results so it can distinguish
// "policy exists but not implemented" from "nothing at all".
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedEvidenceAudit(
  auditPoints: FlatAuditPoint[],
  evidenceDocText: string,
  policyRows: PolicyCoverageRow[],
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; signal?: AbortSignal; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
): Promise<StagedEvidenceAuditResult> {
  if (auditPoints.length === 0 || !evidenceDocText.trim()) {
    return { rows: auditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as StagedCoverageStatus, note: "No evidence documents provided.", chunkIds: [] })), windowsProcessed: 0, totalCharsAssessed: 0, totalCharsAvailable: 0, fullCoverage: true };
  }
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";
  const policyByRef = new Map(policyRows.map((r) => [r.ref, r]));

  // See runStagedPolicyAudit's comment on `buildSystem`: built per actual AI
  // call (inside the loop below) so the debug log gets one entry per real
  // chatComplete() call instead of a single entry for the whole stage.
  const buildSystem = (label: string) => `You are auditing ONLY the ACTUAL EVIDENCE documents for a GD4 EduTrust sub-criterion. Your task: does the evidence show that the institution actually IMPLEMENTS each requirement in practice? You are assessing PROCESSES only — not the documented policy (assessed separately), not outcomes.

Decide "covered" deterministically — the same evidence must always yield the same verdict; count records, do not judge "feel":
"Yes" = at least one real implementation record (log, form, screenshot, register, operational record) directly demonstrates this requirement being carried out, AND nothing indicates it was done only once/partially. Cite the record.
"Partial" = implementation records exist but are INCOMPLETE by a concrete, stateable measure — covers only part of the review period, a single instance where the requirement implies a recurring process, or only some of the requirement's sub-parts. You MUST name which part is missing.
"No" = no implementation record in these documents demonstrates this requirement at all.
BOUNDARY RULE (Yes vs Partial): award "Yes" only when the evidence covers the requirement in FULL; if any nameable part is uncovered, it is "Partial", not "Yes". If you cannot name what is missing, it is "Yes"; if you can, it is "Partial". When genuinely unsure between "Yes" and "Partial", choose "Partial" (resolve down).

IMPORTANT: A policy document, SOP, or procedure does NOT count as implementation evidence, even if it is filed in the evidence folder. Only actual records of doing something count.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(evidenceDocText);
  const totalCharsAvailable = evidenceDocText.length;

  const bestByRef = new Map<string, { covered: StagedCoverageStatus; notes: WindowNote[]; negNote?: WindowNote; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      // Per-batch heartbeat — see the note in runStagedPolicyAudit.
      opts.onProgress?.(`Evidence audit — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      const pointsBlock = batch.map((p, i) => {
        const pol = policyByRef.get(p.ref);
        const polNote = pol ? ` [Policy adequacy: ${pol.covered}${pol.covered !== "No" ? ` — "${pol.note.slice(0, 80)}"` : ""}]` : "";
        return `[${p.ref}] (${i + 1}) ${p.text}${p.parentText ? ` [parent: ${p.parentText}]` : ""}${polNote}`;
      }).join("\n");
      const user = `Actual evidence documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for IMPLEMENTATION evidence:\n${pointsBlock}`;
      const system = buildSystem(windows.length > 1 ? `runStagedEvidenceAudit (window ${win.index + 1}/${win.total})` : "runStagedEvidenceAudit");
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        for (const p of batch) {
          const r = byRef.get(normalizeAuditRef(p.ref));
          const covered = (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus)
            ? (r!.covered as StagedCoverageStatus) : "No";
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, {
              covered,
              notes: covered !== "No" ? pushWindowNote([], win.index, note, chunkIds) : [],
              negNote: covered === "No" ? betterNegNote(undefined, win.index, note, chunkIds) : undefined,
              chunkIds,
            });
          } else {
            const merged = mergeCoverage(prev.covered, covered);
            const mergedNotes = covered !== "No" ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedNeg = covered === "No" ? betterNegNote(prev.negNote, win.index, note, chunkIds) : prev.negNote;
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            bestByRef.set(p.ref, { covered: merged, notes: mergedNotes, negNote: mergedNeg, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Evidence window ${win.index + 1}/${win.total}` : "Evidence AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedEvidenceAudit]", errNote);
        // See runStagedPolicyAudit: an API failure is not an assessed gap —
        // never-assessed points become "Not assessed" rows below.
      }
    }
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  const rows: EvidenceCoverageRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    if (!best) {
      const reason = stoppedEarly
        ? "the run was stopped before this audit point was reviewed"
        : "the AI call for this audit point failed in every window it was sent to";
      return { ref: p.ref, pointText: p.text, covered: "No" as StagedCoverageStatus, note: `Not assessed — ${reason}. No verdict was produced.`, chunkIds: [], notAssessed: true };
    }
    const fallback = `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`;
    // Positive-coverage notes win; for a pure gap, surface the retained
    // negative note (specific SSG observation) instead of the generic fallback.
    const noteParts = best.notes.length ? best.notes : best.negNote ? [best.negNote] : [];
    return {
      ref: p.ref, pointText: p.text,
      covered: best.covered,
      note: renderWindowNotes(noteParts, fallback, opts.resolveChunkFile),
      chunkIds: best.chunkIds,
    };
  });

  const notAssessedCount = rows.filter((r) => r.notAssessed).length;
  // See runStagedPolicyAudit: an all-window batch failure makes the run PARTIAL.
  const fullCoverage = !stoppedEarly && windowsCompleted === windows.length && notAssessedCount === 0;
  const truncationNote = !fullCoverage
    ? `Evidence content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). Assessed ${auditPoints.length - notAssessedCount} of ${auditPoints.length} audit points.${notAssessedCount > 0 ? ` ${notAssessedCount} audit point(s) were NOT assessed (${stoppedEarly ? "run stopped early" : "AI call failures"}); results are PARTIAL.` : ` ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`}`
    : undefined;

  return { rows, usage, promptSent: firstPromptSent, truncationNote, windowsProcessed: windowsCompleted, totalCharsAssessed, totalCharsAvailable, fullCoverage, windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}

// Stage 4: Outcome & Review Audit.
// Reads ALL documents; checks for outcome data (Systems & Outcomes) and
// review/improvement records (Review). Both outcomes and review are assessed
// together in one call since they both require looking at all documents.
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedOutcomeReviewAudit(
  auditPoints: FlatAuditPoint[],
  allDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; signal?: AbortSignal; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
): Promise<StagedOutcomeReviewAuditResult> {
  if (auditPoints.length === 0 || !allDocText.trim()) {
    return { rows: auditPoints.map((p) => ({ ref: p.ref, pointText: p.text, outcomeEvident: false, reviewEvident: false, note: "No documents provided.", chunkIds: [] })), windowsProcessed: 0, totalCharsAssessed: 0, totalCharsAvailable: 0, fullCoverage: true };
  }
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // See runStagedPolicyAudit's comment on `buildSystem`: built per actual AI
  // call (inside the loop below) so the debug log gets one entry per real
  // chatComplete() call instead of a single entry for the whole stage.
  const buildSystem = (label: string) => `You are auditing ALL documents (policy and evidence combined) for outcome data and review/improvement records for a GD4 EduTrust sub-criterion. For each audit point assess:

outcomeEvident: true if there is actual outcome data, KPIs, results, trends, survey data, or performance measurements for this requirement — not just a statement that outcomes will be tracked. The data must cover the review period, name targets or results, and show actual numbers or trends.

reviewEvident: true if there are records of a formal review of this requirement's effectiveness — meeting minutes with agenda item, management review records, improvement actions triggered by data review, or evaluation reports. A policy that says "we will review annually" is NOT evidence of a review having happened.

Cite chunk IDs from document headers in chunkIds. Leave chunkIds empty if no chunk directly supports a true verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "outcomeEvident": boolean, "reviewEvident": boolean, "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(allDocText);
  const totalCharsAvailable = allDocText.length;

  // For outcome/review: OR across windows (true if any window finds evidence).
  const bestByRef = new Map<string, { outcomeEvident: boolean; reviewEvident: boolean; notes: WindowNote[]; negNote?: WindowNote; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      // Per-batch heartbeat — see the note in runStagedPolicyAudit.
      opts.onProgress?.(`Outcome/review audit — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      const pointsBlock = buildStagedPointsBlock(batch);
      const user = `All documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for OUTCOME DATA and REVIEW RECORDS:\n${pointsBlock}`;
      const system = buildSystem(windows.length > 1 ? `runStagedOutcomeReviewAudit (window ${win.index + 1}/${win.total})` : "runStagedOutcomeReviewAudit");
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        for (const p of batch) {
          const r = byRef.get(normalizeAuditRef(p.ref));
          const outcomeEvident = r?.outcomeEvident === true;
          const reviewEvident = r?.reviewEvident === true;
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const foundSomething = outcomeEvident || reviewEvident;
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, {
              outcomeEvident, reviewEvident,
              notes: foundSomething ? pushWindowNote([], win.index, note, chunkIds) : [],
              negNote: foundSomething ? undefined : betterNegNote(undefined, win.index, note, chunkIds),
              chunkIds,
            });
          } else {
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            const newOutcome = prev.outcomeEvident || outcomeEvident;
            const newReview = prev.reviewEvident || reviewEvident;
            const mergedNotes = foundSomething ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedNeg = foundSomething ? prev.negNote : betterNegNote(prev.negNote, win.index, note, chunkIds);
            bestByRef.set(p.ref, { outcomeEvident: newOutcome, reviewEvident: newReview, notes: mergedNotes, negNote: mergedNeg, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Outcome/review window ${win.index + 1}/${win.total}` : "Outcome/review AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedOutcomeReviewAudit]", errNote);
        // See runStagedPolicyAudit: an API failure is not an assessed gap —
        // never-assessed points become "Not assessed" rows below.
      }
    }
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  const rows: OutcomeReviewRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    if (!best) {
      const reason = stoppedEarly
        ? "the run was stopped before this audit point was reviewed"
        : "the AI call for this audit point failed in every window it was sent to";
      return { ref: p.ref, pointText: p.text, outcomeEvident: false, reviewEvident: false, note: `Not assessed — ${reason}. No verdict was produced.`, chunkIds: [], notAssessed: true };
    }
    const fallback = `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`;
    // When neither outcome nor review evidence was found, surface the retained
    // negative note (specific SSG observation) instead of the generic fallback.
    const noteParts = best.notes.length ? best.notes : best.negNote ? [best.negNote] : [];
    return {
      ref: p.ref, pointText: p.text,
      outcomeEvident: best.outcomeEvident,
      reviewEvident: best.reviewEvident,
      note: renderWindowNotes(noteParts, fallback, opts.resolveChunkFile),
      chunkIds: best.chunkIds,
    };
  });

  const notAssessedCount = rows.filter((r) => r.notAssessed).length;
  // See runStagedPolicyAudit: an all-window batch failure makes the run PARTIAL.
  const fullCoverage = !stoppedEarly && windowsCompleted === windows.length && notAssessedCount === 0;
  const truncationNote = !fullCoverage
    ? `Outcome/review content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). Assessed ${auditPoints.length - notAssessedCount} of ${auditPoints.length} audit points.${notAssessedCount > 0 ? ` ${notAssessedCount} audit point(s) were NOT assessed (${stoppedEarly ? "run stopped early" : "AI call failures"}); results are PARTIAL.` : ` ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`}`
    : undefined;

  return { rows, usage, promptSent: firstPromptSent, truncationNote, windowsProcessed: windowsCompleted, totalCharsAssessed, totalCharsAvailable, fullCoverage, windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}

// Stage 5: Deterministic APSR verdict builder.
// Maps the three coverage matrices to the four APSR dimensions WITHOUT any AI call.
// Key rule: policy coverage → Approach, evidence coverage → Processes,
// outcome data → Systems & Outcomes, review records → Review.
// Policy documents cannot satisfy Processes; evidence documents cannot satisfy Approach
// (unless they contain a procedure, but that classification happens in Stage 2/3).
//
// opts.requireCitations (live AI runs): a positive dimension status with no
// cited chunk IDs is downgraded one level — a verdict that cannot point at
// the source text that supports it must not carry a full positive rating.
// Offline keyword simulation never produces chunk IDs, so callers pass this
// only for live runs (leaving simulate-based rows on the old behaviour would
// otherwise be impossible).
const UNCITED_DOWNGRADE_NOTE ="Downgraded: no source chunks cited to support this verdict.";

export function buildStagedApsr(
  policyRow: PolicyCoverageRow | undefined,
  evidenceRow: EvidenceCoverageRow | undefined,
  outcomeRow: OutcomeReviewRow | undefined,
  opts: { requireCitations?: boolean } = {}
): ApsrBreakdown {
  const uncited = (chunkIds: string[] | undefined) => !!opts.requireCitations && (!chunkIds || chunkIds.length === 0);
  const downgradedNote = (note: string) => `${note ? `${note}\n\n` : ""}${UNCITED_DOWNGRADE_NOTE}`;

  // Approach — from policy adequacy only
  const approach: ApsrBreakdown["approach"] = policyRow?.covered === "Yes"
    ? uncited(policyRow.chunkIds)
      ? { status: "Beginning", note: downgradedNote(policyRow.note), sourceChunkIds: [] }
      : { status: "Meeting", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
    : policyRow?.covered === "Partial"
      ? { status: "Beginning", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
      : { status: "Not evident", note: policyRow?.note || "No policy documentation found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Processes — from evidence coverage only
  const processes: ApsrBreakdown["processes"] = evidenceRow?.covered === "Yes"
    ? uncited(evidenceRow.chunkIds)
      ? { status: "Weak", note: downgradedNote(evidenceRow.note), sourceChunkIds: [] }
      : { status: "Deployed", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
    : evidenceRow?.covered === "Partial"
      ? { status: "Weak", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
      : { status: "Not evident", note: evidenceRow?.note || "No implementation evidence found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Systems & Outcomes — from outcome data
  const systemsOutcomes: ApsrBreakdown["systemsOutcomes"] = outcomeRow?.outcomeEvident
    ? uncited(outcomeRow.chunkIds)
      ? { status: "Limited", note: downgradedNote(outcomeRow.note), sourceChunkIds: [] }
      : { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
    : { status: "Not evident", note: outcomeRow?.note || "No outcome data (KPIs, results, trends) found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Review — from review records. Review's union is binary
  // ("Evident" | "Not evident"), so one level down IS "Not evident".
  const review: ApsrBreakdown["review"] = outcomeRow?.reviewEvident
    ? uncited(outcomeRow.chunkIds)
      ? { status: "Not evident", note: downgradedNote(outcomeRow.note), sourceChunkIds: [] }
      : { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
    : { status: "Not evident", note: outcomeRow?.note || "No review or improvement records found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  return { approach, processes, systemsOutcomes, review };
}

// Simulate staged audit (offline, no AI) — produces deterministic coverage rows
// from the document text using keyword matching, mirroring the same heuristic
// as simulateFolderAudit but per-audit-point rather than per-checklist-line.
export function simulateStagedPolicyAudit(auditPoints: FlatAuditPoint[], policyDocText: string): PolicyCoverageRow[] {
  const docLower = policyDocText.toLowerCase();
  return auditPoints.map((p) => {
    const words = p.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const matches = words.filter((w) => docLower.includes(w)).length;
    const covered: StagedCoverageStatus = matches >= 3 ? "Yes" : matches >= 1 ? "Partial" : "No";
    return { ref: p.ref, pointText: p.text, covered, note: `Offline estimate: ${matches} of ${words.length} keywords found in policy documents.`, chunkIds: [] };
  });
}

export function simulateStagedEvidenceAudit(auditPoints: FlatAuditPoint[], evidenceDocText: string): EvidenceCoverageRow[] {
  const docLower = evidenceDocText.toLowerCase();
  return auditPoints.map((p) => {
    const words = p.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const matches = words.filter((w) => docLower.includes(w)).length;
    const covered: StagedCoverageStatus = matches >= 3 ? "Yes" : matches >= 1 ? "Partial" : "No";
    return { ref: p.ref, pointText: p.text, covered, note: `Offline estimate: ${matches} of ${words.length} keywords found in evidence documents.`, chunkIds: [] };
  });
}

export function simulateStagedOutcomeReview(auditPoints: FlatAuditPoint[], allDocText: string): OutcomeReviewRow[] {
  const docLower = allDocText.toLowerCase();
  const outcomeWords = ["outcome", "result", "kpi", "trend", "survey", "data", "rate", "percentage", "score", "target"];
  const reviewWords = ["review", "minute", "meeting", "decision", "improvement", "action", "evaluate"];
  const hasOutcome = outcomeWords.some((w) => docLower.includes(w));
  const hasReview = reviewWords.some((w) => docLower.includes(w));
  return auditPoints.map((p) => ({
    ref: p.ref, pointText: p.text,
    outcomeEvident: hasOutcome,
    reviewEvident: hasReview,
    note: `Offline estimate: outcome keywords ${hasOutcome ? "found" : "not found"}, review keywords ${hasReview ? "found" : "not found"}.`,
    chunkIds: [],
  }));
}

// ─── PPD Requirements Review ────────────────────────────────────────────────
// Reads ONLY the Policy & Procedure Document(s) for a sub-criterion and, for
// EACH GD4 requirement LINE (one FlatAuditPoint — a Describe/Show bullet,
// not the whole requirement item), decides whether the PPD documents it,
// with a suggested rewrite for anything short of Adequate. Orchestration
// (reading the Policy folder, calling this, logging to the AI Review Log)
// lives in useWorkspaceStore.runPPDReview — this function only makes the AI
// call(s), same division of responsibility as every other function in this
// file.

export type PPDRequirementInput = { ref: string; gd4ItemId: string; requirementText: string };

export type PPDRequirementsReviewResult = {
  rows: PPDReviewRow[];
  // Internal contradictions found by the dedicated per-window hunt pass.
  contradictions?: PPDContradiction[];
  // A 2-4 sentence AI synthesis of the whole sub-criterion (strongest areas,
  // where the gaps are) — a roll-up, not a repeat of the per-line comments.
  // undefined if the narrative call failed or was skipped.
  overallNarrative?: string;
  usage?: AIUsage;
  promptSent?: string;
  windowsProcessed?: number;
  fullCoverage?: boolean;
  // Failed window/batch AI calls — the caller must surface these; a run with
  // errors must never present as a clean success (a revoked key mid-run used
  // to yield all-"Not documented" rows logged as successful).
  windowErrors?: string[];
  // True when the run was stopped/aborted before every line was reviewed.
  stoppedEarly?: boolean;
};

// "Not assessed" ranks below everything: it is a placeholder, never an AI
// verdict, so any real verdict replaces it in the cross-window merge.
const PPD_VERDICT_ORDER: Record<PPDVerdict, number> = { "Not assessed": -1, "Not documented": 0, "Partial": 1, "Adequate": 2 };

// Fix for the PPD-quote hallucination channel: the prompt asks for verbatim
// excerpts in double quotes, but nothing checked they exist in the source.
// This deterministic verifier extracts every substantial quoted span from a
// fullComment and substring-checks it against the (whitespace/quote-
// normalised) source text. Failing quotes are NOT dropped — the comment is
// annotated so the auditor knows the "quote" is unverified.
const QUOTE_MIN_CHARS = 20;
function normaliseForQuoteMatch(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
// Deterministic single-quote check for structured fields (promise
// sourceQuote, contradiction quoteA/quoteB) — same normalisation rules as
// flagUnverifiedQuotes. Short quotes pass (term names, "Adequate", etc.).
export function quoteExistsInSource(quote: string, sourceText: string): boolean {
  const inner = quote.replace(/^(\.{3}|…)\s*/, "").replace(/\s*(\.{3}|…)$/, "").trim();
  if (inner.length < QUOTE_MIN_CHARS) return true;
  return normaliseForQuoteMatch(sourceText).includes(normaliseForQuoteMatch(inner));
}

// A named clause reference counts as REAL only when it — or its leading heading
// segment, before the first comma — appears verbatim in the source (same
// anti-hallucination stance as quote verification). A model-tidied or invented
// reference fails this and is dropped, so the lineage map shows an honest
// em-dash rather than a clause an assessor would navigate to and never find.
// The comma fallback lets a legitimate "4.2 Heading, Step 1: Sub-heading"
// pass when the document splits heading and sub-heading across lines.
export function clauseAppearsInSource(clause: string, sourceText: string): boolean {
  const c = clause.trim();
  if (c.length < 4) return false;
  if (quoteExistsInSource(c, sourceText)) return true;
  const head = c.split(",")[0].trim();
  return head.length >= 4 && head !== c && quoteExistsInSource(head, sourceText);
}
const UNVERIFIED_QUOTE_NOTE = " [⚠ unverified quote — not found in source]";

export function flagUnverifiedQuotes(fullComment: string, sourceText: string): string {
  if (!fullComment || !sourceText) return fullComment;
  const sourceNorm = normaliseForQuoteMatch(sourceText);
  const commentNorm = fullComment.replace(/[“”]/g, '"');
  const unverified: string[] = [];
  const quoteRe = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(commentNorm)) !== null) {
    // Strip the leading/trailing ellipses the prompt's example format uses —
    // they mark elision, not literal source characters.
    const inner = m[1].replace(/^(\.{3}|…)\s*/, "").replace(/\s*(\.{3}|…)$/, "").trim();
    if (inner.length < QUOTE_MIN_CHARS) continue; // skip short incidental quotes ("Adequate", term names)
    if (!sourceNorm.includes(normaliseForQuoteMatch(inner))) unverified.push(inner);
  }
  if (unverified.length === 0) return fullComment;
  const flags = unverified
    .slice(0, 3)
    .map((q) => `⚠ "${q.length > 80 ? `${q.slice(0, 80)}…` : q}" — unverified: not found in source.`)
    .join("\n");
  const more = unverified.length > 3 ? `\n⚠ …and ${unverified.length - 3} more unverified quote(s).` : "";
  return `${fullComment}\n\n${flags}${more}`;
}

// Purely-observational live events emitted as the review proceeds, so the UI
// can show a detailed activity view (same idea as EvidenceRunEvent above).
// Emitting them changes no assessment behaviour — they mirror the window/
// batch loop the run already performs.
export type PPDRunEvent =
  | { type: "window-start"; window: { current: number; total: number }; refs: string[] }
  | { type: "batch-done"; verdicts: { ref: string; verdict: PPDVerdict }[] }
  | { type: "batch-failed"; refs: string[] };

export async function runPPDRequirementsReview(
  requirements: PPDRequirementInput[],
  policyDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; onProgress?: (detail: string) => void; onEvent?: (ev: PPDRunEvent) => void; shouldStop?: () => boolean; signal?: AbortSignal } = {}
): Promise<PPDRequirementsReviewResult> {
  if (requirements.length === 0 || !policyDocText.trim()) {
    return {
      rows: requirements.map((r) => ({
        ref: r.ref,
        gd4ItemId: r.gd4ItemId,
        requirementText: r.requirementText,
        verdict: "Not documented" as PPDVerdict,
        shortComment: "No Policy & Procedure documents were provided.",
        fullComment: "No Policy & Procedure documents were found for this sub-criterion, so this requirement cannot be assessed as documented.",
        chunkIds: [],
      })),
    };
  }

  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // Built per actual AI call (inside the window/batch loop below) — see the
  // comment on the equivalent pattern in runStagedPolicyAudit: buildSystemPrompt()
  // has a dev-only AI Debug Log side effect, and every real chatComplete() call
  // should get its own debug-log entry.
  const buildSystem = (label: string) => `You are an SSG EduTrust assessor reviewing ONLY the Policy & Procedure Document (PPD) for a GD4 sub-criterion, requirement by requirement — not implementation evidence, not outcomes. Work the way a real assessor works: decompose, check each obligation, and report specific gaps with named examples — never summarise.

STEP 1 — DECOMPOSE. For each GD4 requirement line, first break it into its constituent sub-clauses: the explicit (a)/(b)/(c) parts if present, otherwise each distinct obligation in the sentence (e.g. "documented (a) a code of conduct AND (b) non-collection of monies" = two sub-clauses). Then give a per-sub-clause verdict: "documented" or "not documented" in the PPD, AND — independently for each sub-clause — the ONE exact sentence copied VERBATIM from the cited chunk that documents THAT specific sub-clause (not the whole line). A sub-clause that is "not documented" gets an empty quote — never invent one to fill the gap, and never reuse one sub-clause's quote for another. For each sub-clause ALSO record: (i) clause — the named section reference of the SOURCE document where you found it, COPIED EXACTLY from a heading that actually appears in the cited chunk text (e.g. "4.2 Competency-Based Recruitment and Selection Strategy, Step 1: Manpower Planning and Deployment"); if the cited chunk shows no identifiable heading for this passage, return "" — NEVER construct, infer, tidy up or guess a clause reference, because an assessor will try to navigate to it and an invented one is worse than none; (ii) rationale — ONE short auditor-register sentence stating WHY this sub-clause is or is not documented (distinct from the quote), or "" if you cannot state a reason beyond the quote itself; (iii) chunkId — the single chunk ID the quote came from, or "" if none.

STEP 2 — DERIVE the line verdict from the sub-clauses:
"Adequate" = EVERY sub-clause is documented clearly, specifically and sustainably (named responsible role, what they do, when/how often, what record is produced).
"Partial" = some sub-clauses documented, others missing or vague — the comment MUST name exactly which sub-clauses are missing, e.g. "Sub-clause (b) — non-collection of monies from students — is not addressed in any PPD passage."
"Not documented" = no sub-clause is addressed at all.

STEP 3 — EXTRACT PROMISES. List every specific, verifiable commitment the PPD makes for this requirement: named mechanisms ("peer reviews"), frequencies ("annually", "within 5 working days"), scopes ("all part-time academic staff"), named roles, named records. Each promise needs its verbatim source quote and chunk ID. These are verified against implementation records in a later pass — extract only what the PPD actually commits to, never invent.

PHRASING REGISTER (mandatory):
- Negative verdicts use the official SSG register: "It was not evident that the PEI had documented [the specific process/sub-clause(s)] in its PPD…" — name the specific missing obligations, listing sub-clauses where multiple.
- Every Partial or Not documented verdict MUST cite at least one concrete example from the documents — the specific document name, section, version or passage that demonstrates the gap (or, for a wholly absent topic, name the documents searched). A negative verdict without a concrete example is unsupported and unacceptable.
- Positive verdicts stay factual and specific (what is documented, in which document/section) — no praise adjectives, no "good"/"structured framework"/"comprehensive".

For each requirement return:
- subClauses: [{text: string, verdict: "documented"|"not documented", quote: string, clause: string, rationale: string, chunkId: string}] — the STEP 1 decomposition. One entry per sub-clause, text naming that obligation tightly (by what it IS, e.g. "Manpower planning"). quote = the exact verbatim sentence supporting THAT sub-clause specifically (empty string "" for "not documented" sub-clauses, or when no single sentence captures it) — never the whole line's quote, never invented. clause = the source document's own section heading for this sub-clause, copied verbatim from the cited chunk, or "" if the chunk shows no identifiable heading — never invented or tidied. rationale = one short auditor-register sentence on why it is/isn't documented, or "" if none distinct from the quote. chunkId = the chunk ID the quote came from, or "".
- verdict: "Adequate" | "Partial" | "Not documented" — derived per STEP 2.
- shortComment: one sentence; for negatives use the SSG register and name the missing sub-clause(s).
- fullComment: (1) the justification — for Adequate state specifically WHAT makes it adequate (named owner, frequency, record and where documented); for Partial/Not documented use the SSG register, name each missing sub-clause, and give the concrete example. (2) a verbatim quoted excerpt from the PPD in double quotes followed by its chunk ID, e.g. "...auditors must be independent of the area they audit..." (C001). For "Not documented" state that no PPD passage addresses this requirement instead of inventing a quote. Factual and neutral throughout.
- promises: [{promiseText: string, sourceQuote: string, chunkId: string}] — the STEP 3 extraction. Empty array if the PPD makes no specific commitment for this line.
- suggestedRewrite: for Partial or Not documented ONLY — a concrete, institution-ready PPD paragraph closing the gap (responsible role, frequency, record). Empty string for Adequate.
- chunkIds: exact chunk ID(s) (e.g. "C001") supporting the verdict. Empty if none — never invent a chunk ID.
- supportQuote: for Adequate/Partial ONLY, the ONE exact sentence (or short clause) copied VERBATIM from the cited chunk text that most directly documents this requirement — character-for-character, so it can be located in the source. If no single sentence captures it (support is spread across the passage) or the verdict is Not documented, return an empty string "" — never paraphrase, summarise, or invent a quote.

Respond with JSON only:
{"results": [{"ref": string, "subClauses": [{"text": string, "verdict": "documented"|"not documented", "quote": string, "clause": string, "rationale": string, "chunkId": string}], "verdict": "Adequate"|"Partial"|"Not documented", "shortComment": string, "fullComment": string, "promises": [{"promiseText": string, "sourceQuote": string, "chunkId": string}], "suggestedRewrite": string, "chunkIds": string[], "supportQuote": string}]}${buildSystemPrompt("evidenceReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;

  // Technique 2 — internal contradiction hunt. Run as its OWN pass per
  // window (not folded into the per-requirement prompt) so the requirement
  // batches stay within budget and the hunt reads the window whole.
  const contradictionSystem = (label: string) => `You are an SSG EduTrust assessor reading a PEI's Policy & Procedure Document looking ONLY for INTERNAL CONTRADICTIONS: places where the PPD states two inconsistent values, timelines, percentages, responsibilities, or procedures for the SAME thing (e.g. a refund processed "within 5 working days" in one section and "within 3 working days" in another; two different owners for the same process; two different review frequencies for the same record).

Rules:
- Only report REAL inconsistencies about the same subject — different processes legitimately having different timelines is NOT a contradiction.
- Each contradiction must carry BOTH passages quoted verbatim in double quotes with their chunk IDs. Never invent or paraphrase inside the quotes.
- description: one factual sentence naming the subject and the two conflicting values, in the SSG register (e.g. "The PPD states two different refund timelines for the same process: 'within 5 working days' and 'within 3 working days'.").
- Report nothing if the window contains no contradiction — an empty array is the correct answer for a consistent PPD.

Respond with JSON only: {"contradictions": [{"description": string, "quoteA": string, "chunkA": string, "quoteB": string, "chunkB": string}]}${buildSystemPrompt("evidenceReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;

  const windows = buildDocWindows(policyDocText);

  type BestPPD = { verdict: PPDVerdict; shortComment: string; fullComment: string; suggestedRewrite?: string; chunkIds: string[]; subClauses?: PPDSubClause[]; promises?: PPDPromise[]; supportQuote?: string };
  const bestByRef = new Map<string, BestPPD>();
  // Contradictions merged across windows, deduped on the two quotes.
  const contradictions: PPDContradiction[] = [];
  const contradictionKeys = new Set<string>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const REQ_BATCH_SIZE = 8;
  const batches: PPDRequirementInput[][] = [];
  for (let i = 0; i < requirements.length; i += REQ_BATCH_SIZE) {
    batches.push(requirements.slice(i, i + REQ_BATCH_SIZE));
  }

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()}]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      opts.onProgress?.(`PPD requirements review — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      opts.onEvent?.({ type: "window-start", window: { current: win.index + 1, total: win.total }, refs: batch.map((r) => r.ref) });
      const pointsBlock = batch.map((r, i) => `[${r.ref}] (${i + 1}) ${r.requirementText}`).join("\n");
      const user = `Policy & Procedure documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess PPD documentation for each GD4 requirement line:\n${pointsBlock}`;
      const system = buildSystem(windows.length > 1 ? `runPPDRequirementsReview (window ${win.index + 1}/${win.total})` : "runPPDRequirementsReview");
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        // The call RETURNED but nothing parseable came back — truncated or
        // malformed JSON (parseJSONObject yields {}), or a literal empty
        // results array. Per "never fabricate verdicts from failures", record
        // this as a FAILURE so the affected lines become "Not assessed", NOT a
        // fabricated "Not documented" gap that reads as a real finding. Another
        // window may still fill these lines. (Previously this silently produced
        // a full set of empty "Not documented" verdicts — see the PPD review
        // showing 5 "No verdict returned by the AI" gaps.)
        if (results.length === 0) {
          const label = windows.length > 1 ? `PPD window ${win.index + 1}/${win.total}, batch ${bi + 1}/${batches.length}` : `PPD batch ${bi + 1}/${batches.length}`;
          windowErrors.push(`${label} returned no parseable verdicts — the AI reply was empty or not valid JSON.`);
          console.error("[PPDRequirementsReview]", label, "no parseable results");
          opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref) });
          continue;
        }
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        const batchVerdicts: { ref: string; verdict: PPDVerdict }[] = [];
        for (const [idx, r] of batch.entries()) {
          // Positional recovery: some models keep the requirement order but drop
          // or rename the per-result "ref". When the result count matches the
          // batch, fall back to position so a missing ref never zeroes out an
          // otherwise-good batch.
          const res = byRef.get(normalizeAuditRef(r.ref)) ?? (results.length === batch.length ? results[idx] : undefined);
          const verdict = (["Adequate", "Partial", "Not documented"] as PPDVerdict[]).includes(res?.verdict as PPDVerdict)
            ? (res!.verdict as PPDVerdict) : "Not documented";
          batchVerdicts.push({ ref: r.ref, verdict });
          const shortComment = typeof res?.shortComment === "string" ? res.shortComment : "";
          const fullComment = typeof res?.fullComment === "string" ? res.fullComment : "";
          const suggestedRewrite = typeof res?.suggestedRewrite === "string" && res.suggestedRewrite.trim() ? res.suggestedRewrite : undefined;
          const chunkIds = Array.isArray(res?.chunkIds) ? (res!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          // Exact supporting quote — stored ONLY when it verifies as a real
          // verbatim excerpt of the policy text (same anti-hallucination check as
          // the fullComment/promise quotes). A paraphrase or invention is dropped
          // to undefined ("no exact quote identified"), never stored as a match.
          const rawSupportQuote = typeof res?.supportQuote === "string" ? res.supportQuote.trim() : "";
          const supportQuote = rawSupportQuote && quoteExistsInSource(rawSupportQuote, policyDocText) ? rawSupportQuote : undefined;
          // Per-sub-clause quote: verified against the SAME window text as the
          // whole-line supportQuote — a sub-clause quote that isn't a real
          // verbatim substring is dropped to undefined ("no exact quote
          // identified for this sub-part"), never stored as a fabricated match.
          const subClauses: PPDSubClause[] = Array.isArray(res?.subClauses)
            ? (res!.subClauses as Array<Record<string, unknown>>)
                .filter((c) => typeof c?.text === "string" && (c?.verdict === "documented" || c?.verdict === "not documented"))
                .map((c) => {
                  const rawQuote = typeof c.quote === "string" ? c.quote.trim() : "";
                  const quote = rawQuote && quoteExistsInSource(rawQuote, policyDocText) ? rawQuote : undefined;
                  // Clause is verified against source the same way quotes are:
                  // a reference that isn't really in the document is dropped to
                  // undefined ("no clause identified"), never shown — an invented
                  // clause an assessor would chase is worse than an em-dash.
                  const rawClause = typeof c.clause === "string" ? c.clause.trim() : "";
                  const clause = rawClause && clauseAppearsInSource(rawClause, policyDocText) ? rawClause : undefined;
                  // Rationale is reasoning (like shortComment), not a quotation —
                  // stored as-is when non-empty, never verified/padded.
                  const rationale = typeof c.rationale === "string" && c.rationale.trim() ? c.rationale.trim() : undefined;
                  const chunkId = typeof c.chunkId === "string" && c.chunkId.trim() ? c.chunkId.trim() : undefined;
                  return { text: c.text as string, verdict: c.verdict as PPDSubClause["verdict"], quote, clause, rationale, chunkId };
                })
            : [];
          // Promises carry verbatim source quotes — verify each against the
          // window that produced it (same anti-hallucination rule as
          // fullComment quotes) and annotate failures instead of dropping.
          const promises: PPDPromise[] = Array.isArray(res?.promises)
            ? (res!.promises as Array<Record<string, unknown>>)
                .filter((p) => typeof p?.promiseText === "string" && p.promiseText)
                .map((p) => {
                  const sourceQuote = typeof p.sourceQuote === "string" ? p.sourceQuote : "";
                  return {
                    promiseText: p.promiseText as string,
                    sourceQuote: sourceQuote && !quoteExistsInSource(sourceQuote, policyDocText) ? `${sourceQuote}${UNVERIFIED_QUOTE_NOTE}` : sourceQuote,
                    chunkId: typeof p.chunkId === "string" ? p.chunkId : "",
                  };
                })
            : [];
          const prev = bestByRef.get(r.ref);
          if (!prev || PPD_VERDICT_ORDER[verdict] > PPD_VERDICT_ORDER[prev.verdict]) {
            bestByRef.set(r.ref, {
              verdict, shortComment, fullComment, suggestedRewrite,
              chunkIds: [...new Set([...(prev?.chunkIds ?? []), ...chunkIds])],
              subClauses: subClauses.length > 0 ? subClauses : prev?.subClauses,
              // Union promises across windows (different windows see
              // different PPD sections), deduped on promiseText.
              promises: [...(prev?.promises ?? []), ...promises.filter((p) => !(prev?.promises ?? []).some((q) => q.promiseText === p.promiseText))],
              supportQuote: supportQuote ?? prev?.supportQuote,
            });
          } else {
            bestByRef.set(r.ref, {
              ...prev,
              chunkIds: [...new Set([...prev.chunkIds, ...chunkIds])],
              promises: [...(prev.promises ?? []), ...promises.filter((p) => !(prev.promises ?? []).some((q) => q.promiseText === p.promiseText))],
              supportQuote: prev.supportQuote ?? supportQuote,
            });
          }
        }
        opts.onEvent?.({ type: "batch-done", verdicts: batchVerdicts });
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `PPD window ${win.index + 1}/${win.total}, batch ${bi + 1}/${batches.length}` : `PPD batch ${bi + 1}/${batches.length}`;
        windowErrors.push(`${label} failed — ${msg}`);
        console.error("[PPDRequirementsReview]", label, msg);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref) });
      }
    }
    if (stoppedEarly) break;

    // Technique 2 — internal contradiction hunt, one dedicated call per
    // window. Best-effort: a failed hunt is a warning, never a fake finding.
    if (!stopRequested()) {
      opts.onProgress?.(`PPD contradiction hunt — window ${win.index + 1}/${win.total}`);
      const huntLabel = windows.length > 1 ? `runPPDRequirementsReview (contradiction hunt, window ${win.index + 1}/${win.total})` : "runPPDRequirementsReview (contradiction hunt)";
      try {
        const content = await chatComplete(
          [
            { role: "system", content: contradictionSystem(huntLabel) },
            { role: "user", content: `Policy & Procedure documents (chunk IDs in headers)${windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}]` : ""}:\n"""\n${win.text}\n"""\n\nList every internal contradiction, or an empty array if there are none.` },
          ],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const found = Array.isArray(parsed.contradictions) ? parsed.contradictions as Array<Record<string, unknown>> : [];
        for (const c of found) {
          if (typeof c?.description !== "string" || !c.description.trim()) continue;
          const quoteA = typeof c.quoteA === "string" ? c.quoteA : "";
          const quoteB = typeof c.quoteB === "string" ? c.quoteB : "";
          const key = normaliseForQuoteMatch(`${quoteA}::${quoteB}`);
          if (contradictionKeys.has(key)) continue;
          contradictionKeys.add(key);
          contradictions.push({
            description: c.description.trim(),
            quoteA: quoteA && !quoteExistsInSource(quoteA, policyDocText) ? `${quoteA}${UNVERIFIED_QUOTE_NOTE}` : quoteA,
            chunkA: typeof c.chunkA === "string" ? c.chunkA : "",
            quoteB: quoteB && !quoteExistsInSource(quoteB, policyDocText) ? `${quoteB}${UNVERIFIED_QUOTE_NOTE}` : quoteB,
            chunkB: typeof c.chunkB === "string" ? c.chunkB : "",
          });
        }
      } catch (err) {
        if (stopRequested()) { stoppedEarly = true; break; }
        windowErrors.push(`Contradiction hunt (window ${win.index + 1}/${win.total}) failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    windowsCompleted++;
  }

  const rows: PPDReviewRow[] = requirements.map((r) => {
    const best = bestByRef.get(r.ref);
    // A line never put in front of the AI (run stopped early, or every call
    // that covered it failed) gets the neutral "Not assessed" — NOT a
    // fabricated "Not documented" gap.
    if (!best && (stoppedEarly || windowErrors.length > 0)) {
      return {
        ref: r.ref,
        gd4ItemId: r.gd4ItemId,
        requirementText: r.requirementText,
        verdict: "Not assessed" as PPDVerdict,
        shortComment: stoppedEarly ? "Not assessed — the run was stopped before this line was reviewed." : "Not assessed — the AI call covering this line failed.",
        fullComment: stoppedEarly
          ? "Not assessed — the run was stopped before this requirement line was reviewed. Re-run the PPD review to assess it."
          : "Not assessed — the AI call covering this requirement line failed. Re-run the PPD review to assess it.",
        chunkIds: [],
      };
    }
    // An "Adequate" verdict that cannot point at any supporting PPD chunk is
    // downgraded to "Partial" — same uncited-positive rule as buildStagedApsr.
    const uncitedAdequate = best?.verdict === "Adequate" && (best.chunkIds?.length ?? 0) === 0;
    const verdict: PPDVerdict = uncitedAdequate ? "Partial" : (best?.verdict ?? "Not documented");
    const fullComment = best?.fullComment || "No verdict returned by the AI for this requirement — treat as undocumented until re-run.";
    // Quote verification: annotate any quoted excerpt that does not exist
    // verbatim in the source, so hallucinated "quotes" can't pass as real.
    const verifiedComment = flagUnverifiedQuotes(
      uncitedAdequate ? `${fullComment}\n\n${UNCITED_DOWNGRADE_NOTE}` : fullComment,
      policyDocText
    );
    return {
      ref: r.ref,
      gd4ItemId: r.gd4ItemId,
      requirementText: r.requirementText,
      verdict,
      shortComment: best?.shortComment || "No verdict returned by the AI for this requirement.",
      fullComment: verifiedComment,
      suggestedRewrite: best?.suggestedRewrite,
      chunkIds: best?.chunkIds ?? [],
      subClauses: best?.subClauses,
      promises: best?.promises?.length ? best.promises : undefined,
      // Only carry the exact quote for a positive, cited verdict — a downgraded
      // or Not-documented line shows the passage without a (stale) highlight.
      supportQuote: (verdict === "Adequate" || verdict === "Partial") ? best?.supportQuote : undefined,
    };
  });

  // One extra AI call synthesising the whole sub-criterion into a 2-4
  // sentence roll-up — the per-line verdicts feed it, so no document re-read
  // is needed. Best-effort: a failure here leaves overallNarrative undefined
  // and the UI falls back to a deterministic summary. Skipped if the run was
  // stopped mid-way (partial rows would make a misleading synthesis).
  let overallNarrative: string | undefined;
  if (!stopRequested() && !stoppedEarly) {
    opts.onProgress?.("PPD requirements review — overall synthesis");
    const lineDigest = rows.map((r) => `[${r.ref}] ${r.verdict}: ${r.requirementText} — ${r.shortComment}`).join("\n");
    const narrativeSystem = `You are writing a short overall roll-up of a PPD (Policy & Procedure Document) requirements review for one GD4 EduTrust sub-criterion. You are given the per-requirement-line verdicts already decided ("Adequate" / "Partial" / "Not documented"). Write a 2-4 sentence synthesis of the sub-criterion AS A WHOLE: whether the PPD documents this sub-criterion's requirements overall, which areas are strongest (documented), and where the gaps are (Partial / Not documented lines). This is a roll-up — do NOT repeat each line's comment verbatim. Keep it factual and neutral: state what is documented and what is missing; do not editorialise with words like "good"/"poor"/"excellent". Respond with JSON only: {"narrative": string}.${buildSystemPrompt("evidenceReview", null, "runPPDRequirementsReview (overall synthesis)", opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;
    const narrativeUser = `Per-requirement-line verdicts for this sub-criterion:\n${lineDigest}\n\nWrite the overall roll-up narrative.`;
    try {
      // Generative (fixed): a 2-4 sentence roll-up NARRATIVE synthesising the
      // already-decided line verdicts — prose, not itself a verdict. The
      // per-line verdicts above (which the consistency test measures) use the
      // tunable verdictTemperature; this summary does not affect them.
      const content = await chatComplete(
        [{ role: "system", content: narrativeSystem }, { role: "user", content: narrativeUser }],
        settings,
        { temperature: 0.2, onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      if (typeof parsed.narrative === "string" && parsed.narrative.trim()) overallNarrative = parsed.narrative.trim();
    } catch (err) {
      if (!stopRequested()) {
        windowErrors.push(`Overall synthesis call failed — ${err instanceof Error ? err.message : String(err)}`);
      }
      console.error("[PPDRequirementsReview] overall synthesis failed", err instanceof Error ? err.message : String(err));
    }
  }

  return {
    rows,
    contradictions,
    overallNarrative,
    usage,
    promptSent: firstPromptSent,
    windowsProcessed: windowsCompleted,
    fullCoverage: !stoppedEarly && windowsCompleted === windows.length,
    windowErrors: windowErrors.length > 0 ? windowErrors : undefined,
    stoppedEarly: stoppedEarly || undefined,
  };
}

// ─── Evidence Assessment (Option A, Evidence tab) ───────────────────────────
// For each GD4 requirement line: takes the PPD verdict ALREADY decided by the
// PPD Requirements Review (does NOT re-assess the policy), reads the Actual
// Evidence documents (sliding window, same mechanism as the staged evidence
// pass), and returns a combined verdict: documented AND implemented -> "Met";
// documented but not evidenced -> "Partial"; neither -> "Not met". Same
// division of responsibility as every other function here — the store does
// the folder reading/logging, this makes the AI call(s).

export type EvidenceAssessmentInput = {
  ref: string;
  requirementText: string;
  ppdVerdict: PPDVerdict;
  ppdExtract: string;
  promises?: PPDPromise[];
  // Flagged pre-analysis checklist items for this line — either an auto
  // detection that returned "flag", or a manual item the user ticked as a
  // confirmed concern. Advisory context ONLY: the assessor forms its own
  // independent judgement (see the prompt wording below); this is never an
  // instruction and never overrides the verdict logic. Clean/unflagged items
  // are omitted entirely so they add no prompt noise.
  preCheckFlags?: string[];
};

export type EvidenceAssessmentLineResult = {
  ref: string;
  evidenceSummary: string;
  verdict: EvidenceVerdict;
  comment: string;
  chunkIds: string[];
  failed?: boolean;
  // Per-PPD-promise verification (Technique 3 — "not implemented in
  // accordance with its documented PPD").
  promiseChecks?: PromiseCheck[];
  // Exact verbatim excerpt from the cited evidence proving implementation —
  // verified real substring, or absent ("no exact quote identified").
  evidenceQuote?: string;
};

export type EvidenceAssessmentRunResult = {
  rows: EvidenceAssessmentLineResult[];
  usage?: AIUsage;
  promptSent?: string;
  windowsProcessed?: number;
  fullCoverage?: boolean;
};

// A found > partial > not-found ranking so the best result across sliding
// windows wins (an earlier window finding nothing must not overwrite a later
// window that found implementation evidence). "Not assessed" is a UI-only
// state (unmatched derive rows) that the AI never returns — ranked lowest so
// any real verdict would replace it if it ever entered a merge.
const EVIDENCE_VERDICT_ORDER: Record<EvidenceVerdict, number> = { "Not assessed": -1, "Not met": 0, "Partial": 1, "Met": 2 };

// Purely-observational live events emitted as the assessment proceeds, so the
// UI can show a detailed activity view. Emitting them changes no assessment
// behaviour — they mirror the window/batch loop the run already performs.
export type EvidenceRunEvent =
  | { type: "window-start"; window: { current: number; total: number }; refs: string[]; firstLine: number; lastLine: number }
  | { type: "batch-done"; verdicts: { ref: string; verdict: EvidenceVerdict }[]; usage?: AIUsage }
  | { type: "batch-failed"; refs: string[] };

export async function runEvidenceAssessment(
  inputs: EvidenceAssessmentInput[],
  evidenceDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; onProgress?: (detail: string, pct?: number) => void; onEvent?: (ev: EvidenceRunEvent) => void; shouldStop?: () => boolean; signal?: AbortSignal } = {}
): Promise<EvidenceAssessmentRunResult> {
  if (inputs.length === 0) return { rows: [] };

  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";
  const noEvidence = !evidenceDocText.trim();

  const buildSystem = (label: string) => `You are an SSG EduTrust assessor testing whether a PEI IMPLEMENTS its documented policies. For each requirement line you are given: (1) the PPD verdict already decided (whether the requirement is documented), (2) the specific PROMISES the PPD makes for that line (named mechanisms, frequencies, scopes, roles, records), and (3) the ACTUAL EVIDENCE documents below. Audit like a real assessor: verify each promise against the records, compare dates, and name specifics — never summarise.

PROMISE VERIFICATION (the core task). Each promise listed under a requirement is a NAMED CHECK. For each one verdict:
- "evidenced" — a record in the evidence documents shows the promise being carried out; cite the chunk.
- "not evidenced" — no record shows it. Phrase the finding: "It was not evident that the PEI had [promise], in accordance with its documented PPD."
- "contradicted" — the records show the OPPOSITE of the promise (e.g. the PPD promises contracts signed before fee collection and a contract is dated after the receipt). Quote the contradicting record.

COMBINED LINE VERDICT — apply this decision procedure IN ORDER and stop at the first rule that matches. This is deterministic: the same PPD verdict and the same promise-check counts must ALWAYS yield the same line verdict (do not use "feels thin/strong" judgement — count the promise checks).
1. If ANY promise is "contradicted" by the records → "Not met". (A contradiction is a hard fail regardless of everything else.)
2. Else if the PPD verdict is "Not documented" → "Not met". (No documented approach; the APSR Approach hard-gate floors the line.)
3. Else if the PPD verdict is "Partial" → "Partial". (A weak documented approach caps the whole line at Partial, no matter how complete the evidence — never "Met".)
4. Else (PPD verdict is "Adequate"), decide by the promise checks:
   a. If there were extractable promises: let E = number "evidenced", T = total promises. Then "Met" if E === T (every promise evidenced); "Partial" if 0 < E < T (some but not all); "Not met" if E === 0 (none evidenced).
   b. If there were NO extractable promises for this line: "Met" if at least one actual implementation record supports the requirement; "Partial" if the approach is documented but no implementation record is present.
Ties/borderline cases resolve DOWN, never up: if you are unsure between two adjacent verdicts, choose the lower one. "Met" requires every applicable promise evidenced with a cited record — it is never awarded on partial or ambiguous evidence.

PRE-CHECK FLAGS: some lines carry a "Pre-check flags" note — a concern the app's own pattern-scan (or the reviewer) noted before your assessment (e.g. a possible date-sequencing issue, a record-count shortfall). Treat it as a prompt to look closer at that specific concern in the evidence, nothing more — it is NOT a verdict, and it must never override what you actually find in the documents. Confirm, refute or find it moot from the evidence itself; do not defer to it.

EVIDENCE RULES:
- A policy/SOP/procedure filed in the evidence folder does NOT count as implementation evidence — only actual records of doing something count.
- IMPLEMENTATION RECORD OVER POLICY DOCUMENT: When BOTH a policy/approach document (staff handbook, manual, SOP, framework) AND a dedicated implementation record (a completed/signed form, a dated log or register entry, minutes, a filled checklist) are present for the same requirement, cite the RECORD as the evidence — the policy only proves the approach exists on paper, while the record proves the process actually ran. Never accept a handbook/manual/SOP as implementation evidence when an actual record of the activity is available; treat "cited a policy document as proof it was done" as an ungrounded citation.
- CITE EVERY ON-POINT RECORD, IN EVERY WINDOW: Cite ALL of the concrete implementation records that directly evidence the line — not just the first one you find, and do not stop citing once the line already looks Met. This document is one window of the evidence; the strongest, most specific record for a line may appear here even if weaker support appeared elsewhere, so always cite the on-point record present in THIS window rather than assuming it is already captured.
- NAMED EXAMPLES ARE MANDATORY on every negative: each "Partial"/"Not met" line verdict and each "not evidenced"/"contradicted" promise MUST cite at least one concrete example — the specific document name, version, date or record entry that demonstrates the gap, quoted with its chunk ID; or, where nothing exists, name what was searched and absent. Where dates or versions can be compared (a record dated after the period it governs; documents that never move past V0), PERFORM the comparison and state it explicitly. A negative verdict without a concrete example is unsupported and unacceptable.
- SSG REGISTER on negatives: "It was not evident that the PEI had [implemented/established]…, in accordance with its documented PPD. Example: …". Positive verdicts stay factual and specific (which record, where) — no praise adjectives.

For each line return:
- evidenceSummary: 1-2 sentences on what implementation evidence was found (or that none was found), factual and neutral.
- verdict: "Met" | "Partial" | "Not met"
- comment: justification referencing the PPD state, the promise checks and the named example(s), in the register above.
- promiseChecks: [{promiseText: string, verdict: "evidenced"|"not evidenced"|"contradicted", evidence: string, chunkIds: string[], quote: string, rationale: string, chunkId: string}] — one entry PER promise given for the line, promiseText copied exactly. evidence = the citation/description or "No record found in the evidence documents." quote = the ONE exact sentence copied VERBATIM from the cited evidence chunk that proves (or, for "contradicted", disproves) THIS specific promise — character-for-character, independent of any other promise's quote. Empty string "" for "not evidenced" (nothing to quote) or when no single sentence captures it — never invent one, never reuse another promise's quote. rationale = ONE short auditor-register sentence on WHY this promise is evidenced / not evidenced / contradicted (distinct from the quote), or "" if you cannot state a reason beyond the quote — do not pad. chunkId = the single primary chunk ID the quote came from, or "". Empty array only when the line has no promises.
- chunkIds: exact chunk ID(s) (e.g. "C001") from evidence document headers supporting the line verdict. Empty if none.
- evidenceQuote: for Met/Partial ONLY, the ONE exact sentence (or short clause) copied VERBATIM from the cited evidence chunk that most directly proves implementation for this line — character-for-character, so it can be located in the source. If no single sentence captures it, or the verdict is Not met, return an empty string "" — never paraphrase, summarise, or invent a quote.

Respond with JSON only:
{"results": [{"ref": string, "evidenceSummary": string, "verdict": "Met"|"Partial"|"Not met", "comment": string, "promiseChecks": [{"promiseText": string, "verdict": "evidenced"|"not evidenced"|"contradicted", "evidence": string, "chunkIds": string[], "quote": string, "rationale": string, "chunkId": string}], "chunkIds": string[], "evidenceQuote": string}]}${buildSystemPrompt("evidenceReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;

  const windows = noEvidence ? [] : buildDocWindows(evidenceDocText);

  // groundScore = how well the HELD summary/comment is grounded in cited
  // evidence: verified promises that carry a citation dominate, then the number
  // of chunks cited. Used ONLY to break verdict TIES between windows — see the
  // merge below (F1). It is not a verdict input.
  type BestEv = { evidenceSummary: string; verdict: EvidenceVerdict; comment: string; chunkIds: string[]; promiseChecks?: PromiseCheck[]; groundScore: number; evidenceQuote?: string };
  const groundScoreOf = (cids: string[], checks: PromiseCheck[]): number => {
    const citedPromises = checks.filter((p) => p.verdict === "evidenced" && p.chunkIds.length > 0).length;
    return citedPromises * 1000 + cids.length;
  };
  const bestByRef = new Map<string, BestEv>();
  // Per-promise best verdict across sliding windows: evidence found in ANY
  // window proves the promise over a bare "no record" — but a CONTRADICTION is
  // STICKY and outranks everything. A record showing the opposite of the PPD
  // promise (found in one window) must not be erased by a supporting record in
  // another window: "evidenced somewhere AND contradicted somewhere" is itself
  // the finding, and erasing it would also bypass the promise hard-gate cap.
  const PROMISE_VERDICT_ORDER: Record<PromiseCheck["verdict"], number> = { "not evidenced": 0, "evidenced": 1, "contradicted": 2 };
  const mergePromiseChecks = (prev: PromiseCheck[] | undefined, next: PromiseCheck[]): PromiseCheck[] => {
    const out = [...(prev ?? [])];
    for (const n of next) {
      const i = out.findIndex((p) => p.promiseText === n.promiseText);
      if (i === -1) out.push(n);
      // A strictly better verdict adopts this window's evidence/quote, but
      // falls back to the prior window's quote if this one didn't find one —
      // never regress a located quote just because a later window's verdict won.
      else if (PROMISE_VERDICT_ORDER[n.verdict] > PROMISE_VERDICT_ORDER[out[i].verdict]) out[i] = { ...n, chunkIds: [...new Set([...out[i].chunkIds, ...n.chunkIds])], quote: n.quote ?? out[i].quote };
      else out[i] = { ...out[i], chunkIds: [...new Set([...out[i].chunkIds, ...n.chunkIds])], quote: out[i].quote ?? n.quote };
    }
    return out;
  };
  // Refs whose AI call failed/timed out at least once and never succeeded —
  // surfaced per line as "Assessment failed — retry" so one stuck call cannot
  // hang the whole tab or silently vanish.
  const failedRefs = new Set<string>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let windowsCompleted = 0;
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const REQ_BATCH_SIZE = 8;
  const batches: EvidenceAssessmentInput[][] = [];
  for (let i = 0; i < inputs.length; i += REQ_BATCH_SIZE) batches.push(inputs.slice(i, i + REQ_BATCH_SIZE));

  const totalUnits = Math.max(1, (windows.length || 1) * batches.length);
  let unitsDone = 0;

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()}]` : "";
    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      const firstLine = bi * REQ_BATCH_SIZE + 1;
      const lastLine = Math.min(inputs.length, firstLine + batch.length - 1);
      const lineLabel = inputs.length === 1 ? "line 1 of 1" : `lines ${firstLine}–${lastLine} of ${inputs.length}`;
      const winLabel = windows.length > 1 ? ` · window ${win.index + 1}/${win.total}` : "";
      opts.onProgress?.(`Assessing ${lineLabel}${winLabel}…`, Math.round((unitsDone / totalUnits) * 100));
      opts.onEvent?.({ type: "window-start", window: { current: win.index + 1, total: win.total }, refs: batch.map((b) => b.ref), firstLine, lastLine });
      const pointsBlock = batch.map((r, i) => {
        const promisesBlock = (r.promises ?? []).length > 0
          ? `\n  PPD promises to verify:${(r.promises ?? []).map((p, pi) => `\n    (${pi + 1}) ${p.promiseText}`).join("")}`
          : "";
        // Advisory only — a flag is a prompt to look closer, not a verdict to
        // adopt; form your own independent judgement from the evidence.
        const preCheckBlock = (r.preCheckFlags ?? []).length > 0
          ? `\n  Pre-check flags (for your consideration, not a directive — form your own independent judgement from the evidence):${(r.preCheckFlags ?? []).map((f, fi) => `\n    (${fi + 1}) ${f}`).join("")}`
          : "";
        return `[${r.ref}] (${i + 1}) ${r.requirementText} [PPD verdict: ${r.ppdVerdict}${r.ppdExtract ? ` — "${r.ppdExtract.slice(0, 100)}"` : ""}]${promisesBlock}${preCheckBlock}`;
      }).join("\n");
      const user = `Actual evidence documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each requirement line: verify each listed PPD promise against the records, then give the COMBINED PPD-plus-evidence verdict:\n${pointsBlock}`;
      const system = buildSystem(windows.length > 1 ? `runEvidenceAssessment (window ${win.index + 1}/${win.total})` : "runEvidenceAssessment");
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        const batchVerdicts: { ref: string; verdict: EvidenceVerdict }[] = [];
        for (const inp of batch) {
          const res = byRef.get(normalizeAuditRef(inp.ref));
          const verdict = (["Met", "Partial", "Not met"] as EvidenceVerdict[]).includes(res?.verdict as EvidenceVerdict)
            ? (res!.verdict as EvidenceVerdict) : "Not met";
          const evidenceSummary = typeof res?.evidenceSummary === "string" ? res.evidenceSummary : "";
          const comment = typeof res?.comment === "string" ? res.comment : "";
          const chunkIds = Array.isArray(res?.chunkIds) ? (res!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          // Exact evidence quote — stored ONLY when it verifies as a real verbatim
          // excerpt of this window's evidence text; a paraphrase/invention is
          // dropped to undefined ("no exact quote identified"), never a false match.
          const rawEvidenceQuote = typeof res?.evidenceQuote === "string" ? res.evidenceQuote.trim() : "";
          const evidenceQuote = rawEvidenceQuote && quoteExistsInSource(rawEvidenceQuote, win.text) ? rawEvidenceQuote : undefined;
          const promiseChecks: PromiseCheck[] = Array.isArray(res?.promiseChecks)
            ? (res!.promiseChecks as Array<Record<string, unknown>>)
                .filter((p) => typeof p?.promiseText === "string" && ["evidenced", "not evidenced", "contradicted"].includes(p?.verdict as string))
                .map((p) => {
                  // Per-promise quote: verified against THIS window's evidence
                  // text — same anti-hallucination rule as evidenceQuote, but
                  // scoped to the individual promise, not the whole line.
                  const rawQuote = typeof p.quote === "string" ? p.quote.trim() : "";
                  const quote = rawQuote && quoteExistsInSource(rawQuote, win.text) ? rawQuote : undefined;
                  // Rationale is reasoning (like the line comment), not a
                  // quotation — stored as-is when non-empty, never padded.
                  const rationale = typeof p.rationale === "string" && p.rationale.trim() ? p.rationale.trim() : undefined;
                  const chunkId = typeof p.chunkId === "string" && p.chunkId.trim() ? p.chunkId.trim() : undefined;
                  return {
                    promiseText: p.promiseText as string,
                    verdict: p.verdict as PromiseCheck["verdict"],
                    // Quote verification on the cited evidence — same rule as comments.
                    evidence: typeof p.evidence === "string" ? flagUnverifiedQuotes(p.evidence, win.text) : "",
                    chunkIds: Array.isArray(p.chunkIds) ? (p.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [],
                    quote,
                    rationale,
                    chunkId,
                  };
                })
            : [];
          const prev = bestByRef.get(inp.ref);
          const thisGround = groundScoreOf(chunkIds, promiseChecks);
          if (!prev || EVIDENCE_VERDICT_ORDER[verdict] > EVIDENCE_VERDICT_ORDER[prev.verdict]) {
            // Strictly higher verdict wins outright — adopt its summary/comment.
            bestByRef.set(inp.ref, { evidenceSummary, verdict, comment, groundScore: thisGround, chunkIds: [...new Set([...(prev?.chunkIds ?? []), ...chunkIds])], promiseChecks: mergePromiseChecks(prev?.promiseChecks, promiseChecks), evidenceQuote: evidenceQuote ?? prev?.evidenceQuote });
          } else if (EVIDENCE_VERDICT_ORDER[verdict] === EVIDENCE_VERDICT_ORDER[prev.verdict]) {
            // F1 — verdict TIE. Reading order must NOT decide which justification
            // survives: keep the summary/comment from the better-grounded window
            // (more citation-backed verified promises, then more cited chunks),
            // not simply the first. The verdict is unchanged (same rank) and the
            // citation list still accumulates across BOTH windows, so neither the
            // verdict nor the cited-evidence list regresses — only the displayed
            // reasoning improves.
            const better = thisGround > prev.groundScore;
            bestByRef.set(inp.ref, {
              ...prev,
              ...(better ? { evidenceSummary, comment, groundScore: thisGround, evidenceQuote: evidenceQuote ?? prev.evidenceQuote } : { evidenceQuote: prev.evidenceQuote ?? evidenceQuote }),
              chunkIds: [...new Set([...prev.chunkIds, ...chunkIds])],
              promiseChecks: mergePromiseChecks(prev.promiseChecks, promiseChecks),
            });
          } else {
            // Strictly lower verdict — keep prev's verdict/summary/comment; only
            // accumulate this window's citations and promise checks.
            bestByRef.set(inp.ref, { ...prev, chunkIds: [...new Set([...prev.chunkIds, ...chunkIds])], promiseChecks: mergePromiseChecks(prev.promiseChecks, promiseChecks), evidenceQuote: prev.evidenceQuote ?? evidenceQuote });
          }
          failedRefs.delete(inp.ref); // a later window recovered this line
          batchVerdicts.push({ ref: inp.ref, verdict });
        }
        opts.onEvent?.({ type: "batch-done", verdicts: batchVerdicts, usage });
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        // Mark the batch's lines as failed and CONTINUE — one stuck/timed-out
        // call must not abort the rest of the assessment.
        for (const inp of batch) if (!bestByRef.has(inp.ref)) failedRefs.add(inp.ref);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref) });
        console.error("[EvidenceAssessment]", windows.length > 1 ? `window ${win.index + 1}/${win.total}` : "call failed", err instanceof Error ? err.message : String(err));
      }
      unitsDone++;
    }
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  const rows: EvidenceAssessmentLineResult[] = inputs.map((inp) => {
    const best = bestByRef.get(inp.ref);
    if (best) {
      const verifiedComment = flagUnverifiedQuotes(best.comment || "", evidenceDocText);
      // Code-level APSR Approach hard-gate: a line whose PPD verdict is not
      // "Adequate" is capped at "Partial" whatever the AI combined — the same
      // facts must not show "Partial" on the PPD tab and "Met" here.
      if (best.verdict === "Met" && inp.ppdVerdict !== "Adequate") {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}[Capped at Partial: the PPD verdict for this line is "${inp.ppdVerdict}" — under the APSR Approach hard-gate a line cannot be Met until the documented approach is Adequate, regardless of implementation evidence.]`,
          chunkIds: best.chunkIds,
          promiseChecks: best.promiseChecks,
          evidenceQuote: best.evidenceQuote,
        };
      }
      // A "Met" verdict that cannot cite any evidence chunk is downgraded to
      // "Partial" — same uncited-positive rule as buildStagedApsr.
      if (best.verdict === "Met" && best.chunkIds.length === 0) {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}${UNCITED_DOWNGRADE_NOTE}`,
          chunkIds: [],
          promiseChecks: best.promiseChecks,
        };
      }
      // Promise hard-gate: a "Met" line with an unfulfilled or contradicted
      // PPD promise is capped at "Partial" — "not implemented in accordance
      // with its documented PPD" is exactly the gap real assessors raise.
      const unmetPromises = (best.promiseChecks ?? []).filter((p) => p.verdict !== "evidenced");
      if (best.verdict === "Met" && unmetPromises.length > 0) {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}[Capped at Partial: ${unmetPromises.length} PPD promise${unmetPromises.length === 1 ? "" : "s"} not evidenced — ${unmetPromises.map((p) => `"${p.promiseText}"`).join("; ")}. It was not evident that the PEI had implemented ${unmetPromises.length === 1 ? "this commitment" : "these commitments"} in accordance with its documented PPD.]`,
          chunkIds: best.chunkIds,
          promiseChecks: best.promiseChecks,
          evidenceQuote: best.evidenceQuote,
        };
      }
      return { ref: inp.ref, evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.", verdict: best.verdict, comment: verifiedComment, chunkIds: best.chunkIds, promiseChecks: best.promiseChecks, evidenceQuote: best.evidenceQuote };
    }
    if (failedRefs.has(inp.ref)) {
      return { ref: inp.ref, evidenceSummary: "Assessment failed — retry.", verdict: "Not met", comment: "The AI call for this line failed or timed out. Re-run the evidence assessment to retry.", chunkIds: [], failed: true };
    }
    // A line never put in front of the AI because the run stopped early is
    // "Not assessed" — NOT a fabricated "Not met".
    if (stoppedEarly) {
      return {
        ref: inp.ref,
        evidenceSummary: "Not assessed — the run was stopped before this line was reviewed.",
        verdict: "Not assessed",
        comment: "The run was stopped before this requirement line was reviewed. Re-run the evidence assessment to assess it.",
        chunkIds: [],
      };
    }
    // No evidence documents at all, or the AI returned nothing: fall back to a
    // deterministic verdict driven by the PPD state alone.
    return {
      ref: inp.ref,
      evidenceSummary: noEvidence ? "No Actual Evidence documents were found for this sub-criterion." : "No implementation evidence found for this requirement.",
      verdict: "Not met",
      comment: noEvidence
        ? `PPD verdict was "${inp.ppdVerdict}", but no implementation evidence was available to assess.`
        : `No implementation evidence found; PPD verdict was "${inp.ppdVerdict}".`,
      chunkIds: [],
    };
  });

  return { rows, usage, promptSent: firstPromptSent, windowsProcessed: windowsCompleted, fullCoverage: !stoppedEarly && (windows.length === 0 || windowsCompleted === windows.length) };
}
