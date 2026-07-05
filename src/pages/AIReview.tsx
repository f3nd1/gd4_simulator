import { Fragment, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { AIReviewLogEntry, AuditFileRecord } from "../types";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { FileLedger } from "./EvidenceFolder";

function verdictTone(v: string) {
  return v === "Acceptable" ? "good" : v === "Partial" || v === "At risk" ? "medium" : v === "Pass" ? "good" : "critical";
}

// Summarises how a run's evidence was read, for the badge on each log entry.
// Counts only files actually read; fresh = new/changed, cached = reused.
function summarizeLedger(ledger: AuditFileRecord[]): { read: number; fresh: number; cached: number; text: number; vision: number } | null {
  const read = ledger.filter((f) => f.readStatus === "read" || f.readStatus === "condensed");
  if (read.length === 0) return null;
  return {
    read: read.length,
    cached: read.filter((f) => f.processingMode === "reused").length,
    fresh: read.filter((f) => f.processingMode !== "reused").length,
    text: read.filter((f) => f.readMethod === "text").length,
    vision: read.filter((f) => f.readMethod === "vision").length,
  };
}

// Compact read-method/cache summary shown on a log entry (both Option A and B).
// The full per-file detail stays one click away via the File Ledger link.
function ReadSummaryBadge({ ledger }: { ledger: AuditFileRecord[] }) {
  const s = summarizeLedger(ledger);
  if (!s) return null;
  // Each metric is its own segment in a flex row with a real gap, so the parts
  // never run together and wrap cleanly (as whole segments) on narrow widths —
  // regardless of how many files or how large the counts get.
  const seg: React.CSSProperties = { whiteSpace: "nowrap" };
  return (
    <span
      title="How this run's evidence was read — fresh vs cached, and text-extracted vs vision-transcribed. See 'Files read this run' under the Output tab for the full per-file detail."
      style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2, maxWidth: "100%", fontSize: 10, color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", lineHeight: 1.4 }}
    >
      <span style={seg}>📄 {s.read} file{s.read === 1 ? "" : "s"} read</span>
      <span style={seg}>{s.fresh} fresh</span>
      <span style={seg}>{s.cached} cached</span>
      {s.vision > 0 && <span style={seg}>{s.text} text</span>}
      {s.vision > 0 && <span style={seg}>{s.vision} vision</span>}
    </span>
  );
}

// Maps the internal review type to the app module/page the AI was used from,
// so the log reads in the user's terms ("Evidence Folder") rather than an
// internal category ("Evidence").
const MODULE_LABEL: Record<string, string> = {
  Evidence: "Evidence Folder",
  Scoring: "Evidence Intelligence",
  Checklist: "Sub-Criterion Checklist",
  Closure: "Quality Action / AFI",
  Finding: "Findings",
  Interview: "Interview",
  Finalisation: "Finalisation",
  CrossCriterion: "Final Report",
};
function moduleLabel(t: string): string {
  return MODULE_LABEL[t] || t;
}

// Rough USD price per 1,000,000 tokens (input / output), matched by model-name
// prefix. These are ESTIMATES for a ballpark spend figure — adjust here if
// OpenAI's pricing changes. Order matters: more specific patterns first.
const PRICING: { match: RegExp; in: number; out: number }[] = [
  { match: /gpt-5-nano/, in: 0.05, out: 0.4 },
  { match: /gpt-5-mini/, in: 0.25, out: 2 },
  { match: /gpt-5/, in: 1.25, out: 10 },
  { match: /gpt-4o-mini/, in: 0.15, out: 0.6 },
  { match: /gpt-4o/, in: 2.5, out: 10 },
  { match: /gpt-4\.1-nano/, in: 0.1, out: 0.4 },
  { match: /gpt-4\.1-mini/, in: 0.4, out: 1.6 },
  { match: /gpt-4\.1/, in: 2, out: 8 },
  { match: /gpt-4-turbo/, in: 10, out: 30 },
];
const DEFAULT_RATE = { in: 0.5, out: 1.5 };

function rateFor(model?: string) {
  if (!model) return DEFAULT_RATE;
  return PRICING.find((p) => p.match.test(model)) ?? DEFAULT_RATE;
}

// Estimated USD cost of one logged run. Analysis tokens are priced at the
// analysis model's rate; auxiliary (utility) tokens at the utility model's
// rate. For older log entries that only have a combined totalTokens (no split),
// we fall back to the analysis-model rate across the total — which was the old
// (slightly wrong) behaviour, preserved for backward compatibility.
function costOf(e: AIReviewLogEntry): number {
  const r = rateFor(e.model);
  const pt = e.promptTokens || 0;
  const ct = e.completionTokens || 0;
  const analysisCost = pt || ct
    ? (pt * r.in + ct * r.out) / 1e6
    : e.totalTokens && !e.auxTotalTokens
      ? (e.totalTokens * 0.75 * r.in + e.totalTokens * 0.25 * r.out) / 1e6
      : 0;
  const ar = rateFor(e.auxModel);
  const apt = e.auxPromptTokens || 0;
  const act = e.auxCompletionTokens || 0;
  const auxCost = apt || act
    ? (apt * ar.in + act * ar.out) / 1e6
    : e.auxTotalTokens
      ? (e.auxTotalTokens * 0.75 * ar.in + e.auxTotalTokens * 0.25 * ar.out) / 1e6
      : 0;
  return analysisCost + auxCost;
}

function fmtUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

import { FeedbackModal } from "../components/ui/FeedbackModal";

export function AIReview() {
  const log = useWorkspaceStore((s) => s.aiReviewLog);
  const clearAIReviewLog = useWorkspaceStore((s) => s.clearAIReviewLog);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const [reviewFeedback, setReviewFeedback] = useState<{ id: string; aiOutput: string; subjectId: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<Record<string, "output" | "prompt">>({});
  const [agentFilter, setAgentFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "tokens">("newest");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  // Date scope (yyyy-mm-dd; empty = open-ended). Applies to BOTH the cost
  // calculator and the rows, so a period's spend can be totalled.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Quick presets that set from/to relative to today.
  function applyPreset(days: number | "all" | "today") {
    if (days === "all") { setFromDate(""); setToDate(""); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (days === "today") { setFromDate(today); setToDate(today); return; }
    const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    setFromDate(from);
    setToDate(today);
  }

  // Distinct agents/types present, for the filter dropdowns.
  const agentOptions = useMemo(() => [...new Set(log.map((e) => e.agent))].sort(), [log]);
  const typeOptions = useMemo(() => [...new Set(log.map((e) => e.reviewType))].sort(), [log]);

  // File ledgers keyed by runId, from BOTH run types — Option B staged audits
  // (auditRunHistory / lastAuditRuns) and Option A evidence runs
  // (evidenceAssessments). Drives the inline "Files read this run" table on the
  // Output tab AND the per-run read-method/cache summary badge on each log entry.
  const auditRunHistory = useWorkspaceStore((s) => s.auditRunHistory);
  const lastAuditRuns = useWorkspaceStore((s) => s.lastAuditRuns);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const ledgerByRunId = useMemo(() => {
    const m = new Map<string, AuditFileRecord[]>();
    for (const runs of Object.values(auditRunHistory)) for (const r of runs) if (r.runId && r.fileLedger?.length) m.set(r.runId, r.fileLedger);
    for (const r of Object.values(lastAuditRuns)) if (r.runId && r.fileLedger?.length && !m.has(r.runId)) m.set(r.runId, r.fileLedger);
    for (const ev of Object.values(evidenceAssessments)) if (ev.runId && ev.fileLedger?.length && !m.has(ev.runId)) m.set(ev.runId, ev.fileLedger);
    return m;
  }, [auditRunHistory, lastAuditRuns, evidenceAssessments]);

  // Date-scoped log: the calculator AND the rows both work off this, so the
  // totals shown always match the selected period.
  const dateScoped = useMemo(
    () =>
      log.filter((e) => {
        const d = e.createdAt.slice(0, 10);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
      }),
    [log, fromDate, toDate]
  );

  // Agent/type/search filters + sort apply to the rows only (on top of the date scope).
  const visible = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    const rows = dateScoped.filter(
      (e) =>
        (!agentFilter || e.agent === agentFilter) &&
        (!typeFilter || e.reviewType === typeFilter) &&
        (!q ||
          (e.runId || "").toLowerCase().includes(q) ||
          (e.subjectId || "").toLowerCase().includes(q) ||
          (e.agent || "").toLowerCase().includes(q) ||
          (e.verdict || "").toLowerCase().includes(q) ||
          (e.reviewType || "").toLowerCase().includes(q) ||
          (e.model || "").toLowerCase().includes(q))
    );
    const sorted = [...rows];
    if (sortBy === "tokens") sorted.sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
    else sorted.sort((a, b) => (sortBy === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    return sorted;
  }, [dateScoped, agentFilter, typeFilter, searchFilter, sortBy]);

  // Reset to page 0 whenever the filtered/sorted set changes.
  useEffect(() => { setPage(0); }, [agentFilter, typeFilter, searchFilter, sortBy, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const stats = useMemo(() => {
    const total = dateScoped.length;
    const live = dateScoped.filter((e) => e.live).length;
    const failed = dateScoped.filter((e) => e.liveError).length;
    const byAgent: Record<string, number> = {};
    dateScoped.forEach((e) => {
      byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
    });
    // Token + cost roll-up across every run that reported usage. byModel keeps a
    // per-model breakdown, splitting analysis and utility model tokens so each
    // is priced at its own rate.
    let totalTokens = 0;
    let totalCost = 0;
    let trackedRuns = 0;
    const byModel: Record<string, { tokens: number; cost: number; runs: number }> = {};
    const addModelRow = (model: string | undefined, tok: number, cost: number, countRun: boolean) => {
      const key = model || "unknown";
      byModel[key] = byModel[key] || { tokens: 0, cost: 0, runs: 0 };
      byModel[key].tokens += tok;
      byModel[key].cost += cost;
      if (countRun) byModel[key].runs += 1;
    };
    dateScoped.forEach((e) => {
      if (!e.totalTokens) return;
      trackedRuns += 1;
      totalTokens += e.totalTokens;
      const cost = costOf(e);
      totalCost += cost;
      // For entries with a split, add analysis and utility separately.
      if (e.auxTotalTokens) {
        const analysisTok = (e.promptTokens || 0) + (e.completionTokens || 0) || (e.totalTokens - e.auxTotalTokens);
        const analysisCost = (() => { const r = rateFor(e.model); const pt = e.promptTokens || 0; const ct = e.completionTokens || 0; return pt || ct ? (pt * r.in + ct * r.out) / 1e6 : (analysisTok * 0.75 * r.in + analysisTok * 0.25 * r.out) / 1e6; })();
        const auxTok = e.auxTotalTokens;
        const auxCost = cost - analysisCost;
        addModelRow(e.model, analysisTok, analysisCost, true);
        addModelRow(e.auxModel, auxTok, auxCost, false);
      } else {
        addModelRow(e.model, e.totalTokens, cost, true);
      }
    });
    return { total, live, simulated: total - live, failed, byAgent, totalTokens, totalCost, trackedRuns, byModel };
  }, [dateScoped]);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>AI agent review log</h3>
        <button
          onClick={() => { if (confirm(`Clear all ${log.length} AI review log entries? This cannot be undone.`)) clearAIReviewLog(); }}
          disabled={log.length === 0}
          style={{ marginLeft: "auto", cursor: log.length === 0 ? "not-allowed" : "pointer", border: "1px solid #fca5a5", background: "#fef2f2", color: log.length === 0 ? "#fca5a5" : "#b91c1c", fontWeight: 700, padding: "5px 12px", borderRadius: 7, fontSize: 12 }}
        >
          Clear log
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 4 }}>
        Every AI agent run is logged here — Evidence Intelligence scoring, Sub-Criterion Checklist line generation, and AFI
        closure reviews. Agents assist, challenge and recommend; they never finalise a result. Runs are tagged
        <i> simulated</i> when produced by the offline rule-based engine and <i>live</i> when produced by a configured AI call.
        Click a row to see the full text the agent generated.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Pill s="neutral">{stats.total} total run{stats.total === 1 ? "" : "s"}</Pill>
        <Pill s="good">{stats.live} live call{stats.live === 1 ? "" : "s"}</Pill>
        <Pill s="medium">{stats.simulated} simulated</Pill>
        {stats.failed > 0 && <Pill s="critical">{stats.failed} live call{stats.failed === 1 ? "" : "s"} failed and fell back to simulation</Pill>}
      </div>
      {stats.total > 0 && (
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 14 }}>
          By agent: {Object.entries(stats.byAgent).map(([a, n]) => `${a} (${n})`).join(" · ")}
        </div>
      )}

      {/* Date scope for the cost calculator (and the rows). */}
      {log.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Period</span>
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, width: 150, padding: "5px 6px" }} />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>to</span>
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, width: 150, padding: "5px 6px" }} />
          {([["Today", "today"], ["7 days", 7], ["30 days", 30], ["All", "all"]] as const).map(([label, val]) => (
            <button
              key={label}
              onClick={() => applyPreset(val as number | "all" | "today")}
              style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px" }}
            >
              {label}
            </button>
          ))}
          {(fromDate || toDate) && (
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
              Scoped to {fromDate || "start"} → {toDate || "now"}
            </span>
          )}
        </div>
      )}

      {/* Token + cost calculator: a rough running spend estimate from the token
          counts the API reports per run, within the selected period. */}
      {stats.trackedRuns > 0 && (
        <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
            <b style={{ fontSize: 12.5, color: "#1e3a8a" }}>Token &amp; cost estimate</b>
            <span style={{ fontSize: 13 }}><b>{stats.totalTokens.toLocaleString()}</b> tokens</span>
            <span style={{ fontSize: 13 }}>≈ <b>{fmtUSD(stats.totalCost)}</b></span>
            <span style={{ fontSize: 11, color: "#64748b" }}>across {stats.trackedRuns} live run{stats.trackedRuns === 1 ? "" : "s"}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#475569", marginTop: 6 }}>
            {Object.entries(stats.byModel)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([m, v]) => `${m}: ${v.tokens.toLocaleString()} tok ≈ ${fmtUSD(v.cost)} (${v.runs} run${v.runs === 1 ? "" : "s"})`)
              .join("  ·  ")}
          </div>
          <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 5 }}>
            Rough estimate using public per-1M-token rates; actual billing is on your OpenAI account. Runs before this feature have no token data.
          </div>
        </div>
      )}

      {/* Legend: which of the two configured models runs which kind of work, so
          the Model column is self-explanatory. Set both in Settings → AI integration. */}
      <div style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: "#475569" }}>
        <b style={{ fontSize: 12, color: "#334155" }}>Which model runs what?</b> Two models are configured in <i>Settings → AI integration</i>:
        <div style={{ marginTop: 6 }}>
          <span style={{ fontWeight: 700, color: "#1e3a8a" }}>Analysis model</span> (use a smarter one, e.g. <code>gpt-5</code>) — the judgement work:
          audit verdicts, scoring &amp; banding, finding drafting, checklist generation, closure review, and cross-criterion analysis.
        </div>
        <div style={{ marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: "#15803d" }}>Utility model</span> (a cheaper one is fine, e.g. <code>gpt-5-nano</code>) — the mechanical work:
          reading evidence images, condensing long documents, and drafting link metadata.
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
          A folder audit can use both — the verdict on the Analysis model, plus image/condense steps on the Utility model. The Model column shows the Analysis model that did the main reasoning; the Tokens total includes every call.
        </div>
      </div>

      {log.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No AI reviews run yet.</p>}

      {log.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Filter</span>
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} style={{ ...inputStyle, width: 180, padding: "5px 6px" }}>
            <option value="">All agents</option>
            {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...inputStyle, width: 180, padding: "5px 6px" }}>
            <option value="">All modules</option>
            {typeOptions.map((t) => <option key={t} value={t}>{moduleLabel(t)}</option>)}
          </select>
          <input
            type="search"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search run ID, subject, agent…"
            style={{ ...inputStyle, width: 220, padding: "5px 6px" }}
          />
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 6 }}>Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ ...inputStyle, width: 150, padding: "5px 6px" }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="tokens">Most tokens</option>
          </select>
          {(agentFilter || typeFilter || searchFilter) && (
            <button onClick={() => { setAgentFilter(""); setTypeFilter(""); setSearchFilter(""); }} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px" }}>
              Clear
            </button>
          )}
          <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>{visible.length} result{visible.length === 1 ? "" : "s"} of {log.length} total</span>
        </div>
      )}

      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table style={{ tableLayout: "fixed", width: "100%", minWidth: 780 }}>
        <colgroup>
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "23%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr><th>Agent</th><th>Module</th><th>Subject</th><th>Summary</th><th>Model</th><th>Tokens</th><th>When</th></tr>
        </thead>
        <tbody>
          {pageRows.map((e) => {
            const open = expanded === e.id;
            return (
              <Fragment key={e.id}>
                <tr className="rowh" onClick={() => setExpanded(open ? null : e.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <b>{e.agent}</b>
                    {!e.live && <div style={{ fontSize: 10, color: e.liveError ? "#b23121" : "#9ca3af" }}>{e.liveError ? "live call failed — simulated" : "simulated"}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{moduleLabel(e.reviewType)}</td>
                  <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, overflow: "hidden", wordBreak: "break-word" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={e.subjectId}>{e.subjectId}</div>
                    {e.runId && <div style={{ fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }} title="Audit run id — matches the Evidence Folder result, checklist evidence and journal entry from this run.">{e.runId}</div>}
                    {e.runId && ledgerByRunId.has(e.runId) && (
                      <div style={{ marginTop: 3 }}><ReadSummaryBadge ledger={ledgerByRunId.get(e.runId)!} /></div>
                    )}
                  </td>
                  <td style={{ overflow: "hidden" }} title={e.verdict}><Pill s={verdictTone(e.verdict)}>{e.verdict.length > 34 ? e.verdict.slice(0, 34) + "…" : e.verdict}</Pill></td>
                  <td style={{ fontSize: 11, color: e.model ? "#334155" : "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.model || (e.live ? "live" : "offline")}>{e.model || (e.live ? "live" : "offline")}</td>
                  <td style={{ fontSize: 11, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.totalTokens ? (e.auxTotalTokens ? `Analysis (${e.model || "?"}): ${(e.promptTokens || 0) + (e.completionTokens || 0) || "?"} tok\nUtility (${e.auxModel || "?"}): ${e.auxTotalTokens} tok\nTotal: ${e.totalTokens} tok ≈ ${fmtUSD(costOf(e))}` : `${e.promptTokens ?? "?"} prompt + ${e.completionTokens ?? "?"} completion ≈ ${fmtUSD(costOf(e))}`) : undefined}>
                    {e.totalTokens ? `${e.totalTokens.toLocaleString()}${costOf(e) ? ` · ${fmtUSD(costOf(e))}` : ""}` : "—"}
                  </td>
                  <td style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {new Date(e.createdAt).toLocaleString()}
                    <span style={{ marginLeft: 6 }}>
                      <button onClick={(ev) => { ev.stopPropagation(); logHumanDecision({ module: "AI Review Log Feedback", subjectId: e.subjectId || e.id, aiOutput: e.verdict, humanDecision: "Accepted", changed: false, decisionType: "Accepted", reason: "" }); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, padding: "0 1px" }} title="Mark AI output as correct">👍</button>
                      <button onClick={(ev) => { ev.stopPropagation(); setReviewFeedback({ id: e.id, aiOutput: `${e.verdict}: ${e.generatedContent?.slice(0, 200) || ""}`, subjectId: e.subjectId || e.id }); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, padding: "0 1px" }} title="Mark AI output as incorrect">👎</button>
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={7} style={{ background: "#fbfcfe", padding: "10px 14px", fontSize: 12.5 }}>
                      {e.liveError && (
                        <div style={{ color: "#b23121", marginBottom: 8 }}>
                          <b>Live call failed:</b> {e.liveError}
                          <div style={{ color: "#6b7280", fontWeight: 400 }}>Fell back to the offline simulation engine for this run — check your API key/model in Settings.</div>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
                        {(["output", "prompt"] as const).map((tab) => {
                          const isActive = (expandedTab[e.id] ?? "output") === tab;
                          const disabled = tab === "prompt" && !e.promptSent;
                          return (
                            <button
                              key={tab}
                              disabled={disabled}
                              onClick={() => setExpandedTab((prev) => ({ ...prev, [e.id]: tab }))}
                              style={{ cursor: disabled ? "default" : "pointer", border: `1px solid ${isActive ? "#6366f1" : "#cbd5e1"}`, background: isActive ? "#eef2ff" : "#fff", borderRadius: 5, fontSize: 11, padding: "3px 10px", color: disabled ? "#cbd5e1" : isActive ? "#4338ca" : "#374151", fontWeight: isActive ? 600 : 400 }}
                            >
                              {tab === "output" ? "Output" : "Prompt Sent"}
                            </button>
                          );
                        })}
                        {/* The separate "View file ledger" deep-link was removed:
                            the full per-file detail is rendered inline below on the
                            Output tab ("Files read this run"), so the link was
                            redundant. */}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>
                        {(expandedTab[e.id] ?? "output") === "output"
                          ? (e.generatedContent || e.keyConcerns.join("\n"))
                          : (e.promptSent || "(prompt not captured for this run)")}
                      </div>
                      {/* Per-file read detail for this run, inline on the Output
                          tab — the full ledger (read method, cached, char count,
                          cited, expandable extracted text) without leaving the log. */}
                      {(expandedTab[e.id] ?? "output") === "output" && e.runId && ledgerByRunId.has(e.runId) && (
                        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>📄 Files read this run</div>
                          <FileLedger files={ledgerByRunId.get(e.runId)!} />
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      <FeedbackModal
        open={!!reviewFeedback}
        aiOutput={reviewFeedback?.aiOutput ?? ""}
        module="AI Review Log Feedback"
        onClose={() => setReviewFeedback(null)}
        onSubmit={(fb) => {
          if (!reviewFeedback) return;
          const memId = !fb.correct ? addCalibrationMemory({ module: "AI Review Log Feedback", subjectId: reviewFeedback.subjectId, context: reviewFeedback.aiOutput, aiOutput: reviewFeedback.aiOutput, staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: 0 }) : undefined;
          logHumanDecision({ module: "AI Review Log Feedback", subjectId: reviewFeedback.subjectId, aiOutput: reviewFeedback.aiOutput, humanDecision: fb.correction || "Rejected", changed: true, decisionType: "Overridden", reason: fb.reason, memoryId: memId ?? undefined });
          setReviewFeedback(null);
        }}
      />

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(0)}
            style={{ cursor: page === 0 ? "not-allowed" : "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px", color: page === 0 ? "#cbd5e1" : "#374151" }}
          >
            ««
          </button>
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            style={{ cursor: page === 0 ? "not-allowed" : "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px", color: page === 0 ? "#cbd5e1" : "#374151" }}
          >
            ‹ Prev
          </button>
          <span style={{ fontSize: 12, color: "#6b7280", padding: "0 4px" }}>
            Page {page + 1} of {totalPages}
            <span style={{ color: "#9ca3af", marginLeft: 6 }}>({page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length})</span>
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            style={{ cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px", color: page >= totalPages - 1 ? "#cbd5e1" : "#374151" }}
          >
            Next ›
          </button>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
            style={{ cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px", color: page >= totalPages - 1 ? "#cbd5e1" : "#374151" }}
          >
            »»
          </button>
        </div>
      )}
    </Card>
  );
}
