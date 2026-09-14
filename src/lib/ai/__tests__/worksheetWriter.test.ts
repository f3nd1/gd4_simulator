import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainChecklistRow } from "../../domainChecklist";
import { worksheetCacheKey, type WorksheetAsk } from "../../manualWorksheet";

const chatComplete = vi.fn();
vi.mock("../aiClient", () => ({ chatComplete, effectiveSettings: (s: unknown) => s }));

const { runWorksheetConversion, BATCH_SIZE, CONCURRENCY, PROMPT_VERSION } = await import("../worksheetWriter");

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
  return JSON.stringify({ checks: ids.map((id) => ({ id, asks: [{ describe: `D ${id}`, showMe: `S ${id}` }] })) });
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
      return JSON.stringify({ checks: ids.map((id) => ({ id, asks: [{ describe: "d", showMe: "s" }] })) });
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
      return JSON.stringify({ checks: ids.map((id) => ({ id, asks: [{ describe: `D ${id}`, showMe: "" }] })) });
    });
    const { asksById } = await runWorksheetConversion(rows(60), settings);
    expect([...asksById.keys()].length).toBe(60);
    expect(asksById.get("id0")![0].describe).toBe("D id0");
    expect(asksById.get("id59")![0].describe).toBe("D id59");
  });
});

describe("caching", () => {
  it("reuses a cached check and never sends it", async () => {
    echo();
    const all = rows(40);
    const cache: Record<string, WorksheetAsk[]> = {};
    for (const r of all.slice(0, 39)) cache[worksheetCacheKey(PROMPT_VERSION, r.text)] = [{ describe: "cached", showMe: "" }];

    const res = await runWorksheetConversion(all, settings, { cache });
    expect(res.cached).toBe(39);
    expect(chatComplete).toHaveBeenCalledTimes(1);
    const sent = (chatComplete.mock.calls[0][0] as { content: string }[])[1].content;
    expect(sent).toContain("id39");
    expect(sent).not.toContain("--- id: id0\n");
    expect(res.asksById.get("id0")![0].describe).toBe("cached");
  });

  it("misses when the check text changed, so an edit regenerates only that check", async () => {
    echo();
    const all = rows(40);
    const cache: Record<string, WorksheetAsk[]> = {};
    for (const r of all) cache[worksheetCacheKey(PROMPT_VERSION, r.text)] = [{ describe: "cached", showMe: "" }];
    all[7] = { ...all[7], text: "check text 7 EDITED" };

    const res = await runWorksheetConversion(all, settings, { cache });
    expect(res.cached).toBe(39);
    expect(chatComplete).toHaveBeenCalledTimes(1);
    expect(res.asksById.get("id7")![0].describe).toBe("D id7");
  });

  it("hands back only newly written entries, keyed by source text", async () => {
    echo();
    const all = rows(3);
    const onCache = vi.fn();
    await runWorksheetConversion(all, settings, { onCache });
    expect(onCache).toHaveBeenCalledTimes(1);
    const written = onCache.mock.calls[0][0] as Record<string, WorksheetAsk[]>;
    expect(Object.keys(written)).toHaveLength(3);
    expect(written[worksheetCacheKey(PROMPT_VERSION, "check text 0")][0].describe).toBe("D id0");
  });

  it("a different prompt version invalidates the whole cache", async () => {
    echo();
    const all = rows(3);
    const cache = { [worksheetCacheKey("vOLD", all[0].text)]: [{ describe: "stale", showMe: "" }] };
    const res = await runWorksheetConversion(all, settings, { cache });
    expect(res.cached).toBe(0);
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
      checks: [{ id: "id0", asks: [{ describe: "real", showMe: "" }] }, { id: "GHOST", asks: [{ describe: "invented", showMe: "" }] }],
    }));
    const res = await runWorksheetConversion(rows(2), settings);
    expect(res.asksById.has("GHOST")).toBe(false);
    expect(res.failed).toContain("id1");
  });

  it("reports a failed batch rather than silently dropping it", async () => {
    chatComplete.mockRejectedValue(new Error("boom"));
    const res = await runWorksheetConversion(rows(3), settings);
    expect(res.failed).toHaveLength(3);
    expect(res.asksById.size).toBe(0);
  });
});
