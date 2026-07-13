import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { PPDRequirementInput } from "../agentRuntime";

// Verdict/comment self-consistency guard (PPD judge) — same shape as the
// Evidence-judge guard (see verdictCommentMismatchEvidence.test.ts): the
// judge returns verdict + fullComment from ONE model response, with nothing
// cross-checking them. A "Partial" verdict alongside a comment concluding
// "...assessed as Adequate" (or "Met", per the real report's exact wording)
// must not silently keep either value.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runPPDRequirementsReview } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const PPD_QUOTE = "the institution reviews its policies annually and records minutes";
const SOURCE_TEXT = `[CHUNK:C001] --- ppd.docx ---\nThe institution reviews its policies annually and records minutes of each review.`;

const LINE: PPDRequirementInput = { ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "Review policies annually." };

const EXTRACT_RESPONSE = JSON.stringify({
  results: [{ ref: "1.1.1.DS1", candidates: [{ aspect: "policy review", quote: PPD_QUOTE, clause: "", chunkId: "C001" }], promises: [] }],
});

beforeEach(() => { mockChat.mockReset(); });

function mockJudge(judgeResult: Record<string, unknown>) {
  mockChat.mockImplementation(async (messages) => {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
    if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
    if (system.includes("EXTRACTION pass")) return EXTRACT_RESPONSE;
    return JSON.stringify({ results: [{ ref: "1.1.1.DS1", ...judgeResult }] });
  });
}

describe("PPD judge verdict/comment self-consistency guard", () => {
  it("verdict 'Partial' + fullComment concluding 'assessed as Adequate' → downgraded to 'Not assessed' with both values named", async () => {
    mockJudge({
      verdict: "Partial",
      shortComment: "Partly documented.",
      fullComment: "The annual review cadence is documented in one section. Overall, this requirement is assessed as Adequate.",
      chunkIds: ["C001"],
    });
    const result = await runPPDRequirementsReview([LINE], SOURCE_TEXT, SETTINGS, {});
    const row = result.rows.find((r) => r.ref === "1.1.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.fullComment).toContain("⚠ Verdict/comment mismatch");
    expect(row.fullComment).toContain('"Partial"');
    expect(row.fullComment).toContain("assessed as adequate");
    expect(row.shortComment).toContain("disagreed");
  });

  it("a line already caught by the uncited-Adequate hard-gate is NOT also flagged by the new guard", async () => {
    mockJudge({
      verdict: "Adequate",
      shortComment: "Documented.",
      // Concludes positively, matching the ORIGINAL "Adequate" verdict — the
      // gate downgrades to Partial for an unrelated reason (no cited chunk),
      // and must not have this comment misread as a NEW contradiction.
      fullComment: "The policy fully satisfies this requirement.",
      chunkIds: [], // triggers the existing uncited-Adequate downgrade
    });
    const result = await runPPDRequirementsReview([LINE], SOURCE_TEXT, SETTINGS, {});
    const row = result.rows.find((r) => r.ref === "1.1.1.DS1")!;
    expect(row.verdict).toBe("Partial"); // the EXISTING gate's downgrade
    expect(row.fullComment).toContain("Downgraded: no source chunks cited to support this verdict.");
    expect(row.fullComment).not.toContain("⚠ Verdict/comment mismatch");
  });

  it("verdict 'Not documented' + fullComment concluding 'fully meets' is also caught", async () => {
    mockJudge({
      verdict: "Not documented",
      shortComment: "No passage found.",
      fullComment: "No candidate passage addressed this line directly. However, on balance the policy fully meets this requirement.",
      chunkIds: ["C001"],
    });
    const result = await runPPDRequirementsReview([LINE], SOURCE_TEXT, SETTINGS, {});
    const row = result.rows.find((r) => r.ref === "1.1.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.fullComment).toContain("⚠ Verdict/comment mismatch");
    expect(row.fullComment).toContain('"Not documented"');
  });
});
