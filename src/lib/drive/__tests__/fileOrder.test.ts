import { describe, it, expect } from "vitest";
import { orderBySizeForVisionBudget } from "../textUtils";

// Smaller files first so large scanned PDFs early in the Drive listing don't
// burn the whole per-run vision budget before smaller files are reached.
describe("orderBySizeForVisionBudget", () => {
  it("orders by byte size ascending", () => {
    const files = [
      { id: "big", size: "5000000" },
      { id: "small", size: "1200" },
      { id: "mid", size: "80000" },
    ];
    expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["small", "mid", "big"]);
  });

  it("treats missing size (native Google Docs) as 0 — sorts first, never NaN", () => {
    const files = [
      { id: "pdf", size: "4000000" },
      { id: "gdoc" }, // no size field
      { id: "sheet", size: undefined },
    ];
    // gdoc and sheet (size 0) come before the 4MB pdf; equal sizes keep order.
    expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["gdoc", "sheet", "pdf"]);
  });

  it("is a pure copy — does not mutate the input", () => {
    const files = [{ id: "b", size: "2" }, { id: "a", size: "1" }];
    const sorted = orderBySizeForVisionBudget(files);
    expect(files.map((f) => f.id)).toEqual(["b", "a"]); // input untouched
    expect(sorted.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("is stable for equal sizes (preserves listing order)", () => {
    const files = [{ id: "x", size: "100" }, { id: "y", size: "100" }, { id: "z", size: "100" }];
    expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["x", "y", "z"]);
  });
});
