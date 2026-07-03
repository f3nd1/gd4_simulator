import { useState } from "react";
import type { CalibrationMemory, CalibrationMemoryStatus, HumanDecisionModule } from "../types";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { filterSelectStyle } from "../components/ui/Card";

const ALL_MODULES: HumanDecisionModule[] = [
  "AFI Closure",
  "Grouped Finding",
  "Line Status",
  "Closure Drafting",
  "Evidence Intake",
  "Evidence Sufficiency",
  "Item Scoring",
  "Checklist Line Edit",
  "Finding Observation",
  "Cross-Criterion Analysis",
  "Final Report",
  "AI Review Log Feedback",
];

const STATUS_LABELS: Record<CalibrationMemoryStatus, string> = {
  active: "Active",
  pending_review: "Pending Review",
  archived: "Archived",
};

const STATUS_PILL: Record<CalibrationMemoryStatus, string> = {
  active: "good",
  pending_review: "medium",
  archived: "neutral",
};

const TOKEN_CAP = 8000;

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

function MemoryRow({ memory, onStatusChange }: { memory: CalibrationMemory; onStatusChange: (id: string, s: CalibrationMemoryStatus) => void }) {
  const [expanded, setExpanded] = useState(false);

  const otherStatuses = (["active", "pending_review", "archived"] as CalibrationMemoryStatus[]).filter(s => s !== memory.status);

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: "pointer", background: expanded ? "#f8fafc" : undefined, borderBottom: "1px solid #e8edf3" }}
      >
        <td style={{ padding: "10px 12px", fontSize: 12.5, whiteSpace: "nowrap" }}>{memory.module}</td>
        <td style={{ padding: "10px 12px", fontSize: 12.5, maxWidth: 220 }}>{trunc(memory.context, 80)}</td>
        <td style={{ padding: "10px 12px", fontSize: 12.5, maxWidth: 280 }}>{trunc(memory.keyLearning, 120)}</td>
        <td style={{ padding: "10px 12px" }}>
          <Pill s={STATUS_PILL[memory.status]}>{STATUS_LABELS[memory.status]}</Pill>
        </td>
        <td style={{ padding: "10px 12px", fontSize: 12.5, textAlign: "center" }}>{memory.usageCount}</td>
        <td style={{ padding: "10px 12px", fontSize: 12.5, textAlign: "center" }}>
          {memory.effectivenessScore != null ? memory.effectivenessScore.toFixed(1) : "—"}
        </td>
        <td style={{ padding: "10px 12px", fontSize: 12.5, whiteSpace: "nowrap" }}>{formatDate(memory.timestamp)}</td>
      </tr>
      {expanded && (
        <tr style={{ background: "#f8fafc" }}>
          <td colSpan={7} style={{ padding: "16px 20px", borderBottom: "1px solid #e8edf3" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Context</div>
                <div style={{ fontSize: 13, color: "#1e293b", whiteSpace: "pre-wrap" }}>{memory.context}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Output</div>
                <div style={{ fontSize: 13, color: "#1e293b", whiteSpace: "pre-wrap" }}>{memory.aiOutput}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Staff Correction</div>
                <div style={{ fontSize: 13, color: "#1e293b", whiteSpace: "pre-wrap" }}>{memory.staffCorrection}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Key Learning</div>
                <div style={{ fontSize: 13, color: "#1e293b", whiteSpace: "pre-wrap" }}>{memory.keyLearning}</div>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#64748b", marginRight: 4 }}>Effectiveness:</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginRight: 16 }}>
                {memory.effectivenessScore != null ? memory.effectivenessScore.toFixed(1) : "Not yet rated"}
              </span>
              {otherStatuses.map(s => (
                <button
                  key={s}
                  onClick={e => { e.stopPropagation(); onStatusChange(memory.id, s); }}
                  style={{ fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#334155", fontFamily: "inherit" }}
                >
                  {s === "active" ? "Mark Active" : s === "pending_review" ? "Mark Pending Review" : "Archive"}
                </button>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MemoriesLibrary({ memories, updateMemoryStatus }: { memories: CalibrationMemory[]; updateMemoryStatus: (id: string, s: CalibrationMemoryStatus) => void }) {
  const [moduleFilter, setModuleFilter] = useState<HumanDecisionModule | "All">("All");
  const [statusFilter, setStatusFilter] = useState<CalibrationMemoryStatus | "All">("All");

  const total = memories.length;
  const active = memories.filter(m => m.status === "active");
  const pending = memories.filter(m => m.status === "pending_review");
  const archived = memories.filter(m => m.status === "archived");
  const tokenBudget = active.reduce((sum, m) => sum + m.tokenCount, 0);

  const filtered = memories.filter(m => {
    if (moduleFilter !== "All" && m.module !== moduleFilter) return false;
    if (statusFilter !== "All" && m.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Total Memories</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1e293b" }}>{total}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#1f7a4d", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Active</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1f7a4d" }}>{active.length}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#92520a", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Pending Review</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#92520a" }}>{pending.length}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Archived</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#64748b" }}>{archived.length}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Token Budget Used</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1d4ed8" }}>{tokenBudget.toLocaleString()}</div>
        </Card>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={moduleFilter}
          onChange={e => setModuleFilter(e.target.value as HumanDecisionModule | "All")}
          style={{ ...filterSelectStyle }}
        >
          <option value="All">All Modules</option>
          {ALL_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as CalibrationMemoryStatus | "All")}
          style={{ ...filterSelectStyle }}
        >
          <option value="All">All Statuses</option>
          <option value="active">Active</option>
          <option value="pending_review">Pending Review</option>
          <option value="archived">Archived</option>
        </select>
        <span style={{ fontSize: 12.5, color: "#64748b" }}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No memories match the current filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e8edf3" }}>
                  {["Module", "Context", "Key Learning", "Status", "Usage", "Effectiveness", "Created"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", fontSize: 11.5, fontWeight: 700, color: "#475569", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <MemoryRow key={m.id} memory={m} onStatusChange={updateMemoryStatus} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Analytics({ memories }: { memories: CalibrationMemory[] }) {
  const [moduleFilter, setModuleFilter] = useState<HumanDecisionModule | "All">("All");

  const filtered = moduleFilter === "All" ? memories : memories.filter(m => m.module === moduleFilter);

  const moduleCounts = ALL_MODULES.map(mod => ({
    module: mod,
    count: filtered.filter(m => m.module === mod).length,
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  const topEffective = filtered
    .filter(m => m.effectivenessScore != null)
    .sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0))
    .slice(0, 5);

  const activeTokens = memories.filter(m => m.status === "active").reduce((sum, m) => sum + m.tokenCount, 0);
  const pct = Math.min(100, Math.round((activeTokens / TOKEN_CAP) * 100));
  const gaugeColor = pct >= 90 ? "#dc2626" : pct >= 70 ? "#d97706" : "#1f7a4d";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select
          value={moduleFilter}
          onChange={e => setModuleFilter(e.target.value as HumanDecisionModule | "All")}
          style={{ ...filterSelectStyle }}
        >
          <option value="All">All Modules</option>
          {ALL_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>Accuracy Rate by Module</div>
          <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>
            Per-module accuracy data is available in the Human Decision Log. Navigate to the Human Decision Log page to view correction rates and accuracy trends by module.
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>Module Correction Counts</div>
          {moduleCounts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#94a3b8" }}>No data for selected filter.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {moduleCounts.map((r, i) => (
                <div key={r.module} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", width: 16, textAlign: "right" }}>#{i + 1}</span>
                  <span style={{ fontSize: 12.5, color: "#334155", flex: 1 }}>{r.module}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1e293b" }}>{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>Most Effective Memories (Top 5)</div>
          {topEffective.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#94a3b8" }}>No rated memories for selected filter.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {topEffective.map((m, i) => (
                <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", width: 16, textAlign: "right", paddingTop: 1 }}>#{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#334155" }}>{m.module}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1f7a4d" }}>{(m.effectivenessScore as number).toFixed(1)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{trunc(m.keyLearning, 100)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>Token Budget</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "#64748b" }}>Active memories tokens</span>
              <span style={{ fontWeight: 700, color: "#1e293b" }}>{activeTokens.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "#64748b" }}>Cap</span>
              <span style={{ fontWeight: 700, color: "#1e293b" }}>{TOKEN_CAP.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "#64748b" }}>Usage</span>
              <span style={{ fontWeight: 700, color: gaugeColor }}>{pct}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", marginTop: 4 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: gaugeColor, borderRadius: 999, transition: "width 0.3s" }} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AIMemories() {
  const [tab, setTab] = useState<"library" | "analytics">("library");
  const calibrationMemories = useWorkspaceStore(s => s.calibrationMemories ?? []);
  const updateMemoryStatus = useWorkspaceStore(s => s.updateMemoryStatus);

  const tabs = [
    { id: "library" as const, label: "Memories Library" },
    { id: "analytics" as const, label: "Analytics" },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e293b", margin: 0, marginBottom: 4 }}>AI Calibration Memories</h1>
        <p style={{ fontSize: 13.5, color: "#64748b", margin: 0 }}>Calibration memories generated from staff corrections of AI outputs.</p>
      </div>

      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "2px solid #e8edf3" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "9px 18px",
              fontSize: 13.5,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#1d4ed8" : "#64748b",
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #1d4ed8" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <MemoriesLibrary memories={calibrationMemories} updateMemoryStatus={updateMemoryStatus} />
      )}
      {tab === "analytics" && (
        <Analytics memories={calibrationMemories} />
      )}
    </div>
  );
}
