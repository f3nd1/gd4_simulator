import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { visibleNav, type NavItem } from "../../nav";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useScored } from "../../hooks/useScored";
import { useAllFindings } from "../../hooks/useAllFindings";
import { navDoneMap } from "../../lib/navProgress";
import { GOLD } from "../../lib/theme";

type Props = { open: boolean; onClose: () => void };

export function Sidebar({ open, onClose }: Props) {
  const location = useLocation();
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const NAV = visibleNav(showDeveloperTools);

  // ── Progress ticks — driven ONLY by real, detectable done-state ──────────
  // (see lib/navProgress.ts). A step without a reliable signal is number-only.
  const cycle = useWorkspaceStore((s) => s.cycle);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const folders = useWorkspaceStore((s) => s.folders);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const exportLog = useWorkspaceStore((s) => s.exportLog);
  const scored = useScored();
  const findings = useAllFindings();
  const doneMap = navDoneMap({
    cyclePeriodSet: !!(cycle.periodStart?.trim() && cycle.periodEnd?.trim() && cycle.scope?.trim()),
    auditorsAdded: auditors.length > 0,
    foldersLinked: folders.some((f) => (f.folderLink?.trim() || f.policyLink?.trim())),
    checklistScored: scored.items.some((i) => i.checklistOverride),
    ppdReviewed: Object.keys(ppdReviewResults).length > 0,
    allFindingsClosed: findings.length > 0 && scored.openAFIs === 0,
    allScoresConfirmed: scored.items.length > 0 && scored.items.every((i) => i.conf != null),
    cycleLocked: cycle.status === "Locked",
    exported: exportLog.length > 0,
  });

  const inGroup = (paths: NavItem[]) => paths.some((i) => i.path === location.pathname);
  const activeGroup = NAV.find((g) => inGroup(g.items) || inGroup(g.tools ?? []))?.group;
  // Only the section containing the current page starts expanded — collapsing
  // the rest is what makes the nav navigable instead of a wall of links.
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

  const closeOnMobile = () => {
    if (window.matchMedia("(max-width: 767px)").matches) onClose();
  };

  // A core step link, with a leading badge: green tick when the step's real
  // done-signal is satisfied, otherwise its step number (1-based within the
  // stage). Steps are NEVER disabled — the number is guidance, not a gate.
  const CoreStep = ({ item, ordinal }: { item: NavItem; ordinal?: number }) => {
    const done = doneMap[item.path] === true;
    return (
      <NavLink
        to={item.path}
        title={item.hint}
        className={({ isActive }) => (isActive ? "" : "navlink")}
        onClick={closeOnMobile}
        style={({ isActive }) => ({
          display: "flex",
          alignItems: "center",
          gap: 8,
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
        {ordinal != null && (
          <span
            aria-hidden
            title={done ? "Done" : undefined}
            style={{
              flexShrink: 0,
              width: 17,
              height: 17,
              borderRadius: 99,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: done ? 11 : 10,
              fontWeight: 700,
              background: done ? "#15803d" : "transparent",
              color: done ? "#fff" : "#7e8da0",
              border: done ? "none" : "1px solid #3a4759",
            }}
          >
            {done ? "✓" : ordinal}
          </span>
        )}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
      </NavLink>
    );
  };

  // A demoted "Tools & reference" tail link — smaller, dimmer, no badge.
  const ToolLink = ({ item }: { item: NavItem }) => (
    <NavLink
      to={item.path}
      title={item.hint}
      className={({ isActive }) => (isActive ? "" : "navlink")}
      onClick={closeOnMobile}
      style={({ isActive }) => ({
        display: "block",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 500,
        padding: "6px 11px 6px 20px",
        borderRadius: 8,
        marginBottom: 1,
        background: isActive ? GOLD : "transparent",
        color: isActive ? "#16202e" : "#8b97a8",
      })}
    >
      {item.label}
    </NavLink>
  );

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
          const numbered = g.step != null;
          const tools = g.tools ?? [];
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
              {!isCollapsed && (
                <>
                  {g.items.map((item, idx) => (
                    <CoreStep key={item.path} item={item} ordinal={numbered ? idx + 1 : undefined} />
                  ))}
                  {tools.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#55637a", padding: "2px 11px 3px 20px" }}>
                        Tools &amp; reference
                      </div>
                      {tools.map((item) => (
                        <ToolLink key={item.path} item={item} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        </div>
      </nav>
    </>
  );
}
