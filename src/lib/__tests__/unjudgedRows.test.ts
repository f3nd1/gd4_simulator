import { describe, it, expect } from "vitest";
import { unjudgedBothSides, demoteUnjudgedRows, demoteUnjudgedMap, demoteUnjudgedHistory, UNJUDGED_MIGRATION_NOTE } from "../unjudgedRows";
import type { EvidenceAssessmentResult, EvidenceAssessmentRow } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "Monitor student learning.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Met", comment: "Shown in the log.", ...over,
});
const result = (rows: EvidenceAssessmentRow[]): EvidenceAssessmentResult =>
  ({ subCriterionId: "5.4", rows, runAt: "2026-09-01T00:00:00Z", live: true });

const UNJUDGED = { verdict: "Partial" as const, ppdVerdict: "Not assessed" as const, evidenceChunkIds: [] };

describe("the one definition of 'neither pass judged this line'", () => {
  it("matches only the pair with no judgement on either side", () => {
    expect(unjudgedBothSides(row(UNJUDGED))).toBe(true);
    // A real PPD judgement, conservatively capped: left alone.
    expect(unjudgedBothSides(row({ ...UNJUDGED, ppdVerdict: "Partial" }))).toBe(false);
    // Records were cited, so the evidence side did judge something.
    expect(unjudgedBothSides(row({ ...UNJUDGED, evidenceChunkIds: ["C001"] }))).toBe(false);
    // A definite negative is a judgement.
    expect(unjudgedBothSides(row({ ...UNJUDGED, verdict: "Not met" }))).toBe(false);
  });
});

describe("runs stored before the engine fix are corrected on load", () => {
  it("demotes the matching row and says so in its own comment", () => {
    const out = demoteUnjudgedRows(result([row(UNJUDGED)]));
    expect(out.rows[0].verdict).toBe("Not assessed");
    expect(out.rows[0].comment).toContain(UNJUDGED_MIGRATION_NOTE);
  });

  // A finding already raised from such a row stays in the register for a human
  // to withdraw. Deleting findings on a migration is exactly the silent write
  // this app does not do, so the back-pointer must survive.
  it("keeps savedFindingId and every other field", () => {
    const out = demoteUnjudgedRows(result([row({ ...UNJUDGED, savedFindingId: "F-12", requirementText: "Keep me." })]));
    expect(out.rows[0].savedFindingId).toBe("F-12");
    expect(out.rows[0].requirementText).toBe("Keep me.");
  });

  it("leaves every other row, and every other result, untouched by identity", () => {
    const clean = result([row({}), row({ verdict: "Not met", ppdVerdict: "Not documented" })]);
    expect(demoteUnjudgedRows(clean)).toBe(clean);
    const map = { "5.4": clean };
    expect(demoteUnjudgedMap(map)!["5.4"]).toBe(clean);
  });

  it("covers run history and snapshots, so restoring one cannot bring the old verdict back", () => {
    const hist = demoteUnjudgedHistory({ "5.4": [result([row(UNJUDGED)])] })!;
    expect(hist["5.4"][0].rows[0].verdict).toBe("Not assessed");
    const map = demoteUnjudgedMap({ "5.4": result([row(UNJUDGED)]) })!;
    expect(map["5.4"].rows[0].verdict).toBe("Not assessed");
    expect(demoteUnjudgedMap(undefined)).toBeUndefined();
    expect(demoteUnjudgedHistory(undefined)).toBeUndefined();
  });
});
