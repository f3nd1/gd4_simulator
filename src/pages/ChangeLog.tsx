import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Navigate } from "react-router-dom";
import { devToolsRedirect } from "../nav";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";

// Read-only history of every change, straight from git. The full commit history
// (subject, description body, and files touched) is embedded at build time as
// __GIT_LOG__ (see gitLog() in vite.config.ts), so this shows everything since
// day one regardless of how often the app was deployed. Rebuilding after a
// `git pull` refreshes it automatically.

type Commit = (typeof __GIT_LOG__)[number];

// "06 July 2026"
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

// "15:16"
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// YYYY-MM-DD in local time, for grouping + range comparison.
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ChangeLog() {
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openDesc, setOpenDesc] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>) => (hash: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  const toggleDesc = toggle(setOpenDesc);
  const toggleFiles = toggle(setOpenFiles);

  const commits = __GIT_LOG__;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return commits.filter((c) => {
      if (q && !c.subject.toLowerCase().includes(q) && !c.body.toLowerCase().includes(q)) return false;
      const k = dayKey(c.isoTime);
      if (fromDate && k && k < fromDate) return false;
      if (toDate && k && k > toDate) return false;
      return true;
    });
  }, [commits, search, fromDate, toDate]);

  // Group the (already newest-first) commits by calendar day, preserving order.
  const groups = useMemo(() => {
    const out: { day: string; label: string; items: Commit[] }[] = [];
    for (const c of filtered) {
      const k = dayKey(c.isoTime);
      const last = out[out.length - 1];
      if (last && last.day === k) last.items.push(c);
      else out.push({ day: k, label: formatDay(c.isoTime), items: [c] });
    }
    return out;
  }, [filtered]);

  // Developer tools hidden → this route is inaccessible, not just unlisted.
  // Placed after every hook so the hook order never varies between renders.
  const redirect = devToolsRedirect(showDeveloperTools);
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Changelog</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0, marginBottom: 14 }}>
        Every change, straight from git history — subject, full description and the files it touched. Dates show as DD MMMM YYYY. Read-only.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 260px", minWidth: 200 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Search</div>
          <input
            placeholder="Filter by commit subject or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle }}
          />
        </label>
        <label>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginBottom: 4 }}>From</div>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </label>
        <label>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginBottom: 4 }}>To</div>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </label>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        {filtered.length} change{filtered.length === 1 ? "" : "s"}
        {filtered.length !== commits.length && <span style={{ color: "#94a3b8" }}> · {commits.length} total</span>}
      </div>

      {commits.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
          No git history was embedded in this build. (This happens when the app is built outside a git checkout.)
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No changes match the current search or date range.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map((g) => (
            <div key={g.day || g.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4338ca", flexShrink: 0, boxShadow: "0 0 0 3px #e0e7ff" }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "#1e293b" }}>{g.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#4338ca", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 999, padding: "1px 9px" }}>
                  {g.items.length}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 4, borderLeft: "2px solid #eef2ff", marginLeft: 4 }}>
                {g.items.map((c) => {
                  const descOpen = openDesc.has(c.hash);
                  const filesOpen = openFiles.has(c.hash);
                  const hasBody = c.body.trim().length > 0;
                  const fileCount = c.files.length;
                  return (
                    <div key={c.hash} style={{ marginLeft: 8, border: "1px solid #e8edf3", borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{c.subject}</div>
                          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>{c.author || "—"}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                          {formatTime(c.isoTime) && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>🕑 {formatTime(c.isoTime)}</span>
                          )}
                          <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "#94a3b8" }}>{c.shortHash}</span>
                        </div>
                      </div>

                      {(hasBody || fileCount > 0) && (
                        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                          {hasBody && (
                            <button
                              onClick={() => toggleDesc(c.hash)}
                              style={{ cursor: "pointer", border: "none", background: "transparent", padding: 0, fontSize: 12, fontWeight: 700, color: "#4338ca" }}
                            >
                              {descOpen ? "▾" : "▸"} Description
                            </button>
                          )}
                          {fileCount > 0 && (
                            <button
                              onClick={() => toggleFiles(c.hash)}
                              style={{ cursor: "pointer", border: "none", background: "transparent", padding: 0, fontSize: 12, fontWeight: 700, color: "#4338ca" }}
                            >
                              {filesOpen ? "▾" : "▸"} {fileCount} file{fileCount === 1 ? "" : "s"} changed
                            </button>
                          )}
                        </div>
                      )}

                      {hasBody && descOpen && (
                        <pre
                          style={{
                            margin: "8px 0 0", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e8edf3", borderRadius: 8,
                            fontSize: 12, lineHeight: 1.5, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word",
                            fontFamily: "inherit",
                          }}
                        >
                          {c.body}
                        </pre>
                      )}

                      {fileCount > 0 && filesOpen && (
                        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                          {c.files.map((f) => (
                            <li key={f} style={{ fontSize: 11.5, color: "#374151", fontFamily: "monospace", lineHeight: 1.6 }}>{f}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
