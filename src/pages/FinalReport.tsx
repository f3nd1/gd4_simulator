import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { buildFinalReport, type ItemReport } from "../lib/finalReport";
import { buildAnalytics } from "../lib/analytics";
import { chatComplete, effectiveSettings } from "../lib/ai/aiClient";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { composeSchoolContext } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Gauge, HBars, VBars, BAND_COLOR, AttainmentLadder } from "../components/ui/charts";
import { GOLD, INK, bandTone } from "../lib/theme";

const SEV_TONE: Record<string, string> = { Critical: "critical", High: "critical", Medium: "medium", Low: "progress" };

export function FinalReport() {
  const scored = useScored();
  const entries = useChecklistModuleStore((s) => s.entries);
  const findings = useAllFindings();
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const cycle = useWorkspaceStore((s) => s.cycle);
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const aiSettings = useAISettingsStore();
  const awardThresholds = useScoringConfigStore((s) => s.awardThresholds);

  const report = useMemo(() => buildFinalReport(scored, entries, findings, closures), [scored, entries, findings, closures]);
  const a = useMemo(() => buildAnalytics(scored, entries, findings, folders, closures), [scored, entries, findings, folders, closures]);

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function generateSummary() {
    setAiBusy(true);
    setAiError(null);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(schoolContext) });
      const sys =
        "You are writing the executive summary of a GD4 internal audit readiness report for a private education institution. Be concise, specific and honest — do not soften gaps. Respond with JSON only: {\"summary\": string} of 4-6 sentences covering overall readiness, the strongest areas, the most important areas for improvement, and the single highest-priority action to raise the band.";
      const user = `Overall score ${report.overall.total}/1000, award "${report.overall.award}", score gate ${
        report.overall.gatePass ? "met" : `NOT met (${report.overall.gateFail.join(", ")})`
      }. Per-criterion bands: ${report.crits.map((c) => `C${c.id} Band ${c.band}`).join(", ")}. Items below Band 3: ${
        report.items.filter((i) => i.band < 3).map((i) => i.id).join(", ") || "none"
      }. Open AFIs: ${report.overall.openAFIs}. Representative gaps: ${report.items.flatMap((i) => i.gaps).slice(0, 12).join("; ") || "none recorded"}.`;
      const content = await chatComplete([{ role: "system", content: sys }, { role: "user", content: user }], settings);
      let text = content;
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.summary === "string") text = parsed.summary;
      } catch {
        /* keep raw */
      }
      setAiSummary(text);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: INK, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11.5, color: "#aeb8c7", textTransform: "uppercase", letterSpacing: 0.4 }}>Final report (internal simulation)</div>
            <h2 style={{ margin: "2px 0", fontSize: 20 }}>{cycle.name || "GD4 Audit"}</h2>
            <div style={{ fontSize: 12, color: "#aeb8c7" }}>
              {cycle.periodStart} to {cycle.periodEnd} · {cycle.version} · {cycle.status} · owner {cycle.owner}
            </div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: GOLD, fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}>
              Print / Save as PDF
            </button>
            <button
              disabled={aiBusy || !aiSettings.enabled || !aiSettings.apiKey}
              title={!aiSettings.enabled || !aiSettings.apiKey ? "Enable AI and set an API key in Settings to generate the narrative." : "One analysis-model call using your School Context."}
              onClick={generateSummary}
              style={{ cursor: aiBusy ? "default" : "pointer", border: "1px solid #3a4660", background: "transparent", color: "#9fe0bd", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12, opacity: !aiSettings.enabled || !aiSettings.apiKey ? 0.5 : 1 }}
            >
              {aiBusy ? "Writing…" : "Generate AI summary"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: GOLD }}>{report.overall.total}</span>
          <span style={{ color: "#aeb8c7" }}>/ 1000</span>
          <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 8 }}>{report.overall.award}</span>
        </div>
        <div style={{ fontSize: 12, color: report.overall.gatePass ? "#9fe0bd" : "#f4b3aa", marginTop: 4 }}>
          {report.overall.gatePass ? "Score gate met (4.2, 4.6, C5 at Band 3+)" : `Score gate NOT met: ${report.overall.gateFail.join(", ")}`} · Open AFIs: {report.overall.openAFIs}
        </div>
        <div style={{ fontSize: 11, color: "#7e8da0", marginTop: 8 }}>Not an official SSG or EduTrust result. Internal readiness simulation only.</div>
        <div style={{ background: "#fff", color: INK, borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
          <AttainmentLadder total={report.overall.total} award={report.overall.award} thresholds={awardThresholds} />
        </div>
      </Card>

      {aiError && <Card style={{ borderLeft: "3px solid #b23121" }}><div style={{ fontSize: 12.5, color: "#b23121" }}>AI summary failed: {aiError}</div></Card>}
      {aiSummary && (
        <Card>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Executive summary (AI)</h3>
          <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0 }}>{aiSummary}</p>
        </Card>
      )}

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Visual summary</h3>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <Gauge value={a.total} max={1000} label="of 1000" color={GOLD} />
            <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{a.award}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Items by band</div>
            <VBars data={["Not started", "B1", "B2", "B3", "B4", "B5"].map((label, i) => ({ label, value: a.itemsByBand[i], color: BAND_COLOR[i] }))} height={120} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Band by criterion</div>
            <HBars data={a.bandByCriterion.map((c) => ({ label: `C${c.id}`, value: c.band, color: BAND_COLOR[c.band] }))} max={5} fmt={(v) => `B${v}`} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Critical gates (need B3+)</div>
            <HBars data={a.gates.map((g) => ({ label: g.id.replace("Sub-criterion ", "").replace("Criterion ", "C"), value: g.avgBand, color: g.pass ? "#2f9e6e" : "#c0392b" }))} max={5} fmt={(v) => `B${v}`} />
            <div style={{ fontSize: 11.5, color: "#475569", marginTop: 6 }}>Findings: {a.findingsClosed} closed · {a.findingsOpen} open</div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Banding by criterion</h3>
        <table>
          <thead><tr><th>Criterion</th><th>Band</th><th>Points</th><th>Status</th></tr></thead>
          <tbody>
            {report.crits.map((c) => (
              <tr key={c.id}>
                <td><b>C{c.id}</b> {c.title}</td>
                <td><Pill s={bandTone(c.band)}>Band {c.band}</Pill></td>
                <td>{c.scored} / {c.points}</td>
                <td>{c.started ? <Pill s="good">Scored</Pill> : <Pill s="medium">Not started</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Banding by item — strengths, gaps & how to reach a higher band</h3>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
          Strengths and gaps are derived from the Sub-Criterion Checklist. "How to reach Band N" is computed from the same coverage/maturity/evidence rules that set the band.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {report.items.map((it) => <ItemBlock key={it.id} it={it} />)}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Findings register — root cause, gap & closure ({report.findings.length})</h3>
        {report.findings.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#6b7280" }}>No findings raised.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {report.findings.map((f) => (
              <div key={f.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill s={SEV_TONE[f.severity] || "medium"}>{f.severity}</Pill>
                  <Pill s={f.closed ? "good" : "medium"}>{f.closed ? "Closed" : f.status}</Pill>
                  <span style={{ fontSize: 11.5, color: "#6b7280" }}>{f.type}</span>
                  <span style={{ fontSize: 11.5, color: "#94a3b8" }}>· {f.itemId}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, margin: "4px 0" }}>{f.issue}</div>
                <ReportLine label="Root cause" value={f.rootCause} />
                <ReportLine label="What's missing / still needed" value={f.stillNeeded} />
                <ReportLine label="Corrective action (how to close)" value={f.corrective} />
                <ReportLine label="Preventive action" value={f.preventive} />
                <ReportLine label="Closure evidence" value={f.closureEvidence} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ItemBlock({ it }: { it: ItemReport }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Pill s={bandTone(it.band)}>Band {it.band}</Pill>
        {it.gate && <Pill s="high">Gate</Pill>}
        <b style={{ fontSize: 12.5 }}>{it.id}</b>
        <span style={{ fontSize: 12.5 }}>{it.title}</span>
        {it.hasChecklist && <span style={{ fontSize: 11, color: "#94a3b8" }}>· coverage {it.coveragePct}% · maturity ceiling Band {it.maturityCeiling}</span>}
      </div>
      {it.strengths.length > 0 && (
        <Bullets title="Strengths" color="#15803d" items={it.strengths} />
      )}
      {it.gaps.length > 0 && (
        <Bullets title="Gaps / what's missing" color="#b23121" items={it.gaps} />
      )}
      <Bullets title={`How to reach Band ${it.targetBand}`} color="#2563eb" items={it.howToImprove} />
    </div>
  );
}

function Bullets({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div style={{ marginTop: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</span>
      <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#374151" }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function ReportLine({ label, value }: { label: string; value?: string }) {
  if (!value || !value.trim()) return null;
  return (
    <div style={{ fontSize: 12.5, margin: "2px 0" }}>
      <span style={{ color: "#6b7280", fontWeight: 600 }}>{label}: </span>
      {value}
    </div>
  );
}
