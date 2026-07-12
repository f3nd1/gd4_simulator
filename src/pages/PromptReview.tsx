import { useMemo, useState } from "react";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { AiOutputView } from "../components/ui/AiOutputView";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { usePromptReviewStore } from "../store/usePromptReviewStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { chatComplete, effectiveSettings, aiOfflineReason } from "../lib/ai/aiClient";
import { reviseUserPrompt } from "../lib/ai/promptReviser";
import type { PromptRatingLevel, ComplianceRiskLevel, PromptReviewRatings, PromptReviewStatus } from "../types";

const QUALITY_LEVELS: PromptRatingLevel[] = ["Strong", "Adequate", "Weak"];
const RISK_LEVELS: ComplianceRiskLevel[] = ["Low", "Medium", "High"];

const DEFAULT_RATINGS: PromptReviewRatings = {
  accuracy: "Adequate", completeness: "Adequate", relevance: "Adequate", tone: "Adequate", complianceRisk: "Low",
};

// The one place the "poor rating" trigger is defined (confirmed with the user:
// Weak on any quality dimension, OR High compliance risk).
function needsCorrection(r: PromptReviewRatings): boolean {
  return r.accuracy === "Weak" || r.completeness === "Weak" || r.relevance === "Weak" || r.tone === "Weak" || r.complianceRisk === "High";
}

const STATUS_LABEL: Record<PromptReviewStatus, string> = {
  reviewed_ok: "Looks good",
  needs_revision: "Needs work",
  revision_drafted: "Revision ready to review",
  revision_live: "Revision live",
};
const STATUS_TONE: Record<PromptReviewStatus, string> = {
  reviewed_ok: "good", needs_revision: "critical", revision_drafted: "medium", revision_live: "progress",
};

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

export function PromptReview() {
  const prompts = usePromptReviewStore((s) => s.prompts);
  const records = usePromptReviewStore((s) => s.records);
  const addPrompt = usePromptReviewStore((s) => s.addPrompt);
  const updatePrompt = usePromptReviewStore((s) => s.updatePrompt);
  const removePrompt = usePromptReviewStore((s) => s.removePrompt);
  const addReview = usePromptReviewStore((s) => s.addReview);
  const promoteRevision = usePromptReviewStore((s) => s.promoteRevision);

  const aiSettings = useAISettingsStore((s) => s);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const activeAuditorId = useWorkspaceStore((s) => s.activeAuditorId);
  const cycleOwner = useWorkspaceStore((s) => s.cycle.owner);
  // Reviewer identity — resolved from the active auditor exactly as `closedBy`
  // is elsewhere (auditor name → cycle owner → "Unattributed").
  const reviewer = auditors.find((a) => a.id === activeAuditorId)?.name || cycleOwner || "Unattributed";

  const offlineReason = aiOfflineReason(aiSettings);

  const [selectedId, setSelectedId] = useState<string>("");
  const selected = prompts.find((p) => p.id === selectedId) || null;

  // New-prompt form.
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newText, setNewText] = useState("");

  // Review working state (reset when the selected prompt changes).
  const [output, setOutput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [ratings, setRatings] = useState<PromptReviewRatings>(DEFAULT_RATINGS);
  const [missingInfo, setMissingInfo] = useState("");
  const [suggestedImprovement, setSuggestedImprovement] = useState("");
  const [feedback, setFeedback] = useState<{ correction: string; reason: string } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [revisedDraft, setRevisedDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const triggered = needsCorrection(ratings);
  const feedbackDone = !!feedback && feedback.correction.trim().length > 0 && feedback.reason.trim().length > 0;

  function resetReview() {
    setOutput(""); setGenerating(false); setRatings(DEFAULT_RATINGS); setMissingInfo(""); setSuggestedImprovement("");
    setFeedback(null); setFeedbackOpen(false); setDrafting(false); setRevisedDraft(""); setError(null); setSavedNote(null);
  }

  function selectPrompt(id: string) { setSelectedId(id); resetReview(); }

  function createPrompt() {
    if (!newName.trim() || !newText.trim()) { setError("Give the prompt a name and some text."); return; }
    const id = addPrompt({ name: newName.trim(), purpose: newPurpose.trim(), text: newText.trim() });
    setNewName(""); setNewPurpose(""); setNewText(""); setShowNew(false); setError(null);
    selectPrompt(id);
  }

  async function generateOutput() {
    if (!selected) return;
    setError(null);
    if (offlineReason) { setError(offlineReason); return; }
    setGenerating(true);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
      // plainText: a user-authored prompt may not mention JSON at all, and
      // OpenAI rejects json_object requests whose messages don't contain the
      // word "json" — the lab must run ANY prompt, so let the prompt itself
      // decide the output format.
      const content = await chatComplete([{ role: "user", content: selected.text }], settings, { plainText: true, temperature: 0.3 });
      setOutput(content.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function draftRevision() {
    if (!selected) return;
    setError(null);
    if (offlineReason) { setError(offlineReason); return; }
    if (!feedbackDone) { setError("Add the correction details first (what's the correct answer, and why the output was wrong)."); return; }
    setDrafting(true);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
      const revised = await reviseUserPrompt({
        originalPrompt: selected.text, aiOutput: output, ratings, missingInfo, suggestedImprovement,
        correction: feedback!.correction, reason: feedback!.reason, settings,
      });
      setRevisedDraft(revised);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }

  // Save the connected record (+ mirror into the Human Decision Log). goLive
  // promotes the drafted revision to operational in the same explicit click.
  function saveReview(goLive: boolean) {
    if (!selected) return;
    if (triggered && !feedbackDone) { setError("This output was rated weak — add the correction details before saving."); return; }
    const status: PromptReviewStatus = !triggered
      ? "reviewed_ok"
      : revisedDraft.trim()
        ? "revision_drafted"
        : "needs_revision";
    const recId = addReview({
      promptId: selected.id, promptName: selected.name,
      originalPrompt: selected.text, output,
      ratings, missingInfo: missingInfo.trim(), suggestedImprovement: suggestedImprovement.trim(),
      correction: feedback?.correction.trim() ?? "", reason: feedback?.reason.trim() ?? "",
      revisedPrompt: revisedDraft.trim() || null, reviewer,
      decisionType: triggered ? "Overridden" : "Accepted", status,
    });
    // Mirror the event into the existing Human Decision Log audit trail.
    logHumanDecision({
      module: "Prompt Review", subjectId: selected.id, aiOutput: output,
      humanDecision: triggered ? (revisedDraft.trim() ? "Revised the prompt" : "Flagged for revision") : "Accepted output",
      changed: triggered, decisionType: triggered ? "Overridden" : "Accepted",
      reason: feedback?.reason.trim() ?? "",
    });
    if (goLive && revisedDraft.trim()) {
      promoteRevision(recId); // the champion gate — explicit human confirmation
      setSavedNote("Saved. The revised prompt is now the live version of this prompt.");
    } else {
      setSavedNote(status === "reviewed_ok" ? "Saved. Output accepted — no changes made." : "Saved. The revision is kept for review; the current prompt stays live until you make it live.");
    }
    resetReviewKeepPrompt();
  }

  function resetReviewKeepPrompt() {
    setOutput(""); setRatings(DEFAULT_RATINGS); setMissingInfo(""); setSuggestedImprovement("");
    setFeedback(null); setDrafting(false); setRevisedDraft(""); setError(null);
  }

  const promptRecords = useMemo(
    () => (selected ? records.filter((r) => r.promptId === selected.id) : records),
    [records, selected]
  );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Prompt Review</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Review an AI output, rate it on a few simple measures, and — if it's weak — let the AI suggest a better version
          of the instruction (the "prompt") behind it. Nothing changes automatically: the AI recommends, you decide, and
          a revised prompt only goes live when you say so. This works on your own saved prompts here; it does not change
          the app's built-in audit prompts.
        </p>
        {offlineReason && (
          <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "8px 11px" }}>
            ⚠ AI is not available, so "Generate output" and "Draft an improved prompt" are turned off: {offlineReason}
          </div>
        )}
      </Card>

      {/* Prompt picker + create */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>1 · Pick a prompt to review</h3>
          <select value={selectedId} onChange={(e) => selectPrompt(e.target.value)} style={{ ...inputStyle, width: 280 }}>
            <option value="">— choose a saved prompt —</option>
            {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.purpose ? ` · ${p.purpose}` : ""}</option>)}
          </select>
          <button onClick={() => setShowNew((v) => !v)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff" }}>
            {showNew ? "Cancel" : "New prompt"}
          </button>
        </div>

        {showNew && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <input placeholder="Name (e.g. 'Quality Action write-up')" value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} />
              <input placeholder="Purpose (e.g. Quality Action, Audit Findings, Meeting Minutes)" value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)} style={inputStyle} />
            </div>
            <textarea placeholder="The prompt text — the instruction you give the AI." value={newText} onChange={(e) => setNewText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            <div><button onClick={createPrompt} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff" }}>Save prompt</button></div>
          </div>
        )}

        {selected && (
          <div style={{ marginTop: 12, background: "#f8fafc", border: "1px solid #e8edf3", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{selected.name}</span>
              {selected.purpose && <Pill s="neutral">{selected.purpose}</Pill>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button onClick={() => { const t = prompt("Edit the prompt text:", selected.text); if (t != null) updatePrompt(selected.id, { text: t }); }} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Edit text</button>
                <button onClick={() => { if (confirm(`Delete prompt "${selected.name}" and its ${records.filter((r) => r.promptId === selected.id).length} review record(s)? This cannot be undone.`)) { removePrompt(selected.id); setSelectedId(""); resetReview(); } }} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}>Delete</button>
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Current live prompt text:</div>
            <AiOutputView text={selected.text} style={{ fontSize: 12 }} />
          </div>
        )}
      </Card>

      {selected && (
        <>
          {/* Output to review */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>2 · The AI output to review</h3>
              <button disabled={generating || !!offlineReason} onClick={generateOutput} style={{ cursor: generating || offlineReason ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: generating || offlineReason ? 0.6 : 1 }}>
                {generating ? "Generating…" : "Generate output with AI"}
              </button>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>…or paste an output below.</span>
            </div>
            <textarea value={output} onChange={(e) => setOutput(e.target.value)} rows={5} placeholder="The AI-generated output you want to review." style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
          </Card>

          {/* Review section */}
          <Card>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>3 · Rate the output</h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              {([["accuracy", "Accuracy"], ["completeness", "Completeness"], ["relevance", "Relevance"], ["tone", "Tone & wording"]] as const).map(([key, label]) => (
                <label key={key} style={{ display: "block" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569" }}>{label}</span>
                  <select value={ratings[key]} onChange={(e) => setRatings((r) => ({ ...r, [key]: e.target.value as PromptRatingLevel }))} style={{ ...inputStyle, marginTop: 3, borderColor: ratings[key] === "Weak" ? "#fca5a5" : undefined }}>
                    {QUALITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              ))}
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569" }}>Compliance risk</span>
                <select value={ratings.complianceRisk} onChange={(e) => setRatings((r) => ({ ...r, complianceRisk: e.target.value as ComplianceRiskLevel }))} style={{ ...inputStyle, marginTop: 3, borderColor: ratings.complianceRisk === "High" ? "#fca5a5" : undefined }}>
                  {RISK_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569" }}>Missing information (optional)</span>
                <textarea value={missingInfo} onChange={(e) => setMissingInfo(e.target.value)} rows={2} style={{ ...inputStyle, marginTop: 3, resize: "vertical", fontFamily: "inherit" }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569" }}>Suggested improvement (optional)</span>
                <textarea value={suggestedImprovement} onChange={(e) => setSuggestedImprovement(e.target.value)} rows={2} style={{ ...inputStyle, marginTop: 3, resize: "vertical", fontFamily: "inherit" }} />
              </label>
            </div>

            {/* Trigger banner */}
            {triggered ? (
              <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, color: "#7f1d1d", fontWeight: 600, marginBottom: 6 }}>
                  ⚠ This output was rated weak (or high compliance risk), so it needs correction before it can be used.
                </div>
                <button onClick={() => setFeedbackOpen(true)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #b91c1c", background: "#fff", color: "#b91c1c" }}>
                  {feedbackDone ? "Edit correction details" : "Add correction details"}
                </button>
                {feedbackDone && <span style={{ marginLeft: 8, fontSize: 11.5, color: "#15803d" }}>✓ correction captured</span>}
              </div>
            ) : (
              <div style={{ marginTop: 12, fontSize: 12, color: "#15803d" }}>✓ No weak ratings — you can save this as an accepted output.</div>
            )}
          </Card>

          {/* Prompt improvement */}
          {triggered && (
            <Card>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>4 · Improve the prompt</h3>
              <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
                Based on your correction, the AI can suggest a better version of this prompt. You'll see it here before anything is saved.
              </p>
              <button disabled={drafting || !feedbackDone || !!offlineReason} onClick={draftRevision} style={{ cursor: drafting || !feedbackDone || offlineReason ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", opacity: drafting || !feedbackDone || offlineReason ? 0.55 : 1 }}>
                {drafting ? "Drafting…" : "Draft an improved prompt"}
              </button>
              {revisedDraft && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Suggested improved prompt (you can edit it before saving):</div>
                  <textarea value={revisedDraft} onChange={(e) => setRevisedDraft(e.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", background: "#faf5ff", borderColor: "#c4b5fd" }} />
                </div>
              )}
            </Card>
          )}

          {/* Save / go live */}
          <Card>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>5 · Save this review</h3>
            {error && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{error}</div>}
            {savedNote && <div style={{ fontSize: 12, color: "#15803d", marginBottom: 8 }}>{savedNote}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => saveReview(false)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}>
                {triggered ? (revisedDraft.trim() ? "Save review (keep current prompt live)" : "Save review") : "Save — output accepted"}
              </button>
              {triggered && revisedDraft.trim() && (
                <button onClick={() => saveReview(true)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "none", background: "#15803d", color: "#fff" }}>
                  Save & make the improved prompt live
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "8px 0 0" }}>
              "Make live" replaces this prompt's current text with the improved version — the only action that changes what's used going forward. Reviewer on record: <b>{reviewer}</b>.
            </p>
          </Card>
        </>
      )}

      {/* Connected review log */}
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Review log{selected ? ` — ${selected.name}` : " (all prompts)"}</h3>
        {promptRecords.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No reviews recorded yet.</p>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Reviewer</th><th>Prompt</th><th>Ratings</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {promptRecords.map((r) => (
                <tr key={r.id} className="rowh">
                  <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "#475569" }}>{fmt(r.timestamp)}</td>
                  <td style={{ fontSize: 12 }}>{r.reviewer}</td>
                  <td style={{ fontSize: 12 }}>{r.promptName}</td>
                  <td style={{ fontSize: 11 }}>A:{r.ratings.accuracy[0]} C:{r.ratings.completeness[0]} R:{r.ratings.relevance[0]} T:{r.ratings.tone[0]} · risk {r.ratings.complianceRisk}</td>
                  <td><Pill s={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.status === "revision_drafted" && r.revisedPrompt && (
                      <button onClick={() => { if (confirm("Make this revised prompt the live version? It will replace the prompt's current text.")) promoteRevision(r.id); }} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d" }}>Make live</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <FeedbackModal
        open={feedbackOpen}
        aiOutput={output}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={(fb) => {
          // In this flow the reviewer opened correction because a rating was
          // weak; capture the correction + reason (reused modal's contract).
          if (!fb.correct && (fb.correction.trim() || fb.reason.trim())) {
            setFeedback({ correction: fb.correction, reason: fb.reason });
          }
        }}
      />
    </div>
  );
}
