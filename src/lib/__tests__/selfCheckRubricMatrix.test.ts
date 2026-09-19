import { describe, it, expect } from "vitest";
import { buildBandWorking, rubricMatrix } from "../selfCheckBanding";
import { EDUTRUST_BANDS } from "../../data/edutrustRubric";

// Two dimensions scored, two never looked at: the shape every self-check that
// skips the results-and-review pass produces.
const twoScored = () => buildBandWorking({ approach: 4, processes: 3, systemsOutcomes: 1, review: 1 });
const allScored = () => buildBandWorking(
  { approach: 4, processes: 3, systemsOutcomes: 2, review: 1 },
  {}, undefined, { systemsOutcomes: true, review: true },
);

describe("rubricMatrix", () => {
  it("gives five cells per dimension, descriptors verbatim from the rubric", () => {
    const m = rubricMatrix(twoScored());
    expect(m.bands.map((b) => b.band)).toEqual([1, 2, 3, 4, 5]);
    expect(m.rows).toHaveLength(4);
    for (const row of m.rows) {
      expect(row.cells).toHaveLength(5);
      row.cells.forEach((c, i) => expect(c.descriptor).toBe(EDUTRUST_BANDS[i][row.key]));
    }
  });

  it("marks the achieved band and the one above it", () => {
    const approach = rubricMatrix(twoScored()).rows.find((r) => r.key === "approach")!;
    expect(approach.state).toBe("scored");
    expect(approach.cells.map((c) => c.state)).toEqual(["plain", "plain", "plain", "achieved", "next"]);
  });

  it("marks no next band above Band 5", () => {
    const m = rubricMatrix(buildBandWorking({ approach: 5, processes: 3, systemsOutcomes: 1, review: 1 }));
    const approach = m.rows.find((r) => r.key === "approach")!;
    expect(approach.cells.filter((c) => c.state === "next")).toHaveLength(0);
    expect(approach.cells[4].state).toBe("achieved");
  });

  it("never highlights Band 1 for a dimension this run did not assess", () => {
    const m = rubricMatrix(twoScored());
    for (const key of ["systemsOutcomes", "review"] as const) {
      const row = m.rows.find((r) => r.key === key)!;
      expect(row.state).toBe("not-assessed");
      expect(row.band).toBeUndefined();
      expect(row.cells.every((c) => c.state === "plain")).toBe(true);
      expect(row.stateLabel).toBe("Not assessed by this check");
    }
  });

  it("scores all four when the results-and-review pass ran", () => {
    const m = rubricMatrix(allScored());
    expect(m.rows.every((r) => r.state === "scored")).toBe(true);
    expect(m.rows.find((r) => r.key === "review")!.cells[0].state).toBe("achieved");
  });

  it("renders a checked dimension with no band as its own state, not Band 1", () => {
    const m = rubricMatrix(buildBandWorking(undefined));
    const approach = m.rows.find((r) => r.key === "approach")!;
    expect(approach.state).toBe("checked-not-scored");
    expect(approach.cells.every((c) => c.state === "plain")).toBe(true);
    expect(approach.stateLabel).toMatch(/no band/i);
  });

  it("treats a scored 0 as below Band 1, highlighting nothing", () => {
    const m = rubricMatrix(buildBandWorking({ approach: 0, processes: 3, systemsOutcomes: 1, review: 1 }));
    const approach = m.rows.find((r) => r.key === "approach")!;
    expect(approach.state).toBe("checked-not-scored");
    expect(approach.stateLabel).toMatch(/below Band 1/);
    expect(approach.cells.every((c) => c.state === "plain")).toBe(true);
  });
});
