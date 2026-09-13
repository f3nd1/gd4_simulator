import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMAIN_SKILL_CONSUMERS, DOMAIN_SKILL_SOURCE_FILES } from "../domainSkillUsage";

const REPO_ROOT = join(__dirname, "..", "..", "..");

// Walks back from a call site to the function that encloses it.
function enclosingFunctions(source: string, needle: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(needle)) return;
    for (let j = i; j >= 0; j--) {
      const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(lines[j]);
      if (m) {
        if (!found.includes(m[1])) found.push(m[1]);
        break;
      }
    }
  });
  return found;
}

describe("domain-skill 'where used' map is derived from the real code", () => {
  // The Audit Checklist Library page tells the user which AI calls consume the
  // checklist they are editing. If that claim were hand-maintained it would rot
  // the first time someone added a consumer. This test re-derives it.
  it("lists exactly the functions that call domainExpertiseFor()", () => {
    const actual = new Set<string>();
    for (const rel of DOMAIN_SKILL_SOURCE_FILES) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      for (const fn of enclosingFunctions(src, "domainExpertiseFor(")) actual.add(fn);
    }

    const listed = new Set(DOMAIN_SKILL_CONSUMERS.map((c) => c.fn));
    const missing = [...actual].filter((f) => !listed.has(f));
    const stale = [...listed].filter((f) => !actual.has(f));

    expect(missing, `New consumer(s) of domainExpertiseFor() are not listed in domainSkillUsage.ts: ${missing.join(", ")}`).toEqual([]);
    expect(stale, `domainSkillUsage.ts lists function(s) that no longer consume the domain skill: ${stale.join(", ")}`).toEqual([]);
  });

  it("points every consumer at the file it actually lives in", () => {
    for (const c of DOMAIN_SKILL_CONSUMERS) {
      const src = readFileSync(join(REPO_ROOT, c.file), "utf8");
      expect(enclosingFunctions(src, "domainExpertiseFor("), `${c.fn} is not in ${c.file}`).toContain(c.fn);
    }
  });

  it("gives every consumer a human-readable surface", () => {
    for (const c of DOMAIN_SKILL_CONSUMERS) expect(c.surface.trim().length, c.fn).toBeGreaterThan(5);
  });
});
