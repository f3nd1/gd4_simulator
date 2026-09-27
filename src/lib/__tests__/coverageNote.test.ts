import { describe, it, expect } from "vitest";
import { windowCoverageNote } from "../coverageNote";

const base = { label: "Evidence", windowsProcessed: 5, windowsTotal: 5, docChars: 250_000, notAssessedLines: 0, totalLines: 12 };

describe("windowCoverageNote", () => {
  it("says nothing when every window was searched and every line judged", () => {
    expect(windowCoverageNote(base)).toBeUndefined();
  });

  it("says nothing when there were no windows at all (no documents)", () => {
    expect(windowCoverageNote({ ...base, windowsTotal: 0, windowsProcessed: 0 })).toBeUndefined();
  });

  it("reports unsearched windows as text never looked at", () => {
    const note = windowCoverageNote({ ...base, windowsProcessed: 3, stoppedEarly: true });
    expect(note).toContain("3 of 5 sliding windows");
    expect(note).toContain("2 windows were not searched because the run was stopped");
    expect(note).toContain("never looked at");
  });

  it("separates unjudged lines from gaps", () => {
    const note = windowCoverageNote({ ...base, notAssessedLines: 2 });
    expect(note).toContain("2 of 12 requirement lines ended Not assessed");
    expect(note).toContain("missing judgements, not gaps");
  });

  it("singularises one window and one line", () => {
    const note = windowCoverageNote({ ...base, windowsTotal: 1, windowsProcessed: 0, totalLines: 1, notAssessedLines: 1 });
    expect(note).toContain("0 of 1 sliding window ");
    expect(note).toContain("1 window was not searched");
    expect(note).toContain("1 of 1 requirement line ended");
  });
});
