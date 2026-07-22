import { describe, it, expect } from "vitest";
import { runScopesForSub, scopeIdForItem, itemIdsForScope, isItemScope, subOfScope, scopeTitle, filterableScopes } from "../evidenceScope";
import { GD4_SUB_CRITERIA } from "../../data/gd4Requirements";

describe("evidenceScope — 4.2 splits per item, everything else stays per sub-criterion", () => {
  it("4.2 yields two run scopes (its two items), in requirement order", () => {
    expect(runScopesForSub("4.2")).toEqual(["4.2.1", "4.2.2"]);
  });

  it("2.2 stays merged (one scope) even though it has two items — deliberately not split", () => {
    expect(runScopesForSub("2.2")).toEqual(["2.2"]);
  });

  it("a normal single-item sub yields one scope (itself)", () => {
    expect(runScopesForSub("4.1")).toEqual(["4.1"]);
  });

  it("scopeIdForItem: 4.2 items key on their own item id; other items key on the sub", () => {
    expect(scopeIdForItem("4.2.1", "4.2")).toBe("4.2.1");
    expect(scopeIdForItem("4.2.2", "4.2")).toBe("4.2.2");
    // 2.2 items still share the "2.2" scope (not split)
    expect(scopeIdForItem("2.2.1", "2.2")).toBe("2.2");
    // a normal item keys on its sub
    expect(scopeIdForItem("4.1.1", "4.1")).toBe("4.1");
  });

  it("itemIdsForScope: a split scope assesses only its own item; a sub scope assesses all its items", () => {
    expect(itemIdsForScope("4.2.1")).toEqual(["4.2.1"]);
    expect(itemIdsForScope("4.2.2")).toEqual(["4.2.2"]);
    // "2.2" (not split) still assesses BOTH its items in one run
    expect(itemIdsForScope("2.2")).toEqual(["2.2.1", "2.2.2"]);
    expect(itemIdsForScope("4.1")).toEqual(["4.1.1"]);
  });

  it("isItemScope true only for a split sub's item", () => {
    expect(isItemScope("4.2.1")).toBe(true);
    expect(isItemScope("4.2")).toBe(false);   // the sub itself is not an item scope
    expect(isItemScope("2.2.1")).toBe(false);  // 2.2 not split
    expect(isItemScope("4.1")).toBe(false);
  });

  it("subOfScope resolves the real sub-criterion behind any scope", () => {
    expect(subOfScope("4.2.1")).toBe("4.2");
    expect(subOfScope("4.2.2")).toBe("4.2");
    expect(subOfScope("4.1")).toBe("4.1");
  });

  it("scopeTitle: item requirement for a split scope, sub title otherwise", () => {
    expect(scopeTitle("4.2.1")).toBe("Student Contract");
    expect(scopeTitle("4.2.2")).toBe("Fee Collection and Fee Protection Scheme");
    expect(scopeTitle("4.1")).toContain("Pre-Course Counselling");
  });

  // The canonical filter-option list every sub-criterion/item dropdown must use.
  it("filterableScopes splits 4.2 into 4.2.1 / 4.2.2 and never lists a bare 4.2", () => {
    const ids = filterableScopes().map((s) => s.id);
    expect(ids).toContain("4.2.1");
    expect(ids).toContain("4.2.2");
    expect(ids).not.toContain("4.2");           // the merged sub can never be an option
    expect(ids).toContain("2.2");               // 2.2 is NOT split, stays merged
    // Exactly one option per run scope across every sub-criterion, no duplicates.
    const expected = GD4_SUB_CRITERIA.flatMap((sc) => runScopesForSub(sc.id));
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filterableScopes narrows to one criterion and carries title + criterionId", () => {
    const c4 = filterableScopes("4");
    expect(c4.every((s) => s.criterionId === "4")).toBe(true);
    const s421 = c4.find((s) => s.id === "4.2.1");
    expect(s421).toEqual({ id: "4.2.1", title: "Student Contract", criterionId: "4", subCriterionId: "4.2" });
    expect(filterableScopes("All").map((s) => s.id)).toEqual(filterableScopes().map((s) => s.id));
  });
});
