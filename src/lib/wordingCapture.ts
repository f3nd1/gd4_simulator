// Instrumentation for the wording rules, measured on a REAL run.
//
// The five-case check that preceded this used mocked model responses, which is
// circular: the mock returned new-style text because it was told to. Nothing
// about word counts, banned openers or invented document names can be proved
// that way. This reads a genuine completed run and reports what the model
// actually wrote.
//
// It measures and reports. It never edits a verdict, a row or a stored result,
// and it is not wired into any assessment path.
import type { EvidenceAssessmentRow, PPDReviewRow } from "../types";

export const WHY_MIN = 35, WHY_MAX = 75;
export const FIX_MIN = 20, FIX_MAX = 55;
// The exact sentence the rules mandate where no action is needed. Length cannot
// bind on it, so it is scored as compliant rather than "too short".
export const NO_ACTION = "no further action required";

const BANNED_OPENERS = ["Although", "While", "Despite", "With the PPD assessed as", "Under the decision rules"];

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter((w) => w && w !== "—").length;
}

export function bannedOpener(s: string): string | null {
  const t = s.trim();
  return BANNED_OPENERS.find((o) => t.toLowerCase().startsWith(o.toLowerCase())) ?? null;
}

// Candidate proper names the model may have invented: document codes, dotted
// clause codes, multi-word Capitalised phrases, and role titles. Deliberately
// over-inclusive, because a missed invention is worse than a candidate the
// reader dismisses in a second. Every candidate is reported with whether it was
// found in the source text, never asserted as invented on its own.
const CODE_RE = /\b[A-Z][A-Z0-9]{1,}(?:-[A-Z0-9.]+){1,}\b/g;
const TITLE_RE = /\b(?:Head|Director|Manager|Officer|Coordinator|Registrar|Principal)\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
const PHRASE_RE = /\b(?:[A-Z][a-z]{2,}\s+){1,4}(?:Register|Log|Policy|Procedure|Manual|Form|System|Record|Records|Report|Minutes|Plan|Checklist|Framework|Handbook|DocType)\b/g;
// Words that are Capitalised for reasons other than being a document name.
const STOP = new Set(["the", "and", "of", "for", "to", "in", "a", "an", "ppd", "pei", "afi", "afis", "cap", "caps", "ssg", "edutrust", "gd4"]);

export function nameCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const re of [CODE_RE, TITLE_RE, PHRASE_RE]) {
    for (const m of text.matchAll(re)) {
      const v = m[0].trim();
      if (v.split(/\s+/).every((w) => STOP.has(w.toLowerCase()))) continue;
      found.add(v);
    }
  }
  return [...found];
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function inSource(candidate: string, sourceText: string): boolean {
  return normalise(sourceText).includes(normalise(candidate));
}

export type CapturedRow = {
  ref: string;
  verdict: string;
  why: string;
  fix: string;
  whyWords: number;
  fixWords: number;
  whyInRange: boolean;
  fixInRange: boolean;
  whyBannedOpener: string | null;
  fixBannedOpener: string | null;
  // Every candidate, with the honest answer for each: was it in the documents?
  namesNotInSource: string[];
  namesInSource: string[];
};

export type CaptureReport = {
  capturedAt: string;
  area: string;
  pass: "evidence" | "procedure";
  sourceFiles: string[];
  sourceChars: number;
  rows: CapturedRow[];
  totals: {
    rows: number;
    whyInRange: number;
    fixInRange: number;
    rowsWithBannedOpener: number;
    rowsWithNamesNotInSource: number;
    medianWhyWords: number;
    medianFixWords: number;
  };
  note: string;
};

const median = (ns: number[]) => {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function captureRow(ref: string, verdict: string, why: string, fix: string, sourceText: string): CapturedRow {
  const cands = [...new Set([...nameCandidates(why), ...nameCandidates(fix)])];
  const notInSource = cands.filter((c) => !inSource(c, sourceText));
  const fixIsNoAction = fix.toLowerCase().includes(NO_ACTION);
  return {
    ref, verdict, why, fix,
    whyWords: wordCount(why),
    fixWords: wordCount(fix),
    whyInRange: wordCount(why) >= WHY_MIN && wordCount(why) <= WHY_MAX,
    fixInRange: fix.trim() === "" || fixIsNoAction || (wordCount(fix) >= FIX_MIN && wordCount(fix) <= FIX_MAX),
    whyBannedOpener: bannedOpener(why),
    fixBannedOpener: bannedOpener(fix),
    namesNotInSource: notInSource,
    namesInSource: cands.filter((c) => !notInSource.includes(c)),
  };
}

export function buildWordingCapture(input: {
  area: string;
  pass: "evidence" | "procedure";
  evidenceRows?: EvidenceAssessmentRow[];
  procedureRows?: PPDReviewRow[];
  sourceFiles: string[];
  sourceText: string;
}): CaptureReport {
  const { area, pass, sourceFiles, sourceText } = input;
  const rows: CapturedRow[] =
    pass === "evidence"
      ? (input.evidenceRows ?? []).map((r) => captureRow(r.gdRef, r.verdict, r.comment ?? "", r.suggestedAction ?? "", sourceText))
      : (input.procedureRows ?? []).map((r) => captureRow(r.ref, r.verdict, r.fullComment || r.shortComment || "", r.suggestedRewrite ?? "", sourceText));
  return {
    capturedAt: new Date().toISOString(),
    area, pass, sourceFiles,
    sourceChars: sourceText.length,
    rows,
    totals: {
      rows: rows.length,
      whyInRange: rows.filter((r) => r.whyInRange).length,
      fixInRange: rows.filter((r) => r.fixInRange).length,
      rowsWithBannedOpener: rows.filter((r) => r.whyBannedOpener || r.fixBannedOpener).length,
      rowsWithNamesNotInSource: rows.filter((r) => r.namesNotInSource.length > 0).length,
      medianWhyWords: median(rows.map((r) => r.whyWords)),
      medianFixWords: median(rows.map((r) => r.fixWords)),
    },
    note:
      "namesNotInSource lists CANDIDATE names that could not be matched in the documents this run read. " +
      "The matcher is deliberately over-inclusive, so treat each entry as something to check by eye, not as a confirmed invention. " +
      "sourceChars is the size of the corpus the candidates were checked against; if it is 0, no source text was available and the name check means nothing.",
  };
}

export function captureFilename(area: string): string {
  const safe = area.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `wording-capture-${safe}-${new Date().toISOString().slice(0, 10)}.json`;
}
