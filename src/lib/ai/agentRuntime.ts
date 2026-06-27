// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence, GD4Requirement } from "../../types";
import { chatComplete, AIClientError } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";

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
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.`;
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
  Lenient: " Calibration: give reasonable benefit of the doubt — if the documents broadly address the statement, lean towards Met or Partial.",
  Standard: "",
  Strict:
    " Calibration: be conservative and hard to satisfy. Mark a line Met ONLY when the documents EXPLICITLY and FULLY evidence it, including records that it is actually implemented and reviewed — a policy or intention alone is at most Partial. When in doubt, choose the lower status. Reserve Met for clearly and completely demonstrated requirements; a high band must be genuinely earned.",
};

export async function runLiveFolderAudit(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  strictness: "Lenient" | "Standard" | "Strict" = "Standard"
): Promise<FolderAuditLineVerdict[]> {
  const system = `You are a GD4 internal audit evidence reviewer. You are given the actual text extracted from documents in an evidence folder, and a list of checklist statements that folder is meant to support. For each statement, judge it Met, Partial, or "Not met" using ONLY the document text given — never assume content that isn't there, and if the text doesn't mention something relevant, mark it "Not met" rather than guessing.${STRICTNESS_CLAUSE[strictness] || ""} Give a one-sentence reason per line citing what was or wasn't found. Respond with JSON only: {"lines": [{"lineId": string, "status": "Met" | "Partial" | "Not met", "reason": string}]}.`;
  const user = `Document text extracted from the folder (may be truncated):\n"""\n${docText.slice(0, 12000)}\n"""\n\nChecklist statements to assess:\n${lines
    .map((l) => `[${l.id}] ${l.text}`)
    .join("\n")}`;

  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings);
  const arr = parseJSONArray(content);

  const byId = new Map(
    arr
      .filter((x): x is { lineId: string; status: string; reason?: string } => !!x && typeof x === "object" && typeof (x as { lineId?: unknown }).lineId === "string")
      .map((x) => [x.lineId, x])
  );

  return lines.map((l) => {
    const v = byId.get(l.id);
    const status = v?.status === "Met" || v?.status === "Partial" || v?.status === "Not met" ? v.status : "Not met";
    return { lineId: l.id, status, reason: v?.reason || "The model did not return a verdict for this line; treated as unmet pending re-run." };
  });
}
