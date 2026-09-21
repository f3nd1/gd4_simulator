import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// An earlier Settings page printed, as the "required table" snippet:
//
//   create policy "anon read/write" on public.workspace_state
//     for all using (true) with check (true);
//
// Anybody who followed it granted the entire workspace to the publishable
// key that ships in the browser bundle. It survived scripts 01 and 02
// because both drop policies BY NAME, and that name appears in neither.
//
// So: no permissive policy may be written ANYWHERE in this repo again, and
// the app must not print SQL policies at all. A copy of a security rule
// inside the app is a second source of truth nobody updates.
const SRC_DIRS = ["src"];

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return allFiles(full);
    return /\.(ts|tsx|md)$/.test(e.name) ? [full] : [];
  });
}

describe("no open policy can be reintroduced", () => {
  const sql = readdirSync("supabase").filter((f) => f.endsWith(".sql"));

  it("no migration grants a policy to anon or public, or on ALL commands", () => {
    for (const f of sql) {
      const body = readFileSync(join("supabase", f), "utf8");
      // Only the create statements; the sweep in 05 names these to REMOVE them.
      for (const block of body.split(/create policy/i).slice(1)) {
        const head = block.slice(0, block.indexOf(";") + 1 || 400);
        expect(head, `${f}: policy granted to anon/public`).not.toMatch(/\bto\s+(anon|public)\b/i);
        expect(head, `${f}: policy covers ALL commands`).not.toMatch(/\bfor\s+all\b/i);
        expect(head, `${f}: unconditional using (true)`).not.toMatch(/using\s*\(\s*true\s*\)/i);
      }
    }
  });

  it("every migration's policies are restricted to the authenticated role", () => {
    for (const f of sql) {
      for (const block of readFileSync(join("supabase", f), "utf8").split(/create policy/i).slice(1)) {
        expect(block.slice(0, 200), `${f}`).toMatch(/to authenticated/);
      }
    }
  });

  it("the app never prints a CREATE POLICY for anyone to copy", () => {
    // Test files may name one in a comment; shipped source may not print one.
    for (const dir of SRC_DIRS) {
      for (const file of allFiles(dir)) {
        if (file.includes("__tests__")) continue;
        const body = readFileSync(file, "utf8");
        // Ignore explanatory comments; catch it in rendered strings.
        const code = body.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
        expect(code, file).not.toMatch(/create\s+policy\s+"/i);
      }
    }
  });

  it("05 sweeps by exclusion rather than by name, so a hand-made policy is caught", () => {
    const five = readFileSync("supabase/05-close-the-anon-hole.sql", "utf8");
    expect(five).toMatch(/policyname not in \('allowed read', 'allowed insert', 'allowed update'\)/);
    expect(five).toMatch(/drop policy %I on public\.workspace_state/);
    // drive_oauth_tokens keeps NO policies at all.
    expect(five).toMatch(/tablename = 'drive_oauth_tokens'\s*\n\s*loop/);
    // And it refuses rather than sweeping a table down to zero policies.
    expect(five).toContain("Refusing to run");
  });
});
