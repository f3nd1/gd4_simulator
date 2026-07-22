import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Verdict/comment self-consistency guard (Evidence judge). Confirmed on real
// exported data: the judge can return verdict "Partial" alongside a comment
// whose own final sentence concludes "...this requirement is assessed as
// Met." — both fields come from the SAME model response, with nothing
// cross-checking them. The line must not silently keep either value; it must
// land in the honest "Not assessed" state with both conflicting values named.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const QUOTE = "Agents are selected using a scoring rubric covering track record, reputation and compliance history.";
const EVIDENCE_DOC = `[CHUNK:C001] --- AgentContracts.pdf ---\n${QUOTE}`;

const LINE: EvidenceAssessmentInput = {
  ref: "3.1.1.DS1",
  requirementText: "Identify, select and appoint your recruitment agents.",
  ppdExtract: "Agents are selected using a documented scoring rubric.",
  ppdVerdict: "Adequate",
};

const EXTRACT_RESPONSE = JSON.stringify({
  results: [{ ref: "3.1.1.DS1", candidates: [{ aspect: "selection", quote: QUOTE, kind: "record", chunkId: "C001" }] }],
});

beforeEach(() => { mockChat.mockReset(); });

function mockJudge(judgeResult: Record<string, unknown>) {
  mockChat.mockImplementation(async (messages) => {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("EXTRACTION pass")) return EXTRACT_RESPONSE;
    return JSON.stringify({ results: [{ ref: "3.1.1.DS1", ...judgeResult }] });
  });
}

describe("Evidence judge verdict/comment self-consistency guard", () => {
  it("verdict 'Partial' + comment concluding 'assessed as Met' → downgraded to 'Not assessed' with both values named", async () => {
    mockJudge({
      evidenceSummary: "Scoring rubric applied.",
      verdict: "Partial",
      comment: "The scoring rubric is applied consistently across sampled agents. Overall, this requirement is assessed as Met.",
      promiseChecks: [],
      chunkIds: ["C001"],
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.comment).toContain("⚠ Verdict/comment mismatch");
    expect(row.comment).toContain('"Partial"');
    expect(row.comment).toContain("assessed as met");
  });

  it("a line already caught by the uncited-positive hard-gate is NOT also flagged by the new guard", async () => {
    mockJudge({
      evidenceSummary: "Implementation described.",
      verdict: "Met",
      // Contains negative-conclusion-shaped language too, so this proves the
      // hard-gate branch (which returns early) never reaches the new check —
      // if it did, this comment would ALSO trip it.
      comment: "The process was not evidenced in a signed record, but the overall practice was described.",
      promiseChecks: [],
      chunkIds: [], // triggers the existing uncited-positive downgrade
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Partial"); // the EXISTING gate's downgrade, not "Not assessed"
    expect(row.comment).toContain("Downgraded: no source chunks cited to support this verdict.");
    expect(row.comment).not.toContain("⚠ Verdict/comment mismatch");
  });

  it("negative language OUTSIDE the comment's concluding sentence(s) does not false-trigger — only the tail is checked", async () => {
    const padding = "x".repeat(320); // pushes the early mention past the 300-char tail window
    mockJudge({
      evidenceSummary: "Fully implemented.",
      verdict: "Met",
      comment: `An earlier draft of this promise was not evidenced. ${padding} On review of the final sampled agents, this fully satisfies the requirement and is assessed as Met.`,
      promiseChecks: [],
      chunkIds: ["C001"],
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Met");
    expect(row.comment).not.toContain("⚠ Verdict/comment mismatch");
  });

  it("verdict 'Not met' + comment concluding 'rated Partial' is caught (the 6.1.1.DS1.g case — Partial and Not met are distinct classes)", async () => {
    mockJudge({
      evidenceSummary: "Some tracking exists.",
      verdict: "Not met",
      comment: "Corrective actions are tracked in the register but the monitoring-timeline promise itself was not shown, so the line is rated Partial.",
      promiseChecks: [],
      chunkIds: ["C001"],
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.comment).toContain("⚠ Verdict/comment mismatch");
    expect(row.comment).toContain("rated partial");
  });

  it("verdict 'Partial' whose comment merely mentions 'not evidenced' promises (no explicit conclusion) is NOT flagged — loose vocabulary keeps the old conservative behaviour", async () => {
    mockJudge({
      evidenceSummary: "Partial coverage.",
      verdict: "Partial",
      comment: "The induction promise is evidenced for two of five staff; the appraisal promise was not evidenced in the given passages.",
      promiseChecks: [],
      chunkIds: ["C001"],
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Partial");
    expect(row.comment).not.toContain("⚠ Verdict/comment mismatch");
  });

  it("verdict 'Met' + comment concluding negatively is also caught (not just the Partial/Met direction)", async () => {
    mockJudge({
      evidenceSummary: "No clear record.",
      verdict: "Met",
      comment: "No signed appointment record was located for the sampled agent. This requirement is assessed as Not met.",
      promiseChecks: [],
      chunkIds: ["C001"],
    });
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const row = rows.find((r) => r.ref === "3.1.1.DS1")!;
    expect(row.verdict).toBe("Not assessed");
    expect(row.comment).toContain("⚠ Verdict/comment mismatch");
    expect(row.comment).toContain('"Met"');
  });
});
