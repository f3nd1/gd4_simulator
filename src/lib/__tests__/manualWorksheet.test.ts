import { describe, it, expect } from "vitest";
import {
  WORKSHEET_HEADERS,
  VERDICT_OPTIONS,
  worksheetType,
  worksheetRef,
  worksheetCriterion,
  assembleWorksheetRows,
  buildWorksheetCsv,
} from "../manualWorksheet";
import { parseCsv, type DomainChecklistRow } from "../domainChecklist";

const row = (over: Partial<DomainChecklistRow> = {}): DomainChecklistRow => ({
  id: "x1", criterionId: "4", sectionKey: "Pre-Course Counselling, Selection & Admission (4.1)",
  sectionKind: "checks", subCriterionIds: ["4.1.1"], text: "Some check.", status: "built-in", custom: false,
  ...over,
});

describe("worksheetType", () => {
  it("maps the Red flags section to Red flag, whatever the wording", () => {
    expect(worksheetType(row({ sectionKind: "red-flags", text: "Any fee paid not fully FPS-covered." }))).toBe("Red flag");
  });

  it("maps a zero-tolerance SECTION to Zero-tolerance", () => {
    expect(worksheetType(row({ sectionKey: "Student Contract, Fee Collection & FPS (4.2) — zero tolerance" }))).toBe("Zero-tolerance");
  });

  it("maps regulatory-severity WORDING to Zero-tolerance", () => {
    for (const text of [
      "any uncovered fee is a serious regulatory finding.",
      "an unregistered teacher is a regulatory finding, not an AFI.",
      "A qualified opinion is a material finding.",
      "Refunds run on statutory timelines.",
    ]) expect(worksheetType(row({ text })), text).toBe("Zero-tolerance");
  });

  it("leaves ordinary checks and guidance as Core", () => {
    expect(worksheetType(row())).toBe("Core");
    expect(worksheetType(row({ sectionKind: "analytics", text: "What data should leadership be analysing?" }))).toBe("Core");
  });

  // Measured against the real 155: a bare "non-conformity" cue mis-flagged
  // three checks that only DISCUSS NCs. Keep them Core.
  it("does not flag a check merely for discussing non-conformities", () => {
    expect(worksheetType(row({
      sectionKind: "checks", sectionKey: "Internal Assessment (6.1)",
      text: "Look for non-conformities raised with corrective actions tracked to closure.",
    }))).toBe("Core");
    expect(worksheetType(row({
      sectionKind: "analytics", sectionKey: "Data analytics & the higher bands",
      text: "Look for trend and pattern analysis of non-conformities across cycles.",
    }))).toBe("Core");
  });
});

describe("worksheetRef", () => {
  it("lists the tagged sub-criteria, de-duplicated and sorted", () => {
    expect(worksheetRef(row({ subCriterionIds: ["4.2.2", "4.2.1", "4.2.2"] }))).toBe("4.2.1, 4.2.2");
  });

  it("falls back to a criterion-level tag rather than an empty cell", () => {
    expect(worksheetRef(row({ criterionId: "1", subCriterionIds: [] }))).toBe("C1 (all)");
  });
});

describe("worksheetCriterion", () => {
  it("gives a human-readable, sortable criterion name", () => {
    expect(worksheetCriterion("4")).toBe("C4 Student Protection and Support Services");
  });
});

describe("assembleWorksheetRows", () => {
  it("expands one check into several rows when the AI found several asks", () => {
    const r = row({ id: "a" });
    const out = assembleWorksheetRows([r], new Map([["a", [
      { describe: "Describe how you keep fee records.", showMe: "" },
      { describe: "", showMe: "Show me the signed auditor's report." },
    ]]]));
    expect(out).toHaveLength(2);
    expect(out[0].showMe).toBe("");
    expect(out[1].describe).toBe("");
  });

  it("keeps a genuinely blank half blank rather than filling it", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [{ describe: "", showMe: "Show me the register." }]]]));
    expect(out[0].describe).toBe("");
  });

  it("drops an ask with both halves empty instead of emitting a blank question", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [{ describe: "  ", showMe: "" }]]]));
    expect(out).toEqual([]);
  });

  it("skips a check the AI returned nothing for", () => {
    expect(assembleWorksheetRows([row({ id: "a" })], new Map())).toEqual([]);
  });
});

describe("buildWorksheetCsv", () => {
  it("emits the agreed columns, blank answer cells and a seeded verdict", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [{ describe: "Describe how you counsel.", showMe: "Show me 3 records." }]]]));
    const cells = parseCsv(buildWorksheetCsv(out));
    expect(cells[0]).toEqual(WORKSHEET_HEADERS);
    expect(cells[1]).toEqual([
      "4.1.1", "C4 Student Protection and Support Services", "Core",
      "Describe how you counsel.", "Show me 3 records.", "", "", VERDICT_OPTIONS, "",
    ]);
  });

  it("carries no item_id or status, so it can never be fed back to the edit importer", () => {
    expect(WORKSHEET_HEADERS).not.toContain("item_id");
    expect(WORKSHEET_HEADERS).not.toContain("status");
  });
});
