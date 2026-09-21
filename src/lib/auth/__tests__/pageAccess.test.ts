import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NAV } from "../../../nav";
import {
  NORMAL_USER_PATHS, NORMAL_USER_HOME, NOTABLE_ADMIN_PATHS, LOCKABLE_STORES, NEVER_LOCKABLE, NEVER_LOCKABLE_LABEL,
  isAdminOnlyPath, protectionFor, PROTECTION_LABEL, PROTECTION_MEANING, READ_CAVEAT, EVERYTHING_ELSE_NOTE,
} from "../pageAccess";

const SQL = readFileSync("supabase/06-second-admin-and-locked-stores.sql", "utf8");
const LOCKS_SQL = readFileSync("supabase/07-locks-live-in-a-table.sql", "utf8");
// 07 moved the list out of the function and into a table. The function now
// READS that table, so the seed is what has to match the app's catalogue.
const seededInSql = () => {
  const ins = LOCKS_SQL.slice(LOCKS_SQL.indexOf("insert into public.locked_stores"));
  return [...ins.slice(0, ins.indexOf(";")).matchAll(/'([a-z0-9:.-]+)',\s+'migration 07'/g)].map((m) => m[1]);
};
const neverLockableInSql = () => {
  const c = LOCKS_SQL.slice(LOCKS_SQL.indexOf("locked_stores_never_lockable check"));
  return [...c.slice(0, c.indexOf("])")).matchAll(/'([a-z0-9:.-]+)'/g)].map((m) => m[1]);
};

describe("the lock catalogue matches what the database was seeded with", () => {
  it("matches, key for key", () => {
    expect(seededInSql().sort()).toEqual(Object.keys(LOCKABLE_STORES).sort());
  });

  it("reads the live list from the table rather than its own source", () => {
    // STABLE, not IMMUTABLE: an immutable function that reads a table can be
    // folded to a constant, which would freeze the locks and make every
    // later toggle a silent no-op.
    const fn = LOCKS_SQL.slice(LOCKS_SQL.indexOf("create or replace function public.is_admin_only_row"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("from public.locked_stores");
    expect(body).toMatch(/\bstable\b/);
    expect(body).not.toMatch(/\bimmutable\b/);
  });

  it("refuses the never-lockable rows with a CONSTRAINT, which binds everyone", () => {
    // A policy binds the caller; a constraint binds the admin and the
    // Supabase dashboard too. Locking one of these would break every
    // process owner on page load.
    expect(neverLockableInSql().sort()).toEqual(Object.keys(NEVER_LOCKABLE).sort());
    for (const key of Object.keys(NEVER_LOCKABLE)) {
      expect(Object.keys(LOCKABLE_STORES), key).not.toContain(key);
      expect(seededInSql(), `${key} seeded`).not.toContain(key);
      expect(NEVER_LOCKABLE_LABEL[key], `${key} needs a label for the collapsed list`).toBeTruthy();
    }
  });

  it("lets only an admin change a lock, and everyone signed in read the list", () => {
    // The read matters: is_admin_only_row runs as the CALLER, so a normal
    // user who could not see these rows would find every lock evaporate for
    // exactly the people it exists to stop.
    expect(LOCKS_SQL).toMatch(/for select to authenticated\s+using \(public\.is_allowed_user\(\)\)/);
    expect(LOCKS_SQL).toMatch(/for insert to authenticated\s+with check \(public\.is_any_admin\(\)\)/);
    expect(LOCKS_SQL).toMatch(/for delete to authenticated\s+using \(public\.is_any_admin\(\)\)/);
    expect(LOCKS_SQL).not.toMatch(/on public\.locked_stores\s+for (update|all)/);
  });
});

describe("a locked row's page is never visible to the person who cannot write it", () => {
  it("every page owning a locked row is admin-only", () => {
    // Otherwise a normal user opens the screen, types an edit, and the save
    // is silently refused. Worse than not seeing the page.
    for (const [key, { path }] of Object.entries(LOCKABLE_STORES)) {
      expect(isAdminOnlyPath(path), `${key} -> ${path}`).toBe(true);
    }
  });

  it("every page named on the admin panel is a real route in the nav", () => {
    const known = new Set(NAV.flatMap((g) => [...g.items, ...(g.tools ?? [])]).map((i) => i.path));
    for (const p of NOTABLE_ADMIN_PATHS) expect(known, p).toContain(p);
  });

  it("opens exactly one page to a normal user: their own self-check", () => {
    // Normal users are only ever process owners. The list is an ALLOW-list so
    // that a page added later is closed by default, which is the direction a
    // mistake should fall.
    expect([...NORMAL_USER_PATHS]).toEqual(["/self-check"]);
    expect(isAdminOnlyPath("/self-check")).toBe(false);
    expect(NORMAL_USER_HOME).toBe("/self-check");
  });

  it("closes everything else, including the audit stages and the dashboard", () => {
    for (const p of ["/", "/help", "/findings", "/evidence-folder", "/scorecard", "/audit-cycle",
                     "/settings", "/gd4-scoring-setup", "/change-log", "/ai-calibration", "/prompt-review"]) {
      expect(isAdminOnlyPath(p), p).toBe(true);
    }
  });

  it("closes a page nobody has written yet", () => {
    expect(isAdminOnlyPath("/some-page-added-next-year")).toBe(true);
  });
});

describe("the screen is honest about what hiding does", () => {
  it("labels a page from the LIVE lock set, not from a hard-coded list", () => {
    const locked = new Set(["ucc-gd4-ai-settings:v1"]);
    expect(protectionFor("/settings", locked)).toBe("locked");
    expect(protectionFor("/settings", new Set())).toBe("hidden-only");
    expect(protectionFor("/change-log", locked)).toBe("hidden-only");
    expect(PROTECTION_LABEL["hidden-only"]).toContain("Hidden only");
  });

  it("says it does not know rather than guessing when the list cannot be read", () => {
    // A green "Locked" badge that is a guess is worse than no badge.
    expect(protectionFor("/settings")).toBe("unknown");
    expect(PROTECTION_MEANING.unknown).toMatch(/not a claim/i);
  });

  it("says the rest of the workspace is admin-only too, rather than listing thirty rows", () => {
    expect(EVERYTHING_ELSE_NOTE).toMatch(/every other page/i);
    expect(EVERYTHING_ELSE_NOTE).toMatch(/audit stages/i);
  });

  it("says plainly that reads are not restricted, including the OpenAI key", () => {
    expect(READ_CAVEAT).toMatch(/read all of this data/i);
    expect(READ_CAVEAT).toMatch(/OpenAI key/);
  });
});

describe("the second admin cannot become a chain", () => {
  it("only the root writes admin_grants", () => {
    expect(SQL).toMatch(/for insert to authenticated\s+with check \(public\.is_admin\(\)\)/);
    expect(SQL).toMatch(/for delete to authenticated\s+using \(public\.is_admin\(\)\)/);
    // NOT is_any_admin: a granted admin must not be able to grant. Comments
    // are stripped first, because the block explains that choice in prose.
    const grants = SQL
      .slice(SQL.indexOf("on public.admin_grants"), SQL.indexOf("create or replace function public.is_any_admin"))
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(grants).not.toContain("is_any_admin");
  });

  it("reads its own row without needing elevated rights, so no policy recurses", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.is_any_admin"));
    expect(fn.slice(0, fn.indexOf("$$;"))).not.toMatch(/security\s+definer/i);
  });

  it("lets any admin manage the sign-in list, but never remove the root's row", () => {
    expect(SQL).toMatch(/for insert to authenticated\s+with check \(public\.is_any_admin\(\)\)/);
    expect(SQL).toContain("and not public.is_admin_email(email_lc)");
  });

  it("locks the configuration rows to admins on both insert and update", () => {
    const hits = [...SQL.matchAll(/public\.is_any_admin\(\) or not public\.is_admin_only_row\(id\)/g)];
    expect(hits.length).toBe(3);   // insert's check, update's using, update's check
  });
});

// The guard is ONE seam, not a list: every page but the self-check renders
// inside the Layout, so a route added later is admin-only without anybody
// remembering to add it. If that seam moves, this fails.
describe("the workspace guard sits in the Layout", () => {
  const LAYOUT = readFileSync("src/components/layout/Layout.tsx", "utf8");
  const APP = readFileSync("src/App.tsx", "utf8");

  it("refuses a signed-in non-admin, and lands them on their own page", () => {
    expect(LAYOUT).toMatch(/session\.status === "signed-in" && !session\.isAdmin/);
    expect(LAYOUT).toContain("NORMAL_USER_HOME");
    expect(LAYOUT).toMatch(/pathname === "\/"/);
  });

  it("keeps the self-check outside the Layout, or the guard would refuse it too", () => {
    const outside = APP.slice(0, APP.indexOf("<Route element={<Layout />}>"));
    expect(outside).toContain('path="/self-check"');
  });

  it("no longer needs a per-route admin guard", () => {
    expect(APP).not.toContain("AdminRoute");
  });
});
