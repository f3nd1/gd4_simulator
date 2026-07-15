import { describe, it, expect } from "vitest";
import { buildOptionALineWrites, buildOptionASourceTrace } from "../optionAChecklistWrite";
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
    const writes = buildOptionALineWrites([row({ verdict: "Partial", promiseChecks: checks, suggestedAction: "Add the missing scoring sheet for the third appointment." })], {}, PPD_ROWS, OPTS);
    const ev = writes[0].evidence;
    expect(ev.ppdVerdict).toBe("Adequate");
    expect(ev.evidenceVerdict).toBe("Partial"); // the RUN's verdict, preserved even if a human later edits l.status
    expect(ev.ppdComment).toBe("…"); // ppdRow.fullComment verbatim, not the shortComment
    expect(ev.evidenceComment).toBe("Documented and implemented (C002)."); // row.comment verbatim
    expect(ev.suggestedAction).toBe("Add the missing scoring sheet for the third appointment."); // row.suggestedAction verbatim
    expect(ev.promiseChecks).toEqual(checks);
    // The auto-generated auditorNote blob is deliberately gone — it froze at
    // write time and duplicated the tabs. auditorNote is human-input-only now.
    expect(ev.auditorNote).toBeUndefined();
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

describe("buildOptionASourceTrace — findings carry file + chunk + verbatim-quote citations", () => {
  const resolve = (cid: string) => ({ C001: "PPD_v3.pdf", C002: "enrolment_log.xlsx" } as Record<string, string>)[cid];

  it("embeds evidence files, resolved chunk citations and verified quotes", () => {
    const r = row({
      evidenceFiles: [{ name: "enrolment_log.xlsx", url: "https://drive/x" }],
      evidenceQuote: "Attendance is recorded per session.",
      promiseChecks: [
        { promiseText: "Refund within 7 days", verdict: "evidenced" as const, evidence: "Refund log.", chunkIds: ["C002"], quote: "refunds are processed within 7 working days" },
        { promiseText: "No quote for this one", verdict: "not evidenced" as const, evidence: "None.", chunkIds: [] }, // no verified quote — must NOT appear
      ],
    });
    const trace = buildOptionASourceTrace(r, PPD_ROWS[0], resolve, "EV-1.2-TEST");
    expect(trace).toContain("Source evidence (run EV-1.2-TEST):");
    expect(trace).toContain("Evidence files: enrolment_log.xlsx");
    expect(trace).toContain("Cited passages: enrolment_log.xlsx · C002"); // resolved, not a bare chunk id
    expect(trace).toContain(`Verified excerpt: "Attendance is recorded per session."`);
    expect(trace).toContain(`"refunds are processed within 7 working days" (enrolment_log.xlsx · C002) — evidenced: Refund within 7 days`);
    expect(trace).not.toContain("No quote for this one"); // unverified promise carries no quotable citation
  });

  it("includes the PPD basis quote only when a verified supportQuote exists", () => {
    const withQuote = buildOptionASourceTrace(row({}), { ...PPD_ROWS[0], supportQuote: "The PEI shall review annually." }, resolve);
    expect(withQuote).toContain(`PPD basis: "The PEI shall review annually." (PPD_v3.pdf · C001)`);
    const withoutQuote = buildOptionASourceTrace(row({ evidenceChunkIds: [] }), PPD_ROWS[0], resolve);
    expect(withoutQuote).not.toContain("PPD basis"); // no supportQuote on the fixture row
  });

  it("falls back to the file-ledger pointer when nothing is citable (Not met with no evidence), never fabricates", () => {
    const empty = row({ verdict: "Not met", evidenceChunkIds: [], evidenceFiles: [], comment: "" });
    expect(buildOptionASourceTrace(empty, undefined, resolve, "EV-1.2-TEST")).toContain("no evidence passages were cited for this line");
    expect(buildOptionASourceTrace(empty, undefined, resolve)).toBe(""); // no runId either → empty, appended nowhere
  });

  it("leaves unresolvable chunk ids as bare ids rather than inventing a file name", () => {
    const trace = buildOptionASourceTrace(row({ evidenceChunkIds: ["C999"] }), undefined, resolve);
    expect(trace).toContain("Cited passages: C999");
    expect(trace).not.toContain("undefined");
  });
});
