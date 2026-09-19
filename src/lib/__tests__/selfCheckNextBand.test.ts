import { describe, it, expect } from "vitest";
import { buildBandWorking, nextBandRoute, nextBandWorking } from "../selfCheckBanding";
import { dimensionStepLines } from "../selfCheckImprove";
import { EDUTRUST_BANDS } from "../../data/edutrustRubric";

const all = (s: { approach: number; processes: number; systemsOutcomes: number; review: number }) =>
  buildBandWorking(s as never, {}, undefined, { systemsOutcomes: true, review: true });

describe("nextBandRoute", () => {
  it("reproduces the 50% case: three steps to clear 60%", () => {
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }));
    expect(r.kind).toBe("route");
    if (r.kind !== "route") return;
    expect(r.totalPct).toBe(50);
    expect(r.band).toBe(3);
    expect(r.nextBand).toBe(4);
    expect(r.thresholdPct).toBe(60);
    expect(r.steps).toBe(3);
    expect(r.reachedPct).toBe(65);
    expect(nextBandWorking(r)).toContain("3 moves would reach 65%");
    // "Band 4" in this sentence is the AREA's overall band; "Band 3 to Band 4"
    // on a row below is one dimension's own. The collision was the reported
    // confusion, so the sentence says which it means.
    expect(nextBandWorking(r)).toContain("Overall Band 4 starts above 60%");
    expect(nextBandWorking(r)).toContain("Any 3 single-band moves");
  });

  it("takes one step when the total sits exactly on the threshold", () => {
    const r = nextBandRoute(all({ approach: 3, processes: 3, systemsOutcomes: 3, review: 3 }));
    if (r.kind !== "route") throw new Error("expected a route");
    expect(r.totalPct).toBe(60);
    expect(r.steps).toBe(1);
    expect(r.reachedPct).toBe(65);
  });

  it("offers the lowest dimension first, with the official next-band wording", () => {
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }));
    if (r.kind !== "route") throw new Error("expected a route");
    expect(r.options.map((o) => o.from)).toEqual([2, 2, 3, 3]);
    const p = r.options.find((o) => o.key === "processes")!;
    expect(p.to).toBe(3);
    expect(p.descriptor).toBe(EDUTRUST_BANDS[2].processes);
  });

  it("lists a dimension already at Band 5 but offers it no step", () => {
    const r = nextBandRoute(all({ approach: 5, processes: 3, systemsOutcomes: 3, review: 3 }));
    if (r.kind !== "route") throw new Error("expected a route");
    // Listed, because the block says where EACH dimension stands.
    const a = r.options.find((o) => o.key === "approach")!;
    expect(a.atTop).toBe(true);
    expect(a.beyond).toEqual([]);
    expect(a.lines).toEqual([]);
    expect(a.descriptor).toBe("");
  });

  it("shows the rungs above the next step, with wording only and never an action", () => {
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }));
    if (r.kind !== "route") throw new Error("expected a route");
    const p = r.options.find((o) => o.key === "processes")!;
    expect(p.to).toBe(3);
    expect(p.beyond.map((b) => b.to)).toEqual([4, 5]);
    expect(p.beyond.map((b) => b.descriptor)).toEqual([EDUTRUST_BANDS[3].processes, EDUTRUST_BANDS[4].processes]);
    // A later rung carries no line-level claim at all: the run produced no
    // evidence about a band the area is not standing on.
    for (const b of p.beyond) expect(Object.keys(b)).toEqual(["to", "descriptor"]);
  });

  it("says top rather than forcing a route, and marks that nothing is left", () => {
    const r = nextBandRoute(all({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 }));
    if (r.kind !== "top") throw new Error("expected top");
    expect(r.totalPct).toBe(100);
    expect(r.allAtTop).toBe(true);
    expect(r.options.every((o) => o.atTop)).toBe(true);
  });

  it("keeps the ladder at the top band when a dimension can still move", () => {
    // 95%: the overall band is already 5, and Review is still on Band 4. The
    // block used to vanish here, taking that remaining step with it.
    const r = nextBandRoute(all({ approach: 5, processes: 5, systemsOutcomes: 5, review: 4 }));
    if (r.kind !== "top") throw new Error("expected top");
    expect(r.totalPct).toBe(95);
    expect(r.allAtTop).toBe(false);
    const review = r.options.find((o) => o.key === "review")!;
    expect(review.atTop).toBe(false);
    expect(review.to).toBe(5);
    expect(review.descriptor).toBe(EDUTRUST_BANDS[4].review);
    expect(review.beyond).toEqual([]);
  });

  it("gives no route when fewer than four dimensions were assessed", () => {
    expect(nextBandRoute(buildBandWorking({ approach: 4, processes: 3, systemsOutcomes: 2, review: 1 }))).toEqual({ kind: "no-total" });
    expect(nextBandRoute(undefined)).toEqual({ kind: "no-total" });
  });

  it("carries the run's own failing lines, and their own actions, onto the matching dimension", () => {
    const refs = dimensionStepLines({
      procedure: [
        { ref: "3.1.1.DS2.h", verdict: "Not met", fix: "Document the governing-law clause in the PPD." },
        { ref: "3.1.1.DS4", verdict: "Partial", fix: "Rewrite the review clause to name a schedule." },
        { ref: "3.1.1.DS1", verdict: "Met", fix: "never shown" },
      ],
      combined: [
        { ref: "3.1.1.DS3.c", verdict: "Not met", fix: "Keep a dated list of agents no longer representing you." },
        { ref: "3.1.1.DS4", verdict: "Partial", fix: "Record the annual review and its agreed actions." },
      ],
    });
    expect(refs.approach!.map((l) => l.ref)).toEqual(["3.1.1.DS2.h", "3.1.1.DS4"]);
    expect(refs.processes!.map((l) => l.ref)).toEqual(["3.1.1.DS3.c", "3.1.1.DS4"]);
    // The duplicate this replaced: DS4 falls short on BOTH passes and used to
    // be listed twice under Review.
    expect(refs.review!.map((l) => l.ref)).toEqual(["3.1.1.DS4"]);
    // And it keeps the COMBINED pass's action, which saw both halves.
    expect(refs.review![0].action).toBe("Record the annual review and its agreed actions.");
    expect(refs.review![0].from).toBe("combined");
    // Each line's action is its own row's, never the other pass's.
    expect(refs.approach!.find((l) => l.ref === "3.1.1.DS4")!.action).toBe("Rewrite the review clause to name a schedule.");
  });

  it("never repeats a ref within a dimension", () => {
    const refs = dimensionStepLines({
      combined: [
        { ref: "3.1.1.DS4", verdict: "Partial", fix: "first" },
        { ref: "3.1.1.DS4", verdict: "Not met", fix: "second" },
      ],
    });
    expect(refs.processes!.map((l) => l.ref)).toEqual(["3.1.1.DS4"]);
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }), refs);
    if (r.kind !== "route") throw new Error("expected a route");
    for (const o of r.options) expect(new Set(o.lines.map((l) => l.ref)).size).toBe(o.lines.length);
  });

  it("flags a line that holds more than one dimension back", () => {
    const refs = dimensionStepLines({
      procedure: [{ ref: "3.1.1.DS4", verdict: "Partial", fix: "a" }],
      combined: [{ ref: "3.1.1.DS4", verdict: "Partial", fix: "b" }],
    });
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }), refs);
    if (r.kind !== "route") throw new Error("expected a route");
    const onApproach = r.options.find((o) => o.key === "approach")!.lines.find((l) => l.ref === "3.1.1.DS4")!;
    expect(onApproach.alsoBlocks.sort()).toEqual(["Processes", "Review"]);
    // Systems & Outcomes has no line-level source, so it claims none.
    expect(r.options.find((o) => o.key === "systemsOutcomes")!.lines).toEqual([]);
  });

  it("keeps a line with no recorded action rather than dropping it", () => {
    const refs = dimensionStepLines({ combined: [{ ref: "3.1.1.DS3.c", verdict: "Not met" }] });
    expect(refs.processes).toEqual([{ ref: "3.1.1.DS3.c", action: "", from: "combined" }]);
  });
});
