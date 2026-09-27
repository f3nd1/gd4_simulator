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
    // gdoc and sheet (size 0) come before the 4MB pdf; the two size-0 files are
    // then ordered by id, since neither carries a name.
    expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["gdoc", "sheet", "pdf"]);
  });

  it("is a pure copy — does not mutate the input", () => {
    const files = [{ id: "b", size: "2" }, { id: "a", size: "1" }];
    const sorted = orderBySizeForVisionBudget(files);
    expect(files.map((f) => f.id)).toEqual(["b", "a"]); // input untouched
    expect(sorted.map((f) => f.id)).toEqual(["a", "b"]);
  });

  // This used to assert that equal sizes "keep listing order". There is no
  // listing order to keep: the Drive query sends no orderBy, so the same folder
  // can come back with same-size files in either order, and file order fixes
  // the chunk ids and the 55k window boundaries. A folder of near-identical
  // exports could therefore put a requirement's evidence in a different window
  // on the next run and reach a different verdict.
  describe("equal sizes are ordered, not left to the listing", () => {
    const listingA = [
      { id: "id-3", name: "Attendance Mar.xlsx", size: "100" },
      { id: "id-1", name: "Attendance Jan.xlsx", size: "100" },
      { id: "id-2", name: "Attendance Feb.xlsx", size: "100" },
    ];
    // The same three files as Drive could equally return them.
    const listingB = [listingA[2], listingA[0], listingA[1]];
    const expected = ["Attendance Feb.xlsx", "Attendance Jan.xlsx", "Attendance Mar.xlsx"];

    it("gives the same order whichever order the listing arrived in", () => {
      expect(orderBySizeForVisionBudget(listingA).map((f) => f.name)).toEqual(expected);
      expect(orderBySizeForVisionBudget(listingB).map((f) => f.name)).toEqual(expected);
    });

    it("breaks a same-name tie on the file id, so the order is total", () => {
      // The same filename in two subfolders: name cannot separate them.
      const dup = [
        { id: "zzz", name: "Register.pdf", size: "100" },
        { id: "aaa", name: "Register.pdf", size: "100" },
      ];
      expect(orderBySizeForVisionBudget(dup).map((f) => f.id)).toEqual(["aaa", "zzz"]);
      expect(orderBySizeForVisionBudget([dup[1], dup[0]]).map((f) => f.id)).toEqual(["aaa", "zzz"]);
    });

    it("still puts a smaller file first, whatever its name", () => {
      const files = [
        { id: "a", name: "aaa.pdf", size: "900000" },
        { id: "z", name: "zzz.pdf", size: "100" },
      ];
      expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["z", "a"]);
    });

    it("survives a listing with no names at all", () => {
      const files = [{ id: "y", size: "100" }, { id: "x", size: "100" }];
      expect(orderBySizeForVisionBudget(files).map((f) => f.id)).toEqual(["x", "y"]);
    });
  });
});
