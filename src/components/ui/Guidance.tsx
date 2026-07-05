// The guidance layer's shared pieces: the slim next-step banner, the
// lightweight first-time walkthrough overlay, and the tooltip gate. All of
// it respects the master toggle in Settings (useGuidanceStore.enabled) and
// never blocks the UI — the banner is a strip, the walkthrough is skippable.

import { useEffect, useState } from "react";
import { useGuidanceStore } from "../../store/useGuidanceStore";

// Tooltip gate: components pass their tooltip text through this hook so all
// guidance tooltips disappear together when the master toggle is off.
export function useTip(): (text: string) => string | undefined {
  const enabled = useGuidanceStore((s) => s.enabled);
  return (text: string) => (enabled ? text : undefined);
}

// Small ✕ dismiss control shared by the app's informational banners. `title`
// clarifies the dismissal scope (permanent for tips, this-view for disclaimers).
export function DismissX({ onClick, title, color = "#64748b" }: { onClick: () => void; title: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      style={{ marginLeft: "auto", flexShrink: 0, cursor: "pointer", border: "none", background: "transparent", color, fontSize: 14, lineHeight: 1, padding: "0 2px", fontWeight: 700 }}
    >
      ✕
    </button>
  );
}

// Turns a tip's text into a stable dismissal key (so the SAME instruction stays
// dismissed, but a genuinely different next-step instruction reappears).
function tipSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
}

// Slim, friendly "what to do now" strip. One per page, top of the content.
// Instructional only (no compliance/trust content), so its ✕ dismissal PERSISTS
// (keyed by the tip text) — a different next-step instruction still appears.
export function NextStepBanner({ text, dismissKey }: { text: string; dismissKey?: string }) {
  const enabled = useGuidanceStore((s) => s.enabled);
  const key = dismissKey ?? tipSlug(text);
  const dismissed = useGuidanceStore((s) => !!s.dismissedTips[key]);
  const dismissTip = useGuidanceStore((s) => s.dismissTip);
  if (!enabled || !text || dismissed) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#eef6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "7px 12px", marginBottom: 10 }}>
      <span aria-hidden style={{ fontSize: 13 }}>👉</span>
      <span style={{ fontSize: 12.5, color: "#1e40af", lineHeight: 1.45 }}>{text}</span>
      <DismissX onClick={() => dismissTip(key)} title="Hide this tip (it won't show again)" color="#3b6fb5" />
    </div>
  );
}

export type WalkthroughStep = { targetId?: string; title: string; body: string };

// Lightweight custom walkthrough: dims the page, highlights the target
// element (by DOM id) with a ring, and steps through with Next/Skip. Shows
// automatically the first time a page is opened (per pageId); re-triggerable
// via the WalkthroughLink below.
export function Walkthrough({ pageId, steps }: { pageId: string; steps: WalkthroughStep[] }) {
  const enabled = useGuidanceStore((s) => s.enabled);
  const seen = useGuidanceStore((s) => !!s.seenWalkthroughs[pageId]);
  const markSeen = useGuidanceStore((s) => s.markWalkthroughSeen);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const active = enabled && !seen && steps.length > 0;
  const current = steps[Math.min(step, steps.length - 1)];

  useEffect(() => {
    if (!active) return;
    if (!current?.targetId) { setRect(null); return; }
    const el = document.getElementById(current.targetId);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [active, step, current?.targetId]);

  if (!active) return null;

  const done = () => markSeen(pageId);
  const next = () => (step >= steps.length - 1 ? done() : setStep(step + 1));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      {/* Dim layer — clicking it skips, so the tour never traps the user. */}
      <div onClick={done} style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.45)" }} />
      {rect && (
        <div style={{ position: "absolute", top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, border: "3px solid #facc15", borderRadius: 10, boxShadow: "0 0 0 6px rgba(250,204,21,0.25)", pointerEvents: "none" }} />
      )}
      <div
        style={{
          position: "absolute",
          top: rect ? Math.min(rect.top + rect.height + 14, window.innerHeight - 190) : "40%",
          left: rect ? Math.max(12, Math.min(rect.left, window.innerWidth - 372)) : "50%",
          transform: rect ? undefined : "translateX(-50%)",
          width: 360,
          background: "#fff",
          borderRadius: 12,
          padding: "14px 16px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginBottom: 3 }}>
          Step {step + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{current.title}</div>
        <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5, marginBottom: 12 }}>{current.body}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={done} style={{ cursor: "pointer", fontSize: 12, padding: "5px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b" }}>
            Skip
          </button>
          <button onClick={next} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 16px", borderRadius: 7, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff" }}>
            {step >= steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Show walkthrough" affordance — clears the seen flag so the tour replays.
export function WalkthroughLink({ pageId }: { pageId: string }) {
  const enabled = useGuidanceStore((s) => s.enabled);
  const reset = useGuidanceStore((s) => s.resetWalkthrough);
  if (!enabled) return null;
  return (
    <button
      onClick={() => reset(pageId)}
      title="Replay the short intro tour for this page"
      style={{ cursor: "pointer", fontSize: 11, color: "#4a5a8a", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, padding: "3px 9px" }}
    >
      Show walkthrough
    </button>
  );
}
