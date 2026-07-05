import { describe, it, expect } from "vitest";
import { buildStagedApsr } from "../agentRuntime";
import type { PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow } from "../../../types";

// The staged run record and file ledger derive their citation trail from the
// sourceChunkIds each APSR dimension carries (see auditFolderStaged: the
// aiSummary unions them, and file records are tagged from them). These tests
// lock that the dimensions — including Review — carry real citations, so a
// Met/Deployed line has a non-empty evidence trail, and that Review reflects a
// genuine assessment rather than a uniform default.

const P = (chunkIds: string[]): PolicyCoverageRow => ({ ref: "r", pointText: "p", covered: "Yes", note: "policy present", chunkIds });
const E = (chunkIds: string[]): EvidenceCoverageRow => ({ ref: "r", pointText: "p", covered: "Yes", note: "records present", chunkIds });
const O = (outcomeEvident: boolean, reviewEvident: boolean, chunkIds: string[]): OutcomeReviewRow => ({ ref: "r", pointText: "p", outcomeEvident, reviewEvident, note: "n", chunkIds });

function unionCited(apsr: ReturnType<typeof buildStagedApsr>): string[] {
  return [...new Set([
    ...(apsr.approach.sourceChunkIds ?? []),
    ...(apsr.processes.sourceChunkIds ?? []),
    ...(apsr.systemsOutcomes.sourceChunkIds ?? []),
    ...(apsr.review.sourceChunkIds ?? []),
  ])];
}

describe("staged citations — dimensions carry a real chunk trail", () => {
  it("a fully-cited Met/Deployed line unions citations from every dimension, incl. Review", () => {
    const apsr = buildStagedApsr(P(["C001"]), E(["C002"]), O(true, true, ["C003"]), { requireCitations: true });
    expect(apsr.approach.status).toBe("Meeting");
    expect(apsr.processes.status).toBe("Deployed");
    expect(apsr.systemsOutcomes.status).toBe("Evident");
    expect(apsr.review.status).toBe("Evident");
    // Review carries its own citation (genuinely assessed + traceable)…
    expect(apsr.review.sourceChunkIds).toEqual(["C003"]);
    // …and the line-level union (what the CSV records) is non-empty.
    expect(unionCited(apsr)).toEqual(expect.arrayContaining(["C001", "C002", "C003"]));
  });

  it("Review is a genuine assessment: reviewEvident=false → Not evident (not a fabricated positive), no citation", () => {
    const apsr = buildStagedApsr(P(["C001"]), E(["C002"]), O(true, false, ["C003"]), { requireCitations: true });
    expect(apsr.review.status).toBe("Not evident");
    expect(apsr.review.sourceChunkIds).toEqual([]);
    // The rest of the line still carries its citations.
    expect(unionCited(apsr)).toEqual(expect.arrayContaining(["C001", "C002", "C003"]));
  });

  it("uncited-positive downgrade still applies to Review (reviewEvident but no cited chunk on a live run)", () => {
    const apsr = buildStagedApsr(P(["C001"]), E(["C002"]), O(false, true, []), { requireCitations: true });
    expect(apsr.review.status).toBe("Not evident"); // downgraded — no chunk backs the positive
  });

  it("offline run (requireCitations=false) credits Review without a citation gap", () => {
    const apsr = buildStagedApsr(P([]), E([]), O(false, true, []), { requireCitations: false });
    expect(apsr.review.status).toBe("Evident");
  });
});
