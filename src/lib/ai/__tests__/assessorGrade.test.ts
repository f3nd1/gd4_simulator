import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runPPDRequirementsReview, runEvidenceAssessment, quoteExistsInSource, clauseAppearsInSource, type PPDRequirementInput, type EvidenceAssessmentInput } from "../agentRuntime";

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

  it("keeps window 1's real comment when a later window upgrades the verdict but returns one blank (the same merge bug as the PPD side)", async () => {
    // > WINDOW_SIZE (55,000 chars) forces two windows over the evidence text.
    const LONG_EV_SOURCE = `[CHUNK:C001] --- refund-register.xlsx ---\n${"Filler evidence text. ".repeat(2500)}`;
    let callCount = 0;
    mockChat.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          results: [{
            ref: "4.4.1.DS1", evidenceSummary: "Partial register sighted.", verdict: "Partial",
            comment: "The refund register shows timely payment but no peer-review record.",
            promiseChecks: [], chunkIds: ["C001"],
          }],
        });
      }
      // Window 2 upgrades to Met (a real, higher verdict) but its comment
      // comes back blank — the exact reported failure mode.
      return JSON.stringify({
        results: [{
          ref: "4.4.1.DS1", evidenceSummary: "Full register sighted.", verdict: "Met",
          comment: "", promiseChecks: [], chunkIds: ["C001"],
        }],
      });
    });
    const result = await runEvidenceAssessment(evInputs(), LONG_EV_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Met"); // the later, higher verdict still wins
    expect(row.comment).not.toBe(""); // but its real justification must not be discarded for a blank one
    expect(row.comment).toContain("no peer-review record");
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

describe("clauseAppearsInSource", () => {
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
});

describe("clause / rationale / chunkId are parsed with honesty (Phase 2)", () => {
  const PPD_SRC = `[CHUNK:C001] --- hr-manual.docx ---
4.2 Competency-Based Recruitment and Selection Strategy. Step 1: Manpower Planning and Deployment. The HR Manager reviews staffing needs quarterly and records them in the manpower plan.`;

  it("keeps a real clause + rationale + chunkId, and DROPS an invented clause to undefined", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [
            // Real clause present verbatim in the source → kept.
            { text: "Manpower planning", verdict: "documented", quote: "The HR Manager reviews staffing needs quarterly and records them in the manpower plan.", clause: "4.2 Competency-Based Recruitment and Selection Strategy, Step 1: Manpower Planning and Deployment", rationale: "The manpower plan names the HR Manager and a quarterly cadence.", chunkId: "C001" },
            // Invented clause not in the source → dropped to undefined (honest em-dash in UI).
            { text: "Succession planning", verdict: "not documented", quote: "", clause: "9.9 Succession & Talent Pipeline Policy", rationale: "", chunkId: "" },
          ],
          verdict: "Partial", shortComment: "Succession planning not documented.", fullComment: "x", promises: [], suggestedRewrite: "y", chunkIds: ["C001"], supportQuote: "",
        }],
      });
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
    mockChat.mockImplementation(async () => JSON.stringify({
      results: [{
        ref: "1.1.1.DS1", evidenceSummary: "Review record sighted.", verdict: "Met", comment: "Record confirms the quarterly review ran (C001).",
        promiseChecks: [
          { promiseText: "Quarterly manpower review", verdict: "evidenced", evidence: "Q1 review record (C001).", chunkIds: ["C001"], quote: "Q1 manpower review held 12 Feb", rationale: "A dated Q1 record shows the review actually ran.", chunkId: "C001" },
        ],
        chunkIds: ["C001"],
      }],
    }));
    const result = await runEvidenceAssessment([{ ref: "1.1.1.DS1", requirementText: "x", ppdVerdict: "Adequate", ppdExtract: "d", promises: [{ promiseText: "Quarterly manpower review", sourceQuote: "", chunkId: "C001" }] }], EV_SRC, SETTINGS, {});
    const pc = result.rows[0].promiseChecks![0];
    expect(pc.rationale).toContain("Q1 record");
    expect(pc.chunkId).toBe("C001");
  });
});

describe("shortComment is required for EVERY verdict, not just negatives (empty-rationale-on-met-rows investigation)", () => {
  it("the system prompt's shortComment instruction explicitly requires a reason for Adequate, not only for negatives", async () => {
    const capturedSystems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      capturedSystems.push(system);
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }],
      });
    });
    await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], `[CHUNK:C001] --- hr.docx ---\nThe HR Manager reviews staffing quarterly.`, SETTINGS, {});
    const mainSystem = capturedSystems.find((s) => s.includes("shortComment"))!;
    // Old wording only told the model what to do for negatives, leaving the
    // positive branch unspecified — the real root cause of "Documented" rows
    // returning a blank rationale. New wording is explicit and unconditional.
    expect(mainSystem).toContain("MANDATORY for every verdict, never blank");
    expect(mainSystem).toContain("Documented, because");
  });
});

describe("'spread across the document' shows real evidence, not just an assertion (Task 4)", () => {
  it("verifies each proposed spreadQuotes passage independently — keeps the real ones, drops a fabricated one", async () => {
    const SRC = `[CHUNK:C001] --- ppd.docx ---
The Compliance Officer reviews the register monthly. Deputy Principal signs off quarterly. All findings are logged in the shared tracker.`;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
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
          verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
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
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [{ text: "Manpower planning", verdict: "documented", quote: "The HR Manager reviews staffing quarterly.", clause: "", rationale: "", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].spreadQuotes).toBeUndefined();
  });
});

describe("clause capture includes the source's own leading number/bullet (Task 4)", () => {
  it("keeps the number when the numbered heading is verbatim in the source", async () => {
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
7.3(a) Audit Report. The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "6.1.1.DS1",
          subClauses: [{ text: "Audit reporting", verdict: "documented", quote: "The Internal Audit Unit issues a report to the Board within 10 working days.", clause: "7.3(a) Audit Report", rationale: "", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBe("7.3(a) Audit Report");
  });

  it("falls back to the heading alone when the numbered form isn't a contiguous verbatim match — never drops a clause the unnumbered heading would have shown before this change", async () => {
    // The number and heading are on separate lines in the source (a real
    // document layout), so joining them into one string as the prompt now
    // asks for won't verify verbatim — the fallback must still surface the
    // heading, exactly as it would have before Task 4. The heading itself is
    // kept long (>20 chars) so this genuinely exercises verbatim matching
    // rather than quoteExistsInSource's short-string always-pass rule.
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
7.3
(a) Detailed Audit Reporting Requirements
The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "6.1.1.DS1",
          subClauses: [{ text: "Audit reporting", verdict: "documented", quote: "The Internal Audit Unit issues a report to the Board within 10 working days.", clause: "7.3(a) Detailed Audit Reporting Requirements", rationale: "", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBe("Detailed Audit Reporting Requirements");
  });

  it("never invents a number — a wholly fabricated numbered clause is dropped to undefined", async () => {
    const SRC = `[CHUNK:C001] --- audit-manual.docx ---
The Internal Audit Unit issues a report to the Board within 10 working days.`;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "6.1.1.DS1",
          subClauses: [{ text: "Audit reporting", verdict: "documented", quote: "The Internal Audit Unit issues a report to the Board within 10 working days.", clause: "9.9(z) Wholly Invented Compliance Section", rationale: "", chunkId: "C001" }],
          verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], SRC, SETTINGS, {});
    expect(result.rows[0].subClauses![0].clause).toBeUndefined();
  });
});

describe("live-run visibility: window-start carries chunk IDs, batch-failed carries a real error (stall diagnosis)", () => {
  it("PPD: window-start.chunkIds names the chunk(s) actually in this window's text", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "x", fullComment: "x", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }],
      });
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
      const system = String(messages[0]?.content ?? "");
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
    mockChat.mockImplementation(async () => JSON.stringify({
      results: [{ ref: "4.4.1.DS1", evidenceSummary: "x", verdict: "Met", comment: "x", promiseChecks: [], chunkIds: ["C001"] }],
    }));
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
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{
          ref: "1.1.1.DS1",
          subClauses: [{ text: "Manpower planning", verdict: "documented", quote: "The HR Manager reviews staffing quarterly." }],
          verdict: "Adequate", shortComment: "", fullComment: "", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "The HR Manager reviews staffing quarterly.",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }], HR_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Adequate"); // a real verdict WAS returned
    expect(row.shortComment).toBe(""); // honestly blank, not a false claim
    expect(row.fullComment).toBe("");
    expect(row.shortComment).not.toContain("No verdict returned");
    expect(row.fullComment).not.toContain("No verdict returned");
  });

  it("a line the model silently drops from a successfully-parsed batch is honestly blank, not falsely explained", async () => {
    // Two lines requested; the model returns only one — the batch still
    // parses (results.length > 0), so this is NOT the "no parseable
    // results" failure path (that path IS accurate: it records a
    // windowError and the line surfaces as "Not assessed", tested
    // elsewhere in partialCoverage.test.ts). The dropped ref instead falls
    // through the per-item loop's own "Not documented" default.
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      return JSON.stringify({
        results: [{ ref: "1.1.1.DS1", subClauses: [], verdict: "Adequate", shortComment: "Covered.", fullComment: "Covered.", promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "" }],
      });
    });
    const result = await runPPDRequirementsReview(
      [{ ref: "1.1.1.DS1", gd4ItemId: "1.1.1", requirementText: "x" }, { ref: "1.1.1.DS2", gd4ItemId: "1.1.1", requirementText: "y" }],
      HR_SOURCE, SETTINGS, {}
    );
    const dropped = result.rows.find((r) => r.ref === "1.1.1.DS2")!;
    expect(dropped.verdict).toBe("Not documented");
    // Not the false "No verdict returned" claim — and not fabricated text either.
    expect(dropped.shortComment).toBe("");
    expect(dropped.fullComment).toBe("");
  });
});

describe("multi-window merge must not discard a real comment for a blank one (empty Rationale investigation)", () => {
  // > WINDOW_SIZE (55,000 chars) forces buildDocWindows to split this into
  // two windows, reproducing the exact mechanism a large real PPD (several
  // policy documents combined) hits in production.
  const LONG_SOURCE = `[CHUNK:C001] --- ppd.docx ---\n${"Filler compliance text. ".repeat(2500)}`;

  it("keeps window 1's real shortComment/fullComment when a later window upgrades the verdict but returns them blank", async () => {
    let reqCallCount = 0;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("INTERNAL CONTRADICTIONS")) return JSON.stringify({ contradictions: [] });
      if (system.includes("roll-up")) return JSON.stringify({ narrative: "ok" });
      reqCallCount++;
      if (reqCallCount === 1) {
        // Window 1 sees only a section that partially covers the line.
        return JSON.stringify({
          results: [{
            ref: "6.1.1.DS1", subClauses: [], verdict: "Partial",
            shortComment: "Only the annual review cadence is documented; the reporting line is missing.",
            fullComment: "The PPD names an annual review but does not name who it reports to.",
            promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
          }],
        });
      }
      // Window 2 sees the section that fully covers the line (a real,
      // higher verdict) but its shortComment/fullComment come back blank —
      // the exact failure mode reported as "Rationale empty on every line".
      return JSON.stringify({
        results: [{
          ref: "6.1.1.DS1", subClauses: [], verdict: "Adequate",
          shortComment: "", fullComment: "",
          promises: [], suggestedRewrite: "", chunkIds: ["C001"], supportQuote: "",
        }],
      });
    });
    const result = await runPPDRequirementsReview([{ ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "x" }], LONG_SOURCE, SETTINGS, {});
    const row = result.rows[0];
    expect(row.verdict).toBe("Adequate"); // the later, higher verdict still wins — verdict logic unchanged
    expect(row.shortComment).not.toBe(""); // but its real justification must not be discarded for a blank one
    expect(row.shortComment).toContain("annual review cadence");
    expect(row.fullComment).toContain("does not name who it reports to");
  });
});
