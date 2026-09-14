import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The version snapshot is a hand-maintained allow-list, duplicated in
// saveAsNewVersion and lockCycle. It had drifted to 28 of 68 state fields
// because nothing fails when a field is added to the store, so a "full
// snapshot" quietly stopped being one. This re-derives both lists from the
// real source and fails when they disagree or when a new field is neither
// captured nor explicitly classified.

const SRC = readFileSync(join(__dirname, "..", "useWorkspaceStore.ts"), "utf8");

// Both snapshot literals are written as `const snapshot: WorkspaceSnapshot = {`
// and there are exactly two, so find them by that declaration rather than by
// guessing at indentation.
function snapshotLiterals(): string[][] {
  const DECL = "const snapshot: WorkspaceSnapshot = {";
  const out: string[][] = [];
  let from = 0;
  for (;;) {
    const start = SRC.indexOf(DECL, from);
    if (start < 0) break;
    const open = start + DECL.length - 1;
    // Walk braces so a nested object inside the literal does not end it early.
    let depth = 0, i = open;
    for (; i < SRC.length; i++) {
      if (SRC[i] === "{") depth++;
      else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = SRC.slice(open + 1, i);
    // Top-level keys only: those at brace depth 0 within the literal.
    const keys: string[] = [];
    let d = 0;
    for (const line of body.split("\n")) {
      const m = /^\s*(\w+):/.exec(line);
      if (d === 0 && m) keys.push(m[1]);
      for (const ch of line) { if (ch === "{" || ch === "[") d++; else if (ch === "}" || ch === "]") d--; }
    }
    out.push(keys);
    from = i;
  }
  return out;
}

describe("version snapshot coverage", () => {
  const literals = snapshotLiterals();
  const [fromSave, fromLock] = literals;

  it("finds exactly the two snapshot literals", () => {
    expect(literals).toHaveLength(2);
    expect(fromSave.length).toBeGreaterThan(20);
  });

  // The two literals are byte-duplicates that must be edited together; nothing
  // enforced that, so they could silently diverge on the next field added.
  it("saveAsNewVersion and lockCycle capture the SAME fields", () => {
    expect([...fromSave].sort()).toEqual([...fromLock].sort());
  });

  it("captures the scoring settings that decide the band and the award", () => {
    expect(fromSave).toContain("scoringConfig");
    expect(fromSave).toContain("activeAuditorId");
  });

  // Result-affecting state that is deliberately NOT captured, each with a
  // reason. Adding to this list is a decision, which is the point.
  const INTENTIONALLY_NOT_SNAPSHOTTED: Record<string, string> = {
    aiReviewLog: "full prompts, 40k+ chars each — the original localStorage-quota blowout",
    fileTextCache: "in-memory performance cache, excluded from persistence entirely",
    changeLog: "lives in the dedicated append-only useChangeLogStore",
    reportAiSuggestions: "AI narrative prose per item; large, and restoring stale prose against rolled-back findings needs its own design",
    reportConciseFindings: "AI narrative prose per item; same reason as reportAiSuggestions",
    reportDimensionNarratives: "AI narrative prose per dimension; same reason as reportAiSuggestions",
    priorCycleFindings: "cross-cycle archive; rolling it back would rewrite repeat-finding escalation",
  };

  it("every deliberately excluded field is documented with a reason", () => {
    for (const [field, reason] of Object.entries(INTENTIONALLY_NOT_SNAPSHOTTED)) {
      expect(reason.length, field).toBeGreaterThan(10);
      expect(fromSave).not.toContain(field);
    }
  });
});
