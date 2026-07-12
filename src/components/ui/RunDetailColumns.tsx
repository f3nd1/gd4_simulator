import { useState, useEffect } from "react";
import { TONE } from "../../lib/theme";
// FileLedger lives on the Evidence Folder page (not a components/ui file) —
// this mirrors the existing import direction PPDReview.tsx already used
// before this component was extracted; moving FileLedger itself is out of
// scope here.
import { FileLedger } from "../../pages/EvidenceFolder";
import type { AuditFileRecord, EvidenceLineRunStatus, EvidenceRunLogLine, EvidenceRunIssue } from "../../types";

// ─── Shared live-run detail panel ───────────────────────────────────────────
// The three-column live view (per-line status / file ledger / activity log)
// behind a percentage ring — originally built for the Option A PPD Review and
// Evidence tabs (PpdRunPanel / EvidenceRunPanel in PPDReview.tsx), extracted
// here so OTHER live runs (the AI Calibration Consistency tester) can reuse
// the exact same component instead of a second, simpler progress indicator.
// Purely presentational: every field is data the caller already collected —
// no run/assessment logic lives here.
const LOG_TONE: Record<NonNullable<EvidenceRunLogLine["tone"]>, string> = {
  info: "#475569", good: "#166534", warn: "#92600a", bad: "#b23121",
};

// Normalized shape both EvidenceAssessmentProgress and PPDReviewProgress (and
// any other live-run progress shape, e.g. the Calibration Lab's scratch-run
// progress) can be reduced to, so ONE component renders the whole live-detail
// panel (compact summary + stat chips + 3-column body) for every caller —
// kept in perfect visual sync by construction, not by convention.
export type RunDetailColumnsProps = {
  pct: number;
  stageLabel: string;
  windowLabel?: string;
  detail: string;
  startedAt?: number;
  heartbeatAt?: number;
  lineRefs: string[];
  lineStatus?: Record<string, EvidenceLineRunStatus>;
  lineVerdict?: Record<string, string>;
  filesFound: AuditFileRecord[];
  filesReadCount: number;
  filesTotal?: number;
  isReadingStage: boolean;
  currentFile?: string;
  // Source file(s) the CURRENT in-flight assessment AI call's window covers —
  // distinct from currentFile, which is only set during the earlier reading
  // stage. Undefined until the first "assessing" window starts.
  currentWindowFiles?: string[];
  canSkipCurrentFile?: boolean;
  onSkipFile?: () => void;
  ai?: { calls: number; model?: string; totalTokens: number };
  log: EvidenceRunLogLine[];
  onCancel: () => void;
  // Most recent call/file-read failure, if any — shown alongside the "no
  // activity" stall message so a stall reads as an explicit reason (error)
  // rather than only ever "still working".
  lastIssue?: EvidenceRunIssue;
};

export function RunDetailColumns(p: RunDetailColumnsProps) {
  const [open, setOpen] = useState(true);
  // 1s tick so the elapsed timer and "no activity for Ns" heartbeat move even
  // when a slow window produces no events — the run must never look frozen.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const elapsedS = p.startedAt ? Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000)) : 0;
  const elapsedLabel = elapsedS >= 60 ? `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s` : `${elapsedS}s`;
  const sinceBeatS = p.heartbeatAt ? Math.floor((Date.now() - p.heartbeatAt) / 1000) : 0;
  const doneLines = p.lineRefs.filter((r) => p.lineStatus?.[r] === "done").length;
  // Lines the CURRENT in-flight AI call's window is assessing — the "5/5
  // files read"/"7/7 lines done" chips below show cumulative totals only;
  // this is the missing "which one is active right now" view.
  const activeLines = p.lineRefs.filter((r) => p.lineStatus?.[r] === "assessing");

  const R = 26, CIRC = 2 * Math.PI * R;
  const chip = (label: string, value: string, tone: { fg: string; bg: string }) => (
    <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{value} {label}</span>
  );
  const lineTone = (s?: string) => s === "done" ? TONE.good : s === "assessing" ? TONE.progress : TONE.neutral;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #c7d2fe", background: "#f5f7ff", borderRadius: 12, padding: "12px 14px" }}>
      {/* Compact summary line — always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
          <svg width={60} height={60}>
            <circle cx={30} cy={30} r={R} fill="none" stroke={TONE.neutral.bg} strokeWidth={6} />
            <circle cx={30} cy={30} r={R} fill="none" stroke={TONE.progress.fg} strokeWidth={6} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - p.pct / 100)} transform="rotate(-90 30 30)" style={{ transition: "stroke-dashoffset 0.4s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{p.pct}%</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            {p.stageLabel}{p.windowLabel ? ` · ${p.windowLabel}` : ""}
          </div>
          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
            {p.detail} · {doneLines}/{p.lineRefs.length} lines · elapsed {elapsedLabel}
            {sinceBeatS > 12 && (
              <span style={{ color: "#92600a", fontWeight: 700 }}>
                {" "}· no activity {sinceBeatS}s
                {p.lastIssue
                  ? ` (${p.lastIssue.kind === "call-error" ? "most recent AI call issue" : "most recent file-read issue"}: ${p.lastIssue.message})`
                  : " (still working, a window can be slow)"}
              </span>
            )}
          </div>
          {/* Currently processing — which line(s) and which specific file(s)
              the ACTIVE call is using, not just cumulative totals. Reading
              stage: currentFile. Assessing stage: the batch's lines + the
              window's resolved source files. */}
          {p.isReadingStage && p.currentFile && (
            <div style={{ fontSize: 11, color: "#3730a3", marginTop: 3 }}>
              Currently reading: <span style={{ fontFamily: "ui-monospace,monospace" }}>{p.currentFile}</span>
            </div>
          )}
          {!p.isReadingStage && activeLines.length > 0 && (
            <div style={{ fontSize: 11, color: "#3730a3", marginTop: 3 }}>
              Currently processing: <span style={{ fontFamily: "ui-monospace,monospace" }}>{activeLines.join(", ")}</span>
              {p.currentWindowFiles && p.currentWindowFiles.length > 0 && (
                <> · using <span style={{ fontFamily: "ui-monospace,monospace" }}>{p.currentWindowFiles.join(", ")}</span></>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: "1px solid #c7d2fe", background: "#fff", color: "#4338ca" }}>
            {open ? "Hide detail ▲" : "Show detail ▼"}
          </button>
          <button onClick={p.onCancel} title="Stops the assessment: the in-flight AI call is aborted" style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff5f5", color: "#b23121" }}>
            Cancel
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Stat chips */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chip("files read", String(p.filesReadCount) + (p.filesTotal ? `/${p.filesTotal}` : ""), TONE.good)}
            {chip("lines done", `${doneLines}/${p.lineRefs.length}`, TONE.progress)}
            {chip(p.ai && p.ai.calls === 1 ? "AI call" : "AI calls", String(p.ai?.calls ?? 0), TONE.neutral)}
            {p.ai && p.ai.totalTokens > 0 && chip("tokens", p.ai.totalTokens.toLocaleString(), TONE.neutral)}
            {p.ai?.model && chip("model", p.ai.model, TONE.neutral)}
          </div>

          {/* Three side-by-side columns on desktop, stacking in the same order
              (lines → ledger → log) on narrow widths — see .option-a-run-cols
              in index.css. Shared verbatim by every caller via this one
              component — layout can never drift between them because there is
              only one copy of it. */}
          <div className="option-a-run-cols">
            {/* Per-line status */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>Requirement lines</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 320, overflowY: "auto" }}>
                {p.lineRefs.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Preparing…</div> : p.lineRefs.map((r) => {
                  const st = p.lineStatus?.[r];
                  const tone = lineTone(st);
                  const v = p.lineVerdict?.[r];
                  return (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone.fg, flexShrink: 0, opacity: st === "waiting" || !st ? 0.4 : 1 }} />
                      <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: tone.fg }}>{r}</span>
                      <span style={{ color: tone.fg, opacity: 0.85 }}>{st === "done" ? (v ?? "done") : st === "assessing" ? "assessing…" : "waiting"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Files read — the same expandable file ledger (filter tabs, search,
                Drive links, expand-to-view-extracted-text, amber "reading now" row,
                working Skip button where wired) the staged/full-audit progress
                modal uses — reused verbatim, not a second file-list UI. filesFound
                is populated upfront with every file in scope ("found"/pending), so
                the full set is visible immediately rather than growing one row
                at a time. */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
              <FileLedger
                files={p.filesFound}
                isActive={p.isReadingStage}
                progress={{ currentFileName: p.isReadingStage ? p.currentFile : undefined }}
                onSkipFile={p.canSkipCurrentFile ? p.onSkipFile : undefined}
              />
            </div>

            {/* Live log — newest at the bottom */}
            <div style={{ background: "#0f172a", borderRadius: 8, padding: "8px 11px", maxHeight: 320, overflowY: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Live activity log</div>
              {p.log.length === 0 ? <div style={{ fontSize: 11.5, color: "#64748b" }}>Waiting for activity…</div> : p.log.map((l, i) => (
                <div key={i} style={{ fontSize: 11.5, fontFamily: "ui-monospace,monospace", color: l.tone ? LOG_TONE[l.tone] : "#cbd5e1", lineHeight: 1.6 }}>
                  <span style={{ color: "#64748b" }}>{new Date(l.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}{l.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
