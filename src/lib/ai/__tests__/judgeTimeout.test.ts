import { describe, it, expect } from "vitest";
import { judgeTimeoutMs, JUDGE_TIMEOUT_CAP_MS } from "../agentRuntime";

// The Option A two-pass JUDGE call (PPD review + evidence assessment second
// pass) was timing out at a flat 90s on larger folders (6.1 Option A, 6
// files incl. big oversight/mapping PDFs) — the pooled verified passages
// make its prompt grow with folder size. judgeTimeoutMs scales the ceiling
// with that prompt size, floored at the 90s base and hard-capped so a
// runaway prompt still fails with the honest timeout diagnostic, never
// hangs or silently degrades.
describe("judgeTimeoutMs — adaptive Option A judge-call timeout", () => {
  it("keeps the 90s base for small prompts (no needless waiting on small folders)", () => {
    expect(judgeTimeoutMs(0)).toBe(90_000);
    expect(judgeTimeoutMs(500)).toBe(90_000);
    expect(judgeTimeoutMs(9_999)).toBe(90_000);
  });

  it("scales up in +30s steps per 10k prompt chars", () => {
    expect(judgeTimeoutMs(10_000)).toBe(120_000);
    expect(judgeTimeoutMs(25_000)).toBe(150_000); // 90k + 2×30k
    expect(judgeTimeoutMs(40_000)).toBe(210_000); // 90k + 4×30k
  });

  it("never exceeds the hard cap, however large the prompt", () => {
    expect(judgeTimeoutMs(1_000_000)).toBe(JUDGE_TIMEOUT_CAP_MS);
    expect(judgeTimeoutMs(Number.MAX_SAFE_INTEGER)).toBe(JUDGE_TIMEOUT_CAP_MS);
    expect(judgeTimeoutMs(10_000_000)).toBeLessThanOrEqual(JUDGE_TIMEOUT_CAP_MS);
  });

  it("is monotonic — a bigger prompt never yields a shorter timeout", () => {
    let prev = 0;
    for (let chars = 0; chars <= 400_000; chars += 7_000) {
      const t = judgeTimeoutMs(chars);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});
