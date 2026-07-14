import { describe, it, expect } from "vitest";
import {
  sourceRefPrefix,
  warrantsLine,
  classifyGapType,
  groupSeverity,
  groupRiskCategory,
  buildEvidenceStatusSummary,
  groupWeakLines,
  synthesiseApsrFromGroup,
} from "../findingGrouper";
import type { SpecificChecklistLine, GD4Requirement, ApsrBreakdown, ChecklistLineGroup } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<SpecificChecklistLine> = {}): SpecificChecklistLine {
  return {
    id: "L1",
    text: "The institution has a documented student support policy.",
    status: "Not met",
    evidence: [],
    generatedBy: "ai",
    ...overrides,
  };
}

function makeReq(overrides: Partial<GD4Requirement> = {}): GD4Requirement {
  return {
    id: "4.5.1",
    criterion: "4",
    area: "Student Support",
    subCriterionId: "4.5",
    itemNumber: "4.5.1",
    requirement: "The institution provides student support services.",
    intent: "Ensure students receive adequate support.",
    describeShow: ["Describe the student support framework.", "Show evidence of support services."],
    notes: [],
    maxPoints: 10,
    weightage: 5,
    gateSensitive: false,
    expectedEvidence: ["Student Support Policy", "Counselling Records"],
    ...overrides,
  };
}

function makeApsr(overrides: Partial<{
  approachStatus: ApsrBreakdown["approach"]["status"];
  processesStatus: ApsrBreakdown["processes"]["status"];
  soStatus: ApsrBreakdown["systemsOutcomes"]["status"];
  reviewStatus: ApsrBreakdown["review"]["status"];
}> = {}): ApsrBreakdown {
  return {
    approach:        { status: overrides.approachStatus  ?? "Meeting",    note: "Approach note" },
    processes:       { status: overrides.processesStatus ?? "Deployed",   note: "Processes note" },
    systemsOutcomes: { status: overrides.soStatus        ?? "Evident",    note: "SO note" },
    review:          { status: overrides.reviewStatus    ?? "Evident",    note: "Review note" },
  };
}

function lineWithApsr(apsr: ApsrBreakdown, overrides: Partial<SpecificChecklistLine> = {}): SpecificChecklistLine {
  return makeLine({
    evidence: [{ id: "e1", title: "Evidence", type: "PDF", owner: "SQ", date: "2025-01-01", approved: true, reviewed: true, sufficiency: "Present", apsr }],
    ...overrides,
  });
}

// ── sourceRefPrefix ───────────────────────────────────────────────────────────

describe("sourceRefPrefix", () => {
  it("strips single-letter sub-item suffix from lettered points", () => {
    expect(sourceRefPrefix("6.2.1.DS1.a")).toBe("6.2.1.DS1");
  });

  it("strips .b suffix", () => {
    expect(sourceRefPrefix("6.2.1.DS1.b")).toBe("6.2.1.DS1");
  });

  it("strips .z suffix", () => {
    expect(sourceRefPrefix("4.5.1.DS2.z")).toBe("4.5.1.DS2");
  });

  it("returns unchanged when there is no letter suffix", () => {
    expect(sourceRefPrefix("6.2.1.DS2")).toBe("6.2.1.DS2");
  });

  it("returns unchanged for numeric ref without suffix", () => {
    expect(sourceRefPrefix("4.5.1")).toBe("4.5.1");
  });

  it("returns empty string for undefined", () => {
    expect(sourceRefPrefix(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(sourceRefPrefix("")).toBe("");
  });
});

// ── warrantsLine ─────────────────────────────────────────────────────────────

describe("warrantsLine", () => {
  it("includes Not met lines", () => {
    expect(warrantsLine(makeLine({ status: "Not met" }))).toBe(true);
  });

  it("includes Partial lines", () => {
    expect(warrantsLine(makeLine({ status: "Partial" }))).toBe(true);
  });

  it("includes Met lines with Missing evidence (unverifiable claim)", () => {
    const line = makeLine({ status: "Met", evidence: [] }); // no evidence = Missing
    expect(warrantsLine(line)).toBe(true);
  });

  it("excludes Met lines with Present evidence", () => {
    const line = makeLine({
      status: "Met",
      evidence: [{ id: "e1", title: "T", type: "PDF", owner: "SQ", date: "2025-01-01", approved: true, reviewed: true, sufficiency: "Present" }],
    });
    expect(warrantsLine(line)).toBe(false);
  });

  it("excludes Not Applicable lines", () => {
    expect(warrantsLine(makeLine({ status: "Not Applicable" }))).toBe(false);
  });

  it("excludes lines that already have a savedFindingId", () => {
    const line = makeLine({
      status: "Not met",
      draftFinding: { gd4ItemId: "4.5.1", issue: "...", severity: "Medium", suggestedAction: "...", savedFindingId: "CKL-123" },
    });
    expect(warrantsLine(line)).toBe(false);
  });

  it("excludes Not Started lines", () => {
    expect(warrantsLine(makeLine({ status: "Not Started" }))).toBe(false);
  });
});

// ── classifyGapType ───────────────────────────────────────────────────────────

describe("classifyGapType", () => {
  it("maps apsrDimension=Approach → Documentation/Approach", () => {
    const line = makeLine({ status: "Not met", apsrDimension: "Approach" });
    expect(classifyGapType(line)).toBe("Documentation/Approach");
  });

  it("maps apsrDimension=Processes → Implementation/Process", () => {
    const line = makeLine({ status: "Not met", apsrDimension: "Processes" });
    expect(classifyGapType(line)).toBe("Implementation/Process");
  });

  it("maps apsrDimension=Systems & Outcomes → Outcome/Data", () => {
    const line = makeLine({ status: "Not met", apsrDimension: "Systems & Outcomes" });
    expect(classifyGapType(line)).toBe("Outcome/Data");
  });

  it("maps apsrDimension=Review → Review/ContinualImprovement", () => {
    const line = makeLine({ status: "Not met", apsrDimension: "Review" });
    expect(classifyGapType(line)).toBe("Review/ContinualImprovement");
  });

  it("falls back to findingDimension when no apsrDimension (Not met, no APSR data → Evidence gap)", () => {
    const line = makeLine({ status: "Not met" }); // no apsrDimension, no evidence with APSR
    expect(classifyGapType(line)).toBe("Implementation/Process");
  });

  it("uses APSR data fallback: approach Not evident → Documentation/Approach", () => {
    const apsr = makeApsr({ approachStatus: "Not evident" });
    const line = lineWithApsr(apsr, { status: "Not met" });
    expect(classifyGapType(line)).toBe("Documentation/Approach");
  });

  it("uses APSR data fallback: processes Not evident with meeting approach → Implementation/Process", () => {
    const apsr = makeApsr({ approachStatus: "Meeting", processesStatus: "Not evident" });
    const line = lineWithApsr(apsr, { status: "Not met" });
    expect(classifyGapType(line)).toBe("Implementation/Process");
  });

  it("uses Unverified for Met lines with no evidence → EvidenceTraceability", () => {
    const line = makeLine({ status: "Met", evidence: [] }); // no APSR attached → Unverified
    expect(classifyGapType(line)).toBe("EvidenceTraceability");
  });
});

// ── groupSeverity / groupRiskCategory ────────────────────────────────────────

describe("groupSeverity", () => {
  it("returns High for gate-sensitive requirements", () => {
    const req = makeReq({ gateSensitive: true });
    expect(groupSeverity([], req)).toBe("High");
  });

  it("returns Medium for non-gate-sensitive requirements", () => {
    const req = makeReq({ gateSensitive: false });
    expect(groupSeverity([], req)).toBe("Medium");
  });
});

describe("groupRiskCategory", () => {
  it("returns A for Criterion 4 student-protection items", () => {
    const req = makeReq({ subCriterionId: "4.2" });
    const lines = [makeLine({ status: "Not met" })];
    expect(groupRiskCategory(lines, req)).toBe("A");
  });

  it("returns B for gate-sensitive non-Criterion-4 items", () => {
    const req = makeReq({ gateSensitive: true, criterion: "5", subCriterionId: "5.1" });
    const lines = [makeLine({ status: "Not met" })];
    expect(groupRiskCategory(lines, req)).toBe("B");
  });

  it("returns C for non-gate-sensitive non-regulatory items", () => {
    const req = makeReq({ gateSensitive: false, criterion: "6", subCriterionId: "6.2" });
    const lines = [makeLine({ status: "Not met" })];
    expect(groupRiskCategory(lines, req)).toBe("C");
  });
});

// ── buildEvidenceStatusSummary ────────────────────────────────────────────────

describe("buildEvidenceStatusSummary", () => {
  const makeLineWithSuff = (suff: "Present" | "Weak" | "Missing"): SpecificChecklistLine =>
    makeLine({
      status: "Not met",
      evidence: suff === "Missing" ? [] : [{ id: "e1", title: "T", type: "PDF", owner: "SQ", date: "2025-01-01", approved: true, reviewed: true, sufficiency: suff }],
    });

  it("counts Missing lines correctly", () => {
    const summary = buildEvidenceStatusSummary([makeLineWithSuff("Missing"), makeLineWithSuff("Missing")]);
    expect(summary).toContain("2 lines with missing evidence");
  });

  it("counts Weak lines correctly", () => {
    const summary = buildEvidenceStatusSummary([makeLineWithSuff("Weak")]);
    expect(summary).toContain("1 line with weak evidence");
  });

  it("counts Present lines", () => {
    const summary = buildEvidenceStatusSummary([makeLineWithSuff("Present")]);
    expect(summary).toContain("1 line with present evidence");
  });

  it("combines multiple categories in the summary", () => {
    const lines = [makeLineWithSuff("Missing"), makeLineWithSuff("Weak"), makeLineWithSuff("Present")];
    const summary = buildEvidenceStatusSummary(lines);
    expect(summary).toContain("missing");
    expect(summary).toContain("weak");
    expect(summary).toContain("present");
  });

  it("returns fallback string when no issues", () => {
    const summary = buildEvidenceStatusSummary([]);
    expect(summary).toBe("No evidence issues detected");
  });
});

// ── groupWeakLines ────────────────────────────────────────────────────────────

describe("groupWeakLines", () => {
  const req = makeReq();

  it("returns empty array when all lines are Met with Present evidence", () => {
    const line = makeLine({
      status: "Met",
      evidence: [{ id: "e1", title: "T", type: "PDF", owner: "SQ", date: "2025-01-01", approved: true, reviewed: true, sufficiency: "Present" }],
    });
    expect(groupWeakLines([line], req.id, req)).toHaveLength(0);
  });

  it("groups same-gapType same-prefix lines together", () => {
    const a = makeLine({ id: "La", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS1.a" });
    const b = makeLine({ id: "Lb", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS1.b" });
    const groups = groupWeakLines([a, b], req.id, req);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(2);
  });

  it("keeps different-gapType lines in separate groups", () => {
    const a = makeLine({ id: "La", status: "Not met", apsrDimension: "Approach",  sourceRef: "4.5.1.DS1" });
    const b = makeLine({ id: "Lb", status: "Not met", apsrDimension: "Processes", sourceRef: "4.5.1.DS2" });
    const groups = groupWeakLines([a, b], req.id, req);
    expect(groups).toHaveLength(2);
  });

  it("keeps same-gapType but different-prefix lines separate", () => {
    const a = makeLine({ id: "La", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS1" });
    const b = makeLine({ id: "Lb", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS2" });
    const groups = groupWeakLines([a, b], req.id, req);
    expect(groups).toHaveLength(2);
  });

  it("skips lines with savedFindingId", () => {
    const saved = makeLine({
      status: "Not met",
      draftFinding: { gd4ItemId: "4.5.1", issue: "...", severity: "Medium", suggestedAction: "...", savedFindingId: "CKL-999" },
    });
    expect(groupWeakLines([saved], req.id, req)).toHaveLength(0);
  });

  it("includes Partial lines", () => {
    const partial = makeLine({ status: "Partial", apsrDimension: "Approach" });
    const groups = groupWeakLines([partial], req.id, req);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines[0].status).toBe("Partial");
  });

  it("populates sourceRefs from grouped lines", () => {
    const a = makeLine({ id: "La", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS1.a" });
    const b = makeLine({ id: "Lb", status: "Not met", apsrDimension: "Approach", sourceRef: "4.5.1.DS1.b" });
    const groups = groupWeakLines([a, b], req.id, req);
    expect(groups[0].sourceRefs).toContain("4.5.1.DS1.a");
    expect(groups[0].sourceRefs).toContain("4.5.1.DS1.b");
  });

  it("sets the correct gapType on each group", () => {
    const a = makeLine({ status: "Not met", apsrDimension: "Review" });
    const groups = groupWeakLines([a], req.id, req);
    expect(groups[0].gapType).toBe("Review/ContinualImprovement");
  });

  it("sets the correct primaryApsrDimension", () => {
    const a = makeLine({ status: "Not met", apsrDimension: "Systems & Outcomes" });
    const groups = groupWeakLines([a], req.id, req);
    expect(groups[0].primaryApsrDimension).toBe("Systems & Outcomes");
  });

  it("sets gd4ItemId and subCriterionId from req", () => {
    const a = makeLine({ status: "Not met" });
    const groups = groupWeakLines([a], req.id, req);
    expect(groups[0].gd4ItemId).toBe(req.id);
    expect(groups[0].subCriterionId).toBe(req.subCriterionId);
  });
});

// ── synthesiseApsrFromGroup ───────────────────────────────────────────────────

describe("synthesiseApsrFromGroup", () => {
  const makeGroup = (lines: SpecificChecklistLine[]): ChecklistLineGroup => ({
    gd4ItemId: "4.5.1",
    subCriterionId: "4.5",
    gapType: "Implementation/Process",
    primaryApsrDimension: "Processes",
    lines,
    sourceRefs: [],
    sourceTexts: [],
    severity: "Medium",
    riskCategory: "C",
  });

  it("returns undefined when no APSR data and no bullets", () => {
    const group = makeGroup([makeLine({ status: "Not met" })]);
    expect(synthesiseApsrFromGroup(group)).toBeUndefined();
  });

  it("uses bullets as note when provided", () => {
    const group = makeGroup([makeLine({ status: "Not met" })]);
    const bullets = {
      approach: ["Approach bullet 1", "Approach bullet 2"],
      processes: [],
      systemsOutcomes: [],
      review: [],
    };
    const result = synthesiseApsrFromGroup(group, bullets);
    expect(result?.approach.note).toBe("Approach bullet 1\nApproach bullet 2");
  });

  it("picks worst-case approach status: Not evident beats Beginning", () => {
    const lineA = lineWithApsr(makeApsr({ approachStatus: "Beginning" }), { status: "Not met" });
    const lineB = lineWithApsr(makeApsr({ approachStatus: "Not evident" }), { status: "Not met" });
    const group = makeGroup([lineA, lineB]);
    const result = synthesiseApsrFromGroup(group);
    expect(result?.approach.status).toBe("Not evident");
  });

  it("picks worst-case processes status: Not evident beats Weak", () => {
    const lineA = lineWithApsr(makeApsr({ processesStatus: "Weak" }), { status: "Not met" });
    const lineB = lineWithApsr(makeApsr({ processesStatus: "Not evident" }), { status: "Not met" });
    const group = makeGroup([lineA, lineB]);
    const result = synthesiseApsrFromGroup(group);
    expect(result?.processes.status).toBe("Not evident");
  });

  it("picks worst-case review status: Not evident wins", () => {
    const lineA = lineWithApsr(makeApsr({ reviewStatus: "Evident" }), { status: "Not met" });
    const lineB = lineWithApsr(makeApsr({ reviewStatus: "Not evident" }), { status: "Not met" });
    const group = makeGroup([lineA, lineB]);
    const result = synthesiseApsrFromGroup(group);
    expect(result?.review.status).toBe("Not evident");
  });
});

// ── Batch 2: cross-pipeline dedupe + grouped-finding classification ──────────

import { isCoveredByExistingFinding, classifyGroup } from "../findingGrouper";
import type { Finding } from "../../types";

function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-1", auditCycleId: "cycle-1", gd4ItemId: "4.5.1", issue: "gap",
    type: "AFI", severity: "Medium", owner: "", dueDate: "", repeatFinding: false,
    overdue: false, managementDecisionNeeded: false, status: "Open", ...over,
  };
}

describe("isCoveredByExistingFinding — sees auto-raised findings too", () => {
  const group: ChecklistLineGroup = {
    gd4ItemId: "4.5.1", subCriterionId: "4.5", gapType: "Implementation/Process",
    primaryApsrDimension: "Processes",
    lines: [makeLine({ id: "L9", status: "Not met", sourceRef: "4.5.1.DS1.a" })],
    sourceRefs: ["4.5.1.DS1.a"], sourceTexts: ["…"], severity: "Medium", riskCategory: "C",
  };

  it("matches on overlapping linkedChecklistLineIds (existing behaviour)", () => {
    const f = makeFinding({ linkedChecklistLineIds: ["L9"] });
    expect(isCoveredByExistingFinding(group, [f])).toBe(true);
  });

  it("matches an auto-raised finding via linkedSourceRefs even with NO line ids", () => {
    // raiseAllUnmetFindings stamps linkedSourceRefs but not linkedChecklistLineIds —
    // this used to be invisible to the grouped pipeline and produced duplicates.
    const f = makeFinding({ linkedSourceRefs: ["DS: 4.5.1.ds1.a"] }); // drifted form still matches
    expect(isCoveredByExistingFinding(group, [f])).toBe(true);
  });

  it("does not match a different item or a different ref", () => {
    expect(isCoveredByExistingFinding(group, [makeFinding({ gd4ItemId: "4.6.1", linkedSourceRefs: ["4.5.1.DS1.a"] })])).toBe(false);
    expect(isCoveredByExistingFinding(group, [makeFinding({ linkedSourceRefs: ["4.5.1.DS2"] })])).toBe(false);
  });
});

describe("classifyGroup — grouped findings carry a real findingType", () => {
  const groupOf = (lines: SpecificChecklistLine[]): ChecklistLineGroup => ({
    gd4ItemId: "4.5.1", subCriterionId: "4.5", gapType: "Implementation/Process",
    primaryApsrDimension: "Processes", lines, sourceRefs: [], sourceTexts: [],
    severity: "Medium", riskCategory: "C",
  });

  it("any Not-met line → NC; all-Partial → OFI (matching findingTypeForStatus)", () => {
    expect(classifyGroup(groupOf([makeLine({ status: "Not met" }), makeLine({ id: "L2", status: "Partial" })]), undefined).findingType).toBe("NC");
    expect(classifyGroup(groupOf([makeLine({ status: "Partial" })]), undefined).findingType).toBe("OFI");
  });

  it("OFI carries no NC severity; NC with a weak Approach is Major", () => {
    expect(classifyGroup(groupOf([makeLine({ status: "Partial" })]), undefined).ncSeverity).toBeNull();
    const apsr: ApsrBreakdown = {
      approach: { status: "Not evident", note: "" }, processes: { status: "Not evident", note: "" },
      systemsOutcomes: { status: "Not evident", note: "" }, review: { status: "Not evident", note: "" },
    };
    expect(classifyGroup(groupOf([makeLine({ status: "Not met" })]), apsr).ncSeverity).toBe("Major");
  });
});
