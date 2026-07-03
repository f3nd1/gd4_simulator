// Start Audit — the upfront, cycle-level choice of how much the AI does.
// Three selectable cards (Full auto / Hybrid / Manual); the choice persists
// with the workspace, is captured in version snapshots, and can be changed
// mid-cycle. The per-sub-criterion Option A/B path is chosen later, on
// Evidence Folder.

import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { AUDIT_MODES } from "../lib/runModes";
import { Card } from "../components/ui/Card";
import { NextStepBanner, Walkthrough, WalkthroughLink, useTip } from "../components/ui/Guidance";
import { nextStepText } from "../lib/guidanceText";
import { checkAuditorForRun, runAuditorDisplay, panelUnderMinNotice, AUDITOR_CREATION_PATH } from "../lib/auditorGuard";
import type { AuditMode } from "../types";

const WALKTHROUGH_STEPS = [
  { targetId: "wt-mode-cards", title: "Pick your mode here", body: "This one choice sets how much the AI does for the whole audit cycle. You can change it any time and carry on where you left off." },
  { targetId: "wt-mode-cards", title: "What each mode does", body: "Full auto runs and commits everything for you. Hybrid stops at every verdict for your approval. Manual leaves every decision to you, with AI suggestions on request." },
  { targetId: "wt-continue", title: "Continue here", body: "Once your mode is set, continue to Evidence Folder to link each sub-criterion's Drive folders and start assessing." },
];

export function StartAudit() {
  const auditMode = useWorkspaceStore((s) => s.auditMode);
  const setAuditMode = useWorkspaceStore((s) => s.setAuditMode);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const activeAuditorId = useWorkspaceStore((s) => s.activeAuditorId);
  const reviewPanelMode = useWorkspaceStore((s) => s.reviewPanelMode);
  const reviewPanelAuditorIds = useWorkspaceStore((s) => s.reviewPanelAuditorIds);
  const tip = useTip();

  const guard = checkAuditorForRun(auditors, activeAuditorId);
  const auditorDisplay = runAuditorDisplay(auditors, activeAuditorId);
  const panelNotice = panelUnderMinNotice(reviewPanelMode, auditors, reviewPanelAuditorIds);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Walkthrough pageId="start-audit" steps={WALKTHROUGH_STEPS} />
      <NextStepBanner text={nextStepText("start-audit", { mode: auditMode })} />

      {/* Blocking guard — Full auto (and every other run) refuses to start
          without a named auditor; say so here, before the user even leaves
          this page. */}
      {!guard.ok && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "#fbe7e3", border: "1px solid #f2b8ae", borderRadius: 10, fontSize: 12.5, color: "#b23121", fontWeight: 600 }}>
          <span aria-hidden>⛔</span>
          <span style={{ flex: 1, minWidth: 240 }}>{guard.message}</span>
          <Link to={AUDITOR_CREATION_PATH} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b23121", borderRadius: 6, padding: "5px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
            Go to Auditor Creation →
          </Link>
        </div>
      )}
      {panelNotice && (
        <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px" }}>
          ⚠ {panelNotice} <Link to={AUDITOR_CREATION_PATH} style={{ color: "#2563eb" }}>Auditor Creation</Link>
        </div>
      )}

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Start Audit — choose how much the AI does</h3>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, ...(auditorDisplay.unassigned ? { color: "#b23121", background: "#fbe7e3", border: "1px solid #f2b8ae" } : { color: "#1f7a4d", background: "#e3f3ea", border: "1px solid #bfe3cf" }) }}>
            Runs as: {auditorDisplay.unassigned ? "⚠ " : ""}{auditorDisplay.text}
          </span>
          <span style={{ marginLeft: "auto" }}><WalkthroughLink pageId="start-audit" /></span>
        </div>
        <p style={{ fontSize: 12.5, color: "#6b7280", margin: "6px 0 14px" }}>
          One choice for the whole cycle. You can change it at any time and your work carries over. The Option A/B
          analysis path is a separate, per-sub-criterion choice made on Evidence Folder.
        </p>

        <div id="wt-mode-cards" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {AUDIT_MODES.map((m) => {
            const selected = auditMode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setAuditMode(m.value as AuditMode)}
                title={tip(`${m.desc} ${m.best}`)}
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  border: `2px solid ${selected ? "#7c3aed" : "#e2e8f0"}`,
                  background: selected ? "#faf5ff" : "#fff",
                  borderRadius: 14,
                  padding: "16px 16px 14px",
                  boxShadow: selected ? "0 4px 14px rgba(124,58,237,0.15)" : "none",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
              >
                <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden>{m.icon}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: selected ? "#5b21b6" : "#0f172a" }}>{m.label}</span>
                  {selected && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#7c3aed", borderRadius: 999, padding: "2px 8px" }}>Selected</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5, marginBottom: 4 }}>{m.desc}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>{m.best}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <Link
            id="wt-continue"
            to="/evidence-folder"
            title={tip("Next step: link each sub-criterion's Drive folders, then run the audit in your chosen mode")}
            style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "#7c3aed", border: "1px solid #7c3aed", borderRadius: 8, padding: "8px 18px", textDecoration: "none" }}
          >
            Continue to Evidence Folder →
          </Link>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Current mode: <b>{AUDIT_MODES.find((m) => m.value === auditMode)?.label}</b>
          </span>
        </div>
      </Card>
    </div>
  );
}
