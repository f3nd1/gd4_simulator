import { describe, it, expect, afterEach } from "vitest";
import { useChecklistVerdictStore, verdictKey, type StoredChecklistVerdict } from "../useChecklistVerdictStore";

const v = (over: Partial<StoredChecklistVerdict> = {}): StoredChecklistVerdict => ({
  checkId: "6-x", subCriterionId: "6.2", bucket: "policy", verdict: "Met",
  rationale: "r", chunkIds: ["C001"], sourceHash: "h", runAt: "2026-09-14T00:00:00.000Z", path: "A", ...over,
});

afterEach(() => { useChecklistVerdictStore.setState({ entries: {} }); });

describe("key identity", () => {
  // Collapsing any of the three would let an unrelated run silently overwrite
  // an earlier answer: a criterion-wide check is genuinely assessed once per
  // sub-criterion, and the two buckets answer different questions.
  it("keeps check, sub-criterion and bucket separate", () => {
    useChecklistVerdictStore.getState().putRun([
      v(), v({ bucket: "evidence" }), v({ subCriterionId: "6.3" }), v({ checkId: "6-y" }),
    ]);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(4);
    expect(verdictKey("6-x", "6.2", "policy")).toBe("6-x::6.2::policy");
  });

  it("a re-run replaces that key rather than appending a duplicate", () => {
    useChecklistVerdictStore.getState().putRun([v({ verdict: "Not met" })]);
    useChecklistVerdictStore.getState().putRun([v({ verdict: "Met", runId: "R2" })]);
    const entries = useChecklistVerdictStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(1);
    expect(entries[verdictKey("6-x", "6.2", "policy")]).toMatchObject({ verdict: "Met", runId: "R2" });
  });
});

describe("bounded storage", () => {
  it("caps the number of entries so this store cannot grow into a quota problem", () => {
    const many = Array.from({ length: 700 }, (_, i) => v({ checkId: `c${i}` }));
    useChecklistVerdictStore.getState().putRun(many);
    expect(Object.keys(useChecklistVerdictStore.getState().entries).length).toBeLessThanOrEqual(500);
  });
  it("clips the free-text fields on write", () => {
    useChecklistVerdictStore.getState().putRun([v({ rationale: "x".repeat(900), quote: "y".repeat(900) })]);
    const e = useChecklistVerdictStore.getState().entries[verdictKey("6-x", "6.2", "policy")];
    expect(e.rationale.length).toBeLessThanOrEqual(400);
    expect(e.quote!.length).toBeLessThanOrEqual(300);
  });
  it("keeps the most recently written entries when the cap bites", () => {
    useChecklistVerdictStore.getState().putRun(Array.from({ length: 500 }, (_, i) => v({ checkId: `old${i}` })));
    useChecklistVerdictStore.getState().putRun([v({ checkId: "newest" })]);
    expect(useChecklistVerdictStore.getState().entries[verdictKey("newest", "6.2", "policy")]).toBeDefined();
  });
});

describe("clearing", () => {
  it("clearForSub removes only that sub-criterion's verdicts", () => {
    useChecklistVerdictStore.getState().putRun([v(), v({ subCriterionId: "6.3" })]);
    useChecklistVerdictStore.getState().clearForSub("6.2");
    const left = Object.values(useChecklistVerdictStore.getState().entries);
    expect(left).toHaveLength(1);
    expect(left[0].subCriterionId).toBe("6.3");
  });
  it("an empty run writes nothing rather than clearing what is there", () => {
    useChecklistVerdictStore.getState().putRun([v()]);
    useChecklistVerdictStore.getState().putRun([]);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(1);
  });
});
