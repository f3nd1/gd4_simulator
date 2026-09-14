// Phase 2 run-lifecycle invariants.
//
// isStaleRun: the full-audit sweep's per-item timeout deliberately does NOT
// bump auditRunToken (that is the user-cancel signal and would end the whole
// sweep), so a timed-out run used to have no way to know it was dead.
//
// abortCause: the staged read loop tested `signal.aborted` BEFORE the
// FILE_TIMEOUT sentinel, and the timeout handler aborts before it rejects, so
// every system timeout was written to the file ledger as "Skipped by user" and
// the "Timed out after Xs" branch was unreachable. The ledger is exported to
// CSV, so that is a data-integrity bug, not a wording one.
import { describe, it, expect } from "vitest";
import { isStaleRun } from "../runGeneration";
import { abortReason, abortCauseOf, skipReasonForAbort, skipReasonForCause } from "../abortCause";

describe("isStaleRun", () => {
  it("is false for the run the app is still waiting on", () => {
    expect(isStaleRun(3, 3, { aborted: false })).toBe(false);
    expect(isStaleRun(0, 0)).toBe(false);
  });
  it("is true once the sweep bumped the generation past this run", () => {
    expect(isStaleRun(3, 4, { aborted: false })).toBe(true);
  });
  it("is true when this run's own controller was aborted (user cancel)", () => {
    expect(isStaleRun(3, 3, { aborted: true })).toBe(true);
  });
});

describe("abort causes survive the AbortSignal", () => {
  it("round-trips every cause through the signal reason", () => {
    for (const cause of ["user-skip", "run-cancel", "timeout", "sweep-timeout"] as const) {
      expect(abortCauseOf(abortReason(cause, "x"))).toBe(cause);
    }
  });
  it("returns null for an abort with no cause attached", () => {
    expect(abortCauseOf(undefined)).toBeNull();
    expect(abortCauseOf(new Error("boom"))).toBeNull();
  });
});

describe("skipReasonForAbort — a system timeout is never recorded as a user skip", () => {
  it("reports a timeout abort as a timeout even though the signal is also aborted", () => {
    const signal = abortReason("timeout", "FILE_TIMEOUT");
    expect(skipReasonForAbort(signal, new Error("FILE_TIMEOUT"), 30)).toBe("Timed out after 30s");
  });
  it("reports a run cancel and a sweep timeout distinctly from a user skip", () => {
    expect(skipReasonForAbort(abortReason("run-cancel", "x"), null, 30)).toMatch(/cancelled/);
    expect(skipReasonForAbort(abortReason("sweep-timeout", "x"), null, 30)).toMatch(/full-audit time limit/);
    expect(skipReasonForAbort(abortReason("user-skip", "x"), null, 30)).toBe("Skipped by user");
  });
  it("still honours the FILE_TIMEOUT sentinel when no cause was attached", () => {
    expect(skipReasonForAbort(undefined, new Error("FILE_TIMEOUT"), 45)).toBe("Timed out after 45s");
  });
  it("falls back to a user skip only when nothing else is known", () => {
    expect(skipReasonForAbort(undefined, undefined, 30)).toBe("Skipped by user");
  });
  it("skipReasonForCause covers every cause (no silent default)", () => {
    const seen = (["user-skip", "run-cancel", "timeout", "sweep-timeout"] as const).map((c) => skipReasonForCause(c, 30));
    expect(new Set(seen).size).toBe(4);
    expect(seen.every((s) => s.length > 10)).toBe(true);
  });
});
