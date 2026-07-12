import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Correctness guard: when the Option A EVIDENCE judge call fails or times out,
// the affected line MUST land in the honest "Not assessed" state — never a
// fabricated verdict manufactured from a failure. The real bug: a line
// documented in the PPD (ppdVerdict "Adequate") whose evidence judge call
// timed out was being recorded as "Met" downstream because the engine
// returned "Not met" (relying on .failed) and the consistency runner then
// fell back to the PPD verdict. The engine must attach "Not assessed" so no
// consumer reading .verdict can read a failure as a real verdict.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete, AIClientError } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const EVIDENCE_DOC = `[CHUNK:C001] --- Receipt.pdf ---\nOfficial receipt issued for course fees.`;

// Extraction succeeds (so the line HAS verified candidates and reaches the
// judge), then the JUDGE call throws a timeout — exactly the reported case.
const EXTRACT_RESPONSE = JSON.stringify({
  results: [{ ref: "6.1.1.DS1.b", candidates: [{ aspect: "independence", quote: "Official receipt issued for course fees.", kind: "record", chunkId: "C001" }] }],
});

const LINE: EvidenceAssessmentInput = {
  ref: "6.1.1.DS1.b",
  requirementText: "Deploying qualified/trained staff independent of the areas assessed",
  ppdExtract: "internal assessors are independent of the area they audit",
  ppdVerdict: "Adequate", // documented in PPD — the trap: must NOT become "Met" on evidence failure
};

beforeEach(() => { mockChat.mockReset(); });

describe("evidence judge failure/timeout → honest 'Not assessed', never a fabricated verdict", () => {
  it("a timed-out evidence judge call yields verdict 'Not assessed' (not 'Not met', not 'Met') with failed:true and the honest reasoning", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("EXTRACTION pass")) return EXTRACT_RESPONSE;
      // Judge call — simulate the 90s/scaled timeout.
      throw new AIClientError("OpenAI request timed out after 180s.");
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "6.1.1.DS1.b")!;
    expect(row.verdict).toBe("Not assessed"); // NOT "Met" (fabricated positive), NOT "Not met" (fabricated negative)
    expect(row.failed).toBe(true);
    expect(row.comment).toMatch(/failed or timed out/i);
  });

  it("the honest 'Not assessed' verdict is excluded from gap/finding counting (neutral, per ppdVerdictToStatus)", async () => {
    // A "Not assessed" evidence verdict maps to null in the consistency
    // scorer — missing data, never a gap. Guards the scoring side of the fix.
    const { ppdVerdictToStatus } = await import("../../calibrationTesting");
    expect(ppdVerdictToStatus("Not assessed")).toBeNull();
  });
});
