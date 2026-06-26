import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Bar } from "../components/ui/Bar";
import { GOLD, INK, TONE } from "../lib/theme";
import { auditEvidence, type EvidenceAuditFlag } from "../lib/evidenceAudit";
import { NAV } from "../nav";

export function Dashboard() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const saveAsNewVersion = useWorkspaceStore((s) => s.saveAsNewVersion);
  const loadDemoDataset = useWorkspaceStore((s) => s.loadDemoDataset);
  const auditorsCount = useWorkspaceStore((s) => s.auditors.length);
  const scored = useScored();
  const findings = useAllFindings();
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const [auditReport, setAuditReport] = useState<EvidenceAuditFlag[] | null>(null);

  const belowBand3 = scored.items.filter((i) => i.band < 3).length;
  const closures = useWorkspaceStore((s) => s.closures);
  const openCritical = findings.filter((a) => a.severity === "Critical" && (closures[a.id]?.human || "") !== "Accepted").length;
  const finalisationReady = scored.gatePass && scored.openAFIs === 0;

  // Mirrors the 6 numbered groups in nav.ts so the Dashboard guide and the
  // sidebar always describe the same workflow stages — one source of truth.
  const totalItems = scored.items.length;
  const evidenceAttached = scored.items.filter((i) => i.ev.drive || i.checklistOverride).length;
  const itemsScored = scored.items.filter((i) => i.started).length;
  const samplesRecorded = Object.values(checklistEntries).reduce((sum, e) => sum + e.specific.filter((l) => l.sampling).length, 0);
  const findingsClosed = findings.length - scored.openAFIs;

  function stepProgress(step: number): { label: string; pct: number | null } {
    switch (step) {
      case 1:
        return { label: auditorsCount > 0 ? `${auditorsCount} auditor(s) added` : "No auditors added yet", pct: auditorsCount > 0 ? 100 : 0 };
      case 2:
        return { label: `${evidenceAttached}/${totalItems} items have evidence attached`, pct: totalItems ? Math.round((evidenceAttached / totalItems) * 100) : 0 };
      case 3:
        return { label: `${itemsScored}/${totalItems} items scored`, pct: totalItems ? Math.round((itemsScored / totalItems) * 100) : 0 };
      case 4:
        return { label: samplesRecorded > 0 ? `${samplesRecorded} sample(s) recorded` : "Not started yet", pct: samplesRecorded > 0 ? 100 : 0 };
      case 5:
        return { label: findings.length ? `${findingsClosed}/${findings.length} findings closed` : "No findings raised yet", pct: findings.length ? Math.round((findingsClosed / findings.length) * 100) : null };
      case 6:
        return { label: finalisationReady ? "Ready to finalise" : "Blocked on gate / open AFIs", pct: finalisationReady ? 100 : 0 };
      default:
        return { label: "", pct: null };
    }
  }

  const workflowSteps = NAV.filter((g) => g.step != null);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
      <Card style={{ gridColumn: "1 / -1", background: INK, color: "#fff" }}>
        <div style={{ fontSize: 11.5, color: "#aeb8c7", textTransform: "uppercase", letterSpacing: 0.4 }}>Projected readiness (internal simulation)</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: GOLD }}>{scored.total}</span>
          <span style={{ color: "#aeb8c7" }}>/ 1000</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{scored.award}</div>
        <div style={{ fontSize: 12, color: scored.gatePass ? "#9fe0bd" : "#f4b3aa", marginTop: 4 }}>
          {scored.gatePass ? "Score gate met (4.2, 4.6, C5 at Band 3+)" : `Score gate NOT met: ${scored.gateFail.map((g) => g.id).join(", ")}`}
        </div>
        <div style={{ fontSize: 11, color: "#7e8da0", marginTop: 8 }}>Not an official SSG or EduTrust result. Placeholder scoring table pending UCC's official GD4 rubric.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={() => {
              if (confirm("Use demo data? This fills in evidence ratings, reviewer scores, closures, samples, interview prep and the management review pack with sample data, overwriting any existing entries in those fields.")) loadDemoDataset();
            }}
            style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: GOLD, fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
          >
            Use demo data
          </button>
          <button
            onClick={() => setAuditReport(auditEvidence(scored.items, checklistEntries))}
            style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: "#9fe0bd", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
          >
            Recheck all evidence
          </button>
        </div>
      </Card>

      <Card style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Getting started — the audit workflow</h3>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Work through these in order. Each step links to the matching section in the sidebar.
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {workflowSteps.map((g) => {
            const plainLabel = g.group.replace(/^\d+ · /, "");
            const progress = stepProgress(g.step!);
            return (
              <div key={g.group} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 99,
                      background: progress.pct === 100 ? TONE.good.bg : "#eef1f5",
                      color: progress.pct === 100 ? TONE.good.fg : "#475569",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {g.step}
                  </span>
                  <b style={{ fontSize: 13 }}>{plainLabel}</b>
                </div>
                <div style={{ fontSize: 11.5, color: "#6b7280", margin: "6px 0" }}>{g.hint}</div>
                {progress.pct != null && <Bar v={progress.pct} c={progress.pct === 100 ? TONE.good.fg : INK} />}
                <div style={{ fontSize: 12, marginTop: 4 }}>{progress.label}</div>
                <Link to={g.items[0].path} style={{ fontSize: 12, display: "inline-block", marginTop: 6 }}>
                  Open {g.items[0].label} →
                </Link>
              </div>
            );
          })}
        </div>
      </Card>

      {auditReport && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence recheck report</h3>
            <button onClick={() => setAuditReport(null)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#6b7280", fontSize: 12 }}>
              Close
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
            Report only — re-derives the same evidence gaps the scoring engine already caps bands for. Nothing on the workspace is changed by running this.
          </div>
          {auditReport.length === 0 ? (
            <p style={{ fontSize: 13, color: TONE.good.fg }}>No unverified-evidence items found — every band-carrying item has at least some evidence attached.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Source</th>
                  <th>Band</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {auditReport.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.id}</b> {f.title}
                    </td>
                    <td>
                      <Pill s="progress">{f.source}</Pill>
                    </td>
                    <td>
                      <Pill s={f.band <= 1 ? "critical" : "medium"}>Band {f.band}</Pill>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Draft status</div>
        <div style={{ marginTop: 6 }}>
          <Pill s="In Progress">{cycle.status}</Pill>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
          {cycle.version}
          <br />
          Saved: {cycle.lastSavedAt}
        </div>
        <button
          onClick={() => saveAsNewVersion("", "Quick save from dashboard")}
          style={{ marginTop: 8, cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
        >
          Save draft
        </button>
      </Card>

      <Card>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Risk alerts</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Items below Band 3: <b>{belowBand3}</b>
          <br />
          Open AFIs: <b>{scored.openAFIs}</b>
          <br />
          Open critical findings: <b style={{ color: openCritical ? TONE.critical.fg : TONE.good.fg }}>{openCritical}</b>
          <br />
          Score gate at risk: <b style={{ color: scored.gatePass ? TONE.good.fg : TONE.critical.fg }}>{scored.gateFail.length}</b>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Finalisation readiness</div>
        <div style={{ marginTop: 6 }}>
          <Pill s={finalisationReady ? "good" : "critical"}>{finalisationReady ? "Ready to finalise" : "Blocked"}</Pill>
        </div>
        <Link to="/finalisation" style={{ fontSize: 12, display: "inline-block", marginTop: 8 }}>
          Open finalisation checklist →
        </Link>
      </Card>

      <Card>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Management decisions</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Findings needing a leadership decision: <b>{findings.filter((f) => f.managementDecisionNeeded).length}</b>
        </div>
        <Link to="/management-review" style={{ fontSize: 12, display: "inline-block", marginTop: 8 }}>
          Open management review →
        </Link>
      </Card>
    </div>
  );
}
