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
import type { Band, GD4Requirement, GenericChecklistLine, SpecificChecklistLine, EvidenceSufficiency, DraftFindingInfo, SubCriterionChecklistEntry, PdcaBreakdown } from "../types";

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

// Pulls the most informative PDCA breakdown attached to a line's evidence
// (the folder audit records one per audited line). Returns undefined if the
// line was never audited live (offline/manual lines have no PDCA).
export function linePdca(line: SpecificChecklistLine): PdcaBreakdown | undefined {
  for (const ev of line.evidence) if (ev.pdca) return ev.pdca;
  return undefined;
}

// In-depth, plain-language analysis of WHY a line failed and how to fix it,
// derived from the PDCA stage that broke (or, with no PDCA, from the status /
// evidence). This is what makes a raised finding read deeper than SSG's flat
// "It was not evident that…": a root cause, a corrective action (fix it now)
// and a preventive action (stop it recurring).
export function buildFindingAnalysis(req: GD4Requirement, line: SpecificChecklistLine): { rootCause: string; corrective: string; preventive: string } {
  const p = linePdca(line);
  const expected = req.expectedEvidence.length ? req.expectedEvidence.join("; ") : "the records that demonstrate this requirement";

  if (p) {
    if (p.plan.status === "Missing") {
      return {
        rootCause: `Plan stage: the Policies & Procedures Document (PPD) does not document a procedure for this requirement${p.plan.note ? ` — ${p.plan.note}` : ""}. The activity may happen in practice, but with nothing written down it cannot be assessed or sustained.`,
        corrective: `Write a specific procedure into the PPD covering "${req.requirement}": who is responsible, what they do, when/how often, and what record is kept.`,
        preventive: `Add this requirement to the PPD review checklist and assign a document owner so it is not missed in the next PPD revision.`,
      };
    }
    if (p.plan.status === "Generic") {
      return {
        rootCause: `Plan stage: a procedure exists but is too generic/boilerplate and not sustainable${p.plan.note ? ` — ${p.plan.note}` : ""}. It does not say specifically who does what, when and how, so it cannot be relied on or consistently followed.`,
        corrective: `Rewrite the PPD procedure to be specific to this institution: name the responsible role, the frequency, the steps, and the record produced. Replace vague phrasing like "reviewed periodically" with a defined cycle.`,
        preventive: `Adopt a PPD template that forces every procedure to state owner, frequency and the record kept, and check new procedures against it before approval.`,
      };
    }
    // Plan is adequate from here — the gap is in implementation / control / review.
    if (p.do.status === "None") {
      return {
        rootCause: `Do stage: the procedure is documented but there is no evidence it has actually been carried out — a policy on paper only. The implementation records are missing.`,
        corrective: `Carry out the procedure and keep the records that prove it, e.g. ${expected}. Attach them as evidence against this line.`,
        preventive: `Schedule the activity (calendar/owner) and store its records in a fixed location so each cycle is captured automatically.`,
      };
    }
    const missing: string[] = [];
    if (p.do.status === "Partial") missing.push("implementation is only partial / not consistently evidenced");
    if (p.check.status === "No") missing.push("there is no control that monitors the procedure is actually followed");
    if (p.act.status === "No") missing.push("there is no review/evaluation loop that improves it over time");
    return {
      rootCause: `The procedure is documented and at least partly implemented, but ${missing.join("; ") || "it is not yet fully and consistently evidenced"}. This is what keeps it short of a higher band.`,
      corrective: `${p.check.status === "No" ? "Put a monitoring control in place (checklist, sign-off or audit) and keep its records. " : ""}${p.act.status === "No" ? "Add a periodic review that evaluates effectiveness and feeds improvements back into the procedure. " : ""}Then attach the resulting records (${expected}) as evidence.`,
      preventive: `Make the control and the review recurring with a named owner, so the cycle is sustained without prompting.`,
    };
  }

  // No PDCA (offline keyword audit or a manually-set line): fall back to status.
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

export function buildDraftFinding(req: GD4Requirement, line: SpecificChecklistLine): DraftFindingInfo {
  const sufficiency = lineSufficiency(line);
  const analysis = buildFindingAnalysis(req, line);
  return {
    gd4ItemId: req.id,
    clause: line.clause,
    issue: `${line.text} — marked ${line.status}${sufficiency === "Missing" ? ", evidence missing" : sufficiency === "Weak" ? ", evidence weak" : ""}.`,
    severity: req.gateSensitive ? "High" : "Medium",
    suggestedAction: `Provide and approve evidence for: ${line.text}`,
    rootCause: analysis.rootCause,
    corrective: analysis.corrective,
    preventive: analysis.preventive,
  };
}
