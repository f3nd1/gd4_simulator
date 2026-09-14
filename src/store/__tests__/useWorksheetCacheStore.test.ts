import { describe, it, expect, afterEach } from "vitest";
import { useWorksheetCacheStore } from "../useWorksheetCacheStore";
import { worksheetCacheKey } from "../../lib/manualWorksheet";

afterEach(() => { useWorksheetCacheStore.setState({ entries: {} }); });

const ask = (d: string) => [{ describe: d, showMe: "" }];

describe("worksheetCacheKey", () => {
  it("changes when the check text changes, so an edit misses", () => {
    expect(worksheetCacheKey("v1", "a")).not.toBe(worksheetCacheKey("v1", "a "));
  });

  it("changes when the prompt version changes, so a reworded prompt invalidates everything", () => {
    expect(worksheetCacheKey("v1", "a")).not.toBe(worksheetCacheKey("v2", "a"));
  });

  it("is stable for identical input, so an untouched check hits", () => {
    expect(worksheetCacheKey("v1", "same")).toBe(worksheetCacheKey("v1", "same"));
  });
});

describe("useWorksheetCacheStore", () => {
  it("merges new entries over existing ones", () => {
    useWorksheetCacheStore.getState().putMany({ a: ask("1") });
    useWorksheetCacheStore.getState().putMany({ b: ask("2") });
    expect(Object.keys(useWorksheetCacheStore.getState().entries).sort()).toEqual(["a", "b"]);
  });

  it("caps the stored entries so the synced blob cannot grow without bound", () => {
    const big: Record<string, ReturnType<typeof ask>> = {};
    for (let i = 0; i < 700; i++) big[`k${i}`] = ask(String(i));
    useWorksheetCacheStore.getState().putMany(big);
    const entries = useWorksheetCacheStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(500);
    // The most recently written survive; the oldest are dropped.
    expect(entries["k699"]).toBeDefined();
    expect(entries["k0"]).toBeUndefined();
  });

  it("clear empties it", () => {
    useWorksheetCacheStore.getState().putMany({ a: ask("1") });
    useWorksheetCacheStore.getState().clear();
    expect(useWorksheetCacheStore.getState().entries).toEqual({});
  });
});
