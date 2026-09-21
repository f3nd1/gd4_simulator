import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useGoogleDriveStore } from "../../store/useGoogleDriveStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useChangeLogStore } from "../../store/useChangeLogStore";
import { useSaveStatusStore } from "../../store/useSaveStatusStore";
import { flushPendingSaves } from "../../store/supabaseStorage";
import { VisionBudgetPromptModal } from "../ui/VisionBudgetPromptModal";
import { useSession } from "../../lib/auth/useSession";
import { NORMAL_USER_HOME } from "../../lib/auth/pageAccess";
import { ADMIN_ONLY_REFUSAL } from "../../lib/auth/peopleAdmin";
import { INK } from "../../lib/theme";

export function Layout() {
  const session = useSession();
  const { pathname } = useLocation();
  // THE guard for the whole workspace, in one place rather than a list of
  // thirty paths somebody has to remember to extend. Every page except the
  // self-check renders inside this Layout, so a page added tomorrow is
  // admin-only by default, which is the direction a mistake should fall.
  //
  // It decides what is DRAWN. What refuses a normal user's write to the ten
  // configuration rows is a policy in Postgres, and that applies to a request
  // made outside this app entirely (supabase/06-second-admin-and-locked-
  // stores.sql).
  if (session.status === "signed-in" && !session.isAdmin) {
    // Signing in puts everyone on "/". Sending a process owner to a refusal
    // on their very first screen would be a wall, so they land on the page
    // they were given the address for.
    if (pathname === "/") return <Navigate to={NORMAL_USER_HOME} replace />;
    return <WorkspaceClosed />;
  }
  return <Workspace />;
}

// Deliberately rendered WITHOUT the workspace chrome: a sidebar full of pages
// they cannot open is worse than no sidebar. Says nothing about what is
// behind it, and offers the way back to their own page.
function WorkspaceClosed() {
  return (
    <div style={{ minHeight: "100vh", background: "#f6f8fb", padding: 20, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "24px 22px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 18, margin: 0, color: INK }}>Not available</h1>
        <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.6, margin: "8px 0 0" }}>{ADMIN_ONLY_REFUSAL}</p>
        <a
          href={`#${NORMAL_USER_HOME}`}
          style={{ display: "inline-block", marginTop: 16, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, borderRadius: 9, border: "1px solid #6d28d9", background: "#6d28d9", color: "#fff", textDecoration: "none" }}
        >
          Go to my self-check
        </a>
      </div>
    </div>
  );
}

function Workspace() {
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

  const uiTheme = useWorkspaceStore((s) => s.uiTheme);

  return (
    <div data-theme={uiTheme} className="app-theme-scope" style={{ minHeight: "100vh", display: "flex", background: uiTheme === "bold" ? "#eae6db" : "#eef1f5" }}>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header onMenuClick={() => setNavOpen((o) => !o)} />
        <SampleDataBanner />
        <LockedCycleBanner />
        <LocalSaveErrorBanner />
        <main className="px-3 sm:px-6" style={{ flex: 1, paddingTop: 18, paddingBottom: 60, maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
        {/* Recording is ALWAYS mounted — hiding the developer footer must not
            stop change-log history accumulating in the background. */}
        <ChangeLogRecorder />
        {/* App-wide by necessity, not convenience: the run that awaits this
            answer may have been launched from any page (see the component). */}
        <VisionBudgetPromptModal />
        <GitFooter />
      </div>
    </div>
  );
}

// App-wide banner shown whenever the loaded SAMPLE dataset is active, so the
// simulated demo data — which is written into the same fields as real work —
// can never be mistaken for a real audit or an official SSG/EduTrust result.
// The only way to dismiss it is to clear the sample data (returns to blank).
function SampleDataBanner() {
  const active = useWorkspaceStore((s) => s.sampleDataActive);
  const clearSampleData = useWorkspaceStore((s) => s.clearSampleData);
  // Disclaimer — ✕ hides it for THIS view only (local state, never persisted):
  // it reappears on the next reload while sample data is still loaded, so the
  // "not a real audit" caveat can't be permanently silenced. "Clear sample
  // data" remains the real off-switch.
  const [hidden, setHidden] = useState(false);
  if (!active || hidden) return null;
  return (
    <div style={{ background: "#f5f3ff", borderBottom: "1px solid #ddd6fe", color: "#5b21b6", fontSize: 12.5, fontWeight: 600, padding: "7px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ background: "#7c3aed", color: "#fff", borderRadius: 4, padding: "1px 7px", fontSize: 11, letterSpacing: 0.5, flexShrink: 0 }}>SAMPLE</span>
      <span>Simulated example data for demonstration only — not a real audit, and not an official SSG / EduTrust result.</span>
      <button
        onClick={() => { if (confirm("Clear all sample data and return to a blank workspace? This removes the demo evidence, scores, findings, samples and interview prep.")) clearSampleData(); }}
        style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid #c4b5fd", background: "#fff", color: "#5b21b6", borderRadius: 6, fontSize: 11.5, fontWeight: 600, padding: "3px 10px", flexShrink: 0 }}
      >
        Clear sample data
      </button>
      <button
        type="button"
        onClick={() => setHidden(true)}
        title="Hide for now (reappears on the next reload)"
        aria-label="Hide the sample-data notice for now"
        style={{ flexShrink: 0, cursor: "pointer", border: "none", background: "transparent", color: "#7c3aed", fontSize: 14, lineHeight: 1, padding: "0 2px", fontWeight: 700 }}
      >
        ✕
      </button>
    </div>
  );
}

// A Locked cycle is the audit record, so every store write that would change
// audit substance is refused (lib/cycleLock). This is where the refusal is
// shown: without it the click would simply do nothing, which is how "locked"
// silently became a label rather than a control.
function LockedCycleBanner() {
  const locked = useWorkspaceStore((s) => s.cycle.status === "Locked");
  const reason = useWorkspaceStore((s) => s.lockBlockedReason);
  const clear = useWorkspaceStore((s) => s.clearLockBlockedReason);
  if (!locked) return null;
  return (
    <div style={{ background: reason ? "#fef2f2" : "#f8fafc", borderBottom: `1px solid ${reason ? "#fecaca" : "#e2e8f0"}`, color: reason ? "#991b1b" : "#475569", fontSize: 12.5, fontWeight: 600, padding: "7px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ background: reason ? "#b91c1c" : "#64748b", color: "#fff", borderRadius: 4, padding: "1px 7px", fontSize: 11, letterSpacing: 0.5, flexShrink: 0 }}>LOCKED</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        {reason ?? "This cycle is locked. Findings, checklist verdicts, evidence and audit runs are read-only; exports and version restores still work."}
      </span>
      {reason && (
        <button
          type="button"
          onClick={clear}
          aria-label="Dismiss the blocked-action notice"
          style={{ flexShrink: 0, cursor: "pointer", border: "none", background: "transparent", color: "#991b1b", fontSize: 14, lineHeight: 1, padding: "0 2px", fontWeight: 700 }}
        >
          ✕
        </button>
      )}
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
