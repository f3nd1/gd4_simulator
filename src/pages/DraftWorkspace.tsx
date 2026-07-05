import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import { collectBackup, backupFilename } from "../lib/workspaceBackup";

export function DraftWorkspace() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const versions = useWorkspaceStore((s) => s.versions);
  const restoreLog = useWorkspaceStore((s) => s.restoreLog);
  const saveAsNewVersion = useWorkspaceStore((s) => s.saveAsNewVersion);
  const restoreVersion = useWorkspaceStore((s) => s.restoreVersion);
  const unlockCycle = useWorkspaceStore((s) => s.unlockCycle);
  const duplicateCycle = useWorkspaceStore((s) => s.duplicateCycle);
  const createNewCycle = useWorkspaceStore((s) => s.createNewCycle);
  const locked = cycle.status === "Locked";

  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  function saveAs() {
    saveAsNewVersion(name, note);
    setName("");
    setNote("");
  }

  // Audit-day safety net: one click bundles every persisted app key
  // (workspace, checklist, drafts, profile, settings) into a JSON file the
  // user can keep outside the browser.
  function downloadBackup() {
    const now = new Date();
    const backup = collectBackup(window.localStorage, now);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename(now);
    a.click();
    URL.revokeObjectURL(url);
  }

  function createNew() {
    if (window.confirm("Start a new blank cycle? This clears all evidence, findings, checklist entries and other current workspace data (saved versions are not affected). This cannot be undone.")) {
      createNewCycle();
    }
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Draft workspace</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          This is a long-running workspace, not a one-time checklist. Each "Save as new version" captures a full snapshot of the
          workspace that can be restored later — it is not just a label change.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <Pill s={locked ? "critical" : "progress"}>{cycle.status}</Pill>
          <b style={{ fontSize: 13 }}>{cycle.version}</b>
        </div>
        <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 12 }}>
          Last saved: {cycle.lastSavedAt}
          <br />
          Created {new Date(cycle.createdAt).toLocaleDateString()} · updated {new Date(cycle.updatedAt).toLocaleDateString()}
        </div>

        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Version name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pre-submission draft" style={{ ...inputStyle, marginTop: 3 }} disabled={locked} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version?" style={{ ...inputStyle, marginTop: 3 }} disabled={locked} />
        </label>

        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: -2, marginBottom: 8 }}>
          "Duplicate cycle" copies the current workspace's data as-is (real or demo). "Create new (blank) cycle" wipes
          current evidence, findings and checklist data back to a truly blank workspace.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={saveAs}
            disabled={locked}
            style={{ cursor: locked ? "not-allowed" : "pointer", border: "none", background: locked ? "#e2e8f0" : GOLD, color: locked ? "#94a3b8" : INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Save as new version
          </button>
          <button onClick={duplicateCycle} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
            Duplicate cycle
          </button>
          <button
            onClick={downloadBackup}
            title="Downloads every locally-persisted workspace key (workspace, checklist, drafts, PEI profile, settings — including your saved API keys) as one JSON file. Keep it somewhere safe before audit day."
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #2563eb", background: "#eff6ff", color: "#1d4ed8" }}
          >
            Download backup (JSON)
          </button>
          <button onClick={createNew} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#b23121" }}>
            Create new (blank) cycle
          </button>
          {locked ? (
            <button onClick={unlockCycle} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
              Unlock (admin)
            </button>
          ) : (
            <Link
              to="/finalisation"
              style={{ display: "inline-block", cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#1f2733", textDecoration: "none" }}
            >
              Go to Finalisation to lock →
            </Link>
          )}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Saved versions ({versions.length})</h3>
        {versions.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No saved versions yet. Use "Save as new version".</p>}
        {versions.map((v) => (
          <div key={v.id} style={{ fontSize: 12.5, padding: "7px 0", borderBottom: "1px solid #eef1f5" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <b>{v.name}</b>
              <span style={{ color: "#6b7280" }}>{v.version}</span>
            </div>
            <span style={{ color: "#6b7280" }}>
              {v.date} · {v.status} — {v.note}
            </span>
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => restoreVersion(v.id)}
                style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
              >
                Restore this version
              </button>
            </div>
          </div>
        ))}
      </Card>

      {restoreLog.length > 0 && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Restore audit log ({restoreLog.length})</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
            Immutable record of every time a saved version was restored. Entries are never deleted.
          </p>
          <table>
            <thead>
              <tr>
                <th>Restored at</th>
                <th>Version</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...restoreLog].reverse().map((entry, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{entry.restoredAt}</td>
                  <td style={{ fontSize: 12, fontFamily: "ui-monospace,monospace" }}>{entry.fromVersion}</td>
                  <td style={{ fontSize: 12, color: "#6b7280" }}>{entry.fromNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
