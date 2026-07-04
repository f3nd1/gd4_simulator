import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useGoogleDriveStore } from "../../store/useGoogleDriveStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useChangeLogStore } from "../../store/useChangeLogStore";
import { useSaveStatusStore } from "../../store/useSaveStatusStore";
import { flushPendingSaves } from "../../store/supabaseStorage";

export function Layout() {
  const [navOpen, setNavOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );

  // clientId rehydrates asynchronously (Supabase round-trip or timeout
  // fallback), so this can't just run once on mount — it has to react to
  // clientId actually arriving, then try exactly once per page load.
  const clientId = useGoogleDriveStore((s) => s.clientId);
  const connectSilently = useGoogleDriveStore((s) => s.connectSilently);
  const triedRef = useRef(false);
  useEffect(() => {
    if (!clientId || triedRef.current) return;
    triedRef.current = true;
    connectSilently();
  }, [clientId, connectSilently]);

  // Push any debounced-but-not-yet-synced edits to Supabase before the tab
  // closes (localStorage already has them; this covers cross-device sync).
  useEffect(() => {
    const onUnload = () => { void flushPendingSaves(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#eef1f5" }}>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header onMenuClick={() => setNavOpen((o) => !o)} />
        <LocalSaveErrorBanner />
        <main className="px-3 sm:px-6" style={{ flex: 1, paddingTop: 18, paddingBottom: 60, maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
        {/* Recording is ALWAYS mounted — hiding the developer footer must not
            stop change-log history accumulating in the background. */}
        <ChangeLogRecorder />
        <GitFooter />
      </div>
    </div>
  );
}

// Non-blocking warning shown when writing the localStorage cache itself
// failed (e.g. quota exceeded). The app keeps running on in-memory state and
// the Supabase sync, but the user should know the local safety net is gone.
function LocalSaveErrorBanner() {
  const localSaveError = useSaveStatusStore((s) => s.localSaveError);
  const clearLocalSaveError = useSaveStatusStore((s) => s.clearLocalSaveError);
  if (!localSaveError) return null;
  return (
    <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", color: "#92400e", fontSize: 12.5, fontWeight: 600, padding: "7px 16px", display: "flex", alignItems: "center", gap: 10 }}>
      <span>⚠ {localSaveError}</span>
      <button
        onClick={clearLocalSaveError}
        style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#92400e", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// Accumulates the git info into the Change Log. Lives OUTSIDE GitFooter so
// recording continues while the developer footer is hidden — only the UI is
// toggleable, never the history. Only records a commit that has actually
// been pushed (ahead === 0), since an unpushed build isn't a "push" event
// yet; reloading/redeploying a build logs it again, and only an exact
// double-fire within one page load is suppressed (recordChangeLogEntry).
function ChangeLogRecorder() {
  const info = __GIT_INFO__;
  const pushed = info.ahead === 0;
  const recordChangeLogEntry = useChangeLogStore((s) => s.recordChangeLogEntry);
  const importEntries = useChangeLogStore((s) => s.importEntries);
  // One-time migration: fold any entries still sitting in the legacy
  // workspace-store changeLog into the dedicated, durable store so the existing
  // history is preserved (append-only — never removes the legacy copy).
  const legacyLog = useWorkspaceStore((s) => s.changeLog);
  useEffect(() => {
    if (legacyLog.length) importEntries(legacyLog);
  }, [legacyLog, importEntries]);
  useEffect(() => {
    if (!pushed || !info.hash || info.hash === "unknown") return;
    recordChangeLogEntry({
      timestamp: info.isoTime || new Date().toISOString(),
      action: "push",
      commitHash: info.hash,
      branch: info.branch,
      commitMessage: info.message,
    });
  }, [pushed, info.hash, info.isoTime, info.branch, info.message, recordChangeLogEntry]);
  return null;
}

function GitFooter() {
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const info = __GIT_INFO__;
  const pushed = info.ahead === 0;
  const time = info.isoTime ? new Date(info.isoTime).toLocaleString("en-SG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  // Hidden entirely for non-developer users — no empty bar, no border strip.
  if (!showDeveloperTools) return null;
  return (
    <div style={{ fontSize: 11, color: "#aaa", padding: "4px 16px", borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, background: "#f9fafb" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: pushed ? "#22c55e" : "#f59e0b", flexShrink: 0, display: "inline-block" }} />
      <span style={{ color: pushed ? "#16a34a" : "#d97706", fontWeight: 600 }}>{pushed ? "Pushed" : `${info.ahead} unpushed commit${info.ahead !== 1 ? "s" : ""}`}</span>
      <span>·</span>
      <span style={{ fontFamily: "monospace" }}>{info.hash}</span>
      <span>·</span>
      <span>{info.branch}</span>
      {time && <><span>·</span><span>{time}</span></>}
      {info.message && <><span>·</span><span style={{ color: "#9ca3af", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.message}</span></>}
    </div>
  );
}
