import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CloseoutStepper } from "../components/ui/CloseoutStepper";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import { detectForensicFlags } from "../lib/forensicFlags";
import { buildFinalReport } from "../lib/finalReport";
import { runConsistencyChecks, type ConsistencyIssue } from "../lib/consistencyChecker";
import type { Finding } from "../types";

// The engine's `ref` is a GD4 item id for most rules, a finding id for R2/R9,
// and a constants string for R8. Resolve every resolvable ref to its item so
// the row can link to /sub-criterion?item= (the item's home). Returns null for
// the R8 constants ref, which stays plain text.
function refToItemId(ref: string, findings: Finding[]): string | null {
  const m = ref.match(/\d+\.\d+\.\d+/);
  if (m) return m[0];
  const findingId = ref.split(",")[0].trim(); // R9 joins ids with ", "
  return findings.find((f) => f.id === findingId)?.gd4ItemId ?? null;
}

export function Finalisation() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const lockCycle = useWorkspaceStore((s) => s.lockCycle);
  const scored = useScored();
  const findings = useAllFindings();
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const apsrScale = useScoringConfigStore((s) => s.apsrScale);

  // The SAME report the Final Report page builds, reused so the consistency
  // check reads exactly what the report shows.
  const report = useMemo(
    () => buildFinalReport(scored, checklistEntries, findings, closures, apsrScale),
    [scored, checklistEntries, findings, closures, apsrScale]
  );
  // null until the button has been clicked (so the empty state only shows after a run).
  const [issues, setIssues] = useState<ConsistencyIssue[] | null>(null);

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

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Consistency check</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Runs a set of deterministic read-only checks for internal contradictions in the saved workspace (for example a band with no
          lines behind it, a finding that no longer matches its line, or truncated report text). It reads only and changes nothing.
        </p>
        <button
          onClick={() => setIssues(runConsistencyChecks({ entries: checklistEntries, findings, report, apsrScale }))}
          style={{ cursor: "pointer", border: "none", background: "#4f46e5", color: "#fff", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
        >
          Run consistency check
        </button>
        {issues !== null && (
          issues.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#15803d", fontWeight: 600, marginBottom: 0 }}>No consistency issues found.</p>
          ) : (
            <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
              {issues.map((issue, i) => {
                const itemId = refToItemId(issue.ref, findings);
                return (
                  <div key={i} style={{ padding: "8px 11px", fontSize: 12.5, borderTop: i === 0 ? "none" : "1px solid #eef2f7" }}>
                    <b style={{ color: INK }}>{issue.ruleId}</b>{" "}{issue.message}{" "}
                    {itemId ? (
                      <Link to={`/sub-checklist?item=${encodeURIComponent(itemId)}`} style={{ color: "#4f46e5", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                        Go to {itemId} &rarr;
                      </Link>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>({issue.ref})</span>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </Card>
    </div>
  );
}
