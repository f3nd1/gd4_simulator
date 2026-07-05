import { useState } from "react";
import { Link } from "react-router-dom";
import { useAISettingsStore } from "../../store/useAISettingsStore";
import { aiOfflineReason } from "../../lib/ai/aiClient";
import { DismissX } from "./Guidance";

// One-line pre-run banner: states whether the NEXT audit run will use live AI
// or fall back to offline keyword estimates, so an offline run can never
// begin silently. Reuses aiOfflineReason (the single source of the AI-ready
// state) — it does not re-derive it. Shown before the run entry points on the
// Evidence Folder page and inside the Option A review modal.
export function RunModeBanner({ compact = false }: { compact?: boolean }) {
  const enabled = useAISettingsStore((s) => s.enabled);
  const apiKey = useAISettingsStore((s) => s.apiKey);
  const offline = aiOfflineReason({ enabled, apiKey });
  // Disclaimer — dismissal is EPHEMERAL (local state only, never persisted), so
  // the live-AI / offline caveat always reappears on the next mount/reload and
  // can never be permanently silenced before a real result.
  const [dismissed, setDismissed] = useState(false);
  const dismissTitle = "Hide for now (reappears on the next run/reload)";
  if (dismissed) return null;

  if (!offline) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: compact ? "5px 10px" : "7px 11px" }}>
        <span>This run will use <b>LIVE AI ✅</b>{compact ? "" : " — verdicts are AI-assessed (internal estimate only, not an official SSG/EduTrust result)."}</span>
        <DismissX onClick={() => setDismissed(true)} title={dismissTitle} color="#15803d" />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: compact ? "5px 10px" : "7px 11px" }}>
      <span><b>OFFLINE estimates ⚠</b> — this run will produce keyword estimates only, not an AI assessment. {offline}</span>
      <Link to="/settings" style={{ color: "#b45309", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>Fix in Settings →</Link>
      <DismissX onClick={() => setDismissed(true)} title={dismissTitle} color="#92400e" />
    </div>
  );
}
