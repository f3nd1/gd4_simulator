import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone } from "../lib/theme";
import { buildRunLogCsv, downloadCsv, downloadBlob } from "../lib/auditCsvExport";
import type { RunLogEntry, RunLogSubOutcome } from "../types";

// Small inline deep-link to a real record the run touched — reuses the app's
// existing ?item=/?subCrit= navigation, so the run log links to the live
// content instead of copying it.
const drillLinkStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: "#4338ca", textDecoration: "none",
  border: "1px solid #c7d2fe", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap",
};

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function durationLabel(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function modeLabel(mode: RunLogEntry["mode"]): string {
  return mode === "full-auto" ? "Full Auto" : "Hybrid (per item)";
}

function subOutcomeLine(o: RunLogSubOutcome): string {
  if (o.status === "skipped") return `${o.subCriterionId} — skipped${o.note ? ` (${o.note})` : ""}`;
  if (o.status === "error") return `${o.subCriterionId} — error${o.note ? `: ${o.note}` : ""}`;
  if (o.steps) {
    const parts = [
      o.steps.ppdRan ? "PPD reviewed" : null,
      o.steps.evidenceRan ? "evidence assessed" : null,
      o.steps.findingsCompiled > 0 ? `${o.steps.findingsCompiled} finding(s) compiled` : null,
      o.steps.outcomeReviewApplied ? "Outcomes & Review applied" : null,
    ].filter(Boolean);
    return `${o.subCriterionId} (Option A) — ${parts.length > 0 ? parts.join(", ") : "verdicts committed"}`;
  }
  return `${o.subCriterionId} (Option ${o.path}) — done${o.note ? ` (${o.note})` : ""}`;
}

const selectStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid #e2e8f0",
  borderRadius: 7,
  fontSize: 11.5,
  background: "#fff",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid #e2e8f0",
  borderRadius: 7,
  fontSize: 11.5,
  background: "#fff",
};

export function RunLog() {
  const log = useWorkspaceStore((s) => s.runLog);
  const [filterMode, setFilterMode] = useState<RunLogEntry["mode"] | "All">("All");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return log.filter((e) => {
      if (filterMode !== "All" && e.mode !== filterMode) return false;
      if (filterDateFrom && e.startedAt < filterDateFrom) return false;
      if (filterDateTo && e.startedAt > filterDateTo + "T23:59:59") return false;
      return true;
    });
  }, [log, filterMode, filterDateFrom, filterDateTo]);

  const stats = useMemo(() => ({
    total: log.length,
    fullAuto: log.filter((e) => e.mode === "full-auto").length,
    hybrid: log.filter((e) => e.mode === "hybrid-item").length,
    bandsSet: log.reduce((n, e) => n + e.bandsSet.length, 0),
  }), [log]);

  return (
    <div className="grid gap-3">
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Run Log</h2>
            <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "#6b7280" }}>
              What an automated run actually did — Full Auto sweeps and Hybrid per-item hands-off drafts. A record of
              what happened, never an input to scoring. For individual AI-call prompts/outputs, see the AI Review Log.
            </p>
          </div>
          {/* Whole-log export: a portable audit trail. CSV opens in Excel (one
              row per sub-criterion outcome); JSON is the full-fidelity record.
              Both reuse the shared export helpers. */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={log.length === 0}
              onClick={() => downloadCsv(buildRunLogCsv(log), `run-log-${new Date().toISOString().slice(0, 10)}.csv`)}
              style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: "1px solid #c7d2fe", background: "transparent", color: "#4338ca", cursor: log.length === 0 ? "default" : "pointer", opacity: log.length === 0 ? 0.5 : 1, whiteSpace: "nowrap" }}
            >
              Export CSV
            </button>
            <button
              disabled={log.length === 0}
              onClick={() => downloadBlob(JSON.stringify(log, null, 2), `run-log-${new Date().toISOString().slice(0, 10)}.json`, "application/json")}
              style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: "1px solid #c7d2fe", background: "transparent", color: "#4338ca", cursor: log.length === 0 ? "default" : "pointer", opacity: log.length === 0 ? 0.5 : 1, whiteSpace: "nowrap" }}
            >
              Export JSON
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Total runs", value: stats.total, bg: "#f8fafc", fg: "#0f172a" },
            { label: "Full Auto sweeps", value: stats.fullAuto, bg: "#f5f3ff", fg: "#6d28d9" },
            { label: "Hybrid per-item runs", value: stats.hybrid, bg: "#eff6ff", fg: "#1d4ed8" },
            { label: "Bands auto-scored", value: stats.bandsSet, bg: "#fefce8", fg: "#a16207" },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "8px 14px", minWidth: 130, textAlign: "center", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.fg }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Filter:</span>
          <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as RunLogEntry["mode"] | "All")} style={selectStyle}>
            <option value="All">All modes</option>
            <option value="full-auto">Full Auto</option>
            <option value="hybrid-item">Hybrid (per item)</option>
          </select>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>From</span>
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={inputStyle} />
          <span style={{ fontSize: 11, color: "#94a3b8" }}>to</span>
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={inputStyle} />
          {(filterMode !== "All" || filterDateFrom || filterDateTo) && (
            <button
              onClick={() => { setFilterMode("All"); setFilterDateFrom(""); setFilterDateTo(""); }}
              style={{ fontSize: 11, color: "#6366f1", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}
            >
              Clear filters
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{filtered.length} of {log.length} runs</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 13 }}>
            {log.length === 0
              ? "No automated runs yet. A run-log entry is recorded after a Full Auto sweep (\"Run full audit\") or a Hybrid per-item hands-off run (\"Run audit\" with Auto-score bands on)."
              : "No entries match the current filters."}
          </div>
        ) : (
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "150px 130px 90px 1fr 100px", gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
              <div>Started</div>
              <div>Mode</div>
              <div>Status</div>
              <div>Summary</div>
              <div>Items</div>
            </div>
            {filtered.map((entry, idx) => {
              const expanded = expandedId === entry.id;
              return (
                <div key={entry.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    style={{ display: "grid", gridTemplateColumns: "150px 130px 90px 1fr 100px", gap: 0, padding: "8px 10px", cursor: "pointer", background: expanded ? "#f8fafc" : "white", alignItems: "center" }}
                  >
                    <div style={{ fontSize: 10.5, color: "#64748b" }}>
                      {formatTs(entry.startedAt)}
                      <div style={{ color: "#cbd5e1" }}>{durationLabel(entry.startedAt, entry.endedAt)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: entry.mode === "full-auto" ? "#6d28d9" : "#1d4ed8", background: entry.mode === "full-auto" ? "#f5f3ff" : "#eff6ff", padding: "2px 7px", borderRadius: 999 }}>
                        {modeLabel(entry.mode)}
                      </span>
                    </div>
                    <div>
                      <Pill s={entry.status === "complete" ? "good" : "medium"}>{entry.status === "complete" ? "Complete" : "Cancelled"}</Pill>
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }} title={entry.summary}>
                      {entry.summary}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{entry.subCriterionIds.length}</div>
                  </div>

                  {expanded && (
                    <div style={{ padding: "0 10px 12px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>
                        Sub-criteria covered ({entry.perSub.length})
                      </div>
                      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}>
                        {entry.perSub.map((o) => (
                          <div key={o.subCriterionId} style={{ fontSize: 11.5, color: "#374151", padding: "3px 0", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ flex: 1, minWidth: 180 }}>{subOutcomeLine(o)}</span>
                            {/* Drill-down: links to the real records this sub-criterion
                                touched — the app's existing ?subCrit= deep-links, not a
                                copy of the finding/evidence content. */}
                            <Link to={`/findings?subCrit=${encodeURIComponent(o.subCriterionId)}`} style={drillLinkStyle}>Findings</Link>
                            {o.path === "A" && <Link to="/evidence-folder" style={drillLinkStyle}>Evidence</Link>}
                          </div>
                        ))}
                      </div>

                      {(entry.bandsSet.length > 0 || entry.bandsSkipped.length > 0) && (
                        <>
                          <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>
                            Band auto-scoring
                          </div>
                          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}>
                            {entry.bandsSet.map((b) => (
                              <div key={b.itemId} style={{ fontSize: 11.5, color: "#374151", padding: "3px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <Pill s={bandTone(b.band)}>B{b.band} · {b.totalPct}%</Pill>
                                <span style={{ flex: 1, minWidth: 180 }}>{b.itemId} — set automatically, labelled "AI-scored, not yet reviewed"</span>
                                <Link to={`/sub-checklist?item=${encodeURIComponent(b.itemId)}`} style={drillLinkStyle}>Checklist</Link>
                                <Link to="/final-report" style={drillLinkStyle}>Final Report</Link>
                              </div>
                            ))}
                            {entry.bandsSkipped.map((s) => (
                              <div key={s.itemId} style={{ fontSize: 11.5, color: "#b45309", padding: "3px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ flex: 1, minWidth: 180 }}>{s.itemId} — not scored: {s.reason}</span>
                                <Link to={`/sub-checklist?item=${encodeURIComponent(s.itemId)}`} style={drillLinkStyle}>Checklist</Link>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 12, marginBottom: 0 }}>
          Capped at 50 runs (newest first).
        </p>
      </Card>
    </div>
  );
}
