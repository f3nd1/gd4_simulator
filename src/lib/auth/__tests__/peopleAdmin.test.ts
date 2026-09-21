import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, isAdminEmail } from "../domain";
import { checkAddress, removalBlockedReason, removalConsequence, removePerson, addPerson, listPeople, ADMIN_ONLY_REFUSAL } from "../peopleAdmin";

describe("who the admin is", () => {
  it("is the same address the database uses, character for character", () => {
    // Two copies of a rule is how one of them quietly stops matching. The SQL
    // is the control; this pins the browser's copy to it.
    const sql = readFileSync("supabase/04-admin-manages-the-list.sql", "utf8");
    expect(sql).toContain(`select lower(auth.jwt() ->> 'email') = '${ADMIN_EMAIL}';`);
    expect(readFileSync("supabase/schema.sql", "utf8")).toContain(`= '${ADMIN_EMAIL}';`);
    expect(readFileSync("supabase/functions/drive-oauth/index.ts", "utf8"))
      .toContain(`const ADMIN_EMAIL = "${ADMIN_EMAIL}";`);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(isAdminEmail(" Felix@UnitedCeres.edu.SG ")).toBe(true);
    expect(isAdminEmail("renzo@unitedceres.edu.sg")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
});

describe("the database is the control, not the screen", () => {
  it("only the admin may insert or delete, per the policies", () => {
    const sql = readFileSync("supabase/04-admin-manages-the-list.sql", "utf8");
    expect(sql).toMatch(/for insert to authenticated\s+with check \(public\.is_admin\(\)\)/);
    expect(sql).toMatch(/for delete to authenticated\s+using \(public\.is_admin\(\) and email_lc <> lower\(auth\.jwt\(\) ->> 'email'\)\)/);
    // No update policy: without one, nobody can rename a row into somebody
    // else's address.
    expect(sql).not.toMatch(/for update/);
  });

  it("never lets the admin be locked out of the app by an empty list", () => {
    const sql = readFileSync("supabase/04-admin-manages-the-list.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.is_allowed_user"));
    expect(fn.slice(0, fn.indexOf("$$;"))).toContain("select public.is_admin()");
  });

  it("decides admin-ness without reading a table, so no policy recurses", () => {
    const sql = readFileSync("supabase/04-admin-manages-the-list.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.is_admin"));
    expect(fn.slice(0, fn.indexOf("$$;"))).not.toMatch(/from\s+public\.allowed_users/);
  });
});

describe("adding an address", () => {
  const existing = ["felix@unitedceres.edu.sg", "renzo@unitedceres.edu.sg"];

  it("accepts a UCC address and lower-cases it", () => {
    expect(checkAddress("  Irene@UnitedCeres.edu.SG ", existing)).toEqual({ ok: true, email: "irene@unitedceres.edu.sg" });
  });

  it("refuses an empty box, a non-address, and a non-UCC domain", () => {
    expect(checkAddress("   ", existing).ok).toBe(false);
    expect(checkAddress("irene", existing).ok).toBe(false);
    const outside = checkAddress("someone@gmail.com", existing);
    expect(outside.ok).toBe(false);
    expect(outside.ok === false && outside.reason).toContain("unitedceres.edu.sg");
  });

  it("refuses a lookalike domain that merely ends with ours", () => {
    expect(checkAddress("a@unitedceres.edu.sg.attacker.com", existing).ok).toBe(false);
    expect(checkAddress("a@notunitedceres.edu.sg", existing).ok).toBe(false);
  });

  it("refuses a duplicate cleanly, whatever case it is typed in", () => {
    const dup = checkAddress("RENZO@unitedceres.edu.sg", existing);
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.reason).toBe("That person is already on the list.");
  });

  it("refuses a space before the @", () => {
    expect(checkAddress("two words@unitedceres.edu.sg", existing).ok).toBe(false);
  });
});

describe("removing somebody", () => {
  it("pins the admin's own row and says how to hand it over", () => {
    const why = removalBlockedReason(ADMIN_EMAIL);
    expect(why).toBeTruthy();
    expect(why!).toContain("04-admin-manages-the-list.sql");
    expect(removalBlockedReason("renzo@unitedceres.edu.sg")).toBeNull();
  });

  it("states all three consequences, including the two people get wrong", () => {
    const c = removalConsequence("renzo@unitedceres.edu.sg");
    expect(c).toContain("within seconds");
    expect(c).toContain("until they reload");        // their screen does not clear itself
    expect(c).toMatch(/Authentication, Users/);      // ending the session is a separate step
  });

  it("treats zero rows deleted as a refusal, never as success", async () => {
    // A policy refusing a delete returns NO error and NO rows. Reporting that
    // as success would tell the admin somebody had lost access when they had
    // not, which is the worst possible lie for this screen to tell.
    const supabase = {
      from: () => ({ delete: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) }),
    } as unknown as SupabaseClient;
    const got = await removePerson(supabase, "renzo@unitedceres.edu.sg");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toContain("refused");
  });

  it("reports success only when a row actually went", async () => {
    const supabase = {
      from: () => ({ delete: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ email: "renzo@unitedceres.edu.sg" }], error: null }) }) }) }),
    } as unknown as SupabaseClient;
    expect(await removePerson(supabase, "renzo@unitedceres.edu.sg")).toEqual({ ok: true });
  });

  it("refuses the admin's own row before it ever reaches the database", async () => {
    let called = false;
    const supabase = { from: () => { called = true; throw new Error("should not be reached"); } } as unknown as SupabaseClient;
    const got = await removePerson(supabase, ADMIN_EMAIL);
    expect(got.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("a non-admin who reaches the page", () => {
  it("is refused in words that name nothing about the app", () => {
    for (const leak of ["allowed_users", "policy", "database", "supabase", "admin account", "finding", "student"]) {
      expect(ADMIN_ONLY_REFUSAL.toLowerCase(), leak).not.toContain(leak);
    }
  });
});

describe("a policy refusal on add", () => {
  it("is reported as a refusal, not as a raw error code", async () => {
    const supabase = {
      from: () => ({ insert: () => Promise.resolve({ error: { code: "42501", message: "new row violates row-level security policy" } }) }),
    } as unknown as SupabaseClient;
    const got = await addPerson(supabase, "someone@unitedceres.edu.sg");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toContain("Only the admin account can add people");
  });

  it("reports a duplicate as a duplicate", async () => {
    const supabase = {
      from: () => ({ insert: () => Promise.resolve({ error: { code: "23505", message: "duplicate key" } }) }),
    } as unknown as SupabaseClient;
    const got = await addPerson(supabase, "renzo@unitedceres.edu.sg");
    expect(got.ok === false && got.reason).toBe("That person is already on the list.");
  });
});

// The People screen loads the sign-in list, the admin grants and the lock
// list side by side. listPeople must never THROW, or a bad answer to one
// query would blank the other two: that is exactly what happened when the
// lock panel sat on "Checking..." for ever with no explanation.
describe("listPeople never throws out of the caller", () => {
  it("reports a thrown error instead of propagating it", async () => {
    const c = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    expect(await listPeople(c)).toEqual({ error: "boom" });
  });

  it("reports a non-array answer instead of dying on .map", async () => {
    const c = {
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: { email: "x" }, error: null }) }) }),
    } as unknown as SupabaseClient;
    const got = await listPeople(c);
    expect("error" in got && got.error).toMatch(/unexpected shape/i);
  });

  it("still returns the people when the answer is normal", async () => {
    const c = {
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [{ email: "a@unitedceres.edu.sg", note: null, added_at: null }], error: null }) }) }),
    } as unknown as SupabaseClient;
    const got = await listPeople(c);
    expect("people" in got && got.people.map((p) => p.email)).toEqual(["a@unitedceres.edu.sg"]);
  });
});
