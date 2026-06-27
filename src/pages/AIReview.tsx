import { Fragment, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { AIReviewLogEntry } from "../types";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

function verdictTone(v: string) {
  return v === "Acceptable" ? "good" : v === "Partial" || v === "At risk" ? "medium" : v === "Pass" ? "good" : "critical";
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

// Estimated USD cost of one logged run from its token counts.
function costOf(e: AIReviewLogEntry): number {
  const r = rateFor(e.model);
  const pt = e.promptTokens || 0;
  const ct = e.completionTokens || 0;
  // If only a total is known, assume a typical ~75% prompt / 25% completion split.
  if (!pt && !ct && e.totalTokens) return (e.totalTokens * 0.75 * r.in + e.totalTokens * 0.25 * r.out) / 1e6;
  return (pt * r.in + ct * r.out) / 1e6;
}

function fmtUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function AIReview() {
  const log = useWorkspaceStore((s) => s.aiReviewLog);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"" | "live" | "simulated">("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "tokens">("newest");

  // Distinct agents/types present, for the filter dropdowns.
  const agentOptions = useMemo(() => [...new Set(log.map((e) => e.agent))].sort(), [log]);
  const typeOptions = useMemo(() => [...new Set(log.map((e) => e.reviewType))].sort(), [log]);

  // Filter + sort applied to the rows (the stats/calculator above stay on the
  // full log so totals don't jump around as you filter).
  const visible = useMemo(() => {
    const rows = log.filter(
      (e) =>
        (!agentFilter || e.agent === agentFilter) &&
        (!typeFilter || e.reviewType === typeFilter) &&
        (!sourceFilter || (sourceFilter === "live" ? e.live : !e.live))
    );
    const sorted = [...rows];
    if (sortBy === "tokens") sorted.sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
    else sorted.sort((a, b) => (sortBy === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    return sorted;
  }, [log, agentFilter, typeFilter, sourceFilter, sortBy]);

  const stats = useMemo(() => {
    const total = log.length;
    const live = log.filter((e) => e.live).length;
    const failed = log.filter((e) => e.liveError).length;
    const byAgent: Record<string, number> = {};
    log.forEach((e) => {
      byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
    });
    // Token + cost roll-up across every run that reported usage. byModel keeps a
    // per-model breakdown so the calculator shows which model drove the spend.
    let totalTokens = 0;
    let totalCost = 0;
    let trackedRuns = 0;
    const byModel: Record<string, { tokens: number; cost: number; runs: number }> = {};
    log.forEach((e) => {
      if (!e.totalTokens) return;
      trackedRuns += 1;
      totalTokens += e.totalTokens;
      const cost = costOf(e);
      totalCost += cost;
      const key = e.model || "unknown";
      byModel[key] = byModel[key] || { tokens: 0, cost: 0, runs: 0 };
      byModel[key].tokens += e.totalTokens;
      byModel[key].cost += cost;
      byModel[key].runs += 1;
    });
    return { total, live, simulated: total - live, failed, byAgent, totalTokens, totalCost, trackedRuns, byModel };
  }, [log]);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>AI agent review log</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
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

      {/* Token + cost calculator: a rough running spend estimate from the token
          counts the API reports per run. Live AI runs only — offline runs cost nothing. */}
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
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)} style={{ ...inputStyle, width: 130, padding: "5px 6px" }}>
            <option value="">Live + simulated</option>
            <option value="live">Live only</option>
            <option value="simulated">Simulated only</option>
          </select>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 6 }}>Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ ...inputStyle, width: 150, padding: "5px 6px" }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="tokens">Most tokens</option>
          </select>
          {(agentFilter || typeFilter || sourceFilter) && (
            <button onClick={() => { setAgentFilter(""); setTypeFilter(""); setSourceFilter(""); }} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px" }}>
              Clear
            </button>
          )}
          <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>Showing {visible.length} of {log.length}</span>
        </div>
      )}

      <table>
        <thead>
          <tr><th>Agent</th><th>Module</th><th>Subject</th><th>Summary</th><th>Model</th><th>Tokens</th><th>When</th></tr>
        </thead>
        <tbody>
          {visible.map((e) => {
            const open = expanded === e.id;
            return (
              <Fragment key={e.id}>
                <tr className="rowh" onClick={() => setExpanded(open ? null : e.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <b>{e.agent}</b>
                    {!e.live && <div style={{ fontSize: 10, color: e.liveError ? "#b23121" : "#9ca3af" }}>{e.liveError ? "live call failed — simulated" : "simulated"}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{moduleLabel(e.reviewType)}</td>
                  <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>
                    {e.subjectId}
                    {e.runId && <div style={{ fontSize: 10, color: "#64748b" }} title="Audit run id — matches the Evidence Folder result, checklist evidence and journal entry from this run.">{e.runId}</div>}
                  </td>
                  <td title={e.verdict}><Pill s={verdictTone(e.verdict)}>{e.verdict.length > 40 ? e.verdict.slice(0, 40) + "…" : e.verdict}</Pill></td>
                  <td style={{ fontSize: 11, color: e.model ? "#334155" : "#9ca3af", whiteSpace: "nowrap" }}>{e.model || (e.live ? "live" : "offline")}</td>
                  <td style={{ fontSize: 11, color: "#334155", whiteSpace: "nowrap" }} title={e.totalTokens ? `${e.promptTokens ?? "?"} prompt + ${e.completionTokens ?? "?"} completion ≈ ${fmtUSD(costOf(e))}` : undefined}>
                    {e.totalTokens ? `${e.totalTokens.toLocaleString()}${costOf(e) ? ` · ${fmtUSD(costOf(e))}` : ""}` : "—"}
                  </td>
                  <td style={{ fontSize: 11.5, color: "#9ca3af" }}>{new Date(e.createdAt).toLocaleString()}</td>
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
                      <div style={{ color: "#6b7280", marginBottom: 4 }}>Full generated content:</div>
                      <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>
                        {e.generatedContent || e.keyConcerns.join("\n")}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
