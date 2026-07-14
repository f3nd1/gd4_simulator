// "Why this band / how to improve" — a read-only VIEW over data the APSR
// matrix, each audited line's own APSR notes, and each line's apsrDimension
// tag already produce. No new scoring, no new AI call, no new "how to fix"
// text:
//   - band/pcts/total: the matrix's own apsrMatrixResult (savedBand).
//   - weakest dimension(s) + fastest path: pure arithmetic over those numbers
//     (weakestDimensions/fastestPathToNextBand in lib/checklistBanding.ts).
//   - which lines feed which dimension: SpecificChecklistLine.apsrDimension,
//     the AI line-generation pass's own structured field (set from a fixed
//     enum at generation time, never free-text-parsed) — absent on manual/
//     seed lines, which honestly don't appear in a dimension's line list.
//   - "how to fix" text: lineDimensionDiagnosis(line, dim.key), VERBATIM —
//     the real per-dimension AI note an audit run recorded for that line
//     (fixed 2026-07-14: this used to be buildDraftFinding's synthesised
//     "Replace the insufficient evidence..." template, a generic boilerplate
//     string that ignored the line's own real diagnosis already shown a few
//     clicks away in its expanded PPD/Evidence tabs).
import { EDUTRUST_DIMENSIONS, bandTitle } from "../../data/edutrustRubric";
import { lineDimensionDiagnosis, lineSufficiency, weakestDimensions, fastestPathToNextBand, type ApsrMatrixResult, type ApsrScale } from "../../lib/checklistBanding";
import { bandTone } from "../../lib/theme";
import type { SpecificChecklistLine } from "../../types";
import { Pill } from "./Pill";

function isActionable(l: SpecificChecklistLine): boolean {
  return l.status === "Not met" || l.status === "Partial" || (l.status === "Met" && lineSufficiency(l) !== "Present");
}

export function BandImprovementPanel({
  specific, matrixResult, scale, onOpenLine,
}: {
  specific: SpecificChecklistLine[];
  matrixResult: ApsrMatrixResult;
  scale: ApsrScale;
  onOpenLine: (lineId: string) => void;
}) {
  const weak = weakestDimensions(matrixResult.pcts);
  const path = fastestPathToNextBand(matrixResult, scale);
  const atMax = matrixResult.band >= 5;

  return (
    <details open={!atMax} style={{ margin: "10px 0", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <summary style={{ cursor: "pointer", padding: "9px 12px", fontSize: 12.5, fontWeight: 700, color: "#334155", background: "#f8fafc", listStyle: "none" }}>
        Why this band / how to improve <Pill s={bandTone(matrixResult.band)}>{bandTitle(matrixResult.band)}</Pill>
      </summary>
      <div style={{ padding: "10px 12px" }}>
        <p style={{ fontSize: 12, color: "#475569", margin: "0 0 10px" }}>
          {atMax
            ? "All four dimensions are already at their maximum — no dimension is limiting this item's band."
            : (() => {
                const weakLabels = weak.map((d) => EDUTRUST_DIMENSIONS.find((x) => x.key === d)!.label);
                return `${bandTitle(matrixResult.band)} (${matrixResult.total}%) — ${weakLabels.join(" and ")} ${weak.length > 1 ? "are" : "is"} the weakest of the four dimensions, at ${matrixResult.pcts[weak[0]]}% each, and the fastest way to raise the total.`;
              })()}
        </p>

        <div style={{ display: "grid", gap: 8 }}>
          {EDUTRUST_DIMENSIONS.map((dim) => {
            const pct = matrixResult.pcts[dim.key];
            const hasHeadroom = pct < scale.maxPctPerDimension;
            const stepPct = scale.maxPctPerDimension / 5;
            const nextMarkerPct = hasHeadroom ? Math.min(scale.maxPctPerDimension, pct + stepPct) : null;
            const fillFrac = scale.maxPctPerDimension > 0 ? Math.min(1, pct / scale.maxPctPerDimension) : 0;
            const markerFrac = nextMarkerPct !== null && scale.maxPctPerDimension > 0 ? Math.min(1, nextMarkerPct / scale.maxPctPerDimension) : null;
            const lines = specific.filter((l) => l.apsrDimension === dim.label && isActionable(l));

            return (
              <div key={dim.key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5, fontWeight: 700, color: "#334155" }}>
                  <span>{dim.label}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: hasHeadroom ? "#b45309" : "#15803d" }}>
                    {pct}% / {scale.maxPctPerDimension}%
                  </span>
                </div>
                {/* Gradient bar: fill = current %, thin marker = where this
                    dimension's own next band step starts. */}
                <div style={{ position: "relative", height: 9, borderRadius: 5, marginTop: 3, background: "linear-gradient(90deg,#fecaca,#fde68a,#bbf7d0)" }}>
                  <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: `${fillFrac * 100}%`, background: "#fff", opacity: 0.55, borderRadius: "0 5px 5px 0" }} />
                  {markerFrac !== null && (
                    <div title={`Next band step at ${nextMarkerPct}%`} style={{ position: "absolute", top: -2, bottom: -2, left: `${markerFrac * 100}%`, width: 2, background: "#334155" }} />
                  )}
                </div>
                {hasHeadroom && (
                  lines.length > 0 ? (
                    <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                      {lines.map((l) => {
                        const diagnosis = lineDimensionDiagnosis(l, dim.key);
                        return (
                          <div key={l.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11, background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 6, padding: "5px 7px" }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 600, color: "#334155" }}>{l.clause ? `${l.clause}: ` : ""}{l.text.length > 90 ? `${l.text.slice(0, 90)}…` : l.text}</span>
                              {diagnosis ? (
                                <span style={{ display: "block", color: "#6b7280", marginTop: 1 }}>How to fix: {diagnosis.length > 240 ? `${diagnosis.slice(0, 240)}…` : diagnosis}</span>
                              ) : (
                                <span style={{ display: "block", color: "#94a3b8", marginTop: 1, fontStyle: "italic" }}>No detailed diagnosis recorded for this line — open it to review the evidence directly.</span>
                              )}
                            </span>
                            <button onClick={() => onOpenLine(l.id)} style={{ cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "#4f46e5", background: "transparent", border: "none", padding: 0, whiteSpace: "nowrap", flexShrink: 0 }}>
                              open line →
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Honest, precise fallback (fixed 2026-07-14 — the prior
                    // wording named "AI first pass" unqualified, but TWO
                    // differently-behaved buttons share that label on this
                    // page; it also implied a one-click fix and a manual
                    // fallback that don't exist. This re-renders unchanged if
                    // a generate+confirm cycle still doesn't tag a line here
                    // — that's an honest restatement of current fact, not a
                    // bug to special-case.
                    <div style={{ marginTop: 4, fontSize: 10.5, color: "#94a3b8", lineHeight: 1.4 }}>
                      No lines are currently mapped to {dim.label} with an open gap. Dimension tags are set only when lines are AI-drafted — use the plain <b>"AI first pass"</b> button further down this page, near "Add line" (not the <b>"AI first pass (suggest scores)"</b> button above the matrix, which only sets dimension scores and never touches lines). Drafting stages a batch for the <b>whole item</b> in Pending — you then need <b>"Confirm into checklist"</b> before anything shows here.
                      {specific.length > 0 && " This item already has lines, so re-running will draft an additional batch rather than filling just this dimension — check that's really what you want first."}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        {path && (
          <div style={{ marginTop: 10, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "8px 11px", fontSize: 11.5, color: "#3730a3" }}>
            <b>Fastest path to {bandTitle(path.nextBand)}:</b> raise{" "}
            {path.dims.map((d) => EDUTRUST_DIMENSIONS.find((x) => x.key === d)!.label).join(" + ")}
            {" "}by one band step each (+{path.stepPct}% each, +{path.dims.length * path.stepPct}% total) — see the lines listed above under {path.dims.length > 1 ? "those dimensions" : "that dimension"}.
          </div>
        )}
      </div>
    </details>
  );
}
