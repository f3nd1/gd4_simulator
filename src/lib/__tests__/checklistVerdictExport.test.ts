import { describe, it, expect } from "vitest";
import { assembleVerdictRows, buildChecklistVerdictCsv, VERDICT_EXPORT_HEADERS, NOT_YET_ASSESSED } from "../checklistVerdictExport";
import { fnv1a, domainRowsFor, type DomainChecklistRow } from "../domainChecklist";
import { PARSED_DOMAIN_FILES } from "../../data/skills/domainExpertise";
import { GD4_SUB_CRITERIA } from "../../data/gd4Requirements";
import { checklistRowsForScope } from "../checklistLibraryRun";
import type { StoredChecklistVerdict } from "../../store/useChecklistVerdictStore";

const check = (over: Partial<DomainChecklistRow> = {}): DomainChecklistRow => ({
  id: "6-x", criterionId: "6", sectionKey: "What to check", sectionKind: "checks",
  subCriterionIds: ["6.2"], text: "Management review is the apex loop.", status: "built-in", custom: false, ...over,
});

const verdict = (over: Partial<StoredChecklistVerdict> = {}): StoredChecklistVerdict => ({
  checkId: "6-x", subCriterionId: "6.2", bucket: "policy", verdict: "Met",
  rationale: "The QA manual documents the schedule.", quote: "run twice a year",
  chunkIds: ["C001"], sourceHash: fnv1a("Management review is the apex loop."),
  runId: "PPD-6.2-AAA", runAt: "2026-09-14T08:25:12.000Z", path: "A", ...over,
});

describe("assembleVerdictRows — one row per stored verdict", () => {
  it("emits a row per bucket, never a merged verdict", () => {
    const out = assembleVerdictRows([check()], [verdict(), verdict({ bucket: "evidence", verdict: "Not met", quote: undefined, runId: "EV-6.2-BBB", path: "B" })]);
    expect(out.map((r) => [r.bucket, r.verdict])).toEqual([["Evidence", "Not met"], ["Policy", "Met"]]);
    expect(out.map((r) => r.checkText)).toEqual([check().text, check().text]);
  });

  // A criterion-wide check is assessed once per sub-criterion audited. Without
  // "Assessed under" those rows would differ only in their verdict, with
  // nothing in the file saying which audit produced which.
  it("names the sub-criterion whose audit produced each verdict", () => {
    const wide = check({ subCriterionIds: [] });
    const out = assembleVerdictRows([wide], [
      verdict({ subCriterionId: "6.3", verdict: "Not met" }),
      verdict({ subCriterionId: "6.2", verdict: "Met" }),
    ]);
    expect(out.map((r) => [r.assessedUnder, r.verdict])).toEqual([["6.2", "Met"], ["6.3", "Not met"]]);
    expect(out[0].subCriterion).toBe("Criterion-wide");
    expect(out[0].ref).toBe("C6 (all)");
  });

  it("carries the audit path and run id so a disagreement is attributable", () => {
    const out = assembleVerdictRows([check()], [verdict({ path: "B", runId: "AR-6.2-WP15" })]);
    expect(out[0].path).toBe("Option B");
    expect(out[0].runId).toBe("AR-6.2-WP15");
    expect(out[0].assessedOn).toBe("2026-09-14 08:25");
  });

  it("flags a verdict recorded against older wording, matching the page's stale pill", () => {
    const out = assembleVerdictRows([check({ text: "Reworded since the audit." })], [verdict()]);
    expect(out[0].stale).toBe("Yes");
    expect(assembleVerdictRows([check()], [verdict()])[0].stale).toBe("");
  });

  it("ignores verdicts belonging to a different check", () => {
    expect(assembleVerdictRows([check()], [verdict({ checkId: "6-other" })])[0].verdict).toBe(NOT_YET_ASSESSED);
  });
});

describe("checks with no verdict are kept, not dropped", () => {
  it("gives an unassessed check one row with an honest state and no invented cells", () => {
    const [row] = assembleVerdictRows([check()], []);
    expect(row.verdict).toBe(NOT_YET_ASSESSED);
    expect([row.assessedUnder, row.bucket, row.rationale, row.quote, row.path, row.runId, row.assessedOn, row.stale]).toEqual(["", "", "", "", "", "", "", ""]);
    expect(row.checkText).toBe(check().text);
  });

  // The reason "Not yet assessed" is actionable rather than noise: it can only
  // ever mean "no audit has covered this area", never "this check is
  // unassessable". If a future edit orphaned a check this would fail.
  it("every shipped check is reachable by auditing some sub-criterion", () => {
    const all = Object.values(PARSED_DOMAIN_FILES).flatMap((p) => domainRowsFor(p));
    const reachable = new Set<string>();
    for (const s of GD4_SUB_CRITERIA) for (const r of checklistRowsForScope(s.id)) reachable.add(r.id);
    expect(all.filter((r) => !reachable.has(r.id)).map((r) => r.id)).toEqual([]);
    expect(reachable.size).toBe(all.length);
  });
});

describe("buildChecklistVerdictCsv", () => {
  it("writes the agreed header row", () => {
    expect(buildChecklistVerdictCsv([]).split("\r\n")[0]).toBe(VERDICT_EXPORT_HEADERS.join(","));
  });
  it("quotes a rationale containing a comma so the columns cannot shift", () => {
    const csv = buildChecklistVerdictCsv(assembleVerdictRows([check()], [verdict({ rationale: "Owner, frequency and record are all named." })]));
    expect(csv).toContain('"Owner, frequency and record are all named."');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
  // The stored rationale really does contain a newline (the "#N [chunk]:"
  // citation prefix sits on its own line), so without collapsing it every row
  // would span two lines in the file and read nothing like the screen.
  it("keeps one row on one line even when the stored rationale spans lines", () => {
    const out = assembleVerdictRows([check(), check({ id: "6-y", text: "Another check." })], [
      verdict({ rationale: "#1 [C001]:\nThe QA manual documents the schedule." }),
      verdict({ bucket: "evidence" }),
    ]);
    expect(out.find((r) => r.bucket === "Policy")!.rationale).toBe("#1 [C001]: The QA manual documents the schedule.");
    expect(buildChecklistVerdictCsv(out).split("\r\n")).toHaveLength(out.length + 1);
  });
});
