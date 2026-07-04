import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings, AuditorProfile } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runAuditorPanel, type PanelFindingInput } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

function auditor(id: string, over: Partial<AuditorProfile> = {}): AuditorProfile {
  return { id, auditCycleId: "c1", name: id, type: "Internal", role: "Reviewer", strictness: 70, focusArea: "", checklistTemplateId: "t", ...over };
}
const FINDING: PanelFindingInput = { issue: "Fees collected before contract signed", gd4ItemId: "4.2.1", findingHash: "h1" };

beforeEach(() => { mockChat.mockReset(); });

describe("runAuditorPanel", () => {
  it("captures real token usage on every sub-call so the log shows model + tokens, not a dash", async () => {
    const panel = [auditor("Ana"), auditor("Ben")];
    // The real client reports usage via onUsage — the panel must record it per call.
    mockChat.mockImplementation(async (messages, _settings, o) => {
      const sys = String(messages[0]?.content ?? "");
      o?.onUsage?.({ model: "gpt-test-mini", promptTokens: 100, completionTokens: 40, totalTokens: 140 });
      if (sys.includes("chair of a GD4 EduTrust audit review panel")) {
        return JSON.stringify({ summary: "s", rootCause: "process gap", correctiveAction: "fix", evidenceForClosure: "records", finalClassification: "NC" });
      }
      return JSON.stringify({ analysis: "view", classification: "NC", severity: "Major", rootCauseDirection: "process" });
    });

    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    const log = result.callLog ?? [];
    expect(log.length).toBe(3); // 2 round-1 + synthesis (positions agree → no rebuttal)
    // Every entry carries the real model + a positive token count.
    for (const c of log) {
      expect(c.usage?.model).toBe("gpt-test-mini");
      expect(c.usage?.totalTokens).toBe(140);
    }
    // The run total is the sum across all sub-calls (3 × 140).
    const total = log.reduce((n, c) => n + (c.usage?.totalTokens ?? 0), 0);
    expect(total).toBe(420);
  });


  it("makes one review call per panellist plus one synthesis, and fills the closure scaffold", async () => {
    const panel = [
      auditor("Ana", { reviewPerspective: "strict-auditor" }),
      auditor("Ben", { reviewPerspective: "risk-challenger" }),
      auditor("Cara", { reviewPerspective: "management-reviewer" }),
    ];
    mockChat.mockImplementation(async (messages) => {
      const sys = String(messages[0]?.content ?? "");
      if (sys.includes("chair of a GD4 EduTrust audit review panel")) {
        return JSON.stringify({
          summary: "Balanced summary.", riskImpact: "Regulatory exposure.",
          rootCause: "No control step links fee collection to contract sign-off (process gap).",
          immediateCorrection: "Halt collection until contracts are signed.",
          correctiveAction: "Add a signed-contract gate to the finance workflow.",
          evidenceForClosure: "Fee register cross-checked to signed contracts for the period.",
          finalClassification: "NC — regulatory requirement not met.",
        });
      }
      return JSON.stringify({ analysis: `Review from ${sys.slice(8, 11)}` });
    });

    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    expect(mockChat).toHaveBeenCalledTimes(4); // 3 panellists + 1 synthesis
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews.every((r) => !r.failed && r.analysis)).toBe(true);
    expect(result.reviews.map((r) => r.perspectiveLabel)).toEqual(["Strict Auditor", "Risk Challenger", "Management Reviewer"]);
    expect(result.synthesis.rootCause).toContain("process gap");
    expect(result.synthesis.correctiveAction).toContain("signed-contract gate");
    expect(result.synthesis.finalClassification).toContain("NC");
    expect(result.findingHash).toBe("h1");

    // callLog: one entry per sub-call, each with the REAL input prompt (not the
    // output) so the AI Review Log "Prompt Sent" tab is correct.
    const log = result.callLog ?? [];
    expect(log.map((c) => c.kind)).toEqual(["round1", "round1", "round1", "synthesis"]);
    for (const c of log) {
      // Prompt Sent = input: has SYSTEM/USER framing and differs from the output.
      expect(c.promptSent).toMatch(/^SYSTEM:\n[\s\S]*\n\nUSER:\n/);
      expect(c.output).not.toBe(c.promptSent);                // input and output are not the same text
      expect(c.output).not.toMatch(/^SYSTEM:\n/);             // the output is not a prompt
    }
    // The synthesis entry's OUTPUT carries the chair's JSON; its PROMPT carries the assembled reviews.
    const synth = log.find((c) => c.kind === "synthesis")!;
    expect(synth.label).toBe("Panel · chair synthesis");
    expect(synth.output).toContain("Balanced summary");        // the mocked synthesis response
    expect(synth.promptSent).toContain("Panellists' reviews:"); // the assembled input
    expect(log[0].label).toContain("· Round 1");
  });

  it("when one panellist call fails, it is noted and the panel synthesises from the rest — never hangs", async () => {
    const panel = [auditor("Ana"), auditor("Ben"), auditor("Cara")];
    let call = 0;
    mockChat.mockImplementation(async (messages) => {
      const sys = String(messages[0]?.content ?? "");
      if (sys.includes("chair of a GD4 EduTrust audit review panel")) {
        return JSON.stringify({ summary: "From the survivors.", rootCause: "process gap", correctiveAction: "fix", evidenceForClosure: "records", finalClassification: "OFI" });
      }
      call++;
      if (call === 2) throw new Error("OpenAI request failed (500)");
      return JSON.stringify({ analysis: "ok" });
    });

    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews.filter((r) => r.failed)).toHaveLength(1);
    expect(result.reviews.filter((r) => !r.failed)).toHaveLength(2);
    expect(result.runWarnings?.some((w) => /review failed/i.test(w))).toBe(true);
    // Synthesis still produced from the two that succeeded.
    expect(result.synthesis.summary).toBe("From the survivors.");
  });

  it("all panellists failing yields no synthesis call and an explanatory summary", async () => {
    const panel = [auditor("Ana"), auditor("Ben")];
    mockChat.mockRejectedValue(new Error("revoked key"));
    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    expect(mockChat).toHaveBeenCalledTimes(2); // no synthesis attempted
    expect(result.reviews.every((r) => r.failed)).toBe(true);
    expect(result.synthesis.summary).toContain("could not be synthesised");
  });

  it("when Round-1 positions disagree, a rebuttal round runs before synthesis", async () => {
    const panel = [
      auditor("Ana", { reviewPerspective: "strict-auditor" }),
      auditor("Ben", { reviewPerspective: "optimistic-process-owner" }),
    ];
    // Ana says NC/Major, Ben says No issue → classification split → Round 2.
    mockChat.mockImplementation(async (messages) => {
      const sys = String(messages[0]?.content ?? "");
      if (sys.includes("chair of a GD4 EduTrust audit review panel")) {
        expect(sys).toContain("rebuttal round"); // chair told discussion happened
        return JSON.stringify({ summary: "Reconciled.", rootCause: "process gap", correctiveAction: "fix", evidenceForClosure: "records", finalClassification: "NC" });
      }
      if (sys.includes("you are now in a discussion round")) {
        return JSON.stringify({ rebuttal: `Rebuttal from ${sys.includes("You are Ana") ? "Ana" : "Ben"}` });
      }
      // Round 1: give opposing positions
      if (sys.includes("You are Ana")) return JSON.stringify({ analysis: "Ana view", classification: "NC", severity: "Major", rootCauseDirection: "process" });
      return JSON.stringify({ analysis: "Ben view", classification: "No issue", severity: "None", rootCauseDirection: "none" });
    });

    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    // 2 round-1 + 2 rebuttal + 1 synthesis
    expect(mockChat).toHaveBeenCalledTimes(5);
    expect(result.discussionTriggered).toBe(true);
    expect(result.reviews.every((r) => r.rebuttal)).toBe(true);
    // Each keeps its own perspective through the rebuttal.
    expect(result.reviews.map((r) => r.perspectiveLabel)).toEqual(["Strict Auditor", "Optimistic Process Owner"]);
    expect(result.runWarnings?.some((w) => /disagreed/i.test(w))).toBe(true);

    // callLog captures all 5 sub-calls: 2 round-1 + 2 rebuttal + 1 synthesis,
    // each labelled and each with its own input prompt.
    const log = result.callLog ?? [];
    expect(log.map((c) => c.kind)).toEqual(["round1", "round1", "rebuttal", "rebuttal", "synthesis"]);
    expect(log.filter((c) => c.kind === "rebuttal").map((c) => c.label)).toEqual([
      "Panel · Ana · Strict Auditor · rebuttal",
      "Panel · Ben · Optimistic Process Owner · rebuttal",
    ]);
    // A rebuttal's prompt contains the other panellists' Round-1 views (its real input).
    expect(log.find((c) => c.kind === "rebuttal")!.promptSent).toContain("other panellists' Round-1 views");
  });

  it("when Round-1 positions agree, no rebuttal round runs", async () => {
    const panel = [auditor("Ana"), auditor("Ben")];
    mockChat.mockImplementation(async (messages) => {
      const sys = String(messages[0]?.content ?? "");
      if (sys.includes("chair of a GD4 EduTrust audit review panel")) {
        return JSON.stringify({ summary: "Agreed.", rootCause: "process gap", correctiveAction: "fix", evidenceForClosure: "records", finalClassification: "NC" });
      }
      return JSON.stringify({ analysis: "aligned", classification: "NC", severity: "Major", rootCauseDirection: "process" });
    });

    const result = await runAuditorPanel(FINDING, panel, SETTINGS);
    expect(mockChat).toHaveBeenCalledTimes(3); // 2 round-1 + synthesis, no rebuttal
    expect(result.discussionTriggered).toBeFalsy();
    expect(result.reviews.every((r) => !r.rebuttal)).toBe(true);
  });
});
