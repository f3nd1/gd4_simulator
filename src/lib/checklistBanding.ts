// Banding for the Sub-Criterion Checklist module — APSR PERCENTAGE MATRIX per
// an SSG auditor's clarification (see docs/edutrust-band-scoring.md): each of
// the four dimensions (Approach / Processes / Systems & Outcomes / Review) is
// scored SEPARATELY against the verbatim §23 descriptors (data/edutrustRubric.ts)
// as 0% or a band 1-5 (band N = N×5%), the four percentages SUM to a 0-100%
// total, and the total maps to the final band. See the APSR formula section
// below (pctForScore / finalBandFromPct / apsrMatrixResult). This replaced two
// earlier models — an app-invented coverage×maturity ladder, then a "one
// holistic band" pick built on the document's literal wording — after the
// auditor confirmed dimensions are scored separately and summed. The cut-offs
// and the 0% question are reconstructed from ONE example, not confirmed
// (INFERRED_THRESHOLDS); the UI flags this.
//
// What remains in code:
//   - lineCompleteness(): how much of the requirement-line evidence has been
//     assessed — CONTEXT for the band judgment, never a band input.
//   - bandEvidenceAdvisories(): honesty warnings when the selected band
//     outruns the attached evidence — ADVISORY only, the human's judgment
//     stands (the old hard caps silently overrode it).
//   - computeChecklistOverrides(): feeds the selected holistic band into the
//     official scoring engine (band/5 × criterion points), same shape as
//     before — the §20 gate and criterion rollup are unchanged.
import type { ApsrDimensionScore, ApsrMatrixScores, Band, GD4Requirement, SpecificChecklistLine, EvidenceSufficiency, DraftFindingInfo, SubCriterionChecklistEntry, ApsrBreakdown, FindingDimension } from "../types";
import { bandTitle } from "../data/edutrustRubric";
import { findingTypeForStatus, ncSeverityFor } from "./findingClassification";

export function lineSufficiency(line: SpecificChecklistLine): EvidenceSufficiency {
  if (line.evidence.length === 0) return "Missing";
  if (line.evidence.some((e) => e.sufficiency === "Missing")) return "Missing";
  if (line.evidence.some((e) => e.sufficiency === "Weak")) return "Weak";
  return "Present";
}

// Requirement-line completeness: how many of the item's specific lines have
// been assessed, and how they came out. Shown beside the band selector as
// evidence context ("11 of 14 lines assessed · 8 Met · 6 Partial") — it does
// NOT calculate or cap the band (the old coverage % did; the official rubric
// has no such input).
export type LineCompleteness = {
  total: number;      // all lines except Not Applicable
  assessed: number;   // status set to Met/Partial/Not met
  met: number;
  partial: number;
  notMet: number;
  na: number;
};

export function lineCompleteness(specific: SpecificChecklistLine[]): LineCompleteness {
  const graded = specific.filter((l) => l.status !== "Not Applicable");
  return {
    total: graded.length,
    assessed: graded.filter((l) => l.status === "Met" || l.status === "Partial" || l.status === "Not met").length,
    met: graded.filter((l) => l.status === "Met").length,
    partial: graded.filter((l) => l.status === "Partial").length,
    notMet: graded.filter((l) => l.status === "Not met").length,
    na: specific.length - graded.length,
  };
}

// ── APSR percentage-matrix formula ──────────────────────────────────────────
// Per an SSG auditor's worked example (A=20%, P=20%, S=10%, R=0% = 50% → Band
// 3): each dimension scores a band (1–5) or 0; band N is worth N×5% (Band
// 1=5% … Band 5=25%, max 25% per dimension); the four sum to a 0–100% total;
// the total maps to the final band in five equal 20-point ranges.
//
// RECONSTRUCTED from ONE example — the exact cut-offs and whether 0% is a
// valid "below Band 1" score are NOT auditor-confirmed, so the scale is NOT
// hardcoded: it lives in useScoringConfigStore (editable on the GD4 Scoring
// Setup page) and is threaded in as `scale`. `INFERRED_THRESHOLDS` flags this
// at the UI. See docs/edutrust-band-scoring.md.
export const INFERRED_THRESHOLDS = true;

// The editable percentage scale. `maxPctPerDimension` (default 25 = 100÷4) is
// split equally across the 5 bands (band N → N × max/5). `bandThresholds` are
// the inclusive upper %-bounds of bands 1–4; anything above the last is band 5
// (default [20,40,60,80] = five equal 20-point ranges). Both default to the
// reconstructed values so every existing caller and test is unchanged.
export type ApsrScale = {
  maxPctPerDimension: number;
  bandThresholds: [number, number, number, number];
};
export const DEFAULT_APSR_SCALE: ApsrScale = { maxPctPerDimension: 25, bandThresholds: [20, 40, 60, 80] };

export function pctForScore(s: ApsrDimensionScore, scale: ApsrScale = DEFAULT_APSR_SCALE): number {
  return (s * scale.maxPctPerDimension) / 5; // 0→0, band N → N × (max/5)
}

// Total% → final band via the (editable) upper-bound thresholds. Each boundary
// falls in the lower band (total ≤ threshold), matching the default 20-point
// ranges (0→1, 20→1, 40→2, 50→3, 80→4, 81+→5).
export function finalBandFromPct(total: number, scale: ApsrScale = DEFAULT_APSR_SCALE): Band {
  const [t1, t2, t3, t4] = scale.bandThresholds;
  const b = total <= t1 ? 1 : total <= t2 ? 2 : total <= t3 ? 3 : total <= t4 ? 4 : 5;
  return b as Band;
}

export type ApsrMatrixResult = {
  pcts: { approach: number; processes: number; systemsOutcomes: number; review: number };
  total: number;
  band: Band;
  complete: boolean; // all four dimensions have a score (0 counts as scored)
};

const APSR_DIMS = ["approach", "processes", "systemsOutcomes", "review"] as const;

// Computes the running total + final band from the matrix under `scale`. Always
// returns a result (partial totals shown live); `complete` is false until all
// four are set. A dimension left undefined contributes 0 to the running total
// but keeps `complete` false, so the save gate can require a real 0-or-band on
// each. Because the band is DERIVED here (never stored authoritatively),
// editing the scale immediately re-bands every item that carries matrixScores.
export function apsrMatrixResult(m: ApsrMatrixScores | undefined, scale: ApsrScale = DEFAULT_APSR_SCALE): ApsrMatrixResult {
  const pcts = { approach: 0, processes: 0, systemsOutcomes: 0, review: 0 };
  let complete = true;
  for (const d of APSR_DIMS) {
    const s = m?.[d];
    if (s === undefined) complete = false;
    else pcts[d] = pctForScore(s, scale);
  }
  const total = pcts.approach + pcts.processes + pcts.systemsOutcomes + pcts.review;
  return { pcts, total, band: finalBandFromPct(total, scale), complete };
}

// True when the item has checklist lines but no CURRENT-model band — either no
// holisticBand at all (old ladder), or a holisticBand from the retired holistic
// model (no matrixScores). Neither is carried forward as a matrix band.
export function needsReassessment(entry: Pick<SubCriterionChecklistEntry, "specific" | "holisticBand">): boolean {
  return entry.specific.length > 0 && !entry.holisticBand?.matrixScores;
}

// ── "Why this band / how to improve" derived views ──────────────────────────
// Both functions below are PLAIN ARITHMETIC over an already-computed
// ApsrMatrixResult — no new scoring/business logic, no AI call. They exist so
// the improvement panel doesn't duplicate this math inline.

// The dimension(s) tied for the lowest current %, i.e. the weakest link(s).
// Since raising ANY dimension by one band step adds the same % (see
// fastestPathToNextBand), the weakest dimension is also normally the cheapest
// one to raise. Returns all four when the matrix is empty/undefined.
export function weakestDimensions(pcts: ApsrMatrixResult["pcts"]): (keyof ApsrMatrixScores)[] {
  const min = Math.min(pcts.approach, pcts.processes, pcts.systemsOutcomes, pcts.review);
  return APSR_DIMS.filter((d) => pcts[d] === min);
}

export type FastestPath = {
  nextBand: Band;
  shortfallPct: number; // total % still needed to cross into nextBand
  stepPct: number;      // % gained by raising ANY one dimension by one band (same for all four)
  dims: (keyof ApsrMatrixScores)[]; // the cheapest dimension(s) to raise — lowest-scoring first
};

// Which dimension(s) to raise, and by how much, to reach the next band —
// pure display logic over `result` + `scale`, both already computed. Because
// pctForScore is linear (band N → N × max/5), one band-step on ANY dimension
// always costs the same %, so "cheapest" reduces to "fewest dimensions
// touched", picked as the currently-lowest-scoring ones. Returns null once
// already at Band 5 (nothing to reach) or the matrix isn't fully scored.
export function fastestPathToNextBand(result: ApsrMatrixResult, scale: ApsrScale = DEFAULT_APSR_SCALE): FastestPath | null {
  if (!result.complete || result.band >= 5) return null;
  const nextThreshold = scale.bandThresholds[result.band - 1];
  const shortfallPct = nextThreshold - result.total + 1;
  if (shortfallPct <= 0) return null; // guard: band/threshold disagreement shouldn't happen
  const stepPct = scale.maxPctPerDimension / 5;
  const stepsNeeded = Math.max(1, Math.ceil(shortfallPct / stepPct));
  const ranked = [...APSR_DIMS].sort((a, b) => result.pcts[a] - result.pcts[b]);
  return { nextBand: (result.band + 1) as Band, shortfallPct, stepPct, dims: ranked.slice(0, Math.min(stepsNeeded, APSR_DIMS.length)) };
}

// Honesty advisories for a selected band — the ported spirit of the old
// evidence weakest-link caps, now ADVISORY: the reviewer's holistic judgment
// stands (the official rubric is judgment, and reviewer overrides are this
// app's pattern), but a band the attached evidence cannot support is flagged
// plainly instead of silently accepted. Returns [] when nothing to flag.
export function bandEvidenceAdvisories(specific: SpecificChecklistLine[], band: Band): string[] {
  const graded = specific.filter((l) => l.status !== "Not Applicable");
  if (graded.length === 0) return band > 1 ? [`${bandTitle(band)} selected but this item has no assessed checklist lines — there is nothing on file for an assessor to verify.`] : [];
  const advisories: string[] = [];
  const noEvidenceAnywhere = graded.every((l) => l.evidence.length === 0);
  const missingLines = graded.filter((l) => lineSufficiency(l) === "Missing");
  const allWeak = graded.every((l) => lineSufficiency(l) === "Weak");
  const naRatio = specific.length > 0 ? (specific.length - graded.length) / specific.length : 0;
  if (noEvidenceAnywhere && band > 1) {
    advisories.push(`${bandTitle(band)} selected but no evidence is attached to any checklist line — an SSG assessor would treat this as unverifiable.`);
  } else if (missingLines.length > 0 && band > 2) {
    advisories.push(`${bandTitle(band)} selected but ${missingLines.length} line(s) have evidence marked Missing — strengthen that evidence or the band is hard to defend.`);
  } else if (allWeak && band > 3) {
    advisories.push(`${bandTitle(band)} selected but every line's evidence is marked Weak — a top band needs stronger records.`);
  }
  if (naRatio > 0.5 && band > 3) {
    advisories.push(`${bandTitle(band)} selected with more than half the lines marked Not Applicable — re-check that those lines truly do not apply.`);
  }
  return advisories;
}

// Representative effective score for a band, chosen so it falls back into
// the same band through scoring.ts's getBand() thresholds (>=85/70/55/40).
export function bandToScore(b: Band): number {
  return { 1: 20, 2: 45, 3: 60, 4: 75, 5: 90 }[b];
}

export type ChecklistOverride = { eff: number; band: Band };

// Per the "feed into overall score" decision: any GD4 item with a HOLISTIC
// band selected gets its scoring.ts band/effective score replaced by it.
// An item with old-model data but no holistic band deliberately produces NO
// override — it scores as not-started ("needs re-assessment") rather than
// carrying a fabricated band forward. Same {eff, band} shape as always, so
// the §20 gate and criterion rollup in scoring.ts are untouched.
export function computeChecklistOverrides(
  entries: Record<string, SubCriterionChecklistEntry>,
  requirements: GD4Requirement[],
  scale: ApsrScale = DEFAULT_APSR_SCALE
): Record<string, ChecklistOverride> {
  const map: Record<string, ChecklistOverride> = {};
  Object.values(entries).forEach((entry) => {
    const hb = entry.holisticBand;
    // Only a CURRENT-model band (with matrixScores) feeds scoring; a band-only
    // old-holistic record is "needs re-assessment", no override. The band is
    // re-derived from matrixScores under the live scale, so editing the scale
    // on the Setup page re-scores every item at once — not just new ones.
    if (!hb?.matrixScores) return;
    if (!requirements.find((r) => r.id === entry.gd4ItemId)) return;
    const band = apsrMatrixResult(hb.matrixScores, scale).band;
    map[entry.gd4ItemId] = { eff: bandToScore(band), band };
  });
  return map;
}

// Pulls the most informative APSR breakdown attached to a line's evidence
// (the folder audit records one per audited line). Returns undefined if the
// line was never audited live (offline/manual lines have no APSR).
export function lineApsr(line: SpecificChecklistLine): ApsrBreakdown | undefined {
  for (const ev of line.evidence) if (ev.apsr) return ev.apsr;
  return undefined;
}

// The real, AI-written diagnosis for ONE dimension of a line — the exact
// text an audit run recorded (same source the checklist card's expanded
// PPD/Evidence tabs read from), never a synthesised template. Undefined only
// when the line has no APSR at all (manual/seed/never-audited) — callers
// must show an honest "no diagnosis recorded" state, not fall back to
// invented text.
export function lineDimensionDiagnosis(line: SpecificChecklistLine, dimKey: keyof ApsrBreakdown): string | undefined {
  return lineApsr(line)?.[dimKey]?.note?.trim() || undefined;
}

// The Evidence judge's own concrete "what would make this Met" text (Option
// A only — Option B's staged audit has no equivalent field). Read from the
// SAME evidence item as lineDimensionDiagnosis (first with an apsr snapshot)
// so the two stay grounded in the same run; undefined when absent, never a
// fabricated action.
export function lineSuggestedAction(line: SpecificChecklistLine): string | undefined {
  for (const ev of line.evidence) if (ev.apsr) return ev.suggestedAction?.trim() || undefined;
  return undefined;
}

// In-depth, plain-language analysis of WHY a line failed and how to fix it,
// derived from the APSR dimension that fell short (or, with no APSR, from the
// status / evidence). This is what makes a raised finding read deeper than
// SSG's flat "It was not evident that…": a root cause, a corrective action
// (fix it now) and a preventive action (stop it recurring). APSR = the official
// EduTrust rubric dimensions: Approach, Processes, Systems & Outcomes, Review.
export function buildFindingAnalysis(req: GD4Requirement, line: SpecificChecklistLine): { rootCause: string; corrective: string; preventive: string } {
  const p = lineApsr(line);
  const expected = req.expectedEvidence.length ? req.expectedEvidence.join("; ") : "the records that demonstrate this requirement";

  if (p) {
    if (p.approach.status === "Not evident") {
      return {
        rootCause: `Approach: the Policies & Procedures Document (PPD) does not document an approach (policy/procedure) for this requirement${p.approach.note ? ` — ${p.approach.note}` : ""}. The activity may happen in practice, but with nothing documented it cannot be assessed or sustained.`,
        corrective: `Document a specific procedure in the PPD covering "${req.requirement}": who is responsible, what they do, when/how often, and what record is kept.`,
        preventive: `Add this requirement to the PPD review checklist and assign a document owner so it is not missed in the next PPD revision.`,
      };
    }
    if (p.approach.status === "Beginning") {
      return {
        rootCause: `Approach: a documented approach exists but is too generic/boilerplate and not sustainable${p.approach.note ? ` — ${p.approach.note}` : ""}. It does not state specifically who does what, when and how, so it cannot be relied on or consistently followed.`,
        corrective: `Rewrite the PPD procedure to be specific to this institution: name the responsible role, the frequency, the steps, and the record produced. Replace vague phrasing like "reviewed periodically" with a defined cycle.`,
        preventive: `Adopt a PPD template that forces every procedure to state owner, frequency and the record kept, and check new procedures against it before approval.`,
      };
    }
    // Approach is at Meeting from here — the gap is in Processes / Systems &
    // Outcomes / Review.
    if (p.processes.status === "Not evident") {
      return {
        rootCause: `Processes: the approach is documented but there is no evidence it has actually been implemented — a policy on paper only. The implementation records are missing.`,
        corrective: `Implement the procedure and keep the records that prove it, e.g. ${expected}. Attach them as evidence against this line.`,
        preventive: `Schedule the activity (calendar/owner) and store its records in a fixed location so each cycle is captured automatically.`,
      };
    }
    const missing: string[] = [];
    if (p.processes.status === "Weak") missing.push("implementation (Processes) is weak / not consistently evidenced");
    if (p.systemsOutcomes.status !== "Evident") missing.push("the desired outcomes (Systems & Outcomes) are not yet evident");
    if (p.review.status !== "Evident") missing.push("there is no Review evaluating effectiveness for continual improvement");
    return {
      rootCause: `The approach is documented and at least partly implemented, but ${missing.join("; ") || "it is not yet fully and consistently evidenced"}. This is what keeps it short of a higher band.`,
      corrective: `${p.systemsOutcomes.status !== "Evident" ? "Capture the outcome data that shows the desired results are produced. " : ""}${p.review.status !== "Evident" ? "Add a periodic review that evaluates effectiveness and feeds improvements back into the approach. " : ""}Then attach the resulting records (${expected}) as evidence.`,
      preventive: `Make the outcome measurement and the review recurring with a named owner, so the cycle is sustained without prompting.`,
    };
  }

  // No APSR (offline keyword audit or a manually-set line): fall back to status.
  const sufficiency = lineSufficiency(line);
  if (line.status !== "Not met" && sufficiency === "Missing") {
    return {
      rootCause: `This line is marked ${line.status} but no supporting evidence is attached, so it cannot be verified — an unverifiable claim counts as a gap.`,
      corrective: `Attach the evidence that demonstrates it (${expected}) and confirm it is approved/reviewed.`,
      preventive: `Require evidence to be linked before a line is marked Met, so unverified passes can't accumulate.`,
    };
  }
  return {
    rootCause: `The evidence reviewed did not demonstrate this requirement (${expected} not found or insufficient).`,
    corrective: `Provide and approve the evidence that demonstrates "${req.requirement}", then re-run the audit on this line.`,
    preventive: `Keep this requirement's records current and in a fixed location so it is demonstrable at the next review.`,
  };
}

// Classifies which side of the rubric a line's gap is on, using the first
// APSR dimension that falls short (Approach gates first, so it wins when both
// Approach and Processes are weak). This is what lets the Findings register
// separate "your procedure document is missing/weak" (Procedure) from "the
// procedure exists but there's no evidence it's implemented" (Evidence).
export function findingDimension(line: SpecificChecklistLine): FindingDimension {
  const p = lineApsr(line);
  if (p) {
    if (p.approach.status !== "Meeting") return "Procedure";
    if (p.processes.status !== "Deployed") return "Evidence";
    if (p.systemsOutcomes.status !== "Evident") return "Outcomes";
    if (p.review.status !== "Evident") return "Review";
    return "Evidence";
  }
  // No APSR (offline keyword audit / manual line): a line marked done but with
  // no evidence is an unverified claim; otherwise treat it as an evidence gap.
  if (line.status !== "Not met" && lineSufficiency(line) === "Missing") return "Unverified";
  return "Evidence";
}

// Classifies a finding's risk category based on the GD4 requirement and the
// APSR dimension that fell short. A = regulatory breach (SSG mandatory
// student-protection items), B = Star-disqualifying (Criterion 7 or
// gate-sensitive), C = band-limiting gap.
export function computeRiskCategory(req: GD4Requirement, _dim: FindingDimension): "A" | "B" | "C" | "D" {
  // A: SSG mandatory student protection items — breach may trigger enforcement
  if (["4.1", "4.2", "4.4"].includes(req.subCriterionId)) return "A";
  // B: Criterion 7 (330/1000 points) or gate-sensitive items — blocks Star
  if (req.criterion === "7" || req.gateSensitive) return "B";
  // C: everything else (band-limiting gap)
  return "C";
}

export function buildDraftFinding(req: GD4Requirement, line: SpecificChecklistLine): DraftFindingInfo {
  const apsr = lineApsr(line);
  const findingType = findingTypeForStatus(line.status as "Met" | "Partial" | "Not met");
  const ncSeverity = ncSeverityFor(findingType, { gateSensitive: req.gateSensitive, approachStatus: apsr?.approach.status });

  // A "Met" line with real evidence has nothing wrong to root-cause/fix —
  // raising a finding here is a positive OBS record (what was found, which
  // evidence supported it), not a gap. Build it directly instead of routing
  // through the gap-oriented text below, which would read as contradictory
  // on a genuinely-met line. A "Met" line with NO evidence is still an
  // unverified claim (existing "Unverified" dimension handling below) —
  // that's a real gap, not an observation, so it deliberately falls through
  // rather than taking this branch.
  if (line.status === "Met" && lineSufficiency(line) !== "Missing") {
    const evidenceNames = line.evidence.length > 0
      ? line.evidence.slice(0, 3).map((e) => e.title ?? "").filter(Boolean).join("; ")
      : "";
    const apsrNoteLines = apsr
      ? ([
          apsr.approach.note ? `Approach: ${apsr.approach.note}` : "",
          apsr.processes.note ? `Processes: ${apsr.processes.note}` : "",
          apsr.systemsOutcomes.note ? `Systems & Outcomes: ${apsr.systemsOutcomes.note}` : "",
          apsr.review.note ? `Review: ${apsr.review.note}` : "",
        ] as string[]).filter(Boolean)
      : [];
    return {
      gd4ItemId: req.id,
      clause: line.clause,
      issue: `GD4 ${req.id} — ${line.text?.slice(0, 120) ?? req.requirement} [Met; evidence confirmed]`,
      severity: "Low",
      suggestedAction: "No action required — retain the cited evidence for the next audit cycle.",
      observation: apsrNoteLines.length
        ? `${line.text} — status: Met. ${apsrNoteLines.join(". ")}.`
        : `${line.text} — marked Met${evidenceNames ? `, supported by: ${evidenceNames}` : ""}.`,
      criteria: `GD4 ${req.id} requires: ${req.requirement}${req.expectedEvidence.length ? ` Expected evidence includes: ${req.expectedEvidence.join("; ")}.` : ""}`,
      effect: "Positive observation — this requirement is being met and does not limit the sub-criterion's band.",
      dimension: findingDimension(line),
      riskCategory: "D",
      findingType,
      ncSeverity,
    };
  }

  const sufficiency = lineSufficiency(line);
  const analysis = buildFindingAnalysis(req, line);
  const dim = findingDimension(line);

  // Build a baseline observation from the APSR notes if available, otherwise
  // from the line status. This is intentionally a template — the auditor should
  // replace placeholders like [N of M] with actual counts from their review.
  const apsrNoteLines = apsr
    ? (
        [
          apsr.approach.status !== "Meeting" && apsr.approach.note ? `Approach: ${apsr.approach.note}` : "",
          apsr.processes.status !== "Deployed" && apsr.processes.note ? `Processes: ${apsr.processes.note}` : "",
          apsr.systemsOutcomes.status !== "Evident" && apsr.systemsOutcomes.note ? `Systems & Outcomes: ${apsr.systemsOutcomes.note}` : "",
          apsr.review.status !== "Evident" && apsr.review.note ? `Review: ${apsr.review.note}` : "",
        ] as string[]
      ).filter(Boolean)
    : [];

  // SSG assessor register (Technique 5): open the observation with the official
  // negative phrasing and name the specific dimension that failed, then carry
  // the per-dimension AI notes (which hold the named examples, dates and the
  // specific missing obligation) as an "Example:" block — the same standard as
  // the Option A finding writer, so auto-raised Option B findings are as
  // specific as Option A instead of reading "<line> — status: X".
  const dimVerb =
    dim === "Procedure" ? "documented in its Policy & Procedure Document" :
    dim === "Evidence" ? "implemented" :
    dim === "Outcomes" ? "established outcome monitoring for" :
    dim === "Review" ? "established a documented review of" :
    "provided verifiable evidence for";
  const reqLabel = `the requirement under GD4 ${req.id}${line.clause ? ` (${line.clause})` : ""}: "${line.text?.slice(0, 160) ?? req.requirement}"`;
  const exampleBlock = apsrNoteLines.length
    ? ` Example: ${apsrNoteLines.join(". ")}.`
    : sufficiency === "Missing"
      ? " Example: no implementation records were found in the evidence folder for this line."
      : sufficiency === "Weak"
        ? " Example: the records found were incomplete or did not cover the full audit period."
        : "";
  const observation = `It was not evident that the PEI had ${dimVerb} ${reqLabel} (rated ${line.status}).${exampleBlock}`;

  // Effects anchored to the OFFICIAL §23 band descriptors (edutrustRubric.ts)
  // — stated as how an assessor reads the gap against the rubric text, not as
  // automatic caps (the old engine's hard caps are gone; the band is holistic
  // judgment now).
  const effectByDim: Record<string, string> = {
    Procedure: `Without a documented, institution-specific procedure, this requirement cannot be consistently met. Against the official §23 rubric an assessor reads this as Band 1–2 ("No organised approach to item requirements is evident" / "The beginning of an organised approach is evident").`,
    Evidence: `Without implementation records, this requirement is unverifiable at audit. Against the official §23 rubric this reads as Band 1–2 on Processes ("Processes are not in place or in their infancy stage" / "established but with weak deployment in key areas"), even if the policy document is strong.`,
    Outcomes: `Outcome data is required to demonstrate the process is producing the desired results. The official Band 4 descriptor expects systems "producing desired outcomes with no conflicts" — without outcome data the item reads at Band 3 or below.`,
    Review: `The official Band 3 descriptor requires evidence that "the systems and processes are regularly reviewed and action plans for improvement are implemented" — without a documented review the item reads at Band 2 or below.`,
    Unverified: `This line is marked as met but has no evidence attached. An SSG assessor will treat it as unverified — it cannot support the item's band until evidence is linked.`,
  };

  const evidenceNames = line.evidence.length > 0
    ? line.evidence.slice(0, 3).map((e) => e.title ?? "").filter(Boolean).join("; ")
    : "";
  const issueDetail = sufficiency === "Missing"
    ? (line.evidence.length === 0 ? "no evidence attached" : `evidence insufficient — ${evidenceNames || "records present but not meeting standard"}`)
    : sufficiency === "Weak"
    ? `evidence weak${evidenceNames ? ` — ${evidenceNames}` : ""}`
    : "line partially met";

  const suggestedActionText = sufficiency === "Missing" && line.evidence.length === 0
    ? `Create, approve and file the required ${dim.toLowerCase()} documentation for GD4 ${req.id}: "${line.text?.slice(0, 120) ?? req.requirement}". Attach it as evidence against this checklist line.`
    : sufficiency === "Missing"
    ? `Replace the insufficient evidence for GD4 ${req.id} — "${line.text?.slice(0, 120) ?? req.requirement}" — with complete, dated records that satisfy the ${dim.toLowerCase()} dimension. Current records: ${evidenceNames || "(see evidence items)"}.`
    : `Supplement the partial evidence for GD4 ${req.id}: "${line.text?.slice(0, 120) ?? req.requirement}". Ensure records are approved, complete and cover the full audit period.`;

  return {
    gd4ItemId: req.id,
    clause: line.clause,
    issue: `GD4 ${req.id} — ${line.text?.slice(0, 120) ?? req.requirement} [${line.status}; ${issueDetail}]`,
    severity: req.gateSensitive ? "High" : "Medium",
    suggestedAction: suggestedActionText,
    observation,
    criteria: `GD4 ${req.id} requires: ${req.requirement}${req.expectedEvidence.length ? ` Expected evidence includes: ${req.expectedEvidence.join("; ")}.` : ""}`,
    effect: effectByDim[dim] ?? effectByDim.Evidence,
    rootCause: analysis.rootCause,
    corrective: analysis.corrective,
    preventive: analysis.preventive,
    dimension: dim,
    riskCategory: computeRiskCategory(req, dim),
    findingType,
    ncSeverity,
  };
}
