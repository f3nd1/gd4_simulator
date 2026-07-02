import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import type { SampleRecord, SampleRecordType } from "../types";

const TYPE_BY_CRITERION: Record<string, SampleRecordType> = {
  "1": "Academic",
  "2": "Staff",
  "3": "Academic",
  "4": "Student",
  "5": "Academic",
  "6": "QA",
  "7": "Financial",
};

function generateSamples(items: { id: string; crit: string; title: string; ais: number; band: number; gate: boolean }[]): SampleRecord[] {
  const risky = items.filter((i) => i.band < 3 || i.gate).slice(0, 12);
  return risky.map((it, idx) => ({
    id: `SMP-${it.id}-${idx}`,
    auditCycleId: "cycle-1",
    gd4ItemId: it.id,
    recordType: TYPE_BY_CRITERION[it.crit] || "QA",
    reference: `${it.id} record set ${idx + 1}`,
    riskReason: it.gate ? "Gate-sensitive item" : `Evidence score ${it.ais}, below Band 3`,
    selected: true,
  }));
}

export function Sampling() {
  const samples = useWorkspaceStore((s) => s.samples);
  const setSamples = useWorkspaceStore((s) => s.setSamples);
  const toggleSample = useWorkspaceStore((s) => s.toggleSample);
  const setSampleOutcome = useWorkspaceStore((s) => s.setSampleOutcome);
  const scored = useScored();

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Risk-based sampling</h3>
        <button
          onClick={() => {
            // Regenerating replaces the whole array — including any tested
            // outcomes/notes already recorded against the current sample.
            if (samples.length > 0 && !confirm("This will replace your recorded sampling outcomes. Continue?")) return;
            setSamples(generateSamples(scored.items));
          }}
          style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
        >
          Generate sample from gate &amp; weak items
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Select student, staff, academic, financial and QA records to test against the GD4 items they relate to.
      </p>
      {samples.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No samples yet. Generate a risk-based sample above.</p>}
      <table>
        <thead><tr><th>Selected</th><th>Reference</th><th>GD4 item</th><th>Type</th><th>Risk reason</th><th>Tested outcome</th><th>Notes</th></tr></thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.id} className="rowh">
              <td><input type="checkbox" checked={s.selected} onChange={() => toggleSample(s.id)} /></td>
              <td><b>{s.reference}</b></td>
              <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>{s.gd4ItemId}</td>
              <td>{s.recordType}</td>
              <td style={{ fontSize: 12, color: "#6b7280" }}>{s.riskReason}</td>
              <td>
                <select
                  value={s.testedOutcome || ""}
                  onChange={(e) => setSampleOutcome(s.id, (e.target.value || undefined) as SampleRecord["testedOutcome"], s.notes)}
                  style={{ ...inputStyle, width: 90, padding: "4px 6px" }}
                >
                  <option value="">—</option>
                  <option>Pass</option>
                  <option>Partial</option>
                  <option>Fail</option>
                </select>
                {s.testedOutcome && <Pill s={s.testedOutcome === "Pass" ? "good" : s.testedOutcome === "Partial" ? "medium" : "critical"}>{s.testedOutcome}</Pill>}
              </td>
              <td>
                <input
                  value={s.notes || ""}
                  onChange={(e) => setSampleOutcome(s.id, s.testedOutcome, e.target.value)}
                  style={{ ...inputStyle, width: 140, padding: "4px 6px" }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
