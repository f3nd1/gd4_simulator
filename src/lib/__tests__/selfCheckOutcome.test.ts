import { describe, it, expect } from "vitest";
import { outcomePassGate, outcomeDimensionState, outcomePassTally, NOT_RUN_REASON } from "../selfCheckOutcome";

// The guard exists because "Not evident" IS Band 1 downstream — there is no
// "not assessed" value in the ApsrBreakdown unions. Every refusal below is a
// case where letting the pass run would publish a Band 1 about records nobody
// managed to open.
describe("the Outcomes & Review gate", () => {
  it("runs the pass when at least one record was actually read", () => {
    expect(outcomePassGate({ listed: 4, read: 4 })).toEqual({ run: true });
    expect(outcomePassGate({ listed: 9, read: 1, failed: ["a.pdf", "b.pdf"] })).toEqual({ run: true });
  });

  it("refuses when the run opened no records at all", () => {
    const g = outcomePassGate({ listed: 0, read: 0 });
    expect(g.run).toBe(false);
    expect(g.run === false && g.reason).toMatch(/opened no records/i);
  });

  // THE case: a records folder that lists files and fails to read every one of
  // them looks like a working folder from the outside. It must be gated exactly
  // as hard as an empty one.
  it("refuses when the records folder lists files but every single one fails to read", () => {
    const g = outcomePassGate({ listed: 6, read: 0, failed: ["KPI 2025.pdf", "minutes.docx", "CAP log.xlsx", "d.pdf"] });
    expect(g.run).toBe(false);
    const reason = g.run === false ? g.reason : "";
    expect(reason).toMatch(/6 files/);
    expect(reason).toMatch(/none of them could be read/i);
    // Names what failed, so the reason is checkable rather than an assertion.
    expect(reason).toContain("KPI 2025.pdf");
    expect(reason).toMatch(/and others/);
    // Never phrased as a finding about the area.
    expect(reason).toMatch(/left unassessed rather than marked down/);
    expect(reason).not.toMatch(/not evident|no outcome data|band/i);
  });

  it("reads naturally for a single unreadable record", () => {
    const g = outcomePassGate({ listed: 1, read: 0, failed: ["scan.pdf"] });
    const reason = g.run === false ? g.reason : "";
    expect(reason).toMatch(/1 file in it/);
    expect(reason).toMatch(/none of it could be read/i);
    expect(reason).not.toMatch(/and others/);
  });

  // The count comes from a real extraction, but a negative or nonsense count
  // must never be read as "something was read".
  it("treats a non-positive read count as nothing read", () => {
    expect(outcomePassGate({ listed: 3, read: 0 }).run).toBe(false);
    expect(outcomePassGate({ listed: 3, read: -1 }).run).toBe(false);
  });

  // The policy folder is not a substitute. A run that read the written
  // procedure and none of the records has not looked at what these two
  // dimensions are judged on, and the gate counts records only.
  it("counts records, so a readable policy folder cannot license the pass", () => {
    // listed/read here are already records-only by construction; this pins the
    // contract that the caller must not pass policy files in.
    expect(outcomePassGate({ listed: 2, read: 0, failed: ["log.xlsx", "minutes.docx"] }).run).toBe(false);
  });
});

describe("what the page says about the two dimensions", () => {
  it("says not run when there is no stored pass at all", () => {
    expect(outcomeDimensionState(undefined)).toEqual({ state: "not-run", reason: NOT_RUN_REASON });
  });

  it("names the stored reason when the records could not be read", () => {
    const s = outcomeDimensionState({ rows: [], skippedReason: "none of them could be read" });
    expect(s.state).toBe("not-read");
    expect(s.reason).toBe("none of them could be read");
  });

  // A result carrying rows is the only thing that licenses showing a negative
  // finding as a fact about the area.
  it("only reports assessed when the pass produced rows", () => {
    expect(outcomeDimensionState({ rows: [{}, {}] }).state).toBe("assessed");
    expect(outcomeDimensionState({ rows: [] }).state).toBe("not-read");
    expect(outcomeDimensionState({}).state).toBe("not-read");
  });

  it("a skipped reason wins over rows that somehow survived", () => {
    expect(outcomeDimensionState({ rows: [{}], skippedReason: "no records read" }).state).toBe("not-read");
  });
});

describe("what the pass found, as counts", () => {
  it("counts only explicit trues, so a missing field is never a find", () => {
    const t = outcomePassTally([
      { outcomeEvident: true, reviewEvident: true },
      { outcomeEvident: false, reviewEvident: true },
      { reviewEvident: true },
      {},
    ]);
    expect(t).toEqual({ total: 4, withOutcome: 1, withReview: 3 });
  });

  it("is empty-safe", () => {
    expect(outcomePassTally(undefined)).toEqual({ total: 0, withOutcome: 0, withReview: 0 });
    expect(outcomePassTally([])).toEqual({ total: 0, withOutcome: 0, withReview: 0 });
  });
});
