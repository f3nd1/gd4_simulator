import { describe, it, expect, afterEach } from "vitest";
import { useCustomBenchmarkStore } from "../../store/useCustomBenchmarkStore";
import { BENCHMARK_AFIS, combineBenchmarkAfis } from "../../data/benchmarkAFIs";
import type { BenchmarkAFI } from "../../data/benchmarkAFIs";

const STATIC_COUNT = BENCHMARK_AFIS.length;

function draft(overrides: Partial<Omit<BenchmarkAFI, "id">> = {}): Omit<BenchmarkAFI, "id"> {
  return {
    year: 2026,
    kind: "AFI",
    subCriterion: "1.1",
    findingText: "Test finding text.",
    findingPattern: "other",
    hasNamedExample: false,
    source: "Internal",
    ...overrides,
  };
}

afterEach(() => {
  useCustomBenchmarkStore.setState({ entries: [] });
});

describe("useCustomBenchmarkStore — addEntries", () => {
  it("assigns unique, source-prefixed ids to a whole batch in one call", () => {
    useCustomBenchmarkStore.getState().addEntries([draft({ source: "Internal" }), draft({ source: "External" }), draft({ source: "Internal" })]);
    const { entries } = useCustomBenchmarkStore.getState();
    expect(entries).toHaveLength(3);
    expect(entries[0].id).toBe("CUST-INT-1");
    expect(entries[1].id).toBe("CUST-EXT-1");
    expect(entries[2].id).toBe("CUST-INT-2");
  });

  it("never collides with an existing id, even across repeated calls", () => {
    useCustomBenchmarkStore.getState().addEntries([draft({ source: "Internal" })]);
    useCustomBenchmarkStore.getState().addEntries([draft({ source: "Internal" })]);
    const ids = useCustomBenchmarkStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("static BENCHMARK_AFIS is untouched regardless of how many custom entries exist", () => {
    useCustomBenchmarkStore.getState().addEntries([draft(), draft(), draft()]);
    expect(BENCHMARK_AFIS.length).toBe(STATIC_COUNT);
  });
});

describe("useCustomBenchmarkStore — updateEntry / removeEntry / removeEntriesBatch", () => {
  it("updateEntry edits only the targeted entry", () => {
    useCustomBenchmarkStore.getState().addEntries([draft({ findingText: "A" }), draft({ findingText: "B" })]);
    const [first, second] = useCustomBenchmarkStore.getState().entries;
    useCustomBenchmarkStore.getState().updateEntry(first.id, { findingText: "Edited" });
    const after = useCustomBenchmarkStore.getState().entries;
    expect(after.find((e) => e.id === first.id)?.findingText).toBe("Edited");
    expect(after.find((e) => e.id === second.id)?.findingText).toBe("B");
  });

  it("removeEntry deletes only the targeted entry", () => {
    useCustomBenchmarkStore.getState().addEntries([draft(), draft()]);
    const [first, second] = useCustomBenchmarkStore.getState().entries;
    useCustomBenchmarkStore.getState().removeEntry(first.id);
    const after = useCustomBenchmarkStore.getState().entries;
    expect(after.find((e) => e.id === first.id)).toBeUndefined();
    expect(after.find((e) => e.id === second.id)).toBeDefined();
  });

  it("removeEntriesBatch deletes exactly the given ids in one call", () => {
    useCustomBenchmarkStore.getState().addEntries([draft(), draft(), draft()]);
    const ids = useCustomBenchmarkStore.getState().entries.map((e) => e.id);
    useCustomBenchmarkStore.getState().removeEntriesBatch([ids[0], ids[2]]);
    const after = useCustomBenchmarkStore.getState().entries;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(ids[1]);
  });
});

describe("BENCHMARK_AFIS — static seed defaults", () => {
  it("every static entry defaults to source: External", () => {
    expect(BENCHMARK_AFIS.every((a) => a.source === "External")).toBe(true);
  });
});

describe("combineBenchmarkAfis", () => {
  it("concatenates static + custom without mutating BENCHMARK_AFIS", () => {
    const custom = [{ ...draft(), id: "CUST-INT-1" }];
    const combined = combineBenchmarkAfis(custom);
    expect(combined).toHaveLength(STATIC_COUNT + 1);
    expect(BENCHMARK_AFIS).toHaveLength(STATIC_COUNT);
    expect(combined.slice(0, STATIC_COUNT)).toEqual(BENCHMARK_AFIS);
  });

  it("with an empty custom array returns exactly the static set", () => {
    expect(combineBenchmarkAfis([])).toEqual(BENCHMARK_AFIS);
  });
});
