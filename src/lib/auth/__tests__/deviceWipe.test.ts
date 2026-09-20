import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { KEEP_ON_WIPE, keysToWipe, planWipe, unsyncedStoreKeys } from "../deviceWipe";

const STORE_DIR = new URL("../../../store", import.meta.url).pathname;

// The persist keys, read from the real stores — the same trick
// storeAdapters.test.ts uses. A store added later under a key the wipe
// predicate does not recognise fails HERE, rather than leaving that store's
// data quietly behind on a shared machine.
function persistedKeys(): string[] {
  return readdirSync(STORE_DIR)
    .filter((f) => f.startsWith("use") && f.endsWith(".ts"))
    .map((f) => readFileSync(join(STORE_DIR, f), "utf8"))
    .filter((src) => /\bpersist\(/.test(src))
    // Every persisted store is required to wire this gate with its own persist
    // key (CLAUDE.md, Stores; enforced by storeAdapters.test.ts), which makes
    // it the one unambiguous place the key appears.
    .flatMap((src) => [...src.matchAll(/blockWritesIfHydrationFailed\("([^"]+)"\)/g)].map((m) => m[1]));
}

describe("what a device wipe removes", () => {
  it("covers every persisted store except the connection settings", () => {
    const keys = persistedKeys();
    expect(keys).toContain("ucc-gd4-workspace:v3");
    expect(keys).toContain("profile-of-pei-v2");   // the one key with no ucc-gd4- prefix
    expect(keys).toContain(KEEP_ON_WIPE);
    expect(keysToWipe(keys).sort()).toEqual(keys.filter((k) => k !== KEEP_ON_WIPE).sort());
  });

  it("leaves the connection settings, so the next person can still sign in", () => {
    expect(keysToWipe([KEEP_ON_WIPE, "ucc-gd4-workspace:v3"])).toEqual(["ucc-gd4-workspace:v3"]);
  });

  it("never touches a key belonging to another app on the same origin", () => {
    expect(keysToWipe(["some-other-app:state", "sb-abc-auth-token", "ucc-gd4-findings"])).toEqual(["ucc-gd4-findings"]);
  });

  it("refuses while any store's local copy is newer than the database", () => {
    const plan = planWipe(["ucc-gd4-workspace:v3", "ucc-gd4-workspace:v3::unsynced"]);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("has not reached the database");
  });

  it("names the unsynced stores from their marker keys", () => {
    expect(unsyncedStoreKeys(["a::unsynced", "b", "c::unsynced"])).toEqual(["a", "c"]);
  });
});
