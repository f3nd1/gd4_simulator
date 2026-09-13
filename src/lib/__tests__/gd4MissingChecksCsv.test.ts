import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseDomainMarkdown,
  composeDomainMarkdown,
  mergeDomainChecklistCsv,
  EMPTY_DOMAIN_OVERRIDES,
  type ParsedDomainFile,
} from "../domainChecklist";

// Guards docs/gd4-v4-missing-checks.csv — the GD4 v4 coverage gaps shipped as
// a Checklist Library import rather than as edits to the markdown seed.
//
// Two of its rows EDIT built-in lines, addressed by content-derived id. Change
// the wording of either source line in criterion-7-outcomes.md and that id
// stops resolving: the import would silently degrade from "2 edited" to "2
// unknown item_id" errors. That is exactly what this test catches.

const SKILLS_DIR = join(__dirname, "..", "..", "data", "skills");
const CSV_PATH = join(__dirname, "..", "..", "..", "docs", "gd4-v4-missing-checks.csv");

function parseAll(): Record<string, ParsedDomainFile> {
  const out: Record<string, ParsedDomainFile> = {};
  for (const file of readdirSync(SKILLS_DIR).filter((f) => /^criterion-\d-/.test(f))) {
    const criterionId = /^criterion-(\d)-/.exec(file)![1];
    out[criterionId] = parseDomainMarkdown(criterionId, readFileSync(join(SKILLS_DIR, file), "utf8"));
  }
  return out;
}

const csv = () => readFileSync(CSV_PATH, "utf8");

describe("GD4 v4 missing-checks import file", () => {
  it("imports with no errors and the expected row counts", () => {
    const { report } = mergeDomainChecklistCsv(parseAll(), EMPTY_DOMAIN_OVERRIDES, csv());
    expect(report.errors).toEqual([]);
    expect(report.added).toBe(31);
    expect(report.updated).toBe(2);
    expect(report.removed).toBe(0);
  });

  it("lands every added check as a draft, so none reaches a prompt unapproved", () => {
    const { overrides } = mergeDomainChecklistCsv(parseAll(), EMPTY_DOMAIN_OVERRIDES, csv());
    expect(overrides.added).toHaveLength(31);
    expect(overrides.added.every((a) => a.verified === false)).toBe(true);
  });

  it("keeps drafts out of the composed prompt until approved", () => {
    const parsed = parseAll();
    const { overrides } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, csv());
    const draft = overrides.added.find((a) => a.criterionId === "7" && a.text.includes("Liquidity Ratio"));
    expect(draft).toBeDefined();

    expect(composeDomainMarkdown(parsed["7"], overrides)).not.toContain("Liquidity Ratio");

    const approved = { ...overrides, added: overrides.added.map((a) => (a.id === draft!.id ? { ...a, verified: true } : a)) };
    expect(composeDomainMarkdown(parsed["7"], approved)).toContain("Liquidity Ratio");
  });

  it("applies the two three-year-trend edits in place of the '2-3 cycles' wording", () => {
    const parsed = parseAll();
    const { overrides } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, csv());
    expect(Object.keys(overrides.edits)).toHaveLength(2);
    const composed = composeDomainMarkdown(parsed["7"], overrides);
    expect(composed).toContain("three-year trend");
    expect(composed).not.toContain("2–3 cycles");
  });

  it("files every added check under a section that already exists in its criterion", () => {
    const parsed = parseAll();
    const { overrides } = mergeDomainChecklistCsv(parsed, EMPTY_DOMAIN_OVERRIDES, csv());
    for (const a of overrides.added) {
      const keys = parsed[a.criterionId].sections.map((s) => s.key);
      expect(keys, `criterion ${a.criterionId}`).toContain(a.sectionKey);
    }
  });
});
