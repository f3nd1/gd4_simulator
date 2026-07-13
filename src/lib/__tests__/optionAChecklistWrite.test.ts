import { describe, it, expect } from "vitest";
import { buildOptionALineWrites } from "../optionAChecklistWrite";
import type { EvidenceAssessmentRow, PPDReviewRow } from "../../types";

function row(over: Partial<EvidenceAssessmentRow>): EvidenceAssessmentRow {
  return {
    gdRef: "1.2.1.DS1",
    gd4ItemId: "1.2.1",
    requirementText: "Strategic plan documented.",
    ppdExtract: "Documented.",
    ppdVerdict: "Adequate",
    evidenceSummary: "Plan and minutes sighted.",
    evidenceFiles: [],
    evidenceChunkIds: ["C002"],
    verdict: "Met",
    comment: "Documented and implemented (C002).",
    ...over,
  };
}

const PPD_ROWS: PPDReviewRow[] = [{
  ref: "DS: 1.2.1.ds1", // drifted format — must still match by normalized ref
  gd4ItemId: "1.2.1",
  requirementText: "Strategic plan documented.",
  verdict: "Adequate",
  shortComment: "PPD names owner, frequency and record.",
  fullComment: "…",
  chunkIds: ["C001"],
}];

const OPTS = { runId: "EV-1.2-TEST", folderName: "1.2 Strategic Planning" };

describe("buildOptionALineWrites — Option A verdicts land on checklist lines by normalized ref", () => {
  it("matches an existing checklist line whose sourceRef drifted in format, and maps verdict -> status/sufficiency", () => {
    const writes = buildOptionALineWrites(
      [row({ verdict: "Partial" })],
      { "1.2.1": [{ id: "L1", sourceRef: "ds: 1.2.1.DS1 " }, { id: "L2", sourceRef: "1.2.1.DS2" }] },
      PPD_ROWS,
      OPTS
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].existingLineId).toBe("L1"); // matched, not duplicated
    expect(writes[0].newLine).toBeUndefined();
    expect(writes[0].status).toBe("Partial");
    expect(writes[0].evidence.sufficiency).toBe("Weak");
    expect(writes[0].evidence.runId).toBe("EV-1.2-TEST"); // replaces prior audit evidence on re-run
  });

  it("creates a new line (with sourceRef for future idempotent matches) when the checklist has none", () => {
    const writes = buildOptionALineWrites([row({ verdict: "Not met" })], {}, PPD_ROWS, OPTS);
    expect(writes[0].existingLineId).toBeUndefined();
    expect(writes[0].newLine).toMatchObject({ sourceRef: "1.2.1.DS1", clause: "1.2.1.DS1", generatedBy: "ai" });
    expect(writes[0].status).toBe("Not met");
    expect(writes[0].evidence.sufficiency).toBe("Missing");
  });

  it("carries APSR honestly: Approach from the PPD verdict, Processes from the evidence verdict, outcomes/review marked not assessed", () => {
    const writes = buildOptionALineWrites([row({ ppdVerdict: "Partial", verdict: "Partial" })], {}, PPD_ROWS, OPTS);
    const apsr = writes[0].evidence.apsr!;
    expect(apsr.approach.status).toBe("Beginning");
    expect(apsr.approach.sourceChunkIds).toEqual(["C001"]); // from the PPD row, matched across ref drift
    expect(apsr.processes.status).toBe("Weak");
    expect(apsr.processes.sourceChunkIds).toEqual(["C002"]);
    expect(apsr.systemsOutcomes.status).toBe("Not evident");
    expect(apsr.systemsOutcomes.note).toContain("Not assessed by Option A");
    expect(apsr.review.status).toBe("Not evident");
  });

  it("carries the tab snapshots verbatim: run verdict, both halves' reasoning, ppdVerdict and promiseChecks", () => {
    const checks = [
      { promiseText: "Rubric applied before appointment", verdict: "evidenced" as const, evidence: "Scoring sheets on file.", chunkIds: ["C002"] },
      { promiseText: "Due-diligence on every agent", verdict: "not evidenced" as const, evidence: "No record found.", chunkIds: [] },
    ];
    const writes = buildOptionALineWrites([row({ verdict: "Partial", promiseChecks: checks })], {}, PPD_ROWS, OPTS);
    const ev = writes[0].evidence;
    expect(ev.ppdVerdict).toBe("Adequate");
    expect(ev.evidenceVerdict).toBe("Partial"); // the RUN's verdict, preserved even if a human later edits l.status
    expect(ev.ppdComment).toBe("…"); // ppdRow.fullComment verbatim, not the shortComment
    expect(ev.evidenceComment).toBe("Documented and implemented (C002)."); // row.comment verbatim
    expect(ev.promiseChecks).toEqual(checks);
  });

  it("never writes 'Not assessed' or failed rows over an existing status", () => {
    const writes = buildOptionALineWrites(
      [row({ verdict: "Not assessed" }), row({ gdRef: "1.2.1.DS2", assessmentFailed: true })],
      { "1.2.1": [{ id: "L1", sourceRef: "1.2.1.DS1" }] },
      PPD_ROWS,
      OPTS
    );
    expect(writes).toHaveLength(0);
  });
});
