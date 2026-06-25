import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK, TONE, gateTone } from "../lib/theme";
import { FINDINGS } from "../data/findings";
import { CHECKLIST_LIB } from "../data/agents";

export function Dashboard() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);
  const scored = useScored();

  const belowBand3 = scored.items.filter((i) => i.band < 3).length;
  const closures = useWorkspaceStore((s) => s.closures);
  const openCritical = FINDINGS.filter((a) => a.severity === "Critical" && (closures[a.id]?.human || "") !== "Accepted").length;
  const finalisationReady = scored.gatePass && scored.checklistPass && scored.openAFIs === 0;

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
        <div style={{ fontSize: 12, color: scored.checklistPass ? "#9fe0bd" : "#f4b3aa" }}>
          {scored.checklistPass ? "Checklist gate passed" : `Checklist gate not passed (${scored.checklistDone}/${CHECKLIST_LIB.length} items done)`}
        </div>
        <div style={{ fontSize: 11, color: "#7e8da0", marginTop: 8 }}>Not an official SSG or EduTrust result. Placeholder scoring table pending UCC's official GD4 rubric.</div>
      </Card>

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
        <button onClick={saveDraft} style={{ marginTop: 8, cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}>
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
        <div style={{ fontSize: 12, color: "#6b7280" }}>Checklist gates by department</div>
        {scored.deptGates.map((d) => (
          <div key={d.dept} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 5 }}>
            <span>{d.dept}</span>
            <Pill s={gateTone(d.gate)}>{d.gate}</Pill>
          </div>
        ))}
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
          Findings needing a leadership decision: <b>{FINDINGS.filter((f) => f.managementDecisionNeeded).length}</b>
        </div>
        <Link to="/management-review" style={{ fontSize: 12, display: "inline-block", marginTop: 8 }}>
          Open management review →
        </Link>
      </Card>
    </div>
  );
}
