import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseDomainMarkdown,
  composeDomainMarkdown,
  domainRowsFor,
  buildDomainChecklistCsv,
  parseCsv,
  mergeDomainChecklistCsv,
  makeCustomDomainItem,
  EMPTY_DOMAIN_OVERRIDES,
  type ParsedDomainFile,
  type DomainChecklistOverrides,
} from "../domainChecklist";

const SKILLS_DIR = join(__dirname, "..", "..", "data", "skills");

function criterionFiles(): { criterionId: string; file: string; raw: string }[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => /^criterion-\d-/.test(f))
    .sort()
    .map((file) => ({
      criterionId: /^criterion-(\d)-/.exec(file)![1],
      file,
      raw: readFileSync(join(SKILLS_DIR, file), "utf8"),
    }));
}

function parseAll(): Record<string, ParsedDomainFile> {
  const out: Record<string, ParsedDomainFile> = {};
  for (const { criterionId, raw } of criterionFiles()) out[criterionId] = parseDomainMarkdown(criterionId, raw);
  return out;
}

describe("domain checklist parse/compose is lossless", () => {
  // THE migration guarantee: with nobody having edited anything, the markdown
  // handed to the AI is the same bytes it has always been. If this fails, the
  // editor is silently changing audit prompts.
  it("recomposes every criterion file byte-identically with no overrides", () => {
    const files = criterionFiles();
    expect(files.length).toBe(7);
    for (const { criterionId, file, raw } of files) {
      const parsed = parseDomainMarkdown(criterionId, raw);
      expect(composeDomainMarkdown(parsed, EMPTY_DOMAIN_OVERRIDES), `${file} did not round-trip`).toBe(raw);
    }
  });

  it("captures every bullet and numbered line as an editable item, and nothing else", () => {
    for (const { criterionId, file, raw } of criterionFiles()) {
      const parsed = parseDomainMarkdown(criterionId, raw);
      const expected = raw.split("\n").filter((l) => l.startsWith("- ") || /^\d+\.\s/.test(l)).length;
      expect(parsed.items.length, `${file}`).toBe(expected);
      // Every item's text must appear verbatim in the source file.
      for (const it of parsed.items) expect(raw.includes(it.text), `${file}: "${it.text.slice(0, 40)}"`).toBe(true);
    }
  });

  it("gives every item a unique id and a real section", () => {
    for (const { criterionId, file, raw } of criterionFiles()) {
      const parsed = parseDomainMarkdown(criterionId, raw);
      const ids = new Set(parsed.items.map((i) => i.id));
      expect(ids.size, `${file} has duplicate item ids`).toBe(parsed.items.length);
      const sections = new Set(parsed.sections.map((s) => s.key));
      for (const it of parsed.items) expect(sections.has(it.sectionKey), `${file}: ${it.sectionKey}`).toBe(true);
    }
  });

  it("tags sub-criteria only from real GD4 references", () => {
    const parsed = parseAll();
    // Criterion 4's expected-evidence bullets name their own item id in bold.
    const c4 = parsed["4"].items.find((i) => i.text.startsWith("**4.1.1 "));
    expect(c4?.subCriterionIds).toEqual(["4.1.1"]);
    // A heading range tags both endpoints.
    const c2 = parsed["2"].items.find((i) => i.sectionKey.startsWith("Human Resource"));
    expect(c2?.subCriterionIds).toEqual(["2.1.1", "2.1.2"]);
    // Every tag that is produced must be a real GD4 reference.
    for (const p of Object.values(parsed)) {
      for (const it of p.items) {
        for (const ref of it.subCriterionIds) expect(ref.startsWith(p.criterionId + "."), `${it.id}: ${ref}`).toBe(true);
      }
    }
  });
});

describe("overrides change exactly what they say", () => {
  const parsed = parseAll();

  it("an edit replaces only that line", () => {
    const target = parsed["1"].items[0];
    const out = composeDomainMarkdown(parsed["1"], { ...EMPTY_DOMAIN_OVERRIDES, edits: { [target.id]: "REPLACED." } });
    expect(out).toContain("- REPLACED.");
    expect(out).not.toContain(target.text);
    // Nothing else moved: same number of lines as the original.
    expect(out.split("\n").length).toBe(composeDomainMarkdown(parsed["1"]).split("\n").length);
  });

  it("a removal drops the line and renumbers a numbered list", () => {
    const redFlags = parsed["1"].items.filter((i) => i.sectionKind === "red-flags");
    expect(redFlags.length).toBe(5);
    const out = composeDomainMarkdown(parsed["1"], { ...EMPTY_DOMAIN_OVERRIDES, removed: [redFlags[0].id] });
    expect(out).not.toContain(redFlags[0].text);
    expect(out).toContain(`1. ${redFlags[1].text}`);
    expect(out).toContain(`4. ${redFlags[4].text}`);
  });

  it("a draft custom item is NOT injected until approved", () => {
    const draft = makeCustomDomainItem({ criterionId: "5", sectionKey: parsed["5"].sections[0].key, text: "Teacher deployment approved by the Academic Board, with the approval date recorded." });
    const withDraft = composeDomainMarkdown(parsed["5"], { ...EMPTY_DOMAIN_OVERRIDES, added: [draft] });
    expect(withDraft).toBe(composeDomainMarkdown(parsed["5"]));

    const approved = composeDomainMarkdown(parsed["5"], { ...EMPTY_DOMAIN_OVERRIDES, added: [{ ...draft, verified: true }] });
    expect(approved).toContain("- Teacher deployment approved by the Academic Board");
  });

  it("an approved custom item lands once, in its own section", () => {
    const section = parsed["5"].sections.find((s) => s.kind === "red-flags")!;
    const item = { ...makeCustomDomainItem({ criterionId: "5", sectionKey: section.key, text: "New red flag." }), verified: true };
    const out = composeDomainMarkdown(parsed["5"], { ...EMPTY_DOMAIN_OVERRIDES, added: [item] });
    expect(out.split("New red flag.").length - 1).toBe(1);
    expect(out).toContain("6. New red flag.");
  });
});

describe("CSV round trip", () => {
  const parsed = parseAll();
  const allRows = () => Object.values(parsed).flatMap((p) => domainRowsFor(p, EMPTY_DOMAIN_OVERRIDES));

  it("exports one row per check across all 7 criteria", () => {
    const rows = allRows();
    const totalItems = Object.values(parsed).reduce((n, p) => n + p.items.length, 0);
    expect(rows.length).toBe(totalItems);
    const csv = buildDomainChecklistCsv(rows);
    expect(parseCsv(csv).length).toBe(rows.length + 1);
  });

  it("re-importing an untouched export changes nothing", () => {
    const csv = buildDomainChecklistCsv(allRows());
    const { overrides, report } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, csv);
    expect(report.errors).toEqual([]);
    expect(report.updated).toBe(0);
    expect(report.added).toBe(0);
    expect(report.removed).toBe(0);
    expect(overrides).toEqual(EMPTY_DOMAIN_OVERRIDES);
    // And the composed prompt is still byte-identical to the file on disk.
    for (const { criterionId, raw } of criterionFiles()) {
      expect(composeDomainMarkdown(parsed[criterionId], overrides)).toBe(raw);
    }
  });

  it("survives the BOM, CRLF and commas/quotes that Excel introduces", () => {
    const rows = allRows();
    const csv = "﻿" + buildDomainChecklistCsv(rows);
    const back = parseCsv(csv);
    expect(back[0][0]).toBe("item_id");
    const commaRow = rows.find((r) => r.text.includes(",") && r.text.includes('"'));
    if (commaRow) {
      const found = back.find((r) => r[0] === commaRow.id);
      expect(found?.[6]).toBe(commaRow.text);
    }
  });

  it("applies an edit, an addition and a removal from a hand-edited file", () => {
    const rows = allRows();
    const editTarget = rows.find((r) => r.criterionId === "1")!;
    const removeTarget = rows.find((r) => r.criterionId === "3")!;
    const edited = rows.map((r) => {
      if (r.id === editTarget.id) return { ...r, text: "Edited by Felix in the CSV." };
      if (r.id === removeTarget.id) return { ...r, status: "removed" as const };
      return r;
    });
    let csv = buildDomainChecklistCsv(edited);
    csv += `\r\n,5,5.2,${JSON.stringify(parsed["5"].sections[1].key)},What to check,custom-active,"Teacher deployment approved by the Academic Board, and when."`;

    const { overrides, report } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, csv);
    expect(report.errors).toEqual([]);
    expect(report.updated).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.added).toBe(1);

    expect(composeDomainMarkdown(parsed["1"], overrides)).toContain("- Edited by Felix in the CSV.");
    expect(composeDomainMarkdown(parsed["3"], overrides)).not.toContain(removeTarget.text);
    expect(composeDomainMarkdown(parsed["5"], overrides)).toContain("Teacher deployment approved by the Academic Board, and when.");
    // Untouched criteria are still byte-identical.
    expect(composeDomainMarkdown(parsed["7"], overrides)).toBe(criterionFiles().find((f) => f.criterionId === "7")!.raw);
  });

  it("rejects bad rows instead of applying or dropping them", () => {
    const base = buildDomainChecklistCsv(allRows().slice(0, 2));
    const bad = base
      + `\r\n,9,,Nope,What to check,custom-draft,Wrong criterion`
      + `\r\nnot-a-real-id,1,,Red flags,Red flag,built-in,Unknown id`
      + `\r\n,5,,No Such Section,What to check,custom-draft,Bad section`;
    const { overrides, report } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, bad);
    expect(report.added).toBe(0);
    expect(report.errors.length).toBe(3);
    expect(overrides.added).toEqual([]);
  });

  it("an omitted row is left alone, never deleted", () => {
    const rows = allRows();
    const onlyOne = buildDomainChecklistCsv([rows[0]]);
    const { overrides, report } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, onlyOne);
    expect(report.removed).toBe(0);
    expect(overrides.removed).toEqual([]);
    for (const { criterionId, raw } of criterionFiles()) {
      expect(composeDomainMarkdown(parsed[criterionId], overrides)).toBe(raw);
    }
  });

  it("re-importing after an edit is idempotent", () => {
    const first: DomainChecklistOverrides = { edits: {}, removed: [], added: [] };
    const rows = Object.values(parsed).flatMap((p) => domainRowsFor(p, first));
    const target = rows.find((r) => r.criterionId === "6")!;
    const csv = buildDomainChecklistCsv(rows.map((r) => (r.id === target.id ? { ...r, text: "Changed once." } : r)));
    const once = mergeDomainChecklistCsv(parsed, first, csv);
    const twice = mergeDomainChecklistCsv(parsed, once.overrides, csv);
    expect(twice.report.updated).toBe(0);
    expect(twice.overrides.edits).toEqual(once.overrides.edits);
  });
});
