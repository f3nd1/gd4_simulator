import { describe, it, expect } from "vitest";
import { raceCallSkip, CALL_SKIPPED } from "../agentRuntime";

// Item 2b (per-AI-call skip). An Option A run can appear to hang on one slow
// extract call. raceCallSkip races the chatComplete promise against a skip
// resolver the store hands over via onCallAbort; the UI "Skip this AI step"
// button invokes that resolver, and raceCallSkip resolves to CALL_SKIPPED so
// the loop treats the call like an empty reply (points fall through / marked
// not assessed — never fabricated). This proves the race without needing a
// real 90s AI timeout to be waited out.
describe("raceCallSkip — per-AI-call skip race", () => {
  it("returns the call's own result untouched when no skip is registered", async () => {
    const out = await raceCallSkip(undefined, Promise.resolve("hello"));
    expect(out).toBe("hello");
  });

  it("returns the call's result when the call resolves before any skip", async () => {
    let registered: (() => void) | null = null;
    const out = await raceCallSkip((fn) => { registered = fn; }, Promise.resolve("done"));
    expect(out).toBe("done");
    // Register is cleared in the finally so no stale resolver survives the call.
    expect(registered).toBeNull();
  });

  it("resolves to CALL_SKIPPED when the registered abort fires before the (hung) call", async () => {
    let registered: (() => void) | null = null;
    // A call that never resolves — the real hang case (slow model, 90s timeout).
    const hung = new Promise<string>(() => {});
    const raced = raceCallSkip((fn) => { registered = fn; }, hung);
    // Simulate the user clicking "Skip this AI step".
    registered!();
    expect(await raced).toBe(CALL_SKIPPED);
    // And it clears itself so the next call starts with a fresh registration.
    expect(registered).toBeNull();
  });
});
