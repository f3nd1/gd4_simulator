import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { checksInScopeForSub, domainRowsFor, fnv1a, type DomainChecklistRow } from "../domainChecklist";
import { PARSED_DOMAIN_FILES } from "../../data/skills/domainExpertise";
import { checklistRowsForScope, toAuditInputs, toStoredVerdicts } from "../checklistLibraryRun";
import { useDomainChecklistStore } from "../../store/useDomainChecklistStore";
import type { ChecklistAuditRow } from "../ai/agentRuntime";

const row = (over: Partial<DomainChecklistRow>): DomainChecklistRow => ({
  id: "6-x", criterionId: "6", sectionKey: "What to check", sectionKind: "checks",
  subCriterionIds: [], text: "t", status: "built-in", custom: false, ...over,
});

afterEach(() => { useDomainChecklistStore.setState({ overrides: { edits: {}, removed: [], added: [] } }); });

describe("checksInScopeForSub", () => {
  it("includes an untagged check — it applies across its whole criterion", () => {
    expect(checksInScopeForSub([row({ subCriterionIds: [] })], "6.2")).toHaveLength(1);
  });
  it("includes a check tagged with the sub-criterion, or with one of its items", () => {
    expect(checksInScopeForSub([row({ subCriterionIds: ["6.2"] })], "6.2")).toHaveLength(1);
    expect(checksInScopeForSub([row({ subCriterionIds: ["6.2.1"] })], "6.2")).toHaveLength(1);
  });
  it("excludes a check tagged to a different sub-criterion", () => {
    expect(checksInScopeForSub([row({ subCriterionIds: ["6.3"] })], "6.2")).toHaveLength(0);
  });
  it("excludes another criterion's checks entirely", () => {
    expect(checksInScopeForSub([row({ criterionId: "5" })], "6.2")).toHaveLength(0);
  });
  // A draft reaches no prompt (composeDomainMarkdown filters on verified), and a
  // hidden check is removed from it. Assessing either would report a verdict on
  // text the model was never shown.
  it("excludes drafts and hidden checks, which never reach a prompt", () => {
    expect(checksInScopeForSub([row({ status: "custom-draft", custom: true })], "6.2")).toHaveLength(0);
    expect(checksInScopeForSub([row({ status: "removed" })], "6.2")).toHaveLength(0);
  });
});

describe("checklistRowsForScope — real library data", () => {
  it("finds a workable set of checks for every sub-criterion scope it is asked about", () => {
    for (const sub of ["1.1", "2.1.1", "4.1", "6.2", "7.1"]) {
      expect(checklistRowsForScope(sub).length, sub).toBeGreaterThan(0);
    }
  });
  // The 4.2 split runs as item ids, which match no checklist tag. Without the
  // resolve-to-parent step these scopes would silently drop every tagged check.
  it("resolves the split 4.2 run scopes to the checks 4.2 itself would get", () => {
    const whole = checklistRowsForScope("4.2").map((r) => r.id).sort();
    expect(checklistRowsForScope("4.2.1").map((r) => r.id).sort()).toEqual(whole);
    expect(checklistRowsForScope("4.2.2").map((r) => r.id).sort()).toEqual(whole);
  });
  it("drops a check that has been hidden in the Library", () => {
    const before = checklistRowsForScope("6.2");
    const victim = before[0].id;
    useDomainChecklistStore.setState({ overrides: { edits: {}, removed: [victim], added: [] } });
    expect(checklistRowsForScope("6.2").map((r) => r.id)).not.toContain(victim);
  });
  it("sends the CURRENT wording, so a verdict is never about text the AI was not shown", () => {
    const before = checklistRowsForScope("6.2");
    const target = before[0].id;
    useDomainChecklistStore.setState({ overrides: { edits: { [target]: "Completely rewritten check." }, removed: [], added: [] } });
    const inputs = toAuditInputs(checklistRowsForScope("6.2"));
    expect(inputs.find((i) => i.ref === target)!.text).toBe("Completely rewritten check.");
  });
});

describe("toStoredVerdicts", () => {
  const aiRow: ChecklistAuditRow = { checkId: "6-x", checkText: "t", verdict: "Met", rationale: "r", chunkIds: ["C001"], quote: "q" };
  it("stamps the hash of the text that was judged, so a later edit reads as stale", () => {
    const [v] = toStoredVerdicts([aiRow], { subCriterionId: "6.2", bucket: "policy", path: "A", runAt: "2026-09-14T00:00:00.000Z" });
    expect(v.sourceHash).toBe(fnv1a("t"));
    expect(v.sourceHash).not.toBe(fnv1a("t edited"));
  });
  it("carries the scope, bucket and path so two runs on one check stay distinguishable", () => {
    const [v] = toStoredVerdicts([aiRow], { subCriterionId: "4.2.1", bucket: "evidence", path: "B", runId: "FOLD-1", runAt: "x", model: "m" });
    expect(v).toMatchObject({ subCriterionId: "4.2.1", bucket: "evidence", path: "B", runId: "FOLD-1", model: "m" });
  });
  it("omits the quote entirely when the engine did not keep one", () => {
    const [v] = toStoredVerdicts([{ ...aiRow, verdict: "Not met", quote: undefined }], { subCriterionId: "6.2", bucket: "policy", path: "A", runAt: "x" });
    expect("quote" in v).toBe(false);
  });
});

// The Library page's standing promise is that it "scores nothing by itself".
// buildBandEvidenceDigest takes SpecificChecklistLine[] and nothing else, so the
// boundary holds as long as no scoring module ever reaches for these verdicts.
describe("scoring boundary", () => {
  const reads = (file: string) => readFileSync(file, "utf8");
  it("no scoring or banding module imports the checklist verdict store", () => {
    for (const f of ["src/lib/scoring.ts", "src/lib/checklistBanding.ts", "src/lib/consistencyChecker.ts", "src/lib/ai/agentRuntime.ts"]) {
      expect(reads(f), f).not.toContain("useChecklistVerdictStore");
    }
  });
  it("the band evidence digest still takes only checklist lines", () => {
    expect(reads("src/lib/ai/agentRuntime.ts")).toContain("function buildBandEvidenceDigest(specific: SpecificChecklistLine[])");
  });
  it("the library pass never writes to the checklist-line store", () => {
    expect(reads("src/lib/checklistLibraryRun.ts")).not.toContain("useChecklistModuleStore");
  });
});

// PARSED_DOMAIN_FILES is the shipped seed; a scope must never assess a check
// that does not exist in it.
describe("every assessed check is a real library check", () => {
  it("each in-scope id is present in the parsed criterion file", () => {
    const known = new Set(Object.values(PARSED_DOMAIN_FILES).flatMap((p) => domainRowsFor(p).map((r) => r.id)));
    for (const sub of ["1.1", "3.2", "6.2"]) {
      for (const r of checklistRowsForScope(sub)) expect(known.has(r.id), `${sub} ${r.id}`).toBe(true);
    }
  });
});
