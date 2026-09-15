import { describe, it, expect } from "vitest";
import {
  wordCount, bannedOpener, nameCandidates, inSource, buildWordingCapture,
  captureFilename, WHY_MIN, WHY_MAX, FIX_MIN,
} from "../wordingCapture";
import type { EvidenceAssessmentRow } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "r", ppdExtract: "", ppdVerdict: "Adequate",
  evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [], verdict: "Not met", comment: "", ...over,
});

describe("word counting", () => {
  it("counts words, not the em dash placeholder a blank cell renders", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  —  ")).toBe(0);
    expect(wordCount("")).toBe(0);
  });
});

describe("banned openers", () => {
  it("catches each opener the rules forbid, case-insensitively", () => {
    expect(bannedOpener("Although the PPD documents it...")).toBe("Although");
    expect(bannedOpener("while the records show...")).toBe("While");
    expect(bannedOpener("With the PPD assessed as not documenting...")).toBe("With the PPD assessed as");
    expect(bannedOpener("Despite the evidence...")).toBe("Despite");
  });
  it("does not fire on a compliant opener, or on the word appearing later", () => {
    expect(bannedOpener("The PPD does not define assessor competence.")).toBeNull();
    expect(bannedOpener("The records are complete, although one is undated.")).toBeNull();
  });
});

// Over-inclusive on purpose: a missed invention is worse than a candidate the
// reader dismisses at a glance.
describe("name candidates", () => {
  it("picks up document codes", () => {
    expect(nameCandidates("Update PPD-SGL-SQ-6.1.1 to define...")).toContain("PPD-SGL-SQ-6.1.1");
  });
  it("picks up role titles and named records", () => {
    expect(nameCandidates("assigning the Head of Academic Studies as approver")).toContain("Head of Academic Studies");
    expect(nameCandidates("maintain the Learning Support Register")).toContain("Learning Support Register");
    expect(nameCandidates("a linked entry in the Quality Action DocType")).toContain("Quality Action DocType");
  });
  it("leaves generic prose alone", () => {
    expect(nameCandidates("Retain evidence such as training records and declarations of independence.")).toEqual([]);
  });
});

describe("matching a candidate against the source", () => {
  const src = "The Academic Intervention Form is completed by the tutor. See the Student Support Policy.";
  it("matches regardless of punctuation and case", () => {
    expect(inSource("Academic Intervention Form", src)).toBe(true);
    expect(inSource("student support policy", src)).toBe(true);
  });
  it("does not match something absent", () => {
    expect(inSource("Learning Support Register", src)).toBe(false);
  });
});

describe("the capture report", () => {
  const sourceText = "Progress meeting minutes record each outcome. The Academic Intervention Form is used.";

  it("scores the ranges the rules set", () => {
    const why = Array(WHY_MIN).fill("word").join(" ");
    const fix = Array(FIX_MIN).fill("word").join(" ");
    const r = buildWordingCapture({
      area: "5.4 Student Learning", pass: "evidence",
      evidenceRows: [row({ comment: why, suggestedAction: fix })],
      sourceFiles: ["a.txt"], sourceText,
    });
    expect(r.rows[0].whyInRange).toBe(true);
    expect(r.rows[0].fixInRange).toBe(true);
    expect(r.totals.whyInRange).toBe(1);
  });

  it("marks a Why outside the range", () => {
    const short = buildWordingCapture({
      area: "a", pass: "evidence", evidenceRows: [row({ comment: "Too short." })],
      sourceFiles: [], sourceText,
    });
    expect(short.rows[0].whyInRange).toBe(false);
    const long = buildWordingCapture({
      area: "a", pass: "evidence", evidenceRows: [row({ comment: Array(WHY_MAX + 1).fill("w").join(" ") })],
      sourceFiles: [], sourceText,
    });
    expect(long.rows[0].whyInRange).toBe(false);
  });

  // The rules mandate this sentence verbatim where nothing is needed, so the
  // 20 to 55 range cannot bind on it.
  it("treats the mandated no-action sentence as compliant despite being short", () => {
    const r = buildWordingCapture({
      area: "a", pass: "evidence",
      evidenceRows: [row({ verdict: "Met", suggestedAction: "No further action required. Continue retaining evidence of implementation." })],
      sourceFiles: [], sourceText,
    });
    expect(wordCount(r.rows[0].fix)).toBeLessThan(FIX_MIN);
    expect(r.rows[0].fixInRange).toBe(true);
  });

  it("separates names found in the source from names that were not", () => {
    const r = buildWordingCapture({
      area: "a", pass: "evidence",
      evidenceRows: [row({ suggestedAction: "Update the Academic Intervention Form and the Learning Support Register." })],
      sourceFiles: ["a.txt"], sourceText,
    });
    expect(r.rows[0].namesInSource).toContain("Academic Intervention Form");
    expect(r.rows[0].namesNotInSource).toContain("Learning Support Register");
    expect(r.totals.rowsWithNamesNotInSource).toBe(1);
  });

  it("reports the corpus size, so a zero-length corpus cannot pass as a clean check", () => {
    const r = buildWordingCapture({ area: "a", pass: "evidence", evidenceRows: [row()], sourceFiles: [], sourceText: "" });
    expect(r.sourceChars).toBe(0);
    expect(r.note).toContain("the name check means nothing");
  });

  it("counts banned openers across both fields", () => {
    const r = buildWordingCapture({
      area: "a", pass: "evidence",
      evidenceRows: [row({ comment: "Although the PPD documents it, no record exists." })],
      sourceFiles: [], sourceText,
    });
    expect(r.rows[0].whyBannedOpener).toBe("Although");
    expect(r.totals.rowsWithBannedOpener).toBe(1);
  });

  it("names the file it writes", () => {
    expect(captureFilename("Student Learning")).toMatch(/^wording-capture-student-learning-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
