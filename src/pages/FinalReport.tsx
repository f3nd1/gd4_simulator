import { useMemo, useState, useEffect } from "react";
import { CloseoutStepper } from "../components/ui/CloseoutStepper";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { buildFinalReport, NOT_ASSESSED_AFI, eligibleSuggestionDims, suggestionKey, conciseKey, buildAiSuggestionUserPrompt, filterAiSuggestions, findingParagraphs, splitEvidenceNote, type ItemReport, type FindingReport } from "../lib/finalReport";
import { ThumbsButtons } from "../components/ui/ThumbsButtons";
import { buildAnalytics } from "../lib/analytics";
import { chatComplete, effectiveSettings } from "../lib/ai/aiClient";
import { buildSystemPrompt } from "../lib/ai/skills";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { composeSchoolContext } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { ThreePillarNote } from "../components/ui/ThreePillarNote";
import { Pill } from "../components/ui/Pill";
import { Gauge, HBars, VBars, BAND_COLOR, AttainmentLadder } from "../components/ui/charts";
import { GOLD, INK, BLUE, bandTone } from "../lib/theme";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { buildProvenance, provenanceLine } from "../lib/provenance";
import { refLabel } from "../data/gd4Requirements";

const SEV_TONE: Record<string, string> = { Critical: "critical", High: "critical", Medium: "medium", Low: "progress", Major: "critical", Minor: "medium" };

export function FinalReport() {
  const scored = useScored();
  const entries = useChecklistModuleStore((s) => s.entries);
  const findings = useAllFindings();
  const folders = useWorkspaceStore((s) => s.folders);
  const closures = useWorkspaceStore((s) => s.closures);
  const aiReviewLog = useWorkspaceStore((s) => s.aiReviewLog);
  const cycle = useWorkspaceStore((s) => s.cycle);
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const aiSettings = useAISettingsStore();
  const awardThresholds = useScoringConfigStore((s) => s.awardThresholds);
  const apsrScale = useScoringConfigStore((s) => s.apsrScale);

  const report = useMemo(() => buildFinalReport(scored, entries, findings, closures, apsrScale), [scored, entries, findings, closures, apsrScale]);
  const a = useMemo(() => buildAnalytics(scored, entries, findings, folders, closures), [scored, entries, findings, folders, closures]);

  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const removeCustomFinding = useWorkspaceStore((s) => s.removeCustomFinding);
  const clearAllFindings = useWorkspaceStore((s) => s.clearAllFindings);
  const [confirmDeleteFindingId, setConfirmDeleteFindingId] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiCriterionNarratives, setAiCriterionNarratives] = useState<Record<string, string> | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [editedSummary, setEditedSummary] = useState("");
  const [summaryFeedbackOpen, setSummaryFeedbackOpen] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [bandingTab, setBandingTab] = useState<"criterion" | "subcriterion">("criterion");
  const [filterCrit, setFilterCrit] = useState("All");
  const [filterSubCrit, setFilterSubCrit] = useState("All");
  useEffect(() => { if (aiSummary) setEditedSummary(aiSummary); }, [aiSummary]);

  const subCritOptions = useMemo(
    () => report.subCriteria.filter((sc) => filterCrit === "All" || sc.criterionId === filterCrit),
    [report.subCriteria, filterCrit]
  );
  const filteredItems = useMemo(
    () => report.items.filter((it) => (filterCrit === "All" || it.criterion === filterCrit) && (filterSubCrit === "All" || it.subCriterionId === filterSubCrit)),
    [report.items, filterCrit, filterSubCrit]
  );
  function handleSummaryThumbsUp() {
    logHumanDecision({ module: "Final Report", subjectId: "executive-summary", aiOutput: aiSummary || "", humanDecision: aiSummary || "", changed: false, decisionType: "Accepted", reason: "" });
  }

  function handleSummarySaveEdits() {
    logHumanDecision({ module: "Final Report", subjectId: "executive-summary", field: "summary", aiOutput: aiSummary || "", humanDecision: editedSummary, changed: editedSummary !== aiSummary, decisionType: editedSummary !== aiSummary ? "Edited" : "Accepted", reason: "" });
    setSummarySaved(true);
    setTimeout(() => setSummarySaved(false), 2000);
  }

  async function generateSummary() {
    setAiBusy(true);
    setAiError(null);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(schoolContext) });
      const sys =
        "You are writing the executive summary of a GD4 internal audit readiness report for a Singapore PEI. Be concise, specific and honest — do not soften gaps. Respond with JSON only: {\"summary\": string, \"criterionNarratives\": Record<string, string>}. The summary should be 4-6 sentences covering: overall readiness, highest-risk regulatory findings (Category A), strongest criteria, most critical gap to close, and whether 4-Year (Star) is realistically attainable from the current position. For criterionNarratives, write one specific sentence per criterion (C1–C7) stating its band, what's strong, and what the key gap is." + buildSystemPrompt("bandRecommend", null, "FinalReport.generateSummary");

      // Build richer user prompt with Category A/B findings
      const catAFindings = findings
        .filter((f) => (f as { riskCategory?: string }).riskCategory === "A")
        .slice(0, 5)
        .map((f) => `[${f.gd4ItemId}] ${f.issue}${f.effect ? ` — ${f.effect.slice(0, 150)}` : ""}`)
        .join("; ");
      const catBFindings = findings
        .filter((f) => (f as { riskCategory?: string }).riskCategory === "B")
        .slice(0, 3)
        .map((f) => `[${f.gd4ItemId}] ${f.issue}${f.effect ? ` — ${f.effect.slice(0, 150)}` : ""}`)
        .join("; ");
      const belowBand3Items = report.items.filter((i) => i.band < 3).map((i) => `${i.id} (Band ${i.band})`).join(", ");

      const user = `Overall score ${report.overall.total}/1000, award "${report.overall.award}", score gate ${
        report.overall.gatePass ? "met" : `NOT met (${report.overall.gateFail.join(", ")})`
      }.\nPer-criterion bands: ${report.crits.map((c) => `C${c.id} Band ${c.band} — ${c.title}`).join("; ")}.\nItems below Band 3: ${belowBand3Items || "none"}.\nOpen AFIs: ${report.overall.openAFIs}.\nCategory A findings (regulatory breach): ${catAFindings || "none"}.\nCategory B findings (Star-disqualifying): ${catBFindings || "none"}.`;

      const content = await chatComplete([{ role: "system", content: sys }, { role: "user", content: user }], settings);
      let text = content;
      let narratives: Record<string, string> | null = null;
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.summary === "string") text = parsed.summary;
        if (parsed && parsed.criterionNarratives && typeof parsed.criterionNarratives === "object") {
          narratives = parsed.criterionNarratives as Record<string, string>;
        }
      } catch {
        // Try extracting JSON object from response
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (parsed?.summary) text = parsed.summary;
            if (parsed?.criterionNarratives) narratives = parsed.criterionNarratives;
          } catch { /* keep raw */ }
        }
      }
      setAiSummary(text);
      setAiCriterionNarratives(narratives);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <CloseoutStepper />
      {/* In-page section jumps. scrollIntoView on ids, NOT href="#..." anchors:
          the app uses HashRouter, so an anchor href would clobber the
          #/final-report route (the same pattern SubCriterionChecklist and
          RubricBanding already use for in-page jumps). */}
      <div className="no-print" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {([["fr-summary", "Summary"], ["fr-items", "Banding by item"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "transparent", color: "#6b7280" }}
          >
            {label} ↓
          </button>
        ))}
      </div>
      <Card id="fr-summary" style={{ background: INK, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11.5, color: "#aeb8c7", textTransform: "uppercase", letterSpacing: 0.4 }}>Final report (internal simulation)</div>
            <h2 style={{ margin: "2px 0", fontSize: 20 }}>{cycle.name || "GD4 Audit"}</h2>
            <div style={{ fontSize: 12, color: "#aeb8c7" }}>
              {cycle.periodStart} to {cycle.periodEnd} · {cycle.version} · {cycle.status} · owner {cycle.owner}
            </div>
            {/* Provenance — what a sceptical reader (or a printed copy) needs:
                coverage, audit dates, offline count, model, auditors, and when
                this view was generated. */}
            <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 5 }}>
              {provenanceLine(buildProvenance(scored.items, folders, aiReviewLog.map((e) => e.model)))}
              {" · generated "}
              {new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
            <ThreePillarNote dark />
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
          <h3 style={{ marginTop: 0, fontSize: 14, display: "inline" }}>Executive summary (AI)</h3>
          <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
            <button onClick={handleSummaryThumbsUp} title="AI was helpful" style={{ background: "none", border: "1px solid #d1fae5", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#15803d" }}>👍</button>
            <button onClick={() => setSummaryFeedbackOpen(true)} title="AI was wrong" style={{ background: "none", border: "1px solid #fee2e2", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#b91c1c" }}>👎</button>
          </span>
          <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{aiSummary}</p>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>Edit summary (changes are logged):</div>
            <textarea
              value={editedSummary}
              onChange={(e) => setEditedSummary(e.target.value)}
              rows={6}
              style={{ width: "100%", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, padding: "8px 10px", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <button onClick={handleSummarySaveEdits} style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "6px 12px", borderRadius: 8, fontSize: 12 }}>Save edits</button>
              {summarySaved && <span style={{ fontSize: 12, color: "#15803d" }}>Saved</span>}
            </div>
          </div>
          {aiCriterionNarratives && Object.keys(aiCriterionNarratives).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>Criterion-by-criterion breakdown (AI)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 }}>
                {report.crits.map((c) => {
                  const key = `C${c.id}`;
                  const narrative = aiCriterionNarratives[key] || aiCriterionNarratives[c.id] || aiCriterionNarratives[String(c.id)];
                  if (!narrative) return null;
                  return (
                    <div key={c.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#f8fafc" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <Pill s={c.band >= 4 ? "good" : c.band === 3 ? "medium" : "critical"}>Band {c.band}</Pill>
                        <span style={{ fontSize: 11.5, fontWeight: 700 }}>C{c.id} {c.title}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>{narrative}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>Banding by criterion</h3>
          {report.findings.length > 0 && (
            <button
              className="no-print"
              onClick={() => { if (confirm(`Delete all ${report.findings.length} finding${report.findings.length !== 1 ? "s" : ""}?\n\nThis removes them from both the Findings register AND the Quality Action / AFI module (they share the same data). Closure decisions and any back-references on checklist lines will also be cleared. This cannot be undone.`)) clearAllFindings(); }}
              style={{ fontSize: 11.5, color: "#b91c1c", background: "transparent", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
            >
              Delete all findings
            </button>
          )}
        </div>
        <div className="no-print" style={{ display: "flex", gap: 4, marginBottom: 10, marginTop: 10 }}>
          {(["criterion", "subcriterion"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setBandingTab(tab)}
              style={{
                cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8,
                border: `1px solid ${bandingTab === tab ? BLUE : "#e2e8f0"}`,
                background: bandingTab === tab ? "#eaeef6" : "transparent",
                color: bandingTab === tab ? "#4a5a8a" : "#6b7280",
              }}
            >
              {tab === "criterion" ? "By Criterion" : "By Sub-criterion"}
            </button>
          ))}
        </div>
        {bandingTab === "criterion" ? (
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
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              Points are each sub-criterion's proportional share of its criterion's official points (by item count) — GD4 itself only allocates points at criterion level, so this is a readability split, not a separately certified figure.
            </div>
            {report.crits.map((c) => {
              const subs = report.subCriteria.filter((sc) => sc.criterionId === c.id);
              if (subs.length === 0) return null;
              return (
                <div key={c.id}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}><b>C{c.id}</b> {c.title} <span style={{ fontWeight: 400, color: "#6b7280" }}>· Band {c.band} overall</span></div>
                  <table>
                    <thead><tr><th>Sub-criterion</th><th>Band</th><th>Points</th><th>Status</th></tr></thead>
                    <tbody>
                      {subs.map((sc) => (
                        <tr key={sc.id}>
                          <td><b>{sc.id}</b> {sc.title}</td>
                          <td><Pill s={bandTone(sc.band)}>Band {sc.band}</Pill></td>
                          <td>{sc.scored} / {Math.round(sc.points)}</td>
                          <td>{sc.started ? <Pill s="good">Scored</Pill> : <Pill s="medium">Not started</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card id="fr-items">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Banding by item — findings and AFIs</h3>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
          Findings and AFIs are derived from the Sub-Criterion Checklist, one row per requirement line grouped by APSR dimension — the band itself is the reviewer's holistic judgment.
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Criterion{" "}
            <select
              value={filterCrit}
              onChange={(e) => { setFilterCrit(e.target.value); setFilterSubCrit("All"); }}
              style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #e2e8f0" }}
            >
              <option value="All">All</option>
              {report.crits.map((c) => <option key={c.id} value={c.id}>C{c.id} {c.title}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#374151" }}>
            Sub-criterion{" "}
            <select
              value={filterSubCrit}
              onChange={(e) => setFilterSubCrit(e.target.value)}
              style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #e2e8f0" }}
            >
              <option value="All">All</option>
              {subCritOptions.map((sc) => <option key={sc.id} value={sc.id}>{sc.id} {sc.title}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {filteredItems.length === 0
            ? <div style={{ fontSize: 12.5, color: "#6b7280" }}>No items match this filter.</div>
            : filteredItems.map((it) => (
                <ItemBlock
                  key={it.id}
                  it={it}
                  findings={report.findings.filter((f) => f.gd4ItemId === it.id)}
                  confirmDeleteId={confirmDeleteFindingId}
                  setConfirmDeleteId={setConfirmDeleteFindingId}
                  onDelete={removeCustomFinding}
                />
              ))}
        </div>
      </Card>

      <FeedbackModal
        open={summaryFeedbackOpen}
        aiOutput={aiSummary || ""}
        onClose={() => setSummaryFeedbackOpen(false)}
        onSubmit={(feedback) => {
          logHumanDecision({ module: "Final Report", subjectId: "executive-summary", aiOutput: aiSummary || "", humanDecision: feedback.correction || aiSummary || "", changed: !!feedback.correction, decisionType: "Overridden", reason: feedback.reason });
        }}
      />
    </div>
  );
}

// The Band N → Band N+1 pill pair shared by strength AND weakness rows
// (bandTone gives each band its own colour). Rendered only for bands 1-4 —
// the same gate strengthNextBandAfi uses: Band 5 has no higher rung and
// Band 0 ("Not evident") has no coherent transition to draw.
function bandJumpPills(fromBand: number, dimLabel: string) {
  if (fromBand < 1 || fromBand >= 5) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <Pill s={bandTone(fromBand)}>Band {fromBand}</Pill>
      <span style={{ color: "#94a3b8", fontSize: 12 }}>→</span>
      <Pill s={bandTone(fromBand + 1)}>Band {fromBand + 1}</Pill>
      <span style={{ fontSize: 11, color: "#374151", fontWeight: 600 }}>{dimLabel}</span>
    </span>
  );
}

// The per-line evidence cell. When the audit accumulated several sliding-window
// observations into one numbered "#1 [file · chunk]: … #2 …" block, only the
// strongest first two are shown; the rest go behind an expand instead of
// stacking every citation verbatim (Fix 1, 2026-07-19). Systems & Outcomes and
// Review span the whole document, so their positive verdicts pick up 8-10
// window notes and were dumping all of them, making those cells many times
// longer than Approach/Processes. This restores splitEvidenceNote's original
// "first entries visible, rest behind an expand" intent that findingParagraphs
// had regressed to rendering all. Nothing is deleted: the full text stays here
// behind the expand and remains on the Sub-Criterion Checklist card. A single
// ordinary note (the Approach/Processes norm) renders unchanged.
const EVIDENCE_VISIBLE = 2;
function EvidenceCell({ finding, concise }: { finding: string; concise?: string }) {
  const entries = splitEvidenceNote(finding);
  // A one-sentence AI synthesis exists for this (long) row: show it as the
  // default text, exactly like the short Approach/Processes cells, and tuck the
  // full raw evidence behind a "view evidence" expand (2026-07-19). Written by
  // runConciseLineSummaries during a run / "Regenerate report text"; grounded in
  // the raw text below and honesty-filtered, never fabricated.
  if (concise) {
    return (
      <>
        <span style={{ whiteSpace: "pre-wrap" }}>{concise}</span>
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", color: "#64748b", fontSize: 11 }}>
            View evidence ({entries.length} observation{entries.length === 1 ? "" : "s"})
          </summary>
          {entries.map((e, i) => <p key={i} style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{e}</p>)}
        </details>
      </>
    );
  }
  // One note, or an already-short 1-2 entry cell: render in full as before.
  if (entries.length <= EVIDENCE_VISIBLE) {
    const paras = entries.length > 1 ? entries : findingParagraphs(finding);
    return paras.length === 1
      ? <span style={{ whiteSpace: "pre-wrap" }}>{paras[0]}</span>
      : <>{paras.map((p, pi) => <p key={pi} style={{ whiteSpace: "pre-wrap", margin: pi === 0 ? "0" : "6px 0 0" }}>{p}</p>)}</>;
  }
  const visible = entries.slice(0, EVIDENCE_VISIBLE);
  const rest = entries.slice(EVIDENCE_VISIBLE);
  return (
    <>
      {visible.map((e, i) => <p key={i} style={{ whiteSpace: "pre-wrap", margin: i === 0 ? "0" : "6px 0 0" }}>{e}</p>)}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: "#64748b", fontSize: 11 }}>
          Show {rest.length} more evidence observation{rest.length === 1 ? "" : "s"}
        </summary>
        {rest.map((e, i) => <p key={i} style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{e}</p>)}
      </details>
    </>
  );
}

// Strength AFI from strengthNextBandAfi() uses double-quoted descriptor:
//   Band N strength. To reach Band N+1 on DimLabel, the EduTrust rubric looks for: "...". Keep this evidenced...
// Parse that format to show the band-jump pills. Not-assessed rows get muted
// grey. Weakness AFI is free-text from the AI — no parseable band pair, so
// the SAME pill pair is drawn from the dimension's own band (dim), above the
// action text.
function renderAfi(afi: string | undefined, dim?: { band: number; label: string }, strengthGroundedAction?: string) {
  if (!afi) return null;
  const m = afi.match(/^Band (\d) strength\. To reach Band (\d) on (.+?), the EduTrust rubric looks for: "(.+)"\. Keep this evidenced/);
  if (m) {
    // Item 6 (recurring, 2026-07-18): a Strength row keeps the verbatim rubric
    // descriptor as the "target", but the actionable line beneath it is now
    // the grounded, evidence-based next-band suggestion from the auditor
    // narrative (nar.requiredAction) — NOT the bare rubric quote alone. When
    // the narrative has not run yet, an honest pointer replaces it.
    const [, fromBand, , dimLabel, quote] = m;
    return (
      <span>
        {bandJumpPills(Number(fromBand), dimLabel)}
        <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 3 }}><span style={{ fontWeight: 700 }}>Target (rubric): </span><span style={{ fontStyle: "italic" }}>"{quote}"</span></div>
        {strengthGroundedAction
          ? <div style={{ fontSize: 11, color: "#166534", marginTop: 3 }}><span style={{ fontWeight: 700 }}>To reach the next band: </span>{strengthGroundedAction}</div>
          : <div className="no-print" style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, fontStyle: "italic" }}>Run the audit or click "Regenerate report text" for a grounded, evidence-based suggestion.</div>}
      </span>
    );
  }
  if (afi === NOT_ASSESSED_AFI) {
    return <span style={{ color: "#94a3b8", fontSize: 11 }}>{afi}</span>;
  }
  // Weakness AFI: the same band-jump visual as strengths (from the
  // dimension's own band), then the free-text action item — amber to signal
  // "action needed".
  const pills = dim ? bandJumpPills(dim.band, dim.label) : null;
  return (
    <span>
      {pills}
      <div style={{ marginTop: pills ? 3 : 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b45309" }}>Action: </span>
        <span style={{ color: "#92400e" }}>{afi}</span>
      </div>
    </span>
  );
}

function ItemBlock({ it, findings, confirmDeleteId, setConfirmDeleteId, onDelete }: {
  it: ItemReport;
  findings: FindingReport[];
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  // Item 3: AI improvement suggestions — generate-once-and-save. Rendering
  // only ever READS the persisted map; the AI is called only by the explicit
  // button click below, so the report never re-rolls (or re-bills) per
  // render and the on-screen text matches the printed PDF.
  const aiSettings = useAISettingsStore();
  const confirmAiAutoBand = useChecklistModuleStore((s) => s.confirmAiAutoBand);
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const suggestions = useWorkspaceStore((s) => s.reportAiSuggestions);
  const setReportAiSuggestions = useWorkspaceStore((s) => s.setReportAiSuggestions);
  const logSuggestionDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const [sugBusy, setSugBusy] = useState(false);
  const [sugError, setSugError] = useState<string | null>(null);
  const [sugFeedback, setSugFeedback] = useState<{ key: string; text: string; field?: string } | null>(null);

  const eligibleDims = eligibleSuggestionDims(it.findingsGroups);
  const hasSuggestions = eligibleDims.some((g) => suggestions[suggestionKey(it.id, g.key)]);
  const aiReady = aiSettings.enabled && !!aiSettings.apiKey;

  // Auditor narratives are written AUTOMATICALLY as the final step of a run
  // (Hybrid draft / Full Auto) via the same store action the button below
  // calls — the report should come out in the right voice with no clicking.
  // This component only READS the persisted map and offers "Regenerate report
  // text" as the fallback for when the auto text misses the mark. The old
  // per-row "concise summaries" feature was superseded by the narrative and
  // its button removed (2026-07-18); its persisted data is simply unread.
  const narratives = useWorkspaceStore((s) => s.reportDimensionNarratives);
  // Per-line one-sentence syntheses for long rows (Systems & Outcomes / Review
  // raw evidence merges); when present the cell shows the sentence, not the
  // stack. Same generate-once-and-save contract as the narratives above.
  const conciseFindings = useWorkspaceStore((s) => s.reportConciseFindings);
  const writeReportNarratives = useWorkspaceStore((s) => s.writeReportNarratives);
  const [narBusy, setNarBusy] = useState(false);
  const [narError, setNarError] = useState<string | null>(null);

  async function generateSuggestions() {
    setSugBusy(true);
    setSugError(null);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(schoolContext) });
      const sys =
        "You are writing improvement suggestions for a GD4 internal audit readiness report for a Singapore PEI. For EACH dimension in the user message, write 2-3 specific sentences on how to improve, reasoning ONLY from the assessed findings listed for that dimension and toward the quoted verbatim rubric target. Never invent records, numbers or citations that are not in the findings. Respond with JSON only: {\"suggestions\": {\"approach\"?: string, \"processes\"?: string, \"systemsOutcomes\"?: string, \"review\"?: string}} — include only the dimensions given." +
        buildSystemPrompt("bandRecommend", null, "FinalReport.generateImprovementSuggestions");
      const user = buildAiSuggestionUserPrompt(it);
      let model: string | undefined;
      const content = await chatComplete([{ role: "system", content: sys }, { role: "user", content: user }], settings, { onUsage: (u) => { model = u.model; } });
      let raw: unknown;
      try {
        raw = (JSON.parse(content) as { suggestions?: unknown }).suggestions;
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) { try { raw = (JSON.parse(match[0]) as { suggestions?: unknown }).suggestions; } catch { /* no usable JSON */ } }
      }
      // The honesty filter: only eligible dimensions survive, whatever the
      // model returned — a not-assessed dimension can never gain a suggestion.
      const filtered = filterAiSuggestions(raw, it.findingsGroups);
      const keys = Object.keys(filtered) as Array<keyof typeof filtered>;
      if (keys.length === 0) throw new Error("The AI returned no usable suggestions — try again.");
      const generatedAt = new Date().toISOString();
      setReportAiSuggestions(Object.fromEntries(keys.map((k) => [suggestionKey(it.id, k), { text: filtered[k]!, generatedAt, model }])));
    } catch (err) {
      setSugError(err instanceof Error ? err.message : String(err));
    } finally {
      setSugBusy(false);
    }
  }

  // The ONE regenerate control: re-runs the auditor narrative (via the same
  // store action the run flow uses — one generator, no drift) AND the
  // improvement suggestion together, so a user who disagrees with the auto
  // text refreshes the whole item's AI prose with a single click.
  async function regenerateReportText() {
    setNarBusy(true);
    setNarError(null);
    try {
      const [written] = await Promise.all([writeReportNarratives([it.id]), generateSuggestions()]);
      if (written === 0) setNarError("No narrative was generated — check the AI settings on Settings, then try again.");
    } finally {
      setNarBusy(false);
    }
  }
  // An item that was never started, has no checklist AND has no findings
  // collapses to a single summary line; with 29 such placeholders the page was
  // dominated by empty cards. An item that DOES have findings always falls
  // through to the full card so its findings fold is reachable, even when it
  // was never formally banded (e.g. a manual finding on an un-audited item).
  // Deliberate: collapsed items also PRINT collapsed, since empty placeholders
  // add nothing to a printed report, and any one expands with a click. Do not
  // add a print-force-expand rule.
  if (!it.started && !it.hasChecklist && findings.length === 0) {
    return (
      <details style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 10px" }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5 }}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", verticalAlign: "middle" }}>
            {it.gate && <Pill s="high">Gate</Pill>}
            <span style={{ fontWeight: 700, color: "#94a3b8" }}>{it.id}</span>
            <span style={{ color: "#b0b9c9" }}>{it.title}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Not started</span>
          </span>
        </summary>
        {it.generalNote && (
          <p style={{ fontSize: 11.5, color: "#2563eb", margin: "6px 0 0" }}>{it.generalNote}</p>
        )}
      </details>
    );
  }
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {it.needsReassessment
          ? <Pill s="medium">Needs re-assessment</Pill>
          : <Pill s={bandTone(it.band)}>Band {it.band}</Pill>}
        {/* An auto-scored band is marked until a human confirms it — prints
            too, so the PDF carries it; the Confirm button is no-print (it
            reuses confirmAiAutoBand, the same clearing action a manual
            re-save on the Sub-Criterion Checklist already triggers). */}
        {it.bandSource === "ai-auto" && (
          <>
            <Pill s="medium">Draft (AI) · Confirm to finalise</Pill>
            <button
              className="no-print"
              onClick={() => confirmAiAutoBand(it.id)}
              title="Confirm this AI-set band as reviewed — records the same human decision a manual re-save would, without changing the scores or rationale."
              style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#fff", background: "#15803d", border: "none", borderRadius: 6, padding: "3px 9px" }}
            >
              Confirm
            </button>
          </>
        )}
        {it.gate && <Pill s="high">Gate</Pill>}
        <b style={{ fontSize: 12.5 }}>{it.id}</b>
        <span style={{ fontSize: 12.5 }}>{it.title}</span>
        {it.hasChecklist && <span style={{ fontSize: 11, color: "#94a3b8" }}>· {it.completeness.assessed} of {it.completeness.total} lines assessed ({it.completeness.met} Met · {it.completeness.partial} Partial · {it.completeness.notMet} Not met)</span>}
        {eligibleDims.length > 0 && (
          // The single regenerate control (2026-07-18): the narrative is
          // auto-written by the run, so this exists only as the fallback. One
          // click refreshes BOTH the auditor narrative and the improvement
          // suggestion for this item.
          <button
            className="no-print"
            disabled={narBusy || sugBusy || !aiReady}
            onClick={regenerateReportText}
            title={!aiReady ? "Enable AI and set an API key in Settings first." : "Rewrites this item's auditor narrative and improvement suggestion from its assessed findings. The narrative is normally written automatically at the end of a run — use this if it is missing or misses the mark."}
            style={{ marginLeft: "auto", cursor: narBusy || sugBusy || !aiReady ? "default" : "pointer", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #c7d2fe", background: "transparent", color: "#4338ca", opacity: aiReady ? 1 : 0.5, whiteSpace: "nowrap" }}
          >
            {narBusy || sugBusy ? "Writing…" : "Regenerate report text"}
          </button>
        )}
      </div>
      {sugError && <div style={{ fontSize: 11.5, color: "#b23121", marginTop: 4 }}>AI suggestions failed: {sugError}</div>}
      {narError && <div style={{ fontSize: 11.5, color: "#b23121", marginTop: 4 }}>Auditor narrative failed: {narError}</div>}
      {it.overallSummary && (
        <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, margin: "6px 0 0" }}>{it.overallSummary}</p>
      )}
      {it.findingsGroups.length > 0 && (
        <div style={{ marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 8, overflowX: "auto" }}>
          <table>
            <thead>
              {/* Finding and AFI get EQUAL width (Item 3): unequal auto-layout
                  widths made the two prose columns wrap raggedly. */}
              <tr><th>Dimension</th><th>Band</th><th>Item</th><th style={{ width: "34%" }}>Finding</th><th style={{ width: "34%" }}>AFI (to reach next band)</th></tr>
            </thead>
            <tbody>
              {it.findingsGroups.flatMap((g) => {
                // Item 3: the saved AI suggestion for this dimension (read-only
                // here — generation happens only via the button above). Renders
                // as one extra labelled row under the group; the verbatim rubric
                // quote in the AFI column stays as the target, untouched.
                const sug = g.rows.length > 0 ? suggestions[suggestionKey(it.id, g.key)] : undefined;
                // Auditor-narrative pilot: same read-only, generate-once-and-save
                // contract as the suggestion row above — an additional,
                // separately-labelled row, never replacing it.
                const nar = g.rows.length > 0 ? narratives[suggestionKey(it.id, g.key)] : undefined;
                const dimCell = (rowSpan: number) => (
                  <>
                    <td rowSpan={rowSpan} style={{ verticalAlign: "top", whiteSpace: "nowrap", fontWeight: 700, fontSize: 11.5 }}>{g.label}</td>
                    <td rowSpan={rowSpan} style={{ verticalAlign: "top", whiteSpace: "nowrap" }}><Pill s={bandTone(g.band)}>B{g.band} · {g.pct}%</Pill></td>
                  </>
                );
                if (g.rows.length === 0) {
                  // Two DIFFERENT empty states, never conflated: the official
                  // rubric defines no line of this dimension type for this
                  // item (the band is still a real holistic judgement — see
                  // docs/dimension-band-without-lines-investigation.md), vs
                  // official lines of this type exist but none is drafted or
                  // tagged yet (drafting guidance applies).
                  return [
                    <tr key={g.key}>
                      {dimCell(1)}
                      <td colSpan={3} style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11.5 }}>
                        {g.rubricDefined === 0
                          ? `This item has no GD4 requirement line dedicated to ${g.label}, so ${g.label} is not assessed through its own row. It is still assessed: the band shown comes from the item's other lines and the overall band judgement below. This dimension IS assessed, just not via a requirement row of its own.`
                          : `The official rubric defines ${g.rubricDefined} ${g.label}-type requirement line${g.rubricDefined === 1 ? "" : "s"} for this item, but none is drafted or tagged yet. Generate the checklist lines on the Sub-Criterion Checklist page.`}
                      </td>
                    </tr>,
                  ];
                }
                // Item 4: a dimension with real assessed rows is ELIGIBLE for
                // an AI suggestion; once generation has run for this item, an
                // eligible dimension the model skipped gets a visible marker
                // instead of silent absence.
                const sugEligible = g.rows.length > 0 && g.rows.some((r) => r.verdict !== "not-assessed");
                const missingSug = !sug && hasSuggestions && sugEligible;
                // The narrative is auto-written by the run, so ANY eligible
                // dimension without one gets the honest placeholder (auto-gen
                // failed, was cancelled, or the item pre-dates the feature) —
                // pointing at the one Regenerate button.
                const missingNar = !nar && sugEligible;
                // A leg-derived group (Bug B) gets a lead-in row explaining
                // why other lines' refs appear under this dimension — the
                // lead-in then carries the rowSpan'd dimension cells.
                const totalRows = g.rows.length + (sug || missingSug ? 1 : 0) + (nar || missingNar ? 1 : 0) + (g.rowsFromLegs ? 1 : 0);
                const rowEls = g.rows.map((r, i) => {
                  // Three distinct states: strength (green), weakness (red),
                  // not-assessed (neutral grey) — an absence of assessment is
                  // never dressed up as a red finding.
                  const label = r.verdict === "strength" ? "Strength" : r.verdict === "weakness" ? "Weakness" : "Not assessed";
                  const color = r.verdict === "strength" ? "#15803d" : r.verdict === "weakness" ? "#b23121" : "#64748b";
                  // The cell shows the strongest 1-2 evidence observations; a
                  // long multi-window citation stack is collapsed behind an
                  // expand (see EvidenceCell). wordBreak stops a long file name
                  // stretching the table.
                  return (
                    <tr key={r.lineId}>
                      {!g.rowsFromLegs && i === 0 && dimCell(totalRows)}
                      <td style={{ verticalAlign: "top", fontSize: 11 }}>
                        <span style={{ fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap" }}>{r.itemRef}</span>
                        {refLabel(r.itemRef) && <div style={{ color: "#64748b", fontSize: 10.5, marginTop: 2 }}>{refLabel(r.itemRef)}</div>}
                      </td>
                      <td style={{ verticalAlign: "top", fontSize: 11.5, color, wordBreak: "break-word" }}>
                        <b>{label}:</b>{" "}
                        <EvidenceCell finding={r.finding} concise={conciseFindings[conciseKey(it.id, g.key, r.lineId)]?.text} />
                      </td>
                      <td style={{ verticalAlign: "top", fontSize: 11.5 }}>{renderAfi(r.afi, r.verdict === "weakness" ? { band: g.band, label: g.label } : undefined, r.verdict === "strength" ? nar?.requiredAction : undefined)}</td>
                    </tr>
                  );
                });
                if (g.rowsFromLegs) {
                  rowEls.unshift(
                    <tr key={`${g.key}-leg-leadin`}>
                      {dimCell(totalRows)}
                      <td colSpan={3} style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>
                        {g.rubricDefined === 0
                          ? `This item has no GD4 requirement line dedicated to ${g.label}, so it is assessed through the item's other lines instead. The rows below are the ${g.label} judgements recorded on those lines. This dimension IS assessed, just not via a requirement row of its own.`
                          : `The official rubric defines ${g.rubricDefined} ${g.label}-type requirement line${g.rubricDefined === 1 ? "" : "s"} for this item, but none is drafted yet; the rows below are this dimension's assessments recorded on the item's other lines.`}
                      </td>
                    </tr>
                  );
                }
                if (sug) {
                  const key = suggestionKey(it.id, g.key);
                  rowEls.push(
                    <tr key={`${g.key}-ai-suggestion`}>
                      <td colSpan={3} style={{ background: "#f5f7ff", fontSize: 11.5 }}>
                        {/* Item 4: the heading names the DIMENSION and states
                            the scope, so the suggestion never reads as
                            belonging only to the last row above it. */}
                        <span style={{ fontWeight: 700, color: "#4338ca" }}>AI suggestion for {g.label} (covers all rows above): </span>
                        <span style={{ color: "#374151" }}>{sug.text}</span>
                        <span className="no-print" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                          <ThumbsButtons
                            onAccept={() => logSuggestionDecision({ module: "Final Report", subjectId: key, field: "aiSuggestion", aiOutput: sug.text, humanDecision: sug.text, changed: false, decisionType: "Accepted", reason: "" })}
                            onReject={() => setSugFeedback({ key, text: sug.text })}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                } else if (missingSug) {
                  // Item 4 (other half of Symptom 1): the model's reply
                  // skipped this eligible dimension — say so visibly instead
                  // of silently showing nothing.
                  rowEls.push(
                    <tr key={`${g.key}-ai-missing`}>
                      <td colSpan={3} style={{ background: "#f8fafc", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                        No AI suggestion was generated for {g.label}. Click "Regenerate report text" above to fill it in.
                      </td>
                    </tr>
                  );
                }
                if (nar) {
                  const key = suggestionKey(it.id, g.key);
                  // The gold-standard shape: Strength paragraph, "However,"
                  // Weakness paragraph, neutral Band Assessment line, Required
                  // Action as a recommendation — reproduced verbatim from what
                  // the AI returned, never re-worded here.
                  const narText = [nar.strength, nar.weakness, nar.bandLine, nar.requiredAction].filter(Boolean).join("\n\n");
                  rowEls.push(
                    <tr key={`${g.key}-ai-narrative`}>
                      {/* wordBreak: a long unbroken token (file names in the
                          narrative) must wrap inside the cell, never stretch
                          the table (part of the 2026-07-18 table-break fix). */}
                      <td colSpan={3} style={{ background: "#fefce8", fontSize: 11.5, wordBreak: "break-word" }}>
                        <div style={{ fontWeight: 700, color: "#854d0e", marginBottom: 4 }}>
                          Auditor narrative for {g.label} (covers all rows above):
                          <span className="no-print" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                            <ThumbsButtons
                              onAccept={() => logSuggestionDecision({ module: "Final Report", subjectId: key, field: "dimensionNarrative", aiOutput: narText, humanDecision: narText, changed: false, decisionType: "Accepted", reason: "" })}
                              onReject={() => setSugFeedback({ key, text: narText, field: "dimensionNarrative" })}
                            />
                          </span>
                        </div>
                        {nar.strength && <p style={{ color: "#374151", margin: "0 0 6px" }}><b>Strength: </b>{nar.strength}</p>}
                        {nar.weakness && <p style={{ color: "#374151", margin: "0 0 6px" }}><b>Weakness: </b>{nar.weakness}</p>}
                        <p style={{ color: "#374151", margin: "0 0 6px" }}><b>Band assessment: </b>{nar.bandLine}</p>
                        {nar.requiredAction && <p style={{ color: "#374151", margin: 0 }}><b>Required action: </b>{nar.requiredAction}</p>}
                      </td>
                    </tr>
                  );
                } else if (missingNar) {
                  rowEls.push(
                    <tr key={`${g.key}-ai-narrative-missing`}>
                      <td colSpan={3} style={{ background: "#f8fafc", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                        Auditor narrative not yet generated for {g.label} — it is written automatically at the end of a run, or click "Regenerate report text" above.
                      </td>
                    </tr>
                  );
                }
                return rowEls;
              })}
            </tbody>
          </table>
        </div>
      )}
      {findings.length > 0 && (
        // The item's Findings register, folded in per item. Starts collapsed on
        // screen and in print (empty placeholders add nothing to a printed report).
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11.5, color: "#334155", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
            <span className="details-marker-closed" style={{ fontSize: 10, marginRight: 4, color: "#94a3b8" }}>▶</span>
            <span className="details-marker-open" style={{ fontSize: 10, marginRight: 4, color: "#94a3b8" }}>▼</span>
            Findings: root cause, gap &amp; closure ({findings.length})
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {findings.map((f) => (
              <div key={f.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill s={SEV_TONE[f.severity] || "medium"}>{f.severity}</Pill>
                  <Pill s={f.closed ? "good" : "medium"}>{f.closed ? "Closed" : f.status}</Pill>
                  {f.gapNature && <Pill s="neutral">{f.gapNature}</Pill>}
                  <span style={{ fontSize: 11.5, color: "#6b7280" }}>{f.type}</span>
                  <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                    {confirmDeleteId === f.id ? (
                      <>
                        <button onClick={() => { onDelete(f.id); setConfirmDeleteId(null); }} style={{ fontSize: 11, color: "#fff", background: "#ef4444", border: "none", borderRadius: 4, padding: "2px 7px", cursor: "pointer", marginRight: 4 }}>Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11, color: "#6b7280", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(f.id)} style={{ fontSize: 12, color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }} title="Delete finding">✕</button>
                    )}
                  </span>
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
        </details>
      )}
      {it.bandRationale && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 10.5, color: "#94a3b8", cursor: "pointer", userSelect: "none" }}>
            <span className="details-marker-closed" style={{ fontSize: 10, marginRight: 4, color: "#94a3b8" }}>▶</span>
            <span className="details-marker-open" style={{ fontSize: 10, marginRight: 4, color: "#94a3b8" }}>▼</span>
            Full band justification{it.bandTotalPct != null ? ` (APSR total ${it.bandTotalPct}%)` : ""}
          </summary>
          <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic", marginTop: 3 }}>
            AI narrative summary. It may refer to dimensions more loosely than the classified table above.
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{it.bandRationale}</div>
        </details>
      )}
      {it.generalNote && (
        <p style={{ fontSize: 11.5, color: "#2563eb", marginTop: 6 }}>{it.generalNote}</p>
      )}
      <FeedbackModal
        open={!!sugFeedback}
        aiOutput={sugFeedback?.text ?? ""}
        onClose={() => setSugFeedback(null)}
        onSubmit={(fb) => {
          logSuggestionDecision({ module: "Final Report", subjectId: sugFeedback?.key ?? it.id, field: sugFeedback?.field ?? "aiSuggestion", aiOutput: sugFeedback?.text ?? "", humanDecision: fb.correction || sugFeedback?.text || "", changed: !!fb.correction, decisionType: "Overridden", reason: fb.reason });
          setSugFeedback(null);
        }}
      />
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
