import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings, ChecklistLineGroup, SpecificChecklistLine } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runLiveGroupedFindingWriter } from "../findingWriter";
import { GD4_REQUIREMENTS } from "../../../data/gd4Requirements";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const REQ = GD4_REQUIREMENTS[0];

function line(): SpecificChecklistLine {
  return { id: "L1", text: "Strategic plan documented.", status: "Not met", evidence: [], generatedBy: "ai", sourceRef: `${REQ.id}.DS1` };
}
function group(): ChecklistLineGroup {
  return {
    gd4ItemId: REQ.id,
    subCriterionId: REQ.subCriterionId,
    gapType: "Implementation/Process",
    primaryApsrDimension: "Processes",
    lines: [line()],
    sourceRefs: [`${REQ.id}.DS1`],
    sourceTexts: ["Strategic plan documented."],
    severity: "High",
    riskCategory: "C",
  };
}

beforeEach(() => { mockChat.mockReset(); });

describe("runLiveGroupedFindingWriter — cancellation propagates (does not fall back to a simulated draft)", () => {
  it("throws when the call was aborted, so the caller stops instead of writing a draft", async () => {
    const ac = new AbortController();
    ac.abort();
    mockChat.mockRejectedValue(new Error("AI call cancelled."));
    await expect(runLiveGroupedFindingWriter(group(), REQ, SETTINGS, { signal: ac.signal })).rejects.toThrow(/cancel/i);
  });

  it("still falls back to a simulated draft on an ordinary (non-cancel) AI error", async () => {
    mockChat.mockRejectedValue(new Error("OpenAI request failed (500)"));
    const result = await runLiveGroupedFindingWriter(group(), REQ, SETTINGS, {});
    expect(result.live).toBe(false);
    expect(result.observation).toBeTruthy();
  });

  it("passes the abort signal through to chatComplete", async () => {
    const ac = new AbortController();
    mockChat.mockImplementation(async (_messages, _settings, opts) => {
      expect(opts?.signal).toBe(ac.signal);
      return JSON.stringify({ title: "t", observation: "o", criteria: "c", effect: "e", rootCause: "r", corrective: "co", preventive: "p", apsrBullets: { approach: [], processes: [], systemsOutcomes: [], review: [] } });
    });
    await runLiveGroupedFindingWriter(group(), REQ, SETTINGS, { signal: ac.signal });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
