import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ONE_READING_NOTE, ONE_READING_SHORT, TABS_EXPLAINED, buildSelfCheckCsv, buildSelfCheckHtml, toSelfCheckRows, countSelfCheck, SELF_CHECK_DISCLAIMER } from "../selfCheck";
import { buildAiRunLog } from "../aiRunLogExport";
import type { EvidenceAssessmentRow } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "5.5.1.DS1", gd4ItemId: "5.5.1", requirementText: "Describe your assessment policy.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Met", comment: "Found.", ...over,
} as EvidenceAssessmentRow);
const rows = toSelfCheckRows([row()]);
const band = { kind: "auditor", band: 3, name: "Meeting Expectation", totalPct: 50 } as const;

// Two runs on the same 39 documents, 1h45m apart with nothing changed in
// Drive, moved two verdicts downwards. Nothing anywhere told a reader that
// could happen, and this tool prepares people for a real EduTrust audit.
describe("a verdict is presented as one reading, not as settled", () => {
  it("says what it is, and says it can move, without a number it has not measured", () => {
    expect(ONE_READING_NOTE).toMatch(/one pass over your documents/i);
    expect(ONE_READING_NOTE).toMatch(/can reach a different answer/i);
    // No invented figure. The repeat-run number does not exist yet, and one
    // made up to sound careful would be the same fault in a new coat.
    expect(ONE_READING_NOTE).not.toMatch(/\b\d+\s*%|\b\d+ of \d+\b/);
  });

  it("stops calling the Overall tab the FINAL result", () => {
    expect(TABS_EXPLAINED.overview.hint).toBe("The combined result for each requirement");
    expect(TABS_EXPLAINED.overview.hint).not.toMatch(/final/i);
  });

  it("is said ONCE on the page, not turned into a wall of disclaimer", () => {
    const page = readFileSync("src/pages/SelfCheck.tsx", "utf8");
    expect([...page.matchAll(/ONE_READING_NOTE/g)].length).toBe(2); // the import and the one use
  });
});

describe("it travels with every export, because they leave the page behind", () => {
  it("is the CSV's first line, above the headers where sorting cannot move it", () => {
    const first = buildSelfCheckCsv("5.5 Student Assessment", rows, band).split("\r\n")[0];
    expect(first).toContain(ONE_READING_SHORT);
    // Two different claims: not repeatable, and not official. Both.
    expect(first).toContain(SELF_CHECK_DISCLAIMER);
  });

  it("is in the printed page's header block, not a footer nobody reads", () => {
    const html = buildSelfCheckHtml({ areaLabel: "5.5", areaDescription: "d", ranAt: "today", rows, band, counts: countSelfCheck(rows) });
    const headIdx = html.indexOf("<h1>");
    const noteIdx = html.indexOf("one-reading");
    const tallyIdx = html.indexOf("could not check");
    expect(noteIdx).toBeGreaterThan(headIdx);
    expect(noteIdx, "above the tally, not below it").toBeLessThan(tallyIdx);
  });

  it("keeps the printed note with the heading across a page break", () => {
    const css = readFileSync("src/lib/printableDoc.ts", "utf8");
    const rule = css.slice(css.indexOf(".one-reading{"), css.indexOf(".one-reading{") + 300);
    expect(rule).toContain("break-inside:avoid");
    expect(rule).toContain("break-after:avoid");
  });

  it("is a field of the AI run log, which is what gets quoted back later", () => {
    const log = buildAiRunLog({ area: "5.5" });
    expect(log.caveat).toMatch(/one reading of the documents/i);
    expect(log.caveat).toMatch(/can reach a different verdict/i);
    // Distinct from privacyNote: one is about what the file contains, the
    // other about what its verdicts mean.
    expect(log.caveat).not.toBe(log.privacyNote);
  });
});
