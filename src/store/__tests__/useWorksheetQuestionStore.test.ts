import { describe, it, expect, afterEach } from "vitest";
import {
  useWorksheetQuestionStore,
  questionSourceHash,
  questionStateFor,
  type StoredQuestion,
} from "../useWorksheetQuestionStore";

afterEach(() => { useWorksheetQuestionStore.setState({ entries: {} }); });

const asks = (d: string) => [{ describe: d, showMe: "" }];
const q = (text: string, over: Partial<StoredQuestion> = {}): StoredQuestion => ({
  asks: asks("generated"), sourceHash: questionSourceHash(text), generatedAt: "2026-09-14T00:00:00.000Z", ...over,
});

describe("questionStateFor", () => {
  it("reports missing when nothing has been generated", () => {
    expect(questionStateFor(undefined, "check")).toBe("missing");
  });

  it("reports current while the check text is unchanged", () => {
    expect(questionStateFor(q("check"), "check")).toBe("current");
  });

  it("reports stale the moment the check text changes", () => {
    expect(questionStateFor(q("check"), "check EDITED")).toBe("stale");
  });

  it("keeps a hand-edited question distinguishable, fresh or stale", () => {
    expect(questionStateFor(q("check", { edited: true }), "check")).toBe("edited");
    expect(questionStateFor(q("check", { edited: true }), "check EDITED")).toBe("edited-stale");
  });
});

describe("putMany", () => {
  it("stores generated questions against the check id", () => {
    useWorksheetQuestionStore.getState().putMany({ a: q("t") });
    expect(useWorksheetQuestionStore.getState().entries.a.asks[0].describe).toBe("generated");
  });

  it("NEVER overwrites a hand-edited question, so a bulk regeneration cannot silently undo a rewording", () => {
    useWorksheetQuestionStore.getState().setEdited("a", asks("my own wording"), questionSourceHash("t"));
    useWorksheetQuestionStore.getState().putMany({ a: q("t") });
    const stored = useWorksheetQuestionStore.getState().entries.a;
    expect(stored.asks[0].describe).toBe("my own wording");
    expect(stored.edited).toBe(true);
  });

  it("caps stored entries so the synced blob cannot grow without bound", () => {
    const big: Record<string, StoredQuestion> = {};
    for (let i = 0; i < 800; i++) big[`k${i}`] = q(`t${i}`);
    useWorksheetQuestionStore.getState().putMany(big);
    const entries = useWorksheetQuestionStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(600);
    expect(entries.k799).toBeDefined();
    expect(entries.k0).toBeUndefined();
  });
});

describe("setEdited", () => {
  it("re-stamps the source hash, so saving against the current wording clears stale", () => {
    useWorksheetQuestionStore.getState().putMany({ a: q("old") });
    expect(questionStateFor(useWorksheetQuestionStore.getState().entries.a, "new")).toBe("stale");

    useWorksheetQuestionStore.getState().setEdited("a", asks("mine"), questionSourceHash("new"));
    expect(questionStateFor(useWorksheetQuestionStore.getState().entries.a, "new")).toBe("edited");
  });
});

describe("remove", () => {
  it("drops one question, so regenerating it starts clean", () => {
    useWorksheetQuestionStore.getState().putMany({ a: q("t"), b: q("t") });
    useWorksheetQuestionStore.getState().remove("a");
    expect(useWorksheetQuestionStore.getState().entries.a).toBeUndefined();
    expect(useWorksheetQuestionStore.getState().entries.b).toBeDefined();
  });
});
