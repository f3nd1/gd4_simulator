import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { visibleNav, type NavItem } from "../../nav";
import { useSession } from "../../lib/auth/useSession";
import { isAdminEmail } from "../../lib/auth/domain";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useScored } from "../../hooks/useScored";
import { useAllFindings } from "../../hooks/useAllFindings";
import { navDoneMap } from "../../lib/navProgress";
import { GOLD, INK, SELF_CHECK_ACCENT } from "../../lib/theme";

type Props = { open: boolean; onClose: () => void };

// "1 · Set up" -> "Set up". The number moves into the stage chip, so leaving
// it in the text too would print it twice. NAV is untouched: the Dashboard
// stepper and the Help page still read g.group and g.step as they always did.
const stageName = (group: string) => group.replace(/^\d+\s*·\s*/, "");

export function Sidebar({ open, onClose }: Props) {
  const location = useLocation();
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const session = useSession();
  const NAV = visibleNav(showDeveloperTools, session.status === "signed-in" && isAdminEmail(session.email));

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

  // Collapsed by default; the section holding the current page is open, and a
  // section you open by hand stays open until you move to another page.
  //
  // This used to track the COLLAPSED set instead, and groups accumulated:
  // navigating removed the new active group from that set but never put the
  // one you had left back in, so after a few clicks every section was open
  // and the sidebar was one long scroll. Tracking deliberate OVERRIDES and
  // clearing them per page cannot drift that way, and it also lets the active
  // section be closed, which the old shape could not do.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => { setOverrides({}); }, [location.pathname]);

  const isOpen = (group: string) => overrides[group] ?? group === activeGroup;
  const toggleGroup = (group: string) => setOverrides((prev) => ({ ...prev, [group]: !(prev[group] ?? group === activeGroup) }));

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
          // Indented past the stage chip, so a step sits under its stage
          // rather than beside it.
          padding: "7px 11px 7px 18px",
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
              width: 15,
              height: 15,
              // A circle, never the stage chip's square, and hollow unless
              // the step's real done-signal is satisfied.
              borderRadius: 99,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: done ? 10 : 9.5,
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

  // The standalone feature button. A solid fill in the purple this app
  // already uses for the self-check everywhere else, so the button matches
  // the thing it opens. Deliberately NOT gold: gold is the sidebar's
  // "you are on this page" fill, and a gold button sat beside an active gold
  // link reads as two of the same thing rather than one of each.
  //
  // Contrast measured, not eyeballed: 6.03:1 for the INK label on the fill,
  // and 6.03:1 for the fill against the sidebar behind it, both AA; hovered,
  // 8.89:1, AAA. The self-check purple used on white (#7c3aed) is only
  // 2.88:1 against this sidebar and would have looked bold without being
  // readable.
  //
  // Deliberately NOT the shared `navlink` class: that hover rule forces a
  // slate background with !important, which would wipe the fill out.
  const FeatureLink = ({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) => (
    <NavLink
      to={item.path}
      title={item.hint}
      className="navfeature"
      onClick={onNavigate}
      style={{
        display: "block",
        textAlign: "center",
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: 0.2,
        padding: "11px 12px",
        borderRadius: 10,
        marginBottom: 14,
        background: SELF_CHECK_ACCENT,
        color: INK,
      }}
    >
      {item.label}
    </NavLink>
  );

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
          // A `feature` group is one standalone link, no header and no
          // collapse: it reads as a separate place rather than a section of
          // the audit lead's journey.
          if (g.feature) return <FeatureLink key={g.group} item={g.items[0]} onNavigate={closeOnMobile} />;
          const expanded = isOpen(g.group);
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
                  gap: 8,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  {/* A stage and a step inside it used to be the same shape:
                      "1 · SET UP" beside a circled "1" read as two of the
                      same thing. The stage number is now a FILLED SQUARE in
                      the accent, the step number a HOLLOW CIRCLE in muted
                      grey, so which is which is a glance rather than a read. */}
                  {numbered && (
                    <span
                      aria-hidden
                      style={{
                        flexShrink: 0, width: 18, height: 18, borderRadius: 5,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 800, lineHeight: 1,
                        background: isActiveGroup ? GOLD : "#334054",
                        color: isActiveGroup ? "#16202e" : "#cdd5e0",
                      }}
                    >
                      {g.step}
                    </span>
                  )}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {stageName(g.group)}
                  </span>
                </span>
                <span style={{ fontSize: 9, transform: expanded ? "none" : "rotate(-90deg)", display: "inline-block", flexShrink: 0 }}>▾</span>
              </button>
              {expanded && (
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
