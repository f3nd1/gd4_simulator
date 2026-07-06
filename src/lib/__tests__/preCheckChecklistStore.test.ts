import { describe, it, expect } from "vitest";
import { usePreCheckChecklistStore } from "../../store/usePreCheckChecklistStore";

describe("usePreCheckChecklistStore — setVerified (Setup page's Approve / Revert to draft action)", () => {
  it("approves a draft item (false → true) and reverts it back to draft (true → false), editable either direction at any time", () => {
    const s = usePreCheckChecklistStore.getState();
    // 1.1.1's items are seeded as drafts (verified: false) — see DEFAULT_CHECKLISTS.
    const before = s.checklists["1.1.1"]?.[0];
    expect(before?.verified).toBe(false);

    s.setVerified("1.1.1", before!.id, true);
    expect(usePreCheckChecklistStore.getState().checklists["1.1.1"]?.[0].verified).toBe(true);

    s.setVerified("1.1.1", before!.id, false);
    expect(usePreCheckChecklistStore.getState().checklists["1.1.1"]?.[0].verified).toBe(false);

    // Reset so this test doesn't leak persisted state into other tests.
    usePreCheckChecklistStore.getState().resetToDefaults();
  });

  it("only touches the targeted item — a sibling item in the same GD4 item is unaffected", () => {
    const s = usePreCheckChecklistStore.getState();
    const items = s.checklists["4.2.2"] ?? [];
    expect(items.length).toBeGreaterThan(1);
    const [first, second] = items;
    expect(first.verified).toBe(true); // 4.2.2 is grounded/verified from the start

    s.setVerified("4.2.2", first.id, false);
    const after = usePreCheckChecklistStore.getState().checklists["4.2.2"]!;
    expect(after.find((d) => d.id === first.id)?.verified).toBe(false);
    expect(after.find((d) => d.id === second.id)?.verified).toBe(second.verified);

    usePreCheckChecklistStore.getState().resetToDefaults();
  });

  it("a non-existent defId is a no-op — no crash, checklist unchanged", () => {
    const s = usePreCheckChecklistStore.getState();
    const before = s.checklists["1.1.1"];
    s.setVerified("1.1.1", "no-such-id", true);
    expect(usePreCheckChecklistStore.getState().checklists["1.1.1"]).toEqual(before);
  });
});

describe("usePreCheckChecklistStore — batch actions (Setup page's 'All items' bulk bar)", () => {
  it("setVerifiedBatch approves a selection spanning multiple different GD4 items in one call", () => {
    const s = usePreCheckChecklistStore.getState();
    const a = s.checklists["1.1.1"]?.[0];
    const b = s.checklists["4.2.2"]?.[0];
    expect(a?.verified).toBe(false);

    s.setVerifiedBatch([{ itemId: "1.1.1", defId: a!.id }, { itemId: "4.2.2", defId: b!.id }], true);
    const after = usePreCheckChecklistStore.getState().checklists;
    expect(after["1.1.1"]?.find((d) => d.id === a!.id)?.verified).toBe(true);
    expect(after["4.2.2"]?.find((d) => d.id === b!.id)?.verified).toBe(true);

    usePreCheckChecklistStore.getState().resetToDefaults();
  });

  it("removeItemsBatch deletes only the selected pairs, leaving siblings and other items untouched", () => {
    const s = usePreCheckChecklistStore.getState();
    const items4_2_2 = s.checklists["4.2.2"] ?? [];
    expect(items4_2_2.length).toBeGreaterThan(1);
    const [toRemove, toKeep] = items4_2_2;
    const item1_1_1Before = s.checklists["1.1.1"];

    s.removeItemsBatch([{ itemId: "4.2.2", defId: toRemove.id }]);
    const after = usePreCheckChecklistStore.getState().checklists;
    expect(after["4.2.2"]?.find((d) => d.id === toRemove.id)).toBeUndefined();
    expect(after["4.2.2"]?.find((d) => d.id === toKeep.id)).toBeDefined();
    expect(after["1.1.1"]).toEqual(item1_1_1Before);

    usePreCheckChecklistStore.getState().resetToDefaults();
  });

  it("both batch methods are no-ops on an empty pairs array", () => {
    const s = usePreCheckChecklistStore.getState();
    const before = s.checklists;
    s.setVerifiedBatch([], true);
    s.removeItemsBatch([]);
    expect(usePreCheckChecklistStore.getState().checklists).toEqual(before);
  });
});
