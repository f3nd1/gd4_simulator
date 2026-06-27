// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence, GD4Requirement } from "../../types";
import { chatComplete, AIClientError } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict, PdcaBreakdown } from "./simulateAI";
import { derivePdcaStatus, pdcaReason } from "./simulateAI";

export { AIClientError };

function memoryToMessages(memory: AgentMemoryEntry[]) {
  return memory.map((m) => ({ role: m.role, content: m.content }));
}

function parseJSONObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    return {};
  }
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
  const parsed = parseJSONObject(content);

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

function parseJSONArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray((parsed as Record<string, unknown>).lines)) return (parsed as Record<string, unknown>).lines as unknown[];
    return [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    return [];
  }
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

  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
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
  settings: AISettings
): Promise<{ root: string; corr: string; prev: string }> {
  const system = `You are an EduTrust GD4 quality-action assistant. Given an audit finding, propose a likely root cause, a corrective action (fixes this specific gap now), and a preventive action (stops it recurring). Be concrete and specific to the finding; these are draft suggestions the auditor will edit and must still evidence — do not claim the finding is closed. Respond with JSON only: {"root": string, "corr": string, "prev": string}.`;
  const user = `Finding (GD4 ${finding.gd4ItemId}): ${finding.issue}`;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
  const parsed = parseJSONObject(content);
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
  Lenient: " Calibration: give reasonable benefit of the doubt on each PDCA leg — if the documents broadly address it, lean towards the more favourable rating.",
  Standard: "",
  Strict:
    " Calibration: be conservative and hard to satisfy on every PDCA leg. Rate plan.status \"Adequate\" ONLY when the procedure is genuinely specific, complete and sustainable; rate do.status \"Implemented\" ONLY when records explicitly show it happening; require an actual control for Check and an actual review for Act. When in doubt, choose the lower rating — a high band must be genuinely earned.",
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

export async function runLiveFolderAudit(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts = {}
): Promise<FolderAuditLineVerdict[]> {
  const strictness = opts.strictness || "Standard";
  // PDCA-staged assessment: the model assesses Plan → Do → Check → Act in
  // strict order. The overall Met/Partial/Not met is NOT decided by the model —
  // it is derived in code by derivePdcaStatus (Plan hard-gates), the same way
  // the score/band are never left to the model alone.
  const base = `You are a GD4 internal auditor applying the PDCA cycle (Plan-Do-Check-Act). You are given the official GD4 requirement, the institution's documents split into a "=== POLICY & PROCEDURE ===" section and an "=== ACTUAL EVIDENCE ===" section (each chunk headed by its file path and type), and checklist statements. Assess each statement in this STRICT ORDER, using ONLY the text given and never assuming content that isn't there:
1. PLAN — Read the POLICY & PROCEDURE text against the requirement WORD BY WORD. Decide plan.status: "Adequate" only if the procedure is specific, complete against the requirement, AND sustainable (it actually states who does what, when and how, and could be repeated year on year); "Generic" if it is vague, boilerplate, copy-paste, not specific to this institution, or not sustainable; "Missing" if no procedure addresses it. Be critical and ungenerous — comment in plan.note on exactly why it is or isn't sustainable / too generic.
2. DO — Using ONLY the ACTUAL EVIDENCE text, decide do.status: "Implemented" if records show the procedure is actually carried out, "Partial" if only partly, "None" if there is no implementation evidence (a policy on paper is NOT implementation).
3. CHECK — Is there a control that monitors the procedure is followed (checklist, audit, sign-off, monitoring record)? check.status "Yes"/"No".
4. ACT — Is there a review that improves the procedure (management review, lessons learned, revision history)? act.status "Yes"/"No".
For every non-empty claim cite the specific source file(s) (by their "--- path ---" heading) in "sources".${STRICTNESS_CLAUSE[strictness] || ""}`;
  const challengeRule = opts.challenge
    ? ` This is a SECOND, stricter review pass. Earlier overall verdicts are given; re-examine each and DOWNGRADE any generous rating — in particular, demote plan.status from "Adequate" to "Generic" unless the procedure is genuinely specific and sustainable, and demote do.status unless implementation is explicitly evidenced.`
    : "";
  const system = `${base}${challengeRule} Respond with JSON only: {"lines": [{"lineId": string, "plan": {"status": "Adequate"|"Generic"|"Missing", "note": string}, "do": {"status": "Implemented"|"Partial"|"None", "note": string}, "check": {"status": "Yes"|"No", "note": string}, "act": {"status": "Yes"|"No", "note": string}, "sources": string[]}]}.`;

  const standardBlock = opts.standard ? `The official GD4 requirement this folder must satisfy (judge the POLICY against THIS standard, word by word):\n"""\n${opts.standard.slice(0, 4000)}\n"""\n\n` : "";
  const priorBlock = opts.challenge ? `Earlier (first-pass) overall verdicts to re-examine and toughen:\n${opts.challenge.map((c) => `[${c.lineId}] ${c.status}`).join("\n")}\n\n` : "";
  const user = `${standardBlock}${priorBlock}Document text extracted from the folder (split into POLICY & PROCEDURE and ACTUAL EVIDENCE; each chunk headed by file path + type; may be truncated):\n"""\n${docText.slice(0, 12000)}\n"""\n\nChecklist statements to assess:\n${lines
    .map((l) => `[${l.id}] ${l.text}`)
    .join("\n")}`;

  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
  const arr = parseJSONArray(content);

  type RawLeg = { status?: unknown; note?: unknown };
  type RawLine = { lineId: string; plan?: RawLeg; do?: RawLeg; check?: RawLeg; act?: RawLeg; sources?: unknown };
  const byId = new Map(
    arr
      .filter((x): x is RawLine => !!x && typeof x === "object" && typeof (x as { lineId?: unknown }).lineId === "string")
      .map((x) => [x.lineId, x])
  );

  // Coerce each leg into the typed PDCA shape, defaulting to the WORST value so
  // a missing/garbled leg never accidentally credits the line.
  const leg = <T extends string>(raw: RawLeg | undefined, allowed: readonly T[], fallback: T): { status: T; note: string } => {
    const s = raw?.status;
    return { status: (allowed as readonly string[]).includes(s as string) ? (s as T) : fallback, note: typeof raw?.note === "string" ? raw.note : "" };
  };

  return lines.map((l) => {
    const v = byId.get(l.id);
    const pdca: PdcaBreakdown = {
      plan: leg(v?.plan, ["Adequate", "Generic", "Missing"] as const, "Missing"),
      do: leg(v?.do, ["Implemented", "Partial", "None"] as const, "None"),
      check: leg(v?.check, ["Yes", "No"] as const, "No"),
      act: leg(v?.act, ["Yes", "No"] as const, "No"),
    };
    const status = derivePdcaStatus(pdca);
    const sources = Array.isArray(v?.sources) ? (v!.sources as unknown[]).filter((s): s is string => typeof s === "string") : undefined;
    const reason = v ? pdcaReason(pdca) : "The model did not return a verdict for this line; treated as unmet pending re-run.";
    return { lineId: l.id, status, reason, sources, pdca };
  });
}
