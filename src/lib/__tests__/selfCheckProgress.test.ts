import { describe, it, expect } from "vitest";
import {
  formatElapsed, tallyFiles, fileStageSummary, activityLine, countedFor,
  stallState, SLOW_AFTER_MS, STUCK_AFTER_MS, type RunProgress,
} from "../selfCheckProgress";
import type { AuditFileRecord } from "../../types";

const file = (name: string, readStatus: AuditFileRecord["readStatus"]): AuditFileRecord => ({
  path: name, name, mimeType: "text/plain", fileKind: "text", bucket: "evidence",
  readStatus, auditStatus: "pending",
});

describe("elapsed time", () => {
  it("counts in seconds, then minutes", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(83_000)).toBe("1m 23s");
    expect(formatElapsed(600_000)).toBe("10m 00s");
  });
  it("never goes negative on a clock skew", () => {
    expect(formatElapsed(-5000)).toBe("0s");
  });
});

// A file that was never read must not vanish into a count that implies it was.
describe("skipped and unreadable files are counted AND named", () => {
  const files = [file("Policy.docx", "read"), file("Scan.pdf", "skipped"), file("Broken.xlsx", "failed"), file("Log.txt", "condensed")];

  it("tallies each state separately", () => {
    const t = tallyFiles(files);
    expect(t).toMatchObject({ read: 2, skipped: 1, failed: 1, total: 4 });
    expect(t.skippedNames).toEqual(["Scan.pdf", "Broken.xlsx"]);
  });

  it("names them in the completed-stage summary", () => {
    const s = fileStageSummary(files);
    expect(s).toContain("2 files read");
    expect(s).toContain("1 skipped");
    expect(s).toContain("1 could not be read");
    expect(s).toContain("Scan.pdf");
    expect(s).toContain("Broken.xlsx");
  });

  it("reads naturally when nothing was missed", () => {
    expect(fileStageSummary([file("a.txt", "read"), file("b.txt", "read")])).toBe("2 files read");
    expect(fileStageSummary([file("a.txt", "read")])).toBe("1 file read");
  });

  it("says nothing at all when there were no files", () => {
    expect(fileStageSummary([])).toBe("");
    expect(fileStageSummary(undefined)).toBe("");
  });
});

describe("the activity line names the actual thing in progress", () => {
  it("names the file and its position", () => {
    const p: RunProgress = { currentFile: "Intervention Log.xlsx", filesTotal: 7, filesFound: [file("a", "read"), file("b", "read")] };
    expect(activityLine("records", p)).toBe("Reading Intervention Log.xlsx (file 3 of 7)");
  });
  it("falls back to the file name alone when no total is known", () => {
    expect(activityLine("records", { currentFile: "A.pdf" })).toBe("Reading A.pdf");
  });
  it("names the document part once reading is over", () => {
    expect(activityLine("records", { window: { current: 2, total: 5 } })).toBe("Working through your documents (part 2 of 5)");
  });
  it("names the requirement in preference to a single document part", () => {
    expect(activityLine("records", {
      window: { current: 1, total: 1 },
      lineRefs: ["a", "b", "c", "d"], lineStatus: { a: "done", b: "waiting", c: "waiting", d: "waiting" },
    })).toBe("Checking requirement 2 of 4");
  });
  it("does not run past the last requirement", () => {
    expect(activityLine("records", { lineRefs: ["a", "b"], lineStatus: { a: "done", b: "done" } })).toBe("Checking requirement 2 of 2");
  });
  it("returns nothing when the run genuinely cannot say, so the caller can say Still working", () => {
    expect(activityLine("folder", { heartbeatAt: 1 })).toBe("");
    expect(activityLine("band", { heartbeatAt: 1 })).toBe("");
    expect(activityLine("records", undefined)).toBe("");
  });
});

describe("percentages come only from a counted denominator", () => {
  it("gives NO percentage to the two stages that count nothing", () => {
    const rich: RunProgress = { currentFile: "a", filesTotal: 4, window: { current: 1, total: 2 } };
    expect(countedFor("folder", rich)).toBeNull();
    expect(countedFor("band", rich)).toBeNull();
  });

  it("counts files read of filesTotal", () => {
    expect(countedFor("records", { currentFile: "c", filesTotal: 4, filesFound: [file("a", "read"), file("b", "skipped")] }))
      .toEqual({ done: 2, total: 4, pct: 50 });
  });

  it("counts windows, and starts a window at its own beginning not its end", () => {
    expect(countedFor("records", { window: { current: 1, total: 4 } })).toEqual({ done: 0, total: 4, pct: 0 });
    expect(countedFor("records", { window: { current: 4, total: 4 } })).toEqual({ done: 3, total: 4, pct: 75 });
  });

  // A bar that can only ever read 0% is the same defect as one parked at 99%.
  it("gives NO percentage when the denominator is 1, because it could never move", () => {
    expect(countedFor("records", { window: { current: 1, total: 1 } })).toBeNull();
    expect(countedFor("records", { currentFile: "a", filesTotal: 1, filesFound: [] })).toBeNull();
    expect(countedFor("records", { lineRefs: ["a"], lineStatus: { a: "waiting" } })).toBeNull();
  });

  // Requirement lines move where a single document part never would.
  it("prefers the finer counter when both exist", () => {
    expect(countedFor("records", {
      window: { current: 1, total: 1 },
      lineRefs: ["a", "b", "c", "d"], lineStatus: { a: "done", b: "waiting", c: "waiting", d: "waiting" },
    })).toEqual({ done: 1, total: 4, pct: 25 });
  });

  it("counts finished requirement lines", () => {
    expect(countedFor("records", { lineRefs: ["a", "b", "c", "d"], lineStatus: { a: "done", b: "done", c: "assessing", d: "waiting" } }))
      .toEqual({ done: 2, total: 4, pct: 50 });
  });

  it("returns null rather than 0% when there is nothing to count", () => {
    expect(countedFor("records", {})).toBeNull();
    expect(countedFor("records", { lineRefs: [], lineStatus: {} })).toBeNull();
    expect(countedFor("records", { window: { current: 1, total: 0 } })).toBeNull();
  });

  it("never exceeds 100 by construction", () => {
    expect(countedFor("records", { lineRefs: ["a", "b"], lineStatus: { a: "done", b: "done" } }))
      .toEqual({ done: 2, total: 2, pct: 100 });
  });
});

// The history this exists for: a run that appeared stuck for six hours behind an
// invisible blocking prompt.
describe("stall detection", () => {
  const T0 = 1_000_000;

  it("stays quiet while events keep arriving", () => {
    expect(stallState(T0 + 5_000, { heartbeatAt: T0 }, T0).level).toBe("none");
    expect(stallState(T0 + SLOW_AFTER_MS - 1, { heartbeatAt: T0 }, T0).level).toBe("none");
  });

  it("flags slow after 60 seconds of silence", () => {
    expect(stallState(T0 + SLOW_AFTER_MS, { heartbeatAt: T0 }, T0).level).toBe("slow");
  });

  it("escalates to stuck after 5 minutes", () => {
    expect(stallState(T0 + STUCK_AFTER_MS, { heartbeatAt: T0 }, T0).level).toBe("stuck");
  });

  it("offers the REAL skip when a file read is what is hanging, and names the file", () => {
    const s = stallState(T0 + SLOW_AFTER_MS, { heartbeatAt: T0, canSkipCurrentFile: true, currentFile: "Big Scan.pdf" }, T0);
    if (s.level === "none") throw new Error("expected a stall");
    expect(s.control).toBe("skip");
    expect(s.waitingOn).toContain("Big Scan.pdf");
    expect(s.controlLabel).toBe("Skip this file");
  });

  it("offers ONLY cancel when an AI call is what is hanging, and never calls it a skip", () => {
    const s = stallState(T0 + SLOW_AFTER_MS, { heartbeatAt: T0 }, T0);
    if (s.level === "none") throw new Error("expected a stall");
    expect(s.control).toBe("cancel");
    expect(s.controlLabel).toBe("Stop the check");
    expect(s.controlLabel.toLowerCase()).not.toContain("skip");
    expect(s.controlNote).toContain("no way to skip just this step");
  });

  it("measures from the run start when no event has ever fired", () => {
    expect(stallState(T0 + SLOW_AFTER_MS, undefined, T0).level).toBe("slow");
    expect(stallState(T0 + 1_000, undefined, T0).level).toBe("none");
  });
});
