import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runPPDRequirementsReview, runEvidenceAssessment, quoteExistsInSource, clauseAppearsInSource, verifyClauseRef, PPD_BOUNDARY_RULES, EVIDENCE_BOUNDARY_RULES, type PPDRequirementInput, type EvidenceAssessmentInput } from "../agentRuntime";

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

// ── Two-pass mock dispatch helpers ─────────────────────────────────────────
// The PPD flow makes 4 kinds of calls (extract / contradiction hunt / judge /
// narrative roll-up); the evidence flow 2 (extract / judge). Dispatch on the
// system-prompt markers each pass carries.
type Dispatch = {
  ppdExtract?: (user: string) => string;
  ppdJudge?: (user: string) => string;
  evExtract?: (user: string) => string;
  evJudge?: (user: string) => string;
};
function mockTwoPass(d: Dispatch) {
  mockChat.mockImplementation(async (messages) => {
    const system = String(messages?.[0]?.content ?? "");
    const user = String(messages?.[1]?.content ?? "");
    if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
    if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
    if (system.includes("EXTRACTION pass of a two-pass SSG EduTrust review")) return d.ppdExtract!(user);
    if (system.includes("EXTRACTION pass of a two-pass SSG EduTrust evidence assessment")) return d.evExtract!(user);
    if (system.includes("STEP 1 — DECOMPOSE")) return d.ppdJudge!(user);
    return d.evJudge!(user);
  });
}
const extractResult = (ref: string, quote: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ results: [{ ref, candidates: [{ aspect: "relevant passage", quote, clause: "", chunkId: "C001" }], promises: [], ...extra }] });

describe("assessor-grade PPD review (Techniques 1-3)", () => {
  it("parses sub-clause verdicts, verified promises (pooled from extraction), and window contradictions into the result", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
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
      if (system.includes("EXTRACTION pass")) {
        return JSON.stringify({
          results: [{
            ref: "4.4.1.DS1",
            candidates: [{ aspect: "refund processing", quote: "Refunds are processed within 5 working days by the Finance Manager.", clause: "", chunkId: "C001" }],
            // One verified promise quote, one fabricated — the fabricated one
            // must be annotated (not dropped), same rule as the single pass.
            promises: [
              { promiseText: "Refunds processed within 5 working days", sourceQuote: "Refunds are processed within 5 working days by the Finance Manager", chunkId: "C001" },
              { promiseText: "The Principal signs quarterly attestations", sourceQuote: "the Principal signs a quarterly compliance attestation form each term", chunkId: "C001" },
            ],
          }],
        });
      }
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
  const EV_RECORD_QUOTE = "Refund log 2025: request 12 Jan, paid 15 Jan (3 working days).";

  it("a Met verdict with an unevidenced promise is capped at Partial with the SSG phrasing", async () => {
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [{ aspect: "promise 1: refund record", quote: EV_RECORD_QUOTE, kind: "record", chunkId: "C001" }] }] }),
      evJudge: () => JSON.stringify({
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
      }),
    });

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Partial"); // promise hard-gate
    expect(row.comment).toContain("in accordance with its documented PPD");
    expect(row.promiseChecks).toHaveLength(2);
    expect(row.promiseChecks![1].verdict).toBe("not evidenced");
  });

  it("promises are fed into BOTH passes' prompts as named checks", async () => {
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [{ aspect: "refund record", quote: EV_RECORD_QUOTE, kind: "record", chunkId: "C001" }] }] }),
      evJudge: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", evidenceSummary: "x", verdict: "Partial", comment: "x", promiseChecks: [], chunkIds: ["C001"] }] }),
    });
    await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const users = mockChat.mock.calls.map((c) => String(c[0].find((m) => m.role === "user")?.content ?? ""));
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const user of users) {
      expect(user).toContain("PPD promises to verify:");
      expect(user).toContain("Annual peer reviews covering all part-time academic staff");
    }
  });

  it("zero verified passages → the deterministic decision procedure decides in code (no AI coin-flip on empty input)", async () => {
    // Extraction succeeds but finds NOTHING for this line: with PPD Adequate
    // and promises present, rule 4a with E=0 gives "Not met" — and no judge
    // call is made at all.
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [] }] }),
      evJudge: () => { throw new Error("judge must not be called for a zero-candidate line"); },
    });
    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Not met");
    expect(row.promiseChecks).toHaveLength(2);
    expect(row.promiseChecks!.every((p) => p.verdict === "not evidenced")).toBe(true);
    expect(row.comment).toContain("It was not evident that the PEI had implemented");
    // Only extraction was called (plus no judge, no narrative on evidence side).
    const systems = mockChat.mock.calls.map((c) => String(c[0].find((m) => m.role === "system")?.content ?? ""));
    expect(systems.every((s) => s.includes("EXTRACTION pass"))).toBe(true);
  });

  it("zero passages with PPD Adequate and NO promises → deterministic Partial (approach documented, nothing evidenced)", async () => {
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [] }] }),
    });
    const result = await runEvidenceAssessment(
      [{ ref: "4.4.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [] }],
      EV_SOURCE, SETTINGS, {}
    );
    expect(result.rows[0].verdict).toBe("Partial");
  });

  it("zero passages with PPD Not documented → deterministic Not met", async () => {
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [] }] }),
    });
    const result = await runEvidenceAssessment(
      [{ ref: "4.4.1.DS1", requirementText: "x", ppdVerdict: "Not documented", ppdExtract: "", promises: [] }],
      EV_SOURCE, SETTINGS, {}
    );
    expect(result.rows[0].verdict).toBe("Not met");
  });
});

describe("suggestedAction — grounded 'what would make this Met' (Task 3)", () => {
  const EV_SOURCE = `[CHUNK:C001] --- mrm-minutes.docx ---
Management review meeting held 12 Jan 2026. 17 of 24 action items have no assigned owner or due date.`;
  const MRM_QUOTE = "17 of 24 action items have no assigned owner or due date.";

  function evInputs(): EvidenceAssessmentInput[] {
    return [{
      ref: "6.2.1.DS1.a",
      requirementText: "Management review actions are assigned an owner and a timeline.",
      ppdVerdict: "Adequate",
      ppdExtract: "Documented.",
      promises: [],
    }];
  }
  const evExtract = () => JSON.stringify({ results: [{ ref: "6.2.1.DS1.a", candidates: [{ aspect: "MRM minutes", quote: MRM_QUOTE, kind: "record", chunkId: "C001" }] }] });

  it("carries a Partial verdict's grounded suggestion through to the row", async () => {
    mockTwoPass({
      evExtract,
      evJudge: () => JSON.stringify({
        results: [{
          ref: "6.2.1.DS1.a",
          evidenceSummary: "MRM minutes sighted but most actions lack owners.",
          verdict: "Partial",
          comment: "17 of 24 action items in the MRM minutes have no assigned owner or due date.",
          promiseChecks: [],
          chunkIds: ["C001"],
          evidenceQuote: "",
          suggestedAction: "Add owner and timeline fields to the remaining 17 unassigned actions in the Management Review Meeting minutes.",
        }],
      }),
    });

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Partial");
    expect(row.suggestedAction).toBe("Add owner and timeline fields to the remaining 17 unassigned actions in the Management Review Meeting minutes.");
  });

  it("leaves suggestedAction undefined for a Met verdict (honesty rule: no suggestion needed)", async () => {
    mockTwoPass({
      evExtract,
      evJudge: () => JSON.stringify({
        results: [{
          ref: "6.2.1.DS1.a",
          evidenceSummary: "All 24 action items have an assigned owner and due date.",
          verdict: "Met",
          comment: "All MRM action items are fully assigned.",
          promiseChecks: [],
          chunkIds: ["C001"],
          evidenceQuote: "",
          suggestedAction: "",
        }],
      }),
    });

    const result = await runEvidenceAssessment(evInputs(), EV_SOURCE, SETTINGS, {});
    expect(result.rows[0].verdict).toBe("Met");
    expect(result.rows[0].suggestedAction).toBeUndefined();
  });

  it("with multiple windows the suggestion comes from ONE judge decision — there is no cross-window merge left to lose it", async () => {
    const LONG_EV_SOURCE = `[CHUNK:C001] --- mrm-minutes.docx ---\n${MRM_QUOTE}\n${"Filler evidence text. ".repeat(2500)}`;
    let judgeCalls = 0;
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "6.2.1.DS1.a", candidates: [{ aspect: "MRM minutes", quote: MRM_QUOTE, kind: "record", chunkId: "C001" }] }] }),
      evJudge: () => {
        judgeCalls++;
        return JSON.stringify({
          results: [{
            ref: "6.2.1.DS1.a", evidenceSummary: "Partial minutes sighted.", verdict: "Partial",
            comment: "17 of 24 action items lack an assigned owner.",
            suggestedAction: "Add owner and timeline fields to the remaining 17 unassigned actions.",
            promiseChecks: [], chunkIds: ["C001"],
          }],
        });
      },
    });
    const result = await runEvidenceAssessment(evInputs(), LONG_EV_SOURCE, SETTINGS, {});
    expect(judgeCalls).toBe(1); // two windows extracted, ONE judgement
    const row = result.rows[0];
    expect(row.verdict).toBe("Partial");
    expect(row.suggestedAction).toBeTruthy();
  });
});

describe("quoteExistsInSource", () => {
  it("matches with whitespace/curly-quote drift; rejects fabricated quotes; passes short quotes", () => {
    const src = "Refunds are processed within 5 working days by the Finance Manager.";
    expect(quoteExistsInSource("Refunds  are processed\nwithin 5 working days", src)).toBe(true);
    expect(quoteExistsInSource("the Principal signs a quarterly compliance attestation form", src)).toBe(false);
    expect(quoteExistsInSource("Adequate", src)).toBe(true);
  });

  it("accepts a mid-quote-elided quote when every segment is verbatim and in order (3.1 'spread across' investigation)", () => {
    const src = "The contract period with each agent shall be stated in the agency agreement and shall not exceed two years without a formal renewal review.";
    // Both halves verbatim, in order → accepted (was silently dropped before).
    expect(quoteExistsInSource("The contract period with each agent ... shall not exceed two years", src)).toBe(true);
    expect(quoteExistsInSource("The contract period with each agent … without a formal renewal review", src)).toBe(true);
    // A paraphrased segment still fails — elision is not licence to reword.
    expect(quoteExistsInSource("The contract period with each agent ... must never go beyond twenty-four months", src)).toBe(false);
    // Segments out of order fail — elision marks omitted text, not reordering.
    expect(quoteExistsInSource("shall not exceed two years ... The contract period with each agent shall be stated", src)).toBe(false);
  });
});

describe("clauseAppearsInSource — no short-string free pass (the '- Responsibilities' investigation)", () => {
  const src = "4.2 Competency-Based Recruitment and Selection Strategy\nStep 1: Manpower Planning and Deployment\nThe HR Manager reviews staffing quarterly.";
  it("accepts a clause that is verbatim in the source", () => {
    expect(clauseAppearsInSource("4.2 Competency-Based Recruitment and Selection Strategy", src)).toBe(true);
  });
  it("accepts a 'Heading, Sub-heading' join via its leading segment (doc split across lines)", () => {
    expect(clauseAppearsInSource("4.2 Competency-Based Recruitment and Selection Strategy, Step 1: Manpower Planning and Deployment", src)).toBe(true);
  });
  it("rejects an invented/tidied clause whose leading segment is not in the source", () => {
    expect(clauseAppearsInSource("Section 9.9 Total Quality Excellence Framework", src)).toBe(false);
    expect(clauseAppearsInSource("", src)).toBe(false);
  });
  it("rejects a SHORT clause not in the source — previously any string under 20 chars auto-passed unverified", () => {
    // "- Responsibilities" is 18 chars: it used to pass against ANY document.
    expect(clauseAppearsInSource("- Responsibilities", "Totally unrelated document text.")).toBe(false);
    expect(clauseAppearsInSource("9.9 Bogus", src)).toBe(false);
  });
  it("still accepts a short clause that genuinely appears in the source", () => {
    expect(clauseAppearsInSource("Step 1", src)).toBe(true);
  });
});

describe("verifyClauseRef — bare list markers are bullet fragments, not clause identifiers", () => {
  const src = "PPD-SES-SL-3.1.1 Student Recruitment Policy\n5. Responsibilities\nThe Recruitment Manager oversees agent onboarding.";
  it("strips a leading '- ' marker and verifies the remaining heading against the source", () => {
    expect(verifyClauseRef("- Responsibilities", src)).toBe("Responsibilities");
    expect(verifyClauseRef("• Responsibilities", src)).toBe("Responsibilities");
  });
  it("drops a marker-prefixed fragment whose heading is NOT in the source (never auto-passes)", () => {
    expect(verifyClauseRef("- Responsibilities", "Nothing relevant here at all.")).toBeUndefined();
  });
  it("keeps a real numbered heading as-is, with the number-stripped fallback intact", () => {
    expect(verifyClauseRef("5. Responsibilities", src)).toBe("5. Responsibilities");
    // Number doesn't verify contiguously → falls back to the bare heading.
    expect(verifyClauseRef("7.7 Responsibilities", src)).toBe("Responsibilities");
  });
  it("drops a wholly invented reference to undefined", () => {
    expect(verifyClauseRef("9.9(z) Wholly Invented Compliance Section", src)).toBeUndefined();
  });
});

describe("clause / rationale / chunkId are parsed with honesty (Phase 2)", () => {
  const PPD_SRC = `[CHUNK:C001] --- hr-manual.docx ---
4.2 Competency-Based Recruitment and Selection Strategy. Step 1: Manpower Planning and Deployment. The HR Manager reviews staffing needs quarterly and records them in the manpower plan.`;
  const HR_QUOTE = "The HR Manager reviews staffing needs quarterly and records them in the manpower plan.";

  it("keeps a real clause + rationale + chunkId, and DROPS an invented clause to undefined", async () => {
    mockTwoPass({
      ppdExtract: () => extractResult("1.1.1.DS1", HR_QUOTE),
      ppdJudge: () => JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [
            // Real clause present verbatim in the source → kept.
            { text: "Manpower planning", verdict: "documented", quote: HR_QUOTE, clause: "4.2 Competency-Based Recruitment and Selection Strategy, Step 1: Manpower Planning and Deployment", rationale: "The manpower plan names the HR Manager and a quarterly cadence.", chunkId: "C001" },
            // Invented clause not in the source → dropped to undefined (honest em-dash in UI).
            { text: "Succession planning", verdict: "not documented", quote: "", clause: "9.9 Succession & Talent Pipeline Policy", rationale: "", chunkId: "" },
          ],
          verdict: "Partial", shortComment: "Succession planning not documented.", fullComment: "x", suggestedRewrite: "y", chunkIds: ["C001"], supportQuote: "",
        }],
      }),
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "Manpower and succession planning documented." }], PPD_SRC, SETTINGS, {});
    const sc = result.rows[0].subClauses!;
    expect(sc[0].clause).toBe("4.2 Competency-Based Recruitment and Selection Strategy, Step 1: Manpower Planning and Deployment");
    expect(sc[0].rationale).toContain("quarterly");
    expect(sc[0].chunkId).toBe("C001");
    expect(sc[1].clause).toBeUndefined(); // invented clause dropped
  });

  it("carries promiseCheck rationale + chunkId through the evidence parse", async () => {
    const EV_SRC = `[CHUNK:C001] --- attendance.xlsx ---
Q1 manpower review held 12 Feb; HR Manager present; staffing gaps logged.`;
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "1.1.1.DS1", candidates: [{ aspect: "promise 1: review record", quote: "Q1 manpower review held 12 Feb; HR Manager present; staffing gaps logged.", kind: "record", chunkId: "C001" }] }] }),
      evJudge: () => JSON.stringify({
        results: [{
          ref: "1.1.1.DS1", evidenceSummary: "Review record sighted.", verdict: "Met", comment: "Record confirms the quarterly review ran (C001).",
          promiseChecks: [
            { promiseText: "Quarterly manpower review", verdict: "evidenced", evidence: "Q1 review record (C001).", chunkIds: ["C001"], quote: "Q1 manpower review held 12 Feb", rationale: "A dated Q1 record shows the review actually ran.", chunkId: "C001" },
          ],
          chunkIds: ["C001"],
        }],
      }),
    });
    const result = await runEvidenceAssessment([{ ref: "1.1.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [{ promiseText: "Quarterly manpower review", sourceQuote: "", chunkId: "C001" }] }], EV_SRC, SETTINGS, {});
    const pc = result.rows[0].promiseChecks![0];
    expect(pc.rationale).toContain("Q1 record");
    expect(pc.chunkId).toBe("C001");
  });
});

describe("judge prompts carry the Phase 2 verdict framework", () => {
  const HR_SOURCE = `[CHUNK:C001] --- hr.docx ---\nThe HR Manager reviews staffing quarterly.`;
  const capture = () => {
    const systems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      systems.push(system);
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      if (system.includes("EXTRACTION pass")) return extractResult("1.1.1.DS1", "The HR Manager reviews staffing quarterly.");
      return JSON.stringify({ results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }] });
    });
    return systems;
  };

  it("shortComment is required for EVERY verdict, not just negatives (empty-rationale-on-met-rows investigation)", async () => {
    const systems = capture();
    await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], HR_SOURCE, SETTINGS, {});
    const judgeSystem = systems.find((s) => s.includes("STEP 1 — DECOMPOSE"))!;
    expect(judgeSystem).toContain("MANDATORY for every verdict, never blank");
    expect(judgeSystem).toContain("Documented, because");
  });

  it("the deterministic boundary rules for the flip-flopping line patterns are injected, and the core rubric is repeated at the very END of the prompt", async () => {
    const systems = capture();
    await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], HR_SOURCE, SETTINGS, {});
    const judgeSystem = systems.find((s) => s.includes("STEP 1 — DECOMPOSE"))!;
    // The rules block (review lines / contract-content / register-field /
    // mechanism / multi-part) is present verbatim.
    expect(judgeSystem).toContain(PPD_BOUNDARY_RULES);
    expect(judgeSystem).toContain("DETERMINISTIC BOUNDARY RULES");
    // Rubric recency: the FINAL block of the prompt (after all skill/domain
    // injections) restates the decision rule.
    const tail = judgeSystem.slice(-700);
    expect(tail).toContain("Final verdict rubric");
    expect(tail).toContain("Ties resolve DOWN");
  });

  it("the evidence judge prompt carries the deterministic evidence rules and the repeated decision procedure at the END", async () => {
    const systems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      systems.push(system);
      if (system.includes("EXTRACTION pass")) return JSON.stringify({ results: [{ ref: "1.1.1.DS1", candidates: [{ aspect: "x", quote: "The HR Manager reviews staffing quarterly.", kind: "record", chunkId: "C001" }] }] });
      return JSON.stringify({ results: [{ ref: "1.1.1.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }] });
    });
    await runEvidenceAssessment([{ ref: "1.1.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [] }], HR_SOURCE, SETTINGS, {});
    const judgeSystem = systems.find((s) => !s.includes("EXTRACTION pass"))!;
    expect(judgeSystem).toContain(EVIDENCE_BOUNDARY_RULES);
    const tail = judgeSystem.slice(-700);
    expect(tail).toContain("Final decision procedure");
    expect(tail).toContain("Ties resolve DOWN");
  });
});

describe("targeted boundary rules for the post-model-switch ambiguous lines (rules 6-11)", () => {
  // The lines Phase 2's rules 1-5 targeted are all 100% stable on the new
  // model — so rules 1-5 must stay BYTE-IDENTICAL while rules 6-11 cover the
  // newly-ambiguous set (3.1.1.DS2.a/.b/.c/.e/.f/.h, DS3.a, DS4;
  // 6.1.1.DS1.c/.d). These pins fail if anyone rewords a stable rule.
  it("rules 1-5 are unchanged (stable lines depend on their exact wording)", () => {
    expect(PPD_BOUNDARY_RULES).toContain('1. REVIEW lines ("Review the [X] process/procedures for continual improvement"): "Adequate" ONLY when a passage names (i) who reviews THAT specific process (role/committee) AND (ii) a frequency or trigger for the review.');
    expect(PPD_BOUNDARY_RULES).toContain('2. CONTRACT-CONTENT lines (one named term the agent contract must cover');
    expect(PPD_BOUNDARY_RULES).toContain('3. REGISTER/LIST-FIELD lines (one named field an agent list/register must record');
    expect(PPD_BOUNDARY_RULES).toContain('4. MECHANISM lines ("Encourage/facilitate…", "Implement…", "Invest in…")');
    expect(PPD_BOUNDARY_RULES).toContain('5. MULTI-PART lines (several obligations joined in one line');
  });
  it("the new PPD rules cover each currently-ambiguous line's wording pattern", () => {
    expect(PPD_BOUNDARY_RULES).toContain("6. SINGLE-CLAUSE CONTRACT SAFEGUARD lines"); // DS2.e, DS2.h
    expect(PPD_BOUNDARY_RULES).toContain("laws of Singapore");
    expect(PPD_BOUNDARY_RULES).toContain("7. ROLES-PLUS-NAMED-DUTY lines"); // DS2.b
    expect(PPD_BOUNDARY_RULES).toContain("pre-course counselling");
    expect(PPD_BOUNDARY_RULES).toContain("8. PAIRED-ARTIFACT lines"); // DS2.c
    expect(PPD_BOUNDARY_RULES).toContain("9. SERVICE-PERFORMANCE-INDICATOR lines"); // DS2.f
    expect(PPD_BOUNDARY_RULES).toContain("10. AFI/CAP PROCESS lines"); // 6.1.1.DS1.c/.d
    expect(PPD_BOUNDARY_RULES).toContain("11. REVIEW-LINE FLOOR"); // DS4's Partial-vs-Not-documented wobble
  });
  it("the new evidence rules pin the Partial-vs-Not-met floors and the every-instance quantifiers", () => {
    expect(EVIDENCE_BOUNDARY_RULES).toContain("judged across ALL provided signed agent contracts"); // DS2.a and safeguard lines
    expect(EVIDENCE_BOUNDARY_RULES).toContain("never demand transaction-level proof of a negative"); // DS2.e's Not-met wobble
    expect(EVIDENCE_BOUNDARY_RULES).toContain("REGISTER-FIELD lines"); // DS3.a
    expect(EVIDENCE_BOUNDARY_RULES).toContain("for EVERY listed agent");
    expect(EVIDENCE_BOUNDARY_RULES).toContain("AFI/CAP PROCESS lines"); // 6.1.1.DS1.c/.d
    expect(EVIDENCE_BOUNDARY_RULES).toContain('"Not met" ONLY when no assessment report, AFI list or CAP record appears');
    expect(EVIDENCE_BOUNDARY_RULES).toContain("REVIEW-LINE FLOOR"); // DS4
  });
});

describe("'spread across the document' shows real evidence, not just an assertion (Task 4)", () => {
  it("verifies each proposed spreadQuotes passage independently — keeps the real ones, drops a fabricated one", async () => {
    const SRC = `[CHUNK:C001] --- ppd.docx ---
The Compliance Officer reviews the register monthly. Deputy Principal signs off quarterly. All findings are logged in the shared tracker.`;
    mockTwoPass({
      ppdExtract: () => extractResult("6.1.1.DS1", "The Compliance Officer reviews the register monthly."),
      ppdJudge: () => JSON.stringify({
        results: [{
          ref: "6.1.1.DS1",
          subClauses: [{
            text: "Compliance monitoring", verdict: "documented", quote: "",
            spreadQuotes: [
              { quote: "The Compliance Officer reviews the register monthly.", chunkId: "C001" },
              { quote: "Deputy Principal signs off quarterly.", chunkId: "C001" },
              { quote: "This sentence was never in the source document at all.", chunkId: "C001" },
            ],
            clause: "", rationale: "Monitoring is split across two named roles.", chunkId: "",
          }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      }),
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    const sq = result.rows[0].subClauses![0].spreadQuotes!;
    expect(sq).toHaveLength(2); // the fabricated third quote is dropped
    expect(sq.map((s) => s.quote)).toEqual([
      "The Compliance Officer reviews the register monthly.",
      "Deputy Principal signs off quarterly.",
    ]);
  });

  it("spreadQuotes is undefined when the model returns none (single quote or true diffuse-mention case) — never fabricated", async () => {
    const SRC = `[CHUNK:C001] --- ppd.docx ---\nThe HR Manager reviews staffing quarterly.`;
    mockTwoPass({
      ppdExtract: () => extractResult("1.1.1.DS1", "The HR Manager reviews staffing quarterly."),
      ppdJudge: () => JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [{ text: "Manpower planning", verdict: "documented", quote: "The HR Manager reviews staffing quarterly.", clause: "", rationale: "", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      }),
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].spreadQuotes).toBeUndefined();
  });
});

describe("clause capture includes the source's own leading number/bullet (Task 4)", () => {
  const judgeWithClause = (clause: string, quote: string) => JSON.stringify({
    results: [{
      ref: "6.1.1.DS1",
      subClauses: [{ text: "Audit reporting", verdict: "documented", quote, clause, rationale: "", chunkId: "C001" }],
      verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
    }],
  });
  const AUDIT_QUOTE = "The Internal Audit Unit issues a report to the Board within 10 working days.";

  it("keeps the number when the numbered heading is verbatim in the source", async () => {
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
7.3(a) Audit Report. The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockTwoPass({
      ppdExtract: () => extractResult("6.1.1.DS1", AUDIT_QUOTE),
      ppdJudge: () => judgeWithClause("7.3(a) Audit Report", AUDIT_QUOTE),
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBe("7.3(a) Audit Report");
  });

  it("falls back to the heading alone when the numbered form isn't a contiguous verbatim match — never drops a clause the unnumbered heading would have shown", async () => {
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
7.3
(a) Detailed Audit Reporting Requirements
The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockTwoPass({
      ppdExtract: () => extractResult("6.1.1.DS1", AUDIT_QUOTE),
      ppdJudge: () => judgeWithClause("7.3(a) Detailed Audit Reporting Requirements", AUDIT_QUOTE),
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBe("Detailed Audit Reporting Requirements");
  });

  it("never invents a number — a wholly fabricated numbered clause is dropped to undefined", async () => {
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockTwoPass({
      ppdExtract: () => extractResult("6.1.1.DS1", AUDIT_QUOTE),
      ppdJudge: () => judgeWithClause("9.9(z) Wholly Invented Compliance Section", AUDIT_QUOTE),
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBeUndefined();
  });
});

describe("3.1 investigation fixes — bullet clauses, unverified-quote honesty, extraction pooling, PPD skill gating", () => {
  const SRC = `[CHUNK:C001] --- ppd-ses-sl-3.1.1.docx ---
5. Responsibilities
The Recruitment Manager oversees agent onboarding. The contract period with each agent shall be stated in the agency agreement.`;
  const CONTRACT_QUOTE = "The contract period with each agent shall be stated in the agency agreement.";
  const reqs = [{ ref: "3.1.1.DS2.a", gd4ItemId: "3.1.1", requirementText: "Contract period stated." }];

  function mockPpdReply(subClauses: unknown[]) {
    mockTwoPass({
      ppdExtract: () => extractResult("3.1.1.DS2.a", CONTRACT_QUOTE),
      ppdJudge: () => JSON.stringify({
        results: [{ ref: "3.1.1.DS2.a", subClauses, verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }],
      }),
    });
  }

  it("a '- Responsibilities' bullet clause is stripped to the verified heading, never shown with the marker", async () => {
    mockPpdReply([{ text: "Contract period", verdict: "documented", quote: CONTRACT_QUOTE, clause: "- Responsibilities", rationale: "", chunkId: "C001" }]);
    const result = await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBe("Responsibilities");
  });

  it("a bullet-fragment clause with no matching heading in the source is dropped to undefined", async () => {
    mockPpdReply([{ text: "Contract period", verdict: "documented", quote: CONTRACT_QUOTE, clause: "- Renewal Provisions", rationale: "", chunkId: "C001" }]);
    const result = await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBeUndefined();
  });

  it("a documented sub-clause whose ONLY cited quote fails verification is flagged quoteUnverified — not presented as 'spread across the document'", async () => {
    mockPpdReply([{ text: "Contract period", verdict: "documented", quote: "This exact sentence is nowhere in the source document whatsoever.", spreadQuotes: [], clause: "", rationale: "", chunkId: "C001" }]);
    const result = await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    const sc = result.rows[0].subClauses![0];
    expect(sc.quote).toBeUndefined();
    expect(sc.quoteUnverified).toBe(true);
  });

  it("a documented sub-clause where the model itself returned NO quote and NO spreadQuotes is NOT flagged (true diffuse-mention state)", async () => {
    mockPpdReply([{ text: "Contract period", verdict: "documented", quote: "", spreadQuotes: [], clause: "", rationale: "", chunkId: "" }]);
    const result = await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    const sc = result.rows[0].subClauses![0];
    expect(sc.quote).toBeUndefined();
    expect(sc.quoteUnverified).toBeUndefined();
  });

  it("a mid-elided quote whose segments are all verbatim in order is now KEPT, not dropped", async () => {
    mockPpdReply([{ text: "Contract period", verdict: "documented", quote: "The contract period with each agent ... stated in the agency agreement", clause: "", rationale: "", chunkId: "C001" }]);
    const result = await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    const sc = result.rows[0].subClauses![0];
    expect(sc.quote).toBe("The contract period with each agent ... stated in the agency agreement");
    expect(sc.quoteUnverified).toBeUndefined();
  });

  it("a passage extracted in window 1 reaches the judge even when window 2's extraction returns nothing (pooling replaces the old cross-window merge)", async () => {
    // > WINDOW_SIZE forces two windows; the quotable text lives at the start,
    // so only window 1's extraction can quote it.
    const LONG_SRC = `[CHUNK:C001] --- ppd.docx ---\n${CONTRACT_QUOTE}\n${"Filler policy text. ".repeat(3000)}`;
    let extractCall = 0;
    const judgeUsers: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      const user = String(messages?.[1]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      if (system.includes("EXTRACTION pass")) {
        extractCall++;
        if (extractCall === 1) return extractResult("3.1.1.DS2.a", CONTRACT_QUOTE);
        return JSON.stringify({ results: [{ ref: "3.1.1.DS2.a", candidates: [], promises: [] }] });
      }
      judgeUsers.push(user);
      return JSON.stringify({
        results: [{
          ref: "3.1.1.DS2.a",
          subClauses: [{ text: "Contract period", verdict: "documented", quote: CONTRACT_QUOTE, clause: "", rationale: "Names the agency agreement.", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "Documented.", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview(reqs, LONG_SRC, SETTINGS, {});
    expect(extractCall).toBe(2); // both windows extracted
    expect(judgeUsers).toHaveLength(1); // one judge decision
    expect(judgeUsers[0]).toContain(CONTRACT_QUOTE); // window 1's passage reached it
    const row = result.rows[0];
    expect(row.verdict).toBe("Adequate");
    expect(row.subClauses![0].quote).toBe(CONTRACT_QUOTE);
    expect(row.subClauses![0].rationale).toBe("Names the agency agreement.");
  });

  it("PPD prompts use the ppdReview skill module: evidence-retrieval gated out, regulatory-references stays, policy-documentation BASE replaces the contradicting evidence-first skills", async () => {
    const capturedSystems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      capturedSystems.push(system);
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      if (system.includes("EXTRACTION pass")) return extractResult("3.1.1.DS2.a", CONTRACT_QUOTE);
      return JSON.stringify({ results: [{ ref: "3.1.1.DS2.a", subClauses: [], verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }] });
    });
    await runPPDRequirementsReview(reqs, SRC, SETTINGS, {});
    const judgeSystem = capturedSystems.find((s) => s.includes("STEP 1 — DECOMPOSE"))!;
    const extractSystem = capturedSystems.find((s) => s.includes("EXTRACTION pass"))!;
    for (const sys of [judgeSystem, extractSystem]) {
      expect(sys).not.toContain("=== SKILL: evidence-retrieval.md");
      expect(sys).toContain("=== SKILL: regulatory-references.md");
      // The BASE-skill contradiction fix: a documentation-only pass must not
      // receive "if the records are absent, the process is unverified"
      // (external-auditor.md) or the implementation-record rules
      // (evidence-standards.md) — it gets the policy-documentation posture.
      expect(sys).not.toContain("=== SKILL: external-auditor.md");
      expect(sys).not.toContain("=== SKILL: evidence-standards.md");
      expect(sys).not.toContain("If the records are absent");
      expect(sys).toContain("=== SKILL: policy-documentation-review.md");
    }
    // The bullet-marker clause rule lives with the pass that captures clauses.
    expect(extractSystem).toContain("not a clause identifier");
  });

  it("the evidence prompts still use the full evidence BASE (external-auditor stays where records ARE the question)", async () => {
    const capturedSystems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      capturedSystems.push(system);
      if (system.includes("EXTRACTION pass")) return JSON.stringify({ results: [{ ref: "3.1.1.DS2.a", candidates: [{ aspect: "x", quote: CONTRACT_QUOTE, kind: "record", chunkId: "C001" }] }] });
      return JSON.stringify({ results: [{ ref: "3.1.1.DS2.a", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }] });
    });
    await runEvidenceAssessment([{ ref: "3.1.1.DS2.a", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [] }], SRC, SETTINGS, {});
    const judgeSystem = capturedSystems.find((s) => !s.includes("EXTRACTION pass"))!;
    expect(judgeSystem).toContain("=== SKILL: external-auditor.md");
    expect(judgeSystem).toContain("=== SKILL: evidence-standards.md");
  });
});

describe("live-run visibility: window-start carries chunk IDs, batch-failed carries a real error (stall diagnosis)", () => {
  it("PPD: window-start.chunkIds names the chunk(s) actually in this window's text", async () => {
    mockTwoPass({
      ppdExtract: () => extractResult("1.1.1.DS1", "The HR Manager reviews staffing quarterly."),
      ppdJudge: () => JSON.stringify({ results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "x", fullComment: "x", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }] }),
    });
    const events: unknown[] = [];
    await runPPDRequirementsReview(
      [{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }],
      `[CHUNK:C001] --- hr.docx ---\nThe HR Manager reviews staffing quarterly.`,
      SETTINGS, { onEvent: (ev) => events.push(ev) }
    );
    const windowStart = events.find((e) => (e as { type: string }).type === "window-start") as { chunkIds: string[] };
    expect(windowStart.chunkIds).toEqual(["C001"]);
  });

  it("PPD: batch-failed carries the real exception message, not a generic label", async () => {
    mockChat.mockImplementation(async () => { throw new Error("rate limit exceeded (429)"); });
    const events: unknown[] = [];
    await runPPDRequirementsReview(
      [{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }],
      `[CHUNK:C001] --- hr.docx ---\nThe HR Manager reviews staffing quarterly.`,
      SETTINGS, { onEvent: (ev) => events.push(ev) }
    );
    const failed = events.find((e) => (e as { type: string }).type === "batch-failed") as { error: string };
    expect(failed.error).toContain("rate limit exceeded (429)");
  });

  it("PPD: batch-failed carries an honest reason when the reply parses but has no verdicts (not a generic label either)", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return "not valid json";
    });
    const events: unknown[] = [];
    await runPPDRequirementsReview(
      [{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }],
      `[CHUNK:C001] --- hr.docx ---\nThe HR Manager reviews staffing quarterly.`,
      SETTINGS, { onEvent: (ev) => events.push(ev) }
    );
    const failed = events.find((e) => (e as { type: string }).type === "batch-failed") as { error: string };
    expect(failed.error.length).toBeGreaterThan(0);
    expect(failed.error).not.toBe("");
  });

  it("Evidence: window-start.chunkIds names the chunk(s) actually in this window's text", async () => {
    mockTwoPass({
      evExtract: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", candidates: [{ aspect: "x", quote: "Refund log 2025: request 12 Jan, paid 15 Jan.", kind: "record", chunkId: "C001" }] }] }),
      evJudge: () => JSON.stringify({ results: [{ ref: "4.4.1.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }] }),
    });
    const events: unknown[] = [];
    await runEvidenceAssessment(
      [{ ref: "4.4.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [] }],
      `[CHUNK:C001] --- refund-register.xlsx ---\nRefund log 2025: request 12 Jan, paid 15 Jan.`,
      SETTINGS, { onEvent: (ev) => events.push(ev) }
    );
    const windowStart = events.find((e) => (e as { type: string }).type === "window-start") as { chunkIds: string[] };
    expect(windowStart.chunkIds).toEqual(["C001"]);
  });

  it("Evidence: batch-failed carries the real exception message, not a generic label", async () => {
    mockChat.mockImplementation(async () => { throw new Error("request timed out after 90000ms"); });
    const events: unknown[] = [];
    await runEvidenceAssessment(
      [{ ref: "4.4.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [] }],
      `[CHUNK:C001] --- refund-register.xlsx ---\nRefund log 2025: request 12 Jan, paid 15 Jan.`,
      SETTINGS, { onEvent: (ev) => events.push(ev) }
    );
    const failed = events.find((e) => (e as { type: string }).type === "batch-failed") as { error: string };
    expect(failed.error).toContain("request timed out after 90000ms");
  });
});

describe("rationale placeholder honesty (a real verdict must never claim 'no verdict returned')", () => {
  const HR_SOURCE = `[CHUNK:C001] --- hr.docx ---
The HR Manager reviews staffing quarterly.`;

  it("a real Adequate verdict with an empty shortComment/fullComment is left blank, not fabricated as 'No verdict returned'", async () => {
    mockTwoPass({
      ppdExtract: () => extractResult("1.1.1.DS1", "The HR Manager reviews staffing quarterly."),
      ppdJudge: () => JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [{ text: "Manpower planning", verdict: "documented", quote: "The HR Manager reviews staffing quarterly." }],
          verdict: "Adequate", shortComment: "", fullComment: "", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "The HR Manager reviews staffing quarterly.",
        }],
      }),
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], HR_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Adequate"); // a real verdict WAS returned
    expect(row.shortComment).toBe(""); // honestly blank, not a false claim
    expect(row.fullComment).toBe("");
    expect(row.shortComment).not.toContain("No verdict returned");
    expect(row.fullComment).not.toContain("No verdict returned");
  });

  it("a line the judge silently drops from a successfully-parsed batch is 'Not assessed' — not a fabricated 'Not documented'", async () => {
    // Two lines with candidates go to the judge; the reply covers only one.
    // The dropped ref must NOT default to a fabricated "Not documented" (the
    // old behaviour) — the honest state is "Not assessed", retryable.
    mockTwoPass({
      ppdExtract: (user) => JSON.stringify({
        results: [...user.matchAll(/\[(1\.1\.1\.DS\d)\]/g)].map((m) => ({
          ref: m[1],
          candidates: [{ aspect: "policy review", quote: "The HR Manager reviews staffing quarterly.", clause: "", chunkId: "C001" }],
          promises: [],
        })),
      }),
      ppdJudge: () => JSON.stringify({
        results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "Covered.", fullComment: "Covered.", suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }],
      }),
    });
    const result = await runPPDRequirementsReview(
      [{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }, { ref: "1.1.1.DS2", gd4ItemId: "1.1.1", requirementText: "y" }],
      HR_SOURCE, SETTINGS, {}
    );
    expect(result.rows.find((r) => r.ref === "1.1.1.DS1")!.verdict).toBe("Adequate");
    const dropped = result.rows.find((r) => r.ref === "1.1.1.DS2")!;
    expect(dropped.verdict).toBe("Not assessed");
    expect(dropped.verdict).not.toBe("Not documented");
    expect(dropped.shortComment).toContain("Not assessed");
  });

  it("a line whose extraction cleanly found nothing is a deterministic 'Not documented' with an honest reason — no judge call, no coin-flip", async () => {
    let judgeCalled = false;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages?.[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      if (system.includes("EXTRACTION pass")) return JSON.stringify({ results: [{ ref: "1.1.1.DS1", candidates: [], promises: [] }] });
      judgeCalled = true;
      return JSON.stringify({ results: [] });
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], HR_SOURCE, SETTINGS, {});
    expect(judgeCalled).toBe(false);
    const row = result.rows[0];
    expect(row.verdict).toBe("Not documented");
    expect(row.shortComment).toContain("no relevant passage was found");
    expect(row.fullComment).toContain("found no passage addressing this requirement");
  });
});
