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
});
