import { useMemo, useState } from "react";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle, filterSelectStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { BLUE, TONE } from "../lib/theme";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { resolveFindingType, findingTypeTone } from "../lib/findingClassification";
import { PanelReviewSection } from "../components/ui/PanelReviewSection";

export function AFIClosure() {
  const closures = useWorkspaceStore((s) => s.closures);
  const setClosureField = useWorkspaceStore((s) => s.setClosureField);
  const runClosureAI = useWorkspaceStore((s) => s.runClosureAI);
  const draftClosureActions = useWorkspaceStore((s) => s.draftClosureActions);
  const aiEnabled = useAISettingsStore((s) => s.enabled && !!s.apiKey);
  const setClosureHuman = useWorkspaceStore((s) => s.setClosureHuman);
  const removeCustomFinding = useWorkspaceStore((s) => s.removeCustomFinding);
  const clearAllClosures = useWorkspaceStore((s) => s.clearAllClosures);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const busy = useWorkspaceStore((s) => s.busy);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  const scored = useScored();
  const allFindings = useAllFindings();
  const [selFinding, setSelFinding] = useState<string | null>(null);
  const [critFilter, setCritFilter] = useState<string>("All");
  const [subCritFilter, setSubCritFilter] = useState<string>("All");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [closureReasons, setClosureReasons] = useState<Record<string, string>>({});
  const [closureFeedback, setClosureFeedback] = useState<{ id: string; aiOutput: string } | null>(null);

  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );

  const findings = allFindings.filter((f) => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
    if (critFilter !== "All" && req?.criterion !== critFilter) return false;
    if (subCritFilter !== "All" && req?.subCriterionId !== subCritFilter) return false;
    if (dateFilter !== "all" && f.createdAt) {
      const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 90;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      if (new Date(f.createdAt).getTime() < cutoff) return false;
    }
    return true;
  });

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <Link to="/findings" style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}>
          ← Findings register
        </Link>
        <Link to="/sub-checklist" style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
          ← Sub-Criterion Checklist
        </Link>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Quality Action / AFI closure</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {scored.openAFIs} of {allFindings.length} still open
        </span>
        {findings.length > 0 && (
          <button
            onClick={() => { if (confirm(`Clear all closure decisions for ${findings.length} finding${findings.length !== 1 ? "s" : ""}? The findings themselves are kept. This cannot be undone.`)) clearAllClosures(); }}
            style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 700, padding: "5px 11px", borderRadius: 8, fontSize: 12 }}
          >
            Clear closures
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <select
          value={critFilter}
          onChange={(e) => {
            setCritFilter(e.target.value);
            setSubCritFilter("All");
          }}
          style={filterSelectStyle}
        >
          <option value="All">All criteria</option>
          {GD4_CRITERIA.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} — {c.title}
            </option>
          ))}
        </select>
        <select value={subCritFilter} onChange={(e) => setSubCritFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All sub-criteria</option>
          {subCritOptions.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.id} — {sc.title}
            </option>
          ))}
        </select>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as "all" | "7d" | "30d" | "90d")} style={filterSelectStyle}>
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>
      {seedFindingsLoaded && (
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 10 }}>
          Includes findings carried over from the loaded demo dataset.
        </div>
      )}
      {findings.map((f) => {
        const c = closures[f.id] || {};
        const open = selFinding === f.id;
        return (
          <Card key={f.id} style={{ marginBottom: 9, padding: 0, overflow: "hidden", boxShadow: "none", border: "1px solid #e2e8f0" }}>
            <button
              className="rowh"
              onClick={() => setSelFinding(open ? null : f.id)}
              style={{ width: "100%", cursor: "pointer", border: "none", background: "transparent", font: "inherit", padding: "11px 14px", display: "flex", gap: 10, alignItems: "center", textAlign: "left" }}
            >
              <b style={{ color: "#ce9e5d", minWidth: 30 }}>{f.id}</b>
              <Pill s={findingTypeTone(resolveFindingType(f))}>{resolveFindingType(f)}</Pill>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#6b7280", minWidth: 38 }}>{f.gd4ItemId}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{f.issue}</span>
              {f.createdAt && <span style={{ fontSize: 10.5, color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>{new Date(f.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
              <Pill s={f.severity === "Critical" || f.severity === "High" ? "critical" : f.severity === "Medium" ? "medium" : "neutral"}>{f.severity}</Pill>
              {c.human === "Accepted" ? (
                <Pill s="good">closed</Pill>
              ) : (
                c.ai && <Pill s={c.ai === "Acceptable" ? "good" : c.ai === "Partial" ? "medium" : "critical"}>{c.ai}</Pill>
              )}
            </button>
            {open && (
              <div style={{ padding: "0 14px 14px", background: "#fbfcfe" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, paddingTop: 10, borderTop: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                  <Link to={`/findings?item=${f.gd4ItemId}`} style={{ fontSize: 11.5, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "3px 9px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}>
                    ← View in Findings
                  </Link>
                  {f.linkedChecklistLineIds?.length ? (
                    <Link to={`/sub-checklist?item=${f.gd4ItemId}`} style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 600, textDecoration: "none", padding: "3px 9px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                      ← Checklist ({f.gd4ItemId})
                    </Link>
                  ) : null}
                </div>
                <PanelReviewSection finding={f} />
                {([
                  ["root", "Root cause (yours)"],
                  ["corr", "Corrective action"],
                  ["prev", "Preventive action"],
                  ["evid", "Closure evidence (Drive link / record)"],
                ] as const).map(([field, label]) => (
                  <label key={field} style={{ display: "block", marginBottom: 7 }}>
                    <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
                    <textarea
                      rows={2}
                      value={c[field] || ""}
                      onChange={(e) => setClosureField(f.id, field, e.target.value)}
                      style={{ ...inputStyle, resize: "vertical", marginTop: 3 }}
                    />
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {aiEnabled && (
                    <>
                      <button
                        onClick={async () => {
                          setDraftErrors((e) => { const n = { ...e }; delete n[f.id]; return n; });
                          try {
                            await draftClosureActions(f.id, f.issue, f.gd4ItemId);
                          } catch {
                            setDraftErrors((e) => ({ ...e, [f.id]: "AI draft failed — check your API key in Settings, or try again." }));
                          }
                        }}
                        disabled={busy === "clxdraft" + f.id}
                        title="AI drafts root cause + corrective + preventive action for you to edit. Won't overwrite fields you've already filled."
                        style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid #c9a24a", background: "#fbf3df", color: "#7a5c12" }}
                      >
                        {busy === "clxdraft" + f.id ? "Drafting…" : "Suggest actions (AI)"}
                      </button>
                      {draftErrors[f.id] && (
                        <span style={{ fontSize: 11.5, color: "#b23121", alignSelf: "center" }}>{draftErrors[f.id]}</span>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => runClosureAI(f.id)}
                    disabled={busy === "clx" + f.id}
                    style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: `1px solid ${BLUE}`, background: TONE.progress.bg, color: TONE.progress.fg }}
                  >
                    {busy === "clx" + f.id ? "Reviewing…" : "AI closure review"}
                  </button>
                  {/* Reason input — shown when AI has a conflicting verdict */}
                  {c.ai && c.human !== "Accepted" && (
                    <input
                      placeholder="Reason for override (required when overriding AI verdict)"
                      value={closureReasons[f.id] || ""}
                      onChange={(e) => setClosureReasons((r) => ({ ...r, [f.id]: e.target.value }))}
                      style={{ ...inputStyle, width: 260, padding: "5px 8px", fontSize: 11.5 }}
                    />
                  )}
                  <button
                    onClick={() => {
                      const reason = closureReasons[f.id] ?? "";
                      setClosureHuman(f.id, c.human === "Accepted" ? "" : "Accepted", reason);
                      if (c.human !== "Accepted") setClosureReasons((r) => ({ ...r, [f.id]: "" }));
                    }}
                    disabled={c.human !== "Accepted" && !c.evid?.trim()}
                    title={c.human !== "Accepted" && !c.evid?.trim() ? "Add a closure evidence link before accepting" : undefined}
                    style={{
                      cursor: c.human !== "Accepted" && !c.evid?.trim() ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: `1px solid ${TONE.good.fg}55`,
                      background: c.human === "Accepted" ? TONE.good.bg : "#fff",
                      color: c.human !== "Accepted" && !c.evid?.trim() ? "#94a3b8" : TONE.good.fg,
                      opacity: c.human !== "Accepted" && !c.evid?.trim() ? 0.6 : 1,
                    }}
                  >
                    {c.human === "Accepted" ? "Closed ✓" : "Accept closure"}
                  </button>
                  {c.human !== "Accepted" && !c.evid?.trim() && (
                    <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Evidence link required to close</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {confirmDeleteId === f.id ? (
                    <>
                      <button onClick={() => { removeCustomFinding(f.id); setConfirmDeleteId(null); setSelFinding(null); }} style={{ fontSize: 11, color: "#fff", background: "#ef4444", border: "none", borderRadius: 4, padding: "2px 7px", cursor: "pointer", marginRight: 4 }}>Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11, color: "#6b7280", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(f.id)} style={{ fontSize: 11, color: "#94a3b8", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>Remove finding</button>
                  )}
                </div>
                {c.ai && (
                  <div
                    style={{
                      marginTop: 8,
                      background: c.ai === "Acceptable" ? TONE.good.bg : c.ai === "Partial" ? TONE.medium.bg : TONE.critical.bg,
                      borderRadius: 8,
                      padding: "8px 11px",
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <span style={{ flex: 1 }}><b>Closure Reviewer · {c.ai}{c.live ? "" : " (simulated)"}:</b> {c.aiReason} {c.aiNeed && <i>Still needed: {c.aiNeed}</i>}</span>
                      <button onClick={() => logHumanDecision({ module: "AFI Closure", subjectId: f.id, aiOutput: `${c.ai}: ${c.aiReason}`, humanDecision: "Accepted", changed: false, decisionType: "Accepted", reason: "" })} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }} title="Accept AI verdict">👍</button>
                      <button onClick={() => setClosureFeedback({ id: f.id, aiOutput: `${c.ai}: ${c.aiReason || ""}` })} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }} title="Reject AI verdict">👎</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
      <FeedbackModal
        open={!!closureFeedback}
        aiOutput={closureFeedback?.aiOutput ?? ""}
        module="AFI Closure"
        onClose={() => setClosureFeedback(null)}
        onSubmit={(fb) => {
          if (!closureFeedback) return;
          const memId = !fb.correct ? addCalibrationMemory({ module: "AFI Closure", subjectId: closureFeedback.id, context: closureFeedback.aiOutput, aiOutput: closureFeedback.aiOutput, staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: 0 }) : undefined;
          logHumanDecision({ module: "AFI Closure", subjectId: closureFeedback.id, aiOutput: closureFeedback.aiOutput, humanDecision: fb.correction || "Rejected", changed: true, decisionType: "Overridden", reason: fb.reason, memoryId: memId ?? undefined });
          setClosureFeedback(null);
        }}
      />
    </Card>
  );
}
