// Guidance layer state: one master toggle (Settings → "Show guidance and
// tips") plus which first-time walkthroughs have been seen. localStorage
// only — device-level UI preference, not audit data. Pure zustand (no
// driveClient chain) so it IS unit-testable under Vitest.

import { create } from "zustand";
import { blockWritesIfHydrationFailed } from "./hydrationGate";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeLocalStorage } from "./safeLocalStorage";

type GuidanceState = {
  // Master switch: banners, tooltips added by the guidance layer, and
  // walkthroughs all hide when false. Default ON.
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  // Walkthroughs seen, keyed by page id ("start-audit", "evidence-folder").
  seenWalkthroughs: Record<string, boolean>;
  markWalkthroughSeen: (pageId: string) => void;
  resetWalkthrough: (pageId: string) => void;
  // Instructional 👉 tips the user has dismissed, keyed by tip text/slug. Only
  // NON-compliance tips are persisted here — trust/disclaimer banners (live-AI,
  // simulated-data, internal-estimate-only) are NEVER stored here, so they can
  // only be hidden for the current view and always reappear on the next
  // run/reload.
  dismissedTips: Record<string, boolean>;
  dismissTip: (key: string) => void;
  // ONE exception to the line above, and it is a snooze rather than a
  // dismissal: the self-check page's top practice-check banner. Someone who
  // runs the check weekly read it every time.
  //
  // It is a timestamp, not a boolean, because a disclaimer that can be turned
  // off forever stops being a disclaimer: the next person to use this browser
  // would never see it. It comes back by itself after DISCLAIMER_SNOOZE_DAYS.
  // Per device on purpose, like everything else in this store.
  //
  // It covers ONLY the repeated banner at the top of the page. The same
  // sentence beside a band qualifies that specific number, and the copies in
  // the CSV and the printed page travel to people who dismissed nothing, so
  // none of those three is snoozable.
  disclaimerSnoozedAt: number | null;
  snoozeDisclaimer: () => void;
};

// Long enough that a weekly user sees it a handful of times a year rather than
// fifty, short enough that it is still a recurring reminder.
export const DISCLAIMER_SNOOZE_DAYS = 30;

export function disclaimerSnoozed(at: number | null | undefined, now = Date.now()): boolean {
  return typeof at === "number" && now - at < DISCLAIMER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

export const useGuidanceStore = create<GuidanceState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (on) => set({ enabled: on }),
      seenWalkthroughs: {},
      markWalkthroughSeen: (pageId) => set((s) => ({ seenWalkthroughs: { ...s.seenWalkthroughs, [pageId]: true } })),
      resetWalkthrough: (pageId) =>
        set((s) => {
          const { [pageId]: _r, ...rest } = s.seenWalkthroughs;
          return { seenWalkthroughs: rest };
        }),
      dismissedTips: {},
      dismissTip: (key) => set((s) => ({ dismissedTips: { ...s.dismissedTips, [key]: true } })),
      disclaimerSnoozedAt: null,
      snoozeDisclaimer: () => set({ disclaimerSnoozedAt: Date.now() }),
    }),
    { name: "ucc-gd4-guidance:v1",
      onRehydrateStorage: blockWritesIfHydrationFailed("ucc-gd4-guidance:v1"), storage: createJSONStorage(() => safeLocalStorage) }
  )
);
