// The official EduTrust §23 band table (data/edutrustRubric.ts, verbatim) as
// the ONE shared render: 4 dimension rows × 5 band columns. Interactive when
// onSelect is given (the Sub-Criterion Checklist's holistic band selector —
// click a column to pick that band), read-only reference otherwise (Rubric &
// Banding page, GD4 Library). Holistic by design: selecting a band means the
// reviewer judged that column's four descriptors, read together, best fit the
// evidence — there is no per-dimension scoring.
import type { Band } from "../../types";
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS } from "../../data/edutrustRubric";
import { bandTone, TONE } from "../../lib/theme";
import { Pill } from "./Pill";

export function EdutrustBandTable({ selected, suggested, onSelect }: { selected?: Band; suggested?: Band; onSelect?: (band: Band) => void }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ width: 130 }} />
            {EDUTRUST_BANDS.map((b) => {
              const isSel = selected === b.band;
              const isSug = !isSel && suggested === b.band;
              return (
                <th key={b.band} style={{ padding: 0, verticalAlign: "bottom" }}>
                  <button
                    type="button"
                    disabled={!onSelect}
                    onClick={() => onSelect?.(b.band)}
                    title={onSelect ? (isSel ? `Band ${b.band} is the selected band` : `Select Band ${b.band} — judge that this column's four descriptors best fit the evidence`) : undefined}
                    style={{
                      display: "block", width: "100%", cursor: onSelect ? "pointer" : "default",
                      border: `2px solid ${isSel ? "#15803d" : isSug ? "#4f46e5" : "#e2e8f0"}`,
                      borderBottom: "none", borderRadius: "10px 10px 0 0",
                      background: isSel ? TONE.good.bg : isSug ? "#eef2ff" : "#f8fafc",
                      padding: "8px 6px", font: "inherit",
                    }}
                  >
                    <Pill s={bandTone(b.band)}>Band {b.band}</Pill>
                    <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3, color: "#1f2937" }}>{b.name}</div>
                    {onSelect && <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3, color: isSel ? "#15803d" : isSug ? "#4f46e5" : "#94a3b8" }}>{isSel ? "✓ Selected" : isSug ? "AI suggested" : "Select"}</div>}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {EDUTRUST_DIMENSIONS.map((dim, di) => (
            <tr key={dim.key}>
              <td style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", padding: "7px 8px 7px 0", verticalAlign: "top", borderTop: "1px solid #f1f5f9" }} title={dim.definition}>
                {dim.label}
              </td>
              {EDUTRUST_BANDS.map((b) => {
                const isSel = selected === b.band;
                const isSug = !isSel && suggested === b.band;
                const last = di === EDUTRUST_DIMENSIONS.length - 1;
                return (
                  <td
                    key={b.band}
                    style={{
                      fontSize: 11.5, color: "#334155", lineHeight: 1.45, padding: "7px 9px", verticalAlign: "top",
                      borderLeft: `2px solid ${isSel ? "#15803d" : isSug ? "#4f46e5" : "#e2e8f0"}`,
                      borderRight: `2px solid ${isSel ? "#15803d" : isSug ? "#4f46e5" : "#e2e8f0"}`,
                      borderTop: "1px solid #f1f5f9",
                      borderBottom: last ? `2px solid ${isSel ? "#15803d" : isSug ? "#4f46e5" : "#e2e8f0"}` : undefined,
                      borderRadius: last ? "0 0 10px 10px" : undefined,
                      background: isSel ? "#f6fff9" : isSug ? "#fbfcff" : "#fff",
                    }}
                  >
                    {b[dim.key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 10.5, color: "#94a3b8", margin: "6px 0 0" }}>
        Official EduTrust band rubric, quoted verbatim from the EduTrust Guidance Document v4 (Jan 2025), §23. Hover a dimension name for its official definition.
      </p>
    </div>
  );
}
