import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The allow-list is ONE table read by three things that are deployed
// separately and cannot import from each other: the row-level policies, the
// drive-oauth Edge Function, and the app. Nothing but this test stops one of
// them being pointed at a different table or column, which would not fail a
// build, a type-check or any other test — it would just quietly stop
// refusing people.
const SQL = readFileSync("supabase/03-restrict-to-named-people.sql", "utf8");
const ADMIN_SQL = readFileSync("supabase/04-admin-manages-the-list.sql", "utf8");
const SCHEMA = readFileSync("supabase/schema.sql", "utf8");
const EDGE = readFileSync("supabase/functions/drive-oauth/index.ts", "utf8");
const APP = readFileSync("src/lib/auth/allowList.ts", "utf8");

describe("the allow-list is one list, read the same way everywhere", () => {
  it("names the same table in all three", () => {
    for (const [what, src] of [["03", SQL], ["04", ADMIN_SQL], ["schema", SCHEMA], ["edge function", EDGE], ["app", APP]] as const) {
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

  it("gates every write to the list behind the admin, never the screen", () => {
    // 04 replaced "no write policies at all" with "only the admin writes".
    // A write policy that did not name is_admin() would let any signed-in
    // person grant themselves access with nothing but the publishable key.
    for (const [what, src] of [["migration", ADMIN_SQL], ["schema", SCHEMA]] as const) {
      expect(src, what).toMatch(/for insert to authenticated\s+with check \(public\.is_admin\(\)\)/);
      expect(src, what).toMatch(/for delete to authenticated\s+using \(public\.is_admin\(\)/);
    }
  });

  it("grants no UPDATE on the list, so no row can be renamed into somebody else", () => {
    for (const [what, src] of [["migration", ADMIN_SQL], ["schema", SCHEMA]] as const) {
      expect(src, what).not.toMatch(/on public\.allowed_users\s+for (update|all)/);
      expect(src, what).not.toMatch(/for update to authenticated\s+using \(public\.is_admin/);
    }
  });

  it("lets a signed-in person see their own row, and the admin see all of them", () => {
    for (const [what, src] of [["migration", ADMIN_SQL], ["schema", SCHEMA]] as const) {
      expect(src, what).toContain("using (email_lc = lower(auth.jwt() ->> 'email') or public.is_admin())");
    }
    // 03 still carries the narrower original, which 04 drops and replaces.
    expect(SQL).toContain("using (email_lc = lower(auth.jwt() ->> 'email'))");
    expect(ADMIN_SQL).toContain('drop policy if exists "see only your own row" on public.allowed_users;');
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

  it("still grants no delete on workspace_state, whatever the list allows", () => {
    // allowed_users gained a delete policy in 04, deliberately and
    // admin-only. The audit data must not: nothing in the app deletes a
    // workspace row, so granting it would only widen what a mistake or a
    // stolen session can do.
    for (const [what, src] of [["03", SQL], ["04", ADMIN_SQL], ["schema", SCHEMA]] as const) {
      const onWorkspace = src.split(/create policy/).filter((b) => /on public\.workspace_state/.test(b));
      for (const block of onWorkspace) expect(block, what).not.toMatch(/for delete/);
    }
  });

  it("refuses rather than waves through when the Edge Function cannot read the list", () => {
    // A service-role read that errors means something is wrong with the
    // table, not that the caller is fine.
    // The admin short-circuits the list here exactly as is_allowed_user()
    // does in Postgres; everyone else still has to be on it, and a list that
    // cannot be READ is still a refusal rather than a pass.
    expect(EDGE).toMatch(/if \(listErr && !isAdmin\) \{[\s\S]*?\}, 500\);/);
    expect(EDGE).toMatch(/if \(!listed && !isAdmin\) \{[\s\S]*?\}, 403\);/);
  });

  it("seeds the four people who must not be locked out", () => {
    for (const who of ["felix@unitedceres.edu.sg", "renzo@unitedceres.edu.sg", "irene@unitedceres.edu.sg", "admin@unitedceres.edu.sg"]) {
      expect(SQL, who).toContain(`'${who}'`);
    }
  });
});
