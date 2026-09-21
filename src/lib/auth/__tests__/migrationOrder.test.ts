import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every .sql file in supabase/ is half of a pair: the other half is a deploy.
// The wrong order has broken this app twice — 02 run early would have stopped
// the live app saving, and 03 deployed early locked the whole team out
// (a43c855).
//
// Prose in a README is not a mechanism: somebody adds the next migration and
// the rule is a paragraph they did not read. This fails until the new file
// carries its order in its own header, where whoever is about to paste it
// into the SQL Editor is already looking.
const DIR = "supabase";
const sqlFiles = (): string[] => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const head = (file: string): string => readFileSync(join(DIR, file), "utf8").split("\n").slice(0, 12).join("\n");

describe("every migration states when it runs relative to the deploy", () => {
  it("finds the migrations", () => {
    expect(sqlFiles().length).toBeGreaterThan(0);
  });

  it("puts an ORDER banner in the first 12 lines of each one", () => {
    for (const f of sqlFiles()) expect(head(f), f).toContain("-- ORDER:");
  });

  it("says which side of the deploy each one falls on, not just that order matters", () => {
    // "Any time" is a valid answer, for a file no build depends on.
    for (const f of sqlFiles()) expect(head(f), f).toMatch(/RUN THIS (NOW|FIRST)|DEPLOY FIRST|Any time/i);
  });

  it("points each one at the README that explains the rule", () => {
    for (const f of sqlFiles()) expect(head(f), f).toContain("supabase/README.md");
  });

  it("states the rule in the README, so the banners have something to point at", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    expect(readme).toContain("breaks if it arrives alone");
    expect(readme).toMatch(/SQL first/i);
    expect(readme).toMatch(/deploy first/i);
    // Every migration is listed there too, so a new one cannot slip in silently.
    for (const f of sqlFiles()) expect(readme, f).toContain(f);
  });
});
