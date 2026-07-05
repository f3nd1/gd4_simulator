import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Mock ONLY chatComplete — drive each window's response independently.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

// Two chunks placed so the doc spans two sliding windows (WINDOW_SIZE 55_000):
// C001 (a policy handbook) sits at the very start → window 0 only; C002 (the
// completed record) sits past char 55_000 → the later window only.
const filler = "x".repeat(56_000);
const EVIDENCE_DOC =
  `[CHUNK:C001] --- Staff_Handbook.pdf ---\nMARKER_ONE handbook policy text ${filler}` +
  `\n\n=== ACTUAL EVIDENCE ===\n\n` +
  `[CHUNK:C002] --- Material_Vetting_Form.pdf ---\nMARKER_TWO completed vetting record`;

const LINE: EvidenceAssessmentInput = {
  ref: "2.2.2.DS1",
  requirementText: "Vetting and approval prior to publication",
  ppdExtract: "vetting process",
  ppdVerdict: "Adequate",
  promises: [{ promiseText: "Management vets and approves advertisements before publication", sourceQuote: "Management vets and approves advertisements before publication", chunkId: "C001" }],
};

function windowResponse(kind: "handbook" | "record"): string {
  if (kind === "record") {
    return JSON.stringify({
      results: [{
        ref: "2.2.2.DS1",
        evidenceSummary: "Implementation evidenced by the completed Material Vetting Form (C002).",
        verdict: "Met",
        comment: "The completed Material Vetting Form C002 shows the advertisement was vetted and approved by Management before publication.",
        promiseChecks: [{ promiseText: "Management vets and approves advertisements before publication", verdict: "evidenced", evidence: "Material Vetting Form C002", chunkIds: ["C002"] }],
        chunkIds: ["C002"],
      }],
    });
  }
  return JSON.stringify({
    results: [{
      ref: "2.2.2.DS1",
      evidenceSummary: "Vetting described in the Staff Handbook (C001).",
      verdict: "Met",
      comment: "The Staff Handbook C001 describes a vetting and approval process.",
      promiseChecks: [{ promiseText: "Management vets and approves advertisements before publication", verdict: "not evidenced", evidence: "No completed record found in this window.", chunkIds: [] }],
      chunkIds: ["C001"],
    }],
  });
}

beforeEach(() => mockChat.mockReset());

describe("F1 — verdict ties keep the better-grounded justification, not the first window's", () => {
  it("later, better-grounded window (cites the record) wins the summary; verdict and citation union preserved", async () => {
    // Windows process in order: call 1 = window 0 (handbook only), call 2 =
    // window 1 (completed record only). Both return Met — a verdict TIE.
    let call = 0;
    mockChat.mockImplementation(async () => windowResponse(++call === 1 ? "handbook" : "record"));

    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    expect(call).toBe(2); // sanity: really two windows
    const r = rows[0];
    // (a) surviving justification is the better-grounded (record) one, NOT window 0's handbook text
    expect(r.evidenceSummary).toContain("Material Vetting Form");
    expect(r.comment).toContain("C002");
    expect(r.evidenceSummary).not.toContain("Staff Handbook");
    // (b) verdict unchanged and the FULL accumulated citation list is preserved (both chunks)
    expect(r.verdict).toBe("Met");
    expect(r.chunkIds).toEqual(expect.arrayContaining(["C001", "C002"]));
  });

  it("first window better-grounded, later window ties but weaker → first-window justification is KEPT (grounding, not recency, decides)", async () => {
    // Reverse order: call 1 = grounded record (Met), call 2 = weaker handbook
    // (Met). The tie must keep the grounded record justification.
    let call = 0;
    mockChat.mockImplementation(async () => windowResponse(++call === 1 ? "record" : "handbook"));
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const r = rows[0];
    expect(r.evidenceSummary).toContain("Material Vetting Form");
    expect(r.verdict).toBe("Met");
    expect(r.chunkIds).toEqual(expect.arrayContaining(["C001", "C002"]));
  });

  it("a genuinely higher verdict still outranks a tie candidate (ranking unchanged by F1)", async () => {
    // Call 1 (handbook) → Partial; call 2 (record) → Met. Met must win outright,
    // and both citations accumulate.
    let call = 0;
    mockChat.mockImplementation(async () => {
      if (++call === 2) return windowResponse("record");
      return JSON.stringify({
        results: [{
          ref: "2.2.2.DS1",
          evidenceSummary: "Only the handbook policy is present (C001).",
          verdict: "Partial",
          comment: "Handbook C001 describes the approach but no record was found.",
          promiseChecks: [{ promiseText: "Management vets and approves advertisements before publication", verdict: "not evidenced", evidence: "No record.", chunkIds: [] }],
          chunkIds: ["C001"],
        }],
      });
    });

    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const r = rows[0];
    expect(r.verdict).toBe("Met");
    expect(r.evidenceSummary).toContain("Material Vetting Form");
    expect(r.chunkIds).toEqual(expect.arrayContaining(["C001", "C002"]));
  });
});
