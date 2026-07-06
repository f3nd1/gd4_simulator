import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

// Per-sub-part quote identification: each sub-clause (PPD side) / promise
// check (Evidence side) gets its OWN verified quote — not one quote standing
// in for the whole line. A quote that isn't a real verbatim substring of the
// source must be dropped for THAT sub-part specifically, without touching
// any other sub-part's quote.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runPPDRequirementsReview, runEvidenceAssessment, type PPDRequirementInput, type EvidenceAssessmentInput } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

beforeEach(() => { mockChat.mockReset(); });

describe("PPD review — per-sub-clause quotes", () => {
  const PPD_SOURCE = `[CHUNK:C001] --- ppd.docx ---
The Code of Conduct for all agents is published on the intranet and reviewed annually by HR. Commission structures are set by Management.`;

  function inputs(): PPDRequirementInput[] {
    return [{ ref: "3.1.1.DS1", gd4ItemId: "3.1.1", requirementText: "Documented (a) code of conduct; and (b) non-collection of monies from students." }];
  }

  it("each sub-clause carries its OWN verified quote; a fabricated one is dropped without affecting the other", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "x" });
      return JSON.stringify({
        results: [{
          ref: "3.1.1.DS1",
          subClauses: [
            { text: "(a) code of conduct", verdict: "documented", quote: "The Code of Conduct for all agents is published on the intranet and reviewed annually by HR." },
            { text: "(b) non-collection of monies from students", verdict: "not documented", quote: "" },
          ],
          verdict: "Partial",
          shortComment: "Sub-clause (b) is not addressed.",
          fullComment: "It was not evident that the PEI had documented sub-clause (b).",
          promises: [],
          chunkIds: ["C001"],
          supportQuote: "",
        }],
      });
    });

    const result = await runPPDRequirementsReview(inputs(), PPD_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.subClauses).toHaveLength(2);
    // (a) has a real, verified quote — kept verbatim.
    expect(row.subClauses![0].quote).toContain("Code of Conduct for all agents is published");
    // (b) genuinely has no quote (not documented) — undefined, not fabricated.
    expect(row.subClauses![1].quote).toBeUndefined();
  });

  it("a sub-clause quote that is NOT a real substring of the source is dropped to undefined (never fabricated)", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "x" });
      return JSON.stringify({
        results: [{
          ref: "3.1.1.DS1",
          subClauses: [
            { text: "(a) code of conduct", verdict: "documented", quote: "The Code of Conduct for all agents is published on the intranet and reviewed annually by HR." },
            // Invented — not present anywhere in PPD_SOURCE, despite a "documented" verdict.
            { text: "(b) non-collection of monies from students", verdict: "documented", quote: "Agents are strictly prohibited from collecting any monies whatsoever from students under any circumstance." },
          ],
          verdict: "Adequate",
          shortComment: "Both sub-clauses documented.",
          fullComment: "Both are documented.",
          promises: [],
          chunkIds: ["C001"],
          supportQuote: "",
        }],
      });
    });

    const result = await runPPDRequirementsReview(inputs(), PPD_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    // (a)'s real quote survives verification.
    expect(row.subClauses![0].quote).toBeTruthy();
    // (b)'s fabricated quote fails verification and is dropped — never shown as if real.
    expect(row.subClauses![1].quote).toBeUndefined();
  });
});

describe("Evidence assessment — per-promise-check quotes", () => {
  const EV_SOURCE = `[CHUNK:C001] --- register.xlsx ---
Peer review conducted 14 Jan 2026 covering all part-time academic staff, signed off by HOD.`;

  function evInputs(): EvidenceAssessmentInput[] {
    return [{
      ref: "2.1.1.DS1",
      requirementText: "Peer reviews and rewards documented.",
      ppdVerdict: "Adequate",
      ppdExtract: "Documented.",
      promises: [
        { promiseText: "Annual peer reviews covering all part-time academic staff", sourceQuote: "", chunkId: "C001" },
        { promiseText: "Rewards linked to performance ratings", sourceQuote: "", chunkId: "C001" },
      ],
    }];
  }

  it("an evidenced promise carries its own verified quote; a not-evidenced promise carries none", async () => {
    mockChat.mockImplementation(async () => JSON.stringify({
      results: [{
        ref: "2.1.1.DS1",
        evidenceSummary: "Peer review record found; no reward record found.",
        verdict: "Partial",
        comment: "One promise evidenced, one not.",
        promiseChecks: [
          { promiseText: "Annual peer reviews covering all part-time academic staff", verdict: "evidenced", evidence: "Peer review register C001", chunkIds: ["C001"], quote: "Peer review conducted 14 Jan 2026 covering all part-time academic staff, signed off by HOD." },
          { promiseText: "Rewards linked to performance ratings", verdict: "not evidenced", evidence: "No record found in the evidence documents.", chunkIds: [], quote: "" },
        ],
        chunkIds: ["C001"],
      }],
    }));

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.promiseChecks).toHaveLength(2);
    expect(row.promiseChecks![0].verdict).toBe("evidenced");
    expect(row.promiseChecks![0].quote).toContain("Peer review conducted 14 Jan 2026");
    expect(row.promiseChecks![1].verdict).toBe("not evidenced");
    expect(row.promiseChecks![1].quote).toBeUndefined();
  });

  it("a fabricated promise-check quote (not a real substring) is dropped to undefined for that promise only", async () => {
    mockChat.mockImplementation(async () => JSON.stringify({
      results: [{
        ref: "2.1.1.DS1",
        evidenceSummary: "x",
        verdict: "Partial",
        comment: "x",
        promiseChecks: [
          { promiseText: "Annual peer reviews covering all part-time academic staff", verdict: "evidenced", evidence: "C001", chunkIds: ["C001"], quote: "Peer review conducted 14 Jan 2026 covering all part-time academic staff, signed off by HOD." },
          // Invented text — not present in EV_SOURCE at all.
          { promiseText: "Rewards linked to performance ratings", verdict: "evidenced", evidence: "C001", chunkIds: ["C001"], quote: "Bonus payments of $500 were disbursed to all top-rated academic staff in December." },
        ],
        chunkIds: ["C001"],
      }],
    }));

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.promiseChecks![0].quote).toBeTruthy();
    expect(row.promiseChecks![1].quote).toBeUndefined();
  });
});
