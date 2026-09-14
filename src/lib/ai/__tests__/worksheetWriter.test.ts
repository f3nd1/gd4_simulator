import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainChecklistRow } from "../../domainChecklist";

const chatComplete = vi.fn();
// Records which model bucket the writer asked for. This call used to run on
// the UTILITY model (the smallest available), which is why seven hard rules
// across a 20-check batch were not being followed.
const effectiveArgs: { purpose?: string }[] = [];
vi.mock("../aiClient", () => ({
  chatComplete,
  effectiveSettings: (s: unknown, opts: { purpose?: string }) => { effectiveArgs.push(opts); return s; },
}));

const { runWorksheetConversion, BATCH_SIZE, CONCURRENCY, WORKSHEET_PROMPT_VERSION } = await import("../worksheetWriter");

const settings = { enabled: true, apiKey: "k", model: "m", utilityModel: "m" } as never;

const rows = (n: number): DomainChecklistRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id${i}`, criterionId: "1", sectionKey: "S", sectionKind: "checks",
    subCriterionIds: [], text: `check text ${i}`, status: "built-in", custom: false,
  }));

// Answers every id it was sent, so a test can count calls without modelling
// the prompt.
const echo = () => chatComplete.mockImplementation(async (messages: { content: string }[]) => {
  const ids = [...messages[1].content.matchAll(/^--- id: (\S+)$/gm)].map((m) => m[1]);
  return JSON.stringify({ checks: ids.map((id) => ({ id, questions: [{ askType: "Document", text: `Q ${id}` }] })) });
});

// Block body, not an expression: mockReset() returns the mock, and Vitest
// treats a function returned from beforeEach as a cleanup hook and calls it
// after the test, firing the mock again with no arguments.
beforeEach(() => { chatComplete.mockReset(); });

describe("batching", () => {
  it("sends one call per BATCH_SIZE checks, not one per check", async () => {
    echo();
    await runWorksheetConversion(rows(186), settings);
    expect(chatComplete).toHaveBeenCalledTimes(Math.ceil(186 / BATCH_SIZE));
  });
});

describe("concurrency", () => {
  it("runs batches in parallel, capped at CONCURRENCY", async () => {
    let inFlight = 0, peak = 0;
    chatComplete.mockImplementation(async (messages: { content: string }[]) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      const ids = [...messages[1].content.matchAll(/^--- id: (\S+)$/gm)].map((m) => m[1]);
      return JSON.stringify({ checks: ids.map((id) => ({ id, questions: [{ askType: "Document", text: "d" }] })) });
    });
    await runWorksheetConversion(rows(186), settings);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(CONCURRENCY);
  });

  it("preserves row order regardless of which batch finishes first", async () => {
    chatComplete.mockImplementation(async (messages: { content: string }[]) => {
      const ids = [...messages[1].content.matchAll(/^--- id: (\S+)$/gm)].map((m) => m[1]);
      // Later batches return sooner, so completion order is reversed.
      await new Promise((r) => setTimeout(r, 60 - Number(ids[0].replace("id", "")) / 2));
      return JSON.stringify({ checks: ids.map((id) => ({ id, questions: [{ askType: "Process", text: `D ${id}` }] })) });
    });
    const { questionsById } = await runWorksheetConversion(rows(60), settings);
    expect([...questionsById.keys()].length).toBe(60);
    expect(questionsById.get("id0")![0].text).toBe("D id0");
    expect(questionsById.get("id59")![0].text).toBe("D id59");
  });
});

describe("cancel", () => {
  it("stops batches still queued instead of only aborting open requests", async () => {
    const ctrl = new AbortController();
    chatComplete.mockImplementation(async (messages: { content: string }[]) => {
      ctrl.abort();
      const ids = [...messages[1].content.matchAll(/^--- id: (\S+)$/gm)].map((m) => m[1]);
      return JSON.stringify({ checks: ids.map((id) => ({ id, asks: [{ describe: "d", showMe: "" }] })) });
    });
    await runWorksheetConversion(rows(186), settings, { signal: ctrl.signal });
    // The pool has CONCURRENCY workers in flight when the first abort lands,
    // so at most that many calls go out, never all 10 batches.
    expect(chatComplete.mock.calls.length).toBeLessThanOrEqual(CONCURRENCY);
  });
});

describe("grounding", () => {
  it("ignores an id the model returned that was not in the batch", async () => {
    chatComplete.mockResolvedValue(JSON.stringify({
      checks: [{ id: "id0", questions: [{ askType: "Document", text: "real" }] }, { id: "GHOST", questions: [{ askType: "Document", text: "invented" }] }],
    }));
    const res = await runWorksheetConversion(rows(2), settings);
    expect(res.questionsById.has("GHOST")).toBe(false);
    expect(res.failed).toContain("id1");
  });

  it("reports a failed batch rather than silently dropping it", async () => {
    chatComplete.mockRejectedValue(new Error("boom"));
    const res = await runWorksheetConversion(rows(3), settings);
    expect(res.failed).toHaveLength(3);
    expect(res.questionsById.size).toBe(0);
  });
});

describe("variable question count", () => {
  it("stores as many questions as the model returned, without padding or truncating", async () => {
    chatComplete.mockResolvedValue(JSON.stringify({ checks: [
      { id: "id0", questions: [{ askType: "Document", text: "one" }] },
      { id: "id1", questions: [
        { askType: "Process", text: "a" }, { askType: "Document", text: "b" },
        { askType: "Document", text: "c" }, { askType: "Process", text: "d" },
      ] },
    ] }));
    const res = await runWorksheetConversion(rows(2), settings);
    expect(res.questionsById.get("id0")).toHaveLength(1);
    expect(res.questionsById.get("id1")).toHaveLength(4);
  });

  it("marks everything it writes as AI-sourced, so regeneration may replace it", async () => {
    echo();
    const res = await runWorksheetConversion(rows(1), settings);
    expect(res.questionsById.get("id0")![0].source).toBe("ai");
  });

  it("coerces an askType outside the two allowed values rather than storing a junk tag", async () => {
    chatComplete.mockResolvedValue(JSON.stringify({ checks: [{ id: "id0", questions: [{ askType: "Nonsense", text: "t" }] }] }));
    const res = await runWorksheetConversion(rows(1), settings);
    expect(res.questionsById.get("id0")![0].askType).toBe("Document");
  });

  it("drops an empty question rather than emitting a blank row", async () => {
    chatComplete.mockResolvedValue(JSON.stringify({ checks: [{ id: "id0", questions: [{ askType: "Document", text: "  " }, { askType: "Process", text: "real" }] }] }));
    const res = await runWorksheetConversion(rows(1), settings);
    expect(res.questionsById.get("id0")).toHaveLength(1);
  });
});

describe("the writer runs on the analysis model, not the utility one", () => {
  it("asks for the analysis bucket", async () => {
    effectiveArgs.length = 0;
    echo();
    await runWorksheetConversion(rows(1), settings);
    expect(effectiveArgs[0]?.purpose).toBe("analysis");
    expect(effectiveArgs[0]?.purpose).not.toBe("utility");
  });
});

describe("the prompt states the two rules that were being broken, last", () => {
  it("repeats the no-duplication and ask-stem rules after the main body", async () => {
    echo();
    await runWorksheetConversion(rows(1), settings);
    const system = chatComplete.mock.calls[0][0][0].content as string;
    const recap = system.slice(system.indexOf("Before you answer"));
    expect(recap).toMatch(/ONE question per audit point/);
    expect(recap).toMatch(/starts with the ask/);
    // Recency: the recap really is at the end, not buried mid-prompt.
    expect(system.indexOf("Before you answer")).toBeGreaterThan(system.length * 0.6);
  });
  it("tells the model how to turn an expected-evidence list into an ask", async () => {
    echo();
    await runWorksheetConversion(rows(1), settings);
    const system = chatComplete.mock.calls[0][0][0].content as string;
    expect(system).toMatch(/is not a question/);
  });
  it("carries a version, so a question written by an older prompt can be spotted", () => {
    expect(WORKSHEET_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });
});

// The prompt has forbidden stemless questions since the feature's first
// commit and the model does it anyway, so the guard has to be in code.
describe("stemless model output is repaired on the way in", () => {
  it("puts the ask back on a bare noun phrase", async () => {
    chatComplete.mockImplementation(async () => JSON.stringify({
      checks: [{ id: "id0", questions: [{ askType: "Document", text: "the agent agreements." }] }],
    }));
    const { questionsById } = await runWorksheetConversion(rows(1), settings);
    expect(questionsById.get("id0")![0].text).toBe("Show me the agent agreements.");
  });
  it("leaves a well-formed question exactly as written", async () => {
    chatComplete.mockImplementation(async () => JSON.stringify({
      checks: [{ id: "id0", questions: [{ askType: "Document", text: "Show me the signed agreements." }] }],
    }));
    const { questionsById } = await runWorksheetConversion(rows(1), settings);
    expect(questionsById.get("id0")![0].text).toBe("Show me the signed agreements.");
  });
});
