import { useEffect, useMemo, useState } from "react";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle, filterSelectStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { BLUE, TONE } from "../lib/theme";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { runScopesForSub, scopeTitle, scopeIdForItem } from "../lib/evidenceScope";
import { resolveFindingType, resolveNcSeverity, findingTypeTone, ncSeverityTone, isFindingOverdue } from "../lib/findingClassification";
import { PanelReviewSection } from "../components/ui/PanelReviewSection";
import type { ClosureFramework } from "../store/useWorkspaceStore";

const FRAMEWORKS: ClosureFramework[] = ["ISO 9001", "EduTrust"];

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
  const [effectivenessNotes, setEffectivenessNotes] = useState<Record<string, string>>({});
  const confirmClosureEffectiveness = useWorkspaceStore((s) => s.confirmClosureEffectiveness);
  const updateCustomFinding = useWorkspaceStore((s) => s.updateCustomFinding);
  const toggleClosureFramework = useWorkspaceStore((s) => s.toggleClosureFramework);
  const [closureFeedback, setClosureFeedback] = useState<{ id: string; aiOutput: string } | null>(null);

  // Split sub-criteria (only 4.2) list one option per item scope (4.2.1, 4.2.2)
  // so a finding for one item can be isolated — matching the Findings register
  // and the rest of the app (runScopesForSub / scopeIdForItem).
  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter))
      .flatMap((sc) => runScopesForSub(sc.id).map((scopeId) => ({ id: scopeId, title: scopeTitle(scopeId) }))),
    [critFilter]
  );

  // ?item=<gd4ItemId> deep link ("Manage closure →" on the Sub-Criterion
  // Checklist): pre-filter to that item's sub-criterion and expand + scroll to
  // its first finding, so the link lands where it claims to instead of on the
  // full unfiltered list. Runs once per param value; allFindings is
  // intentionally not a dep — re-running on every findings change would yank
  // the user back to the deep-linked row while they work.
  const [searchParams] = useSearchParams();
  const focusItem = searchParams.get("item");
  useEffect(() => {
    if (!focusItem) return;
    const req = GD4_REQUIREMENTS.find((r) => r.id === focusItem);
    if (req) {
      setCritFilter(req.criterion);
      setSubCritFilter(scopeIdForItem(req.id, req.subCriterionId));
    }
    const first = allFindings.find((f) => f.gd4ItemId === focusItem);
    if (first) {
      setSelFinding(first.id);
      setTimeout(() => document.getElementById(`closure-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItem]);

  const findings = allFindings.filter((f) => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
    if (critFilter !== "All" && req?.criterion !== critFilter) return false;
    if (subCritFilter !== "All" && (!req || scopeIdForItem(req.id, req.subCriterionId) !== subCritFilter)) return false;
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
          <Card key={f.id} id={`closure-${f.id}`} style={{ marginBottom: 9, padding: 0, overflow: "hidden", boxShadow: "none", border: "1px solid #e2e8f0" }}>
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
              {(() => {
                // Unified taxonomy: NC severity (Major/Minor), not the legacy
                // Critical/High/Medium severity scale — the type pill already
                // shows NC/OFI/OBS, so this pill only qualifies an NC.
                const sev = resolveFindingType(f) === "NC" ? resolveNcSeverity(f) : null;
                return sev ? <Pill s={ncSeverityTone(sev)}>{sev}</Pill> : null;
              })()}
              {isFindingOverdue(f.dueDate, c.human === "Accepted") && <Pill s="critical">⏰ Overdue</Pill>}
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
                {/* Owner + deadline — editable on the existing finding (was
                    set-once at creation and displayed nowhere). Overdue is
                    computed live from the due date, not a stored flag. */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
                  <label style={{ display: "block" }}>
                    <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Action owner</span>
                    <input
                      value={f.owner || ""}
                      placeholder="e.g. Registrar"
                      onChange={(e) => updateCustomFinding(f.id, { owner: e.target.value })}
                      style={{ ...inputStyle, marginTop: 3, width: 180, padding: "5px 8px", fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Target close date</span>
                    <input
                      type="date"
                      value={f.dueDate || ""}
                      onChange={(e) => updateCustomFinding(f.id, { dueDate: e.target.value })}
                      style={{ ...inputStyle, marginTop: 3, width: 160, padding: "5px 8px", fontSize: 12 }}
                    />
                  </label>
                  {isFindingOverdue(f.dueDate, c.human === "Accepted") && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c", paddingBottom: 6 }}>⏰ Past its target close date — still open</span>
                  )}
                </div>
                <PanelReviewSection finding={f} />
                {(() => {
                  // One field renderer, reused across the Plan/Do fields, the
                  // emphasised Act block, and the evidence field.
                  const fieldBox = (field: "root" | "containment" | "corr" | "prev" | "evid", label: string) => (
                    <label key={field} style={{ display: "block", marginBottom: 7 }}>
                      <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
                      <textarea
                        rows={2}
                        value={c[field] || ""}
                        onChange={(e) => setClosureField(f.id, field, e.target.value)}
                        style={{ ...inputStyle, resize: "vertical", marginTop: 3 }}
                      />
                    </label>
                  );
                  const actDone = !!c.corr?.trim();
                  return (
                    <>
                      {fieldBox("root", "Root cause (yours)")}
                      {fieldBox("containment", "Immediate correction (containment — what stopped the problem now)")}
                      {/* PDCA "Act" — the stage schools most often skip past.
                          Emphasised as the step that actually closes the loop:
                          the corrective action removes the cause, the preventive
                          action stops recurrence, and (below) effectiveness is
                          verified. Present ≠ done — this is the closing move. */}
                      <div style={{ border: `2px solid ${actDone ? "#15803d" : "#c9a24a"}`, borderRadius: 10, padding: "9px 11px", margin: "4px 0 9px", background: actDone ? "#f6fff9" : "#fffdf5" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: actDone ? "#15803d" : "#7a5c12", textTransform: "uppercase" }}>▶ Act — this closes the loop</span>
                          <span style={{ fontSize: 11, color: "#6b7280", flex: 1, minWidth: 200 }}>
                            The stage most often left half-done. A corrective action that removes the cause is what actually closes a finding — a containment alone does not. Effectiveness is verified after closure (below).
                          </span>
                          {!actDone && <Pill s="medium">not yet done</Pill>}
                        </div>
                        {fieldBox("corr", "Corrective action (what removes the cause)")}
                        {fieldBox("prev", "Preventive action (stops it recurring)")}
                      </div>
                      {fieldBox("evid", "Closure evidence (Drive link / record)")}
                      {/* ISO vs EduTrust coverage — the same evidence can satisfy
                          different documentation requirements; tag which so shared
                          docs aren't assumed to cover both. */}
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 9px" }}>
                        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Evidence satisfies:</span>
                        {FRAMEWORKS.map((fw) => {
                          const on = (c.frameworks || []).includes(fw);
                          return (
                            <button
                              key={fw}
                              onClick={() => toggleClosureFramework(f.id, fw)}
                              style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, border: on ? "1.5px solid #4f46e5" : "1px solid #e2e8f0", background: on ? "#eef2ff" : "#fff", color: on ? "#4f46e5" : "#94a3b8" }}
                            >
                              {on ? "✓ " : ""}{fw}
                            </button>
                          );
                        })}
                        <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Tag which framework(s) this closure evidence covers — untagged makes no claim.</span>
                      </div>
                    </>
                  );
                })()}
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
                  {(() => {
                    // ISO 9001 10.2 closure gate: root cause + corrective action +
                    // evidence, AND a stated reason when overriding a negative AI
                    // verdict. Mirrors the store guard in setClosureHuman.
                    const missing: string[] = [];
                    if (!c.root?.trim()) missing.push("root cause");
                    if (!c.corr?.trim()) missing.push("corrective action");
                    if (!c.evid?.trim()) missing.push("evidence link");
                    const contradictsAi = c.ai === "Maintain Finding" || c.ai === "Escalate";
                    if (contradictsAi && !(closureReasons[f.id] ?? "").trim()) missing.push(`override reason (AI said "${c.ai}")`);
                    const blocked = c.human !== "Accepted" && missing.length > 0;
                    return (
                      <>
                        <button
                          onClick={() => {
                            const reason = closureReasons[f.id] ?? "";
                            setClosureHuman(f.id, c.human === "Accepted" ? "" : "Accepted", reason);
                            if (c.human !== "Accepted") setClosureReasons((r) => ({ ...r, [f.id]: "" }));
                          }}
                          disabled={blocked}
                          title={blocked ? `Required before closing: ${missing.join(", ")}` : undefined}
                          style={{
                            cursor: blocked ? "not-allowed" : "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "7px 12px",
                            borderRadius: 8,
                            border: `1px solid ${TONE.good.fg}55`,
                            background: c.human === "Accepted" ? TONE.good.bg : "#fff",
                            color: blocked ? "#94a3b8" : TONE.good.fg,
                            opacity: blocked ? 0.6 : 1,
                          }}
                        >
                          {c.human === "Accepted" ? "Closed ✓" : "Accept closure"}
                        </button>
                        {blocked && (
                          <span style={{ fontSize: 11, color: "#b45309", alignSelf: "center" }}>Required: {missing.join(", ")}</span>
                        )}
                      </>
                    );
                  })()}
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
                {/* Closure verification record + post-closure effectiveness
                    review (ISO 9001 10.2.1(d)): a closure stays "pending
                    effectiveness" until someone confirms the action worked. */}
                {c.human === "Accepted" && (
                  <div style={{ marginTop: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                    <div style={{ color: "#475569" }}>
                      Closed by <b>{c.closedBy || "—"}</b>{c.closedAt ? ` on ${new Date(c.closedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}.
                    </div>
                    {c.effectivenessConfirmedAt ? (
                      <div style={{ color: TONE.good.fg, marginTop: 4 }}>
                        ✓ <b>Effectiveness confirmed</b> {new Date(c.effectivenessConfirmedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}{c.effectivenessNote ? ` — ${c.effectivenessNote}` : ""}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 5 }}>
                        <span style={{ color: "#b45309", fontWeight: 600 }}>
                          Pending effectiveness review{c.effectivenessDue ? ` — due ${new Date(c.effectivenessDue).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                        </span>
                        <input
                          placeholder="How was the action verified to work? (e.g. re-checked records for the next intake)"
                          value={effectivenessNotes[f.id] || ""}
                          onChange={(e) => setEffectivenessNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                          style={{ ...inputStyle, flex: 1, minWidth: 220, padding: "5px 8px", fontSize: 11.5 }}
                        />
                        <button
                          disabled={!(effectivenessNotes[f.id] || "").trim()}
                          onClick={() => { confirmClosureEffectiveness(f.id, effectivenessNotes[f.id] || ""); setEffectivenessNotes((n) => ({ ...n, [f.id]: "" })); }}
                          style={{ cursor: (effectivenessNotes[f.id] || "").trim() ? "pointer" : "not-allowed", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: `1px solid ${TONE.good.fg}55`, background: "#fff", color: (effectivenessNotes[f.id] || "").trim() ? TONE.good.fg : "#94a3b8" }}
                        >
                          Confirm effective
                        </button>
                      </div>
                    )}
                  </div>
                )}
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
