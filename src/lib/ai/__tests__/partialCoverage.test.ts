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
  runStagedEvidenceAudit,
  runStagedOutcomeReviewAudit,
  runLiveFolderAudit,
  runEvidenceAssessment,
  flagUnverifiedQuotes,
  type PPDRequirementInput,
  type EvidenceAssessmentInput,
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

describe("Batch 1 — AI-call FAILURES never fabricate verdicts (staged passes)", () => {
  // First AI call throws (429/timeout after retries); the second batch succeeds.
  // The failed batch's 8 points must be "Not assessed" — never a fabricated
  // "No" that would flow into the checklist and raise NC findings.
  function failFirstBatchThenSucceed(kind: "policy" | "evidence" | "outcome") {
    let call = 0;
    mockChat.mockImplementation(async (messages) => {
      call++;
      if (call === 1) throw new Error("OpenAI request failed (429): quota exhausted");
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      if (kind === "outcome") {
        return JSON.stringify({ results: refs.map((ref) => ({ ref, outcomeEvident: true, reviewEvident: true, note: "found", chunkIds: ["C001"] })) });
      }
      return JSON.stringify({ results: refs.map((ref) => ({ ref, covered: "Yes", note: "found", chunkIds: ["C001"] })) });
    });
  }

  it("policy pass: failed batch → notAssessed rows (not 'No'), PARTIAL coverage, windowErrors surfaced", async () => {
    failFirstBatchThenSucceed("policy");
    const result = await runStagedPolicyAudit(auditPoints(9), SOURCE_TEXT, SETTINGS, {});
    const notAssessed = result.rows.filter((r) => r.notAssessed);
    expect(notAssessed).toHaveLength(8); // the whole failed first batch
    expect(notAssessed.every((r) => r.note.includes("Not assessed"))).toBe(true);
    expect(notAssessed.every((r) => r.note.includes("failed"))).toBe(true);
    // The assessed batch keeps its real verdicts.
    expect(result.rows.filter((r) => !r.notAssessed && r.covered === "Yes")).toHaveLength(1);
    // An all-window batch failure makes the run PARTIAL even though the window loop completed.
    expect(result.fullCoverage).toBe(false);
    expect(result.truncationNote).toContain("NOT assessed");
    expect(result.truncationNote).toContain("Assessed 1 of 9");
    expect(result.windowErrors?.[0]).toContain("quota exhausted");
  });

  it("evidence pass: failed batch → notAssessed rows, never fabricated 'No'", async () => {
    failFirstBatchThenSucceed("evidence");
    const policyRows = auditPoints(9).map((p) => ({ ref: p.ref, pointText: p.text, covered: "Yes" as const, note: "ok", chunkIds: ["C001"] }));
    const result = await runStagedEvidenceAudit(auditPoints(9), SOURCE_TEXT, policyRows, SETTINGS, {});
    expect(result.rows.filter((r) => r.notAssessed)).toHaveLength(8);
    expect(result.rows.filter((r) => !r.notAssessed && r.covered === "Yes")).toHaveLength(1);
    expect(result.fullCoverage).toBe(false);
  });

  it("outcome/review pass: failed batch → notAssessed rows, never fabricated false/false", async () => {
    failFirstBatchThenSucceed("outcome");
    const result = await runStagedOutcomeReviewAudit(auditPoints(9), SOURCE_TEXT, SETTINGS, {});
    expect(result.rows.filter((r) => r.notAssessed)).toHaveLength(8);
    const assessed = result.rows.filter((r) => !r.notAssessed);
    expect(assessed).toHaveLength(1);
    expect(assessed[0].outcomeEvident).toBe(true);
    expect(result.fullCoverage).toBe(false);
  });

  it("every batch failing in every window → ALL rows notAssessed, none 'assessed as No'", async () => {
    mockChat.mockRejectedValue(new Error("OpenAI request failed (500)"));
    const result = await runStagedPolicyAudit(auditPoints(9), SOURCE_TEXT, SETTINGS, {});
    expect(result.rows.every((r) => r.notAssessed)).toBe(true);
    expect(result.fullCoverage).toBe(false);
  });
});

describe("Batch 1 — classic path: failed batches produce NO verdicts (no 'Not met' placeholders)", () => {
  function lines(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `L${i + 1}`, text: `Line ${i + 1}` }));
  }
  const okLeg = { status: "Meeting", note: "ok", sourceChunkIds: ["C001"] };
  const okLine = (id: string) => ({
    lineId: id,
    approach: okLeg,
    processes: { status: "Deployed", note: "ok", sourceChunkIds: ["C001"] },
    systemsOutcomes: { status: "Evident", note: "ok", sourceChunkIds: ["C001"] },
    review: { status: "Evident", note: "ok", sourceChunkIds: ["C001"] },
    overallReason: "ok",
    sources: ["doc.pdf"],
  });

  it("multi-batch: the failed batch's lines are absent from verdicts and reported via timedOutLineIds", async () => {
    // 13 lines → multiple batches at AUDIT_BATCH_SIZE=4. Batch calls run in
    // parallel; fail whichever call carries line L1's batch, succeed the rest.
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const ids = [...user.matchAll(/\[(L\d+)\]/g)].map((m) => m[1]);
      if (ids.includes("L1")) throw new Error("OpenAI request failed (500): boom");
      return JSON.stringify({ lines: ids.map(okLine) });
    });

    const result = await runLiveFolderAudit(lines(13), "doc text", SETTINGS, {});
    const verdictIds = new Set(result.verdicts.map((v) => v.lineId));
    // No fabricated "Not met" for the failed batch:
    expect(result.verdicts.some((v) => v.reason.includes("timed out"))).toBe(false);
    expect(verdictIds.has("L1")).toBe(false);
    expect(result.verdicts.every((v) => v.status === "Met")).toBe(true);
    // The failed lines are reported for the store's "N not assessed" accounting.
    expect(result.timedOutLineIds).toContain("L1");
    expect(result.timedOutLineIds!.length).toBeGreaterThan(0);
    expect(result.verdicts.length + result.timedOutLineIds!.length).toBe(13);
  });
});

describe("Batch 1 — ref normalization at the AI-reply join", () => {
  it("a model-echoed ref with prefix/case drift still matches its audit point", async () => {
    mockChat.mockImplementation(async (messages) => {
      const user = String(messages[1]?.content ?? "");
      const refs = [...user.matchAll(/\[(1\.1\.1\.DS\d+)\]/g)].map((m) => m[1]);
      // Echo refs back in drifted forms the model actually produces.
      return JSON.stringify({ results: refs.map((ref) => ({ ref: `DS: ${ref.toLowerCase()}`, covered: "Yes", note: "found", chunkIds: ["C001"] })) });
    });
    const result = await runStagedPolicyAudit(auditPoints(3), SOURCE_TEXT, SETTINGS, {});
    // Without normalization these would all silently default to "No".
    expect(result.rows.every((r) => r.covered === "Yes")).toBe(true);
  });
});

describe("Batch 1 — a contradicted promise is sticky across windows", () => {
  it("'contradicted' in one window survives 'evidenced' in another; line capped at Partial", async () => {
    // Force two windows by exceeding WINDOW_SIZE (55k chars).
    const bigDoc = `[CHUNK:C001] --- a.docx ---\n${"evidence text ".repeat(4600)}`;
    const input: EvidenceAssessmentInput[] = [{
      ref: "4.2.1.DS1", requirementText: "Contracts signed before fee collection", ppdVerdict: "Adequate", ppdExtract: "ok",
      promises: [{ promiseText: "Contracts are signed before any fee is collected", sourceQuote: "contracts shall be signed before fee collection", chunkId: "C001" }],
    }];
    let call = 0;
    mockChat.mockImplementation(async () => {
      call++;
      const verdictForWindow = call === 1 ? "evidenced" : "contradicted";
      return JSON.stringify({
        results: [{
          ref: "4.2.1.DS1", evidenceSummary: "records reviewed", verdict: "Met",
          comment: "checked", chunkIds: ["C001"],
          promiseChecks: [{ promiseText: "Contracts are signed before any fee is collected", verdict: verdictForWindow, evidence: call === 1 ? "receipt matches" : "contract dated AFTER the receipt", chunkIds: ["C001"] }],
        }],
      });
    });
    const result = await runEvidenceAssessment(input, bigDoc, SETTINGS, {});
    expect(call).toBeGreaterThanOrEqual(2); // sanity: really two windows
    const row = result.rows[0];
    expect(row.promiseChecks?.[0].verdict).toBe("contradicted"); // sticky — not erased by the evidenced window
    // The promise hard-gate then caps the Met line at Partial.
    expect(row.verdict).toBe("Partial");
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
