import { describe, it, expect } from "vitest";
import { buildStagedApsr } from "../agentRuntime";
import { deriveApsrStatus } from "../simulateAI";
import type { PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow } from "../../../types";

// Guards the "no-fabrication-under-failure" staged fix (useWorkspaceStore
// auditFolderStaged): a line that wasn't genuinely assessed now shows
// "Not assessed", NOT a fabricated "Not evident". This test locks the OTHER
// side of that fix — a GENUINE assessment that found nothing (covered "No"
// WITHOUT notAssessed) must still resolve to a real "Not met" with every APSR
// dimension "Not evident". If this ever flips, the fix would be hiding real
// failures, which is exactly what it must not do.

const genuinePolicyNo: PolicyCoverageRow = { ref: "2.2.1.DS1", pointText: "x", covered: "No", note: "No relevant policy evidence found in the 2 window(s) reviewed.", chunkIds: [] };
const genuineEvidenceNo: EvidenceCoverageRow = { ref: "2.2.1.DS1", pointText: "x", covered: "No", note: "No implementation evidence found in the 2 window(s) reviewed.", chunkIds: [] };
const genuineOutcomeNo: OutcomeReviewRow = { ref: "2.2.1.DS1", pointText: "x", outcomeEvident: false, reviewEvident: false, note: "No outcome/review evidence found in the 2 window(s) reviewed.", chunkIds: [] };

describe("staged: a genuine 'assessed, found nothing' stays a real Not met", () => {
  it("all-No coverage → every APSR dimension Not evident → Not met (offline: no citation downgrade)", () => {
    const apsr = buildStagedApsr(genuinePolicyNo, genuineEvidenceNo, genuineOutcomeNo, { requireCitations: false });
    expect(apsr.approach.status).toBe("Not evident");
    expect(apsr.processes.status).toBe("Not evident");
    expect(apsr.systemsOutcomes.status).toBe("Not evident");
    expect(apsr.review.status).toBe("Not evident");
    expect(deriveApsrStatus(apsr)).toBe("Not met");
  });

  it("all-No coverage → Not met on a live run too (requireCitations does not rescue a real negative)", () => {
    const apsr = buildStagedApsr(genuinePolicyNo, genuineEvidenceNo, genuineOutcomeNo, { requireCitations: true });
    expect(deriveApsrStatus(apsr)).toBe("Not met");
    expect(apsr.approach.status).toBe("Not evident");
  });

  it("is not trivially always-Not-met: genuine full coverage (with citations) resolves to Met", () => {
    const p: PolicyCoverageRow = { ref: "2.2.1.DS1", pointText: "x", covered: "Yes", note: "policy present", chunkIds: ["C001"] };
    const e: EvidenceCoverageRow = { ref: "2.2.1.DS1", pointText: "x", covered: "Yes", note: "records present", chunkIds: ["C002"] };
    const o: OutcomeReviewRow = { ref: "2.2.1.DS1", pointText: "x", outcomeEvident: true, reviewEvident: true, note: "outcomes + review present", chunkIds: ["C003"] };
    const apsr = buildStagedApsr(p, e, o, { requireCitations: true });
    expect(deriveApsrStatus(apsr)).toBe("Met");
  });
});
