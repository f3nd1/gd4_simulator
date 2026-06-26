import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useGoogleDriveStore } from "../../store/useGoogleDriveStore";

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

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#eef1f5" }}>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header onMenuClick={() => setNavOpen((o) => !o)} />
        <main className="px-3 sm:px-6" style={{ flex: 1, paddingTop: 18, paddingBottom: 60, maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
