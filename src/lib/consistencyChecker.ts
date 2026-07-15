// Deterministic, read-only Consistency Checker. Pure code, no AI, no writes.
// It takes the workspace state the app has already derived (checklist entries,
// the findings register, the built Final Report, and the active APSR scale) and
// runs a FIXED list of ten invariant checks (R1..R10, one per row in
// docs/consistency-invariants.md that this build was scoped to). Each check
// reuses the SAME derivation helpers the app displays with, so the checker can
// never disagree with what the user sees on screen. It returns a flat list of
// issues; it changes nothing.
//
// This file is the ENGINE only. There is deliberately no UI here.

import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine, ApsrBreakdown } from "../types";
import { apsrMatrixResult, lineCompleteness, lineApsr, resolveLineDimension, DEFAULT_APSR_SCALE, type ApsrScale } from "./checklistBanding";
import { isOptionANotAssessedNote, OPTION_A_NOT_ASSESSED_NOTE } from "./optionAChecklistWrite";
import { NOT_ASSESSED_FINDING, NOT_ASSESSED_AFI, type FinalReport } from "./finalReport";
import { carryoverKey } from "./cycleCarryover";
import { EDUTRUST_DIMENSIONS } from "../data/edutrustRubric";

export type ConsistencyRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10";

export type ConsistencyIssue = {
  ruleId: ConsistencyRuleId;
  message: string;      // plain English, UK spelling
  ref: string;          // the offending item id / finding id / line ref
};

// Everything the checker reads. All already built by the app; passed in so the
// engine stays a pure function and stays consistent with the live derivations.
export type ConsistencyInput = {
  entries: Record<string, SubCriterionChecklistEntry>;
  findings: Finding[];
  report: FinalReport;
  apsrScale?: ApsrScale; // defaults to DEFAULT_APSR_SCALE
};

type ApsrKey = keyof ApsrBreakdown; // "approach" | "processes" | "systemsOutcomes" | "review"

// The dimension LABEL resolveLineDimension returns, mapped back to the APSR key
// the report groups by and the evidence apsr is keyed by.
const LABEL_TO_KEY = new Map<string, ApsrKey>(EDUTRUST_DIMENSIONS.map((d) => [d.label, d.key as ApsrKey]));

// R4 polarity of a per-dimension apsr status. Only the unambiguous ends count;
// the "middle" values (Beginning/Weak/Limited) are deliberately left out so R4
// never flags a borderline case.
const POSITIVE_APSR_STATUS = new Set(["Meeting", "Deployed", "Evident"]);
const NEGATIVE_APSR_STATUS = new Set(["Not evident"]);

// R10 allowed vocabularies, copied from the union types in types/index.ts
// (unions do not exist at runtime, so the vocabulary must be listed here).
const ALLOWED_LINE_STATUS = new Set(["Met", "Partial", "Not met", "Not Applicable", "Not Started"]);
const ALLOWED_EVIDENCE_VERDICT = new Set(["Met", "Partial", "Not met"]); // SubChecklistEvidenceItem.evidenceVerdict is 3-valued (types/index.ts:331)
const ALLOWED_APSR_STATUS: Record<ApsrKey, Set<string>> = {
  approach: new Set(["Meeting", "Beginning", "Not evident"]),
  processes: new Set(["Deployed", "Weak", "Not evident"]),
  systemsOutcomes: new Set(["Evident", "Limited", "Not evident"]),
  review: new Set(["Evident", "Not evident"]),
};

const isBlank = (s: string) => s.trim().length === 0;
// A derived one-line fragment is suspect if it has an unclosed "(" (what "(e."
// is), or ends on a cut abbreviation "e." / "i." (from "e.g." / "i.e." chopped
// at the first full stop by finalReport's firstSentence).
function truncationReason(text: string): string | null {
  const open = (text.match(/\(/g) || []).length;
  const close = (text.match(/\)/g) || []).length;
  if (open > close) return "unbalanced parentheses (an unclosed bracket)";
  if (/(?:^|[^a-z])(e|i)\.$/i.test(text)) return "ends on a cut abbreviation";
  return null;
}

// R8 is a code-constant check, factored out as a pure function so a test can
// prove it flags DRIFTED strings while the engine calls it with the real ones.
// The three copies are "in sync" when the two display strings still carry the
// same "Not assessed by Option A" detection prefix isOptionANotAssessedNote
// keys on, and the finding text still contains the AFI as its actionable tail.
export function checkSentinelSync(rawNote: string, findingText: string, afiText: string): boolean {
  return isOptionANotAssessedNote(rawNote) && isOptionANotAssessedNote(findingText) && findingText.includes(afiText);
}

// Find, once, the checklist line each register finding was raised from, via the
// savedFindingId back-pointer stamped onto the line at raise time.
function lineByFindingId(entries: Record<string, SubCriterionChecklistEntry>): Map<string, SpecificChecklistLine> {
  const map = new Map<string, SpecificChecklistLine>();
  for (const entry of Object.values(entries)) {
    for (const line of entry.specific ?? []) {
      const id = line.draftFinding?.savedFindingId;
      if (id) map.set(id, line);
    }
  }
  return map;
}

export function runConsistencyChecks(input: ConsistencyInput): ConsistencyIssue[] {
  const { entries, findings, report } = input;
  const scale = input.apsrScale ?? DEFAULT_APSR_SCALE;
  const issues: ConsistencyIssue[] = [];

  // R1 (INV-01): a saved band with a matrix but zero lines behind it.
  for (const entry of Object.values(entries)) {
    if (entry.holisticBand?.matrixScores && (entry.specific?.length ?? 0) === 0) {
      issues.push({ ruleId: "R1", message: "A band is saved for this item but it has no checklist lines behind it, so the band rests on nothing.", ref: entry.gd4ItemId });
    }
  }

  // R6 (INV-08) + R7 (INV-09): stored band/percentage vs the matrix recomputed
  // under the CURRENT scale, and matrix completeness.
  for (const entry of Object.values(entries)) {
    const hb = entry.holisticBand;
    if (!hb?.matrixScores) continue;
    const r = apsrMatrixResult(hb.matrixScores, scale);
    if (hb.totalPct !== r.total || hb.band !== r.band) {
      issues.push({ ruleId: "R6", message: `The saved band (Band ${hb.band}, ${hb.totalPct}%) no longer matches its own matrix under the current scale (recomputes to Band ${r.band}, ${r.total}%). A scale change has left the saved figure stale.`, ref: entry.gd4ItemId });
    }
    if (!r.complete) {
      issues.push({ ruleId: "R7", message: "A band was saved from an incomplete matrix (not all four dimensions are scored).", ref: entry.gd4ItemId });
    }
  }

  // R5 (INV-07): band-derived "not started" while every line is assessed.
  for (const item of report.items) {
    if (item.started) continue;
    const comp = lineCompleteness(entries[item.id]?.specific ?? []);
    if (comp.total > 0 && comp.assessed === comp.total) {
      issues.push({ ruleId: "R5", message: `This item reads as "not started" from its band, yet all ${comp.total} of its checklist lines are assessed. The two signals disagree.`, ref: item.id });
    }
  }

  // R3 (INV-05): derived report text truncated mid-word/abbreviation or empty.
  for (const item of report.items) {
    const texts: { field: string; value: string | undefined; expected: boolean }[] = [
      { field: "overall summary", value: item.overallSummary, expected: false },
    ];
    for (const g of item.findingsGroups) {
      for (const row of g.rows) {
        texts.push({ field: `${g.label} finding (${row.itemRef})`, value: row.finding, expected: true });
        texts.push({ field: `${g.label} AFI (${row.itemRef})`, value: row.afi, expected: false });
      }
    }
    for (const t of texts) {
      if (t.value === undefined) continue;
      if (isBlank(t.value)) {
        if (t.expected) issues.push({ ruleId: "R3", message: `The ${t.field} text is empty where a value is expected.`, ref: item.id });
        continue;
      }
      const reason = truncationReason(t.value);
      if (reason) issues.push({ ruleId: "R3", message: `The ${t.field} text looks truncated: ${reason} ("${t.value.slice(-40)}").`, ref: item.id });
    }
  }

  // R4 (INV-06): a strength/weakness row whose dimension apsr status is the
  // opposite polarity. Deterministic: compares the row verdict against the
  // structured apsr.status enum, never the prose.
  for (const item of report.items) {
    for (const g of item.findingsGroups) {
      const key = g.key as ApsrKey;
      for (const row of g.rows) {
        if (row.verdict !== "weakness" && row.verdict !== "strength") continue;
        const line = entries[item.id]?.specific.find((l) => l.id === row.lineId);
        const status = line ? lineApsr(line)?.[key]?.status : undefined;
        if (!status) continue;
        const positive = POSITIVE_APSR_STATUS.has(status);
        const negative = NEGATIVE_APSR_STATUS.has(status);
        if (row.verdict === "weakness" && positive) {
          issues.push({ ruleId: "R4", message: `A "${g.label}" row is labelled Weakness but its underlying assessment status is "${status}" (positive). The label and the evidence disagree.`, ref: `${item.id} ${row.itemRef}` });
        } else if (row.verdict === "strength" && negative) {
          issues.push({ ruleId: "R4", message: `A "${g.label}" row is labelled Strength but its underlying assessment status is "${status}" (not evident). The label and the evidence disagree.`, ref: `${item.id} ${row.itemRef}` });
        }
      }
    }
  }

  // R2 (INV-02/03/04): a still-open finding whose source line has moved out of
  // the gap it was frozen on (line now Met/Not Applicable, or its dimension now
  // carries the not-assessed sentinel). The freeze is intentional; we only flag
  // the drift, we do not touch the finding.
  const lineFor = lineByFindingId(entries);
  for (const f of findings) {
    if (f.status === "Closed") continue;
    const line = lineFor.get(f.id);
    if (!line) continue;
    const movedToMetOrNa = line.status === "Met" || line.status === "Not Applicable";
    const dimKey = LABEL_TO_KEY.get(resolveLineDimension(line));
    const nowNotAssessed = !!dimKey && isOptionANotAssessedNote(lineApsr(line)?.[dimKey]?.note);
    if (movedToMetOrNa || nowNotAssessed) {
      const why = movedToMetOrNa ? `the line is now "${line.status}"` : "the line's dimension is now Not assessed";
      issues.push({ ruleId: "R2", message: `This finding is still open, but ${why}, so it no longer matches the checklist line it was raised from (it has gone stale).`, ref: f.id });
    }
  }

  // R9 (INV-11): more than one open finding for the same line/gap (same item +
  // ref, deliberately ignoring finding type, via carryoverKey).
  const byGap = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.status === "Closed") continue;
    const key = carryoverKey(f);
    if (!key) continue;
    (byGap.get(key) ?? byGap.set(key, []).get(key)!).push(f);
  }
  for (const [key, group] of byGap) {
    if (group.length > 1) {
      issues.push({ ruleId: "R9", message: `${group.length} separate open findings exist for the same gap (${key.replace("::", " ")}). A gap should carry one finding, not duplicates.`, ref: group.map((f) => f.id).join(", ") });
    }
  }

  // R10 (INV-12): a stored verdict/status outside its allowed vocabulary.
  for (const entry of Object.values(entries)) {
    for (const line of entry.specific ?? []) {
      if (!ALLOWED_LINE_STATUS.has(line.status)) {
        issues.push({ ruleId: "R10", message: `Line status "${line.status}" is not a valid value.`, ref: `${entry.gd4ItemId} ${line.clause || line.sourceRef || line.id}` });
      }
      for (const ev of line.evidence ?? []) {
        if (ev.evidenceVerdict !== undefined && !ALLOWED_EVIDENCE_VERDICT.has(ev.evidenceVerdict)) {
          issues.push({ ruleId: "R10", message: `Evidence verdict "${ev.evidenceVerdict}" is not a valid value.`, ref: `${entry.gd4ItemId} ${ev.id}` });
        }
        if (ev.apsr) {
          for (const key of Object.keys(ALLOWED_APSR_STATUS) as ApsrKey[]) {
            const st = ev.apsr[key]?.status;
            if (st !== undefined && !ALLOWED_APSR_STATUS[key].has(st)) {
              issues.push({ ruleId: "R10", message: `APSR ${key} status "${st}" is not a valid value.`, ref: `${entry.gd4ItemId} ${ev.id}` });
            }
          }
        }
      }
    }
  }

  // R8 (INV-10): the three hand-synced sentinel copies have drifted apart.
  if (!checkSentinelSync(OPTION_A_NOT_ASSESSED_NOTE, NOT_ASSESSED_FINDING, NOT_ASSESSED_AFI)) {
    issues.push({ ruleId: "R8", message: "The three 'Not assessed by Option A' sentinel strings (raw note, report finding, report AFI) have drifted out of sync, so detection and display no longer agree.", ref: "optionAChecklistWrite.ts + finalReport.ts sentinel constants" });
  }

  return issues;
}
