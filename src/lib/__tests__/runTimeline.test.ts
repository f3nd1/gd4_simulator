import { describe, it, expect } from "vitest";
import { buildRunTimeline, formatMs } from "../runTimeline";

const at = (ms: number, text: string) => ({ at: 1_000_000 + ms, text });

describe("buildRunTimeline", () => {
  it("reports each step as the gap since the previous entry", () => {
    const t = buildRunTimeline([at(0, "Listing"), at(2_000, "Read A"), at(12_000, "Read B")]);
    expect(t.steps.map((s) => s.deltaMs)).toEqual([0, 2_000, 10_000]);
    expect(t.steps.map((s) => s.offsetMs)).toEqual([0, 2_000, 12_000]);
    expect(t.spanMs).toBe(12_000);
  });

  it("marks the single slowest step", () => {
    const t = buildRunTimeline([at(0, "a"), at(1_000, "b"), at(20_000, "c"), at(21_000, "d")]);
    expect(t.steps.filter((s) => s.slowest).map((s) => s.text)).toEqual(["c"]);
  });

  it("marks nothing when the longest step is tied — an arbitrary pick would mislead", () => {
    const t = buildRunTimeline([at(0, "a"), at(5_000, "b"), at(10_000, "c")]);
    expect(t.steps.some((s) => s.slowest)).toBe(false);
  });

  it("sorts out-of-order entries rather than reporting negative steps", () => {
    const t = buildRunTimeline([at(5_000, "second"), at(0, "first")]);
    expect(t.steps.map((s) => s.text)).toEqual(["first", "second"]);
    expect(t.steps.every((s) => s.deltaMs >= 0)).toBe(true);
  });

  it("survives a missing, empty or malformed log", () => {
    expect(buildRunTimeline(undefined)).toEqual({ steps: [], spanMs: 0 });
    expect(buildRunTimeline([])).toEqual({ steps: [], spanMs: 0 });
    // Stored state is whatever was written years ago, not what the type says.
    const hostile = [null, { at: "nope", text: "x" }, { at: NaN, text: "y" }, { at: 5, text: 7 }] as never;
    expect(buildRunTimeline(hostile).steps).toEqual([]);
  });
});

describe("formatMs", () => {
  it("scales from milliseconds to minutes", () => {
    expect(formatMs(120)).toBe("120ms");
    expect(formatMs(1_400)).toBe("1.4s");
    expect(formatMs(125_000)).toBe("2m 05s");
  });
});
