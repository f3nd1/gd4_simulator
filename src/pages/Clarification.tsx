import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { scopeIdForItem, scopeTitle } from "../lib/evidenceScope";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import type { EvidenceDriftCheck, Finding } from "../types";

// The scope an item's Option A run is stored under (item id for a split sub
// like 4.2, else the sub-criterion) — the same key runEvidenceAssessment uses.
function scopeOf(f: Finding): string {
  const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
  return scopeIdForItem(f.gd4ItemId, req?.subCriterionId ?? f.gd4ItemId);
}

function verdictPillState(v: string): "critical" | "medium" | "good" {
  if (v === "Met") return "good";
  if (v === "Partial") return "medium";
  return "critical";
}

// Clarification round: batch re-check open findings after evidence is added.
// Human-gated throughout — the user ticks findings and clicks; nothing fires on
// its own, and a resolved finding is never auto-closed (that stays in AFI).
export function Clarification() {
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const closures = useWorkspaceStore((s) => s.closures);
  const rounds = useWorkspaceStore((s) => s.clarificationRounds);
  const progress = useWorkspaceStore((s) => s.clarificationProgress);
  const busy = useWorkspaceStore((s) => s.busy);
  const runClarificationRound = useWorkspaceStore((s) => s.runClarificationRound);
  const checkEvidenceDrift = useWorkspaceStore((s) => s.checkEvidenceDrift);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drift, setDrift] = useState<Record<string, EvidenceDriftCheck>>({});
  const [checkingDrift, setCheckingDrift] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Open findings only (a finding is "open" when its closure is not Accepted —
  // the same rule the Findings page counts by). Seed/demo findings live outside
  // customFindings and are not re-checkable, so they never appear here.
  const openFindings = useMemo(
    () => customFindings.filter((f) => (closures[f.id]?.human || "") !== "Accepted" && f.status !== "Closed"),
    [customFindings, closures],
  );

  // Group by sub-criterion for a scannable round view.
  const groups = useMemo(() => {
    const map = new Map<string, { subCritId: string; findings: Finding[] }>();
    for (const f of openFindings) {
      const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
      const scId = req?.subCriterionId ?? f.gd4ItemId;
      if (!map.has(scId)) map.set(scId, { subCritId: scId, findings: [] });
      map.get(scId)!.findings.push(f);
    }
    return [...map.values()].sort((a, b) => a.subCritId.localeCompare(b.subCritId));
  }, [openFindings]);

  const running = progress !== null;
  const nextRoundNumber = rounds.length + 1;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const changedFindingIds = useMemo(
    () => openFindings.filter((f) => drift[scopeOf(f)]?.status === "changed").map((f) => f.id),
    [openFindings, drift],
  );

  function selectAllChanged() {
    setSelected(new Set(changedFindingIds));
  }

  // Advisory only: re-list each open finding's evidence folder and note which
  // changed since its last run. Never gates selection — a finding with no badge
  // (drift unknown / Drive not connected) stays fully tickable.
  async function checkDrift() {
    setCheckingDrift(true);
    const scopes = [...new Set(openFindings.map(scopeOf))];
    const next: Record<string, EvidenceDriftCheck> = {};
    for (const scope of scopes) {
      try { next[scope] = await checkEvidenceDrift(scope); }
      catch (e) { next[scope] = { status: "error", added: [], removed: [], modified: [], errorMessage: e instanceof Error ? e.message : String(e) }; }
    }
    setDrift(next);
    setCheckingDrift(false);
  }

  async function runRound() {
    setMsg(null);
    const r = await runClarificationRound([...selected]);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setSelected(new Set());
  }

  function driftBadge(f: Finding) {
    const d = drift[scopeOf(f)];
    if (!d) return null;
    if (d.status === "changed") return <Pill s="medium">Evidence changed</Pill>;
    if (d.status === "unchanged") return <span style={{ fontSize: 11, color: "#94a3b8" }}>no change</span>;
    return null; // error / unknown → no badge, still tickable
  }

  return (
    <div className="grid gap-3">
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Clarification round</h3>
        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.55, maxWidth: 760 }}>
          After the institution adds evidence for open findings, tick the ones to re-check and run them together as one round.
          Each item's evidence folder is re-read fresh and only the tied requirement line(s) are re-assessed. A resolved finding
          is <b>never closed automatically</b> — you decide closure in Quality Action / AFI. Runs one item at a time, so a round
          across several sub-criteria can take a while.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <button
            onClick={runRound}
            disabled={running || !!busy || selected.size === 0}
            style={{ cursor: running || !!busy || selected.size === 0 ? "not-allowed" : "pointer", opacity: running || !!busy || selected.size === 0 ? 0.5 : 1, border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            {running ? "Re-checking…" : `Re-check selected (Round ${nextRoundNumber}) — ${selected.size}`}
          </button>
          <button
            onClick={checkDrift}
            disabled={checkingDrift || running || openFindings.length === 0}
            title="Re-list each open finding's evidence folder and flag which changed since its last run (advisory only)"
            style={{ cursor: checkingDrift || running || openFindings.length === 0 ? "not-allowed" : "pointer", opacity: checkingDrift || running || openFindings.length === 0 ? 0.5 : 1, border: "1px solid #cbd5e1", background: "#fff", color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            {checkingDrift ? "Checking evidence…" : "Check for updated evidence"}
          </button>
          <button
            onClick={selectAllChanged}
            disabled={changedFindingIds.length === 0 || running}
            title="Tick every finding whose evidence folder changed since its last run"
            style={{ cursor: changedFindingIds.length === 0 || running ? "not-allowed" : "pointer", opacity: changedFindingIds.length === 0 || running ? 0.5 : 1, border: "1px solid #cbd5e1", background: "#fff", color: INK, fontWeight: 600, padding: "8px 14px", borderRadius: 8 }}
          >
            Select all changed ({changedFindingIds.length})
          </button>
          {selected.size > 0 && !running && (
            <button onClick={() => setSelected(new Set())} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#64748b", fontSize: 12.5, textDecoration: "underline" }}>
              Clear selection
            </button>
          )}
        </div>

        {running && (
          <div style={{ marginTop: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#1e3a8a" }}>
            Re-checking item {progress!.current} of {progress!.total} — <b>{scopeTitle(progress!.scope)}</b>. Working through each item's evidence folder one at a time; please wait.
          </div>
        )}
        {msg && !running && (
          <div style={{ marginTop: 12, background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: msg.ok ? "#166534" : "#991b1b" }}>
            {msg.text}
          </div>
        )}
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13.5 }}>Open findings ({openFindings.length})</h4>
        {openFindings.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No open findings to clarify. Raise findings on the Findings page first.</p>}
        {groups.map((g) => (
          <div key={g.subCritId} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, borderBottom: "2px solid #eef1f5", paddingBottom: 4, marginBottom: 6 }}>
              {g.subCritId} · {scopeTitle(g.subCritId)} <span style={{ color: "#94a3b8", fontWeight: 400 }}>({g.findings.length})</span>
            </div>
            {g.findings.map((f) => (
              <label key={f.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 4px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} disabled={running} style={{ marginTop: 3 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b style={{ fontSize: 12.5 }}>{f.id}</b>
                    <span style={{ fontSize: 11.5, color: "#64748b" }}>{f.clause || f.gd4ItemId}</span>
                    {driftBadge(f)}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#334155", marginTop: 2 }}>{f.issue}</div>
                </div>
              </label>
            ))}
          </div>
        ))}
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13.5 }}>Round history ({rounds.length})</h4>
        {rounds.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No rounds run yet.</p>}
        {rounds.map((r) => (
          <details key={r.id} style={{ borderBottom: "1px solid #eef1f5", padding: "8px 0" }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>
              <b>Round {r.roundNumber}</b> · {new Date(r.runAt).toLocaleString()} — {" "}
              <span style={{ color: "#166534" }}>{r.resolvedCount} resolved</span>, {" "}
              <span style={{ color: r.stillOpenCount > 0 ? "#991b1b" : "#64748b" }}>{r.stillOpenCount} still open</span>
              {" "}of {r.findingCount}
            </summary>
            <div style={{ paddingLeft: 14, marginTop: 6 }}>
              {r.findings.map((rf) => (
                <div key={rf.findingId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, padding: "3px 0" }}>
                  <span style={{ color: "#64748b" }}>{rf.clause || rf.gd4ItemId}</span>
                  <Pill s={verdictPillState(rf.before)}>{rf.before}</Pill>
                  <span style={{ color: "#94a3b8" }}>→</span>
                  <Pill s={verdictPillState(rf.after)}>{rf.after}</Pill>
                  {rf.resolved && <span style={{ fontSize: 11, color: "#166534" }}>resolved</span>}
                </div>
              ))}
              {r.blockers?.length ? (
                <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 4 }}>⚠ {r.blockers.length} item(s) could not be re-run: {r.blockers.join(" · ")}</div>
              ) : null}
              {r.skipped?.length ? (
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 4 }}>Skipped: {r.skipped.join(" · ")}</div>
              ) : null}
            </div>
          </details>
        ))}
      </Card>
    </div>
  );
}
