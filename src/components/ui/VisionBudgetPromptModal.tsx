import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { fmtUSD } from "../../lib/aiCost";
import type { CSSProperties } from "react";

const primaryBtn: CSSProperties = { cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 7, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff" };
const secondaryBtn: CSSProperties = { cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 7, border: "1px solid #4a5a8a", background: "#fff", color: "#4a5a8a" };

// Blocking decision when a run's vision-image budget ran out: every evidence
// file the budget forced it to skip is collected first, then this one prompt
// covers all of them. No backdrop-dismiss, no default choice, so the run
// genuinely pauses until the user picks. Mounted ONCE in Layout — app-wide,
// unconditional — because runEvidenceAssessment awaits this answer no matter
// which page launched the run: when it was mounted only on the PPD Review page
// (filtered to that page's selected sub-criterion), a Hybrid/Full-auto run on
// the Evidence Folder page blocked forever on a question no page was showing
// (a real 6-hour hang, 2026-07-20). z-index sits above every run overlay.
export function VisionBudgetPromptModal() {
  const prompt = useWorkspaceStore((s) => s.visionBudgetPrompt);
  const onChoose = useWorkspaceStore((s) => s.resolveVisionBudgetPrompt);
  if (!prompt) return null;
  const n = prompt.fileNames.length;
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ backgroundColor: "#fff", borderRadius: 12, maxWidth: 480, width: "100%", padding: 20, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#92400e" }}>⚠ Vision image budget reached — {prompt.subCriterionId}</div>
        <p style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5, margin: 0 }}>
          This run read <b>{prompt.budgetMax} images</b> (scanned pages / photos), then ran out of budget for <b>{n} evidence file{n === 1 ? "" : "s"}</b>: left as-is, {n === 1 ? "it stays" : "they stay"} unread — which can look like "no evidence" even when evidence exists.
        </p>
        <ul style={{ fontSize: 11.5, color: "#475569", margin: 0, paddingLeft: 18, maxHeight: 100, overflowY: "auto" }}>
          {prompt.fileNames.map((name) => <li key={name}>{name}</li>)}
        </ul>
        <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
          <b>Proceed with all</b> raises the budget to cover up to {prompt.estimatedExtraImages} more image{prompt.estimatedExtraImages === 1 ? "" : "s"} and re-reads {n === 1 ? "that file" : "those files"} — estimated extra cost <b>{fmtUSD(prompt.estimatedCostUSD)}</b> (rough estimate; actual spend depends on image size/detail).
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={() => onChoose("skip")} style={secondaryBtn}>Skip the rest</button>
          <button type="button" onClick={() => onChoose("proceed")} style={primaryBtn}>Proceed with all →</button>
        </div>
      </div>
    </div>
  );
}
