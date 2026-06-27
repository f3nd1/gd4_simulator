import { useMemo } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";

export function ExportCentre() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const closures = useWorkspaceStore((s) => s.closures);
  const exportLog = useWorkspaceStore((s) => s.exportLog);
  const addExportLogEntry = useWorkspaceStore((s) => s.addExportLogEntry);
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const scored = useScored();
  const findings = useAllFindings();

  // Items with band ≥ 1 via checklist but NO evidence attached to any specific
  // line — scored but completely unverifiable. These must be flagged in exports.
  const zeroEvidenceItems = useMemo(() => {
    return scored.items
      .filter((item) => item.checklistOverride)
      .filter((item) => {
        const entry = checklistEntries[item.id];
        if (!entry) return false;
        return entry.specific.every((line) => line.evidence.length === 0);
      })
      .map((item) => item.id);
  }, [scored.items, checklistEntries]);

  function exportPack() {
    let md = `# Management Review Pack — ${cycle.name}\n\n${cycle.periodStart} to ${cycle.periodEnd} · ${cycle.version} · ${cycle.status}\n\n`;
    if (zeroEvidenceItems.length > 0) {
      md += `## ⚠ WARNING — Unverified scored items\n\n**${zeroEvidenceItems.length} sub-criterion/criteria are scored via the checklist but have NO evidence attached to any specific line: ${zeroEvidenceItems.join(", ")}.**\n\nBands for these items are based solely on self-reported checklist status with no supporting documents. EduTrust assessors will not accept these scores without evidence. Attach evidence before submitting.\n\n`;
    }
    md += `## Readiness\nProjected ${scored.total}/1000 — ${scored.award}\nScore gate (4.2, 4.6, C5): ${scored.gatePass ? "met" : "NOT met (" + scored.gateFail.map((g) => g.id).join(", ") + ")"}\n\n`;
    md += `## Criterion scores\n` + scored.crits.map((c) => `- C${c.id} ${c.title}: Band ${c.band}, ${c.scored}/${c.points}`).join("\n") + "\n\n";
    md +=
      `## Open findings (${scored.openAFIs})\n` +
      findings.filter((a) => (closures[a.id]?.human || "") !== "Accepted")
        .map((a) => `- ${a.id} (${a.gd4ItemId}) ${a.type}/${a.severity}: ${a.issue}`)
        .join("\n") +
      "\n\n";
    md += `_Internal simulation. Band over 5 times criterion points. Not an official SSG result._\n`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "GD4_Management_Pack.md";
    a.click();
    URL.revokeObjectURL(url);
    addExportLogEntry({
      id: `EXP-${Date.now()}`,
      auditCycleId: cycle.id,
      exportName: "GD4_Management_Pack.md",
      format: "Markdown",
      exportedAt: new Date().toLocaleString(),
      exportedBy: cycle.owner,
    });
  }

  function csvCell(v: string) {
    return `"${v.replace(/"/g, '""')}"`;
  }

  function exportFindingsCsv() {
    const header = ["ID", "GD4 item", "Issue", "Type", "Severity", "Owner", "Due date", "Status"];
    const rows = findings.map((f) => [
      f.id,
      f.gd4ItemId,
      f.issue,
      f.type,
      f.severity,
      f.owner,
      f.dueDate,
      (closures[f.id]?.human || "") === "Accepted" ? "Closed" : "Open",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "GD4_Findings.csv";
    a.click();
    URL.revokeObjectURL(url);
    addExportLogEntry({
      id: `EXP-${Date.now()}`,
      auditCycleId: cycle.id,
      exportName: "GD4_Findings.csv",
      format: "CSV",
      exportedAt: new Date().toLocaleString(),
      exportedBy: cycle.owner,
    });
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Export centre</h3>
        <p style={{ fontSize: 13 }}>
          Projected <b>{scored.total}/1000</b> — {scored.award}
        </p>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          Score gate {scored.gatePass ? "met" : "not met"} · Open findings {scored.openAFIs}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button
            onClick={exportPack}
            style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Export management pack (Markdown)
          </button>
          <button
            onClick={exportFindingsCsv}
            style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Export findings register (CSV)
          </button>
        </div>
        {zeroEvidenceItems.length > 0 && (
          <div style={{ background: "#fff7ed", border: "1px solid #f97316", borderRadius: 8, padding: "10px 14px", marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Pill s="critical">Warning</Pill>
              <b style={{ fontSize: 12.5, color: "#9a3412" }}>{zeroEvidenceItems.length} unverified scored item(s)</b>
            </div>
            <div style={{ fontSize: 12, color: "#7c2d12", lineHeight: 1.5 }}>
              {zeroEvidenceItems.join(", ")} — checklist is scored but no evidence is attached to any specific line. EduTrust assessors will not accept these bands without supporting documents. The exported pack includes a bold warning.
            </div>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 12 }}>
          Internal simulation only. Not an official SSG or EduTrust result. AI agents assist and challenge but do not finalise.
        </div>
      </Card>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Export log ({exportLog.length})</h3>
        {exportLog.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No exports yet.</p>}
        {exportLog.map((e) => (
          <div key={e.id} style={{ fontSize: 12.5, padding: "7px 0", borderBottom: "1px solid #eef1f5" }}>
            <b>{e.exportName}</b> · {e.format}
            <br />
            <span style={{ color: "#6b7280" }}>{e.exportedAt} — {e.exportedBy}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
