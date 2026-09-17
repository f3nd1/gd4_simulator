import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Correctness guard: a line where NEITHER pass reached a judgement must not be
// stored as "Partial". The PPD pass returning "Not assessed" is the absence of
// a judgement, not a weak one, and with the extraction pass finding nothing
// either the engine knows nothing on both sides. Storing "Partial" there wrote
// a Weak checklist line, raised a Partial finding and fed the band, all from a
// judgement nobody made.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const EVIDENCE_DOC = `[CHUNK:C001] --- Intervention log.pdf ---\nAcademic intervention log for Term 2.`;
// Extraction covers the line cleanly and finds NOTHING: 0 raw candidates, which
// is the deterministic branch (an extraction that returned candidates and
// failed verification is a different, already-guarded case).
const EXTRACT_EMPTY = JSON.stringify({ results: [{ ref: "5.4.1.DS1", candidates: [] }] });

const line = (ppdVerdict: EvidenceAssessmentInput["ppdVerdict"], promises?: EvidenceAssessmentInput["promises"]): EvidenceAssessmentInput => ({
  ref: "5.4.1.DS1",
  requirementText: "Implement a learning support process for students below the required standard",
  ppdExtract: "the Head of Academic Studies reviews progress reports each term",
  ppdVerdict,
  ...(promises ? { promises } : {}),
});

beforeEach(() => {
  mockChat.mockReset();
  mockChat.mockImplementation(async (messages) => {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("EXTRACTION pass")) return EXTRACT_EMPTY;
    throw new Error("the judge must never run on a cleanly empty extraction");
  });
});

describe("a line neither pass judged is 'Not assessed', never a partial pass", () => {
  it("returns 'Not assessed' when the PPD verdict is itself 'Not assessed' and nothing was extracted", async () => {
    const { rows } = await runEvidenceAssessment([line("Not assessed")], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "5.4.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.comment).toMatch(/nothing was judged on either side/i);
    // The old wording asserted a finding about the PEI. It must not survive on
    // a row that judged nothing.
    expect(row.comment).not.toMatch(/It was not evident that the PEI/i);
  });

  it("leaves a REAL PPD judgement alone: 'Partial' still caps the line at Partial", async () => {
    const { rows } = await runEvidenceAssessment([line("Partial")], EVIDENCE_DOC, SETTINGS, {});
    expect(rows.find((r) => r.ref === "5.4.1.DS1")!.verdict).toBe("Partial");
  });

  it("leaves the two definite branches alone", async () => {
    const notDocumented = await runEvidenceAssessment([line("Not documented")], EVIDENCE_DOC, SETTINGS, {});
    expect(notDocumented.rows[0].verdict).toBe("Not met");
    const adequate = await runEvidenceAssessment([line("Adequate")], EVIDENCE_DOC, SETTINGS, {});
    expect(adequate.rows[0].verdict).toBe("Partial");
    const withPromise = await runEvidenceAssessment(
      [line("Adequate", [{ promiseText: "Interventions are recorded on the Academic Intervention Form", sourceQuote: "q", chunkId: "C001" }])],
      EVIDENCE_DOC, SETTINGS, {},
    );
    expect(withPromise.rows[0].verdict).toBe("Not met");
  });
});
