import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings, SpecificChecklistLine } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runHolisticBandSuggestion } from "../agentRuntime";
import { OPTION_A_NOT_ASSESSED_NOTE } from "../../optionAChecklistWrite";
import { GD4_REQUIREMENTS } from "../../../data/gd4Requirements";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "test-key", model: "m", utilityModel: "m", enabled: true };
const REQ = GD4_REQUIREMENTS.find((r) => r.id === "6.2.1")!;

function line(id: string, ref: string, status: SpecificChecklistLine["status"]): SpecificChecklistLine {
  return { id, text: `${ref} line`, clause: `GD4 ${ref}`, sourceRef: ref, status, evidence: [], generatedBy: "ai" };
}
const LINES = [line("L1", "6.2.1.DS1", "Met"), line("L2", "6.2.1.DS2", "Partial")];

beforeEach(() => { mockChat.mockReset(); });

describe("runHolisticBandSuggestion — structured per-dimension output", () => {
  it("parses four dimension bands + reasons, an overall band, and composes a cited rationale", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "PPD documents the approach (6.2.1.DS1).", band: "4" },
      processes: { reason: "Implementation records present (6.2.1.DS1).", band: "3" },
      systemsOutcomes: { reason: "Outcome data thin (6.2.1.DS2).", band: "2" },
      review: { reason: "No effectiveness monitoring on file.", band: "1" },
      limitingFactor: "Review",
      band: "2",
    }));
    const r = await runHolisticBandSuggestion(REQ, LINES, SETTINGS);

    expect(r.band).toBe(2);
    expect(r.dimensions.approach.band).toBe(4);
    expect(r.dimensions.review.band).toBe(1);
    expect(r.dimensionBands).toEqual({ approach: 4, processes: 3, systemsOutcomes: 2, review: 1 });
    expect(r.limitingFactor).toBe("Review");
    // Composed rationale names every dimension + the overall/limiting factor —
    // this is what satisfies the mandatory justification on accept.
    expect(r.rationale).toContain("Approach: Band 4");
    expect(r.rationale).toContain("Systems & Outcomes: Band 2");
    expect(r.rationale).toContain("Overall: Band 2 (limiting factor: Review)");
    // The reason carries the digest's own citation (line ref), not invented text.
    expect(r.rationale).toContain("6.2.1.DS1");
  });

  it("the overall band is NOT computed from the four — a low overall can sit under strong dimensions", async () => {
    // Three dimensions at Band 4/4/4 but Review at 1; the model returns overall
    // Band 2 (a weak limiting dimension gating the holistic pick). The function
    // must return exactly that 2, never an average (which would be ~3).
    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "a", band: "4" }, processes: { reason: "b", band: "4" },
      systemsOutcomes: { reason: "c", band: "4" }, review: { reason: "d", band: "1" },
      limitingFactor: "Review is not evident", band: "2",
    }));
    const r = await runHolisticBandSuggestion(REQ, LINES, SETTINGS);
    expect(r.band).toBe(2);
  });

  it("rejects an out-of-range band and a missing reason (a bare number is not reviewable)", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "a", band: "9" }, processes: { reason: "b", band: "3" },
      systemsOutcomes: { reason: "c", band: "3" }, review: { reason: "d", band: "3" },
      limitingFactor: "x", band: "3",
    }));
    await expect(runHolisticBandSuggestion(REQ, LINES, SETTINGS)).rejects.toThrow(/invalid band/i);

    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "", band: "3" }, processes: { reason: "b", band: "3" },
      systemsOutcomes: { reason: "c", band: "3" }, review: { reason: "d", band: "3" },
      limitingFactor: "x", band: "3",
    }));
    await expect(runHolisticBandSuggestion(REQ, LINES, SETTINGS)).rejects.toThrow(/no reason for approach/i);
  });

  it("embeds the verbatim official table and forbids arithmetic in the prompt", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "a", band: "3" }, processes: { reason: "b", band: "3" },
      systemsOutcomes: { reason: "c", band: "3" }, review: { reason: "d", band: "3" },
      limitingFactor: "x", band: "3",
    }));
    const r = await runHolisticBandSuggestion(REQ, LINES, SETTINGS);
    const sys = r.promptSent!;
    expect(sys).toContain("No organised approach to item requirements is evident"); // verbatim Band 1 Approach
    // The band-suggestion instructions themselves cite plainly ("paragraph
    // 23", not "§23") — appended skill files may still reference §23, which is
    // out of scope (Task 1 is about the band-selector UI, not the AI prompt).
    expect(sys).toContain("EduTrust Guidance Document v4 (Jan 2025), paragraph 23");
    expect(sys).toMatch(/NOT the average, sum, or any calculation/i);
  });
});

describe("runHolisticBandSuggestion — digest surfaces the real note, not the Option A not-assessed boilerplate", () => {
  it("shows the real Approach/Processes note in the line digest and never the not-assessed sentinel", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      approach: { reason: "a", band: "3" }, processes: { reason: "b", band: "3" },
      systemsOutcomes: { reason: "c", band: "3" }, review: { reason: "d", band: "3" },
      limitingFactor: "x", band: "3",
    }));
    // A realistic Option A line: Approach/Processes carry real notes; Systems
    // & Outcomes and Review carry the not-assessed sentinel (what optionAApsr
    // always writes for those two dimensions).
    const optionALine: SpecificChecklistLine = {
      id: "L1", text: "recruitment records line", clause: "6.2.1.DS1", sourceRef: "6.2.1.DS1", status: "Not met", generatedBy: "ai",
      evidence: [{
        id: "e1", title: "t", type: "Other", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Missing",
        apsr: {
          approach: { status: "Beginning", note: "PPD documents the recruitment approach but lacks approval steps." },
          processes: { status: "Not evident", note: "No recruitment records were found in the evidence folder." },
          systemsOutcomes: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
          review: { status: "Not evident", note: OPTION_A_NOT_ASSESSED_NOTE },
        },
      }],
    };
    const r = await runHolisticBandSuggestion(REQ, [optionALine], SETTINGS);
    const prompt = r.promptSent!;
    // The digest (embedded in promptSent) must carry a REAL assessment note
    // for the band-scoring reasoning...
    expect(prompt).toContain("PPD documents the recruitment approach");
    // ...and must NOT surface the not-assessed boilerplate.
    expect(prompt).not.toContain("Not assessed by Option A");
  });
});
