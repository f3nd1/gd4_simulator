import { describe, it, expect } from "vitest";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import { itemIdsForScope } from "../evidenceScope";
import { buildOutcomeReviewLegUpdates, outcomeReviewLegs } from "../outcomeReviewApply";
import type { OutcomeReviewRow } from "../../types";

// THE QUESTION THIS FILE SETTLES.
//
// The results-and-review pass judges ALL flatAuditPoints, which for 5.5 is 20:
// 11 describeShow requirement lines plus 5 expectedEvidence bullets and 4
// explanatory notes. Those 9 make no claim about what the PEI does, so most of
// them can only come back "nothing found". Its output feeds the Systems &
// Outcomes and Review legs.
//
// If those 9 could reach the legs, a note would be able to depress a band.
// They cannot, and this test is why that stays true: the join is driven by the
// CHECKLIST LINES, and no automatic route ever puts an EE or N ref on one.

const points = (scope: string) => {
  const ids = itemIdsForScope(scope);
  return GD4_REQUIREMENTS.filter((r) => ids.includes(r.id)).flatMap((r) => r.flatAuditPoints ?? []);
};
const nothingFound = (ref: string): OutcomeReviewRow =>
  ({ ref, pointText: ref, outcomeEvident: false, reviewEvident: false, note: "nothing found", chunkIds: [] });

describe("a non-requirement point cannot reach either APSR leg", () => {
  it("drops every expectedEvidence and note row, on every scope", () => {
    for (const scope of ["5.5", "6.1", "4.1", "3.1", "2.1.1"]) {
      const pts = points(scope);
      const ds = pts.filter((p) => p.sourceType === "describeShow");
      const other = pts.filter((p) => p.sourceType !== "describeShow");
      if (other.length === 0) continue;
      // Every point judged, every one saying "nothing found": the worst case.
      const rows = pts.map((p) => nothingFound(p.ref));
      // Checklist lines as Option A writes them: sourceRef = the evidence
      // row's gdRef, which is a describeShow ref (optionAChecklistWrite.ts).
      const lines = ds.map((p, i) => ({ id: `L${i}`, sourceRef: p.ref, clause: p.ref }));
      const updates = buildOutcomeReviewLegUpdates(rows, { x: lines });
      expect(updates.length, `${scope}: one update per requirement line, and no more`).toBe(ds.length);
    }
  });

  it("would let one through ONLY if a checklist line carried its ref", () => {
    // Not a hypothetical worth ignoring: `clause` is free text a human can
    // type. This is the single route by which a note could ever score, and it
    // is recorded here so it is not rediscovered as a mystery.
    const other = points("5.5").filter((p) => p.sourceType !== "describeShow");
    const rogue = other.map((p, i) => ({ id: `R${i}`, sourceRef: p.ref, clause: p.ref }));
    const updates = buildOutcomeReviewLegUpdates(other.map((p) => nothingFound(p.ref)), { x: rogue });
    expect(updates.length).toBe(other.length);
  });
});

describe("what a row does to the two legs", () => {
  it("treats 'nothing found' as evidence of absence, not as unknown", () => {
    // Deliberate and worth stating plainly: the pass read the documents and
    // found no outcome data, which is a finding. It is NOT the same as the
    // pass having been unable to read them, which outcomePassGate refuses.
    const legs = outcomeReviewLegs(nothingFound("5.5.1.DS1"));
    expect(legs.systemsOutcomes.status).toBe("Not evident");
    expect(legs.review.status).toBe("Not evident");
  });

  it("scores a cited positive as Evident on both legs", () => {
    const legs = outcomeReviewLegs({ ref: "x", pointText: "x", outcomeEvident: true, reviewEvident: true, note: "KPI table", chunkIds: ["C001"] });
    expect(legs.systemsOutcomes.status).toBe("Evident");
    expect(legs.review.status).toBe("Evident");
  });

  it("downgrades an UNCITED positive rather than trusting it", () => {
    // The citation gate: a positive verdict with no chunk behind it is not
    // evidence. Systems & Outcomes has a middle rung, Review does not.
    const legs = outcomeReviewLegs({ ref: "x", pointText: "x", outcomeEvident: true, reviewEvident: true, note: "claimed", chunkIds: [] });
    expect(legs.systemsOutcomes.status).toBe("Limited");
    expect(legs.review.status).toBe("Not evident");
  });

  it("never lets a notAssessed row overwrite a line's legs", () => {
    const row = { ref: "5.5.1.DS1", pointText: "x", outcomeEvident: false, reviewEvident: false, note: "", chunkIds: [], notAssessed: true };
    expect(buildOutcomeReviewLegUpdates([row], { x: [{ id: "L0", sourceRef: "5.5.1.DS1", clause: "5.5.1.DS1" }] })).toHaveLength(0);
  });
});
