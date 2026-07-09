import { chatComplete } from "./aiClient";
import type { AISettings, PromptReviewRatings } from "../../types";

// Given a user-authored prompt, the output it produced, and a human reviewer's
// ratings + correction + reason, ask the AI to rewrite the ORIGINAL PROMPT so a
// future run is less likely to repeat the weakness. Returns plain prompt text
// (a prompt, not JSON). This NEVER fabricates a revision: the caller must check
// aiOfflineReason(settings) first and not call this when AI is unavailable, and
// this makes a real chatComplete call — there is no offline/simulated fallback.

const RATING_LABEL: Record<string, string> = {
  accuracy: "Accuracy",
  completeness: "Completeness",
  relevance: "Relevance",
  tone: "Tone & wording",
  complianceRisk: "Compliance risk",
};

export async function reviseUserPrompt(args: {
  originalPrompt: string;
  aiOutput: string;
  ratings: PromptReviewRatings;
  missingInfo: string;
  suggestedImprovement: string;
  correction: string;
  reason: string;
  settings: AISettings;
  signal?: AbortSignal;
}): Promise<string> {
  const ratingsLine = Object.entries(args.ratings)
    .map(([k, v]) => `${RATING_LABEL[k] ?? k}: ${v}`)
    .join(", ");

  const system = `You improve a user-authored instruction (a "prompt") that will be reused to generate future outputs. You are given the original prompt, the output it produced, a human reviewer's rating of that output, what the reviewer says the correct answer should have been, and why the output was wrong. Rewrite the ORIGINAL PROMPT so a future run is more likely to produce the correct result and avoid the same weakness. Preserve the reviewer's intent; make the instruction clearer, more complete, and safer where compliance risk was flagged. Do not answer the task yourself and do not critique the output — return ONLY the improved prompt text, with no preamble, no explanation, and no surrounding quotes or code fences.`;

  const user = `ORIGINAL PROMPT:
${args.originalPrompt}

OUTPUT IT PRODUCED:
${args.aiOutput || "(no output was recorded)"}

REVIEWER RATINGS: ${ratingsLine}
MISSING INFORMATION THE REVIEWER NOTED: ${args.missingInfo.trim() || "(none noted)"}
SUGGESTED IMPROVEMENT THE REVIEWER NOTED: ${args.suggestedImprovement.trim() || "(none noted)"}
WHAT THE CORRECT ANSWER SHOULD HAVE BEEN: ${args.correction.trim() || "(not specified)"}
WHY THE OUTPUT WAS WRONG: ${args.reason.trim() || "(not specified)"}`;

  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    args.settings,
    { temperature: 0.3, signal: args.signal }
  );

  // Strip any stray code fences the model may wrap around the prompt text.
  return content.trim().replace(/^```[\w-]*\s*/i, "").replace(/\s*```$/i, "").trim();
}
