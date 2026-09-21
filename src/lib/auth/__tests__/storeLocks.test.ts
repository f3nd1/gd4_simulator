import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listLocks, lockStore, unlockStore, neverLockableReason, unlockPhraseMatches, unlockWarning } from "../storeLocks";

const insertClient = (error: { code?: string; message: string } | null) => ({
  from: () => ({ insert: () => Promise.resolve({ error }) }),
} as unknown as SupabaseClient);

const deleteClient = (answer: { data: unknown[] | null; error: { message: string } | null }) => ({
  from: () => ({ delete: () => ({ eq: () => ({ select: () => Promise.resolve(answer) }) }) }),
} as unknown as SupabaseClient);

describe("reading the lock list", () => {
  it("names the SQL to run when the table is not there yet", async () => {
    const c = { from: () => ({ select: () => Promise.resolve({ data: null, error: { code: "42P01", message: "schema cache" } }) }) } as unknown as SupabaseClient;
    const got = await listLocks(c);
    expect("error" in got && got.error).toContain("07-locks-live-in-a-table.sql");
  });

  it("returns the keys when it can be read", async () => {
    const c = { from: () => ({ select: () => Promise.resolve({ data: [{ store_key: "a" }, { store_key: "b" }], error: null }) }) } as unknown as SupabaseClient;
    const got = await listLocks(c);
    expect("keys" in got && [...got.keys].sort()).toEqual(["a", "b"]);
  });
});

describe("the five that can never be locked", () => {
  it("are refused before the request is even made", async () => {
    let reached = false;
    const c = { from: () => { reached = true; throw new Error("should not be reached"); } } as unknown as SupabaseClient;
    const got = await lockStore(c, "ucc-gd4-workspace:v3", "felix@unitedceres.edu.sg");
    expect(got.ok).toBe(false);
    expect(reached).toBe(false);
  });

  it("each give a reason rather than a bare refusal", () => {
    for (const key of ["ucc-gd4-workspace:v3", "ucc-gd4-checklist:v2", "ucc-gd4-finding-drafts:v1",
                       "ucc-gd4-changelog:v1", "ucc-gd4-checklist-verdicts:v1"]) {
      expect(neverLockableReason(key), key).toBeTruthy();
    }
    expect(neverLockableReason("ucc-gd4-scoring-config:v1")).toBeNull();
  });

  it("translate the CHECK constraint's own refusal, if it ever reaches the database", async () => {
    // 23514 is what Postgres returns for locked_stores_never_lockable. The
    // screen must explain rather than relay the code.
    const got = await lockStore(insertClient({ code: "23514", message: "violates check constraint" }), "ucc-gd4-scoring-config:v1", "x");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).not.toMatch(/23514|constraint/i);
  });
});

describe("locking and unlocking", () => {
  it("reports a policy refusal as a refusal, not a raw code", async () => {
    const got = await lockStore(insertClient({ code: "42501", message: "row-level security" }), "ucc-gd4-scoring-config:v1", "x");
    expect(got.ok === false && got.reason).toContain("Only an admin");
  });

  it("treats zero rows deleted as a refusal, never as success", async () => {
    // A refused DELETE returns no error and no rows. Reporting success would
    // tell an admin a page was unlocked when it was not.
    const got = await unlockStore(deleteClient({ data: [], error: null }), "ucc-gd4-scoring-config:v1");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toContain("refused");
  });

  it("reports success only when a row actually went", async () => {
    expect(await unlockStore(deleteClient({ data: [{ store_key: "x" }], error: null }), "x")).toEqual({ ok: true });
  });
});

describe("the friction sits on unlocking only", () => {
  it("needs the page name typed, ignoring case and extra spaces", () => {
    expect(unlockPhraseMatches("GD4 Scoring Setup", "GD4 Scoring Setup")).toBe(true);
    expect(unlockPhraseMatches("  gd4   scoring setup ", "GD4 Scoring Setup")).toBe(true);
    expect(unlockPhraseMatches("", "GD4 Scoring Setup")).toBe(false);
    expect(unlockPhraseMatches("yes", "GD4 Scoring Setup")).toBe(false);
    expect(unlockPhraseMatches("GD4 Scoring", "GD4 Scoring Setup")).toBe(false);
  });

  it("says who gains the ability, and what they still will not see", () => {
    const w = unlockWarning("GD4 Scoring Setup", "Award thresholds and scoring weights");
    expect(w).toMatch(/everyone who can sign in/i);
    expect(w).toMatch(/not only admins/i);
    expect(w).toMatch(/still not see the page/i);
  });
});
