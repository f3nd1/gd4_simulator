import { describe, it, expect } from "vitest";
import { recordsOutcome, recordsWhy, toRecordsRows, toSelfCheckRows, toProcedureRows } from "../selfCheck";
import type { EvidenceAssessmentRow, PPDReviewRow } from "../../types";

const base: EvidenceAssessmentRow = {
  gdRef: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: "Describe and show the internal assessment process.",
  ppdExtract: "Internal assessment is carried out annually.", ppdVerdict: "Adequate",
  evidenceSummary: "All available passages are policy descriptions of internal assessment scope, methods, and tools; no actual audit plans, schedules, checklists, or audit records were provided.",
  evidenceFiles: [], evidenceChunkIds: ["C001", "C002"], verdict: "Not met", comment: "",
};
const promise = (verdict: "evidenced" | "not evidenced" | "contradicted") =>
  ({ promiseText: "Internal assessment is carried out annually.", verdict, evidence: "", chunkIds: [], quote: "", chunkId: "" });

describe("recordsOutcome", () => {
  // THE reported bug: two passages cited, both policy text, no promise shown
  // carried out. The old rule counted citations and returned "found".
  it("does not call policy passages a record", () => {
    expect(recordsOutcome({ ...base, promiseChecks: [promise("not evidenced")], passageKinds: { record: 0, policy: 2 } })).toBe("none");
  });

  it("follows the promise checks when there are any", () => {
    expect(recordsOutcome({ ...base, verdict: "Partial", promiseChecks: [promise("evidenced"), promise("not evidenced")] })).toBe("found");
    expect(recordsOutcome({ ...base, promiseChecks: [promise("not evidenced"), promise("not evidenced")] })).toBe("none");
  });

  it("treats a contradicted promise as records not showing it", () => {
    expect(recordsOutcome({ ...base, promiseChecks: [promise("contradicted")] })).toBe("none");
  });

  it("uses the stored split when the line has no promises", () => {
    expect(recordsOutcome({ ...base, verdict: "Partial", promiseChecks: [], passageKinds: { record: 1, policy: 3 } })).toBe("found");
    expect(recordsOutcome({ ...base, promiseChecks: [], passageKinds: { record: 0, policy: 3 } })).toBe("none");
  });

  // Older rows stored neither signal. The inference is drawn only where it is
  // sound, and admitted as unknown where it is not — guessing here is what
  // produced the wrong label in the first place.
  it("infers found from Met on an older row, because Met needs a record", () => {
    expect(recordsOutcome({ ...base, verdict: "Met" })).toBe("found");
  });

  it("infers none on an older row that cited nothing at all", () => {
    expect(recordsOutcome({ ...base, verdict: "Not met", evidenceChunkIds: [] })).toBe("none");
  });

  it("admits it cannot tell on an older row that cited passages and did not reach Met", () => {
    expect(recordsOutcome({ ...base, verdict: "Not met" })).toBe("unknown");
    expect(recordsOutcome({ ...base, verdict: "Partial" })).toBe("unknown");
  });

  it("never turns a failed or unjudged line into a negative", () => {
    expect(recordsOutcome({ ...base, assessmentFailed: true })).toBe("unknown");
    expect(recordsOutcome({ ...base, verdict: "Not assessed" })).toBe("unknown");
    // Even with promises that all failed to evidence.
    expect(recordsOutcome({ ...base, verdict: "Not assessed", promiseChecks: [promise("not evidenced")] })).toBe("unknown");
  });
});

describe("recordsWhy", () => {
  it("says what WAS found when every passage was policy text", () => {
    const why = recordsWhy({ ...base, promiseChecks: [promise("not evidenced")], passageKinds: { record: 0, policy: 3 } }, 0);
    expect(why).toContain("3 passages about this were found");
    expect(why).toContain("policy wording rather than a record of it happening");
  });

  it("counts the unshown promises when the split is not stored", () => {
    const why = recordsWhy({ ...base, promiseChecks: [promise("not evidenced"), promise("evidenced")] }, 0);
    expect(why).toContain("1 of 2 things your procedure promises");
  });

  it("keeps the engine's own summary alongside", () => {
    const why = recordsWhy({ ...base, promiseChecks: [promise("not evidenced")], passageKinds: { record: 0, policy: 1 } }, 0);
    expect(why).toContain("no actual audit plans, schedules, checklists");
  });
});

// The whole point: the three tabs must be capable of agreeing.
describe("the three tabs on the reported 6.1 shape", () => {
  const ppdRow: PPDReviewRow = {
    ref: "6.1.1.DS1", gd4ItemId: "6.1.1", requirementText: base.requirementText,
    verdict: "Adequate", shortComment: "Documented.", fullComment: "", chunkIds: ["P001"],
  };
  const evRow = { ...base, promiseChecks: [promise("not evidenced")], passageKinds: { record: 0, policy: 2 } };

  it("no longer shows a green records tick above a Does-not-comply overall", () => {
    const ctx = { ppdRows: [ppdRow] };
    expect(toProcedureRows([ppdRow], ctx)[0].label).toBe("Documented");
    expect(toRecordsRows([evRow], ctx)[0].label).toBe("Records do not show it");
    expect(toSelfCheckRows([evRow], ctx)[0].label).toBe("Does not comply");
  });
});
