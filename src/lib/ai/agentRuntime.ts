// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, AgentMemoryEntry, Confidence } from "../../types";
import { chatComplete, AIClientError } from "./aiClient";
import type { SimulatedItemVerdict, SimulatedClosureVerdict } from "./simulateAI";

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
  item: { id: string; ais: number; aiBand: number },
  ev: ItemEvidence,
  settings: AISettings,
  memory: AgentMemoryEntry[]
): Promise<Omit<SimulatedItemVerdict, "live"> & { live: true }> {
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine and given to you below. Write a short, specific justification (2-3 sentences) referencing the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.`;
  const user = `Item ${item.id}. Fixed evidence score: ${item.ais}/100, fixed band: ${item.aiBand}. Evidence: approach=${ev.approach}, processes=${ev.processes}, systemsOutcomes=${ev.systemsOutcomes}, review=${ev.review}, traceability=${ev.trace}%, evidence age=${ev.age} days.`;

  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
    settings
  );
  const parsed = parseJSONObject(content);

  return {
    score: item.ais,
    band: item.aiBand,
    confidence: (parsed.confidence as Confidence) || "Medium",
    justification: (parsed.justification as string) || content,
    higherBand: (parsed.higherBand as string) || "Add or strengthen the weakest evidence limb and re-run this review.",
    by: agent.name,
    live: true,
  };
}

export async function runLiveClosureReview(
  closure: { root?: string; corr?: string; prev?: string; evid?: string },
  settings: AISettings,
  memory: AgentMemoryEntry[]
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true }> {
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.`;
  const user = `Root cause: ${closure.root || "(none provided)"}\nCorrective action: ${closure.corr || "(none provided)"}\nPreventive action: ${closure.prev || "(none provided)"}\nClosure evidence link: ${closure.evid || "(none provided)"}`;

  const content = await chatComplete(
    [{ role: "system", content: system }, ...memoryToMessages(memory), { role: "user", content: user }],
    settings
  );
  const parsed = parseJSONObject(content);

  return {
    verdict: (parsed.verdict as SimulatedClosureVerdict["verdict"]) || "Maintain Finding",
    reason: (parsed.reason as string) || content,
    evidenceNeeded: (parsed.evidenceNeeded as string) || "Specify the evidence still needed.",
    live: true,
  };
}
