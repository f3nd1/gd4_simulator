import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

// Mock ONLY chatComplete — everything else in aiClient stays real. Each test
// drives the mock to simulate success / stop-mid-run / failure / abort.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import {
  runPPDRequirementsReview,
  runStagedPolicyAudit,
  flagUnverifiedQuotes,
  type PPDRequirementInput,
} from "../agentRuntime";
import type { FlatAuditPoint } from "../../../types";

const mockChat = vi.mocked(chatComplete);

const SETTINGS: AISettings = { provider: "openai", apiKey: "test-key", model: "m", utilityModel: "m", enabled: true };

// 9 requirement lines → 2 batches at the PPD REQ_BATCH_SIZE of 8.
function ppdInputs(n = 9): PPDRequirementInput[] {
  return Array.from({ length: n }, (_, i) => ({ ref: `1.1.1.DS${i + 1}`, gd4ItemId: "1.1.1", requirementText: `Requirement line ${i + 1}` }));
}

// 9 audit points → 2 batches at STAGED_BATCH_SIZE of 8.
function auditPoints(n = 9): FlatAuditPoint[] {
  return Array.from({ length: n }, (_, i) => ({ ref: `1.1.1.DS${i + 1}`, gd4ItemId: "1.1.1", sourceType: "describeShow", text: `Point ${i + 1}`, sourceText: `Point ${i + 1}`, originalIndex: i }));
}

function ppdBatchResponse(refs: string[]): string {
  return JSON.stringify({
    results: refs.map((ref) => ({ ref, verdict: "Adequate", shortComment: "ok", fullComment: "Documented. \"the institution reviews its policies annually and records minutes\" (C001)", suggestedRewrite: "", chunkIds: ["C001"] })),
  });
}

const SOURCE_TEXT = "[CHUNK:C001] --- ppd.docx ---\nThe institution reviews its policies annually and records minutes of each review.";

beforeEach(() => {
  mockChat.mockReset();
});

describe("PPD review — stopped runs do not fabricate results (Batch 4)", () => {
  it("stop after the first batch: assessed lines keep verdicts, the rest are 'Not assessed', fullCoverage=false", async () => {
    let stop = false;
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      stop = true; // request stop AFTER the first successful call
      return ppdBatchResponse(refs);
    });

    const result = await runPPDRequirementsReview(ppdInputs(9), SOURCE_TEXT, SETTINGS, { shouldStop: () => stop });

    expect(mockChat).toHaveBeenCalledTimes(1); // batch 2 and the narrative never ran
    const assessed = result.rows.filter((r) => r.verdict === "Adequate");
    const notAssessed = result.rows.filter((r) => r.verdict === "Not assessed");
    expect(assessed).toHaveLength(8);
    expect(notAssessed).toHaveLength(1);
    expect(notAssessed[0].verdict).not.toBe("Not documented"); // the old fabrication
    expect(result.fullCoverage).toBe(false);
    expect(result.stoppedEarly).toBe(true);
  });

  it("an already-aborted signal stops before any AI call; every line is 'Not assessed'", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runPPDRequirementsReview(ppdInputs(9), SOURCE_TEXT, SETTINGS, { signal: ac.signal });
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.rows.every((r) => r.verdict === "Not assessed")).toBe(true);
    expect(result.fullCoverage).toBe(false);
  });

  it("mid-run API failures are surfaced via windowErrors, not logged as clean success", async () => {
    mockChat.mockRejectedValue(new Error("OpenAI request failed (401): revoked key"));
    const result = await runPPDRequirementsReview(ppdInputs(9), SOURCE_TEXT, SETTINGS, {});
    expect(result.windowErrors).toBeDefined();
    expect(result.windowErrors!.length).toBeGreaterThan(0);
    expect(result.windowErrors![0]).toContain("revoked key");
    // Lines the failed calls covered are Not assessed — not "Not documented".
    expect(result.rows.every((r) => r.verdict === "Not assessed")).toBe(true);
  });
});

describe("staged policy audit — stopped runs do not fabricate results (Batch 4)", () => {
  it("stop after the first batch: unassessed points are flagged notAssessed, fullCoverage=false", async () => {
    let stop = false;
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      stop = true;
      return JSON.stringify({ results: refs.map((ref) => ({ ref, covered: "Yes", note: "found", chunkIds: ["C001"] })) });
    });

    const result = await runStagedPolicyAudit(auditPoints(9), SOURCE_TEXT, SETTINGS, { shouldStop: () => stop });

    expect(mockChat).toHaveBeenCalledTimes(1);
    const notAssessed = result.rows.filter((r) => r.notAssessed);
    expect(notAssessed).toHaveLength(1);
    expect(notAssessed[0].note).toContain("Not assessed");
    expect(result.rows.filter((r) => !r.notAssessed && r.covered === "Yes")).toHaveLength(8);
    expect(result.fullCoverage).toBe(false);
    expect(result.truncationNote).toContain("PARTIAL");
  });

  it("a completed run still reports fullCoverage=true with no notAssessed rows", async () => {
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      return JSON.stringify({ results: refs.map((ref) => ({ ref, covered: "Yes", note: "found", chunkIds: ["C001"] })) });
    });
    const result = await runStagedPolicyAudit(auditPoints(9), SOURCE_TEXT, SETTINGS, {});
    expect(result.fullCoverage).toBe(true);
    expect(result.rows.some((r) => r.notAssessed)).toBe(false);
  });
});

describe("staged audit — negative-verdict notes are preserved, not discarded", () => {
  const SPECIFIC_NEG = 'It was not evident that the PEI had documented the non-collection of monies from students. Example: fee-policy.docx v1 addresses refunds but no clause covers non-collection.';

  it('a "No" policy verdict surfaces the AI\'s specific SSG note, not the generic fallback', async () => {
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      return JSON.stringify({ results: refs.map((ref) => ({ ref, covered: "No", note: SPECIFIC_NEG, chunkIds: [] })) });
    });
    const result = await runStagedPolicyAudit(auditPoints(1), SOURCE_TEXT, SETTINGS, {});
    expect(result.rows[0].covered).toBe("No");
    // The retained negative note appears; the old "No relevant policy evidence
    // found…" fallback does NOT.
    expect(result.rows[0].note).toContain("non-collection of monies");
    expect(result.rows[0].note).not.toContain("No relevant policy evidence found");
  });

  it("the longest (most substantive) negative note wins across windows; empty notes still fall back", async () => {
    // Single window, empty note → still the generic fallback (nothing to keep).
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      return JSON.stringify({ results: refs.map((ref) => ({ ref, covered: "No", note: "", chunkIds: [] })) });
    });
    const result = await runStagedPolicyAudit(auditPoints(1), SOURCE_TEXT, SETTINGS, {});
    expect(result.rows[0].note).toContain("No relevant policy evidence found");
  });
});

describe("flagUnverifiedQuotes — PPD quote verification (Batch 4)", () => {
  const source = "The institution reviews its policies annually and records minutes of each review. Auditors must be independent of the area they audit.";

  it("a real verbatim quote passes unflagged", () => {
    const comment = 'Documented. "reviews its policies annually and records minutes" (C001)';
    expect(flagUnverifiedQuotes(comment, source)).toBe(comment);
  });

  it("a quote with elision ellipses still matches when the inner text is real", () => {
    const comment = 'Documented. "...auditors must be independent of the area they audit..." (C001)';
    expect(flagUnverifiedQuotes(comment, source)).toBe(comment);
  });

  it("a fabricated quote is flagged unverified — and NOT dropped", () => {
    const comment = 'Documented. "the Principal signs a quarterly compliance attestation form" (C001)';
    const out = flagUnverifiedQuotes(comment, source);
    expect(out).toContain("the Principal signs a quarterly compliance attestation form"); // original kept
    expect(out).toContain("unverified: not found in source");
  });

  it("short incidental quotes are ignored", () => {
    const comment = 'The verdict is "Adequate" for this line.';
    expect(flagUnverifiedQuotes(comment, source)).toBe(comment);
  });

  it("whitespace and curly-quote differences do not cause false flags", () => {
    const comment = "Documented. “reviews  its policies\nannually and records minutes” (C001)";
    expect(flagUnverifiedQuotes(comment, source)).toBe(comment);
  });
});
