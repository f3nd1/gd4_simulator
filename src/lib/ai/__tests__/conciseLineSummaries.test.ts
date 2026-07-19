import { describe, it, expect } from "vitest";
import { runConciseLineSummaries } from "../narrativeWriter";
import type { NarrativeInput } from "../narrativeWriter";

// The only deterministic branch (no network): when no row is long enough to
// need condensing, runConciseLineSummaries short-circuits to null BEFORE any
// AI call. The full generate + honesty-filter path is exercised live in the
// Playwright verification (mocked OpenAI). Short Approach/Processes-style rows
// must never trigger a call — they already read as one sentence.
function inputWith(finding: string): NarrativeInput {
  return {
    id: "6.1.1",
    title: "Internal Assessment",
    band: 3,
    findingsGroups: [
      {
        key: "approach", label: "Approach", band: 3, pct: 15, rubricDefined: 1,
        rows: [{ lineId: "L1", itemRef: "6.1.1.DS1.a", verdict: "strength", finding }],
      },
    ],
  };
}

describe("runConciseLineSummaries — no-qualifying-row gate", () => {
  it("returns null (no AI call) when the only row is a short single note", async () => {
    const res = await runConciseLineSummaries(inputWith("Documented, because the PPD names the responsible role and cadence."), {} as never);
    expect(res).toBeNull();
  });

  it("returns null when there are no rows at all", async () => {
    const empty: NarrativeInput = { id: "6.1.1", title: "x", band: 3, findingsGroups: [] };
    const res = await runConciseLineSummaries(empty, {} as never);
    expect(res).toBeNull();
  });
});
