import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useGoogleDriveStore } from "../../store/useGoogleDriveStore";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
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
        <main className="px-3 sm:px-6" style={{ flex: 1, paddingTop: 18, paddingBottom: 60, maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
        <GitFooter />
      </div>
    </div>
  );
}

function GitFooter() {
  const info = __GIT_INFO__;
  const pushed = info.ahead === 0;

  // Accumulate the git info the footer shows into the Change Log. Only record
  // a commit that has actually been pushed (ahead === 0), since an unpushed
  // build isn't a "push" event yet; recordChangeLogEntry dedupes by hash so
  // this fires at most once per commit across all page loads.
  const recordChangeLogEntry = useWorkspaceStore((s) => s.recordChangeLogEntry);
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

  const time = info.isoTime ? new Date(info.isoTime).toLocaleString("en-SG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
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
