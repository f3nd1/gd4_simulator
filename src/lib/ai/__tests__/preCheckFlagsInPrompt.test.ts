import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Part 3 of the pre-check module: a flagged pre-analysis checklist item must
// appear as advisory context in the Evidence assessment prompts sent to the
// AI — never a directive, and only for lines that actually carry a flag.
// Under the two-pass flow the flag block rides in BOTH passes' user prompts:
// the extractor uses it to target its search, the judge to weigh the concern.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const EVIDENCE_DOC = `[CHUNK:C001] --- Receipt.pdf ---\nOfficial receipt issued for course fees.`;

// Extraction returns one verified candidate so the judge pass runs.
const EXTRACT_RESPONSE = JSON.stringify({
  results: [{ ref: "4.2.2.DS1", candidates: [{ aspect: "fee receipt", quote: "Official receipt issued for course fees.", kind: "record", chunkId: "C001" }] }],
});
const JUDGE_RESPONSE = JSON.stringify({
  results: [{ ref: "4.2.2.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }],
});

function mockTwoPass() {
  mockChat.mockImplementation(async (messages) => {
    const system = String(messages[0]?.content ?? "");
    return system.includes("EXTRACTION pass") ? EXTRACT_RESPONSE : JUDGE_RESPONSE;
  });
}

function userTexts(): string[] {
  return mockChat.mock.calls.map((c) => String(c[0].find((m) => m.role === "user")?.content ?? ""));
}

// Block body matters: mockReset() returns the mock, and vitest calls a
// function RETURNED from beforeEach as a cleanup hook — which would invoke
// chatComplete() with no args after every test.
beforeEach(() => { mockChat.mockReset(); });

describe("pre-check flags → Evidence assessment prompts (advisory context, not a directive)", () => {
  const FLAGGED: EvidenceAssessmentInput = {
    ref: "4.2.2.DS1",
    requirementText: "Fee collection sequencing",
    ppdExtract: "fees collected after contract",
    ppdVerdict: "Adequate",
    preCheckFlags: ["Contract executed before fees collected: A receipt is dated 5 January 2026, before the contract signature date 14 March 2026."],
  };

  it("a flagged line's prompt includes the flag text, worded as advisory — in BOTH the extract and judge passes", async () => {
    mockTwoPass();
    await runEvidenceAssessment([FLAGGED], EVIDENCE_DOC, SETTINGS, {});
    const users = userTexts();
    expect(users.length).toBeGreaterThanOrEqual(2); // extract + judge
    for (const userText of users) {
      expect(userText).toContain("Pre-check flags");
      expect(userText).toContain("not a directive");
      expect(userText).toContain("A receipt is dated 5 January 2026, before the contract signature date 14 March 2026");
    }
  });

  it("a clean (unflagged) line's prompts have no 'Pre-check flags' block at all", async () => {
    mockTwoPass();
    const line: EvidenceAssessmentInput = {
      ref: "4.2.2.DS1",
      requirementText: "Fee collection sequencing",
      ppdExtract: "fees collected after contract",
      ppdVerdict: "Adequate",
      // no preCheckFlags — must add no prompt noise
    };
    await runEvidenceAssessment([line], EVIDENCE_DOC, SETTINGS, {});
    for (const userText of userTexts()) {
      expect(userText).not.toContain("Pre-check flags");
    }
  });

  it("the judge system prompt explains what a pre-check flag is and that it must not override the evidence", async () => {
    mockTwoPass();
    await runEvidenceAssessment([FLAGGED], EVIDENCE_DOC, SETTINGS, {});
    const systems = mockChat.mock.calls.map((c) => String(c[0].find((m) => m.role === "system")?.content ?? ""));
    const judgeSystem = systems.find((s) => !s.includes("EXTRACTION pass"))!;
    expect(judgeSystem).toContain("PRE-CHECK FLAGS");
    expect(judgeSystem.toLowerCase()).toContain("not a verdict");
  });
});
