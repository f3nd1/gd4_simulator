import { describe, it, expect, afterEach } from "vitest";
import { useGuidanceStore, disclaimerSnoozed, DISCLAIMER_SNOOZE_DAYS } from "../useGuidanceStore";

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => useGuidanceStore.setState({ disclaimerSnoozedAt: null }));

describe("the practice-check banner snooze", () => {
  it("shows by default, with nothing stored", () => {
    expect(disclaimerSnoozed(useGuidanceStore.getState().disclaimerSnoozedAt)).toBe(false);
    // An older stored blob has no such key at all.
    expect(disclaimerSnoozed(undefined)).toBe(false);
  });

  it("hides once snoozed", () => {
    useGuidanceStore.getState().snoozeDisclaimer();
    expect(disclaimerSnoozed(useGuidanceStore.getState().disclaimerSnoozedAt)).toBe(true);
  });

  it("comes back by itself: a dismissal that never expires is not a disclaimer", () => {
    const now = Date.UTC(2026, 8, 19);
    const at = now - DISCLAIMER_SNOOZE_DAYS * DAY;
    expect(disclaimerSnoozed(at + 1, now)).toBe(true);
    expect(disclaimerSnoozed(at, now)).toBe(false);
    expect(disclaimerSnoozed(at - DAY, now)).toBe(false);
  });

  it("is independent of the guidance master switch, which is for tips", () => {
    useGuidanceStore.getState().setEnabled(false);
    expect(disclaimerSnoozed(useGuidanceStore.getState().disclaimerSnoozedAt)).toBe(false);
    useGuidanceStore.getState().setEnabled(true);
  });
});
