import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { HumanDecisionEntry, HumanDecisionModule, HumanDecisionType, CalibrationExample } from "../types";

function decisionTone(type: HumanDecisionType): "good" | "medium" | "critical" | "neutral" {
  if (type === "Accepted") return "good";
  if (type === "Edited") return "medium";
  return "critical";
}

function moduleColor(m: HumanDecisionModule | string): string {
  const map: Record<string, string> = {
    "AFI Closure": "#7c3aed",
    "Grouped Finding": "#0369a1",
    "Line Status": "#b45309",
    "Closure Drafting": "#166534",
  };
  return map[m] ?? "#475569";
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const ALL_MODULES: HumanDecisionModule[] = ["AFI Closure", "Grouped Finding", "Line Status", "Closure Drafting"];
const ALL_TYPES: HumanDecisionType[] = ["Accepted", "Edited", "Overridden"];

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

// ─── Decision Log tab ────────────────────────────────────────────────────────

function DecisionLogTab({ log }: { log: HumanDecisionEntry[] }) {
  const [filterModule, setFilterModule] = useState<HumanDecisionModule | "All">("All");
  const [filterType, setFilterType] = useState<HumanDecisionType | "All">("All");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return log.filter((e) => {
      if (filterModule !== "All" && e.module !== filterModule) return false;
      if (filterType !== "All" && e.decisionType !== filterType) return false;
      if (filterDateFrom && e.timestamp < filterDateFrom) return false;
      if (filterDateTo && e.timestamp > filterDateTo + "T23:59:59") return false;
      return true;
    });
  }, [log, filterModule, filterType, filterDateFrom, filterDateTo]);

  const stats = useMemo(() => ({
    total: log.length,
    accepted: log.filter((e) => e.decisionType === "Accepted").length,
    edited: log.filter((e) => e.decisionType === "Edited").length,
    overridden: log.filter((e) => e.decisionType === "Overridden").length,
  }), [log]);

  return (
    <>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { label: "Total decisions", value: stats.total, bg: "#f8fafc", fg: "#0f172a" },
          { label: "Accepted", value: stats.accepted, bg: "#f0fdf4", fg: "#15803d" },
          { label: "Edited", value: stats.edited, bg: "#fffbeb", fg: "#b45309" },
          { label: "Overridden", value: stats.overridden, bg: "#fef2f2", fg: "#b91c1c" },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "8px 14px", minWidth: 110, textAlign: "center", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.fg }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Filter:</span>
        <select value={filterModule} onChange={(e) => setFilterModule(e.target.value as HumanDecisionModule | "All")} style={selectStyle}>
          <option value="All">All modules</option>
          {ALL_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as HumanDecisionType | "All")} style={selectStyle}>
          <option value="All">All decision types</option>
          {ALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>From</span>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 11, color: "#94a3b8" }}>to</span>
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={inputStyle} />
        {(filterModule !== "All" || filterType !== "All" || filterDateFrom || filterDateTo) && (
          <button
            onClick={() => { setFilterModule("All"); setFilterType("All"); setFilterDateFrom(""); setFilterDateTo(""); }}
            style={{ fontSize: 11, color: "#6366f1", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{filtered.length} of {log.length} entries</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 13 }}>
          {log.length === 0
            ? "No human decisions logged yet. Decisions are recorded when you override or accept AI outputs in AFI Closure, Findings, Sub-Criterion Checklist, and Quality Action modules."
            : "No entries match the current filters."}
        </div>
      ) : (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 130px 1fr 1fr 70px 80px 110px", gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
            <div>Timestamp</div>
            <div>Module</div>
            <div>AI Output</div>
            <div>Human Decision</div>
            <div>Changed?</div>
            <div>Decision</div>
            <div>Reason</div>
          </div>

          {filtered.map((entry, idx) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  style={{ display: "grid", gridTemplateColumns: "140px 130px 1fr 1fr 70px 80px 110px", gap: 0, padding: "8px 10px", cursor: "pointer", background: expanded ? "#f8fafc" : "white", alignItems: "center" }}
                >
                  <div style={{ fontSize: 10.5, color: "#64748b" }}>{formatTs(entry.timestamp)}</div>
                  <div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: moduleColor(entry.module), background: `${moduleColor(entry.module)}18`, padding: "2px 7px", borderRadius: 999 }}>
                      {entry.module}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }} title={entry.aiOutput}>
                    {truncate(entry.aiOutput)}
                  </div>
                  <div style={{ fontSize: 11, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }} title={entry.humanDecision}>
                    {truncate(entry.humanDecision)}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    <span style={{ color: entry.changed ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                      {entry.changed ? "Yes" : "No"}
                    </span>
                  </div>
                  <div>
                    <Pill s={decisionTone(entry.decisionType)}>{entry.decisionType}</Pill>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.reason}>
                    {entry.reason || <span style={{ color: "#e2e8f0" }}>—</span>}
                  </div>
                </div>

                {expanded && (
                  <div style={{ padding: "0 10px 12px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>AI Output</div>
                        <div style={{ background: "#fef2f2", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {entry.aiOutput || "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>Human Decision</div>
                        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {entry.humanDecision || "—"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 10 }}>
                      {[
                        { label: "Subject ID", value: entry.subjectId },
                        { label: "Field", value: entry.field || "—" },
                        { label: "Linked AI Run", value: entry.aiRunId || "—" },
                        { label: "Changed?", value: entry.changed ? "Yes" : "No" },
                      ].map((f) => (
                        <div key={f.label} style={{ background: "#fff", borderRadius: 8, padding: "7px 10px", border: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 }}>{f.label}</div>
                          <div style={{ fontSize: 12, color: "#374151", fontFamily: f.label === "Linked AI Run" || f.label === "Subject ID" ? "ui-monospace,monospace" : "inherit" }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {entry.reason && (
                      <div style={{ marginTop: 10, background: "#fffbeb", borderRadius: 8, padding: "8px 11px" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#b45309", marginBottom: 3 }}>Reason for override</div>
                        <div style={{ fontSize: 12, color: "#374151" }}>{entry.reason}</div>
                      </div>
                    )}
                    {!entry.reason && entry.decisionType === "Overridden" && (
                      <div style={{ marginTop: 10, background: "#fff7ed", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: "#b45309" }}>
                        ⚠ No reason recorded for this override.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 12, marginBottom: 0 }}>
        Capped at 500 entries (newest first). Covers: AFI Closure verdict · Grouped Finding confirmation · Audit line status override · Closure narrative edits.
      </p>
    </>
  );
}

// ─── Calibration Library tab ─────────────────────────────────────────────────

function CalibrationLibraryTab({ examples, toggleIncluded }: { examples: CalibrationExample[]; toggleIncluded: (id: string) => void }) {
  const [filterModule, setFilterModule] = useState<string>("All");

  const filtered = useMemo(
    () => (filterModule === "All" ? examples : examples.filter((e) => e.module === filterModule)),
    [examples, filterModule]
  );

  const includedCount = examples.filter((e) => e.included).length;
  const usedCount = examples.filter((e) => e.used).length;

  return (
    <>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          { label: "Total examples", value: examples.length, bg: "#f8fafc", fg: "#0f172a" },
          { label: "Included in prompts", value: includedCount, bg: "#f0fdf4", fg: "#15803d" },
          { label: "Used in a prompt", value: usedCount, bg: "#eff6ff", fg: "#1d4ed8" },
          { label: "Excluded", value: examples.length - includedCount, bg: "#fef2f2", fg: "#b91c1c" },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "8px 14px", minWidth: 110, textAlign: "center", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.fg }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 14, padding: "9px 12px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
        Calibration examples are auto-created when you override an AI output and provide a reason. Included examples are injected into AI prompts (top 3 per module, most recent first) so the AI can self-calibrate toward your auditing standards.
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Module:</span>
        <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)} style={selectStyle}>
          <option value="All">All modules</option>
          {ALL_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{filtered.length} of {examples.length}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 13 }}>
          {examples.length === 0
            ? "No calibration examples yet. They are created automatically when you override an AI output and provide a reason."
            : "No examples match the current filter."}
        </div>
      ) : (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "120px 100px 1fr 1fr 180px 110px 60px 110px", gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
            <div>Date</div>
            <div>Module</div>
            <div>AI Output</div>
            <div>Human Correction</div>
            <div>Reason</div>
            <div>Field</div>
            <div>Used</div>
            <div>Include in prompts</div>
          </div>

          {filtered.map((ex, idx) => (
            <div
              key={ex.id}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 100px 1fr 1fr 180px 110px 60px 110px",
                gap: 0,
                padding: "9px 10px",
                alignItems: "center",
                borderBottom: idx < filtered.length - 1 ? "1px solid #f1f5f9" : "none",
                background: ex.included ? "white" : "#fafafa",
                opacity: ex.included ? 1 : 0.65,
              }}
            >
              <div style={{ fontSize: 10.5, color: "#64748b" }}>{formatTs(ex.timestamp)}</div>
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: moduleColor(ex.module), background: `${moduleColor(ex.module)}18`, padding: "2px 7px", borderRadius: 999 }}>
                  {ex.module}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 6 }} title={ex.aiOutput}>
                {truncate(ex.aiOutput, 60)}
              </div>
              <div style={{ fontSize: 11, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 6 }} title={ex.humanCorrection}>
                {truncate(ex.humanCorrection, 60)}
              </div>
              <div style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 6 }} title={ex.reason}>
                {truncate(ex.reason, 50)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{ex.field || "—"}</div>
              <div style={{ fontSize: 11 }}>
                {ex.used
                  ? <span style={{ color: "#1d4ed8", fontWeight: 700 }}>Yes</span>
                  : <span style={{ color: "#94a3b8" }}>No</span>}
              </div>
              <div>
                <button
                  onClick={() => toggleIncluded(ex.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 7,
                    border: `1px solid ${ex.included ? "#bbf7d0" : "#e2e8f0"}`,
                    background: ex.included ? "#f0fdf4" : "#f8fafc",
                    color: ex.included ? "#15803d" : "#94a3b8",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ex.included ? "Included ✓" : "Excluded"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 12, marginBottom: 0 }}>
        Capped at 200 examples (newest first). Only examples with "Include" toggled on are injected into prompts.
      </p>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function HumanDecisionLog() {
  const log = useWorkspaceStore((s) => s.humanDecisionLog);
  const calibrationExamples = useWorkspaceStore((s) => s.calibrationExamples);
  const toggleCalibrationIncluded = useWorkspaceStore((s) => s.toggleCalibrationIncluded);

  const [tab, setTab] = useState<"log" | "calibration">("log");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 700,
    padding: "7px 16px",
    borderRadius: "8px 8px 0 0",
    border: "1px solid #e2e8f0",
    borderBottom: active ? "1px solid white" : "1px solid #e2e8f0",
    background: active ? "white" : "#f8fafc",
    color: active ? "#0f172a" : "#64748b",
    cursor: "pointer",
    marginBottom: -1,
    position: "relative",
  });

  return (
    <div className="grid gap-3">
      <Card>
        <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Human Decision Log</h2>
        <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "#6b7280" }}>
          Audit trail of every human override or acceptance of an AI output, and the calibration library built from those decisions.
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e2e8f0", marginBottom: 18 }}>
          <button style={tabStyle(tab === "log")} onClick={() => setTab("log")}>
            Decision Log
            {log.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: "#e2e8f0", borderRadius: 999, padding: "1px 6px", color: "#475569" }}>{log.length}</span>
            )}
          </button>
          <button style={tabStyle(tab === "calibration")} onClick={() => setTab("calibration")}>
            Calibration Library
            {calibrationExamples.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: calibrationExamples.filter((e) => e.included).length > 0 ? "#bbf7d0" : "#e2e8f0", borderRadius: 999, padding: "1px 6px", color: calibrationExamples.filter((e) => e.included).length > 0 ? "#15803d" : "#475569" }}>
                {calibrationExamples.filter((e) => e.included).length}/{calibrationExamples.length}
              </span>
            )}
          </button>
        </div>

        {tab === "log"
          ? <DecisionLogTab log={log} />
          : <CalibrationLibraryTab examples={calibrationExamples} toggleIncluded={toggleCalibrationIncluded} />
        }
      </Card>
    </div>
  );
}
