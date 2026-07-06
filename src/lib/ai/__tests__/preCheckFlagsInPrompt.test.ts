import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Part 3 of the pre-check module: a flagged pre-analysis checklist item must
// appear as advisory context in the Evidence assessment prompt sent to the
// AI — never a directive, and only for lines that actually carry a flag.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const EVIDENCE_DOC = `[CHUNK:C001] --- Receipt.pdf ---\nOfficial receipt text.`;

const RESPONSE = JSON.stringify({
  results: [{ ref: "4.2.2.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }],
});

beforeEach(() => mockChat.mockReset());

describe("pre-check flags → Evidence assessment prompt (advisory context, not a directive)", () => {
  it("a flagged line's prompt includes the flag text, worded as advisory", async () => {
    mockChat.mockImplementation(async () => RESPONSE);
    const line: EvidenceAssessmentInput = {
      ref: "4.2.2.DS1",
      requirementText: "Fee collection sequencing",
      ppdExtract: "fees collected after contract",
      ppdVerdict: "Adequate",
      preCheckFlags: ["Contract executed before fees collected: A receipt is dated 5 January 2026, before the contract signature date 14 March 2026."],
    };
    await runEvidenceAssessment([line], EVIDENCE_DOC, SETTINGS, {});
    const messages = mockChat.mock.calls[0][0];
    const userText = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userText).toContain("Pre-check flags");
    expect(userText).toContain("not a directive");
    expect(userText).toContain("A receipt is dated 5 January 2026, before the contract signature date 14 March 2026");
  });

  it("a clean (unflagged) line's prompt has no 'Pre-check flags' block at all", async () => {
    mockChat.mockImplementation(async () => RESPONSE);
    const line: EvidenceAssessmentInput = {
      ref: "4.2.2.DS1",
      requirementText: "Fee collection sequencing",
      ppdExtract: "fees collected after contract",
      ppdVerdict: "Adequate",
      // no preCheckFlags — must add no prompt noise
    };
    await runEvidenceAssessment([line], EVIDENCE_DOC, SETTINGS, {});
    const messages = mockChat.mock.calls[0][0];
    const userText = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userText).not.toContain("Pre-check flags");
  });

  it("the system prompt explains what a pre-check flag is and that it must not override the evidence", async () => {
    mockChat.mockImplementation(async () => RESPONSE);
    const line: EvidenceAssessmentInput = {
      ref: "4.2.2.DS1", requirementText: "x", ppdExtract: "x", ppdVerdict: "Adequate", preCheckFlags: ["some flag"],
    };
    await runEvidenceAssessment([line], EVIDENCE_DOC, SETTINGS, {});
    const messages = mockChat.mock.calls[0][0];
    const systemText = messages.find((m) => m.role === "system")?.content ?? "";
    expect(systemText).toContain("PRE-CHECK FLAGS");
    expect(systemText.toLowerCase()).toContain("not a verdict");
  });
});
