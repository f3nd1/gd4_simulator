import { describe, it, expect } from "vitest";
import { buildProvenance, provenanceLine } from "../provenance";
import { buildBoardSummaryMd } from "../boardSummary";
import { buildFindingsRegisterCsv } from "../auditCsvExport";
import type { Finding } from "../../types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1", auditCycleId: "cycle-1", gd4ItemId: "4.4.1", issue: "Refund table mismatch",
    type: "AFI", severity: "Medium", owner: "SQ", dueDate: "2026-08-01", repeatFinding: false,
    overdue: false, managementDecisionNeeded: false, status: "Open", ...over,
  };
}

describe("buildProvenance / provenanceLine (Batch 4)", () => {
  const items = [
    { started: true }, { started: false, checklistOverride: { eff: 60 } }, { started: false },
  ];
  const folders = [
    { lastAuditAt: "2026-06-28T10:00:00Z", lastAuditLive: true, lastAuditAuditor: "Rachel Tan (strictness: Balanced)" },
    { lastAuditAt: "2026-07-04T09:00:00Z", lastAuditLive: false, lastAuditAuditor: "Rachel Tan (strictness: Balanced)" },
    { /* never audited */ },
  ];

  it("counts assessed items (started OR checklist-scored), audited folders, offline runs", () => {
    const p = buildProvenance(items, folders, ["gpt-5-mini", "gpt-5-mini", undefined]);
    expect(p.assessedItems).toBe(2);
    expect(p.totalItems).toBe(3);
    expect(p.auditedSubCriteria).toBe(2);
    expect(p.totalSubCriteria).toBe(3);
    expect(p.offlineSubCriteria).toBe(1);
    expect(p.earliestAuditAt).toBe("2026-06-28T10:00:00Z");
    expect(p.latestAuditAt).toBe("2026-07-04T09:00:00Z");
    expect(p.models).toEqual(["gpt-5-mini"]); // deduped
    expect(p.auditors).toEqual(["Rachel Tan"]); // strictness suffix stripped, deduped
  });

  it("provenanceLine states coverage, date range, offline warning, model and auditor", () => {
    const line = provenanceLine(buildProvenance(items, folders, ["gpt-5-mini"]));
    expect(line).toContain("Assessed 2 of 3 GD4 items");
    expect(line).toContain("2 of 3 sub-criteria audited");
    expect(line).toContain("28 Jun 2026");
    expect(line).toContain("04 Jul 2026");
    expect(line).toContain("⚠ 1 offline-estimate");
    expect(line).toContain("model gpt-5-mini");
    expect(line).toContain("auditor Rachel Tan");
  });

  it("a blank workspace reads honestly as zero coverage", () => {
    const line = provenanceLine(buildProvenance([{ started: false }], [{}], []));
    expect(line).toContain("Assessed 0 of 1");
    expect(line).toContain("0 of 1 sub-criteria audited");
    expect(line).not.toContain("offline");
  });
});

describe("buildBoardSummaryMd (Batch 4)", () => {
  it("produces the one-pager: headline, gates, bands, top risks, coverage, disclaimer", () => {
    const md = buildBoardSummaryMd({
      cycleName: "UCC Pre-audit 2026",
      periodStart: "2026-01-01", periodEnd: "2026-12-31",
      generatedAt: new Date("2026-07-04T10:00:00Z"),
      total: 612, award: "EduTrust Provisional", gatePass: false, gateFailIds: ["4.2.1"],
      crits: [{ id: "1", title: "Leadership", band: 3 }],
      findings: [
        finding({ id: "F-A", findingType: "NC", ncSeverity: "Major", riskCategory: "A", issue: "Fees before contract" }),
        finding({ id: "F-B", findingType: "OFI", issue: "minor doc gap" }),
        finding({ id: "F-C", findingType: "NC", ncSeverity: "Minor", issue: "closed one" }),
      ],
      isClosed: (id) => id === "F-C",
      provenance: buildProvenance([{ started: true }], [{ lastAuditAt: "2026-07-01T00:00:00Z", lastAuditLive: true }], ["gpt-5-mini"]),
    });
    expect(md).toContain("**612 / 1000 — EduTrust Provisional**");
    expect(md).toContain("NOT MET (4.2.1)");
    expect(md).toContain("**2 open** (1 Major NC · 0 Minor NC) · 1 closed");
    expect(md).toContain("C1 Leadership: **Band 3**");
    expect(md).toContain("Fees before contract"); // Cat A tops the risks
    expect(md).toContain("Cat A");
    expect(md).toContain("Assessed 1 of 1 GD4 items");
    expect(md).toContain("Not an official SSG/EduTrust result");
  });
});

describe("buildFindingsRegisterCsv (Batch 4)", () => {
  it("carries classification + audit trail + closure narrative", () => {
    const csv = buildFindingsRegisterCsv(
      [finding({ findingType: "NC", ncSeverity: "Major", riskCategory: "A", source: "PPD Review", auditRunId: "AR-4.4-XYZ", createdAt: "2026-07-01T08:00:00Z", rootCause: "fw root" })],
      { "F-1": { root: "closure root", corr: "fix it", prev: "prevent it", evid: "https://drive/x", human: "Accepted" } },
    );
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Audit run");
    expect(header).toContain("Closure evidence");
    expect(row).toContain("NC");
    expect(row).toContain("Major");
    expect(row).toContain("PPD Review");
    expect(row).toContain("AR-4.4-XYZ");
    expect(row).toContain("2026-07-01T08:00:00Z");
    expect(row).toContain("Closed");
    expect(row).toContain("closure root"); // closure store wins over the finding-writer draft
    expect(row).toContain("https://drive/x");
  });
});
