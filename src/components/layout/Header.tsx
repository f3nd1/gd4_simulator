import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { GOLD, INK } from "../../lib/theme";

type Props = { onMenuClick: () => void };

export function Header({ onMenuClick }: Props) {
  const cycle = useWorkspaceStore((s) => s.cycle);
  return (
    <header className="no-print" style={{ background: INK, color: "#fff", padding: "14px 20px", borderBottom: "1px solid #243042" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={onMenuClick}
          aria-label="Toggle navigation menu"
          style={{ cursor: "pointer", background: "transparent", border: "1px solid #3a4660", color: "#fff", fontSize: 16, lineHeight: 1, padding: "5px 9px", borderRadius: 6 }}
        >
          ☰
        </button>
        <span style={{ width: 10, height: 22, background: GOLD, borderRadius: 2 }} />
        <h1 style={{ margin: 0, fontSize: "clamp(14px, 3.6vw, 18px)", fontWeight: 700 }}>UCC EduTrust GD4 Audit Workspace</h1>
        <span className="hidden sm:inline-block" style={{ marginLeft: "auto", fontSize: 12, color: "#aeb8c7" }}>
          {cycle.version} · {cycle.status}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#8694a6", marginTop: 4 }}>
        Internal EduTrust readiness simulation. AI verdicts are simulated and never finalise a result — not an official SSG/EduTrust outcome.
      </div>
    </header>
  );
}
