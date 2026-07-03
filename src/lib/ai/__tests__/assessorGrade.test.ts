import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runPPDRequirementsReview, runEvidenceAssessment, quoteExistsInSource, type PPDRequirementInput, type EvidenceAssessmentInput } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "test-key", model: "m", utilityModel: "m", enabled: true };

const PPD_SOURCE = `[CHUNK:C001] --- ppd.docx ---
Refunds are processed within 5 working days by the Finance Manager. The institution conducts peer reviews of teaching annually covering all part-time academic staff. Refund requests are acknowledged within 3 working days.`;

function ppdInputs(): PPDRequirementInput[] {
  return [{ ref: "4.4.1.DS1", gd4ItemId: "4.4.1", requirementText: "Documented (a) refund policy; and (b) refund timeline communicated to students." }];
}

// Block body matters: mockReset() returns the mock, and vitest calls a
// function RETURNED from beforeEach as a cleanup hook — which would invoke
// chatComplete() with no args after every test.
beforeEach(() => { mockChat.mockReset(); });

describe("assessor-grade PPD review (Techniques 1-3)", () => {
  it("parses sub-clause verdicts, verified promises, and window contradictions into the result", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) {
        return JSON.stringify({
          contradictions: [{
            description: "The PPD states two different refund timelines: 'within 5 working days' and 'within 3 working days'.",
            quoteA: "Refunds are processed within 5 working days by the Finance Manager",
            chunkA: "C001",
            quoteB: "Refund requests are acknowledged within 3 working days",
            chunkB: "C001",
          }],
        });
      }
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "One line partial." });
      return JSON.stringify({
        results: [{
          ref: "4.4.1.DS1",
          subClauses: [
            { text: "(a) refund policy", verdict: "documented" },
            { text: "(b) refund timeline communicated to students", verdict: "not documented" },
          ],
          verdict: "Partial",
          shortComment: "Sub-clause (b) — refund timeline communicated to students — is not addressed in any PPD passage.",
          fullComment: 'It was not evident that the PEI had documented sub-clause (b). "Refunds are processed within 5 working days by the Finance Manager" (C001)',
          promises: [
            { promiseText: "Refunds processed within 5 working days", sourceQuote: "Refunds are processed within 5 working days by the Finance Manager", chunkId: "C001" },
            { promiseText: "The Principal signs quarterly attestations", sourceQuote: "the Principal signs a quarterly compliance attestation form each term", chunkId: "C001" },
          ],
          suggestedRewrite: "Add: the refund timeline is published to students…",
          chunkIds: ["C001"],
        }],
      });
    });

    const result = await runPPDRequirementsReview(ppdInputs(), PPD_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Partial");
    expect(row.subClauses).toHaveLength(2);
    expect(row.subClauses![1].verdict).toBe("not documented");
    expect(row.promises).toHaveLength(2);
    // Real quote passes untouched; the fabricated one is annotated, not dropped.
    expect(row.promises![0].sourceQuote).not.toContain("unverified");
    expect(row.promises![1].sourceQuote).toContain("unverified quote");
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions![0].quoteA).not.toContain("unverified");
  });
});

describe("assessor-grade evidence assessment (promise checks)", () => {
  const EV_SOURCE = `[CHUNK:C001] --- refund-register.xlsx ---
Refund log 2025: request 12 Jan, paid 15 Jan (3 working days). Peer review schedule 2025 attached.`;

  function evInputs(): EvidenceAssessmentInput[] {
    return [{
      ref: "4.4.1.DS1",
      requirementText: "Refund policy implemented.",
      ppdVerdict: "Adequate",
      ppdExtract: "Documented.",
      promises: [
        { promiseText: "Refunds processed within 5 working days", sourceQuote: "", chunkId: "C001" },
        { promiseText: "Annual peer reviews covering all part-time academic staff", sourceQuote: "", chunkId: "C001" },
      ],
    }];
  }

  it("a Met verdict with an unevidenced promise is capped at Partial with the SSG phrasing", async () => {
    mockChat.mockImplementation(async () => JSON.stringify({
      results: [{
        ref: "4.4.1.DS1",
        evidenceSummary: "Refund register sighted.",
        verdict: "Met",
        comment: "Refund register shows compliance (C001).",
        promiseChecks: [
          { promiseText: "Refunds processed within 5 working days", verdict: "evidenced", evidence: "Refund paid in 3 working days (C001).", chunkIds: ["C001"] },
          { promiseText: "Annual peer reviews covering all part-time academic staff", verdict: "not evidenced", evidence: "No record found in the evidence documents.", chunkIds: [] },
        ],
        chunkIds: ["C001"],
      }],
    }));

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Partial"); // promise hard-gate
    expect(row.comment).toContain("in accordance with its documented PPD");
    expect(row.promiseChecks).toHaveLength(2);
    expect(row.promiseChecks![1].verdict).toBe("not evidenced");
  });

  it("promises are fed into the prompt as named checks", async () => {
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      expect(user).toContain("PPD promises to verify:");
      expect(user).toContain("Annual peer reviews covering all part-time academic staff");
      return JSON.stringify({ results: [] });
    });
    await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    expect(mockChat).toHaveBeenCalled();
  });
});

describe("quoteExistsInSource", () => {
  it("matches with whitespace/curly-quote drift; rejects fabricated quotes; passes short quotes", () => {
    const src = "Refunds are processed within 5 working days by the Finance Manager.";
    expect(quoteExistsInSource("Refunds  are processed\nwithin 5 working days", src)).toBe(true);
    expect(quoteExistsInSource("the Principal signs a quarterly compliance attestation form", src)).toBe(false);
    expect(quoteExistsInSource("Adequate", src)).toBe(true);
  });
});
