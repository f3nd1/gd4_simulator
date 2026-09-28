import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { REREAD_CLEARS_NOTICE } from "../selfCheckEvidence";

const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");

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
    const fn = STORE.slice(STORE.indexOf("recheckFileLines: async"));
    expect(fn.slice(0, 3000)).toContain("${REREAD_CLEARS_NOTICE}");
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
    const fn = STORE.slice(STORE.indexOf("recheckFileLines: async"));
    expect(fn.slice(0, 3000)).not.toContain("attachBandSuggestion");
  });

  it("the results-and-review pass is hidden when it predates the run on screen", () => {
    const shown = PAGE.slice(PAGE.indexOf("const outcomeShown = useMemo"));
    expect(shown.slice(0, 500)).toMatch(/res\.runAt\).getTime\(\) < new Date\(runAt\).getTime\(\)\) return undefined/);
  });
});
