import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore, composeSchoolContext } from "../store/useWorkspaceStore";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Bar } from "../components/ui/Bar";
import { GOLD, INK, TONE } from "../lib/theme";
import { auditEvidence } from "../lib/evidenceAudit";
import { detectForensicFlags } from "../lib/forensicFlags";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { NAV } from "../nav";
import { runLiveCrossCriterionAnalysis, AIClientError } from "../lib/ai/agentRuntime";
import { effectiveSettings } from "../lib/ai/aiClient";

export function Dashboard() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const saveAsNewVersion = useWorkspaceStore((s) => s.saveAsNewVersion);
  const loadDemoDataset = useWorkspaceStore((s) => s.loadDemoDataset);
  const auditorsCount = useWorkspaceStore((s) => s.auditors.length);
  const auditAllFolders = useWorkspaceStore((s) => s.auditAllFolders);
  const auditChangedFolders = useWorkspaceStore((s) => s.auditChangedFolders);
  const raiseAllUnmetFindings = useChecklistModuleStore((s) => s.raiseAllUnmetFindings);
  const bulkAuditStatus = useWorkspaceStore((s) => s.bulkAuditStatus);
  const runEvidenceAudit = useWorkspaceStore((s) => s.runEvidenceAudit);
  const evidenceAuditReport = useWorkspaceStore((s) => s.evidenceAuditReport);
  const auditJournal = useWorkspaceStore((s) => s.auditJournal);
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const pushAIReviewLog = useWorkspaceStore((s) => s.pushAIReviewLog);
  const foldersWithLink = useWorkspaceStore((s) => s.folders.filter((f) => (f.folderLink && f.folderLink.trim()) || (f.policyLink && f.policyLink.trim())).length);
  const navigate = useNavigate();
  const scored = useScored();
  const findings = useAllFindings();
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const folders = useWorkspaceStore((s) => s.folders);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const aiSettings = useAISettingsStore();
  const aiEnabled = aiSettings.enabled && !!aiSettings.apiKey;

  type AnalysisResult = {
    priorities: string[];
    systemicIssues: string[];
    starPath: string;
    immediateActions: string[];
  };
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisRef = useRef<HTMLDivElement | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ text: string; field: string } | null>(null);

  async function runStrategicAnalysis() {
    setAnalysisBusy(true);
    setAnalysisError(null);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(schoolContext) });
      // Group by criterion, take minimum band per criterion
      const criterionMap: Record<string, { title: string; minBand: number }> = {};
      for (const item of scored.items) {
        const critId = item.id.split(".")[0];
        const existing = criterionMap[critId];
        if (!existing || item.band < existing.minBand) {
          criterionMap[critId] = { title: item.id, minBand: item.band };
        }
      }
      // Use GD4_CRITERIA titles if available — import from data
      const criterionBands = Object.entries(criterionMap).map(([id, v]) => ({
        id,
        title: v.title,
        band: v.minBand,
      }));
      const result = await runLiveCrossCriterionAnalysis(
        {
          journal: auditJournal,
          findings: findings.map((f) => ({
            gd4ItemId: f.gd4ItemId,
            issue: f.issue,
            observation: f.observation,
            effect: f.effect,
            dimension: f.dimension,
            riskCategory: f.riskCategory,
          })),
          criterionBands,
          totalScore: scored.total,
          award: scored.award,
        },
        settings
      );
      setAnalysisResult(result);
      // Record this AI run in the shared AI Review Log so every AI use is tracked.
      pushAIReviewLog({
        agent: "Strategic Consultant",
        reviewType: "CrossCriterion",
        subjectId: "All criteria",
        verdict: `${result.priorities.length} priorit${result.priorities.length === 1 ? "y" : "ies"}, ${result.systemicIssues.length} systemic issue(s)`,
        confidence: "Medium",
        keyConcerns: result.systemicIssues.length ? result.systemicIssues : result.priorities,
        recommendedAction: result.immediateActions[0] || "Review the strategic priorities below.",
        live: true,
        generatedContent: `PRIORITIES:\n${result.priorities.join("\n")}\n\nSYSTEMIC ISSUES:\n${result.systemicIssues.join("\n")}\n\nPATH TO STAR:\n${result.starPath}\n\nIMMEDIATE ACTIONS:\n${result.immediateActions.join("\n")}`,
        usage: result.usage,
      });
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setAnalysisError(err instanceof AIClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysisBusy(false);
    }
  }

  // The report renders below the score header, so on a tall page a click on
  // the button could otherwise look like nothing happened — scroll it into
  // view whenever it opens.
  useEffect(() => {
    if (evidenceAuditReport) reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [evidenceAuditReport]);

  const belowBand3 = scored.items.filter((i) => i.band < 3).length;
  const closures = useWorkspaceStore((s) => s.closures);
  const openCritical = findings.filter((a) => a.severity === "Critical" && (closures[a.id]?.human || "") !== "Accepted").length;
  const finalisationReady = scored.gatePass && scored.openAFIs === 0;

  // Quick-win calculator: items below Band 3, ranked by impact/effort.
  // Effort = band gap to Band 3 (1 = close, higher = more work).
  // Impact = maxPoints from the GD4 rubric (bigger criterion = higher reward).
  const quickWins = useMemo(() => {
    return scored.items
      .filter((i) => i.started && i.band < 3)
      .map((i) => {
        const req = GD4_REQUIREMENTS.find((r) => r.id === i.id);
        const effort = Math.max(1, 3 - i.band);
        const impact = req?.maxPoints ?? 1;
        return { id: i.id, title: i.title, band: i.band, impact, effort, score: impact / effort };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [scored.items]);

  // Forensic integrity flags (date clustering + out-of-period evidence)
  const forensicFlags = useMemo(
    () => detectForensicFlags(checklistEntries, cycle.periodStart, cycle.periodEnd),
    [checklistEntries, cycle.periodStart, cycle.periodEnd]
  );

  // Mirrors the 6 numbered groups in nav.ts so the Dashboard guide and the
  // sidebar always describe the same workflow stages — one source of truth.
  const totalItems = scored.items.length;
  const evidenceAttached = scored.items.filter((i) => i.ev.drive || i.checklistOverride).length;
  const itemsScored = scored.items.filter((i) => i.started).length;
  const samplesRecorded = Object.values(checklistEntries).reduce((sum, e) => sum + e.specific.filter((l) => l.sampling).length, 0);
  const findingsClosed = findings.length - scored.openAFIs;

  const gateGroupsSummary = scored.gateFail.length === 0
    ? `${scored.gateFail.length === 0 ? "3/3" : `${3 - scored.gateFail.length}/3`} gate groups at Band 3+`
    : `${3 - scored.gateFail.length}/3 gate groups at Band 3+ — failing: ${scored.gateFail.map((g) => g.id).join(", ")}`;

  function stepProgress(step: number): { label: string; pct: number | null } {
    switch (step) {
      case 1:
        return { label: auditorsCount > 0 ? `${auditorsCount} auditor(s) added` : "No auditors added yet", pct: auditorsCount > 0 ? 100 : 0 };
      case 2:
        return { label: `${evidenceAttached}/${totalItems} items have evidence attached`, pct: totalItems ? Math.round((evidenceAttached / totalItems) * 100) : 0 };
      case 3:
        return {
          label: `${itemsScored}/${totalItems} items scored · Gate: ${gateGroupsSummary}`,
          pct: totalItems ? Math.round((itemsScored / totalItems) * 100) : 0,
        };
      case 4:
        return { label: samplesRecorded > 0 ? `${samplesRecorded} sample(s) recorded` : "Not started yet", pct: samplesRecorded > 0 ? 100 : 0 };
      case 5:
        return { label: findings.length ? `${findingsClosed}/${findings.length} findings closed` : "No findings raised yet", pct: findings.length ? Math.round((findingsClosed / findings.length) * 100) : null };
      case 6:
        return { label: finalisationReady ? "Ready to finalise" : "Blocked on gate / open AFIs", pct: finalisationReady ? 100 : 0 };
      default:
        return { label: "", pct: null };
    }
  }

  const workflowSteps = NAV.filter((g) => g.step != null);

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
        <div style={{ fontSize: 11, color: "#7e8da0", marginTop: 8 }}>Not an official SSG or EduTrust result. Placeholder scoring table pending UCC's official GD4 rubric.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={() => {
              if (confirm("Use demo data? This fills in evidence ratings, reviewer scores, closures, samples, interview prep and the management review pack with sample data, overwriting any existing entries in those fields.")) loadDemoDataset();
            }}
            style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: GOLD, fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
          >
            Use demo data
          </button>
          <button
            onClick={() => runEvidenceAudit(auditEvidence(scored.items, checklistEntries, folders))}
            style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: "#9fe0bd", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
          >
            Recheck all evidence
          </button>
          <button
            disabled={!!bulkAuditStatus || foldersWithLink === 0}
            title={foldersWithLink === 0 ? "Add a Drive folder link on the Evidence Folder page first." : `Reads every linked folder and scores all ${foldersWithLink} of them in one pass.`}
            onClick={async () => {
              if (!confirm(`Read and audit all ${foldersWithLink} folder(s) that have a Drive link? This generates checklist lines where missing, reads each folder's evidence, sets the checklist statuses and updates the bands/score. You'll land on the Scorecard when it finishes.`)) return;
              await auditAllFolders();
              // Refresh evidence audit report after a bulk audit so summary stays current
              runEvidenceAudit(auditEvidence(scored.items, checklistEntries, folders));
              navigate("/scorecard");
            }}
            style={{ cursor: bulkAuditStatus ? "default" : "pointer", border: "1px solid #3a4660", background: bulkAuditStatus ? "#3a4660" : "transparent", color: GOLD, fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12, opacity: foldersWithLink === 0 ? 0.5 : 1 }}
          >
            {bulkAuditStatus ? "Auditing…" : "Audit all folders → score"}
          </button>
          <button
            disabled={!!bulkAuditStatus || foldersWithLink === 0}
            title={foldersWithLink === 0 ? "Add a Drive folder link on the Evidence Folder page first." : "Re-reads only folders whose files changed since their last audit — skips unchanged ones to save time and AI cost."}
            onClick={async () => {
              const r = await auditChangedFolders();
              alert(`Re-audit of changed folders complete.\n\nAudited: ${r.audited}\nSkipped (unchanged): ${r.skipped}\nNot linked: ${r.unlinked}`);
              if (r.audited > 0) navigate("/scorecard");
            }}
            style={{ cursor: bulkAuditStatus ? "default" : "pointer", border: "1px solid #3a4660", background: "transparent", color: GOLD, fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12, opacity: foldersWithLink === 0 ? 0.5 : 1 }}
          >
            Re-audit changed only
          </button>
          <button
            title="Turns every unresolved checklist line (Not met, or marked done but with no evidence) into a draft AFI in the Findings register for you to action."
            onClick={() => {
              if (!confirm("Raise a draft finding for every checklist line that is Not met, or marked done with no evidence attached? Lines that already produced a finding are skipped. You can edit or delete them afterwards in the Findings register.")) return;
              const n = raiseAllUnmetFindings();
              alert(n === 0 ? "No new findings to raise — every unresolved line already has one (or there are no unresolved lines)." : `Raised ${n} draft finding${n === 1 ? "" : "s"} into the Findings register.`);
              if (n > 0) navigate("/findings");
            }}
            style={{ cursor: "pointer", border: "1px solid #3a4660", background: "transparent", color: "#f4b3aa", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
          >
            Raise findings from gaps
          </button>
          {aiEnabled && (
            <button
              disabled={analysisBusy || (findings.length === 0 && !auditJournal)}
              title="Synthesises criterion bands, findings, and the audit journal into strategic priorities, systemic issues, a path to Star, and the single most urgent action."
              onClick={runStrategicAnalysis}
              style={{ cursor: analysisBusy ? "default" : "pointer", border: "1px solid #3a4660", background: "transparent", color: "#c4b5fd", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12, opacity: findings.length === 0 && !auditJournal ? 0.5 : 1 }}
            >
              {analysisBusy ? "Analysing…" : "Strategic AI analysis"}
            </button>
          )}
        </div>
        {bulkAuditStatus && <div style={{ fontSize: 11.5, color: "#aeb8c7", marginTop: 8 }}>{bulkAuditStatus}</div>}
        {analysisError && <div style={{ fontSize: 11.5, color: "#f4b3aa", marginTop: 8 }}>Strategic analysis failed: {analysisError}</div>}
      </Card>

      {analysisResult && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <div ref={analysisRef} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Strategic analysis (AI)</h3>
            <button onClick={() => setAnalysisResult(null)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#6b7280", fontSize: 12 }}>Clear</button>
          </div>
          {analysisResult.priorities.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Top 3 priorities</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "#374151" }}>
                {analysisResult.priorities.map((p, i) => (
                  <li key={i} style={{ marginBottom: 4, lineHeight: 1.5 }}>
                    {p}
                    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
                      <button onClick={() => logHumanDecision({ module: "Cross-Criterion Analysis", subjectId: "all-criteria", field: "priorities", aiOutput: p, humanDecision: p, changed: false, decisionType: "Accepted", reason: "" })} title="AI was helpful" style={{ background: "none", border: "1px solid #d1fae5", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#15803d" }}>👍</button>
                      <button onClick={() => setFeedbackTarget({ text: p, field: "priorities" })} title="AI was wrong" style={{ background: "none", border: "1px solid #fee2e2", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#b91c1c" }}>👎</button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {analysisResult.systemicIssues.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Systemic issues</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "#374151" }}>
                {analysisResult.systemicIssues.map((s, i) => (
                  <li key={i} style={{ marginBottom: 4, lineHeight: 1.5 }}>
                    {s}
                    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
                      <button onClick={() => logHumanDecision({ module: "Cross-Criterion Analysis", subjectId: "all-criteria", field: "systemicIssues", aiOutput: s, humanDecision: s, changed: false, decisionType: "Accepted", reason: "" })} title="AI was helpful" style={{ background: "none", border: "1px solid #d1fae5", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#15803d" }}>👍</button>
                      <button onClick={() => setFeedbackTarget({ text: s, field: "systemicIssues" })} title="AI was wrong" style={{ background: "none", border: "1px solid #fee2e2", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#b91c1c" }}>👎</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysisResult.starPath && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Path to Star (4-Year)</div>
              <p style={{ margin: 0, fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>{analysisResult.starPath}</p>
            </div>
          )}
          {analysisResult.immediateActions.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #d97706", borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Immediate action</div>
              {analysisResult.immediateActions.map((a, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>
                  {a}
                  <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, verticalAlign: "middle" }}>
                    <button onClick={() => logHumanDecision({ module: "Cross-Criterion Analysis", subjectId: "all-criteria", field: "immediateActions", aiOutput: a, humanDecision: a, changed: false, decisionType: "Accepted", reason: "" })} title="AI was helpful" style={{ background: "none", border: "1px solid #d1fae5", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#15803d" }}>👍</button>
                    <button onClick={() => setFeedbackTarget({ text: a, field: "immediateActions" })} title="AI was wrong" style={{ background: "none", border: "1px solid #fee2e2", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "2px 6px", color: "#b91c1c" }}>👎</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {evidenceAuditReport && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <div ref={reportRef} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>Evidence recheck report ({evidenceAuditReport.flags.length})</h3>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Generated {evidenceAuditReport.generatedAt}</div>
            </div>
            <button onClick={() => runEvidenceAudit(null)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#6b7280", fontSize: 12 }}>
              Close
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
            Report only — re-derives the same evidence gaps the scoring engine already caps bands for. Nothing on the workspace is changed by running this.
          </div>
          {evidenceAuditReport.flags.length === 0 ? (
            <p style={{ fontSize: 13, color: TONE.good.fg }}>No unverified-evidence items found — every band-carrying item has at least some evidence attached.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Source</th>
                  <th>Band</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {evidenceAuditReport.flags.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link to={`/evidence-folder?sub=${encodeURIComponent(f.subCriterionId)}`} style={{ color: INK, fontWeight: 600 }} title={`Open the ${f.subCriterionId} evidence folder`}>
                        <b>{f.id}</b> {f.title}
                      </Link>
                    </td>
                    <td>
                      <Pill s="progress">{f.source}</Pill>
                    </td>
                    <td>
                      <Pill s={f.band <= 1 ? "critical" : "medium"}>Band {f.band}</Pill>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Getting started — the audit workflow</h3>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Work through these in order. Each step links to the matching section in the sidebar.
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {workflowSteps.map((g) => {
            const plainLabel = g.group.replace(/^\d+ · /, "");
            const progress = stepProgress(g.step!);
            return (
              <div key={g.group} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 99,
                      background: progress.pct === 100 ? TONE.good.bg : "#eef1f5",
                      color: progress.pct === 100 ? TONE.good.fg : "#475569",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {g.step}
                  </span>
                  <b style={{ fontSize: 13 }}>{plainLabel}</b>
                </div>
                <div style={{ fontSize: 11.5, color: "#6b7280", margin: "6px 0" }}>{g.hint}</div>
                {progress.pct != null && <Bar v={progress.pct} c={progress.pct === 100 ? TONE.good.fg : INK} />}
                <div style={{ fontSize: 12, marginTop: 4 }}>{progress.label}</div>
                <Link to={g.items[0].path} style={{ fontSize: 12, display: "inline-block", marginTop: 6 }}>
                  Open {g.items[0].label} →
                </Link>
              </div>
            );
          })}
        </div>
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
        <button
          onClick={() => saveAsNewVersion("", "Quick save from dashboard")}
          style={{ marginTop: 8, cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
        >
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
          Findings needing a leadership decision: <b>{findings.filter((f) => f.managementDecisionNeeded).length}</b>
        </div>
        <Link to="/management-review" style={{ fontSize: 12, display: "inline-block", marginTop: 8 }}>
          Open management review →
        </Link>
      </Card>

      {quickWins.length > 0 && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Quick-win calculator — top {quickWins.length} highest-return items below Band 3</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
            Ranked by award-point impact ÷ effort to reach Band 3. Fix these first for the biggest score uplift with the least work.
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Current band</th>
                <th>Max points</th>
                <th>Effort (band gap)</th>
                <th>Priority score</th>
              </tr>
            </thead>
            <tbody>
              {quickWins.map((w, i) => (
                <tr key={w.id} className="rowh">
                  <td style={{ fontSize: 12, fontWeight: 700 }}>{i + 1}</td>
                  <td>
                    <Link to={`/sub-criterion-checklist?item=${encodeURIComponent(w.id)}`} style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
                      <b>{w.id}</b> {w.title.slice(0, 55)}{w.title.length > 55 ? "…" : ""}
                    </Link>
                  </td>
                  <td><Pill s={w.band <= 1 ? "critical" : "medium"}>Band {w.band}</Pill></td>
                  <td style={{ fontSize: 12 }}>{w.impact} pts</td>
                  <td style={{ fontSize: 12 }}>{w.effort} {w.effort === 1 ? "band" : "bands"}</td>
                  <td style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? TONE.good.fg : INK }}>{w.score.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {forensicFlags.length > 0 && (
        <Card style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Forensic integrity flags ({forensicFlags.length})</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
            Patterns detected in evidence dates that may indicate bulk document creation or out-of-period records.
            Review before submitting.
          </p>
          {forensicFlags.map((f, i) => (
            <div key={i} style={{ background: f.severity === "High" ? "#fff1f2" : "#fffbeb", border: `1px solid ${f.severity === "High" ? "#fca5a5" : "#fcd34d"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Pill s={f.severity === "High" ? "critical" : "medium"}>{f.severity}</Pill>
                <b style={{ fontSize: 12.5 }}>{f.type === "date-cluster" ? "Evidence date clustering" : "Out-of-period evidence"}</b>
              </div>
              <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>{f.description}</div>
              {f.affectedItems.length > 0 && (
                <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 4 }}>
                  Affected: {f.affectedItems.join(", ")}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <FeedbackModal
        open={feedbackTarget !== null}
        aiOutput={feedbackTarget?.text ?? ""}
        module="Cross-Criterion Analysis"
        onClose={() => setFeedbackTarget(null)}
        onSubmit={(feedback) => {
          if (!feedbackTarget) return;
          logHumanDecision({ module: "Cross-Criterion Analysis", subjectId: "all-criteria", field: feedbackTarget.field, aiOutput: feedbackTarget.text, humanDecision: feedback.correction || feedbackTarget.text, changed: !!feedback.correction, decisionType: "Overridden", reason: feedback.reason });
          if (!feedback.correct) {
            addCalibrationMemory({ module: "Cross-Criterion Analysis", subjectId: "all-criteria", context: feedbackTarget.field, aiOutput: feedbackTarget.text, staffCorrection: feedback.correction, keyLearning: `When assessing ${feedbackTarget.field}, prefer "${feedback.correction.slice(0, 100)}" over "${feedbackTarget.text.slice(0, 100)}"`, status: "active", tokenCount: feedbackTarget.text.length + feedback.correction.length });
          }
          setFeedbackTarget(null);
        }}
      />
    </div>
  );
}
