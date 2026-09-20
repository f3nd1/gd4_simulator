import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The allow-list is ONE table read by three things that are deployed
// separately and cannot import from each other: the row-level policies, the
// drive-oauth Edge Function, and the app. Nothing but this test stops one of
// them being pointed at a different table or column, which would not fail a
// build, a type-check or any other test — it would just quietly stop
// refusing people.
const SQL = readFileSync("supabase/03-restrict-to-named-people.sql", "utf8");
const SCHEMA = readFileSync("supabase/schema.sql", "utf8");
const EDGE = readFileSync("supabase/functions/drive-oauth/index.ts", "utf8");
const APP = readFileSync("src/lib/auth/allowList.ts", "utf8");

describe("the allow-list is one list, read the same way everywhere", () => {
  it("names the same table in all three", () => {
    for (const [what, src] of [["migration", SQL], ["schema", SCHEMA], ["edge function", EDGE], ["app", APP]] as const) {
      expect(src, what).toContain("allowed_users");
    }
  });

  it("matches on the lower-cased column everywhere, never on the raw address", () => {
    // Addresses are typed by hand into the dashboard. A comparison against
    // `email` would lock out a person who IS on the list because somebody
    // capitalised their name.
    expect(SQL).toContain("email_lc text generated always as (lower(email)) stored");
    expect(SCHEMA).toContain("email_lc text generated always as (lower(email)) stored");
    expect(EDGE).toContain('.eq("email_lc"');
    expect(APP).toContain('.eq("email_lc"');
  });

  it("keeps the domain test in front of the list, so a bad list cannot open the door to the internet", () => {
    expect(SQL).toContain("ilike '%@unitedceres.edu.sg'");
    expect(SCHEMA).toContain("ilike '%@unitedceres.edu.sg'");
    expect(EDGE).toContain("if (!emailIsAllowed(email))");
  });

  it("grants no way to write the list from the app or the browser", () => {
    // Only a select policy exists. An insert/update/delete policy would let a
    // signed-in person grant access to anyone, which is the permission system
    // this deliberately does not have.
    expect(SQL).toMatch(/create policy "see only your own row" on public\.allowed_users\s+for select to authenticated/);
    expect(SQL).not.toMatch(/on public\.allowed_users\s+for (insert|update|delete|all)/);
    expect(SCHEMA).not.toMatch(/on public\.allowed_users\s+for (insert|update|delete|all)/);
  });

  it("lets a signed-in person see their own row only", () => {
    expect(SQL).toContain("using (email_lc = lower(auth.jwt() ->> 'email'))");
    expect(SCHEMA).toContain("using (email_lc = lower(auth.jwt() ->> 'email'))");
  });

  it("points every workspace_state policy at the list, leaving none on the domain alone", () => {
    for (const [what, src] of [["migration", SQL], ["schema", SCHEMA]] as const) {
      for (const cmd of ["allowed read", "allowed insert", "allowed update"]) {
        expect(src, `${what} ${cmd}`).toContain(`create policy "${cmd}" on public.workspace_state`);
      }
      // The old domain-only policies must be gone, not merely shadowed.
      expect(src, what).not.toMatch(/create policy "ucc (read|insert|update)" on public\.workspace_state/);
    }
    expect(SQL).toContain('drop policy if exists "ucc read"   on public.workspace_state;');
  });

  it("still grants no delete, on either table", () => {
    expect(SQL).not.toMatch(/for delete/);
    expect(SCHEMA).not.toMatch(/for delete/);
  });

  it("refuses rather than waves through when the Edge Function cannot read the list", () => {
    // A service-role read that errors means something is wrong with the
    // table, not that the caller is fine.
    expect(EDGE).toMatch(/if \(listErr\) \{[\s\S]*?\}, 500\);/);
    expect(EDGE).toMatch(/if \(!listed\) \{[\s\S]*?\}, 403\);/);
  });

  it("seeds the four people who must not be locked out", () => {
    for (const who of ["felix@unitedceres.edu.sg", "renzo@unitedceres.edu.sg", "irene@unitedceres.edu.sg", "admin@unitedceres.edu.sg"]) {
      expect(SQL, who).toContain(`'${who}'`);
    }
  });
});
