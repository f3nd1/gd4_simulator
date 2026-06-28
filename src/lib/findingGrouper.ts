// Pure functions that group failing checklist lines from a single GD4 item
// into logical finding groups. No AI, no stores — deterministic and testable.
// The output is consumed by useFindingDraftStore.generateFindingsFromChecklist.

import type {
  SpecificChecklistLine,
  ChecklistLineGroup,
  GD4Requirement,
  Severity,
  ApsrBreakdown,
  FindingDimension,
} from "../types";
import { lineSufficiency, findingDimension, computeRiskCategory, lineApsr } from "./checklistBanding";

// Strip a terminal single-letter sub-item suffix from a sourceRef so that
// sibling points (.a, .b, .c …) from the same parent bullet are grouped.
// "6.2.1.DS1.a" → "6.2.1.DS1"
// "6.2.1.DS2"   → "6.2.1.DS2"  (no suffix to strip)
// undefined     → ""
export function sourceRefPrefix(ref: string | undefined): string {
  if (!ref) return "";
  return ref.replace(/\.[a-z]$/, "");
}

// Whether a line warrants inclusion in a finding group.
// A line warrants if: status is Not met OR Partial, OR the line is marked
// Met/Partial but has Missing evidence (unverifiable claim).
// Lines already saved to a finding (savedFindingId present) are always skipped.
export function warrantsLine(line: SpecificChecklistLine): boolean {
  if (line.status === "Not Applicable") return false;
  if (line.draftFinding?.savedFindingId) return false;
  if (line.status === "Not met") return true;
  if (line.status === "Partial") return true;
  // Met with missing evidence = unverifiable claim
  if (line.status === "Met" && lineSufficiency(line) === "Missing") return true;
  return false;
}

// Map an APSR-level finding dimension to the five gap type labels.
function dimensionToGapType(dim: FindingDimension): ChecklistLineGroup["gapType"] {
  switch (dim) {
    case "Procedure":  return "Documentation/Approach";
    case "Evidence":   return "Implementation/Process";
    case "Outcomes":   return "Outcome/Data";
    case "Review":     return "Review/ContinualImprovement";
    case "Unverified": return "EvidenceTraceability";
  }
}

// Map a gap type back to the primary APSR dimension name for display.
function gapTypeToPrimaryDimension(
  gapType: ChecklistLineGroup["gapType"]
): ChecklistLineGroup["primaryApsrDimension"] {
  switch (gapType) {
    case "Documentation/Approach":       return "Approach";
    case "Implementation/Process":       return "Processes";
    case "Outcome/Data":                 return "Systems & Outcomes";
    case "Review/ContinualImprovement":  return "Review";
    case "EvidenceTraceability":         return "Approach";
  }
}

// Classify which gap type a line belongs to. Uses the apsrDimension field
// written by the checklist generator (most reliable), then falls back to the
// runtime findingDimension() heuristic from the attached APSR data.
export function classifyGapType(line: SpecificChecklistLine): ChecklistLineGroup["gapType"] {
  if (line.apsrDimension) {
    switch (line.apsrDimension) {
      case "Approach":           return "Documentation/Approach";
      case "Processes":          return "Implementation/Process";
      case "Systems & Outcomes": return "Outcome/Data";
      case "Review":             return "Review/ContinualImprovement";
    }
  }
  return dimensionToGapType(findingDimension(line));
}

// Severity for a group: gate-sensitive requirements always produce High findings.
export function groupSeverity(_lines: SpecificChecklistLine[], req: GD4Requirement): Severity {
  return req.gateSensitive ? "High" : "Medium";
}

// Risk category for a group: use the first line's dimension to derive a category.
export function groupRiskCategory(
  lines: SpecificChecklistLine[],
  req: GD4Requirement
): "A" | "B" | "C" | "D" {
  const dim = lines.length > 0 ? findingDimension(lines[0]) : "Evidence";
  return computeRiskCategory(req, dim);
}

// Human-readable evidence status summary for a group (used as a finding field).
export function buildEvidenceStatusSummary(lines: SpecificChecklistLine[]): string {
  const missing = lines.filter((l) => lineSufficiency(l) === "Missing").length;
  const weak    = lines.filter((l) => lineSufficiency(l) === "Weak").length;
  const present = lines.filter((l) => lineSufficiency(l) === "Present").length;
  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} ${missing === 1 ? "line" : "lines"} with missing evidence`);
  if (weak    > 0) parts.push(`${weak} ${weak === 1 ? "line" : "lines"} with weak evidence`);
  if (present > 0) parts.push(`${present} ${present === 1 ? "line" : "lines"} with present evidence`);
  return parts.join(", ") || "No evidence issues detected";
}

// Synthesise an ApsrBreakdown for a confirmed finding from the worst status
// across all lines in the group. The note for each dimension is the apsrBullets
// text (newline-delimited) when provided, else the first available APSR note.
export function synthesiseApsrFromGroup(
  group: ChecklistLineGroup,
  apsrBullets?: { approach: string[]; processes: string[]; systemsOutcomes: string[]; review: string[] }
): ApsrBreakdown | undefined {
  const apsrList = group.lines.map((l) => lineApsr(l)).filter((a): a is ApsrBreakdown => a !== undefined);
  if (apsrList.length === 0 && !apsrBullets) return undefined;

  // Worst-case status for each dimension
  const approachStatus: ApsrBreakdown["approach"]["status"] =
    apsrList.some((a) => a.approach.status === "Not evident") ? "Not evident" :
    apsrList.some((a) => a.approach.status === "Beginning")   ? "Beginning" : "Meeting";

  const processesStatus: ApsrBreakdown["processes"]["status"] =
    apsrList.some((a) => a.processes.status === "Not evident") ? "Not evident" :
    apsrList.some((a) => a.processes.status === "Weak")        ? "Weak" : "Deployed";

  const soStatus: ApsrBreakdown["systemsOutcomes"]["status"] =
    apsrList.some((a) => a.systemsOutcomes.status === "Not evident") ? "Not evident" :
    apsrList.some((a) => a.systemsOutcomes.status === "Limited")     ? "Limited" : "Evident";

  const reviewStatus: ApsrBreakdown["review"]["status"] =
    apsrList.some((a) => a.review.status === "Not evident") ? "Not evident" : "Evident";

  const bulletNote = (bullets: string[] | undefined, fallback: string): string =>
    bullets && bullets.length > 0 ? bullets.join("\n") : fallback;

  const approachFallback = apsrList.find((a) => a.approach.note)?.approach.note ?? "";
  const processesFallback = apsrList.find((a) => a.processes.note)?.processes.note ?? "";
  const soFallback = apsrList.find((a) => a.systemsOutcomes.note)?.systemsOutcomes.note ?? "";
  const reviewFallback = apsrList.find((a) => a.review.note)?.review.note ?? "";

  return {
    approach:       { status: approachStatus,  note: bulletNote(apsrBullets?.approach,       approachFallback) },
    processes:      { status: processesStatus, note: bulletNote(apsrBullets?.processes,      processesFallback) },
    systemsOutcomes:{ status: soStatus,        note: bulletNote(apsrBullets?.systemsOutcomes, soFallback) },
    review:         { status: reviewStatus,    note: bulletNote(apsrBullets?.review,         reviewFallback) },
  };
}

// Group failing checklist lines from one GD4 item into logical finding groups.
// Lines with the same gap type AND the same source-ref prefix collapse into
// one group; lines with different types or prefixes stay separate.
export function groupWeakLines(
  lines: SpecificChecklistLine[],
  gd4ItemId: string,
  req: GD4Requirement
): ChecklistLineGroup[] {
  const failing = lines.filter(warrantsLine);
  if (failing.length === 0) return [];

  const buckets = new Map<string, SpecificChecklistLine[]>();
  for (const line of failing) {
    const gapType = classifyGapType(line);
    const prefix  = sourceRefPrefix(line.sourceRef);
    const key     = `${gapType}::${prefix}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(line);
  }

  const groups: ChecklistLineGroup[] = [];
  for (const [key, groupLines] of buckets) {
    const gapType = key.split("::")[0] as ChecklistLineGroup["gapType"];
    const sourceRefs  = [...new Set(groupLines.map((l) => l.sourceRef).filter((r): r is string => Boolean(r)))];
    const sourceTexts = [...new Set(groupLines.map((l) => l.sourceText).filter((t): t is string => Boolean(t)))];
    groups.push({
      gd4ItemId,
      subCriterionId: req.subCriterionId,
      gapType,
      primaryApsrDimension: gapTypeToPrimaryDimension(gapType),
      lines: groupLines,
      sourceRefs,
      sourceTexts,
      severity:     groupSeverity(groupLines, req),
      riskCategory: groupRiskCategory(groupLines, req),
    });
  }

  return groups;
}
