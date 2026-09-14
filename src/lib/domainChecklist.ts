// Editable domain-expertise checklists.
//
// The criterion checklists (src/data/skills/criterion-{1..7}-*.md) hold the
// specialist cross-checks, red flags and expected-evidence lists that are
// injected into every AI audit call for that criterion (domainExpertiseFor →
// buildDomainBlock). Until now they could only be changed by editing the
// markdown in the repo and redeploying, because this app is a client-only SPA
// and cannot write files back to disk.
//
// This module makes them editable in-app WITHOUT changing a byte of what the
// AI receives while nobody has edited anything:
//   markdown on disk  →  parseDomainMarkdown()  →  items
//   items + overrides →  composeDomainMarkdown() →  markdown for the prompt
// The markdown files stay on disk untouched and remain the seed. With no
// overrides, composeDomainMarkdown() returns a string byte-identical to the
// original file — asserted for all 7 criteria against the real files in
// __tests__/domainChecklist.test.ts. That equality IS the guarantee that
// adopting the editor changed no audit behaviour; if a future edit to the
// parser or a .md file breaks reversibility, that test fails.
//
// Only the criterion-{1..7} files are parsed. The three Criterion 4
// regulatory supplements are appended verbatim by domainExpertise.ts and are
// deliberately NOT parsed (fps-rules.md wraps bullets across lines, which this
// line-oriented parser does not model).

import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { toCsv } from "./auditCsvExport";

export type DomainSectionKind = "intro" | "checks" | "red-flags" | "analytics" | "expected-evidence" | "calibration";
export type DomainMarker = "bullet" | "number";

// One editable line from a criterion file: a cross-check bullet, a numbered
// red flag, or an expected-evidence bullet. `text` is the line verbatim with
// its list marker stripped; the marker is restored on compose.
export type DomainChecklistItem = {
  id: string;
  criterionId: string;
  sectionKey: string;
  sectionKind: DomainSectionKind;
  subCriterionIds: string[];
  marker: DomainMarker;
  text: string;
};

// A check the audit team added in-app. Starts unverified (draft) and is NOT
// injected into any prompt until explicitly approved — the same human gate
// the Pre-check checklist uses for its own added items.
export type DomainCustomItem = {
  id: string;
  criterionId: string;
  sectionKey: string;
  subCriterionIds: string[];
  text: string;
  verified: boolean;
  createdAt: string;
  note?: string;
};

// Everything the store persists: only the DIFF against the markdown seed, so
// a fresh workspace carries no copy of the shipped content and a later change
// to a .md file is picked up automatically for every unedited item.
export type DomainChecklistOverrides = {
  edits: Record<string, string>;
  removed: string[];
  added: DomainCustomItem[];
};

export const EMPTY_DOMAIN_OVERRIDES: DomainChecklistOverrides = { edits: {}, removed: [], added: [] };

type ProseBlock = { kind: "prose"; lines: string[] };
type ItemBlock = { kind: "items"; sectionKey: string; sectionKind: DomainSectionKind; marker: DomainMarker; items: DomainChecklistItem[] };
type DomainBlock = ProseBlock | ItemBlock;

export type DomainSection = { key: string; kind: DomainSectionKind };
export type ParsedDomainFile = {
  criterionId: string;
  blocks: DomainBlock[];
  items: DomainChecklistItem[];
  sections: DomainSection[];
};

// FNV-1a. Item ids are content-derived rather than positional so that
// reordering a .md file does not silently re-point a saved edit at a
// different check. Editing an item's source text intentionally orphans its
// override (the thing that was edited no longer exists).
// Exported so the worksheet cache can key its converted questions by the same
// content hash, instead of this file growing a second copy of it.
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function sectionKindOf(heading: string): DomainSectionKind {
  const h = heading.toLowerCase();
  if (h.startsWith("red flags")) return "red-flags";
  if (h.startsWith("data analytics")) return "analytics";
  if (h.startsWith("expected evidence")) return "expected-evidence";
  if (h.startsWith("calibration")) return "calibration";
  return "checks";
}

export const SECTION_KIND_LABEL: Record<DomainSectionKind, string> = {
  intro: "Intro",
  checks: "What to check",
  "red-flags": "Red flag",
  analytics: "Data analytics / higher bands",
  "expected-evidence": "Expected evidence",
  calibration: "Calibration",
};

// Real GD4 ids only, so a stray number in prose ("within 4 weeks") can never
// be mistaken for a requirement reference. Both sub-criterion ids ("4.1") and
// item ids ("4.1.1") count, because the headings use both.
const VALID_REFS = new Set<string>([...GD4_SUB_CRITERIA.map((s) => s.id), ...GD4_REQUIREMENTS.map((r) => r.id)]);
const SUB_OF_ITEM = new Map<string, string>(GD4_REQUIREMENTS.map((r) => [r.id, r.subCriterionId]));

// The sub-criterion a tagged reference belongs to (an item id resolves to its
// parent; a sub-criterion id is already one). Used for grouping in the UI.
export function subCriterionOfRef(ref: string): string {
  return SUB_OF_ITEM.get(ref) ?? ref;
}

function refsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d+(?:\.\d+){1,2}/g)) {
    if (VALID_REFS.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

// An expected-evidence bullet names its own requirement in a leading bold
// span ("**4.1.1 Counselling …:**"), which is more specific than the section
// heading. Anything else inherits the heading's references, so a passing
// mention deeper in the prose ("cross-reference 2.1.1") does not mis-tag it.
function subIdsFor(itemText: string, headingRefs: string[]): string[] {
  const bold = /^\*\*([^*]+)\*\*/.exec(itemText);
  const fromBold = bold ? refsIn(bold[1]) : [];
  return fromBold.length > 0 ? fromBold : headingRefs;
}

export function parseDomainMarkdown(criterionId: string, raw: string): ParsedDomainFile {
  const blocks: DomainBlock[] = [];
  const items: DomainChecklistItem[] = [];
  const sections: DomainSection[] = [];
  const usedIds = new Set<string>();

  let sectionKey = "";
  let sectionKind: DomainSectionKind = "intro";
  let headingRefs: string[] = [];
  let prose: string[] | null = null;
  let itemBlock: ItemBlock | null = null;

  const flushProse = () => {
    if (prose) { blocks.push({ kind: "prose", lines: prose }); prose = null; }
  };
  const flushItems = () => {
    if (itemBlock) { blocks.push(itemBlock); itemBlock = null; }
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) {
      flushProse();
      flushItems();
      sectionKey = line.slice(3).trim();
      sectionKind = sectionKindOf(sectionKey);
      headingRefs = refsIn(sectionKey);
      sections.push({ key: sectionKey, kind: sectionKind });
      prose = [line];
      continue;
    }

    const isBullet = line.startsWith("- ");
    const isNumber = /^\d+\.\s/.test(line);
    if (isBullet || isNumber) {
      const marker: DomainMarker = isBullet ? "bullet" : "number";
      const text = isBullet ? line.slice(2) : line.replace(/^\d+\.\s/, "");
      flushProse();
      if (itemBlock && itemBlock.marker !== marker) flushItems();
      if (!itemBlock) itemBlock = { kind: "items", sectionKey, sectionKind, marker, items: [] };

      const base = `${criterionId}-${fnv1a(text)}`;
      let id = base;
      let n = 2;
      while (usedIds.has(id)) { id = `${base}-${n}`; n += 1; }
      usedIds.add(id);

      const item: DomainChecklistItem = {
        id, criterionId, sectionKey, sectionKind,
        subCriterionIds: subIdsFor(text, headingRefs),
        marker, text,
      };
      itemBlock.items.push(item);
      items.push(item);
      continue;
    }

    flushItems();
    if (!prose) prose = [];
    prose.push(line);
  }

  flushProse();
  flushItems();
  return { criterionId, blocks, items, sections };
}

// Rebuilds the markdown. With EMPTY_DOMAIN_OVERRIDES this returns the original
// file byte for byte (see the module header). Approved custom items are
// appended to the LAST item block of the section they were filed under, so a
// section that happens to hold two lists cannot receive them twice.
export function composeDomainMarkdown(parsed: ParsedDomainFile, ov: DomainChecklistOverrides = EMPTY_DOMAIN_OVERRIDES): string {
  const removed = new Set(ov.removed);
  const lastBlockForSection = new Map<string, number>();
  parsed.blocks.forEach((b, i) => { if (b.kind === "items") lastBlockForSection.set(b.sectionKey, i); });

  const out: string[] = [];
  parsed.blocks.forEach((b, i) => {
    if (b.kind === "prose") { out.push(...b.lines); return; }
    const kept = b.items.filter((it) => !removed.has(it.id)).map((it) => ov.edits[it.id] ?? it.text);
    const extra = lastBlockForSection.get(b.sectionKey) === i
      ? ov.added
          .filter((a) => a.criterionId === parsed.criterionId && a.sectionKey === b.sectionKey && a.verified && !removed.has(a.id))
          .map((a) => a.text)
      : [];
    [...kept, ...extra].forEach((text, idx) => {
      out.push(b.marker === "bullet" ? `- ${text}` : `${idx + 1}. ${text}`);
    });
  });
  return out.join("\n");
}

// ── View model for the editor page ──────────────────────────────────────────

export type DomainRowStatus = "built-in" | "built-in-edited" | "custom-active" | "custom-draft" | "removed";

export type DomainChecklistRow = {
  id: string;
  criterionId: string;
  sectionKey: string;
  sectionKind: DomainSectionKind;
  subCriterionIds: string[];
  text: string;
  originalText?: string;
  status: DomainRowStatus;
  custom: boolean;
  note?: string;
};

// Every check for one criterion, built-in and custom, in prompt order, with
// its current text and status. The page renders this; CSV export serialises it.
export function domainRowsFor(parsed: ParsedDomainFile, ov: DomainChecklistOverrides = EMPTY_DOMAIN_OVERRIDES): DomainChecklistRow[] {
  const removed = new Set(ov.removed);
  const rows: DomainChecklistRow[] = parsed.items.map((it) => {
    const edited = ov.edits[it.id];
    const status: DomainRowStatus = removed.has(it.id) ? "removed" : edited != null && edited !== it.text ? "built-in-edited" : "built-in";
    return {
      id: it.id,
      criterionId: it.criterionId,
      sectionKey: it.sectionKey,
      sectionKind: it.sectionKind,
      subCriterionIds: it.subCriterionIds,
      text: edited ?? it.text,
      originalText: it.text,
      status,
      custom: false,
    };
  });

  const kindBySection = new Map(parsed.sections.map((s) => [s.key, s.kind]));
  for (const a of ov.added) {
    if (a.criterionId !== parsed.criterionId) continue;
    rows.push({
      id: a.id,
      criterionId: a.criterionId,
      sectionKey: a.sectionKey,
      sectionKind: kindBySection.get(a.sectionKey) ?? "checks",
      subCriterionIds: a.subCriterionIds,
      text: a.text,
      status: removed.has(a.id) ? "removed" : a.verified ? "custom-active" : "custom-draft",
      custom: true,
      note: a.note,
    });
  }
  return rows;
}

// ── CSV round trip ──────────────────────────────────────────────────────────

export const DOMAIN_CSV_HEADERS = ["item_id", "criterion", "sub_criteria", "section", "kind", "status", "text"];

export function buildDomainChecklistCsv(rows: DomainChecklistRow[]): string {
  return toCsv(
    DOMAIN_CSV_HEADERS,
    rows.map((r) => [r.id, r.criterionId, r.subCriterionIds.join(" "), r.sectionKey, SECTION_KIND_LABEL[r.sectionKind], r.status, r.text]),
  );
}

// Minimal RFC4180 reader: quoted cells may contain commas, newlines and ""
// escapes. Tolerates the UTF-8 BOM that downloadCsv() writes for Excel, and
// both CRLF and LF line endings, so a file exported here re-imports unchanged
// after a round trip through a spreadsheet.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type DomainImportReport = {
  updated: number;
  added: number;
  removed: number;
  restored: number;
  unchanged: number;
  errors: string[];
};

export type DomainImportResult = { overrides: DomainChecklistOverrides; report: DomainImportReport };

// Merges an edited CSV back over the current overrides.
//
// Deliberate semantics, so an import can never quietly destroy work:
//  - a row is matched by item_id; a blank/unknown id creates a NEW custom item
//  - a check is deleted ONLY by setting status=removed, never by deleting its
//    row from the file (an omitted row is left exactly as it is)
//  - every rejected row is reported, never skipped silently
//  - re-importing an untouched export is a no-op (all rows count "unchanged")
export function mergeDomainChecklistCsv(
  parsedByCriterion: Record<string, ParsedDomainFile>,
  current: DomainChecklistOverrides,
  csvText: string,
  now: () => string = () => new Date().toISOString(),
): DomainImportResult {
  const rows = parseCsv(csvText);
  const report: DomainImportReport = { updated: 0, added: 0, removed: 0, restored: 0, unchanged: 0, errors: [] };
  if (rows.length === 0) {
    report.errors.push("The file is empty.");
    return { overrides: current, report };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = DOMAIN_CSV_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    report.errors.push(`Missing column(s): ${missing.join(", ")}. Export a fresh CSV and edit that.`);
    return { overrides: current, report };
  }
  const col = (name: string) => header.indexOf(name);

  const builtIn = new Map<string, DomainChecklistItem>();
  for (const p of Object.values(parsedByCriterion)) for (const it of p.items) builtIn.set(it.id, it);

  const edits = { ...current.edits };
  const removed = new Set(current.removed);
  const added = current.added.map((a) => ({ ...a }));
  const customById = new Map(added.map((a) => [a.id, a]));
  let customSeq = added.length;

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    const at = (name: string) => (raw[col(name)] ?? "").trim();
    const id = at("item_id");
    const text = (raw[col("text")] ?? "").trim();
    const status = at("status").toLowerCase();
    const criterionId = at("criterion");
    const sectionKey = at("section");
    const line = r + 1;

    const known = builtIn.get(id);
    const customRow = customById.get(id);

    if (id && !known && !customRow) {
      report.errors.push(`Row ${line}: unknown item_id "${id}" — it does not match any current check. Clear the id to add it as a new check.`);
      continue;
    }

    if (known) {
      if (status === "removed") {
        if (!removed.has(id)) { removed.add(id); report.removed += 1; } else { report.unchanged += 1; }
        continue;
      }
      if (removed.delete(id)) report.restored += 1;
      if (!text) { report.errors.push(`Row ${line}: text is empty — a built-in check cannot be blanked. Use status=removed instead.`); continue; }
      if (text === known.text) {
        if (edits[id] != null) { delete edits[id]; report.updated += 1; } else { report.unchanged += 1; }
      } else if (edits[id] !== text) {
        edits[id] = text;
        report.updated += 1;
      } else {
        report.unchanged += 1;
      }
      continue;
    }

    if (customRow) {
      if (status === "removed") {
        const idx = added.findIndex((a) => a.id === id);
        if (idx >= 0) { added.splice(idx, 1); customById.delete(id); report.removed += 1; }
        continue;
      }
      if (!text) { report.errors.push(`Row ${line}: text is empty.`); continue; }
      const verified = status === "custom-active";
      if (customRow.text === text && customRow.verified === verified) { report.unchanged += 1; continue; }
      customRow.text = text;
      customRow.verified = verified;
      report.updated += 1;
      continue;
    }

    // No id: a new check.
    if (status === "removed") { report.unchanged += 1; continue; }
    if (!text) { report.errors.push(`Row ${line}: no item_id and no text — nothing to add.`); continue; }
    const parsed = parsedByCriterion[criterionId];
    if (!parsed) { report.errors.push(`Row ${line}: criterion "${criterionId}" is not 1-7.`); continue; }
    const section = parsed.sections.find((s) => s.key === sectionKey);
    if (!section) {
      report.errors.push(`Row ${line}: section "${sectionKey}" does not exist in criterion ${criterionId}. Copy a section name exactly as exported.`);
      continue;
    }
    customSeq += 1;
    const newItem: DomainCustomItem = {
      id: `custom-${criterionId}-${fnv1a(text + customSeq)}`,
      criterionId,
      sectionKey,
      subCriterionIds: refsIn(at("sub_criteria")),
      text,
      verified: status === "custom-active",
      createdAt: now(),
      note: "Imported from CSV",
    };
    added.push(newItem);
    customById.set(newItem.id, newItem);
    report.added += 1;
  }

  return { overrides: { edits, removed: [...removed], added }, report };
}

// Exposed for the page's "add check" form so a hand-added item gets the same
// id shape and reference parsing as an imported one.
export function makeCustomDomainItem(input: {
  criterionId: string;
  sectionKey: string;
  text: string;
  subCriteriaText?: string;
  note?: string;
}): DomainCustomItem {
  return {
    id: `custom-${input.criterionId}-${fnv1a(input.text + Date.now())}`,
    criterionId: input.criterionId,
    sectionKey: input.sectionKey,
    subCriterionIds: refsIn(input.subCriteriaText ?? ""),
    text: input.text,
    verified: false,
    createdAt: new Date().toISOString(),
    note: input.note,
  };
}
