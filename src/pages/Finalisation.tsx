import { useMemo } from "react";
import { CloseoutStepper } from "../components/ui/CloseoutStepper";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import { detectForensicFlags } from "../lib/forensicFlags";

export function Finalisation() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const lockCycle = useWorkspaceStore((s) => s.lockCycle);
  const scored = useScored();
  const findings = useAllFindings();
  const checklistEntries = useChecklistModuleStore((s) => s.entries);

  const criticalOpen = findings.filter((f) => f.severity === "Critical" && (closures[f.id]?.human || "") !== "Accepted");
  // Cat A = SSG regulatory breach — these are hard-blocking: the cycle must not
  // be locked until every Cat A finding is accepted or escalated.
  const catAOpen = findings.filter((f) => f.riskCategory === "A" && (closures[f.id]?.human || "") !== "Accepted");

  // Forensic check: out-of-period evidence is a compliance risk.
  const forensicFlags = useMemo(
    () => detectForensicFlags(checklistEntries, cycle.periodStart, cycle.periodEnd),
    [checklistEntries, cycle.periodStart, cycle.periodEnd]
  );
  const outOfPeriodFlag = forensicFlags.find((f) => f.type === "out-of-period");

  const checks: [string, boolean, string][] = [
    ["Audit cycle scope confirmed", !!cycle.scope?.trim(), "Define audit scope in Audit Cycle Setup."],
    ["Audit period defined (start and end dates)", !!(cycle.periodStart?.trim() && cycle.periodEnd?.trim()), "Set the audit cycle period start and end dates in Audit Cycle Setup."],
    ["Evidence folders created for all departments", folders.length > 0, "Create evidence folders in Evidence Folder Tracker."],
    ["All GD4 criteria scored", scored.items.every((i) => i.conf != null), "Confirm a score for every item in the GD4 Criterion Scorecard."],
    ["Score gate at Band 3+ on gate-sensitive items", scored.gatePass, "Resolve gate-sensitive items below Band 3."],
    ["No Cat A (SSG regulatory breach) findings open", catAOpen.length === 0, `Accept closure on all ${catAOpen.length} Cat A regulatory-breach finding(s) before locking. Cat A findings require management sign-off.`],
    ["All Critical findings closed or escalated", criticalOpen.length === 0, "Accept closure on Critical findings, or escalate them for leadership sign-off (handled outside this app)."],
    ["All AFIs / Improvement Actions accepted", scored.openAFIs === 0, "Accept closure on remaining findings in AFI Closure."],
    ["Human reviewer confirmed scores on overridden items", scored.items.every((i) => i.conf != null), "Confirm reviewer scores that differ from the AI suggestion."],
    ["No out-of-period evidence detected", !outOfPeriodFlag, outOfPeriodFlag ? `${outOfPeriodFlag.description} Review evidence dates before locking.` : ""],
    ["Cycle status is Ready for Management Review or Locked", cycle.status === "Ready for Management Review" || cycle.status === "Locked", "Move the cycle to Ready for Management Review in Draft Workspace."],
  ];

  const allPass = checks.every(([, pass]) => pass);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <CloseoutStepper />
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
