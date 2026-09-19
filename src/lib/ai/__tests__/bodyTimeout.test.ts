// A response whose HEADERS arrive and whose BODY never finishes must time out.
// It used to hang for ever: the abort timer was cleared the moment fetch
// resolved, and the body was then read with no deadline at all. A self-check
// sat on one requirement for 58 minutes, 50 of them with no activity, because
// of this.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTextWithTimeout, AIClientError } from "../aiClient";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

describe("the response body is read under the same deadline as the request", () => {
  it("times out when the body never arrives", async () => {
    // Headers immediately; text() never settles until the signal aborts.
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(Object.assign(new DOMException("aborted", "AbortError"))), { once: true });
      }),
    })) as unknown as typeof fetch;

    await expect(fetchTextWithTimeout("https://example.test", { method: "POST" }, 30))
      .rejects.toBeInstanceOf(AIClientError);
  });

  it("returns the body when it does arrive", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })) as unknown as typeof fetch;
    const got = await fetchTextWithTimeout("https://example.test", { method: "POST" }, 1000);
    expect(got.text).toBe('{"ok":true}');
    expect(got.res.ok).toBe(true);
  });

  it("reports a caller's own cancel as a cancel, not as a timeout", async () => {
    const ctrl = new AbortController();
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => ({
      ok: true, status: 200,
      text: () => new Promise<string>((_res, rej) => {
        const fail = () => rej(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      }),
    })) as unknown as typeof fetch;
    const p = fetchTextWithTimeout("https://example.test", { method: "POST" }, 5000, ctrl.signal);
    // After a tick, so the body read is genuinely in flight when it is cancelled.
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toThrow(/cancelled/i);
  });
});
