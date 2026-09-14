import { describe, it, expect, afterEach } from "vitest";
import {
  useWorksheetQuestionStore,
  questionSourceHash,
  questionStateFor,
  type StoredQuestion,
} from "../useWorksheetQuestionStore";
import { newQuestionId, type AskType, type WorksheetQuestion } from "../../lib/manualWorksheet";
import { WORKSHEET_PROMPT_VERSION } from "../../lib/ai/worksheetWriter";

afterEach(() => { useWorksheetQuestionStore.setState({ entries: {} }); });

const st = () => useWorksheetQuestionStore.getState();
const q = (text: string, source: "ai" | "hand" = "ai", askType: AskType = "Document"): WorksheetQuestion =>
  ({ id: newQuestionId(), text, askType, source });
// Written by the CURRENT prompt unless a test says otherwise, so the
// prompt-version badge only fires where a test is exercising it.
const entry = (text: string, questions: WorksheetQuestion[], over: Partial<StoredQuestion> = {}): StoredQuestion =>
  ({ questions, sourceHash: questionSourceHash(text), generatedAt: "2026-09-14T00:00:00.000Z", promptVersion: WORKSHEET_PROMPT_VERSION, ...over });

describe("questionStateFor", () => {
  it("reports missing, current and stale from the source hash", () => {
    expect(questionStateFor(undefined, "c")).toBe("missing");
    expect(questionStateFor(entry("c", [q("x")]), "c")).toBe("current");
    expect(questionStateFor(entry("c", [q("x")]), "c EDITED")).toBe("stale");
  });

  it("keeps a hand-touched check distinguishable, fresh or stale", () => {
    expect(questionStateFor(entry("c", [q("x", "hand")], { edited: true }), "c")).toBe("edited");
    expect(questionStateFor(entry("c", [q("x", "hand")], { edited: true }), "c EDITED")).toBe("edited-stale");
  });
});

describe("putMany — regeneration", () => {
  it("replaces the AI questions on a check", () => {
    st().putMany({ a: { questions: [q("old one"), q("old two")], sourceHash: "h1" } });
    st().putMany({ a: { questions: [q("new")], sourceHash: "h2" } });
    expect(st().entries.a.questions.map((x) => x.text)).toEqual(["new"]);
  });

  it("KEEPS every hand question and puts it first, so regeneration cannot undo Felix's work", () => {
    st().putMany({ a: { questions: [q("ai one")], sourceHash: "h1" } });
    st().addQuestion("a", "my own question", "Process", "h1");
    st().putMany({ a: { questions: [q("fresh ai")], sourceHash: "h2" } });

    const texts = st().entries.a.questions.map((x) => x.text);
    expect(texts).toEqual(["my own question", "fresh ai"]);
    expect(texts).not.toContain("ai one");
  });

  it("keeps a question the user reworded, because editing makes it hand-sourced", () => {
    st().putMany({ a: { questions: [q("ai wording")], sourceHash: "h1" } });
    const id = st().entries.a.questions[0].id;
    st().editQuestion("a", id, "my wording", "Process");
    st().putMany({ a: { questions: [q("regenerated")], sourceHash: "h2" } });

    const qs = st().entries.a.questions;
    expect(qs.map((x) => x.text)).toEqual(["my wording", "regenerated"]);
    expect(qs[0].source).toBe("hand");
    expect(qs[0].askType).toBe("Process");
  });
});

describe("hand editing", () => {
  it("adds a question to a check that has none", () => {
    st().addQuestion("a", "first", "Document", "h1");
    expect(st().entries.a.questions).toHaveLength(1);
    expect(st().entries.a.questions[0].source).toBe("hand");
  });

  it("removes one question and leaves the rest", () => {
    st().putMany({ a: { questions: [q("one"), q("two")], sourceHash: "h1" } });
    st().removeQuestion("a", st().entries.a.questions[0].id);
    expect(st().entries.a.questions.map((x) => x.text)).toEqual(["two"]);
  });

  it("reorders questions, and will not move one off either end", () => {
    st().putMany({ a: { questions: [q("one"), q("two"), q("three")], sourceHash: "h1" } });
    const ids = st().entries.a.questions.map((x) => x.id);
    st().moveQuestion("a", ids[2], -1);
    expect(st().entries.a.questions.map((x) => x.text)).toEqual(["one", "three", "two"]);
    st().moveQuestion("a", ids[0], -1);
    expect(st().entries.a.questions.map((x) => x.text)).toEqual(["one", "three", "two"]);
  });

  it("caps stored entries so the synced blob cannot grow without bound", () => {
    const big: Record<string, { questions: WorksheetQuestion[]; sourceHash: string }> = {};
    for (let i = 0; i < 800; i++) big[`k${i}`] = { questions: [q(`t${i}`)], sourceHash: "h" };
    st().putMany(big);
    expect(Object.keys(st().entries)).toHaveLength(600);
    expect(st().entries.k799).toBeDefined();
    expect(st().entries.k0).toBeUndefined();
  });
});

describe("v1 → v2 migration", () => {
  const v1 = {
    entries: {
      ai: { asks: [{ describe: "Describe how you reconcile.", showMe: "The reconciliation records." }], sourceHash: "h-ai", generatedAt: "2026-09-13T00:00:00.000Z" },
      mine: { asks: [{ describe: "MY wording.", showMe: "" }], sourceHash: "h-mine", generatedAt: "2026-09-13T00:00:00.000Z", edited: true },
      halfBlank: { asks: [{ describe: "", showMe: "Only a record." }], sourceHash: "h-half", generatedAt: "2026-09-13T00:00:00.000Z" },
      empty: { asks: [{ describe: "", showMe: "" }], sourceHash: "h-empty", generatedAt: "2026-09-13T00:00:00.000Z" },
    },
  };

  it("splits each half into its own typed question, losing no text", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v1, 1);
    expect(entries.ai.questions.map((q) => [q.askType, q.text])).toEqual([
      ["Process", "Describe how you reconcile."],
      ["Document", "The reconciliation records."],
    ]);
    expect(entries.halfBlank.questions).toHaveLength(1);
    expect(entries.halfBlank.questions[0].askType).toBe("Document");
  });

  it("marks AI-written entries stale so the bulk action rewrites them under the new prompt", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v1, 1);
    expect(questionStateFor(entries.ai, "anything")).toBe("stale");
    expect(entries.ai.questions.every((q) => q.source === "ai")).toBe(true);
  });

  it("preserves hand-written wording as hand-sourced and NOT stale, so regeneration leaves it alone", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v1, 1);
    expect(entries.mine.questions[0].text).toBe("MY wording.");
    expect(entries.mine.questions[0].source).toBe("hand");
    expect(entries.mine.sourceHash).toBe("h-mine");
  });

  it("drops an entry that carried no text at all", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    expect(migrateWorksheetQuestions(v1, 1).entries.empty).toBeUndefined();
  });

  it("drops the v0 hash-keyed cache, which has no check id to re-attach to", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    expect(migrateWorksheetQuestions({ entries: { someHash: [] } }, 0)).toEqual({ entries: {} });
  });
});

// The staleness hash only tracks the CHECK text. Without a prompt version, a
// question written by an older or weaker writer read as "current" and stayed
// hidden until someone read the exported CSV — which is exactly how a sheet
// full of stemless questions and duplicated asks survived unnoticed.
describe("prompt-version badge", () => {
  const cur = WORKSHEET_PROMPT_VERSION;
  it("flags a question written by an older prompt, even though the check is unchanged", () => {
    expect(questionStateFor(entry("c", [q("Show me x")], { promptVersion: cur - 1 }), "c")).toBe("old-prompt");
  });
  it("treats a question from before the field existed as older, not current", () => {
    expect(questionStateFor(entry("c", [q("Show me x")], { promptVersion: undefined }), "c")).toBe("old-prompt");
  });
  it("stays current when the prompt version matches", () => {
    expect(questionStateFor(entry("c", [q("Show me x")]), "c")).toBe("current");
  });
  // A changed check is the more urgent signal and must not be masked.
  it("a changed check still reports stale, not old-prompt", () => {
    expect(questionStateFor(entry("c", [q("Show me x")], { promptVersion: cur - 1 }), "c CHANGED")).toBe("stale");
  });
  it("a hand-edited question is never downgraded by the prompt version", () => {
    expect(questionStateFor(entry("c", [q("mine", "hand")], { edited: true, promptVersion: cur - 1 }), "c")).toBe("edited");
  });
  it("putMany stamps the current prompt version", () => {
    st().putMany({ c1: { questions: [q("Show me x")], sourceHash: questionSourceHash("c") } });
    expect(st().entries.c1.promptVersion).toBe(cur);
  });
});

describe("v2 -> v3 migration repairs stemless AI questions in place", () => {
  const v2 = (questions: WorksheetQuestion[]) => ({
    entries: { c1: { questions, sourceHash: "h", generatedAt: "2026-09-14T00:00:00.000Z" } },
  });
  it("puts the missing ask back on an AI question that starts mid-sentence", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v2([q("the agent agreements.")]), 2);
    expect(entries.c1.questions[0].text).toBe("Show me the agent agreements.");
  });
  it("uses the Process stem for a Process ask", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v2([q("the reconciliation routine.", "ai", "Process")]), 2);
    expect(entries.c1.questions[0].text).toBe("Describe how you handle the reconciliation routine.");
  });
  it("leaves a question that already has an ask completely alone", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v2([q("Show me the agent agreements.")]), 2);
    expect(entries.c1.questions[0].text).toBe("Show me the agent agreements.");
  });
  // The user's wording is theirs, however they phrased it.
  it("never rewrites a hand-written question", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v2([q("the agent agreements.", "hand")]), 2);
    expect(entries.c1.questions[0].text).toBe("the agent agreements.");
  });
  it("keeps everything else about the entry untouched", async () => {
    const { migrateWorksheetQuestions } = await import("../useWorksheetQuestionStore");
    const { entries } = migrateWorksheetQuestions(v2([q("the agent agreements.")]), 2);
    expect(entries.c1.sourceHash).toBe("h");
    expect(entries.c1.generatedAt).toBe("2026-09-14T00:00:00.000Z");
  });
});
