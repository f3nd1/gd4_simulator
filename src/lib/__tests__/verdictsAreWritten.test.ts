import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checklistRowsForScope } from "../checklistLibraryRun";
import { GD4_SUB_CRITERIA } from "../../data/gd4Requirements";
import { runScopesForSub } from "../evidenceScope";
import { NEVER_LOCKABLE } from "../auth/pageAccess";

// WHY THIS EXISTS: ucc-gd4-checklist-verdicts:v1 is on the never-lockable
// list, refused by a CHECK constraint in
// supabase/07-locks-live-in-a-table.sql. That is only correct while an
// ordinary self-check run really does write it. The Network tab could not
// settle it, so the chain is pinned here instead:
//
//   runPPDReview / runEvidenceAssessment
//     -> runChecklistLibraryPass         (both self-check passes)
//       -> early return ONLY when the scope has no library checks
//       -> useChecklistVerdictStore.putRun(...)   unconditional otherwise
//
// If any link breaks, that store may become genuinely lockable and the
// constraint should be revisited. This test is what makes that visible.
const RUN = readFileSync("src/lib/checklistLibraryRun.ts", "utf8");
const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");

describe("a self-check run writes the checklist verdicts", () => {
  it("is called by BOTH self-check passes, not only by the staged audit", () => {
    const callers = [...STORE.matchAll(/^      ([a-zA-Z]+): async/gm)];
    const enclosing = (idx: number) => callers.filter((m) => m.index! < idx).pop()?.[1];
    const calls = [...STORE.matchAll(/runChecklistLibraryPass\(\{/g)].map((m) => enclosing(m.index!));
    expect(calls).toContain("runPPDReview");
    expect(calls).toContain("runEvidenceAssessment");
  });

  it("stores the verdicts unconditionally once the pass has run", () => {
    // The only escape is the empty-scope early return above it.
    const body = RUN.slice(RUN.indexOf("const result = await runChecklistLibraryAudit"));
    expect(body).toContain("useChecklistVerdictStore.getState().putRun(stored)");
    const between = body.slice(0, body.indexOf("putRun"));
    expect(between, "putRun must not sit behind a condition").not.toMatch(/\bif\s*\(/);
  });

  it("finds library checks in EVERY runnable scope, so the early return never fires", () => {
    const scopes = GD4_SUB_CRITERIA.flatMap((s) => runScopesForSub(s.id));
    expect(scopes.length).toBeGreaterThan(0);
    const empty = scopes.filter((sc) => checklistRowsForScope(sc).length === 0);
    expect(empty, `these scopes would skip the verdicts pass: ${empty.join(", ")}`).toEqual([]);
  });

  it("keeps the store on the never-lockable list while all of the above holds", () => {
    expect(Object.keys(NEVER_LOCKABLE)).toContain("ucc-gd4-checklist-verdicts:v1");
  });
});
