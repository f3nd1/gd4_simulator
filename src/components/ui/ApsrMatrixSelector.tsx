// APSR percentage-matrix selector — the OFFICIAL band input (2026-07-14).
// Per an SSG auditor's worked example, each of Approach / Processes / Systems &
// Outcomes / Review is scored SEPARATELY (0% or a band 1-5 → its % on the
// editable scale); the four sum to a total that maps to the final band.
//
// Layout (Task 6): a full comparison GRID — 6 columns (a "0% / no evidence"
// floor state + Band 1-5) × 4 dimension rows, the verbatim official rubric
// descriptor visible in every cell. Clicking a cell picks that band for that
// row. The %-scale + thresholds are editable on the GD4 Scoring Setup page
// (Task 7), read live here — nothing about the scale is hardcoded.
import type { ApsrDimensionScore, ApsrMatrixScores } from "../../types";
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS, bandTitle } from "../../data/edutrustRubric";
import { apsrMatrixResult, pctForScore } from "../../lib/checklistBanding";
import { useScoringConfigStore } from "../../store/useScoringConfigStore";
import { bandTone } from "../../lib/theme";
import { Pill } from "./Pill";

const SCORE_CHOICES: ApsrDimensionScore[] = [0, 1, 2, 3, 4, 5];

function descriptorFor(dimKey: string, score: ApsrDimensionScore): string {
  if (score === 0) return "No evidence / not yet assessed — a genuine 0% floor, below Band 1. (Whether 0% is a valid score is NOT auditor-confirmed.)";
  return (EDUTRUST_BANDS[score - 1] as unknown as Record<string, string>)[dimKey];
}

export function ApsrMatrixSelector({
  scores, suggestion, onSet, docsHref,
}: {
  scores: ApsrMatrixScores | undefined;
  suggestion?: ApsrMatrixScores;
  onSet: (dim: keyof ApsrMatrixScores, score: ApsrDimensionScore) => void;
  docsHref?: string;
}) {
  const scale = useScoringConfigStore((s) => s.apsrScale);
  const result = apsrMatrixResult(scores, scale);

  return (
    <div>
      {/* Reconstructed-formula disclaimer — shown wherever the matrix is. */}
      <div style={{ background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 11px", marginBottom: 8, fontSize: 11.5, color: "#92400e" }}>
        <b>⚠ Reconstructed formula — not fully confirmed.</b> This matrix follows one worked example from an SSG auditor (A=20% + P=20% + S=10% + R=0% = 50% → Band 3). The exact percentage-to-band cut-offs and whether <b>0%</b> is a valid score below Band 1 are <b>not</b> yet auditor-confirmed — verify both before relying on this for a real submission.
        {docsHref && <> <a href={docsHref} target="_blank" rel="noreferrer" style={{ color: "#b45309", fontWeight: 700 }}>Why is scoring built this way? →</a></>}
        {" "}<a href="#/gd4-scoring-setup" style={{ color: "#b45309", fontWeight: 700 }}>Edit percentage scale →</a>
      </div>

      {/* Box matrix: dimension rows × [0% floor, Band 1-5] columns, official
          descriptor text in every cell, click a cell to pick that band. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: 132 }} />
              {SCORE_CHOICES.map((s) => (
                <th key={s} style={{ padding: "0 3px 5px", verticalAlign: "bottom", textAlign: "center" }}>
                  {s === 0
                    ? <><div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>0%</div><div style={{ fontSize: 9.5, color: "#94a3b8" }}>no evidence</div></>
                    : <><Pill s={bandTone(s)}>Band {s}</Pill><div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", marginTop: 2 }}>{pctForScore(s, scale)}%</div></>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EDUTRUST_DIMENSIONS.map((dim) => {
              const val = scores?.[dim.key];
              const sug = suggestion?.[dim.key];
              return (
                <tr key={dim.key}>
                  <td style={{ fontSize: 11.5, fontWeight: 700, color: "#334155", padding: "6px 8px 6px 0", verticalAlign: "top", borderTop: "1px solid #f1f5f9" }} title={dim.definition}>
                    {dim.label}
                    <div style={{ fontSize: 10, fontWeight: 600, color: val === undefined ? "#cbd5e1" : "#15803d", marginTop: 2 }}>
                      {val === undefined ? "— not scored" : `${pctForScore(val, scale)}%`}
                    </div>
                  </td>
                  {SCORE_CHOICES.map((s) => {
                    const sel = val === s;
                    const isSug = !sel && sug === s;
                    return (
                      <td key={s} style={{ padding: 2, verticalAlign: "top", borderTop: "1px solid #f1f5f9" }}>
                        <button
                          type="button"
                          onClick={() => onSet(dim.key, s)}
                          title={descriptorFor(dim.key, s)}
                          style={{
                            display: "block", width: "100%", height: "100%", minHeight: 62, cursor: "pointer", textAlign: "left",
                            fontSize: 10.5, lineHeight: 1.35, padding: "6px 7px", borderRadius: 8,
                            border: sel ? "2px solid #15803d" : isSug ? "2px solid #4f46e5" : "1px solid #e2e8f0",
                            background: sel ? "#f0fdf4" : isSug ? "#eef2ff" : s === 0 ? "#f8fafc" : "#fff",
                            color: s === 0 ? "#94a3b8" : "#334155", font: "inherit",
                          }}
                        >
                          <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, marginBottom: 2, color: sel ? "#15803d" : isSug ? "#4f46e5" : "#94a3b8" }}>
                            {sel ? "✓ selected" : isSug ? "◂ AI" : s === 0 ? "0%" : `${pctForScore(s, scale)}%`}
                          </span>
                          {descriptorFor(dim.key, s)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 10.5, color: "#94a3b8", margin: "5px 0 0" }}>
        Descriptors quoted verbatim from the EduTrust Guidance Document v4 (Jan 2025), para. 23. The 0% column is the honest floor for a dimension below Band 1 (the Review=0% case in the auditor's example).
      </p>

      {/* Open arithmetic — this IS a real formula now, so show the sum. */}
      <div style={{ marginTop: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>
        <span style={{ fontFamily: "ui-monospace,monospace" }}>
          {result.pcts.approach}% + {result.pcts.processes}% + {result.pcts.systemsOutcomes}% + {result.pcts.review}% = <b>{result.total}%</b>
        </span>
        {" → "}
        {result.complete
          ? <><Pill s={bandTone(result.band)}>{bandTitle(result.band)}</Pill> <span style={{ color: "#94a3b8" }}>(calculated — thresholds inferred)</span></>
          : <span style={{ color: "#b45309", fontWeight: 700 }}>score all four dimensions to calculate the band</span>}
      </div>
    </div>
  );
}
