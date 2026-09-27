import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stallState, stallControl, SLOW_AFTER_MS, type RunProgress } from "../selfCheckProgress";

const T0 = 1_700_000_000_000;
const reading = (file: string): RunProgress => ({ heartbeatAt: T0, currentFile: file, canSkipCurrentFile: true });

// The reported failure: a file hangs and the only control on screen is Stop,
// which throws away the whole run over one bad document.
describe("a hung file offers the file, not the run", () => {
  it("offers the file skip and names the file", () => {
    const s = stallState(T0 + SLOW_AFTER_MS, reading("Assessment Results for DBM001.pdf"), T0);
    expect(stallControl(s)).toBe("skip");
    expect(s.level !== "none" && s.controlLabel).toBe("Skip this file");
    expect(s.level !== "none" && s.waitingOn).toContain("Assessment Results for DBM001.pdf");
  });

  it("still offers it once the stall has escalated to stuck, not Stop instead", () => {
    const s = stallState(T0 + 10 * SLOW_AFTER_MS, reading("slow.pdf"), T0);
    expect(s.level).toBe("stuck");
    expect(stallControl(s)).toBe("skip");
  });

  it("falls back to Stop ONLY when there is genuinely nothing narrower", () => {
    // No file in flight and no skippable call: the honest answer, and the copy
    // says so rather than dressing Stop up as a skip.
    const s = stallState(T0 + SLOW_AFTER_MS, { heartbeatAt: T0 }, T0, false);
    expect(stallControl(s)).toBe("cancel");
    expect(s.level !== "none" && s.controlNote).toContain("no way to skip just this step");
  });

  it("prefers the file skip over the call skip when both look available", () => {
    const s = stallState(T0 + SLOW_AFTER_MS, reading("a.pdf"), T0, true);
    expect(stallControl(s)).toBe("skip");
  });
});

// stallControl separates "the panel is showing" from "the panel is offering a
// skip". Conflating the two is what hid a working Skip button behind a
// Stop-only stall.
describe("stallControl", () => {
  it("is null while nothing is stalled", () => {
    expect(stallControl({ level: "none" })).toBeNull();
    expect(stallControl(stallState(T0 + 5_000, { heartbeatAt: T0 }, T0))).toBeNull();
  });
});

describe("the results-and-review pass can be skipped per file too", () => {
  const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
  const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");
  // Bounded by the NEXT action rather than a character count: a fixed window
  // silently stops covering the end of the pass as soon as anything is added
  // to it, which is how this test first failed on a change that did not touch
  // the behaviour it pins.
  const passStart = STORE.indexOf("runOutcomeReviewPass: async");
  const passEnd = STORE.indexOf("applyOutcomeReviewToChecklist", passStart);
  const pass = STORE.slice(passStart, passEnd > passStart ? passEnd : passStart + 30_000);

  it("names the file it is re-reading and marks it skippable", () => {
    expect(pass).toMatch(/currentFile: rec\.name, canSkipCurrentFile: true/);
  });

  it("registers the abort handle, so the Skip button does something", () => {
    // canSkipCurrentFile without _currentFileAbort is a button that does
    // nothing, which is worse than no button.
    expect(pass).toMatch(/_currentFileAbort = resolveSkip;/);
    expect(pass).toMatch(/Promise\.race\(\[/);
  });

  it("bumps a heartbeat, or the stall panel measures from the start of the run", () => {
    // Every progress write in this pass, not just one: a single write without
    // it resets the heartbeat to undefined and the panel fires at once.
    // Whole lines, not brace-matched: the detail strings are template
    // literals, and ${rec.name} closes a brace-counting regex early.
    const writes = pass.split("\n").filter((l) => l.includes("outcomeReviewProgress: { subCriterionId,"));
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w, w).toContain("heartbeatAt");
  });

  it("clears the control when the read ends, either way", () => {
    expect(pass).toMatch(/currentFile: undefined, canSkipCurrentFile: false/);
  });

  it("reaches the page whole, rather than as a two-field stub", () => {
    expect(PAGE).toMatch(/phase === "outcomes" \? \(orProgress \?\? undefined\)/);
  });
});
