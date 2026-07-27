import { describe, it, expect } from "vitest";
import { buildRequirementRows, buildRequirementsCsv, buildRequirementsPdfHtml } from "../requirementsReference";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";

describe("buildRequirementRows — official text only, no run needed", () => {
  it("returns rows for a sub-criterion with no audit state whatsoever", () => {
    // The function takes only a scope id: there is no run, store or Drive
    // input it could read, which is exactly why it works pre-audit.
    const rows = buildRequirementRows("6.3");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.itemId === "6.3.1")).toBe(true);
  });

  it("carries no verdict, status or evidence field of any kind", () => {
    const keys = new Set(Object.keys(buildRequirementRows("1.1")[0]));
    for (const banned of ["verdict", "status", "found", "coverage", "evidenceFiles"]) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it("reproduces the official text verbatim from GD4_REQUIREMENTS", () => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === "6.3.1")!;
    const rows = buildRequirementRows("6.3");
    for (const p of req.flatAuditPoints ?? []) {
      expect(rows.some((r) => r.ref === p.ref && r.text === p.text)).toBe(true);
    }
  });

  it("emits the parent bullet once, before its lettered children", () => {
    // 2.1.1.DS1 splits into lettered sub-items (a, b, c...). NOTE: the
    // sub-criterion id here really is "2.1.1" — criterion 2's sub-criteria are
    // three-part ids, not "2.1".
    const rows = buildRequirementRows("2.1.1");
    const parentIdx = rows.findIndex((r) => r.ref === "2.1.1.DS1");
    const firstChildIdx = rows.findIndex((r) => r.ref === "2.1.1.DS1.a");
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(firstChildIdx).toBe(parentIdx + 1);
    expect(rows[parentIdx].isChild).toBe(false);
    expect(rows[firstChildIdx].isChild).toBe(true);
    // Exactly one parent row for that bullet, however many children it has.
    expect(rows.filter((r) => r.ref === "2.1.1.DS1")).toHaveLength(1);
  });

  it("splits 4.2 per item, matching the rest of the app's scope rule", () => {
    expect(new Set(buildRequirementRows("4.2.1").map((r) => r.itemId))).toEqual(new Set(["4.2.1"]));
    expect(new Set(buildRequirementRows("4.2.2").map((r) => r.itemId))).toEqual(new Set(["4.2.2"]));
  });

  it("covers every GD4 sub-criterion — no scope renders empty", () => {
    const subs = [...new Set(GD4_REQUIREMENTS.map((r) => r.subCriterionId))];
    for (const sub of subs) expect(buildRequirementRows(sub).length).toBeGreaterThan(0);
  });
});

describe("official requirements export", () => {
  it("CSV has the four plain columns and never labels a column as assessed evidence", () => {
    const csv = buildRequirementsCsv("6.3");
    const header = csv.split("\r\n")[0];
    expect(header).toBe("Item,Ref,Section,Official Requirement Text");
    for (const banned of ["Verdict", "Found", "Not found", "Supporting Passage", "Evidence File"]) {
      expect(csv).not.toContain(banned);
    }
  });

  it("CSV carries the pre-audit note, so an exported file cannot read as an assessment", () => {
    expect(buildRequirementsCsv("6.3")).toContain("Nothing here has been checked against any document");
  });

  it("PDF says it is not an assessment and renders the real requirement text", () => {
    const html = buildRequirementsPdfHtml("6.3");
    expect(html).toContain("Official requirements");
    expect(html).toContain("Nothing here has been checked against any document");
    const first = buildRequirementRows("6.3")[0];
    expect(html).toContain(first.ref);
  });
});
