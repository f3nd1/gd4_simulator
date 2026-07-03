import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { visibleNav } from "../../nav";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { GOLD } from "../../lib/theme";

type Props = { open: boolean; onClose: () => void };

export function Sidebar({ open, onClose }: Props) {
  const location = useLocation();
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const NAV = visibleNav(showDeveloperTools);
  const activeGroup = NAV.find((g) => g.items.some((i) => i.path === location.pathname))?.group;
  // Only the section containing the current page starts expanded — collapsing
  // the rest is what actually makes a 21-page nav feel navigable instead of
  // a wall of links.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(NAV.map((g) => g.group).filter((g) => g !== activeGroup)));

  useEffect(() => {
    if (activeGroup) setCollapsed((prev) => (prev.has(activeGroup) ? new Set([...prev].filter((g) => g !== activeGroup)) : prev));
  }, [activeGroup]);

  function toggleGroup(group: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    document.body.style.overflow = open && isMobile ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="md:hidden no-print"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40 }}
        />
      )}
      <nav
        className={`no-print fixed md:static top-0 left-0 h-screen md:h-auto z-50 md:z-auto overflow-hidden transition-all duration-200 ${
          open ? "translate-x-0 w-[220px]" : "-translate-x-full w-[220px] md:translate-x-0 md:w-0"
        }`}
        style={{
          flexShrink: 0,
          background: "#16202e",
          color: "#aeb8c7",
          overflowY: open ? "auto" : "hidden",
        }}
      >
        <div style={{ width: 220, padding: "14px 10px" }}>
        {NAV.map((g) => {
          const isCollapsed = collapsed.has(g.group);
          const isActiveGroup = g.group === activeGroup;
          return (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <button
                onClick={() => toggleGroup(g.group)}
                title={g.hint}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  cursor: "pointer",
                  border: "none",
                  background: "transparent",
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: isActiveGroup ? GOLD : "#6b7a92",
                  padding: "6px 11px",
                }}
              >
                {g.group}
                <span style={{ fontSize: 9, transform: isCollapsed ? "rotate(-90deg)" : "none", display: "inline-block" }}>▾</span>
              </button>
              {!isCollapsed &&
                g.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    title={item.hint}
                    className={({ isActive }) => (isActive ? "" : "navlink")}
                    onClick={() => {
                      if (window.matchMedia("(max-width: 767px)").matches) onClose();
                    }}
                    style={({ isActive }) => ({
                      display: "block",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 11px",
                      borderRadius: 8,
                      marginBottom: 2,
                      background: isActive ? GOLD : "transparent",
                      color: isActive ? "#16202e" : "#cdd5e0",
                    })}
                  >
                    {item.label}
                  </NavLink>
                ))}
            </div>
          );
        })}
        </div>
      </nav>
    </>
  );
}
