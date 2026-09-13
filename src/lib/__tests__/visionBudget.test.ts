import { describe, it, expect } from "vitest";
import { visionBudgetSkipNote } from "../visionBudget";

describe("visionBudgetSkipNote", () => {
  it("leads with a neutral status, not a failed read", () => {
    const note = visionBudgetSkipNote("pdf", 30, true);
    expect(note.startsWith("Skipped for now")).toBe(true);
    expect(note).not.toContain("read attempted");
    expect(note).not.toContain("Recoverable");
  });

  it("only offers 'Proceed with all' when that prompt is actually on screen", () => {
    expect(visionBudgetSkipNote("pdf", 30, true)).toContain('Click "Proceed with all"');
    const noPrompt = visionBudgetSkipNote("pdf", 30, false);
    expect(noPrompt).not.toContain("Proceed with all");
    expect(noPrompt).toContain("Re-run to read it.");
  });

  it("names the file kind and the real budget number", () => {
    expect(visionBudgetSkipNote("pdf", 30, false)).toContain("30-image vision budget");
    expect(visionBudgetSkipNote("pdf", 12, false)).toContain("12-image vision budget");
    expect(visionBudgetSkipNote("pdf", 30, false)).toContain("scanned PDF");
    expect(visionBudgetSkipNote("image", 30, false)).toContain("image was read");
  });
});
