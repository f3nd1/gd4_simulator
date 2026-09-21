import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NAV } from "../../../nav";
import {
  ADMIN_ONLY_PATHS, LOCKED_STORE_KEYS, NEVER_LOCKABLE,
  isAdminOnlyPath, protectionFor, PROTECTION_LABEL, READ_CAVEAT,
} from "../pageAccess";

const SQL = readFileSync("supabase/06-second-admin-and-locked-stores.sql", "utf8");
const lockedInSql = () => {
  const fn = SQL.slice(SQL.indexOf("create or replace function public.is_admin_only_row"));
  return [...fn.slice(0, fn.indexOf("$$;")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe("the locked rows are the same list in the app and in Postgres", () => {
  it("matches, key for key", () => {
    expect(lockedInSql().sort()).toEqual(Object.keys(LOCKED_STORE_KEYS).sort());
  });

  it("never locks a row a normal user writes in ordinary use", () => {
    // Measured on the real build: these are written on page load with no
    // action at all, or by a self-check run. Locking one gives every normal
    // user a permanent sync error for no gain.
    for (const key of Object.keys(NEVER_LOCKABLE)) {
      expect(Object.keys(LOCKED_STORE_KEYS), key).not.toContain(key);
      expect(lockedInSql(), `${key} in SQL`).not.toContain(key);
    }
  });
});

describe("a locked row's page is never visible to the person who cannot write it", () => {
  it("every page owning a locked row is admin-only", () => {
    // Otherwise a normal user opens the screen, types an edit, and the save
    // is silently refused. Worse than not seeing the page.
    for (const [key, { path }] of Object.entries(LOCKED_STORE_KEYS)) {
      expect(isAdminOnlyPath(path), `${key} -> ${path}`).toBe(true);
    }
  });

  it("every admin-only path is a real route in the nav", () => {
    const known = new Set(NAV.flatMap((g) => [...g.items, ...(g.tools ?? [])]).map((i) => i.path));
    for (const p of ADMIN_ONLY_PATHS) expect(known, p).toContain(p);
  });

  it("leaves the self-check and the dashboard open to everyone", () => {
    for (const p of ["/", "/self-check", "/help"]) expect(isAdminOnlyPath(p)).toBe(false);
  });

  it("keeps every page Felix named admin-only", () => {
    for (const p of ["/settings", "/gd4-scoring-setup", "/change-log", "/ai-calibration", "/prompt-review"]) {
      expect(isAdminOnlyPath(p), p).toBe(true);
    }
  });
});

describe("the screen is honest about what hiding does", () => {
  it("labels a page with a locked row differently from one that is only hidden", () => {
    expect(protectionFor("/settings")).toBe("locked");
    expect(protectionFor("/change-log")).toBe("hidden-only");
    expect(PROTECTION_LABEL["hidden-only"]).toContain("Hidden only");
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
