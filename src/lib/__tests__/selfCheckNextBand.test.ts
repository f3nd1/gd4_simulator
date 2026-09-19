import { describe, it, expect } from "vitest";
import { buildBandWorking, nextBandRoute, nextBandWorking } from "../selfCheckBanding";
import { dimensionStepRefs } from "../selfCheckImprove";
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
    expect(nextBandWorking(r)).toContain("3 band steps of 5% would reach 65%");
    expect(nextBandWorking(r)).toContain("Any 3 band steps");
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

  it("offers no step on a dimension already at Band 5", () => {
    const r = nextBandRoute(all({ approach: 5, processes: 3, systemsOutcomes: 3, review: 3 }));
    if (r.kind !== "route") throw new Error("expected a route");
    expect(r.options.some((o) => o.key === "approach")).toBe(false);
  });

  it("says top rather than forcing a route", () => {
    expect(nextBandRoute(all({ approach: 5, processes: 5, systemsOutcomes: 5, review: 5 }))).toEqual({ kind: "top", totalPct: 100 });
  });

  it("gives no route when fewer than four dimensions were assessed", () => {
    expect(nextBandRoute(buildBandWorking({ approach: 4, processes: 3, systemsOutcomes: 2, review: 1 }))).toEqual({ kind: "no-total" });
    expect(nextBandRoute(undefined)).toEqual({ kind: "no-total" });
  });

  it("carries the run's own failing lines onto the matching dimension", () => {
    const refs = dimensionStepRefs({
      procedure: [{ ref: "3.1.1.DS2.h", verdict: "Not documented" }, { ref: "3.1.1.DS1", verdict: "Adequate" }],
      combined: [{ ref: "3.1.1.DS3.c", verdict: "Not met" }, { ref: "3.1.1.DS4", verdict: "Partial" }],
    });
    expect(refs.approach).toEqual(["3.1.1.DS2.h"]);
    expect(refs.processes).toEqual(["3.1.1.DS3.c", "3.1.1.DS4"]);
    // DS4 is the official "review for continual improvement" line.
    expect(refs.review).toEqual(["3.1.1.DS4"]);
    const r = nextBandRoute(all({ approach: 3, processes: 2, systemsOutcomes: 3, review: 2 }), refs);
    if (r.kind !== "route") throw new Error("expected a route");
    expect(r.options.find((o) => o.key === "processes")!.refs).toEqual(["3.1.1.DS3.c", "3.1.1.DS4"]);
    // No line-level source exists for Systems & Outcomes, so none is claimed.
    expect(r.options.find((o) => o.key === "systemsOutcomes")!.refs).toEqual([]);
  });
});
