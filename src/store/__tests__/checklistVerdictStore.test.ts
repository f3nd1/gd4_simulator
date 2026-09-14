import { describe, it, expect, afterEach } from "vitest";
import { useChecklistVerdictStore, verdictKey, clipAtWord, type StoredChecklistVerdict } from "../useChecklistVerdictStore";

const v = (over: Partial<StoredChecklistVerdict> = {}): StoredChecklistVerdict => ({
  checkId: "6-x", subCriterionId: "6.2", bucket: "policy", verdict: "Met",
  rationale: "r", chunkIds: ["C001"], sourceHash: "h", runAt: "2026-09-14T00:00:00.000Z", path: "A", ...over,
});

afterEach(() => { useChecklistVerdictStore.setState({ entries: {} }); });

describe("key identity", () => {
  // Collapsing any of the three would let an unrelated run silently overwrite
  // an earlier answer: a criterion-wide check is genuinely assessed once per
  // sub-criterion, and the two buckets answer different questions.
  it("keeps check, sub-criterion and bucket separate", () => {
    useChecklistVerdictStore.getState().putRun([
      v(), v({ bucket: "evidence" }), v({ subCriterionId: "6.3" }), v({ checkId: "6-y" }),
    ]);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(4);
    expect(verdictKey("6-x", "6.2", "policy")).toBe("6-x::6.2::policy");
  });

  it("a re-run replaces that key rather than appending a duplicate", () => {
    useChecklistVerdictStore.getState().putRun([v({ verdict: "Not met" })]);
    useChecklistVerdictStore.getState().putRun([v({ verdict: "Met", runId: "R2" })]);
    const entries = useChecklistVerdictStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(1);
    expect(entries[verdictKey("6-x", "6.2", "policy")]).toMatchObject({ verdict: "Met", runId: "R2" });
  });
});

// The old caps (400/300) cut real rationales mid-word, and the full text is
// recoverable nowhere: the checklist pass writes no AI Run Log entry and the
// Prompt Inspector stores system prompts only, never responses.
describe("clipAtWord", () => {
  it("leaves anything within the allowance completely alone", () => {
    expect(clipAtWord("short enough", 50)).toBe("short enough");
    expect(clipAtWord("x".repeat(50), 50)).toBe("x".repeat(50));
  });
  it("ends on a whole word, never inside one", () => {
    const out = clipAtWord("the agenda headings without recording the underlying data", 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("the agenda headings without…");
    expect(out).not.toMatch(/witho…$/);
  });
  it("cuts hard when there is no word break near the end, rather than losing a large tail", () => {
    const out = clipAtWord(`short ${"x".repeat(60)}`, 30);
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });
  // A rationale is "#1 [file · chunk]:\n<note>\n\n#2 …", so the break that saves
  // it from a mid-word cut is often a newline rather than a space.
  it("breaks on a newline as readily as a space (rationales carry both)", () => {
    const out = clipAtWord(`${"x".repeat(90)}\n${"y".repeat(20)}`, 100);
    expect(out).toBe(`${"x".repeat(90)}…`);
  });
  it("never exceeds the allowance", () => {
    for (const n of [10, 25, 100, 2000]) {
      expect(clipAtWord("word ".repeat(2000), n).length).toBeLessThanOrEqual(n);
    }
  });
});

describe("bounded storage", () => {
  // A COMPLETE sweep is 29 sub-criteria x 2 buckets x a median 13 in-scope
  // checks = 754 entries. At the old 500 cap that silently evicted ~254 of the
  // oldest verdicts with nothing on screen saying so.
  it("holds a full workspace sweep without evicting anything", () => {
    const sweep = Array.from({ length: 754 }, (_, i) => v({ checkId: `c${i}` }));
    useChecklistVerdictStore.getState().putRun(sweep);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(754);
  });
  it("still caps, so the store cannot grow without bound", () => {
    useChecklistVerdictStore.getState().putRun(Array.from({ length: 1200 }, (_, i) => v({ checkId: `c${i}` })));
    expect(Object.keys(useChecklistVerdictStore.getState().entries).length).toBeLessThanOrEqual(800);
  });
  it("stores a realistic multi-window rationale in full", () => {
    const rationale = `#1 [QA Manual.pdf · C001]:\n${"A real two-sentence auditor observation. ".repeat(8)}\n\n#2 [Minutes.pdf · C007]:\n${"A second window's observation. ".repeat(8)}`;
    expect(rationale.length).toBeGreaterThan(400); // would have been cut before
    useChecklistVerdictStore.getState().putRun([v({ rationale })]);
    const e = useChecklistVerdictStore.getState().entries[verdictKey("6-x", "6.2", "policy")];
    expect(e.rationale).toBe(rationale);
    expect(e.rationale.endsWith("…")).toBe(false);
  });
  it("clips the free-text fields only past the new allowances", () => {
    useChecklistVerdictStore.getState().putRun([v({ rationale: "word ".repeat(900), quote: "word ".repeat(900) })]);
    const e = useChecklistVerdictStore.getState().entries[verdictKey("6-x", "6.2", "policy")];
    expect(e.rationale.length).toBeLessThanOrEqual(2000);
    expect(e.quote!.length).toBeLessThanOrEqual(1000);
    expect(e.rationale.endsWith("word…")).toBe(true); // whole word, then the marker
  });
  it("keeps the most recently written entries when the cap bites", () => {
    useChecklistVerdictStore.getState().putRun(Array.from({ length: 800 }, (_, i) => v({ checkId: `old${i}` })));
    useChecklistVerdictStore.getState().putRun([v({ checkId: "newest" })]);
    expect(useChecklistVerdictStore.getState().entries[verdictKey("newest", "6.2", "policy")]).toBeDefined();
  });
});

describe("clearing", () => {
  it("clearForSub removes only that sub-criterion's verdicts", () => {
    useChecklistVerdictStore.getState().putRun([v(), v({ subCriterionId: "6.3" })]);
    useChecklistVerdictStore.getState().clearForSub("6.2");
    const left = Object.values(useChecklistVerdictStore.getState().entries);
    expect(left).toHaveLength(1);
    expect(left[0].subCriterionId).toBe("6.3");
  });
  it("an empty run writes nothing rather than clearing what is there", () => {
    useChecklistVerdictStore.getState().putRun([v()]);
    useChecklistVerdictStore.getState().putRun([]);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(1);
  });
});
