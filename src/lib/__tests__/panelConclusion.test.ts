import { describe, it, expect } from "vitest";
import { computePanelConclusion, panelClosureTargets, parsePanelClassification } from "../panelConclusion";
import type { PanelSynthesis } from "../../types";

function syn(over: Partial<PanelSynthesis> = {}): PanelSynthesis {
  return {
    summary: "s",
    riskImpact: "r",
    rootCause: "Panel root cause — no control links fee collection to contract sign-off.",
    immediateCorrection: "Halt collection until contracts are signed.",
    correctiveAction: "Add a signed-contract gate to the finance workflow.",
    evidenceForClosure: "Fee register cross-checked to signed contracts for the period.",
    finalClassification: "NC (Major) — regulatory requirement not met.",
    ...over,
  };
}

describe("panelClosureTargets — the field mapping", () => {
  it("maps evidenceForClosure to the CLOSURE-EVIDENCE field, not preventive", () => {
    const t = panelClosureTargets(syn());
    expect(t.evid).toBe("Fee register cross-checked to signed contracts for the period.");
    // ISO 9001 10.2 split: immediateCorrection → containment, correctiveAction → corr.
    expect(t.containment).toBe("Halt collection until contracts are signed.");
    expect(t.corr).toBe("Add a signed-contract gate to the finance workflow.");
    expect(t.corr).not.toContain("Halt collection");
    expect(t.root).toContain("no control links fee collection");
    // There is deliberately no preventive target — evidence must never land there.
    expect(t as Record<string, unknown>).not.toHaveProperty("prev");
  });
});

describe("parsePanelClassification", () => {
  it("reads NC + Major/Minor", () => {
    expect(parsePanelClassification("NC (Major) — breach")).toEqual({ findingType: "NC", ncSeverity: "Major" });
    expect(parsePanelClassification("NC minor, documentation only")).toEqual({ findingType: "NC", ncSeverity: "Minor" });
    expect(parsePanelClassification("nonconformity")).toEqual({ findingType: "NC", ncSeverity: "Minor" });
  });
  it("reads OFI and Observation with no severity", () => {
    expect(parsePanelClassification("OFI: process could be tightened")).toEqual({ findingType: "OFI", ncSeverity: null });
    expect(parsePanelClassification("Observation only")).toEqual({ findingType: "OBS", ncSeverity: null });
  });
  it("treats CAR as a Major nonconformity and defaults unknown to NC", () => {
    expect(parsePanelClassification("CAR issued")).toEqual({ findingType: "NC", ncSeverity: "Major" });
    expect(parsePanelClassification("")).toEqual({ findingType: "NC", ncSeverity: "Minor" });
  });
});

describe("computePanelConclusion", () => {
  // (a) overwrites finding-writer-seeded (auto) closure fields
  it("overwrites auto-generated closure fields (no manual flags)", () => {
    const plan = computePanelConclusion(
      { closure: { root: "finding-writer root", corr: "fw corr", evid: "" }, findingType: "NC", ncSeverity: "Minor", synthesis: syn() },
      {}
    );
    expect(plan.closure.root).toContain("no control links fee collection");
    expect(plan.closure.corr).toBe("Add a signed-contract gate to the finance workflow.");
    expect(plan.closure.containment).toBe("Halt collection until contracts are signed.");
    expect(plan.conflicts).toEqual([]);
    expect(plan.clearedManual).toEqual(expect.arrayContaining(["root", "containment", "corr", "evid"]));
  });

  // (b) evidenceForClosure reaches evid, and nothing is written to preventive
  it("writes evidence into evid; the plan never carries a preventive field", () => {
    const plan = computePanelConclusion(
      { closure: {}, findingType: "NC", ncSeverity: "Minor", synthesis: syn() },
      {}
    );
    expect(plan.closure.evid).toBe("Fee register cross-checked to signed contracts for the period.");
    expect(plan.closure as Record<string, unknown>).not.toHaveProperty("prev");
  });

  // (c) header pills follow the panel's final classification
  it("changes classification to the panel's final classification", () => {
    const plan = computePanelConclusion(
      { closure: {}, findingType: "OFI", ncSeverity: null, synthesis: syn({ finalClassification: "NC (Major)" }) },
      {}
    );
    expect(plan.classification).toEqual({ findingType: "NC", ncSeverity: "Major" });
  });
  it("leaves classification unchanged when it already matches (no redundant change)", () => {
    const plan = computePanelConclusion(
      { closure: {}, findingType: "NC", ncSeverity: "Major", synthesis: syn({ finalClassification: "NC Major" }) },
      {}
    );
    expect(plan.classification).toBeNull();
  });

  // (d) manual edits are NOT silently overwritten — they're flagged
  it("defers to a manually-edited field and flags a conflict instead of overwriting", () => {
    const plan = computePanelConclusion(
      {
        closure: { root: "my hand-written root cause", manual: { root: true } },
        findingType: "NC", ncSeverity: "Minor", synthesis: syn(),
      },
      {}
    );
    expect(plan.closure.root).toBeUndefined();          // not overwritten
    expect(plan.conflicts).toContain("root cause");      // flagged for review
    expect(plan.closure.corr).toBeTruthy();              // other auto fields still applied
  });

  it("force=true (Apply panel conclusion) overrides even manual edits", () => {
    const plan = computePanelConclusion(
      {
        closure: { root: "my hand-written root cause", manual: { root: true } },
        findingType: "NC", ncSeverity: "Minor", classificationManual: true, synthesis: syn(),
      },
      { force: true }
    );
    expect(plan.closure.root).toContain("no control links fee collection");
    expect(plan.conflicts).toEqual([]);
  });

  it("never clobbers a field with empty synthesis text", () => {
    const plan = computePanelConclusion(
      { closure: { root: "keep me" }, findingType: "NC", ncSeverity: "Minor", synthesis: syn({ rootCause: "" }) },
      {}
    );
    expect(plan.closure.root).toBeUndefined(); // no write → store keeps existing value
  });

  // (Fix 4) a manual edit equal to the panel target is not a conflict
  it("does not flag a manual field whose text already equals the panel target", () => {
    const target = panelClosureTargets(syn()).root;
    const plan = computePanelConclusion(
      { closure: { root: target, manual: { root: true } }, findingType: "NC", ncSeverity: "Minor", synthesis: syn() },
      {}
    );
    expect(plan.conflicts).toEqual([]);
  });
});
