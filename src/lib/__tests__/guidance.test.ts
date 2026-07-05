import { describe, it, expect } from "vitest";
import { nextStepText } from "../guidanceText";
import { useGuidanceStore } from "../../store/useGuidanceStore";

describe("guidance master toggle (useGuidanceStore)", () => {
  it("guidance is ON by default; the master toggle flips it off and back", () => {
    expect(useGuidanceStore.getState().enabled).toBe(true);
    useGuidanceStore.getState().setEnabled(false);
    expect(useGuidanceStore.getState().enabled).toBe(false);
    useGuidanceStore.getState().setEnabled(true);
    expect(useGuidanceStore.getState().enabled).toBe(true);
  });

  it("walkthroughs are marked seen per page and can be reset to replay", () => {
    const s = useGuidanceStore.getState();
    expect(s.seenWalkthroughs["start-audit"]).toBeUndefined();
    s.markWalkthroughSeen("start-audit");
    expect(useGuidanceStore.getState().seenWalkthroughs["start-audit"]).toBe(true);
    useGuidanceStore.getState().resetWalkthrough("start-audit");
    expect(useGuidanceStore.getState().seenWalkthroughs["start-audit"]).toBeUndefined();
  });

  it("instructional tips persist dismissed per key, and can be reset", () => {
    const s = useGuidanceStore.getState();
    expect(s.dismissedTips["tip-a"]).toBeUndefined();
    s.dismissTip("tip-a");
    expect(useGuidanceStore.getState().dismissedTips["tip-a"]).toBe(true);
    // A different tip is unaffected — only the dismissed key is hidden.
    expect(useGuidanceStore.getState().dismissedTips["tip-b"]).toBeUndefined();
    useGuidanceStore.getState().resetDismissedTips();
    expect(useGuidanceStore.getState().dismissedTips["tip-a"]).toBeUndefined();
  });
});

describe("nextStepText — state-aware and mode-aware banner copy", () => {
  it("Start Audit always points to the mode choice then Evidence Folder", () => {
    expect(nextStepText("start-audit", { mode: "hybrid" })).toContain("Choose how much you want the AI to do");
  });

  it("Evidence Folder copy follows the mode", () => {
    expect(nextStepText("evidence-folder", { mode: "full-auto", linkedFolders: 5 })).toContain("Run full audit");
    expect(nextStepText("evidence-folder", { mode: "hybrid", linkedFolders: 5 })).toContain("approve each result");
    expect(nextStepText("evidence-folder", { mode: "manual", linkedFolders: 5 })).toContain("enter verdicts yourself");
  });

  it("Evidence Folder prioritises pending hybrid gates and missing links over the mode copy", () => {
    expect(nextStepText("evidence-folder", { mode: "hybrid", linkedFolders: 5, pendingGates: 3 })).toContain("waiting for your approval");
    expect(nextStepText("evidence-folder", { mode: "full-auto", linkedFolders: 0 })).toContain("pasting a Google Drive link");
  });

  it("PPD Review copy advances as steps complete", () => {
    expect(nextStepText("ppd-review", { mode: "hybrid" })).toContain("Run the PPD review first");
    expect(nextStepText("ppd-review", { mode: "hybrid", ppdRun: true })).toContain("Evidence tab");
    expect(nextStepText("ppd-review", { mode: "hybrid", ppdRun: true, evidenceRun: true })).toContain("compile findings");
    expect(nextStepText("ppd-review", { mode: "hybrid", ppdRun: true, evidenceRun: true, findingsCompiled: true })).toContain("assessed and compiled");
  });
});
