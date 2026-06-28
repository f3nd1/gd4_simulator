// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence, GD4Requirement, ApsrBreakdown } from "../../types";
import { chatComplete, AIClientError, addUsage, type AIUsage } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";
import { deriveApsrStatus, apsrReason } from "./simulateAI";
import apsrRubricSkill from "../../data/skills/apsr-rubric.md?raw";
import evidenceStandardsSkill from "../../data/skills/evidence-standards.md?raw";
import findingWritingSkill from "../../data/skills/finding-writing.md?raw";
import bandCalibrationSkill from "../../data/skills/band-calibration.md?raw";
import sgPeiContextSkill from "../../data/skills/sg-pei-context.md?raw";
import externalAuditorSkill from "../../data/skills/external-auditor.md?raw";
import consultantInsightsSkill from "../../data/skills/consultant-insights.md?raw";
import riskRemediationSkill from "../../data/skills/risk-and-remediation.md?raw";
import findingSpecificitySkill from "../../data/skills/finding-specificity.md?raw";

// Injects one or more skill documents into the system prompt, capped so a
// large skill file can't dominate the token budget. Skills are domain-expert
// knowledge that condition the model's judgement without replacing the
// per-call instructions.
const SKILL_CAP = 3000;
function skills(...docs: string[]): string {
  const content = docs.map((d) => d.trim().slice(0, SKILL_CAP)).join("\n\n---\n\n");
  return content ? `\n\n## Auditor knowledge base (apply this expertise to your assessment)\n\n${content}` : "";
}

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
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Use your earlier-turn memory of other items you have reviewed to flag when the SAME gap recurs across items (e.g. a missing review/record pattern), so the auditor can fix it systemically. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.${skills(bandCalibrationSkill, sgPeiContextSkill, consultantInsightsSkill)}`;
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

// Reuses the same chatComplete client as the rest of the app's AI features
// (per the "reuse existing AI service layer" decision) to decompose a GD4
// item's Describe/Show points and Notes into atomic, testable checklist
// statements for the Sub-Criterion Checklist module's "AI first pass".
export async function runLiveChecklistGeneration(req: GD4Requirement, settings: AISettings, onUsage?: (u: AIUsage) => void): Promise<{ text: string; clause: string }[]> {
  const system = `You are a GD4 internal audit checklist assistant. Decompose the given GD4 item's Describe/Show points and Notes into a JSON array of atomic, testable checklist statements an auditor can mark Met, Partial, Not met or Not Applicable against real evidence. Each statement must be specific and independently verifiable, and must cite the GD4 item id as its clause. Generate statements that test all four APSR dimensions — at least one line each for: (A) whether the documented approach/policy is specific and sustainable, (P) whether there are records proving implementation, (S) whether outcomes are measured and demonstrate the process works, and (R) whether the approach and processes are formally reviewed for improvement. Respond with JSON only: {"lines": [{"text": string, "clause": string}]}, nothing else.${skills(apsrRubricSkill, sgPeiContextSkill)}`;
  const user = `GD4 item ${req.id} — ${req.requirement}\nDescribe/Show:\n${req.describeShow.map((d, i) => `${i + 1}. ${d}`).join("\n")}${
    req.notes.length ? `\nNotes:\n${req.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}` : ""
  }`;

  // Higher temperature for generation (diverse, natural-sounding lines) vs 0.2
  // for analysis (deterministic verdicts).
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.7, onUsage });
  const arr = parseJSONArray(content);
  return arr
    .filter((x): x is { text: string; clause?: string } => !!x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string")
    .map((x) => ({ text: (x as { text: string }).text, clause: (x as { clause?: string }).clause || `GD4 ${req.id}` }));
}

export async function runLiveClosureReview(
  closure: { root?: string; corr?: string; prev?: string; evid?: string },
  settings: AISettings,
  memory: AgentMemoryEntry[]
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true; usage?: AIUsage }> {
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described, and never let well-written narrative substitute for missing evidence. If no closure evidence link is provided, you must return "Maintain Finding" regardless of how complete or convincing the narrative sounds. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.`;
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
  context?: { standard?: string; apsr?: string }
): Promise<{ root: string; corr: string; prev: string; usage?: AIUsage }> {
  const system = `You are an EduTrust GD4 quality-action assistant. Given an audit finding (and, where provided, the official GD4 requirement it relates to and the APSR breakdown of which rubric dimension fell short), propose: a ROOT CAUSE that names WHY the gap exists — distinguish an Approach gap (the documented policy/procedure is missing or too generic in the PPD) from a Processes gap (documented but not implemented) from a Systems & Outcomes gap (no desired outcomes produced) from a Review gap (no evaluation for continual improvement) — then a CORRECTIVE action that fixes this specific gap now, and a PREVENTIVE action that stops it recurring. Be concrete and specific to the requirement; reference the actual evidence/records that should exist. These are draft suggestions the auditor will edit and must still evidence — do not claim the finding is closed. Respond with JSON only: {"root": string, "corr": string, "prev": string}.${skills(findingWritingSkill, sgPeiContextSkill, riskRemediationSkill, findingSpecificitySkill)}`;
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
): Promise<Omit<EvidenceFillDraft, "live"> & { live: true; usage?: AIUsage }> {
  const system = `You are an evidence intake assistant for an EduTrust GD4 internal audit. You are given only a document link/filename and the checklist line it is meant to support — you cannot open or read the document, so never assume or invent its content. Suggest plausible metadata from the link/filename alone, and draft a short auditor note (1-2 sentences) that explicitly tells the human auditor what they still need to verify themselves. Respond with JSON only: {"title": string, "type": "Policy/Procedure" | "Record/Log" | "System screenshot" | "Minutes" | "Survey/Feedback" | "Other", "date": string (YYYY-MM-DD, guess if unknown), "sufficiency": "Present" | "Weak" | "Missing", "auditorNote": string}.`;
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
  // When set, this is a second "challenge" pass: re-examine these prior
  // verdicts and downgrade any not fully and explicitly evidenced.
  challenge?: { lineId: string; status: string }[];
  // Called as each parallel audit batch completes so the UI can show live
  // batch progress ("Auditing batch 2 of 5"). current is 1-based.
  onBatchProgress?: (current: number, total: number) => void;
};

// Wall-clock-safe ceiling on how much extracted document text is sent to one
// audit call. Shared with the store so its condense-to-fit pass targets the
// SAME budget — otherwise the store could condense to just over this and the
// audit would re-truncate (and show an alarming "files may be missing" note)
// even though every document was already read and summarised. ~32k chars is
// Store-level condensing budget (chars). The store pre-condenses documents to
// fit the whole folder into this limit before calling runLiveFolderAudit.
export const FOLDER_DOC_CAP = 32000;

// Per-batch document budget (chars). Each individual OpenAI call sees at most
// this many chars of docText — deliberately smaller than FOLDER_DOC_CAP so the
// total input context (system prompt ~5k tokens + doc ~5k tokens) stays under
// ~12k tokens per call, keeping TTFT fast and output generation well within the
// timeout ceiling. The store-level condensing means the first 20k chars of a
// well-condensed docText already covers the key content of all documents.
const BATCH_DOC_CAP = 20_000;

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
  // APSR assessment using the official EduTrust Scoring Rubric dimensions
  // (GD4 §23): Approach → Processes → Systems & Outcomes → Review, assessed in
  // that order. The overall Met/Partial/Not met is NOT decided by the model — it
  // is derived in code by deriveApsrStatus (Approach hard-gates), the same way
  // the score/band are never left to the model alone.
  const base = `You are a GD4 internal auditor applying the official EduTrust Scoring Rubric, which assesses four dimensions — Approach, Processes, Systems & Outcomes, Review (APSR). You are given the official GD4 requirement, the institution's documents split into a "=== POLICY & PROCEDURE ===" section and an "=== ACTUAL EVIDENCE ===" section (each chunk headed by its file path and type), and checklist statements. Assess each statement on the four rubric dimensions IN ORDER, using ONLY the text given and never assuming content that isn't there:
1. APPROACH (documented policies and procedures — the methods, tools and techniques used to meet the requirement). Read the POLICY & PROCEDURE text against the requirement WORD BY WORD. approach.status: "Meeting" only if the documented approach is specific, complete against the requirement AND sustainable (states who does what, when and how, repeatable year on year); "Beginning" if it is vague, boilerplate, copy-paste, not specific to this institution, or not sustainable; "Not evident" if no documented approach addresses it. Be critical — comment in approach.note on why it is or isn't sustainable / too generic.
2. PROCESSES (actual implementation of those policies and procedures). Using ONLY the ACTUAL EVIDENCE text, processes.status: "Deployed" if records show it implemented and managed, "Weak" if deployment is weak/partial, "Not evident" if there is no implementation evidence (a documented approach on paper is NOT implementation).
3. SYSTEMS & OUTCOMES (the desired outcomes derived from that implementation). systemsOutcomes.status: "Evident" if the desired outcomes/results are actually produced, "Limited" if outcomes are limited, "Not evident" if none.
4. REVIEW (evaluation of the appropriateness, relevance and effectiveness of the approach and process for continual improvement). review.status: "Evident" if there is a real review with improvement action, "Not evident" otherwise.
Each "note" must be a critical AUDITOR ANALYSIS, not a description or summary of the document. Never merely restate what the document contains. For approach.note: judge HOW WELL the documented approach meets THIS requirement — name specifically which Describe/Show expectations it covers and which it omits or addresses only weakly, say whether it is genuinely specific to this institution or boilerplate/generic, whether it is sustainable (repeatable, with named owners and timing) or ad hoc, and end with ONE concrete improvement the institution should make. For processes/systemsOutcomes/review notes: state what evidence WOULD prove the dimension and what is actually missing, not a paraphrase of any text found. A note that only describes the document's contents is a failure — write the auditor's judgement of its adequacy and gaps.
For every non-empty claim cite the specific source file(s) (by their "--- path ---" heading) in "sources". Cross-check file types: if a file in the POLICY & PROCEDURE section looks like an operational record, log, attendance sheet, minutes or filled-in form (not a policy/SOP/procedure/plan/framework), or a file in the ACTUAL EVIDENCE section looks like a pure undated policy document with no implementation records, add a one-sentence warning per problematic file to "folderWarnings" (e.g. "Policy folder: 'HR_Attendance_Log_Jan.xlsx' appears to be an attendance record, not a procedure — move to Actual Evidence").${STRICTNESS_CLAUSE[strictness] || ""}${skills(apsrRubricSkill, evidenceStandardsSkill, findingWritingSkill, findingSpecificitySkill, sgPeiContextSkill)}`;
  const challengeRule = opts.challenge
    ? ` This is a SECOND, stricter review pass. Earlier overall verdicts are given; re-examine each and DOWNGRADE any generous rating — in particular, demote approach.status from "Meeting" to "Beginning" unless the documented approach is genuinely specific and sustainable, and demote processes.status unless implementation is explicitly evidenced.`
    : "";
  const system = `${base}${challengeRule} Each "note" must be 2–3 targeted sentences: name the specific file, record, role, or procedure gap you found; state precisely what is missing and what the institution must do to fix it; include dates, counts, or named roles where visible in the documents. Write as an auditor's direct assessment — never merely describe or summarise the document's contents. Respond with JSON only: {"lines": [{"lineId": string, "approach": {"status": "Meeting"|"Beginning"|"Not evident", "note": string}, "processes": {"status": "Deployed"|"Weak"|"Not evident", "note": string}, "systemsOutcomes": {"status": "Evident"|"Limited"|"Not evident", "note": string}, "review": {"status": "Evident"|"Not evident", "note": string}, "sources": string[]}], "folderWarnings": ["optional one-sentence warnings about mis-filed documents"]}.`;

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

  type RawLeg = { status?: unknown; note?: unknown };
  type RawLine = { lineId: string; approach?: RawLeg; processes?: RawLeg; systemsOutcomes?: RawLeg; review?: RawLeg; sources?: unknown };
  const byId = new Map(
    arr
      .filter((x): x is RawLine => !!x && typeof x === "object" && typeof (x as { lineId?: unknown }).lineId === "string")
      .map((x) => [x.lineId, x])
  );

  // Coerce each dimension into the typed APSR shape, defaulting to the WORST
  // value so a missing/garbled dimension never accidentally credits the line.
  // Track any dimension that fell back so the caller can log a warning.
  const parseWarnings: string[] = [];
  const leg = <T extends string>(raw: RawLeg | undefined, allowed: readonly T[], fallback: T, dimName: string, lineId: string): { status: T; note: string } => {
    const s = raw?.status;
    const ok = (allowed as readonly string[]).includes(s as string);
    if (!ok) parseWarnings.push(`Line ${lineId} — ${dimName} status "${String(s)}" not in allowed set; defaulted to "${fallback}"`);
    return { status: ok ? (s as T) : fallback, note: typeof raw?.note === "string" ? raw.note : "" };
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
    return { lineId: l.id, status, reason, sources, apsr };
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
  const system = `You are a senior EduTrust strategic consultant reviewing a complete internal audit result for a Singapore PEI. Analyse the criterion bands, open findings, and audit journal to produce: (1) top 3 strategic priorities (most impactful gaps to address first), (2) systemic issues (cross-cutting root causes that appear in multiple criteria), (3) a concrete path to 4-Year (Star) — what specifically needs to change, (4) the single most urgent immediate action. Be specific to the GD4 standard, cite criterion and sub-criterion numbers. Do not soften or hedge. Respond with JSON only: {"priorities": string[], "systemicIssues": string[], "starPath": string, "immediateActions": string[]}.${skills(bandCalibrationSkill, sgPeiContextSkill, consultantInsightsSkill, riskRemediationSkill, externalAuditorSkill)}`;

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
): Promise<{ observation: string; criteria: string; effect: string; usage?: AIUsage }> {
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
Respond with JSON only: {"observation": string, "criteria": string, "effect": string}.${skills(findingSpecificitySkill, sgPeiContextSkill, findingWritingSkill)}`;

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
  };
}
