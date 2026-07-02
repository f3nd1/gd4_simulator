import { Fragment, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

// Read-only history of every git push/pull the app has recorded (accumulated
// from the footer's build-time git info). No editing — this is a history view.

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

type ActionFilter = "All" | "push" | "pull";

export function ChangeLog() {
  const changeLog = useWorkspaceStore((s) => s.changeLog);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("All");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return changeLog
      .filter((e) => actionFilter === "All" || e.action === actionFilter)
      .filter((e) => !q || e.commitMessage.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));
  }, [changeLog, actionFilter, search]);

  const pushCount = changeLog.filter((e) => e.action === "push").length;
  const pullCount = changeLog.filter((e) => e.action === "pull").length;

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Change Log</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {changeLog.length} entr{changeLog.length === 1 ? "y" : "ies"} · {pushCount} push{pushCount === 1 ? "" : "es"} · {pullCount} pull{pullCount === 1 ? "" : "s"}
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 0, marginBottom: 12 }}>
        Every push/pull the app has become aware of, newest first — a detailed history of what changed over time. Read-only.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["All", "push", "pull"] as ActionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setActionFilter(f)}
              style={{
                cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 999, textTransform: "capitalize",
                border: `1px solid ${actionFilter === f ? "#4338ca" : "#e2e8f0"}`,
                background: actionFilter === f ? "#4338ca" : "#fff",
                color: actionFilter === f ? "#fff" : "#374151",
              }}
            >
              {f === "All" ? "All" : f}
            </button>
          ))}
        </div>
        <input
          placeholder="Search message or summary…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200, padding: "5px 8px" }}
        />
      </div>

      {changeLog.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
          No changes recorded yet. Every push the app loads on is logged here — each deploy of a pushed build adds an entry.
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No entries match the current filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Commit</th>
              <th>Message</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const hasFiles = !!e.filesChanged && e.filesChanged.length > 0;
              const isOpen = expanded.has(e.id);
              return (
                <Fragment key={e.id}>
                  <tr
                    className="rowh"
                    onClick={hasFiles ? () => toggle(e.id) : undefined}
                    style={hasFiles ? { cursor: "pointer" } : undefined}
                  >
                    <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "#475569" }}>
                      {hasFiles && <span style={{ color: "#94a3b8", marginRight: 5 }}>{isOpen ? "▾" : "▸"}</span>}
                      {formatTs(e.timestamp)}
                    </td>
                    <td>
                      <Pill s={e.action === "push" ? "good" : "neutral"}>{e.action === "push" ? "Push" : "Pull"}</Pill>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#4338ca" }}>{e.commitHash}</span>
                      <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{e.branch}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "#374151", maxWidth: 320 }}>{e.commitMessage || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                    <td style={{ fontSize: 12, color: "#1e293b", maxWidth: 340 }}>{e.summary}</td>
                  </tr>
                  {hasFiles && isOpen && (
                    <tr>
                      <td colSpan={5} style={{ padding: "0 10px 8px 28px", background: "#f8fafc" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, margin: "6px 0 3px" }}>
                          Files changed ({e.filesChanged!.length})
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {e.filesChanged!.map((f) => (
                            <li key={f} style={{ fontSize: 11.5, color: "#374151", fontFamily: "monospace" }}>{f}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
