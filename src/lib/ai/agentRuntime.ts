// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence, GD4Requirement, ApsrBreakdown } from "../../types";
import { chatComplete, AIClientError } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";
import { deriveApsrStatus, apsrReason } from "./simulateAI";

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
): Promise<Omit<SimulatedItemVerdict, "live"> & { live: true }> {
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Use your earlier-turn memory of other items you have reviewed to flag when the SAME gap recurs across items (e.g. a missing review/record pattern), so the auditor can fix it systemically. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.`;
  const user = `Item ${item.id}. Fixed evidence score: ${item.eff}/100, fixed band: ${item.band} (source: ${item.checklistOverride ? "Sub-Criterion Checklist outcome" : "evidence matrix quick rating"}). Evidence: approach=${ev.approach}, processes=${ev.processes}, systemsOutcomes=${ev.systemsOutcomes}, review=${ev.review}, traceability=${ev.trace}%, evidence age=${ev.age} days, owner=${ev.owner || "(unassigned)"}, Drive evidence link=${ev.drive ? ev.drive : "MISSING — no link has been provided"}.`;

  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
    settings
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
export async function runLiveChecklistGeneration(req: GD4Requirement, settings: AISettings): Promise<{ text: string; clause: string }[]> {
  const system = `You are a GD4 internal audit checklist assistant. Decompose the given GD4 item's Describe/Show points and Notes into a JSON array of atomic, testable checklist statements an auditor can mark Met, Partial, Not met or Not Applicable against real evidence. Each statement must be specific and independently verifiable, and must cite the GD4 item id as its clause. Respond with JSON only: an array of objects {"text": string, "clause": string}, nothing else.`;
  const user = `GD4 item ${req.id} — ${req.requirement}\nDescribe/Show:\n${req.describeShow.map((d, i) => `${i + 1}. ${d}`).join("\n")}${
    req.notes.length ? `\nNotes:\n${req.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}` : ""
  }`;

  // Higher temperature for generation (diverse, natural-sounding lines) vs 0.2
  // for analysis (deterministic verdicts).
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.7 });
  const arr = parseJSONArray(content);
  return arr
    .filter((x): x is { text: string; clause?: string } => !!x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string")
    .map((x) => ({ text: (x as { text: string }).text, clause: (x as { clause?: string }).clause || `GD4 ${req.id}` }));
}

export async function runLiveClosureReview(
  closure: { root?: string; corr?: string; prev?: string; evid?: string },
  settings: AISettings,
  memory: AgentMemoryEntry[]
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true }> {
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described, and never let well-written narrative substitute for missing evidence. If no closure evidence link is provided, you must return "Maintain Finding" regardless of how complete or convincing the narrative sounds. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.`;
  const user = `Root cause: ${closure.root || "(none provided)"}\nCorrective action: ${closure.corr || "(none provided)"}\nPreventive action: ${closure.prev || "(none provided)"}\nClosure evidence link: ${closure.evid || "(none provided — no evidence is linked)"}`;

  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
    settings
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
    };
  }

  return {
    verdict: (parsed.verdict as SimulatedClosureVerdict["verdict"]) || "Maintain Finding",
    reason: (parsed.reason as string) || content,
    evidenceNeeded: (parsed.evidenceNeeded as string) || "Specify the evidence still needed.",
    live: true,
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
): Promise<{ root: string; corr: string; prev: string }> {
  const system = `You are an EduTrust GD4 quality-action assistant. Given an audit finding (and, where provided, the official GD4 requirement it relates to and the APSR breakdown of which rubric dimension fell short), propose: a ROOT CAUSE that names WHY the gap exists — distinguish an Approach gap (the documented policy/procedure is missing or too generic in the PPD) from a Processes gap (documented but not implemented) from a Systems & Outcomes gap (no desired outcomes produced) from a Review gap (no evaluation for continual improvement) — then a CORRECTIVE action that fixes this specific gap now, and a PREVENTIVE action that stops it recurring. Be concrete and specific to the requirement; reference the actual evidence/records that should exist. These are draft suggestions the auditor will edit and must still evidence — do not claim the finding is closed. Respond with JSON only: {"root": string, "corr": string, "prev": string}.`;
  const user = `Finding (GD4 ${finding.gd4ItemId}): ${finding.issue}${context?.standard ? `\n\nOfficial GD4 requirement:\n${context.standard}` : ""}${context?.apsr ? `\n\nAPSR assessment of this line:\n${context.apsr}` : ""}`;
  // Higher temperature for drafting (natural, varied narrative) vs deterministic verdicts.
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.7 });
  const parsed = parseJSONObject(content, ["root", "corr", "prev"]);
  return {
    root: (parsed.root as string) || "",
    corr: (parsed.corr as string) || "",
    prev: (parsed.prev as string) || "",
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
): Promise<Omit<EvidenceFillDraft, "live"> & { live: true }> {
  const system = `You are an evidence intake assistant for an EduTrust GD4 internal audit. You are given only a document link/filename and the checklist line it is meant to support — you cannot open or read the document, so never assume or invent its content. Suggest plausible metadata from the link/filename alone, and draft a short auditor note (1-2 sentences) that explicitly tells the human auditor what they still need to verify themselves. Respond with JSON only: {"title": string, "type": "Policy/Procedure" | "Record/Log" | "System screenshot" | "Minutes" | "Survey/Feedback" | "Other", "date": string (YYYY-MM-DD, guess if unknown), "sufficiency": "Present" | "Weak" | "Missing", "auditorNote": string}.`;
  const user = `Evidence link: ${link}\nChecklist line this evidence is meant to support: ${lineText}`;

  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
  const parsed = parseJSONObject(content);

  return {
    title: (parsed.title as string) || link,
    type: (parsed.type as string) || "Other",
    date: (parsed.date as string) || new Date().toISOString().slice(0, 10),
    sufficiency: (parsed.sufficiency as EvidenceFillDraft["sufficiency"]) || "Present",
    auditorNote: (parsed.auditorNote as string) || `Verify this evidence actually demonstrates: "${lineText}".`,
    live: true,
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
};

export type FolderAuditResult = {
  verdicts: FolderAuditLineVerdict[];
  // Set when any APSR dimension fell back to the worst-case default because
  // the model's JSON for that leg was missing or malformed.
  parseWarnings: string[];
  // Set when docText was larger than the cap and some content was not sent.
  truncationNote?: string;
};

export async function runLiveFolderAudit(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts = {}
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
For every non-empty claim cite the specific source file(s) (by their "--- path ---" heading) in "sources".${STRICTNESS_CLAUSE[strictness] || ""}`;
  const challengeRule = opts.challenge
    ? ` This is a SECOND, stricter review pass. Earlier overall verdicts are given; re-examine each and DOWNGRADE any generous rating — in particular, demote approach.status from "Meeting" to "Beginning" unless the documented approach is genuinely specific and sustainable, and demote processes.status unless implementation is explicitly evidenced.`
    : "";
  const system = `${base}${challengeRule} Respond with JSON only: {"lines": [{"lineId": string, "approach": {"status": "Meeting"|"Beginning"|"Not evident", "note": string}, "processes": {"status": "Deployed"|"Weak"|"Not evident", "note": string}, "systemsOutcomes": {"status": "Evident"|"Limited"|"Not evident", "note": string}, "review": {"status": "Evident"|"Not evident", "note": string}, "sources": string[]}]}.`;

  const DOC_CAP = 12000;
  const truncated = docText.length > DOC_CAP;
  const truncationNote = truncated
    ? `Note: the folder contained ${docText.length.toLocaleString()} characters of document text; only the first ${DOC_CAP.toLocaleString()} were sent to this audit. Some files may not have been reviewed — consider running the audit again after condensing large documents.`
    : undefined;
  const truncationHint = truncated
    ? ` (NOTE: only ${DOC_CAP.toLocaleString()} of ${docText.length.toLocaleString()} total characters were provided below — some files may be missing from this review)`
    : "";

  const standardBlock = opts.standard ? `The official GD4 requirement this folder must satisfy (judge the APPROACH against THIS standard, word by word):\n"""\n${opts.standard.slice(0, 4000)}\n"""\n\n` : "";
  const priorBlock = opts.challenge ? `Earlier (first-pass) overall verdicts to re-examine and toughen:\n${opts.challenge.map((c) => `[${c.lineId}] ${c.status}`).join("\n")}\n\n` : "";
  const user = `${standardBlock}${priorBlock}Document text extracted from the folder (split into POLICY & PROCEDURE and ACTUAL EVIDENCE; each chunk headed by file path + type${truncationHint}):\n"""\n${docText.slice(0, DOC_CAP)}\n"""\n\nChecklist statements to assess:\n${lines
    .map((l) => `[${l.id}] ${l.text}`)
    .join("\n")}`;

  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
  const arr = parseJSONArray(content);

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

  return { verdicts, parseWarnings, truncationNote };
}
