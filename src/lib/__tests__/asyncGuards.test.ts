import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withDeadline } from "../asyncGuards";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("withDeadline — hard deadline on promises that may never settle", () => {
  it("resolves with the promise's value when it settles before the deadline", async () => {
    const p = withDeadline(Promise.resolve("token"), 20_000, "timed out");
    await expect(p).resolves.toBe("token");
  });

  it("passes the promise's own rejection through unchanged", async () => {
    const boom = new Error("auth denied");
    const p = withDeadline(Promise.reject(boom), 20_000, "timed out");
    await expect(p).rejects.toBe(boom);
  });

  it("rejects with the timeout message when the promise NEVER settles (the 98-minute-hang case)", async () => {
    // A promise that never resolves or rejects — exactly what GIS's token
    // client produces when its callback is silently dropped.
    const never = new Promise<string>(() => {});
    const p = withDeadline(never, 20_000, "Silent re-auth timed out");
    const assertion = expect(p).rejects.toThrow("Silent re-auth timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("does not time out a promise that settles exactly at the wire", async () => {
    let resolveIt!: (v: string) => void;
    const slow = new Promise<string>((r) => { resolveIt = r; });
    const p = withDeadline(slow, 20_000, "timed out");
    await vi.advanceTimersByTimeAsync(19_999);
    resolveIt("just made it");
    await expect(p).resolves.toBe("just made it");
  });

  it("a late settlement after the deadline is ignored, not an unhandled rejection", async () => {
    let rejectIt!: (e: Error) => void;
    const slow = new Promise<string>((_, rej) => { rejectIt = rej; });
    const p = withDeadline(slow, 1_000, "timed out");
    const assertion = expect(p).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    // The original promise rejecting AFTER the deadline must be swallowed by
    // withDeadline's own .then handler — if it leaked as an unhandled
    // rejection, vitest would fail this test at teardown.
    rejectIt(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
