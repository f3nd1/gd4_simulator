import { useMemo } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { buildAnalytics } from "../lib/analytics";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Gauge, HBars, VBars, StackedBar, BAND_COLOR, AttainmentLadder } from "../components/ui/charts";
import { GOLD, INK } from "../lib/theme";

const SEV_COLOR: Record<string, string> = { Critical: "#c0392b", High: "#d97706", Medium: "#5b6ea8", Low: "#94a3b8" };

export function Analytics() {
  const scored = useScored();
  const entries = useChecklistModuleStore((s) => s.entries);
  const findings = useAllFindings();
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const awardThresholds = useScoringConfigStore((s) => s.awardThresholds);

  const a = useMemo(() => buildAnalytics(scored, entries, findings, folders, closures), [scored, entries, findings, folders, closures]);

  const bandBars = ["Not started", "Band 1", "Band 2", "Band 3", "Band 4", "Band 5"].map((label, i) => ({
    label,
    value: a.itemsByBand[i],
    color: BAND_COLOR[i],
  }));

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
      <Card style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Data dashboard</h3>
        <div style={{ fontSize: 12, color: "#6b7280" }}>A visual read-out across scores, bands, gates, findings, evidence and checklist coverage. Internal simulation only — not an official SSG/EduTrust result.</div>
      </Card>

      <Card style={{ gridColumn: "1 / -1" }}>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Overall readiness & EduTrust attainment</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <Gauge value={a.total} max={1000} label="of 1000" color={GOLD} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <AttainmentLadder total={a.total} award={a.award} thresholds={awardThresholds} />
            <div style={{ marginTop: 8 }}><Pill s={a.gatePass ? "good" : "critical"}>{a.gatePass ? "Score gate met" : "Score gate not met"}</Pill></div>
          </div>
        </div>
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Findings</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Gauge value={a.findingsClosed} max={a.findingsClosed + a.findingsOpen} label="closed" color="#2f9e6e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>{a.findingsClosed} closed · {a.findingsOpen} open</div>
            <HBars data={a.findingsBySeverity.map((s) => ({ ...s, color: SEV_COLOR[s.label] }))} />
          </div>
        </div>
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Items by band</h4>
        <VBars data={bandBars} />
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Band by criterion</h4>
        <HBars data={a.bandByCriterion.map((c) => ({ label: `C${c.id} ${c.title}`, value: c.band, color: BAND_COLOR[c.band] }))} max={5} fmt={(v) => `B${v}`} />
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Critical gates (need Band 3+)</h4>
        <HBars data={a.gates.map((g) => ({ label: g.id, value: g.avgBand, color: g.pass ? "#2f9e6e" : "#c0392b" }))} max={5} fmt={(v) => `B${v}`} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {a.gates.map((g) => <Pill key={g.id} s={g.pass ? "good" : "critical"}>{g.id}: {g.pass ? "Pass" : "At risk"}</Pill>)}
        </div>
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Evidence & audit progress</h4>
        <HBars
          max={1}
          fmt={(v) => `${Math.round(v * 100)}%`}
          data={[
            { label: `Folders linked (${a.progress.foldersLinked}/${a.progress.foldersTotal})`, value: a.progress.foldersTotal ? a.progress.foldersLinked / a.progress.foldersTotal : 0, color: "#5b6ea8" },
            { label: `Folders audited (${a.progress.foldersAudited}/${a.progress.foldersTotal})`, value: a.progress.foldersTotal ? a.progress.foldersAudited / a.progress.foldersTotal : 0, color: "#2f9e6e" },
            { label: `Items with checklist (${a.progress.itemsWithChecklist}/${a.progress.itemsTotal})`, value: a.progress.itemsTotal ? a.progress.itemsWithChecklist / a.progress.itemsTotal : 0, color: "#8295bd" },
            { label: `Items scored (${a.progress.itemsScored}/${a.progress.itemsTotal})`, value: a.progress.itemsTotal ? a.progress.itemsScored / a.progress.itemsTotal : 0, color: GOLD },
          ]}
        />
      </Card>

      <Card>
        <h4 style={{ marginTop: 0, fontSize: 13 }}>Checklist line status</h4>
        <StackedBar
          segments={[
            { label: "Met", value: a.lineStatus.met, color: "#2f9e6e" },
            { label: "Partial", value: a.lineStatus.partial, color: "#d97706" },
            { label: "Not met", value: a.lineStatus.notMet, color: "#c0392b" },
            { label: "Not started", value: a.lineStatus.notStarted, color: "#cbd5e1" },
            { label: "N/A", value: a.lineStatus.na, color: "#94a3b8" },
          ]}
        />
      </Card>
    </div>
  );
}
