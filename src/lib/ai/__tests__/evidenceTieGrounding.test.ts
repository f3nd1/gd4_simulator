import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// Two-pass pooling (replaces the old F1 cross-window verdict-tie tests, whose
// merge machinery no longer exists): candidate passages extracted from EVERY
// sliding window are verified, pooled, and handed to ONE judge call per line.
// Reading order can no longer decide which justification survives — the judge
// sees everything at once and decides once.
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
const HANDBOOK_QUOTE = "MARKER_ONE the handbook describes the vetting and approval process";
const RECORD_QUOTE = "MARKER_TWO completed Material Vetting Form approved 3 Feb 2026";
const EVIDENCE_DOC =
  `[CHUNK:C001] --- Staff_Handbook.pdf ---\n${HANDBOOK_QUOTE} ${filler}` +
  `\n\n=== ACTUAL EVIDENCE ===\n\n` +
  `[CHUNK:C002] --- Material_Vetting_Form.pdf ---\n${RECORD_QUOTE}`;

const LINE: EvidenceAssessmentInput = {
  ref: "2.2.2.DS1",
  requirementText: "Vetting and approval prior to publication",
  ppdExtract: "vetting process",
  ppdVerdict: "Adequate",
  promises: [{ promiseText: "Management vets and approves advertisements before publication", sourceQuote: "", chunkId: "C001" }],
};

// Block body matters: mockReset() returns the mock, and vitest calls a
// function RETURNED from beforeEach as a cleanup hook — which would invoke
// chatComplete() with no args after every test.
beforeEach(() => { mockChat.mockReset(); });

describe("two-pass pooling — every window's verified passages reach ONE judge call", () => {
  function mockPooling(judgeVerdict: "Met" | "Partial") {
    let extractCall = 0;
    const judgeUsers: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      const user = String(messages[1]?.content ?? "");
      if (system.includes("EXTRACTION pass")) {
        extractCall++;
        // Window 0 sees only the handbook; window 1 only the record.
        const cand = extractCall === 1
          ? { aspect: "policy description", quote: HANDBOOK_QUOTE, kind: "policy", chunkId: "C001" }
          : { aspect: "promise 1: vetting record", quote: RECORD_QUOTE, kind: "record", chunkId: "C002" };
        return JSON.stringify({ results: [{ ref: "2.2.2.DS1", candidates: [cand] }] });
      }
      judgeUsers.push(user);
      return JSON.stringify({
        results: [{
          ref: "2.2.2.DS1",
          evidenceSummary: "Implementation evidenced by the completed Material Vetting Form (C002).",
          verdict: judgeVerdict,
          comment: "The completed Material Vetting Form C002 shows the advertisement was vetted and approved before publication.",
          promiseChecks: [{ promiseText: "Management vets and approves advertisements before publication", verdict: "evidenced", evidence: "Material Vetting Form C002", chunkIds: ["C002"], quote: RECORD_QUOTE }],
          chunkIds: ["C001", "C002"],
        }],
      });
    });
    return { judgeUsers, extractCalls: () => extractCall };
  }

  it("passages from both windows are pooled into a single judge prompt, labelled record vs policy", async () => {
    const { judgeUsers, extractCalls } = mockPooling("Met");
    const { rows } = await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    expect(extractCalls()).toBe(2); // sanity: really two windows extracted
    expect(judgeUsers).toHaveLength(1); // ...but exactly ONE judge decision
    // The judge saw BOTH passages, with their kind labels.
    expect(judgeUsers[0]).toContain(HANDBOOK_QUOTE);
    expect(judgeUsers[0]).toContain(RECORD_QUOTE);
    expect(judgeUsers[0]).toContain("· policy]");
    expect(judgeUsers[0]).toContain("· record]");
    // The judged row carries the record-grounded justification and verdict.
    const r = rows[0];
    expect(r.verdict).toBe("Met");
    expect(r.evidenceSummary).toContain("Material Vetting Form");
    expect(r.chunkIds).toEqual(expect.arrayContaining(["C001", "C002"]));
  });

  it("the judge prompt carries the policy-is-not-implementation rule (record-over-policy preserved from the single-pass prompt)", async () => {
    mockPooling("Met");
    await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    const systems = mockChat.mock.calls.map((c) => String(c[0].find((m) => m.role === "system")?.content ?? ""));
    const judgeSystem = systems.find((s) => !s.includes("EXTRACTION pass"))!;
    expect(judgeSystem).toContain('Only "record" passages count as implementation evidence');
  });

  it("a fabricated candidate quote never reaches the judge (deterministic verification between the passes)", async () => {
    const judgeUsers: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      const user = String(messages[1]?.content ?? "");
      if (system.includes("EXTRACTION pass")) {
        return JSON.stringify({
          results: [{
            ref: "2.2.2.DS1",
            candidates: [
              { aspect: "real record", quote: RECORD_QUOTE, kind: "record", chunkId: "C002" },
              // Invented — not in the evidence text at all.
              { aspect: "fabricated record", quote: "A signed approval memo dated 1 Jan 2026 authorises all advertisements.", kind: "record", chunkId: "C002" },
            ],
          }],
        });
      }
      judgeUsers.push(user);
      return JSON.stringify({ results: [{ ref: "2.2.2.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C002"] }] });
    });

    await runEvidenceAssessment([LINE], EVIDENCE_DOC, SETTINGS, {});
    expect(judgeUsers.length).toBeGreaterThan(0);
    expect(judgeUsers[0]).toContain(RECORD_QUOTE);
    expect(judgeUsers[0]).not.toContain("A signed approval memo dated 1 Jan 2026");
  });
});
