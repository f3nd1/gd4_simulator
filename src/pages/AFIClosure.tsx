import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle, filterSelectStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { BLUE, TONE } from "../lib/theme";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";

export function AFIClosure() {
  const closures = useWorkspaceStore((s) => s.closures);
  const setClosureField = useWorkspaceStore((s) => s.setClosureField);
  const runClosureAI = useWorkspaceStore((s) => s.runClosureAI);
  const draftClosureActions = useWorkspaceStore((s) => s.draftClosureActions);
  const aiEnabled = useAISettingsStore((s) => s.enabled && !!s.apiKey);
  const setClosureHuman = useWorkspaceStore((s) => s.setClosureHuman);
  const busy = useWorkspaceStore((s) => s.busy);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  const scored = useScored();
  const allFindings = useAllFindings();
  const [selFinding, setSelFinding] = useState<string | null>(null);
  const [critFilter, setCritFilter] = useState<string>("All");
  const [subCritFilter, setSubCritFilter] = useState<string>("All");
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});

  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );

  const findings = allFindings.filter((f) => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
    if (critFilter !== "All" && req?.criterion !== critFilter) return false;
    if (subCritFilter !== "All" && req?.subCriterionId !== subCritFilter) return false;
    return true;
  });

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Quality Action / AFI closure</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {scored.openAFIs} of {allFindings.length} still open
        </span>
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
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#6b7280", minWidth: 38 }}>{f.gd4ItemId}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{f.issue}</span>
              <Pill s={f.severity === "Critical" || f.severity === "High" ? "critical" : f.severity === "Medium" ? "medium" : "neutral"}>{f.severity}</Pill>
              {c.human === "Accepted" ? (
                <Pill s="good">closed</Pill>
              ) : (
                c.ai && <Pill s={c.ai === "Acceptable" ? "good" : c.ai === "Partial" ? "medium" : "critical"}>{c.ai}</Pill>
              )}
            </button>
            {open && (
              <div style={{ padding: "0 14px 14px", background: "#fbfcfe" }}>
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
                  <button
                    onClick={() => setClosureHuman(f.id, c.human === "Accepted" ? "" : "Accepted")}
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
                    <b>Closure Reviewer · {c.ai}{c.live ? "" : " (simulated)"}:</b> {c.aiReason} {c.aiNeed && <i>Still needed: {c.aiNeed}</i>}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </Card>
  );
}
