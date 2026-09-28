import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { REREAD_CLEARS_NOTICE, RECHECK_CLEARS_NOTICE } from "../selfCheckEvidence";

const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");
const FINDINGS = readFileSync("src/pages/Findings.tsx", "utf8");
const CLARIFY = readFileSync("src/pages/Clarification.tsx", "utf8");

// A re-read of one file writes a new evidence result, and the new result has no
// band suggestion and hides the results-and-review pass. That is the CORRECT
// outcome: both were worked out from the verdicts as they stood before the
// re-read. The bug was the telling. The message said the dimension working and
// the pass "are from the earlier run", which reads as "still there".
describe("a re-read says what it costs", () => {
  it("names all three things it clears, and how to get them back", () => {
    expect(REREAD_CLEARS_NOTICE).toMatch(/band/i);
    expect(REREAD_CLEARS_NOTICE).toMatch(/four-dimension panel/i);
    expect(REREAD_CLEARS_NOTICE).toMatch(/results-and-review pass/i);
    expect(REREAD_CLEARS_NOTICE).toMatch(/run the whole area again/i);
  });

  it("never claims they survive the re-read", () => {
    expect(REREAD_CLEARS_NOTICE).not.toMatch(/from the earlier run/i);
    // Code lines only: the comment at the fix site quotes the sentence it replaced.
    const code = STORE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/are from the earlier run/i);
  });

  it("says it BEFORE the click, not only in the message afterwards", () => {
    // Once in the import, once rendered beside the button.
    expect([...PAGE.matchAll(/REREAD_CLEARS_NOTICE/g)].length).toBe(2);
    expect(PAGE).toContain("<p className=\"sc-reread-cost\">{REREAD_CLEARS_NOTICE}</p>");
  });

  it("says it again in the message the re-read returns", () => {
    // Sliced to the next action, not to a character count: the action grew
    // when the re-read trace was added and a fixed window stopped covering it.
    const fn = STORE.slice(STORE.indexOf("recheckFileLines: async"), STORE.indexOf("recheckFinding: async"));
    expect(fn).toContain("${REREAD_CLEARS_NOTICE}");
  });
});

// The notice is only honest while the code still behaves this way. These pin
// the two facts it asserts, so a later change that carries the band forward
// makes the wording wrong AND fails here, rather than quietly disagreeing.
describe("the two facts the notice states", () => {
  it("a scoped re-read writes a result with no band suggestion", () => {
    // finish() builds the stored result. If bandSuggestion is ever added to
    // that object literal, the band is no longer cleared and this must be
    // rewritten together with the notice.
    const finish = STORE.slice(STORE.indexOf("const finish = (rows: EvidenceAssessmentRow[] | null, live: boolean"));
    const stored = finish.slice(finish.indexOf("evidenceAssessments: rows"), finish.indexOf("evidenceAssessmentHistory: prev"));
    expect(stored).toContain("subCriterionId, rows, runAt: runAtIso");
    expect(stored).not.toContain("bandSuggestion");
  });

  it("the band suggestion is only ever written by the full run", () => {
    // One writer, one caller. A second caller would mean a re-read could
    // repopulate it, and the notice would be overclaiming.
    expect([...STORE.matchAll(/attachBandSuggestion/g)].length).toBe(2); // the type and the action
    expect([...PAGE.matchAll(/attachBandSuggestion/g)].length).toBe(1);
    const fn = STORE.slice(STORE.indexOf("recheckFileLines: async"), STORE.indexOf("recheckFinding: async"));
    expect(fn).not.toContain("attachBandSuggestion");
  });

  it("the results-and-review pass is hidden when it predates the run on screen", () => {
    const shown = PAGE.slice(PAGE.indexOf("const outcomeShown = useMemo"));
    expect(shown.slice(0, 500)).toMatch(/res\.runAt\).getTime\(\) < new Date\(runAt\).getTime\(\)\) return undefined/);
  });
});

// THREE actions clear the band, not one. "Re-check this finding" and a
// clarification round call the same runEvidenceAssessment with a subset of
// refs, land in the same finish() and lose the band identically. Both used to
// say nothing at all about it, which is worse than the wrong sentence the
// file re-read used to carry: silence tells you nothing happened.
describe("every path that clears the band says so", () => {
  it("uses one reason for all three, so they cannot drift apart", () => {
    const why = "Run the whole area again to get them back.";
    expect(REREAD_CLEARS_NOTICE).toContain(why);
    expect(RECHECK_CLEARS_NOTICE).toContain(why);
    for (const n of [REREAD_CLEARS_NOTICE, RECHECK_CLEARS_NOTICE]) {
      expect(n, n).toMatch(/band/i);
      expect(n, n).toMatch(/four-dimension panel/i);
      expect(n, n).toMatch(/results-and-review pass/i);
    }
  });

  it("re-checking one finding says it, before and after", () => {
    expect(FINDINGS).toContain("{RECHECK_CLEARS_NOTICE}");
    const fn = STORE.slice(STORE.indexOf("recheckFinding: async"));
    expect(fn.slice(0, 4000)).toContain("${RECHECK_CLEARS_NOTICE}");
  });

  it("a clarification round says it, before and after", () => {
    expect(CLARIFY).toContain("{RECHECK_CLEARS_NOTICE}");
    const fn = STORE.slice(STORE.indexOf("runClarificationRound: async"));
    expect(fn.slice(0, 9000)).toContain("${RECHECK_CLEARS_NOTICE}");
  });

  // The list of callers is the thing that goes stale. Every call of
  // runEvidenceAssessment with a second argument is a scoped re-run, and every
  // scoped re-run clears the band, so a new one must disclose it too.
  it("has no scoped re-run that discloses nothing", () => {
    // The store action, called with a second argument: that argument IS the
    // ref subset that makes it a scoped re-run. (The engine function of the
    // same name in agentRuntime is a different thing and is not matched.)
    const scoped = [...STORE.matchAll(/get\(\)\.runEvidenceAssessment\([^)]*,/g)].map((m) => m[0]);
    expect(scoped.length).toBe(3);
    // Each one lives inside an action whose message carries a notice. Checked
    // by action name rather than by position, so a reorder does not break it.
    for (const action of ["recheckFileLines: async", "recheckFinding: async", "runClarificationRound: async"]) {
      const body = STORE.slice(STORE.indexOf(action), STORE.indexOf(action) + 9000);
      expect(body, action).toMatch(/\$\{(REREAD|RECHECK)_CLEARS_NOTICE\}/);
    }
  });
});
