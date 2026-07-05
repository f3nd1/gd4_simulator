import { describe, it, expect } from "vitest";
import { currentItemIds, currentSubIds, pruneRecordByKeys, reconcileEvidenceMap } from "../structuralReconcile";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { ItemEvidence } from "../../types";

const ev = (): ItemEvidence => ({ approach: "good", processes: "good", systemsOutcomes: "good", review: "good", owner: "SQ", age: 1, trace: 1, drive: "x" });

describe("structuralReconcile — id sets", () => {
  it("currentItemIds contains surviving items and excludes removed ones", () => {
    const ids = currentItemIds();
    expect(ids.has("2.1.1")).toBe(true);
    expect(ids.has("7.1.1")).toBe(true);
    expect(ids.has("7.2.1")).toBe(false); // removed
    expect(ids.has("7.1.2")).toBe(false); // collapsed
    expect(ids.size).toBe(GD4_REQUIREMENTS.length);
  });
  it("currentSubIds excludes removed coarse/folded sub-criteria", () => {
    const subs = currentSubIds();
    expect(subs.has("2.1.1")).toBe(true);
    expect(subs.has("7.1")).toBe(true);
    expect(subs.has("2.1")).toBe(false);
    expect(subs.has("7.2")).toBe(false);
  });
});

describe("reconcileEvidenceMap", () => {
  it("keeps surviving ratings, drops removed keys, blank-fills every current item", () => {
    const src = { "2.1.1": ev(), "7.1.1": ev(), "7.2.1": ev() };
    const out = reconcileEvidenceMap(src)!;
    // surviving items keep their (good) ratings — NOT silently blanked
    expect(out["2.1.1"].approach).toBe("good");
    expect(out["7.1.1"].approach).toBe("good");
    // removed item dropped
    expect(out["7.2.1"]).toBeUndefined();
    // a current item the source lacked is present and blank (Missing) — no undefined index
    expect(out["2.1.2"]).toBeTruthy();
    expect(out["2.1.2"].approach).toBe("Missing");
    // exactly the current item set, no more, no less
    expect(Object.keys(out).sort()).toEqual(GD4_REQUIREMENTS.map((r) => r.id).sort());
  });
  it("passes undefined through", () => {
    expect(reconcileEvidenceMap(undefined)).toBeUndefined();
  });
});

describe("pruneRecordByKeys", () => {
  it("keeps valid keys, drops the rest, passes undefined through", () => {
    const valid = new Set(["a", "c"]);
    expect(pruneRecordByKeys({ a: 1, b: 2, c: 3 }, valid)).toEqual({ a: 1, c: 3 });
    expect(pruneRecordByKeys(undefined, valid)).toBeUndefined();
  });
});
