import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export function Layout() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#eef1f5" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header />
        <main style={{ flex: 1, padding: "18px 22px 60px", maxWidth: 1180, width: "100%", margin: "0 auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
