// Recurring-finding → checklist-item promotion pipeline. SEMI-automatic by
// design: this module only DETECTS candidates and builds the fields for a new
// checklist item — nothing here writes to the checklist store. A human must
// click "Promote" (in PreCheckChecklistSetup.tsx) to actually call
// usePreCheckChecklistStore's addItem, which always lands the new item as
// verified: false (draft), going through the exact same Approve step as any
// other draft item — see preAnalysisChecklist.ts's file header.
//
// GROUPING — "the same underlying gap": reuses carryoverKey() from
// cycleCarryover.ts, the app's OWN existing, tested definition of a recurring
// gap (gd4ItemId + normalized source ref, ignoring finding type) — already
// used to compute Finding.repeatFinding and the Minor→Major escalation. This
// keeps "recurring" here consistent with what the rest of the app already
// means by the word, rather than inventing a second definition.
//
// Findings with no ref at all (carryoverKey returns null — mostly older/
// manual entries) fall back to grouping by the SAME GD4 item + an EXACT
// normalized match of the finding text. Deliberately conservative: no
// word-overlap/fuzzy similarity, so this can miss a repeat that was reworded
// across audits, but it can never wrongly hide a genuinely new finding as
// "already covered" — a false negative here is far cheaper than a false
// positive that suppresses a real pattern from ever being surfaced.
//
// "DIFFERENT audit runs/cycles": a group only counts as recurring when its
// findings carry at least 2 DISTINCT audit identities — auditRunId, else
// createdFromAuditRunId, else auditCycleId (always present on a Finding),
// else the finding's own id as a last resort. A single finding, however long
// it's been open, is never flagged — this requires genuine repetition, not
// just staleness.
//
// "ALREADY COVERED": a promoted item's `source` field carries a hidden,
// exact-match tag ([promoted:<matchKey>]) so a later scan recognises "this
// exact pattern was already promoted" deterministically — no fuzzy
// re-matching. This does NOT check against hand-written items (e.g. 6.2.1's
// "Follow-up actions carry owners and timelines") since matching a candidate's
// finding text against arbitrary hand-written prose is the same fuzzy problem
// deliberately avoided above; a human reviewing the candidate can recognise
// that overlap themselves and simply not click Promote.

import type { Finding } from "../types";
import type { ChecklistData, ChecklistItemDef } from "./preAnalysisChecklist";
import { carryoverKey } from "./cycleCarryover";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";

const PROMOTED_TAG_PREFIX = "[promoted:";

function promotedTag(matchKey: string): string {
  return `${PROMOTED_TAG_PREFIX}${matchKey}]`;
}

function normalizedText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// A finding's grouping identity: the ref-based carryoverKey when available,
// else an exact-text fallback keyed to the same GD4 item. Null when neither
// a ref nor any text exists (nothing to group on).
function groupKey(f: Finding): string | null {
  const refKey = carryoverKey(f);
  if (refKey) return refKey;
  const text = normalizedText(f.issue || "");
  return text ? `${f.gd4ItemId}::text::${text}` : null;
}

// Which "audit" a finding came from, for distinctness — never invented: uses
// whatever real identifier the finding actually carries, in order of
// specificity. auditCycleId is a required field on Finding, so this only
// falls through to the finding's own id in a pathological empty-string case.
function occurrenceIdentity(f: Finding): string {
  return f.auditRunId || f.createdFromAuditRunId || f.auditCycleId || f.id;
}

export type FindingOccurrence = {
  findingId: string;
  createdAt?: string;
  auditCycleId: string;
  runLabel?: string;
};

export type RecurringPattern = {
  matchKey: string;
  gd4ItemId: string;
  subCriterionId: string;
  findingText: string;
  occurrences: FindingOccurrence[];
  alreadyCovered: boolean;
};

// Pure: takes the live findings + checklist data as parameters (same shape as
// computeFlaggedPreCheckItems) so it's exercisable with plain fixtures in
// tests, with no store dependency.
export function detectRecurringPatterns(findings: Finding[], checklists: ChecklistData): RecurringPattern[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = groupKey(f);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(f);
    else groups.set(key, [f]);
  }

  const out: RecurringPattern[] = [];
  for (const [matchKey, group] of groups) {
    const distinctAudits = new Set(group.map(occurrenceIdentity));
    if (distinctAudits.size < 2) continue; // a single occurrence is never "recurring"

    const gd4ItemId = group[0].gd4ItemId;
    const req = GD4_REQUIREMENTS.find((r) => r.id === gd4ItemId);
    if (!req) continue; // unknown/stale item id — nowhere to attach a checklist item

    // Most recent occurrence's wording represents the pattern.
    const sorted = [...group].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const occurrences: FindingOccurrence[] = sorted.map((f) => ({
      findingId: f.id,
      createdAt: f.createdAt,
      auditCycleId: f.auditCycleId,
      runLabel: f.auditRunId ?? f.createdFromAuditRunId,
    }));

    const existingDefs = checklists[gd4ItemId] ?? [];
    const alreadyCovered = existingDefs.some((d) => d.source.includes(promotedTag(matchKey)));

    out.push({
      matchKey,
      gd4ItemId,
      subCriterionId: req.subCriterionId,
      findingText: sorted[0].issue,
      occurrences,
      alreadyCovered,
    });
  }

  return out.sort(
    (a, b) =>
      a.subCriterionId.localeCompare(b.subCriterionId) ||
      a.gd4ItemId.localeCompare(b.gd4ItemId) ||
      a.matchKey.localeCompare(b.matchKey)
  );
}

// Builds the fields for a new checklist item from a recurring pattern — the
// exact shape usePreCheckChecklistStore.addItem takes (minus id/verified,
// which addItem always derives/sets itself: a fresh id and verified: false).
// Defaults to "Manual check" per the task's constraint — the app can't know
// how to auto-detect an arbitrary finding pattern; a human can wire up
// auto-detection later via the Setup page's normal editing if one applies.
export function buildPromotedChecklistItemFields(pattern: RecurringPattern): Omit<ChecklistItemDef, "id" | "verified"> {
  const n = pattern.occurrences.length;
  const ids = pattern.occurrences.map((o) => o.findingId).join(", ");
  const dates = pattern.occurrences.map((o) => (o.createdAt ? o.createdAt.slice(0, 10) : "date unknown")).join(", ");
  const title = pattern.findingText.length > 90 ? `${pattern.findingText.slice(0, 87)}…` : pattern.findingText;
  return {
    title,
    description: `Recurring gap, raised ${n} separate times across different audits: ${pattern.findingText}`,
    source: `Promoted from recurring finding (${n} occurrences) — findings ${ids} (${dates}) ${promotedTag(pattern.matchKey)}`,
    sourceKind: "finding-pattern",
    mode: "manual",
    detectionKey: "none",
  };
}
