// APSR percentage-matrix selector — the OFFICIAL band input (2026-07-14).
// Per an SSG auditor's worked example, each of Approach / Processes / Systems &
// Outcomes / Review is scored SEPARATELY (0% or a band 1-5 → 5-25%); the four
// sum to a total that maps to the final band. This component is the picker +
// the open arithmetic + the "reconstructed, not confirmed" disclaimers. The
// verbatim official descriptors are reused for reference via EdutrustBandTable
// (read-only) and as each band button's hover text.
import { useState } from "react";
import type { ApsrDimensionScore, ApsrMatrixScores } from "../../types";
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS, bandTitle } from "../../data/edutrustRubric";
import { apsrMatrixResult, pctForScore } from "../../lib/checklistBanding";
import { EdutrustBandTable } from "./EdutrustBandTable";
import { bandTone } from "../../lib/theme";
import { Pill } from "./Pill";

const SCORE_CHOICES: ApsrDimensionScore[] = [0, 1, 2, 3, 4, 5];

function descriptorFor(dimKey: string, score: ApsrDimensionScore): string {
  if (score === 0) return "0% — not evident (below Band 1). NOTE: the exact meaning of 0% vs Band 1 (5%) is NOT auditor-confirmed.";
  return `Band ${score} (${score * 5}%) — ${(EDUTRUST_BANDS[score - 1] as unknown as Record<string, string>)[dimKey]}`;
}

export function ApsrMatrixSelector({
  scores, suggestion, onSet, docsHref,
}: {
  scores: ApsrMatrixScores | undefined;
  suggestion?: ApsrMatrixScores;
  onSet: (dim: keyof ApsrMatrixScores, score: ApsrDimensionScore) => void;
  docsHref?: string;
}) {
  const [showDescriptors, setShowDescriptors] = useState(false);
  const result = apsrMatrixResult(scores);

  return (
    <div>
      {/* Reconstructed-formula disclaimer — shown wherever the matrix is. */}
      <div style={{ background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 11px", marginBottom: 8, fontSize: 11.5, color: "#92400e" }}>
        <b>⚠ Reconstructed formula — not fully confirmed.</b> This matrix follows one worked example from an SSG auditor (A=20% + P=20% + S=10% + R=0% = 50% → Band 3). The exact percentage-to-band cut-offs (shown as five equal 20-point ranges) and whether <b>0%</b> is a valid score below Band 1 are <b>not</b> yet auditor-confirmed — verify both before relying on this for a real submission.
        {docsHref && <> <a href={docsHref} target="_blank" rel="noreferrer" style={{ color: "#b45309", fontWeight: 700 }}>Why is scoring built this way? →</a></>}
      </div>

      <button onClick={() => setShowDescriptors((v) => !v)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#6b7280", background: "transparent", border: "none", padding: "2px 0 6px", display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>{showDescriptors ? "▾" : "▸"}</span> Official band descriptors (reference)
      </button>
      {showDescriptors && <div style={{ marginBottom: 8 }}><EdutrustBandTable /></div>}

      <div style={{ display: "grid", gap: 6 }}>
        {EDUTRUST_DIMENSIONS.map((dim) => {
          const val = scores?.[dim.key];
          const sug = suggestion?.[dim.key];
          return (
            <div key={dim.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px" }}>
              <div style={{ minWidth: 150, fontSize: 11.5, fontWeight: 700, color: "#334155" }} title={dim.definition}>{dim.label}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {SCORE_CHOICES.map((s) => {
                  const sel = val === s;
                  const isSug = !sel && sug === s;
                  return (
                    <button
                      key={s}
                      onClick={() => onSet(dim.key, s)}
                      title={descriptorFor(dim.key, s)}
                      style={{
                        cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap",
                        border: sel ? "2px solid #15803d" : isSug ? "2px solid #4f46e5" : "1px solid #e2e8f0",
                        background: sel ? "#f0fdf4" : isSug ? "#eef2ff" : "#fff",
                        color: sel ? "#15803d" : isSug ? "#4f46e5" : "#64748b",
                      }}
                    >
                      {s === 0 ? "0%" : `B${s} · ${s * 5}%`}{isSug ? " ◂AI" : ""}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: val === undefined ? "#cbd5e1" : "#334155" }}>
                {val === undefined ? "— not scored" : `${pctForScore(val)}%`}
              </div>
            </div>
          );
        })}
      </div>

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
