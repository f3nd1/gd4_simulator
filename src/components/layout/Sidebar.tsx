import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { NAV } from "../../nav";
import { GOLD } from "../../lib/theme";

type Props = { open: boolean; onClose: () => void };

export function Sidebar({ open, onClose }: Props) {
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
          className="md:hidden"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40 }}
        />
      )}
      <nav
        className={`fixed md:static top-0 left-0 h-screen md:h-auto z-50 md:z-auto overflow-hidden transition-all duration-200 ${
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
        {NAV.map((g) => (
          <div key={g.group} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "#5d6b80", padding: "4px 10px" }}>{g.group}</div>
            {g.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                style={({ isActive }) => ({
                  display: "block",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "7px 10px",
                  borderRadius: 7,
                  marginBottom: 2,
                  background: isActive ? GOLD : "transparent",
                  color: isActive ? "#16202e" : "#cdd5e0",
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
        </div>
      </nav>
    </>
  );
}
