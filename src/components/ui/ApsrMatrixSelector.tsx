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

// Short in-cell label; the full text (incl. the 0% caveat) is the hover title.
function descriptorFor(dimKey: string, score: ApsrDimensionScore): string {
  if (score === 0) return "No evidence — below Band 1";
  return (EDUTRUST_BANDS[score - 1] as unknown as Record<string, string>)[dimKey];
}
function descriptorTitle(dimKey: string, score: ApsrDimensionScore): string {
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
      <div style={{ background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 6, padding: "6px 9px", marginBottom: 6, fontSize: 10, color: "#92400e" }}>
        <b>⚠ Reconstructed formula — not fully confirmed.</b> This matrix follows one worked example from an SSG auditor (A=20% + P=20% + S=10% + R=0% = 50% → Band 3). The exact percentage-to-band cut-offs and whether <b>0%</b> is a valid score below Band 1 are <b>not</b> yet auditor-confirmed — verify both before relying on this for a real submission.
        {docsHref && <> <a href={docsHref} target="_blank" rel="noreferrer" style={{ color: "#b45309", fontWeight: 700 }}>Why is scoring built this way? →</a></>}
        {" "}<a href="#/gd4-scoring-setup" style={{ color: "#b45309", fontWeight: 700 }}>Edit percentage scale →</a>
      </div>

      {/* Box matrix: dimension rows × [0% floor, Band 1-5] columns, official
          descriptor text in every cell, click a cell to pick that band.
          Deliberately compact (small type, short cells) — it's a dense
          reference grid, not prose. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ width: 84 }} />
              {SCORE_CHOICES.map((s) => (
                <th key={s} style={{ padding: "0 2px 2px", verticalAlign: "bottom", textAlign: "center" }}>
                  {s === 0
                    ? <><div style={{ fontSize: 8, fontWeight: 800, color: "#64748b" }}>0%</div><div style={{ fontSize: 7, color: "#94a3b8" }}>no ev.</div></>
                    : <div style={{ fontSize: 8, fontWeight: 800, color: bandTone(s) === "good" ? "#15803d" : "#475569" }}>B{s} · {pctForScore(s, scale)}%</div>}
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
                  <td style={{ fontSize: 8.5, fontWeight: 700, color: "#334155", padding: "2px 4px 2px 0", verticalAlign: "top", borderTop: "1px solid #f1f5f9" }} title={dim.definition}>
                    {dim.label}
                    <div style={{ fontSize: 8, fontWeight: 600, color: val === undefined ? "#cbd5e1" : "#15803d" }}>
                      {val === undefined ? "—" : `${pctForScore(val, scale)}%`}
                    </div>
                  </td>
                  {SCORE_CHOICES.map((s) => {
                    const sel = val === s;
                    const isSug = !sel && sug === s;
                    return (
                      <td key={s} style={{ padding: 1, verticalAlign: "top", borderTop: "1px solid #f1f5f9" }}>
                        <button
                          type="button"
                          onClick={() => onSet(dim.key, s)}
                          title={descriptorTitle(dim.key, s)}
                          style={{
                            display: "flex", gap: 2, width: "100%", height: "100%", minHeight: 22, cursor: "pointer", textAlign: "left",
                            fontSize: 8, lineHeight: 1.15, padding: "2px 3px", borderRadius: 4,
                            border: sel ? "1.5px solid #15803d" : isSug ? "1.5px solid #4f46e5" : "1px solid #e2e8f0",
                            background: sel ? "#f0fdf4" : isSug ? "#eef2ff" : s === 0 ? "#f8fafc" : "#fff",
                            color: s === 0 ? "#94a3b8" : "#334155", font: "inherit",
                          }}
                        >
                          {(sel || isSug) && <span style={{ fontSize: 7, fontWeight: 800, color: sel ? "#15803d" : "#4f46e5", flexShrink: 0 }}>{sel ? "✓" : "◂AI"}</span>}
                          {/* Clamp to 2 lines — full descriptor is the hover title, keeps rows short. */}
                          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{descriptorFor(dim.key, s)}</span>
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
      <p style={{ fontSize: 8.5, color: "#94a3b8", margin: "3px 0 0" }}>
        Descriptors quoted verbatim from the EduTrust Guidance Document v4 (Jan 2025), para. 23. The 0% column is the honest floor for a dimension below Band 1 (the Review=0% case in the auditor's example).
      </p>

      {/* Open arithmetic — this IS a real formula now, so show the sum. */}
      <div style={{ marginTop: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 9px", fontSize: 11 }}>
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
