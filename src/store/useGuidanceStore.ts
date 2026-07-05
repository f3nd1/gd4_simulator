// Guidance layer state: one master toggle (Settings → "Show guidance and
// tips") plus which first-time walkthroughs have been seen. localStorage
// only — device-level UI preference, not audit data. Pure zustand (no
// driveClient chain) so it IS unit-testable under Vitest.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  // simulated-data, internal-estimate-only) are NEVER stored, so they can only
  // be hidden for the current view and always reappear on the next run/reload.
  dismissedTips: Record<string, boolean>;
  dismissTip: (key: string) => void;
  resetDismissedTips: () => void;
};

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
      resetDismissedTips: () => set({ dismissedTips: {} }),
    }),
    { name: "ucc-gd4-guidance:v1", storage: createJSONStorage(() => localStorage) }
  )
);
