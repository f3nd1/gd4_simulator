// On-demand Outcomes & Review pass: the row→legs mapping must be the exact
// buildStagedApsr behaviour (including citation-gap downgrades), and the
// row→line join must be the same normalized-ref join Option A's writes use.
// Honesty rules under test: an uncited positive downgrades, a clean negative
// stays "Not evident", and a notAssessed row never produces an update.
import { describe, it, expect } from "vitest";
import { outcomeReviewLegs, buildOutcomeReviewLegUpdates } from "../outcomeReviewApply";
import type { OutcomeReviewRow } from "../../types";

const row = (over: Partial<OutcomeReviewRow> = {}): OutcomeReviewRow => ({
  ref: "6.2.1.DS1",
  pointText: "Conduct management reviews at planned intervals",
  outcomeEvident: false,
  reviewEvident: false,
  note: "",
  chunkIds: [],
  ...over,
});

describe("outcomeReviewLegs — row to APSR legs via buildStagedApsr", () => {
  it("cited positives map to Evident/Evident with the note and chunk ids carried", () => {
    const legs = outcomeReviewLegs(row({ outcomeEvident: true, reviewEvident: true, note: "KPI dashboard and MR minutes found.", chunkIds: ["C003"] }));
    expect(legs.systemsOutcomes.status).toBe("Evident");
    expect(legs.review.status).toBe("Evident");
    expect(legs.systemsOutcomes.note).toBe("KPI dashboard and MR minutes found.");
    expect(legs.systemsOutcomes.sourceChunkIds).toEqual(["C003"]);
    expect(legs.review.sourceChunkIds).toEqual(["C003"]);
  });

  it("UNCITED positives are downgraded (S&O → Limited, Review → Not evident), never trusted at full strength", () => {
    const legs = outcomeReviewLegs(row({ outcomeEvident: true, reviewEvident: true, note: "Claims outcomes.", chunkIds: [] }));
    expect(legs.systemsOutcomes.status).toBe("Limited");
    expect(legs.review.status).toBe("Not evident");
    expect(legs.systemsOutcomes.note).toContain("Downgraded: no source chunks cited");
    expect(legs.review.note).toContain("Downgraded: no source chunks cited");
  });

  it("a clean negative stays honestly Not evident on both legs", () => {
    const legs = outcomeReviewLegs(row({ note: "No outcome data or review records found." }));
    expect(legs.systemsOutcomes.status).toBe("Not evident");
    expect(legs.review.status).toBe("Not evident");
    expect(legs.systemsOutcomes.note).toBe("No outcome data or review records found.");
  });

  it("a negative with an empty note gets the pass's default explanatory note, never an empty string", () => {
    const legs = outcomeReviewLegs(row());
    expect(legs.systemsOutcomes.note).toContain("No outcome data");
    expect(legs.review.note).toContain("No review or improvement records");
  });
});

describe("buildOutcomeReviewLegUpdates — normalized-ref join to checklist lines", () => {
  const rows = [
    row({ ref: "6.2.1.DS1", outcomeEvident: true, reviewEvident: false, note: "Outcome data found.", chunkIds: ["C001"] }),
    row({ ref: "6.2.1.DS2", outcomeEvident: false, reviewEvident: true, note: "Review records found.", chunkIds: ["C002"] }),
    row({ ref: "6.2.1.EE1", outcomeEvident: true, reviewEvident: true, note: "Both.", chunkIds: ["C003"], notAssessed: true }),
  ];

  it("matches by sourceRef, falls back to clause, and skips ref-less lines", () => {
    const updates = buildOutcomeReviewLegUpdates(rows, {
      "6.2.1": [
        { id: "L1", sourceRef: "6.2.1.DS1", clause: undefined },
        { id: "L2", sourceRef: undefined, clause: "6.2.1.DS2" },
        { id: "L3", sourceRef: undefined, clause: undefined },
      ],
    });
    expect(updates.map((u) => u.lineId)).toEqual(["L1", "L2"]);
    expect(updates[0].itemId).toBe("6.2.1");
    expect(updates[0].systemsOutcomes.status).toBe("Evident");
    expect(updates[0].review.status).toBe("Not evident");
    expect(updates[1].review.status).toBe("Evident");
  });

  it("a notAssessed row produces NO update — an unassessed point never overwrites a line's legs", () => {
    const updates = buildOutcomeReviewLegUpdates(rows, {
      "6.2.1": [{ id: "L1", sourceRef: "6.2.1.EE1", clause: undefined }],
    });
    expect(updates).toEqual([]);
  });

  it("a line whose ref matches no row is left out, never given fabricated legs", () => {
    const updates = buildOutcomeReviewLegUpdates(rows, {
      "6.2.1": [{ id: "L1", sourceRef: "6.2.1.DS9", clause: undefined }],
    });
    expect(updates).toEqual([]);
  });
});
