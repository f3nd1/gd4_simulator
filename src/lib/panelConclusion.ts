// Maps an Auditor Review Panel synthesis onto the finding's closure fields and
// header classification. Kept pure and store-free so the mapping (which field
// goes where) and the classification parse are unit-testable in isolation.

import type { FindingTypeCode, NcSeverity, PanelSynthesis } from "../types";

// The closure fields the panel synthesis populates. Note the deliberate
// mapping fixes:
//   - evidenceForClosure → evid (the CLOSURE EVIDENCE field), NOT prev.
//   - immediateCorrection + correctiveAction → corr.
//   - rootCause → root.
// The preventive field has no counterpart in the synthesis, so it is left
// untouched (never overwritten with evidenceForClosure).
export type PanelClosureTargets = { root: string; corr: string; evid: string };

export function panelClosureTargets(syn: PanelSynthesis): PanelClosureTargets {
  const t = (v: string | undefined) => (v || "").trim();
  return {
    root: t(syn.rootCause),
    corr: [t(syn.immediateCorrection), t(syn.correctiveAction)].filter(Boolean).join("\n\n"),
    evid: t(syn.evidenceForClosure),
  };
}

// Parses the panel's free-text finalClassification (e.g. "NC — regulatory
// requirement not met", "OFI: documentation gap", "CAR (Major)") into the
// finding's structured header type + severity. NC is preferred when the text
// mentions it (most severe); CAR is treated as a nonconformity. Defaults to NC
// when nothing recognisable is present, since the panel only runs on a raised
// finding.
export function parsePanelClassification(text: string): { findingType: FindingTypeCode; ncSeverity: NcSeverity | null } {
  const t = (text || "").toLowerCase();
  const isNC = /\bnc\b|non-?conformity|\bcar\b|corrective action request/.test(t);
  const isOFI = /\bofi\b|opportunity for improvement|improvement/.test(t);
  const isOBS = /\bobservation\b|\bobs\b/.test(t);

  let findingType: FindingTypeCode;
  if (isNC) findingType = "NC";
  else if (isOFI) findingType = "OFI";
  else if (isOBS) findingType = "OBS";
  else findingType = "NC";

  if (findingType !== "NC") return { findingType, ncSeverity: null };
  const ncSeverity: NcSeverity = /\bmajor\b|\bcritical\b|\bcar\b/.test(t) ? "Major" : "Minor";
  return { findingType, ncSeverity };
}

// Per-field manual-edit provenance for the closure text fields.
export type ClosureManual = { root?: boolean; corr?: boolean; prev?: boolean; evid?: boolean };

// The decision the store applies when a panel run finishes (or the user clicks
// "Apply panel conclusion", force=true). Pure so the overwrite / manual-edit
// protection / classification rules are testable without the store.
export type PanelConclusionPlan = {
  // Closure fields to write (only those the panel speaks to and doesn't defer).
  closure: { root?: string; corr?: string; evid?: string };
  // Closure fields whose manual flag should reset to false (now panel-sourced).
  clearedManual: Array<"root" | "corr" | "evid">;
  // Non-null when the header classification should change.
  classification: { findingType: FindingTypeCode; ncSeverity: NcSeverity | null } | null;
  // Human-readable field labels that were NOT overwritten because they hold a
  // differing manual edit — surfaced as the "review / apply" conflict notice.
  conflicts: string[];
};

export function computePanelConclusion(
  input: {
    closure: { root?: string; corr?: string; evid?: string; manual?: ClosureManual };
    findingType: FindingTypeCode; // resolved current type
    ncSeverity: NcSeverity | null; // resolved current severity
    classificationManual?: boolean;
    synthesis: PanelSynthesis;
  },
  opts?: { force?: boolean }
): PanelConclusionPlan {
  const force = !!opts?.force;
  const targets = panelClosureTargets(input.synthesis);
  const manual = input.closure.manual || {};
  const closure: PanelConclusionPlan["closure"] = {};
  const clearedManual: PanelConclusionPlan["clearedManual"] = [];
  const conflicts: string[] = [];

  const applyField = (key: "root" | "corr" | "evid", label: string, target: string) => {
    if (!target) return; // never clobber with empty text
    const cur = ((input.closure[key] as string | undefined) ?? "").trim();
    // Defer to a differing manual edit (unless forced) — flag it instead.
    if (!force && manual[key] && cur && cur !== target) { conflicts.push(label); return; }
    closure[key] = target;
    clearedManual.push(key);
  };
  applyField("root", "root cause", targets.root);
  applyField("corr", "corrective", targets.corr);
  applyField("evid", "closure evidence", targets.evid);

  let classification: PanelConclusionPlan["classification"] = null;
  const final = (input.synthesis.finalClassification || "").trim();
  if (final) {
    const parsed = parsePanelClassification(final);
    if (input.findingType !== parsed.findingType || input.ncSeverity !== parsed.ncSeverity) {
      if (!force && input.classificationManual) conflicts.push("classification");
      else classification = parsed;
    }
  }

  return { closure, clearedManual, classification, conflicts };
}
