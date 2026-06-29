// Banding formula for the Sub-Criterion Checklist module.
//
// Step 1: coverage % from Layer 2 (specific) lines only — Met counts in
//   full, Partial counts at half weight, Not Applicable lines are excluded
//   from the denominator entirely.
// Step 2: a maturity ceiling from Layer 1 (generic, G1-G4) — the highest
//   rubric lens marked "Met" sets the ceiling band.
// Step 3: a coverage cap from the Step 1 percentage.
// Step 4: finalBand = min(maturity ceiling, coverage cap).
// Step 5: evidence weakest-link rule, applied to every GD4 item (not just
//   gate-sensitive ones) — a "Met"/"Partial" status with no real evidence
//   attached is not evidence, so it cannot carry a high band on its own:
//     - if every non-NA line has zero evidence items attached anywhere,
//       the band is floored at Band 1 (status text alone, no evidence at all).
//     - otherwise, if any non-NA line's evidence sufficiency is "Missing",
//       the band is capped at Band 2 (gate-sensitive items keep the same
//       cap, just with sharper wording since recurrence risk there is higher).
//   This cannot be overridden except by fixing the evidence, because the
//   band is always recomputed from current state.
import type { Band, GD4Requirement, GenericChecklistLine, SpecificChecklistLine, EvidenceSufficiency, DraftFindingInfo, SubCriterionChecklistEntry, ApsrBreakdown, FindingDimension } from "../types";

export function lineSufficiency(line: SpecificChecklistLine): EvidenceSufficiency {
  if (line.evidence.length === 0) return "Missing";
  if (line.evidence.some((e) => e.sufficiency === "Missing")) return "Missing";
  if (line.evidence.some((e) => e.sufficiency === "Weak")) return "Weak";
  return "Present";
}

export function maturityCeiling(generic: GenericChecklistLine[]): Band {
  const met = (id: string) => generic.find((g) => g.id === id)?.status === "Met";
  if (met("G4")) return 5;
  if (met("G3")) return 4;
  if (met("G2")) return 3;
  if (met("G1")) return 2;
  return 1;
}

export function coveragePercent(specific: SpecificChecklistLine[]): number {
  const lines = specific.filter((l) => l.status !== "Not Applicable");
  if (lines.length === 0) return 0;
  const metCount = lines.filter((l) => l.status === "Met").length;
  const weakCount = lines.filter((l) => l.status === "Partial").length;
  return ((metCount + weakCount * 0.5) / lines.length) * 100;
}

export function coverageCap(pct: number): Band {
  if (pct >= 85) return 5;
  if (pct >= 70) return 4;
  if (pct >= 50) return 3;
  return 2;
}

export type BandResult = {
  coveragePct: number;
  maturityCeiling: Band;
  coverageCap: Band;
  finalBand: Band;
  // False when this item has no Layer 2 (specific) lines at all — coverageCap
  // has no floor below Band 2, so an untouched item would otherwise still
  // compute a real-looking Band 1/2 result on a brand-new workspace.
  started: boolean;
  evidenceCapped: boolean;
  evidenceCapWarning?: string;
};

export function computeBand(generic: GenericChecklistLine[], specific: SpecificChecklistLine[], gateSensitive: boolean): BandResult {
  const coveragePct = coveragePercent(specific);
  const ceiling = maturityCeiling(generic);
  const cap = coverageCap(coveragePct);
  const started = specific.length > 0;
  let finalBand = Math.min(ceiling, cap) as Band;

  const gradedLines = specific.filter((l) => l.status !== "Not Applicable");
  const hasMissingEvidenceLine = gradedLines.some((l) => lineSufficiency(l) === "Missing");
  const hasNoEvidenceAnywhere = gradedLines.length > 0 && gradedLines.every((l) => l.evidence.length === 0);

  let evidenceCapped = false;
  let evidenceCapWarning: string | undefined;

  if (hasNoEvidenceAnywhere && finalBand > 1) {
    finalBand = 1;
    evidenceCapped = true;
    evidenceCapWarning = "No evidence is attached to any checklist line, so a Met/Partial status alone cannot score above Band 1 — attach evidence to substantiate it.";
  } else if (hasMissingEvidenceLine && finalBand > 2) {
    finalBand = 2;
    evidenceCapped = true;
    evidenceCapWarning = gateSensitive
      ? "Gate-sensitive item: at least one checklist line has evidence marked Missing, so the band is capped at Band 2 until that evidence is fixed."
      : "At least one checklist line has evidence marked Missing, so the band is capped at Band 2 until that evidence is fixed.";
  }

  return { coveragePct, maturityCeiling: ceiling, coverageCap: cap, finalBand, started, evidenceCapped, evidenceCapWarning };
}

// Representative effective score for a band, chosen so it falls back into
// the same band through scoring.ts's getBand() thresholds (>=85/70/55/40).
export function bandToScore(b: Band): number {
  return { 1: 20, 2: 45, 3: 60, 4: 75, 5: 90 }[b];
}

export type ChecklistOverride = { eff: number; band: Band };

// Per the "feed into overall score" decision: any GD4 item that has at
// least one Layer 2 line (i.e. the module has actually been used on it)
// gets its scoring.ts band/effective score replaced by this module's band.
export function computeChecklistOverrides(
  entries: Record<string, SubCriterionChecklistEntry>,
  requirements: GD4Requirement[]
): Record<string, ChecklistOverride> {
  const map: Record<string, ChecklistOverride> = {};
  Object.values(entries).forEach((entry) => {
    if (!entry.specific.length) return;
    const req = requirements.find((r) => r.id === entry.gd4ItemId);
    if (!req) return;
    const result = computeBand(entry.generic, entry.specific, req.gateSensitive);
    map[entry.gd4ItemId] = { eff: bandToScore(result.finalBand), band: result.finalBand };
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
  const sufficiency = lineSufficiency(line);
  const analysis = buildFindingAnalysis(req, line);
  const dim = findingDimension(line);
  const apsr = lineApsr(line);

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

  const observation = apsrNoteLines.length
    ? `${line.text} — status: ${line.status}. Auditor AI notes: ${apsrNoteLines.join(". ")}.`
    : `${line.text} — marked ${line.status}${sufficiency === "Missing" ? "; no implementation records were found in the evidence folder" : sufficiency === "Weak" ? "; the records found were incomplete or did not cover the full scope" : ""}.`;

  const effectByDim: Record<string, string> = {
    Procedure: `Without a documented, institution-specific procedure, this requirement cannot be consistently met. Under the EduTrust APSR rubric, an Approach rated "Beginning" or "Not evident" caps this sub-criterion at Band 2 regardless of any other evidence.`,
    Evidence: `Without implementation records, this requirement is unverifiable at audit. A Processes dimension rated "Not evident" caps this sub-criterion at Band 2 even if the policy document is strong.`,
    Outcomes: `Outcome data is required to demonstrate the process is producing the desired results. Without it, this sub-criterion cannot exceed Band 3 under the APSR rubric.`,
    Review: `A formal review with documented improvement action is required for Band 4 or above. Without it, this sub-criterion is capped at Band 3 regardless of how complete the implementation records are.`,
    Unverified: `This line is marked as met but has no evidence attached. An SSG assessor will treat it as unverified — it cannot contribute to the band until evidence is linked.`,
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
  };
}
