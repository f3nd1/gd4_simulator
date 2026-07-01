// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence, GD4Requirement, ApsrBreakdown, GeneratedChecklistLine, FlatAuditPoint, PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, StagedCoverageStatus } from "../../types";
import { chatComplete, AIClientError, addUsage, type AIUsage } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";
import { deriveApsrStatus, apsrReason } from "./simulateAI";
import { buildSystemPrompt, buildDomainBlock, type SkillCalibrationExample, type SkillCalibrationMemory } from "./skills";
import { domainExpertiseFor } from "../../data/skills/domainExpertise";
import type { EvidenceChunk } from "../../types";

export { AIClientError };

function memoryToMessages(memory: AgentMemoryEntry[]) {
  return memory.map((m) => ({ role: m.role, content: m.content }));
}

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
  settings: AISettings,
  memory: AgentMemoryEntry[]
): Promise<Omit<SimulatedItemVerdict, "live"> & { live: true; usage?: AIUsage }> {
  const itemDomainSkill = domainExpertiseFor(item.id);
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Use your earlier-turn memory of other items you have reviewed to flag when the SAME gap recurs across items (e.g. a missing review/record pattern), so the auditor can fix it systemically. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.${buildSystemPrompt("bandRecommend", null, "runLiveItemReview", item.id, itemDomainSkill)}${buildDomainBlock(itemDomainSkill)}`;
  const user = `Item ${item.id}. Fixed evidence score: ${item.eff}/100, fixed band: ${item.band} (source: ${item.checklistOverride ? "Sub-Criterion Checklist outcome" : "evidence matrix quick rating"}). Evidence: approach=${ev.approach}, processes=${ev.processes}, systemsOutcomes=${ev.systemsOutcomes}, review=${ev.review}, traceability=${ev.trace}%, evidence age=${ev.age} days, owner=${ev.owner || "(unassigned)"}, Drive evidence link=${ev.drive ? ev.drive : "MISSING — no link has been provided"}.`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
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
  memory: AgentMemoryEntry[],
  calibration?: SkillCalibrationExample[]
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true; usage?: AIUsage }> {
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described, and never let well-written narrative substitute for missing evidence. If no closure evidence link is provided, you must return "Maintain Finding" regardless of how complete or convincing the narrative sounds. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.${buildSystemPrompt("afiClosure", null, "runLiveClosureReview", undefined, undefined, calibration)}`;
  const user = `Root cause: ${closure.root || "(none provided)"}\nCorrective action: ${closure.corr || "(none provided)"}\nPreventive action: ${closure.prev || "(none provided)"}\nClosure evidence link: ${closure.evid || "(none provided — no evidence is linked)"}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
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
  const system = `You are an evidence intake assistant for an EduTrust GD4 internal audit. You are given only a document link/filename and the checklist line it is meant to support — you cannot open or read the document, so never assume or invent its content. Suggest plausible metadata from the link/filename alone, and draft a short auditor note (1-2 sentences) that explicitly tells the human auditor what they still need to verify themselves. Respond with JSON only: {"title": string, "type": "Policy/Procedure" | "Record/Log" | "System screenshot" | "Minutes" | "Survey/Feedback" | "Other", "date": string (YYYY-MM-DD, guess if unknown), "sufficiency": "Present" | "Weak" | "Missing", "auditorNote": string}.${buildSystemPrompt("evidenceTracking", null, "runLiveEvidenceFill")}`;
  const user = `Evidence link: ${link}\nChecklist line this evidence is meant to support: ${lineText}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content);

  return {
    title: (parsed.title as string) || link,
    type: (parsed.type as string) || "Other",
    date: (parsed.date as string) || new Date().toISOString().slice(0, 10),
    sufficiency: (parsed.sufficiency as EvidenceFillDraft["sufficiency"]) || "Present",
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
    { onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS },
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

// Placeholder verdicts inserted for lines whose batch exhausted retries so the
// rest of the audit result is not discarded. These are clearly marked and show
// "Not met" conservatively — the auditor is prompted to re-run.
function placeholderVerdicts(batchLines: { id: string; text: string }[]): FolderAuditLineVerdict[] {
  return batchLines.map((l) => ({
    lineId: l.id,
    status: "Not met" as const,
    reason: "AI audit timed out for this line — result unavailable. Re-run the audit to try again.",
    sources: [],
    apsr: {
      approach: { status: "Not evident" as const, note: "Audit timed out — no verdict available. Re-run the audit." },
      processes: { status: "Not evident" as const, note: "" },
      systemsOutcomes: { status: "Not evident" as const, note: "" },
      review: { status: "Not evident" as const, note: "" },
    },
  }));
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
  // NOT cancel sibling batches. Each failed batch gets placeholder verdicts so
  // the completed work from other batches is not discarded.
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
    verdicts: [
      ...succeeded.flatMap((o) => o.result.verdicts),
      ...failed.flatMap((o) => placeholderVerdicts(o.batchLines)),
    ],
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
Respond with JSON only: {"observation": string, "criteria": string, "effect": string}.${buildSystemPrompt("findingWriter", null, "runLiveFindingObservation", req.id, domainExpertiseFor(req.id))}${buildDomainBlock(domainExpertiseFor(req.id))}`;

  const user = `GD4 ${req.id}: ${req.requirement}
Describe/Show: ${req.describeShow.slice(0, 3).join("; ")}
Expected evidence: ${req.expectedEvidence.length ? req.expectedEvidence.join("; ") : "(not specified)"}

Checklist line: "${line.text}" — status: ${line.status}
APSR assessment: ${apsrSummary}
Dimension (APSR leg that fell short): ${dimension}`;

  let usage: AIUsage | undefined;
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

// Citation verifier: a second-pass AI call that re-examines the AI-returned
// verdict for a single checklist line, focusing on whether the cited chunks
// actually support each positive dimension claim. Stricter than the first pass —
// it will downgrade positive dimensions when the cited evidence is insufficient.
// Only called in Strict mode from useWorkspaceStore.ts to avoid doubling costs
// for every audit run.
export async function runCitationVerifier(
  line: { id: string; text: string },
  verdict: FolderAuditLineVerdict,
  citedChunks: EvidenceChunk[],
  settings: AISettings
): Promise<{ verified: boolean; unsupportedClaims: string[]; recommendedDowngrade: "none" | "Partial" | "Not met"; reason: string; usage?: AIUsage }> {
  const chunkBlock = citedChunks.length > 0
    ? citedChunks.map((c) => `[${c.chunkId}] (${c.evidenceType}, ${c.bucket}, ${c.fileKind})\n${c.text.slice(0, 800)}`).join("\n\n---\n\n")
    : "(no chunks cited — all dimensions lack source evidence)";

  const apsrSummary = verdict.apsr
    ? [
        `Approach: ${verdict.apsr.approach.status} (chunks: ${verdict.apsr.approach.sourceChunkIds?.join(", ") || "none"})`,
        `Processes: ${verdict.apsr.processes.status} (chunks: ${verdict.apsr.processes.sourceChunkIds?.join(", ") || "none"})`,
        `Systems & Outcomes: ${verdict.apsr.systemsOutcomes.status} (chunks: ${verdict.apsr.systemsOutcomes.sourceChunkIds?.join(", ") || "none"})`,
        `Review: ${verdict.apsr.review.status} (chunks: ${verdict.apsr.review.sourceChunkIds?.join(", ") || "none"})`,
      ].join("\n")
    : "No APSR breakdown available.";

  const system = `You are a strict citation verifier for a GD4 EduTrust audit. You are given a checklist line, the AI's verdict, and the exact chunk texts that were cited as evidence. Your job is to verify whether each cited chunk actually supports its dimension claim. Be strict: a policy chunk does NOT prove implementation; implementation records do NOT prove outcomes; meeting minutes saying only "discussed" do NOT prove review. For each positive dimension, read the cited chunks and decide whether the evidence genuinely supports the claim. Respond with JSON only: {"verified": boolean, "unsupportedClaims": string[], "recommendedDowngrade": "none"|"Partial"|"Not met", "reason": string}.${buildSystemPrompt("evidenceReview", null, "runCitationVerifier")}`;

  const user = `Checklist line [${line.id}]: "${line.text}"\n\nAI verdict:\n${apsrSummary}\nOverall: ${verdict.status}\n\nCited chunks:\n${chunkBlock}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["verified", "recommendedDowngrade", "reason"]);

  return {
    verified: parsed.verified === true,
    unsupportedClaims: Array.isArray(parsed.unsupportedClaims)
      ? (parsed.unsupportedClaims as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    recommendedDowngrade: (["none", "Partial", "Not met"] as const).includes(parsed.recommendedDowngrade as "none" | "Partial" | "Not met")
      ? (parsed.recommendedDowngrade as "none" | "Partial" | "Not met")
      : "none",
    reason: (parsed.reason as string) || "",
    usage,
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

// Renders the accumulated per-window notes for one ref as one numbered,
// blank-line-separated paragraph per contributing window:
//   #1 [filename.pdf · C001]: <note text>
//
//   #2 [other.pdf · C003]: <note text>
// `resolveFile` maps a chunk ID back to its source file name (from the
// evidence file ledger) — when it can't resolve a chunk (or a window cited
// none), the bracketed citation is simply omitted for that entry.
function renderWindowNotes(parts: WindowNote[], fallback: string, resolveFile?: (chunkId: string) => string | undefined): string {
  if (parts.length === 0) return fallback;
  return parts.map((p) => {
    const citation = p.chunkIds
      .map((cid) => {
        const file = resolveFile?.(cid);
        return file ? `${file} · ${cid}` : cid;
      })
      .join(", ");
    const label = citation ? `#${p.window} [${citation}]` : `#${p.window}`;
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
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
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

"Yes" = the policy clearly, specifically, and sustainably documents HOW the institution meets this requirement (names who, what, when, frequency, ownership).
"Partial" = the policy mentions the requirement but is vague, generic, or incomplete — missing who owns it, missing timing, or using boilerplate language not specific to this institution.
"No" = the policy document does not address this requirement at all.

IMPORTANT: Do NOT credit evidence of implementation (records, logs, filled forms) as policy. A record of doing something is NOT a documented approach.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the coverage verdict.${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(policyDocText);
  const totalCharsAvailable = policyDocText.length;

  // Accumulate best verdict per ref across all windows. `notes` collects one
  // entry per window that found specific (non-"No") coverage, so the final
  // note can cite every contributing window instead of discarding all but
  // whichever window happened to win the coverage-priority merge.
  const bestByRef = new Map<string, { covered: StagedCoverageStatus; notes: WindowNote[]; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (opts.shouldStop?.()) break;
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (opts.shouldStop?.()) break;
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
          { temperature: 0.15, onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [String(r.ref ?? ""), r]));
        for (const p of batch) {
          const r = byRef.get(p.ref);
          const covered = (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus)
            ? (r!.covered as StagedCoverageStatus) : "No";
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, { covered, notes: covered !== "No" ? pushWindowNote([], win.index, note, chunkIds) : [], chunkIds });
          } else {
            const merged = mergeCoverage(prev.covered, covered);
            const mergedNotes = covered !== "No" ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            bestByRef.set(p.ref, { covered: merged, notes: mergedNotes, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Policy window ${win.index + 1}/${win.total}` : "Policy AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedPolicyAudit]", errNote);
        for (const p of batch) {
          if (!bestByRef.has(p.ref)) {
            bestByRef.set(p.ref, { covered: "No", notes: [], chunkIds: [] });
          }
        }
      }
    }
    windowsCompleted++;
  }

  const fullCoverage = windowsCompleted === windows.length;

  const rows: PolicyCoverageRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    const fallback = `No relevant policy evidence found in the ${windowsCompleted} window(s) reviewed.`;
    return {
      ref: p.ref, pointText: p.text,
      covered: best?.covered ?? "No",
      note: best ? renderWindowNotes(best.notes, fallback, opts.resolveChunkFile) : fallback,
      chunkIds: best?.chunkIds ?? [],
    };
  });

  const truncationNote = !fullCoverage
    ? `Policy content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`
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
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
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

"Yes" = there are real implementation records, logs, forms, screenshots, registers, or actual operational records showing this was done consistently.
"Partial" = some implementation evidence exists but it is incomplete, covers only part of the review period, or the sample is too small to be representative.
"No" = no implementation evidence in these documents for this requirement.

IMPORTANT: A policy document, SOP, or procedure does NOT count as implementation evidence, even if it is filed in the evidence folder. Only actual records of doing something count.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the verdict.${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(evidenceDocText);
  const totalCharsAvailable = evidenceDocText.length;

  const bestByRef = new Map<string, { covered: StagedCoverageStatus; notes: WindowNote[]; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (opts.shouldStop?.()) break;
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (opts.shouldStop?.()) break;
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
          { temperature: 0.15, onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [String(r.ref ?? ""), r]));
        for (const p of batch) {
          const r = byRef.get(p.ref);
          const covered = (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus)
            ? (r!.covered as StagedCoverageStatus) : "No";
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, { covered, notes: covered !== "No" ? pushWindowNote([], win.index, note, chunkIds) : [], chunkIds });
          } else {
            const merged = mergeCoverage(prev.covered, covered);
            const mergedNotes = covered !== "No" ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            bestByRef.set(p.ref, { covered: merged, notes: mergedNotes, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Evidence window ${win.index + 1}/${win.total}` : "Evidence AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedEvidenceAudit]", errNote);
        for (const p of batch) {
          if (!bestByRef.has(p.ref)) {
            bestByRef.set(p.ref, { covered: "No", notes: [], chunkIds: [] });
          }
        }
      }
    }
    windowsCompleted++;
  }

  const fullCoverage = windowsCompleted === windows.length;

  const rows: EvidenceCoverageRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    const fallback = `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`;
    return {
      ref: p.ref, pointText: p.text,
      covered: best?.covered ?? "No",
      note: best ? renderWindowNotes(best.notes, fallback, opts.resolveChunkFile) : fallback,
      chunkIds: best?.chunkIds ?? [],
    };
  });

  const truncationNote = !fullCoverage
    ? `Evidence content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`
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
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; resolveChunkFile?: (chunkId: string) => string | undefined } = {}
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

Cite chunk IDs from document headers in chunkIds. Leave chunkIds empty if no chunk directly supports a true verdict.${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "outcomeEvident": boolean, "reviewEvident": boolean, "note": string, "chunkIds": string[]}]}`;

  const windows = buildDocWindows(allDocText);
  const totalCharsAvailable = allDocText.length;

  // For outcome/review: OR across windows (true if any window finds evidence).
  const bestByRef = new Map<string, { outcomeEvident: boolean; reviewEvident: boolean; notes: WindowNote[]; chunkIds: string[] }>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (opts.shouldStop?.()) break;
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (opts.shouldStop?.()) break;
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
          { temperature: 0.15, onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [String(r.ref ?? ""), r]));
        for (const p of batch) {
          const r = byRef.get(p.ref);
          const outcomeEvident = r?.outcomeEvident === true;
          const reviewEvident = r?.reviewEvident === true;
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const foundSomething = outcomeEvident || reviewEvident;
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, { outcomeEvident, reviewEvident, notes: foundSomething ? pushWindowNote([], win.index, note, chunkIds) : [], chunkIds });
          } else {
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            const newOutcome = prev.outcomeEvident || outcomeEvident;
            const newReview = prev.reviewEvident || reviewEvident;
            const mergedNotes = foundSomething ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            bestByRef.set(p.ref, { outcomeEvident: newOutcome, reviewEvident: newReview, notes: mergedNotes, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `Outcome/review window ${win.index + 1}/${win.total}` : "Outcome/review AI call";
        const errNote = `${label} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error("[StagedOutcomeReviewAudit]", errNote);
        for (const p of batch) {
          if (!bestByRef.has(p.ref)) {
            bestByRef.set(p.ref, { outcomeEvident: false, reviewEvident: false, notes: [], chunkIds: [] });
          }
        }
      }
    }
    windowsCompleted++;
  }

  const fullCoverage = windowsCompleted === windows.length;

  const rows: OutcomeReviewRow[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    const fallback = `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`;
    return {
      ref: p.ref, pointText: p.text,
      outcomeEvident: best?.outcomeEvident ?? false,
      reviewEvident: best?.reviewEvident ?? false,
      note: best ? renderWindowNotes(best.notes, fallback, opts.resolveChunkFile) : fallback,
      chunkIds: best?.chunkIds ?? [],
    };
  });

  const truncationNote = !fullCoverage
    ? `Outcome/review content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`
    : undefined;

  return { rows, usage, promptSent: firstPromptSent, truncationNote, windowsProcessed: windowsCompleted, totalCharsAssessed, totalCharsAvailable, fullCoverage, windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}

// Stage 5: Deterministic APSR verdict builder.
// Maps the three coverage matrices to the four APSR dimensions WITHOUT any AI call.
// Key rule: policy coverage → Approach, evidence coverage → Processes,
// outcome data → Systems & Outcomes, review records → Review.
// Policy documents cannot satisfy Processes; evidence documents cannot satisfy Approach
// (unless they contain a procedure, but that classification happens in Stage 2/3).
export function buildStagedApsr(
  policyRow: PolicyCoverageRow | undefined,
  evidenceRow: EvidenceCoverageRow | undefined,
  outcomeRow: OutcomeReviewRow | undefined
): ApsrBreakdown {
  // Approach — from policy adequacy only
  const approach: ApsrBreakdown["approach"] = policyRow?.covered === "Yes"
    ? { status: "Meeting", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
    : policyRow?.covered === "Partial"
      ? { status: "Beginning", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
      : { status: "Not evident", note: policyRow?.note || "No policy documentation found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Processes — from evidence coverage only
  const processes: ApsrBreakdown["processes"] = evidenceRow?.covered === "Yes"
    ? { status: "Deployed", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
    : evidenceRow?.covered === "Partial"
      ? { status: "Weak", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
      : { status: "Not evident", note: evidenceRow?.note || "No implementation evidence found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Systems & Outcomes — from outcome data
  const systemsOutcomes: ApsrBreakdown["systemsOutcomes"] = outcomeRow?.outcomeEvident
    ? { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
    : { status: "Not evident", note: outcomeRow?.note || "No outcome data (KPIs, results, trends) found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Review — from review records
  const review: ApsrBreakdown["review"] = outcomeRow?.reviewEvident
    ? { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
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
