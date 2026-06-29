import { describe, it, expect } from "vitest";
import {
  buildStagedApsr,
  simulateStagedPolicyAudit,
  simulateStagedEvidenceAudit,
  simulateStagedOutcomeReview,
} from "../ai/agentRuntime";
import { deriveApsrStatus } from "../ai/simulateAI";
import type { PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, FlatAuditPoint } from "../../types";

// Helpers
function makePolicyRow(covered: PolicyCoverageRow["covered"]): PolicyCoverageRow {
  return { ref: "1.1.1.DS1", pointText: "test policy point", covered, note: "test", chunkIds: [] };
}
function makeEvidenceRow(covered: EvidenceCoverageRow["covered"]): EvidenceCoverageRow {
  return { ref: "1.1.1.DS1", pointText: "test evidence point", covered, note: "test", chunkIds: [] };
}
function makeOutcomeRow(outcomeEvident: boolean, reviewEvident: boolean): OutcomeReviewRow {
  return { ref: "1.1.1.DS1", pointText: "test", outcomeEvident, reviewEvident, note: "test", chunkIds: [] };
}
function makeAuditPoint(text: string): FlatAuditPoint {
  return { ref: "1.1.1.DS1", gd4ItemId: "1.1", sourceType: "describeShow", text, sourceText: text, originalIndex: null };
}

// 1. PolicyCoverageRow type validation
describe("PolicyCoverageRow", () => {
  it("accepts valid covered values", () => {
    const row: PolicyCoverageRow = makePolicyRow("Yes");
    expect(["Yes", "Partial", "No"]).toContain(row.covered);
  });
});

// 2. EvidenceCoverageRow type validation
describe("EvidenceCoverageRow", () => {
  it("accepts valid covered values", () => {
    const row: EvidenceCoverageRow = makeEvidenceRow("Partial");
    expect(["Yes", "Partial", "No"]).toContain(row.covered);
  });
});

// 3. OutcomeReviewRow type validation
describe("OutcomeReviewRow", () => {
  it("has boolean outcomeEvident and reviewEvident", () => {
    const row: OutcomeReviewRow = makeOutcomeRow(true, false);
    expect(typeof row.outcomeEvident).toBe("boolean");
    expect(typeof row.reviewEvident).toBe("boolean");
  });
});

describe("buildStagedApsr", () => {
  // 4. policy "Yes" → Approach "Meeting"
  it("maps policy Yes to Approach Meeting", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("Yes"), makeOutcomeRow(true, true));
    expect(apsr.approach.status).toBe("Meeting");
  });

  // 5. evidence "No" → Processes "Not evident"
  it("maps evidence No to Processes Not evident", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("No"), makeOutcomeRow(true, true));
    expect(apsr.processes.status).toBe("Not evident");
  });

  // 6. outcomeEvident=true → Systems & Outcomes "Evident"
  it("maps outcomeEvident true to Systems and Outcomes Evident", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("Yes"), makeOutcomeRow(true, false));
    expect(apsr.systemsOutcomes.status).toBe("Evident");
  });

  // 7. reviewEvident=false → Review "Not evident"
  it("maps reviewEvident false to Review Not evident", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("Yes"), makeOutcomeRow(true, false));
    expect(apsr.review.status).toBe("Not evident");
  });

  // 8. policy "Partial" → Approach "Beginning"
  it("maps policy Partial to Approach Beginning", () => {
    const apsr = buildStagedApsr(makePolicyRow("Partial"), makeEvidenceRow("Yes"), makeOutcomeRow(true, true));
    expect(apsr.approach.status).toBe("Beginning");
  });

  it("maps evidence Yes to Processes Deployed", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("Yes"), makeOutcomeRow(false, false));
    expect(apsr.processes.status).toBe("Deployed");
  });

  it("maps evidence Partial to Processes Weak", () => {
    const apsr = buildStagedApsr(makePolicyRow("No"), makeEvidenceRow("Partial"), makeOutcomeRow(false, false));
    expect(apsr.processes.status).toBe("Weak");
  });

  it("handles undefined inputs gracefully with Not evident defaults", () => {
    const apsr = buildStagedApsr(undefined, undefined, undefined);
    expect(apsr.approach.status).toBe("Not evident");
    expect(apsr.processes.status).toBe("Not evident");
    expect(apsr.systemsOutcomes.status).toBe("Not evident");
    expect(apsr.review.status).toBe("Not evident");
  });
});

// 9. simulateStagedPolicyAudit keyword match returns "Yes" for good match
describe("simulateStagedPolicyAudit", () => {
  it("returns Yes for text with many keyword matches", () => {
    const point = makeAuditPoint("student enrolment contract signed payment procedure");
    const doc = "The student enrolment contract must be signed before payment procedure is followed";
    const rows = simulateStagedPolicyAudit([point], doc);
    expect(rows[0].covered).toBe("Yes");
  });

  // 10. simulateStagedPolicyAudit returns "No" for no match
  it("returns No for text with no keyword matches", () => {
    const point = makeAuditPoint("mandatory refund policy framework governance");
    const rows = simulateStagedPolicyAudit([point], "unrelated document text xyz");
    expect(rows[0].covered).toBe("No");
  });

  it("returns one row per audit point", () => {
    const points = [makeAuditPoint("alpha beta gamma"), makeAuditPoint("delta epsilon")];
    const rows = simulateStagedPolicyAudit(points, "some text");
    expect(rows).toHaveLength(2);
  });
});

// 11. simulateStagedOutcomeReview detects outcome keywords
describe("simulateStagedOutcomeReview", () => {
  it("sets outcomeEvident true when outcome keywords present", () => {
    const rows = simulateStagedOutcomeReview([makeAuditPoint("test")], "the kpi trend data shows outcome improvement");
    expect(rows[0].outcomeEvident).toBe(true);
  });

  it("sets reviewEvident true when review keywords present", () => {
    const rows = simulateStagedOutcomeReview([makeAuditPoint("test")], "management review meeting minutes decision taken");
    expect(rows[0].reviewEvident).toBe(true);
  });

  it("sets both false when no matching keywords", () => {
    const rows = simulateStagedOutcomeReview([makeAuditPoint("test")], "lorem ipsum dolor sit amet");
    expect(rows[0].outcomeEvident).toBe(false);
    expect(rows[0].reviewEvident).toBe(false);
  });
});

// 12. buildStagedApsr → deriveApsrStatus roundtrip
describe("buildStagedApsr + deriveApsrStatus roundtrip", () => {
  it("full compliance produces Met status", () => {
    const apsr = buildStagedApsr(makePolicyRow("Yes"), makeEvidenceRow("Yes"), makeOutcomeRow(true, true));
    expect(deriveApsrStatus(apsr)).toBe("Met");
  });

  it("no evidence produces Not met status", () => {
    const apsr = buildStagedApsr(makePolicyRow("No"), makeEvidenceRow("No"), makeOutcomeRow(false, false));
    expect(deriveApsrStatus(apsr)).toBe("Not met");
  });
});
