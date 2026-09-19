import { describe, it, expect } from "vitest";
import { lineProgress, nowDoing, failureLines, linePassLabel, type RunProgress } from "../selfCheckProgress";

const P = (over: Partial<RunProgress> = {}): RunProgress => ({
  lineRefs: ["6.3.1.DS1", "6.3.1.DS2", "6.3.1.DS3"],
  lineStatus: { "6.3.1.DS1": "done", "6.3.1.DS2": "assessing" },
  ...over,
});

describe("lineProgress — where each line has got to", () => {
  it("counts and labels every line, with no verdict anywhere", () => {
    const lp = lineProgress(P())!;
    expect(lp).toMatchObject({ total: 3, checked: 1, checking: 1, waiting: 1 });
    expect(lp.lines.map((l) => l.state)).toEqual(["checked", "checking", "waiting"]);
    // The shape carries a ref and a state, and nothing that could be read as
    // a judgement: the mid-run verdict is not the final one.
    for (const l of lp.lines) expect(Object.keys(l).sort()).toEqual(["ref", "state"]);
  });

  it("is null before the run knows its lines, rather than showing 0 of 0", () => {
    expect(lineProgress(undefined)).toBeNull();
    expect(lineProgress({})).toBeNull();
  });

  it("never moves a line backwards within one pass", () => {
    // "done" wins over anything the next window says about the same ref.
    const lp = lineProgress(P({ lineStatus: { "6.3.1.DS1": "done" } }))!;
    expect(lp.lines[0].state).toBe("checked");
  });
});

describe("linePassLabel — whose count this is", () => {
  it("names the pass, because the two keep separate line maps", () => {
    // Measured live: without this the board read "13 checked" and then "13
    // still to do" as the run moved from the procedure to the records, which
    // looks like the check undoing its own work.
    expect(linePassLabel("policy")).toBe("Against your written procedure");
    expect(linePassLabel("records")).toBe("Against your records");
    expect(linePassLabel("band")).toBe("Against your records");
    expect(linePassLabel("outcomes")).toBe("Requirements");
  });
});

describe("nowDoing — what the call in flight is for", () => {
  it("says reading during the extract pass and deciding during the judge pass", () => {
    expect(nowDoing(P({ currentRefs: ["6.3.1.DS2"], passStage: "extract" }))!.verb).toMatch(/Reading your documents/);
    expect(nowDoing(P({ currentRefs: ["6.3.1.DS2"], passStage: "judge" }))!.verb).toMatch(/Deciding/);
  });

  it("is null with no call in flight, rather than guessing", () => {
    expect(nowDoing(P())).toBeNull();
    expect(nowDoing(undefined)).toBeNull();
  });
});

describe("failureLines — the thing a reader most needs to see", () => {
  it("takes only the engine's own bad entries, most recent first cap", () => {
    const log = [
      { at: 1, text: "Assessed 6.3.1.DS1", tone: "good" as const },
      { at: 2, text: "Batch failed for 6.3.1.DS2 — 400", tone: "bad" as const },
      { at: 3, text: "Reading a file", tone: "info" as const },
      { at: 4, text: "Batch failed for 6.3.1.DS3 — timeout", tone: "bad" as const },
    ];
    const f = failureLines(P({ log }));
    expect(f.rows).toEqual(["Batch failed for 6.3.1.DS2 — 400", "Batch failed for 6.3.1.DS3 — timeout"]);
    expect(f.more).toBe(0);
  });

  it("caps the list and says how many it is not showing", () => {
    const log = Array.from({ length: 7 }, (_, i) => ({ at: i, text: `fail ${i}`, tone: "bad" as const }));
    const f = failureLines(P({ log }), 4);
    expect(f.rows).toHaveLength(4);
    expect(f.rows[3]).toBe("fail 6");
    expect(f.more).toBe(3);
  });

  it("is empty on a clean run", () => {
    expect(failureLines(P({ log: [{ at: 1, text: "ok", tone: "good" }] }))).toEqual({ rows: [], more: 0 });
  });
});
