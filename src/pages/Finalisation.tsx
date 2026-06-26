import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";

export function Finalisation() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const managementReviewItems = useWorkspaceStore((s) => s.managementReviewItems);
  const lockCycle = useWorkspaceStore((s) => s.lockCycle);
  const scored = useScored();
  const findings = useAllFindings();

  const criticalOpen = findings.filter((f) => f.severity === "Critical" && (closures[f.id]?.human || "") !== "Accepted");
  const decisionsOutstanding = managementReviewItems.filter((m) => m.decisionNeeded && !m.decision);
  const checks: [string, boolean, string][] = [
    ["Audit cycle scope confirmed", !!cycle.scope?.trim(), "Define audit scope in Audit Cycle Setup."],
    ["Evidence folders created for all departments", folders.length > 0, "Create evidence folders in Evidence Folder Tracker."],
    ["All GD4 criteria scored", scored.items.every((i) => i.conf != null), "Confirm a score for every item in the GD4 Criterion Scorecard."],
    ["Score gate at Band 3+ on gate-sensitive items", scored.gatePass, "Resolve gate-sensitive items below Band 3."],
    ["All Critical findings closed or escalated", criticalOpen.length === 0, "Accept closure on Critical findings or escalate via Management Review."],
    ["All AFIs / Improvement Actions accepted", scored.openAFIs === 0, "Accept closure on remaining findings in AFI Closure."],
    ["Human reviewer confirmed scores on overridden items", scored.items.every((i) => i.conf != null), "Confirm reviewer scores that differ from the AI suggestion."],
    ["Management review decisions recorded", decisionsOutstanding.length === 0, "Record decisions for items requiring management decision."],
    ["Cycle status is Ready for Management Review or Locked", cycle.status === "Ready for Management Review" || cycle.status === "Locked", "Move the cycle to Ready for Management Review in Draft Workspace."],
  ];

  const allPass = checks.every(([, pass]) => pass);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Finalisation checklist</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Confirms the cycle is complete before the final version is locked. This checklist is an internal workflow gate — it does
          not constitute an official EduTrust assessment result.
        </p>
        <table>
          <thead><tr><th>Check</th><th>Status</th><th>If blocked</th></tr></thead>
          <tbody>
            {checks.map(([label, pass, hint]) => (
              <tr key={label} className="rowh">
                <td style={{ fontSize: 12.5 }}>{label}</td>
                <td><Pill s={pass ? "good" : "critical"}>{pass ? "Met" : "Blocked"}</Pill></td>
                <td style={{ fontSize: 12, color: "#6b7280" }}>{pass ? "—" : hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Lock final version</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Locking sets the cycle status to <b>Locked</b> and records a new version history entry. Locked versions should be
          unlocked from Draft Workspace before further edits.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            disabled={!allPass || cycle.status === "Locked"}
            onClick={lockCycle}
            style={{
              cursor: !allPass || cycle.status === "Locked" ? "not-allowed" : "pointer",
              border: "none",
              background: !allPass || cycle.status === "Locked" ? "#e2e8f0" : GOLD,
              color: !allPass || cycle.status === "Locked" ? "#94a3b8" : INK,
              fontWeight: 700,
              padding: "8px 14px",
              borderRadius: 8,
            }}
          >
            {cycle.status === "Locked" ? "Already locked" : "Lock final version"}
          </button>
          <Pill s={cycle.status === "Locked" ? "good" : allPass ? "medium" : "critical"}>
            {cycle.status === "Locked" ? "Locked" : allPass ? "Ready to lock" : "Not ready"}
          </Pill>
        </div>
      </Card>
    </div>
  );
}
