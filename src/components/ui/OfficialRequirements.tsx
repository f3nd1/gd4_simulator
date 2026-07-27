import { useMemo } from "react";
import { buildRequirementRows, downloadRequirementsCsv, openRequirementsPdf } from "../../lib/requirementsReference";
import { scopeTitle } from "../../lib/evidenceScope";

// PRE-AUDIT view: the official EduTrust requirement wording for one scope,
// read straight from the shipped GD4 data. It renders identically whether the
// sub-criterion has been audited, half-audited or never touched, because it
// reads NO run state at all — that is the whole point, and it is why this
// component takes only a scope id.
//
// Deliberately carries no verdict, tick, status pill or evidence column.
// Nothing has been read yet, so any such control would assert an audit that
// has not happened. The heading and the standing note say so in plain words,
// so this can never be mistaken for the run-derived "Requirement coverage"
// matrix that sits on the other tabs.
export function OfficialRequirements({ scopeId }: { scopeId: string }) {
  const rows = useMemo(() => buildRequirementRows(scopeId), [scopeId]);
  const items = useMemo(() => [...new Set(rows.map((r) => r.itemId))], [rows]);

  const btn: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "#0f766e", padding: "4px 9px",
    border: "1px solid #99f6e4", borderRadius: 6, background: "#f0fdfa",
    whiteSpace: "nowrap", cursor: "pointer",
  };

  if (rows.length === 0) {
    return <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No official requirement text is available for {scopeId}.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Official requirements — not yet assessed
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          {rows.length} line{rows.length === 1 ? "" : "s"} across {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
          <button type="button" style={btn} onClick={() => downloadRequirementsCsv(scopeId)} title="Download the official requirement text for this sub-criterion as a CSV">⬇ CSV</button>
          <button type="button" style={btn} onClick={() => openRequirementsPdf(scopeId)} title="Open the official requirement text as a printable/PDF table (new tab)">⬇ PDF</button>
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px", marginBottom: 10, lineHeight: 1.45 }}>
        This is the published EduTrust GD4 requirement wording only. <b>Nothing here has been checked against any document</b> — no file has been read and no audit has run. Use it to prepare; the Requirement coverage view on the other tabs is where assessed results appear.
      </div>

      {items.map((itemId) => {
        const itemRows = rows.filter((r) => r.itemId === itemId);
        return (
          <div key={itemId} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ padding: "7px 12px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9", fontSize: 12, fontWeight: 700, color: "#334155" }}>
              {itemId} {itemRows[0].itemTitle}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Ref", "Section", "Official requirement text"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "5px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.3, color: "#64748b", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemRows.map((r) => (
                  <tr key={r.ref}>
                    <td style={{ padding: "5px 12px", borderBottom: "1px solid #f1f5f9", fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap", verticalAlign: "top" }}>{r.ref}</td>
                    <td style={{ padding: "5px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap", verticalAlign: "top" }}>{r.section}</td>
                    {/* Lettered sub-items indent under the parent bullet they
                        split from, mirroring the official document's layout. */}
                    <td style={{ padding: "5px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 12, color: "#334155", verticalAlign: "top", paddingLeft: r.isChild ? 34 : 12 }}>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 0 }}>
        Source: EduTrust Guidance Document v4 requirement text for {scopeId} {scopeTitle(scopeId)}, as shipped with this tool.
      </p>
    </div>
  );
}
