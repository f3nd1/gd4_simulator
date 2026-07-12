import { describe, it, expect, afterEach } from "vitest";
import { useBenchmarkAfiStore, seedStaticIntoEntries } from "../../store/useBenchmarkAfiStore";
import { BENCHMARK_AFIS } from "../../data/benchmarkAFIs";
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

// Full reset for test isolation — NOT the same as the production
// resetToDefaults() action, which deliberately preserves CUST-* entries.
// Tests need a genuinely clean slate between each other.
afterEach(() => {
  useBenchmarkAfiStore.setState({ entries: [...BENCHMARK_AFIS] });
});

describe("useBenchmarkAfiStore — seeding", () => {
  it("a fresh store's entries equal a full copy of BENCHMARK_AFIS", () => {
    const entries = useBenchmarkAfiStore.getState().entries;
    expect(entries).toHaveLength(STATIC_COUNT);
    expect(entries).toEqual(BENCHMARK_AFIS);
  });

  it("seedStaticIntoEntries is idempotent — re-running it does not duplicate", () => {
    const once = seedStaticIntoEntries([]);
    const twice = seedStaticIntoEntries(once);
    expect(twice).toHaveLength(STATIC_COUNT);
    expect(twice.map((e) => e.id).sort()).toEqual(once.map((e) => e.id).sort());
  });

  it("seedStaticIntoEntries merges custom-only entries with the static set exactly once", () => {
    const customOnly = [{ ...draft(), id: "CUST-INT-1" }];
    const merged = seedStaticIntoEntries(customOnly);
    expect(merged).toHaveLength(STATIC_COUNT + 1);
    expect(merged.some((e) => e.id === "CUST-INT-1")).toBe(true);
    // Re-running against the already-merged result changes nothing further.
    expect(seedStaticIntoEntries(merged)).toHaveLength(STATIC_COUNT + 1);
  });
});

describe("useBenchmarkAfiStore — editing/removing an originally-seeded entry", () => {
  it("updateEntry can edit one of the original 67", () => {
    const target = BENCHMARK_AFIS[0];
    useBenchmarkAfiStore.getState().updateEntry(target.id, { findingText: "Edited text" });
    const after = useBenchmarkAfiStore.getState().entries.find((e) => e.id === target.id);
    expect(after?.findingText).toBe("Edited text");
  });

  it("removeEntry can delete one of the original 67", () => {
    const target = BENCHMARK_AFIS[0];
    useBenchmarkAfiStore.getState().removeEntry(target.id);
    expect(useBenchmarkAfiStore.getState().entries.find((e) => e.id === target.id)).toBeUndefined();
    expect(useBenchmarkAfiStore.getState().entries).toHaveLength(STATIC_COUNT - 1);
  });
});

describe("useBenchmarkAfiStore — resetToDefaults (scoped, never touches uploads)", () => {
  it("restores the 67 to their seeded text/existence after edits and removals", () => {
    const s = useBenchmarkAfiStore.getState();
    s.removeEntry(BENCHMARK_AFIS[0].id);
    s.updateEntry(BENCHMARK_AFIS[1].id, { findingText: "changed" });
    s.resetToDefaults();
    const after = useBenchmarkAfiStore.getState().entries;
    expect(after.find((e) => e.id === BENCHMARK_AFIS[0].id)).toEqual(BENCHMARK_AFIS[0]);
    expect(after.find((e) => e.id === BENCHMARK_AFIS[1].id)).toEqual(BENCHMARK_AFIS[1]);
  });

  it("leaves uploaded (CUST-*) entries completely untouched", () => {
    const s = useBenchmarkAfiStore.getState();
    s.addEntries([draft({ findingText: "My uploaded finding" })]);
    s.removeEntry(BENCHMARK_AFIS[0].id); // also remove a seeded one, to prove reset only restores THIS
    s.resetToDefaults();
    const after = useBenchmarkAfiStore.getState().entries;
    // The 67 are back...
    expect(after.find((e) => e.id === BENCHMARK_AFIS[0].id)).toBeDefined();
    // ...and the uploaded finding survived the reset.
    const uploaded = after.find((e) => e.findingText === "My uploaded finding");
    expect(uploaded).toBeDefined();
    expect(uploaded?.id).toMatch(/^CUST-INT-/);
  });

  it("does not duplicate the 67 when called on an already-clean store", () => {
    useBenchmarkAfiStore.getState().resetToDefaults();
    expect(useBenchmarkAfiStore.getState().entries).toHaveLength(STATIC_COUNT);
  });
});

describe("BENCHMARK_AFIS — never mutated by store operations", () => {
  it("stays byte-identical through updateEntry/removeEntry/addEntries/resetToDefaults", () => {
    const before = JSON.stringify(BENCHMARK_AFIS);
    const s = useBenchmarkAfiStore.getState();
    s.updateEntry(BENCHMARK_AFIS[0].id, { findingText: "mutate attempt" });
    s.removeEntry(BENCHMARK_AFIS[1].id);
    s.addEntries([draft()]);
    s.resetToDefaults();
    expect(JSON.stringify(BENCHMARK_AFIS)).toBe(before);
  });
});

describe("useBenchmarkAfiStore — addEntries", () => {
  it("assigns unique, source-prefixed ids to a whole batch in one call", () => {
    useBenchmarkAfiStore.getState().addEntries([draft({ source: "Internal" }), draft({ source: "External" }), draft({ source: "Internal" })]);
    const custom = useBenchmarkAfiStore.getState().entries.filter((e) => e.id.startsWith("CUST-"));
    expect(custom).toHaveLength(3);
    expect(custom[0].id).toBe("CUST-INT-1");
    expect(custom[1].id).toBe("CUST-EXT-1");
    expect(custom[2].id).toBe("CUST-INT-2");
  });

  it("never collides with an existing id, even across repeated calls", () => {
    useBenchmarkAfiStore.getState().addEntries([draft({ source: "Internal" })]);
    useBenchmarkAfiStore.getState().addEntries([draft({ source: "Internal" })]);
    const ids = useBenchmarkAfiStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("useBenchmarkAfiStore — updateEntry / removeEntry on custom entries", () => {
  it("updateEntry edits only the targeted entry", () => {
    useBenchmarkAfiStore.getState().addEntries([draft({ findingText: "A" }), draft({ findingText: "B" })]);
    const custom = useBenchmarkAfiStore.getState().entries.filter((e) => e.id.startsWith("CUST-"));
    const [first, second] = custom;
    useBenchmarkAfiStore.getState().updateEntry(first.id, { findingText: "Edited" });
    const after = useBenchmarkAfiStore.getState().entries;
    expect(after.find((e) => e.id === first.id)?.findingText).toBe("Edited");
    expect(after.find((e) => e.id === second.id)?.findingText).toBe("B");
  });
});
