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
