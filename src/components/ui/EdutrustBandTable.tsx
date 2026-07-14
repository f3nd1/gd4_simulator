// The official EduTrust §23 band table (data/edutrustRubric.ts, verbatim) as
// the ONE shared render: 4 dimension rows × 5 band columns, read-only. Shown
// as descriptor reference on the Rubric & Banding page, the GD4 Library, and
// inside the APSR matrix selector. The band INPUT is no longer here — under
// the APSR percentage-matrix model each dimension is scored separately in
// ApsrMatrixSelector; this table is purely the descriptor reference the
// reviewer reads against. (Interactive column-select props were removed when
// that selector replaced the old holistic column-pick — see git history.)
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS } from "../../data/edutrustRubric";
import { bandTone } from "../../lib/theme";
import { Pill } from "./Pill";

export function EdutrustBandTable() {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ width: 130 }} />
            {EDUTRUST_BANDS.map((b) => (
              <th key={b.band} style={{ padding: 0, verticalAlign: "bottom" }}>
                <div style={{ border: "2px solid #e2e8f0", borderBottom: "none", borderRadius: "10px 10px 0 0", background: "#f8fafc", padding: "8px 6px", textAlign: "center" }}>
                  <Pill s={bandTone(b.band)}>Band {b.band}</Pill>
                  <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3, color: "#1f2937" }}>{b.name}</div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {EDUTRUST_DIMENSIONS.map((dim, di) => (
            <tr key={dim.key}>
              <td style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", padding: "7px 8px 7px 0", verticalAlign: "top", borderTop: "1px solid #f1f5f9" }} title={dim.definition}>
                {dim.label}
              </td>
              {EDUTRUST_BANDS.map((b) => {
                const last = di === EDUTRUST_DIMENSIONS.length - 1;
                return (
                  <td
                    key={b.band}
                    style={{
                      fontSize: 11.5, color: "#334155", lineHeight: 1.45, padding: "7px 9px", verticalAlign: "top",
                      borderLeft: "2px solid #e2e8f0", borderRight: "2px solid #e2e8f0", borderTop: "1px solid #f1f5f9",
                      borderBottom: last ? "2px solid #e2e8f0" : undefined,
                      borderRadius: last ? "0 0 10px 10px" : undefined,
                      background: "#fff",
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
        Official EduTrust band rubric, quoted verbatim from the EduTrust Guidance Document v4 (Jan 2025), paragraph 23. Hover a dimension name for its official definition.
      </p>
    </div>
  );
}
