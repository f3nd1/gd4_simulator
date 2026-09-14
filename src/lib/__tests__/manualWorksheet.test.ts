import { describe, it, expect } from "vitest";
import {
  WORKSHEET_HEADERS,
  VERDICT_OPTIONS,
  worksheetType,
  worksheetRef,
  worksheetCriterion,
  worksheetSubCriterion,
  ensureAskStem,
  assembleWorksheetRows,
  buildWorksheetCsv,
  newQuestionId,
  type AskType,
  type WorksheetQuestion,
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

const q = (text: string, askType: AskType = "Document", source: "ai" | "hand" = "ai"): WorksheetQuestion =>
  ({ id: newQuestionId(), text, askType, source });

describe("worksheetSubCriterion", () => {
  it("normalises an item ref to the sub-criterion Felix audits at", () => {
    expect(worksheetSubCriterion(row({ subCriterionIds: ["4.1.1"] }))).toBe("4.1");
  });

  it("says criterion-wide rather than leaving the cell blank", () => {
    expect(worksheetSubCriterion(row({ subCriterionIds: [] }))).toBe("Criterion-wide");
  });

  it("keeps Ref precise while Sub-criterion groups, so the two columns differ", () => {
    const r = row({ subCriterionIds: ["4.1.1"] });
    expect(worksheetRef(r)).toBe("4.1.1");
    expect(worksheetSubCriterion(r)).toBe("4.1");
  });
});

describe("assembleWorksheetRows", () => {
  it("gives every question its own row, sharing the parent check's tagging", () => {
    const r = row({ id: "a", subCriterionIds: ["4.1.1"] });
    const out = assembleWorksheetRows([r], new Map([["a", [
      q("Describe how you counsel.", "Process"),
      q("Show me three counselling records.", "Document"),
      q("Show me the training records.", "Document"),
    ]]]));
    expect(out).toHaveLength(3);
    expect(out.map((x) => x.askType)).toEqual(["Process", "Document", "Document"]);
    // Every row inherits the check's identity.
    expect(new Set(out.map((x) => x.ref))).toEqual(new Set(["4.1.1"]));
    expect(new Set(out.map((x) => x.subCriterion))).toEqual(new Set(["4.1"]));
    expect(new Set(out.map((x) => x.type))).toEqual(new Set(["Core"]));
  });

  it("does not pad or truncate: one question in, one row out", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [q("Only one ask.")]]]));
    expect(out).toHaveLength(1);
  });

  it("drops a question whose text is empty", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [q("real"), q("   ")]]]));
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe("real");
  });

  it("skips a check with no questions unless keepEmpty is set", () => {
    expect(assembleWorksheetRows([row({ id: "a" })], new Map())).toEqual([]);
  });

  it("keeps one blank row per question-less check when keepEmpty is set, so the sheet is not quietly short", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map(), { keepEmpty: true });
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe("");
    expect(out[0].askType).toBe("");
    expect(out[0].ref).toBe("4.1.1");
  });
});

describe("buildWorksheetCsv", () => {
  it("emits the agreed columns with one Question column and an Ask type", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [q("Show me three counselling records.", "Document")]]]));
    const cells = parseCsv(buildWorksheetCsv(out));
    expect(cells[0]).toEqual(WORKSHEET_HEADERS);
    expect(cells[0]).not.toContain("Describe");
    expect(cells[0]).not.toContain("Show me");
    expect(cells[1]).toEqual([
      "4.1.1", "C4 Student Protection and Support Services", "4.1", "Core",
      "Document", "Show me three counselling records.", "", "", VERDICT_OPTIONS, "",
    ]);
  });

  it("leaves the answer columns blank and seeds every Verdict", () => {
    const out = assembleWorksheetRows([row({ id: "a" })], new Map([["a", [q("x"), q("y", "Process")]]]));
    const cells = parseCsv(buildWorksheetCsv(out)).slice(1);
    expect(cells.every((c) => c[6] === "" && c[7] === "" && c[9] === "")).toBe(true);
    expect(cells.every((c) => c[8] === VERDICT_OPTIONS)).toBe(true);
  });

  it("carries no item_id or status, so it can never be fed back to the edit importer", () => {
    expect(WORKSHEET_HEADERS).not.toContain("item_id");
    expect(WORKSHEET_HEADERS).not.toContain("status");
  });
});

// The 13 broken rows in the real export were all Document asks derived from
// Expected-evidence bullets, which the library writes as
// "**3.1.1 Selection & Appointment:** agent selection records, signed
// agreements…". The model dropped the bold label AND the ask with it.
describe("ensureAskStem", () => {
  it("rescues the real fragments from the export, verbatim", () => {
    for (const [broken, fixed] of [
      ["the agent agreements.", "Show me the agent agreements."],
      ["agent briefing records.", "Show me agent briefing records."],
      ["the Standard PEI-Student Contract and the signed copies for sampled students.",
       "Show me the Standard PEI-Student Contract and the signed copies for sampled students."],
    ] as const) {
      expect(ensureAskStem(broken, "Document")).toBe(fixed);
    }
  });

  it("uses the Process stem for a Process ask", () => {
    expect(ensureAskStem("the reconciliation routine.", "Process")).toBe("Describe how you handle the reconciliation routine.");
  });

  it("leaves every real ask stem alone", () => {
    for (const ok of [
      "Show me the agent agreements.",
      "show me the agent agreements.",
      "Describe how you verify the qualifications.",
      "Confirm the cooling-off period is at least 7 working days.",
      "For sampled students, show me the counselling forms.",
      "Walk me through the refund calculation.",
      "Which staff approve payments?",
    ]) {
      expect(ensureAskStem(ok, "Document")).toBe(ok);
    }
  });

  // A capitalised sentence is a real sentence the stem list simply does not
  // enumerate; prefixing it would produce nonsense like
  // "Show me The board reviews this quarterly."
  it("does not prefix a sentence that already starts with a capital", () => {
    expect(ensureAskStem("The board reviews this quarterly.", "Document")).toBe("The board reviews this quarterly.");
  });

  it("trims, and returns empty for empty", () => {
    expect(ensureAskStem("   the agent agreements.  ", "Document")).toBe("Show me the agent agreements.");
    expect(ensureAskStem("   ", "Document")).toBe("");
  });

  it("is idempotent, so a repaired question is never double-stemmed", () => {
    const once = ensureAskStem("the agent agreements.", "Document");
    expect(ensureAskStem(once, "Document")).toBe(once);
  });
});
