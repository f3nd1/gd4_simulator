import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings, PromptReviewRatings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { reviseUserPrompt } from "../promptReviser";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const RATINGS: PromptReviewRatings = {
  accuracy: "Weak", completeness: "Adequate", relevance: "Adequate", tone: "Adequate", complianceRisk: "High",
};

const baseArgs = {
  originalPrompt: "Write a finding.",
  aiOutput: "A finding.",
  ratings: RATINGS,
  missingInfo: "the clause reference",
  suggestedImprovement: "ask for a clause",
  correction: "It should cite the GD4 clause.",
  reason: "No clause was cited.",
  settings: SETTINGS,
};

beforeEach(() => { mockChat.mockReset(); });

describe("reviseUserPrompt", () => {
  it("returns the improved prompt text verbatim (trimmed)", async () => {
    mockChat.mockResolvedValue("  Write a finding that cites the exact GD4 clause.  ");
    const revised = await reviseUserPrompt(baseArgs);
    expect(revised).toBe("Write a finding that cites the exact GD4 clause.");
  });

  it("strips stray code fences the model may wrap around the prompt", async () => {
    mockChat.mockResolvedValue("```\nWrite a finding that cites the exact GD4 clause.\n```");
    const revised = await reviseUserPrompt(baseArgs);
    expect(revised).toBe("Write a finding that cites the exact GD4 clause.");
  });

  it("feeds the reviewer's ratings, correction and reason into the prompt", async () => {
    mockChat.mockResolvedValue("improved");
    await reviseUserPrompt(baseArgs);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const [messages] = mockChat.mock.calls[0];
    const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Write a finding.");
    expect(userMsg).toContain("It should cite the GD4 clause.");
    expect(userMsg).toContain("No clause was cited.");
    expect(userMsg).toContain("Accuracy: Weak");
    expect(userMsg).toContain("Compliance risk: High");
  });

  it("makes a real chatComplete call (no offline fallback)", async () => {
    mockChat.mockResolvedValue("improved");
    await reviseUserPrompt(baseArgs);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
