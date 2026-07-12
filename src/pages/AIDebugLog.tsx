import { useAIDebugLogStore } from "../store/useAIDebugLogStore";
import { Card } from "../components/ui/Card";

export function AIDebugLog() {
  const entries = useAIDebugLogStore((s) => s.entries);
  const clearLog = useAIDebugLogStore((s) => s.clearLog);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>AI Debug Log</h3>
          <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
            Every <code>buildSystemPrompt()</code> call logged in memory (dev only). Clears on page reload.
          </p>
        </div>
        <button
          onClick={clearLog}
          disabled={entries.length === 0}
          style={{
            cursor: entries.length === 0 ? "not-allowed" : "pointer",
            border: "1px solid #cbd5e1",
            background: "#fff",
            borderRadius: 6,
            fontSize: 12,
            padding: "6px 12px",
            color: entries.length === 0 ? "#cbd5e1" : "#374151",
          }}
        >
          Clear log
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          No entries yet. Trigger any AI call (folder audit, finding draft, closure review, etc.) to populate this log.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 2 }}>
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} — newest first · click an entry to expand the full prompt
          </div>
          {entries.map((e) => (
            <details
              key={e.id}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}
            >
              <summary
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  width: "100%",
                  padding: "8px 10px",
                }}
              >
                <span className="details-marker-closed" style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>▼</span>
                <span className="details-marker-open" style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>▲</span>
                <code style={{ fontSize: 11, color: "#6b7280" }}>
                  {new Date(e.timestamp).toLocaleString()}
                </code>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#1e3a8a" }}>
                  {e.functionName}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    background: "#dbeafe",
                    color: "#1d4ed8",
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {e.module}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    background: e.criterionSkill ? "#dcfce7" : "#f1f5f9",
                    color: e.criterionSkill ? "#15803d" : "#94a3b8",
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {e.criterionSkill ? `criterion: ${e.criterionSkill}` : "criterion: none"}
                </span>
                <span className="details-hide-when-open" style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400 }}>
                  {e.systemPrompt.slice(0, 120).replace(/\n/g, " ")}…
                </span>
              </summary>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "#374151",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "#f1f5f9",
                  borderRadius: "0 0 8px 8px",
                  padding: "8px 10px",
                }}
              >
                {e.systemPrompt}
              </pre>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
