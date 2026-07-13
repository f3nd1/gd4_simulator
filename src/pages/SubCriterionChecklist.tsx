import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { NextStepBanner } from "../components/ui/Guidance";
import { nextStepText } from "../lib/guidanceText";
import { useScored } from "../hooks/useScored";
import { auditEvidence } from "../lib/evidenceAudit";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { buildGenericLines } from "../data/checklistSeed";
import { computeBand, lineSufficiency, buildDraftFinding, findingDimension, computeRiskCategory } from "../lib/checklistBanding";
import { apsrAuditNote } from "../lib/ai/simulateAI";
import { findingTypeTone, ncSeverityTone } from "../lib/findingClassification";
import { ppdVerdictLabel, ppdVerdictTone, evVerdictLabel } from "../lib/verdictTone";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { ThumbsButtons } from "../components/ui/ThumbsButtons";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { GOLD, BLUE, INK, TONE, bandTone } from "../lib/theme";
import type {
  GD4Requirement,
  FindingDimension,
  GenericChecklistLine,
  SpecificChecklistLine,
  ChecklistSourceType,
  SpecificLineStatus,
  EvidenceSufficiency,
  SubChecklistEvidenceItem,
  PendingCommitItem,
} from "../types";
import { normalizeAuditRef } from "../lib/gd4Refs";

// ── Display-only parent grouping for the checklist item list ────────────────
// Items are grouped by their "major.minor" key (e.g. "2.1") so every criterion
// renders as a uniform two-level shape: a light, non-clickable parent TITLE
// header, then its child item(s) as the clickable rows beneath. This keeps the
// display consistent whether a sub-criterion has one child (1.1 → 1.1.1) or
// several, and restores the umbrella header for sub-criteria that were split
// into finer ones (2.1 → 2.1.1/2.1.2, etc.). Purely a view concern — the data
// model, sub-criterion ids, labels and gate flags are unchanged.
const PARENT_GROUP_TITLES: Record<string, string> = {
  // Umbrella labels kept for the split sub-criteria, whose original merged
  // title no longer exists as a single GD4_SUB_CRITERIA entry.
  "2.1": "Human Resource",
  "2.3": "Data, Information and Knowledge Management",
  "2.4": "Feedback Management",
  "5.1": "Course Design, Development and Review",
  "5.2": "Course Planning and Delivery",
};

function parentGroupKey(itemId: string): string {
  return itemId.split(".").slice(0, 2).join(".");
}

function parentGroupTitle(key: string): string {
  return GD4_SUB_CRITERIA.find((s) => s.id === key)?.title ?? PARENT_GROUP_TITLES[key] ?? "";
}

// Ordered parent groups for one criterion, each with its child items in
// canonical order.
function parentGroupsForCriterion(criterionId: string): { key: string; title: string; items: GD4Requirement[] }[] {
  const groups: { key: string; title: string; items: GD4Requirement[] }[] = [];
  for (const r of GD4_REQUIREMENTS.filter((req) => req.criterion === criterionId)) {
    const key = parentGroupKey(r.id);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, title: parentGroupTitle(key), items: [] }; groups.push(g); }
    g.items.push(r);
  }
  return groups;
}

// Distinct parent-group count (for the list caption), e.g. 23.
const PARENT_GROUP_COUNT = new Set(GD4_REQUIREMENTS.map((r) => parentGroupKey(r.id))).size;

// Formats the short provenance label for a generated line.
// Prefers the structured sourceRef (e.g. "6.2.1.DS1.a") over the legacy index-based label.
function sourceLabel(sourceType: ChecklistSourceType, sourceIndex: number | null | undefined, sourceRef?: string): string {
  if (sourceRef) return sourceRef;
  if (sourceType === "describeShow") return `Describe/Show ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "note") return `Note ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "expectedEvidence") return `Expected Evidence ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "intent") return "Intent";
  return "Requirement";
}

// Finds the hybrid-gate item (if any) holding a NEWER, unapproved write for
// this exact checklist line — matched the same way applyOptionAWrites itself
// matches a write to a line (existingLineId first, else normalized ref).
// While this exists, the line's status/evidence/promise text on screen is the
// last-APPROVED run, not the run this pending item came from — the gap this
// warning exists to surface (see the investigation this fixes).
function pendingWriteForLine(items: PendingCommitItem[], line: SpecificChecklistLine): PendingCommitItem | undefined {
  return items.find((i) => {
    if (i.write.existingLineId) return i.write.existingLineId === line.id;
    const ref = i.write.newLine?.sourceRef ?? i.write.newLine?.clause;
    const lineRef = line.sourceRef ?? line.clause;
    return !!ref && !!lineRef && normalizeAuditRef(ref) === normalizeAuditRef(lineRef);
  });
}

// One-line "why this was Met" summary for the Evidence strength section —
// reuses the same VERDICT wording the staged audit already writes into the
// evidence auditor note (apsrAuditNote), just extracting the first section
// instead of the full APSR breakdown text.
function metVerdictSummary(apsr: import("../types").ApsrBreakdown): string {
  const verdictSection = apsrAuditNote(apsr).split("\n\n")[0] || "";
  return verdictSection.replace(/^VERDICT\n/, "");
}

// Every chunk ID cited across the four APSR dimensions, deduped and in a
// stable order (Approach, Processes, Systems & Outcomes, Review).
function citedChunkIds(apsr: import("../types").ApsrBreakdown): string[] {
  const all = [
    ...(apsr.approach.sourceChunkIds || []),
    ...(apsr.processes.sourceChunkIds || []),
    ...(apsr.systemsOutcomes.sourceChunkIds || []),
    ...(apsr.review.sourceChunkIds || []),
  ];
  return Array.from(new Set(all));
}

const GENERIC_OPTIONS: GenericChecklistLine["status"][] = ["Not Started", "Met", "Partial", "Not met"];
const SPECIFIC_OPTIONS: SpecificLineStatus[] = ["Not Started", "Met", "Partial", "Not met", "Not Applicable"];
const SUFFICIENCY_OPTIONS: EvidenceSufficiency[] = ["Present", "Weak", "Missing"];
const EVIDENCE_TYPES = ["Policy/Procedure", "Record/Log", "System screenshot", "Minutes", "Survey/Feedback", "Other"];

function statusTone(status: string): "good" | "medium" | "critical" | "neutral" {
  if (status === "Met") return "good";
  if (status === "Partial") return "medium";
  if (status === "Not met") return "critical";
  return "neutral";
}

function quadrantLabel(coveragePct: number, ceiling: number): string {
  const highCoverage = coveragePct >= 50;
  const highMaturity = ceiling >= 3;
  if (highMaturity && highCoverage) return "Ready";
  if (highMaturity && !highCoverage) return "Documentation gap";
  if (!highMaturity && highCoverage) return "Review gap";
  return "Needs work";
}

function quadrantTone(label: string): "good" | "medium" | "critical" {
  return label === "Ready" ? "good" : label === "Needs work" ? "critical" : "medium";
}

const emptyEvidenceDraft = (): Omit<SubChecklistEvidenceItem, "id"> => ({
  title: "",
  type: EVIDENCE_TYPES[0],
  drive: "",
  owner: "",
  date: "",
  approved: false,
  reviewed: false,
  sufficiency: "Present",
  auditorNote: "",
});

// APSR dimension metadata — four evidence types every GD4 audit needs
const APSR_DIMS: { id: FindingDimension; gId: "G1" | "G2" | "G3" | "G4"; userLabel: string; desc: string }[] = [
  { id: "Procedure", gId: "G1", userLabel: "Policy & Procedure", desc: "Documented approach in the PPD" },
  { id: "Evidence",  gId: "G2", userLabel: "Implementation records", desc: "Evidence the procedure is deployed" },
  { id: "Outcomes",  gId: "G3", userLabel: "Outcome & trend data", desc: "Data showing desired results" },
  { id: "Review",    gId: "G4", userLabel: "Review & improvement", desc: "Periodic review feeding improvements" },
];

function EvidenceGapPanel({ generic, specific, req, itemId }: {
  generic: GenericChecklistLine[];
  specific: SpecificChecklistLine[];
  req: GD4Requirement;
  itemId: string;
}) {
  const hasData = specific.length > 0 || generic.some((g) => g.status !== "Not Started");
  if (!hasData) return null;

  // Tally gap counts per APSR dimension from active specific lines
  const activeLines = specific.filter((l) => l.status !== "Not Applicable" && l.status !== "Not Started");
  const dimNotMet: Partial<Record<FindingDimension, number>> = {};
  const dimPartial: Partial<Record<FindingDimension, number>> = {};

  for (const l of activeLines) {
    const suff = lineSufficiency(l);
    if (l.status === "Not met" || suff === "Missing") {
      const d = findingDimension(l);
      dimNotMet[d] = (dimNotMet[d] ?? 0) + 1;
    } else if (l.status === "Partial" || suff === "Weak") {
      const d = findingDimension(l);
      dimPartial[d] = (dimPartial[d] ?? 0) + 1;
    }
  }

  const dims = APSR_DIMS.map((d) => {
    const genericStatus = generic.find((g) => g.id === d.gId)?.status ?? "Not Started";
    const notMet = dimNotMet[d.id] ?? 0;
    const partial = dimPartial[d.id] ?? 0;
    const isCritical = genericStatus === "Not met" || notMet > 0;
    const isWeak = !isCritical && (genericStatus === "Partial" || partial > 0);
    const isGood = !isCritical && !isWeak && genericStatus === "Met";
    const bg = isCritical ? "#fef2f2" : isWeak ? "#fffbeb" : isGood ? "#f0fdf4" : "#f8fafc";
    const fg = isCritical ? "#b91c1c" : isWeak ? "#b45309" : isGood ? "#15803d" : "#64748b";
    const icon = isCritical ? "✗" : isWeak ? "~" : isGood ? "✓" : "–";
    return { ...d, genericStatus, notMet, partial, isCritical, isGood, isWeak, bg, fg, icon };
  });

  // Likely finding type
  const riskCat = computeRiskCategory(req, "Evidence");
  const totalNotMet = activeLines.filter((l) => l.status === "Not met" || lineSufficiency(l) === "Missing").length;
  const totalPartial = activeLines.filter((l) => l.status === "Partial" || (l.status === "Met" && lineSufficiency(l) === "Weak")).length;

  type FindingInfo = { type: string; color: string; bg: string; desc: string };
  let finding: FindingInfo | null = null;
  if (totalNotMet > 0) {
    if (riskCat === "A") {
      finding = { type: "Major NC", color: "#b91c1c", bg: "#fef2f2", desc: `Student-protection item — ${totalNotMet} unmet requirement${totalNotMet > 1 ? "s" : ""}` };
    } else if (riskCat === "B") {
      finding = { type: "Minor NC", color: "#b45309", bg: "#fffbeb", desc: `Gate-sensitive — unresolved gaps will block the Star award` };
    } else {
      finding = { type: "AFI", color: "#7c3aed", bg: "#faf5ff", desc: `${totalNotMet} gap${totalNotMet > 1 ? "s" : ""} need corrective action` };
    }
  } else if (totalPartial > 0) {
    finding = { type: "Observation", color: "#475569", bg: "#f1f5f9", desc: `${totalPartial} partially-met line${totalPartial > 1 ? "s" : ""} — monitor and strengthen` };
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence gap summary</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
        {dims.map((d) => (
          <div key={d.id} style={{ background: d.bg, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: d.fg, marginBottom: 3 }}>
              {d.icon} {d.userLabel}
            </div>
            <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4 }}>{d.desc}</div>
            <div style={{ fontSize: 11, color: d.fg, fontWeight: 600 }}>
              Maturity: {d.genericStatus}
            </div>
            {(d.notMet > 0 || d.partial > 0) && (
              <div style={{ fontSize: 10, color: d.fg, marginTop: 2 }}>
                {d.notMet > 0 && <span>{d.notMet} not met</span>}
                {d.notMet > 0 && d.partial > 0 && " · "}
                {d.partial > 0 && <span>{d.partial} partial</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {finding ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", background: finding.bg, borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: finding.color, padding: "2px 8px", background: "rgba(255,255,255,0.75)", borderRadius: 6, flexShrink: 0 }}>
            Likely: {finding.type}
          </span>
          <span style={{ fontSize: 11.5, color: "#374151", flex: 1 }}>{finding.desc}</span>
          <Link to={`/findings?item=${itemId}`} style={{ fontSize: 11.5, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "3px 9px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff", flexShrink: 0 }}>
            View / raise findings →
          </Link>
        </div>
      ) : (
        activeLines.length > 0 && (
          <div style={{ fontSize: 12, color: "#15803d" }}>✓ No gaps detected — all active lines are met with present evidence.</div>
        )
      )}
      <p style={{ fontSize: 10.5, color: "#94a3b8", margin: "8px 0 0" }}>
        Maturity from G1–G4 generic lines (Maturity assessment) · gap counts from specific testable lines · internal simulation only.
      </p>
    </Card>
  );
}

export function SubCriterionChecklist() {
  const entries = useChecklistModuleStore((s) => s.entries);
  const busy = useChecklistModuleStore((s) => s.busy);
  const ensureEntry = useChecklistModuleStore((s) => s.ensureEntry);
  const setGenericStatus = useChecklistModuleStore((s) => s.setGenericStatus);
  const generateSpecific = useChecklistModuleStore((s) => s.generateSpecific);
  const updatePendingLine = useChecklistModuleStore((s) => s.updatePendingLine);
  const removePendingLine = useChecklistModuleStore((s) => s.removePendingLine);
  const addPendingLine = useChecklistModuleStore((s) => s.addPendingLine);
  const confirmGenerated = useChecklistModuleStore((s) => s.confirmGenerated);
  const discardGenerated = useChecklistModuleStore((s) => s.discardGenerated);
  const addSpecificLine = useChecklistModuleStore((s) => s.addSpecificLine);
  const removeSpecificLine = useChecklistModuleStore((s) => s.removeSpecificLine);
  const clearSpecificLines = useChecklistModuleStore((s) => s.clearSpecificLines);
  const setSpecificStatus = useChecklistModuleStore((s) => s.setSpecificStatus);
  const addEvidence = useChecklistModuleStore((s) => s.addEvidence);
  const fillEvidenceFromLink = useChecklistModuleStore((s) => s.fillEvidenceFromLink);
  const updateEvidence = useChecklistModuleStore((s) => s.updateEvidence);
  const removeEvidence = useChecklistModuleStore((s) => s.removeEvidence);
  const reuseEvidence = useChecklistModuleStore((s) => s.reuseEvidence);
  const setSampling = useChecklistModuleStore((s) => s.setSampling);
  const confirmDraftFinding = useChecklistModuleStore((s) => s.confirmDraftFinding);

  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string>(() => searchParams.get("item") || "1.1.1");
  // The 35-item picker is wide; let it collapse to reclaim horizontal space.
  const [menuOpen, setMenuOpen] = useState(true);
  const [menuCritFilter, setMenuCritFilter] = useState<string>("All");
  const [newLineText, setNewLineText] = useState("");
  const [pendingAddText, setPendingAddText] = useState("");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState(emptyEvidenceDraft());
  const [aiFilledDraft, setAiFilledDraft] = useState<ReturnType<typeof emptyEvidenceDraft> | null>(null);
  const [samplingDraft, setSamplingDraft] = useState<{ population?: number; sampleSize?: number; sampleIds?: string }>({});
  const [reuseFrom, setReuseFrom] = useState<{ lineId: string; evidenceId: string } | null>(null);
  const [reuseTargetItem, setReuseTargetItem] = useState("");
  const [reuseTargetLine, setReuseTargetLine] = useState("");
  const [maturityOpen, setMaturityOpen] = useState(false);
  // Which read-only reasoning tab the expanded line shows — pure UI state,
  // both halves' data are already on the line's stored evidence item.
  const [expandTab, setExpandTab] = useState<"ppd" | "evidence">("evidence");

  const req = GD4_REQUIREMENTS.find((r) => r.id === selectedId)!;
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === req.subCriterionId)!;
  const entry = entries[selectedId];
  const generic = entry?.generic.length ? entry.generic : buildGenericLines();
  const specific = entry?.specific || [];
  const pending = entry?.pendingGenerated || [];

  const bandResult = useMemo(() => computeBand(generic, specific, req.gateSensitive), [generic, specific, req.gateSensitive]);

  const scored = useScored();
  const folders = useWorkspaceStore((s) => s.folders);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const closures = useWorkspaceStore((s) => s.closures);
  // Hybrid-gate visibility fix: a newer Evidence/Audit run can sit unapproved
  // in pendingCommits while this checklist still shows the last-approved run
  // (the gate itself is unchanged — this only surfaces that it's holding
  // something). Keyed by subCriterionId; each run's items carry their own
  // gd4ItemId, so scoping to req.subCriterionId is correct for this item.
  const pendingCommits = useWorkspaceStore((s) => s.pendingCommits);
  const itemPendingItems = useMemo(
    () => (pendingCommits[req.subCriterionId]?.items ?? []).filter((i) => i.write.gd4ItemId === selectedId),
    [pendingCommits, req.subCriterionId, selectedId]
  );
  const itemPendingRunId = pendingCommits[req.subCriterionId]?.runId;
  // Every GD4 item id with ANY write awaiting approval, across every sub-
  // criterion — cheap membership check for the Coverage vs Maturity chips.
  const pendingItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(pendingCommits)) for (const it of run.items) ids.add(it.write.gd4ItemId);
    return ids;
  }, [pendingCommits]);
  const [lineFeedback, setLineFeedback] = useState<{ id: string; text: string } | null>(null);
  const itemAudit = useMemo(() => {
    const item = scored.items.find((i) => i.id === selectedId);
    return item ? auditEvidence([item], entries, folders) : [];
  }, [scored.items, selectedId, entries, folders]);

  // Warns when the sub-criterion's last audit ran in policy-only or
  // evidence-only mode — verdicts outside that scope are stale from a prior
  // run (or never assessed), so a partial run must never read as complete.
  const partialAuditScope = useMemo(() => {
    const folder = folders.find((f) => f.subCriterionId === req.subCriterionId);
    return folder?.lastAuditScope && folder.lastAuditScope !== "both" ? folder.lastAuditScope : null;
  }, [folders, req.subCriterionId]);

  // Dedupe for display: the same GD4 source line can end up in `specific`
  // twice (e.g. an audit auto-generated + verdicted copy alongside a freshly
  // regenerated "Not Started" copy), which surfaces as the same line appearing
  // once "Not met" and once "Not Started". Collapse by identity (sourceRef, or
  // the line text when there is no ref), keeping the most-progressed instance
  // (one with attached evidence / a non-default status wins). Display only —
  // band/scoring still read the raw `specific` array.
  const sortedSpecific = useMemo(() => {
    const rank = (l: SpecificChecklistLine) => (l.evidence.length > 0 ? 2 : 0) + (l.status !== "Not Started" ? 1 : 0);
    const byKey = new Map<string, SpecificChecklistLine>();
    const order: string[] = [];
    for (const l of specific) {
      const key = l.sourceRef || l.text.trim().toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, l);
        order.push(key);
      } else if (rank(l) > rank(existing)) {
        byKey.set(key, l);
      }
    }
    return order
      .map((k) => byKey.get(k)!)
      .sort((a, b) => (b.afiTag ? 1 : 0) - (a.afiTag ? 1 : 0));
  }, [specific]);

  const chartItems = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.specific.length > 0)
        .map((e) => {
          const r = GD4_REQUIREMENTS.find((x) => x.id === e.gd4ItemId)!;
          const result = computeBand(e.generic, e.specific, r.gateSensitive);
          return { id: e.gd4ItemId, title: r.requirement, ...result, quadrant: quadrantLabel(result.coveragePct, result.maturityCeiling), hasPending: pendingItemIds.has(e.gd4ItemId) };
        }),
    [entries, pendingItemIds]
  );

  function selectItem(id: string) {
    setSelectedId(id);
    setExpandedLine(null);
    ensureEntry(id);
  }

  useEffect(() => {
    const param = searchParams.get("item");
    if (param && param !== selectedId) {
      selectItem(param);
    }
    if (param) {
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("item");
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function toggleEvidence(lineId: string) {
    if (expandedLine === lineId) {
      setExpandedLine(null);
    } else {
      setExpandedLine(lineId);
      setExpandTab("evidence"); // per prototype: tabs default to Evidence on every expand
      setEvidenceDraft(emptyEvidenceDraft());
      setSamplingDraft({});
    }
  }

  const reuseTargets = GD4_REQUIREMENTS.filter((r) => r.id !== selectedId && (entries[r.id]?.specific.length || 0) > 0);
  const reuseTargetLines = reuseTargetItem ? entries[reuseTargetItem]?.specific || [] : [];
  const cameFromRubricBanding = searchParams.get("from") === "rubric-banding";

  return (
    <div>
    <NextStepBanner text={nextStepText("sub-checklist", { mode: useWorkspaceStore.getState().auditMode })} />
    <div className="grid gap-3" style={{ gridTemplateColumns: menuOpen ? "300px 1fr" : "1fr" }}>
      {menuOpen && (
      <Card style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>{PARENT_GROUP_COUNT} sub-criteria · {GD4_REQUIREMENTS.length} items</h3>
          <button onClick={() => setMenuOpen(false)} title="Hide list" style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 8px" }}>
            ✕ Hide
          </button>
        </div>
        <select
          value={menuCritFilter}
          onChange={(e) => setMenuCritFilter(e.target.value)}
          style={{ width: "100%", marginBottom: 8, padding: "4px 6px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11.5 }}
        >
          <option value="All">All criteria</option>
          {GD4_CRITERIA.map((c) => <option key={c.id} value={c.id}>C{c.id} · {c.title}</option>)}
        </select>
        {GD4_CRITERIA.filter((c) => menuCritFilter === "All" || c.id === menuCritFilter).map((c) => (
          <div key={c.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6b7280", margin: "8px 0 4px" }}>C{c.id} · {c.title}</div>
            {parentGroupsForCriterion(c.id).map((g) => (
              <div key={g.key} style={{ marginBottom: 4 }}>
                {/* Parent title header — display grouping only: non-clickable,
                    no band, no gate, no actions. */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", paddingLeft: 4 }}>{g.key} {g.title}</div>
                {g.items.map((r) => {
                  const e = entries[r.id];
                  const used = !!e && e.specific.length > 0;
                  const b = used ? computeBand(e.generic, e.specific, r.gateSensitive).finalBand : null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => selectItem(r.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        textAlign: "left",
                        cursor: "pointer",
                        border: "none",
                        background: selectedId === r.id ? "#fbf6ea" : "transparent",
                        borderRadius: 6,
                        padding: "4px 6px",
                        font: "inherit",
                      }}
                    >
                      <span style={{ fontSize: 11.5, fontWeight: selectedId === r.id ? 700 : 400, flex: 1 }}>
                        <b>{r.id}</b> {r.requirement}
                      </span>
                      {r.gateSensitive && <Pill s="high">Gate</Pill>}
                      {b != null ? <Pill s={bandTone(b)}>B{b}</Pill> : <span style={{ fontSize: 10, color: "#cbd5e1" }}>—</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </Card>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
        {!menuOpen && (
          <button
            onClick={() => setMenuOpen(true)}
            style={{ cursor: "pointer", alignSelf: "flex-start", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "6px 12px" }}
          >
            ☰ Show item list
          </button>
        )}
        <Card>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Coverage vs maturity</h3>
          <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 0 }}>
            Plots every item that has at least one specific (Layer 2) checklist line. Internal simulation only — no claim of official SSG result.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gridTemplateRows: "1fr 1fr auto", gap: 6 }}>
            <div />
            <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>Low coverage</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>High coverage</div>

            <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", writingMode: "vertical-rl", justifyContent: "center" }}>High maturity</div>
            <Quadrant label="Documentation gap" items={chartItems.filter((i) => i.quadrant === "Documentation gap")} onPick={selectItem} />
            <Quadrant label="Ready" items={chartItems.filter((i) => i.quadrant === "Ready")} onPick={selectItem} />

            <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", writingMode: "vertical-rl", justifyContent: "center" }}>Low maturity</div>
            <Quadrant label="Needs work" items={chartItems.filter((i) => i.quadrant === "Needs work")} onPick={selectItem} />
            <Quadrant label="Review gap" items={chartItems.filter((i) => i.quadrant === "Review gap")} onPick={selectItem} />
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            {cameFromRubricBanding && (
              <Link
                to={`/rubric-banding?view=item&scrollTo=${selectedId}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: BLUE, textDecoration: "none", padding: "4px 10px", border: "1px solid #bfdbfe", borderRadius: 6, background: "#eff6ff" }}
              >
                ← Rubric Banding
              </Link>
            )}
            <Link
              to={`/evidence-folder`}
              style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}
            >
              ← Evidence Folder
            </Link>
            <Link
              to={`/findings?item=${selectedId}`}
              style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff", marginLeft: "auto" }}
            >
              Findings for {selectedId} →
            </Link>
            <Link
              to="/afi-closure"
              style={{ fontSize: 12, color: "#15803d", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}
            >
              Quality Action / AFI →
            </Link>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{req.id} · {req.requirement}</h3>
            {req.gateSensitive && <Pill s="high">Gate-sensitive</Pill>}
          </div>
          <p style={{ fontSize: 11.5, color: "#6b7280" }}>{sub.title} — {sub.description}</p>

          {partialAuditScope && (
            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 11px", marginBottom: 8, fontSize: 12, color: "#9a3412", fontWeight: 600 }}>
              ⚠️ Last audit ran in {partialAuditScope}-only mode — {partialAuditScope === "policy" ? "evidence and outcomes were not assessed" : "policy was not assessed"}. Run a full audit to get complete results.
            </div>
          )}

          {req.expectedEvidence.length > 0 && (
            <div style={{ background: "#f0f6ff", borderRadius: 8, padding: "7px 11px", marginBottom: 8, fontSize: 11.5, color: "#374151" }}>
              <b style={{ fontSize: 11, color: "#4a5a8a", textTransform: "uppercase", letterSpacing: 0.3 }}>Expected evidence</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {req.expectedEvidence.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}

          {bandResult.started && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "6px 0 0" }}>
              <Pill s={bandTone(bandResult.finalBand)}>Band {bandResult.finalBand}</Pill>
              {bandResult.evidenceCapWarning && (
                <span style={{ fontSize: 11.5, color: "#b23121" }}>
                  ⚠ Capped: {bandResult.evidenceCapWarning}
                </span>
              )}
            </div>
          )}

          {itemPendingItems.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: "#92400e", fontWeight: 600 }}>
              <span aria-hidden>⚠</span>
              <span style={{ flex: 1, minWidth: 240 }}>
                {itemPendingItems.length} line{itemPendingItems.length === 1 ? "" : "s"} on this item {itemPendingItems.length === 1 ? "has" : "have"} a newer evidence run ({itemPendingRunId}) awaiting your review — the status/Band above may not reflect it yet.
              </span>
              <Link to={`/evidence-folder?run=${itemPendingRunId}`} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b45309", borderRadius: 6, padding: "5px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
                Review pending run →
              </Link>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => setMaturityOpen((o) => !o)}
              style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280", background: "transparent", border: "none", padding: "4px 0", display: "flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ fontSize: 10, color: "#94a3b8" }}>{maturityOpen ? "▾" : "▸"}</span>
              Maturity assessment (advanced)
            </button>
            {maturityOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 8 }}>
                {generic.map((g) => (
                  <div key={g.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 9 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>{g.id} · {g.lens}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", margin: "3px 0 6px" }}>{g.text}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select
                        value={g.status}
                        onChange={(e) => setGenericStatus(selectedId, g.id, e.target.value as GenericChecklistLine["status"])}
                        style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}
                      >
                        {GENERIC_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      <Pill s={statusTone(g.status)}>{g.status}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => generateSpecific(selectedId)}
              disabled={busy === selectedId}
              style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: `1px solid ${BLUE}`, background: "#eaeef6", color: "#4a5a8a" }}
            >
              {busy === selectedId ? "Generating…" : "AI first pass"}
            </button>
            <input
              placeholder="Add a specific line manually…"
              value={newLineText}
              onChange={(e) => setNewLineText(e.target.value)}
              style={{ ...inputStyle, width: 280 }}
            />
            <button
              onClick={() => {
                if (!newLineText.trim()) return;
                addSpecificLine(selectedId, newLineText.trim(), `GD4 ${selectedId} · Manual`);
                setNewLineText("");
              }}
              style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: `1px solid ${GOLD}`, background: "#fff" }}
            >
              + Add line
            </button>
            {specific.length > 0 && (
              <button
                onClick={() => {
                  if (confirm(`Remove all ${specific.length} checklist line(s) for ${selectedId}? This clears their statuses and attached evidence too, so you can regenerate from scratch.`)) clearSpecificLines(selectedId);
                }}
                style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid #e3b7b0", background: "#fff", color: "#b23121", marginLeft: "auto" }}
              >
                Remove all
              </button>
            )}
          </div>

          {pending.length > 0 && (
            <div style={{ border: `1px dashed ${GOLD}`, borderRadius: 10, padding: 10, marginBottom: 12, background: "#fffaf0" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
                Review AI-generated lines {entry?.generatedLive === false || entry?.generatedLive === undefined ? "(simulated)" : "(live)"} before confirming
              </div>
              {pending.map((l) => (
                <div key={l.id} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      value={l.text}
                      onChange={(e) => updatePendingLine(selectedId, l.id, { text: e.target.value })}
                      style={{ ...inputStyle, flex: 1, padding: "4px 6px" }}
                    />
                    <input
                      value={l.clause || ""}
                      onChange={(e) => updatePendingLine(selectedId, l.id, { clause: e.target.value })}
                      style={{ ...inputStyle, width: 140, padding: "4px 6px" }}
                    />
                    {l.afiTag && <Pill s="critical">AFI {l.afiTag}</Pill>}
                    <button onClick={() => removePendingLine(selectedId, l.id)} style={{ cursor: "pointer", fontSize: 11, color: "#b23121", border: "none", background: "transparent" }}>
                      Remove
                    </button>
                  </div>
                  {l.sourceType && (
                    <div style={{ fontSize: 10, color: "#78716c", marginTop: 2, paddingLeft: 2 }}>
                      GD4 source: {sourceLabel(l.sourceType, l.sourceIndex, l.sourceRef ?? undefined)}
                      {l.apsrDimension && <span style={{ marginLeft: 8, color: "#9ca3af" }}>APSR: {l.apsrDimension}</span>}
                      {l.sourceText && <span style={{ marginLeft: 8, color: "#b0ada8", fontStyle: "italic" }} title={l.sourceText}>"{l.sourceText.slice(0, 80)}{l.sourceText.length > 80 ? "…" : ""}"</span>}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  placeholder="Add another line…"
                  value={pendingAddText}
                  onChange={(e) => setPendingAddText(e.target.value)}
                  style={{ ...inputStyle, flex: 1, padding: "4px 6px" }}
                />
                <button
                  onClick={() => {
                    if (!pendingAddText.trim()) return;
                    addPendingLine(selectedId, pendingAddText.trim());
                    setPendingAddText("");
                  }}
                  style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  + Add
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => confirmGenerated(selectedId)}
                  style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none", background: GOLD, color: INK }}
                >
                  Confirm into checklist
                </button>
                <button
                  onClick={() => discardGenerated(selectedId)}
                  style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {sortedSpecific.map((l) => {
            const suff = lineSufficiency(l);
            // Every line whose status is Met, Partial or Not met must always
            // have a findings link/button available — Not Applicable/Not
            // Started lines aren't actionable, so they're excluded (buildDraftFinding
            // expects a decided status). draftableStatus is used both for the
            // draft object itself and to pick the button's label/action below.
            const draftableStatus = l.status === "Not met" || l.status === "Partial" || l.status === "Met";
            const draft = draftableStatus ? buildDraftFinding(req, l) : null;
            // A "Met" line's audit verdict record — the most recent evidence
            // item that carries an AI-derived APSR breakdown, i.e. it was
            // actually staged-audited rather than just marked Met by hand.
            // Purely informational (citation strength), distinct from the
            // finding-creation button below.
            const metEvidence = l.status === "Met" ? [...l.evidence].reverse().find((e) => e.apsr) : undefined;
            const expanded = expandedLine === l.id;
            const ref = l.sourceType && l.generatedBy === "ai" ? sourceLabel(l.sourceType, l.sourceIndex, l.sourceRef ?? undefined) : l.clause || null;
            // The most recent AI-run evidence item — ONE item so the tabs'
            // verdict/reasoning/runId always describe the same run (Task 1
            // gate: a write is atomic, one runId covers both halves). Manual
            // lines have none → no tab block, nothing to show.
            const aiItem = [...l.evidence].reverse().find((e) => e.runId);
            // Gate-visibility fix: a newer run for THIS line is queued but not
            // yet approved/rejected — everything above (Policy, Combined,
            // evidence) is still the last-APPROVED run, not this one.
            const pendingWrite = pendingWriteForLine(itemPendingItems, l);

            // Left border colour by status — strongest signal
            const statusBorder =
              l.status === "Not met"        ? "#ef4444" :
              l.status === "Partial"         ? "#f59e0b" :
              l.status === "Met"             ? "#22c55e" :
              l.status === "Not Applicable"  ? "#94a3b8" :
              "#cbd5e1"; // Not Started

            // Row 1 background tint by APSR dimension — subtle orientation cue
            const dimBg =
              l.apsrDimension === "Approach"           ? "#f0f6ff" :
              l.apsrDimension === "Processes"          ? "#f5f3ff" :
              l.apsrDimension === "Systems & Outcomes" ? "#f0fdf4" :
              l.apsrDimension === "Review"             ? "#fffbeb" :
              "#f8fafc";

            const row2Bg =
              l.status === "Not met"  ? "#fff8f8" :
              l.status === "Partial"  ? "#fffdf0" :
              l.status === "Met"      ? "#f6fff9" :
              "#f8fafc";

            return (
              <div key={l.id} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${statusBorder}`, borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
                {/* Row 1 — full text + ref/APSR pills — click to expand evidence panel */}
                <div
                  onClick={() => toggleEvidence(l.id)}
                  style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "8px 10px 5px", cursor: "pointer", background: expanded ? "#f0f4ff" : dimBg }}
                >
                  <span style={{ color: "#94a3b8", fontSize: 11, marginTop: 2, flexShrink: 0 }}>{expanded ? "▾" : "▸"}</span>
                  {/* Reference leads the row now (Task 4) — larger/bolder so the
                      existing ordering (already correct) is visible at a glance. */}
                  {ref && (
                    <span
                      style={{ fontSize: 13, fontWeight: 800, color: "#334155", fontFamily: "ui-monospace,monospace", flexShrink: 0, marginTop: 1, cursor: l.sourceText ? "help" : "default" }}
                      title={l.sourceText ? `Source: "${l.sourceText}"` : undefined}
                    >
                      {ref}
                    </span>
                  )}
                  {l.afiTag && <Pill s="critical">AFI {l.afiTag}</Pill>}
                  <span style={{ fontSize: 12.5, flex: 1, lineHeight: 1.45, color: "#1e293b" }}>{l.text}</span>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0, marginTop: 1 }}>
                    {l.apsrDimension && <Pill s="neutral">{l.apsrDimension}</Pill>}
                  </div>
                </div>
                {/* Row 2 — controls (smaller, stop click propagation) */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "4px 10px 7px 28px", borderTop: `1px solid ${statusBorder}22`, fontSize: 11, background: row2Bg }}
                >
                  {/* ONE editable verdict — the field that drives the band. The
                      PPD/Evidence split lives in the expand's read-only tabs;
                      this control keeps the exact same field, write path and
                      options as before (setSpecificStatus → l.status). */}
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>Verdict — drives the band</span>
                  <select
                    value={l.status}
                    onChange={(e) => setSpecificStatus(selectedId, l.id, e.target.value as SpecificLineStatus)}
                    style={{ ...inputStyle, width: "auto", padding: "3px 5px", fontSize: 11 }}
                  >
                    {SPECIFIC_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                  <Pill s={statusTone(l.status)}>
                    {l.status === "Met" || l.status === "Partial" || l.status === "Not met" ? evVerdictLabel(l.status) : l.status}
                  </Pill>
                  {l.generatedBy === "ai" && (
                    <ThumbsButtons
                      onAccept={() => logHumanDecision({ module: "Line Status", subjectId: selectedId, field: l.id, aiOutput: `AI verdict: ${l.status}`, humanDecision: `Accepted: ${l.status}`, changed: false, decisionType: "Accepted", reason: "" })}
                      onReject={() => setLineFeedback({ id: l.id, text: l.text })}
                    />
                  )}
                  {l.status !== "Not Applicable" && (
                    <button
                      onClick={() => toggleEvidence(l.id)}
                      style={{ cursor: "pointer", fontSize: 11, border: "none", background: "transparent", padding: 0, color: suff === "Present" ? "#15803d" : suff === "Weak" ? "#b45309" : "#b23121", fontWeight: 600 }}
                    >
                      {l.evidence.length > 0 ? `Evidence (${l.evidence.length})` : "Evidence: Missing"}
                    </button>
                  )}
                  {/* Every Met/Partial/Not met line always shows exactly one of these:
                      an existing finding already exists for this line — show the link
                      regardless of the line's CURRENT status/sufficiency (a line can have
                      a previously-saved finding even after its status later changed, and
                      the link must not disappear); otherwise a status-appropriate button
                      to create one (Not met/Partial -> draft an NC/OFI, Met -> raise an OBS). */}
                  {l.draftFinding?.savedFindingId ? (
                    <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>View finding →</Link>
                  ) : draft ? (
                    <button
                      onClick={() => toggleEvidence(l.id)}
                      title={metEvidence && l.status === "Met" ? "Also expands to show which chunks/documents were cited and why this line was rated Met" : undefined}
                      style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: l.status === "Met" ? "#15803d" : "#9a6b15", border: "none", background: "transparent", padding: 0 }}
                    >
                      {l.status === "Met" ? "Raise observation →" : "Draft finding →"}
                    </button>
                  ) : null}
                  <button onClick={() => removeSpecificLine(selectedId, l.id)} title="Remove line" style={{ cursor: "pointer", fontSize: 12, color: "#b23121", border: "none", background: "transparent", marginLeft: "auto", padding: "0 2px" }}>
                    ×
                  </button>
                </div>

                {/* Row 3 — stale-run warning. Always visible when present (never
                    buried behind expand): the Policy/Combined pills above are
                    the last-APPROVED run, not the newer one sitting in the gate. */}
                {pendingWrite && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderTop: "1px solid #fde68a", background: "#fffbeb", fontSize: 11.5, color: "#92400e", fontWeight: 600 }}
                  >
                    <span aria-hidden>⚠</span>
                    <span style={{ flex: 1, minWidth: 200 }}>
                      A newer evidence run ({itemPendingRunId}) is awaiting your review — this entry reflects an older run.
                    </span>
                    <Link to={`/evidence-folder?run=${itemPendingRunId}`} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#b45309", borderRadius: 6, padding: "3px 9px", textDecoration: "none", whiteSpace: "nowrap" }}>
                      Review pending run →
                    </Link>
                  </div>
                )}

                {expanded && (
                  <div style={{ padding: "0 9px 9px", borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
                    {/* PPD / Evidence reasoning tabs — read-only views of the ONE
                        AI run whose write produced this line (single runId, per
                        the Task 1 gate: PPD and Evidence halves are written
                        atomically and cannot diverge). Manual lines have no AI
                        evidence item, so no tab block renders for them. */}
                    {aiItem && (
                      <div style={{ marginBottom: 8, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          {(["ppd", "evidence"] as const).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setExpandTab(tab)}
                              style={{
                                cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 14px", border: "none",
                                borderBottom: expandTab === tab ? "2px solid #4338ca" : "2px solid transparent",
                                background: expandTab === tab ? "#fff" : "transparent",
                                color: expandTab === tab ? "#4338ca" : "#64748b",
                              }}
                            >
                              {tab === "ppd" ? "PPD" : "Evidence"}
                            </button>
                          ))}
                          <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#94a3b8", fontFamily: "ui-monospace,monospace", paddingRight: 10 }}>
                            Run {aiItem.runId}
                          </span>
                        </div>
                        <div style={{ padding: "8px 11px" }}>
                          {pendingWrite && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8, background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 6, padding: "6px 9px", fontSize: 11.5, color: "#92400e", fontWeight: 600 }}>
                              <span aria-hidden>⚠</span>
                              <span style={{ flex: 1, minWidth: 180 }}>This tab shows run {aiItem.runId} — a newer run ({itemPendingRunId}) is awaiting your review.</span>
                              <Link to={`/evidence-folder?run=${itemPendingRunId}`} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#b45309", borderRadius: 6, padding: "3px 9px", textDecoration: "none", whiteSpace: "nowrap" }}>
                                Review pending run →
                              </Link>
                            </div>
                          )}
                          {expandTab === "ppd" ? (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>Policy verdict</span>
                                <Pill s={aiItem.ppdVerdict ? ppdVerdictTone(aiItem.ppdVerdict) : "neutral"}>{aiItem.ppdVerdict ? ppdVerdictLabel(aiItem.ppdVerdict) : "—"}</Pill>
                                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>PPD reasoning as snapshotted by this evidence run</span>
                              </div>
                              {(aiItem.ppdComment || aiItem.apsr?.approach.note) ? (
                                <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.45, whiteSpace: "pre-line" }}>{aiItem.ppdComment || aiItem.apsr?.approach.note}</div>
                              ) : (
                                <div style={{ fontSize: 11.5, color: "#94a3b8", fontStyle: "italic" }}>No PPD reasoning stored on this line.</div>
                              )}
                            </>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>Run verdict</span>
                                <Pill s={aiItem.evidenceVerdict ? statusTone(aiItem.evidenceVerdict) : "neutral"}>{aiItem.evidenceVerdict ? evVerdictLabel(aiItem.evidenceVerdict) : "—"}</Pill>
                                {aiItem.evidenceVerdict && aiItem.evidenceVerdict !== l.status && (
                                  <span style={{ fontSize: 10.5, color: "#b45309" }}>differs from the current verdict above (edited after this run)</span>
                                )}
                              </div>
                              {(aiItem.evidenceComment || aiItem.apsr?.processes.note) ? (
                                <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.45, whiteSpace: "pre-line" }}>{aiItem.evidenceComment || aiItem.apsr?.processes.note}</div>
                              ) : (
                                <div style={{ fontSize: 11.5, color: "#94a3b8", fontStyle: "italic" }}>No evidence reasoning stored on this line.</div>
                              )}
                              {aiItem.promiseChecks && aiItem.promiseChecks.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>What the policy promised, checked against practice</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    {aiItem.promiseChecks.map((p, i) => {
                                      const tone = p.verdict === "evidenced" ? "#166534" : p.verdict === "contradicted" ? "#b91c1c" : "#b45309";
                                      const mark = p.verdict === "evidenced" ? "✓" : p.verdict === "contradicted" ? "✗" : "○";
                                      const lead = p.verdict === "evidenced" ? "Promise kept" : p.verdict === "contradicted" ? "Contradicted by the evidence" : "Not shown in the evidence";
                                      return (
                                        <div key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>
                                          <span style={{ color: tone, fontWeight: 700 }}>{mark} {lead}:</span>
                                          <span style={{ color: "#1e293b" }}> {p.promiseText}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {!draft && metEvidence?.apsr && (
                      <div style={{ marginBottom: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: "#15803d", marginBottom: 4, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3 }}>Evidence strength</div>
                        <div style={{ marginBottom: 4 }}>{metVerdictSummary(metEvidence.apsr)}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {l.apsrDimension && <Pill s="good">{l.apsrDimension}</Pill>}
                          {citedChunkIds(metEvidence.apsr).length > 0 ? (
                            <span style={{ fontSize: 11, color: "#166534" }}>
                              Cited: {citedChunkIds(metEvidence.apsr).join(", ")}
                              {metEvidence.title ? ` (${metEvidence.title})` : ""}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "#6b7280" }}>No specific chunk citation recorded for this verdict.</span>
                          )}
                        </div>
                      </div>
                    )}
                    {draft && (
                      <div style={{ marginBottom: 8, background: draft.findingType === "OBS" ? "#f0fdf4" : "#faf0d9", borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                        <b>{draft.findingType === "OBS" ? "Draft observation:" : "Draft finding:"}</b> {draft.issue}{" "}
                        {draft.findingType && <Pill s={findingTypeTone(draft.findingType)}>{draft.findingType}</Pill>}
                        {draft.ncSeverity && <Pill s={ncSeverityTone(draft.ncSeverity)}>{draft.ncSeverity}</Pill>}
                        {l.draftFinding?.savedFindingId ? (
                          <>
                            {" "}<Pill s="good">Saved as {l.draftFinding.savedFindingId}</Pill>
                            <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none", marginLeft: 6 }}>View →</Link>
                          </>
                        ) : (
                          <button
                            onClick={() => confirmDraftFinding(selectedId, l.id, draft)}
                            style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, marginLeft: 8, padding: "4px 9px", borderRadius: 6, border: `1px solid ${draft.findingType === "OBS" ? "#15803d" : "#9a6b15"}`, background: "#fff", color: draft.findingType === "OBS" ? "#15803d" : "#9a6b15" }}
                          >
                            {draft.findingType === "OBS" ? "Save observation" : "Save to findings register"}
                          </button>
                        )}
                      </div>
                    )}
                    {l.evidence.length > 0 && (
                      <table style={{ marginBottom: 8 }}>
                        <thead>
                          <tr><th>Title</th><th>Type</th><th>Owner</th><th>Date</th><th>Approved</th><th>Reviewed</th><th>Sufficiency</th><th /></tr>
                        </thead>
                        <tbody>
                          {l.evidence.map((ev) => (
                            <Fragment key={ev.id}>
                              <tr className="rowh">
                                <td>
                                  {ev.title} {ev.drive && <a href={ev.drive} target="_blank" rel="noreferrer" style={{ fontSize: 10.5 }}>(open)</a>}
                                  {ev.sharedFrom && <div style={{ fontSize: 10, color: "#94a3b8" }}>Shared from {ev.sharedFrom}</div>}
                                </td>
                                <td style={{ fontSize: 11.5 }}>{ev.type}</td>
                                <td style={{ fontSize: 11.5 }}>{ev.owner}</td>
                                <td style={{ fontSize: 11.5 }}>{ev.date}</td>
                                <td>
                                  <input type="checkbox" checked={ev.approved} onChange={(e) => updateEvidence(selectedId, l.id, ev.id, { approved: e.target.checked })} />
                                </td>
                                <td>
                                  <input type="checkbox" checked={ev.reviewed} onChange={(e) => updateEvidence(selectedId, l.id, ev.id, { reviewed: e.target.checked })} />
                                </td>
                                <td>
                                  <select
                                    value={ev.sufficiency}
                                    onChange={(e) => updateEvidence(selectedId, l.id, ev.id, { sufficiency: e.target.value as EvidenceSufficiency })}
                                    style={{ ...inputStyle, width: "auto", padding: "3px 5px" }}
                                  >
                                    {SUFFICIENCY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                                  </select>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  <button onClick={() => setReuseFrom({ lineId: l.id, evidenceId: ev.id })} style={{ cursor: "pointer", fontSize: 10.5, border: "none", background: "transparent", color: "#4a5a8a" }}>
                                    Reuse →
                                  </button>
                                  <button onClick={() => removeEvidence(selectedId, l.id, ev.id)} style={{ cursor: "pointer", fontSize: 10.5, border: "none", background: "transparent", color: "#b23121" }}>
                                    Remove
                                  </button>
                                </td>
                              </tr>
                              <tr>
                                <td colSpan={8} style={{ paddingTop: 0, paddingBottom: 8 }}>
                                  <textarea
                                    rows={ev.auditorNote && ev.auditorNote.includes("\n") ? 8 : 2}
                                    placeholder="Auditor note — justify the sufficiency verdict, note strengths/weaknesses/gaps, suggest how to close…"
                                    value={ev.auditorNote || ""}
                                    onChange={(e) => updateEvidence(selectedId, l.id, ev.id, { auditorNote: e.target.value })}
                                    style={{ ...inputStyle, width: "100%", resize: "vertical", fontSize: 11.5, whiteSpace: "pre-wrap" }}
                                  />
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {reuseFrom?.lineId === l.id && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap", background: "#eaeef6", borderRadius: 8, padding: 8 }}>
                        <span style={{ fontSize: 11 }}>Reuse in another sub-criterion item:</span>
                        <select value={reuseTargetItem} onChange={(e) => { setReuseTargetItem(e.target.value); setReuseTargetLine(""); }} style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}>
                          <option value="">Select item…</option>
                          {reuseTargets.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.requirement}</option>)}
                        </select>
                        <select value={reuseTargetLine} onChange={(e) => setReuseTargetLine(e.target.value)} disabled={!reuseTargetItem} style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}>
                          <option value="">Select line…</option>
                          {reuseTargetLines.map((tl) => <option key={tl.id} value={tl.id}>{tl.text.slice(0, 50)}</option>)}
                        </select>
                        <button
                          disabled={!reuseTargetItem || !reuseTargetLine}
                          onClick={() => {
                            reuseEvidence(selectedId, reuseFrom.lineId, reuseFrom.evidenceId, reuseTargetItem, reuseTargetLine);
                            setReuseFrom(null);
                            setReuseTargetItem("");
                            setReuseTargetLine("");
                          }}
                          style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: "none", background: GOLD, color: INK }}
                        >
                          Copy evidence
                        </button>
                        <button onClick={() => setReuseFrom(null)} style={{ cursor: "pointer", fontSize: 11, border: "none", background: "transparent" }}>
                          Cancel
                        </button>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input placeholder="Title" value={evidenceDraft.title} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, title: e.target.value })} style={{ ...inputStyle, width: 150, padding: "4px 6px" }} />
                      <select value={evidenceDraft.type} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, type: e.target.value })} style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}>
                        {EVIDENCE_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <input placeholder="Drive link" value={evidenceDraft.drive} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, drive: e.target.value })} style={{ ...inputStyle, width: 150, padding: "4px 6px" }} />
                      <button
                        disabled={!evidenceDraft.drive?.trim() || busy === `${selectedId}:${l.id}:evfill`}
                        onClick={async () => {
                          const draft = await fillEvidenceFromLink(selectedId, l.id, (evidenceDraft.drive || "").trim());
                          setEvidenceDraft((d) => ({ ...d, title: draft.title, type: draft.type, date: draft.date, sufficiency: draft.sufficiency, auditorNote: draft.auditorNote }));
                          setAiFilledDraft({ ...evidenceDraft, title: draft.title, type: draft.type, date: draft.date, sufficiency: draft.sufficiency, auditorNote: draft.auditorNote });
                        }}
                        title="Drafts title/type/date/sufficiency/note from the link alone — review every field before adding"
                        style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: `1px solid ${BLUE}`, background: "#eaeef6", color: "#4a5a8a" }}
                      >
                        {busy === `${selectedId}:${l.id}:evfill` ? "Filling…" : "AI fill from link"}
                      </button>
                      <input placeholder="Owner" value={evidenceDraft.owner} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, owner: e.target.value })} style={{ ...inputStyle, width: 90, padding: "4px 6px" }} />
                      <input type="date" value={evidenceDraft.date} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, date: e.target.value })} style={{ ...inputStyle, width: 130, padding: "4px 6px" }} />
                      <select value={evidenceDraft.sufficiency} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, sufficiency: e.target.value as EvidenceSufficiency })} style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}>
                        {SUFFICIENCY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      <label style={{ fontSize: 11 }}>
                        <input type="checkbox" checked={evidenceDraft.approved} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, approved: e.target.checked })} /> Approved
                      </label>
                      <label style={{ fontSize: 11 }}>
                        <input type="checkbox" checked={evidenceDraft.reviewed} onChange={(e) => setEvidenceDraft({ ...evidenceDraft, reviewed: e.target.checked })} /> Reviewed
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Auditor note — justify the sufficiency verdict, note strengths/weaknesses/gaps, suggest how to close…"
                        value={evidenceDraft.auditorNote || ""}
                        onChange={(e) => setEvidenceDraft({ ...evidenceDraft, auditorNote: e.target.value })}
                        style={{ ...inputStyle, width: "100%", resize: "vertical", fontSize: 11.5 }}
                      />
                      <button
                        onClick={() => {
                          if (!evidenceDraft.title.trim()) return;
                          if (aiFilledDraft) {
                            const aiSummary = `title: ${aiFilledDraft.title}; type: ${aiFilledDraft.type}; sufficiency: ${aiFilledDraft.sufficiency}`;
                            const humanSummary = `title: ${evidenceDraft.title}; type: ${evidenceDraft.type}; sufficiency: ${evidenceDraft.sufficiency}`;
                            const changed = aiSummary !== humanSummary;
                            logHumanDecision({ module: "Evidence Intake", subjectId: selectedId, field: "evidence", aiOutput: aiSummary, humanDecision: humanSummary, changed, decisionType: changed ? "Edited" : "Accepted", reason: "" });
                            setAiFilledDraft(null);
                          }
                          addEvidence(selectedId, l.id, evidenceDraft);
                          setEvidenceDraft(emptyEvidenceDraft());
                        }}
                        style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: `1px solid ${GOLD}`, background: "#fff" }}
                      >
                        + Add evidence
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Sampling register (optional, for quantitative lines):</span>
                      <input
                        type="number"
                        placeholder="Population"
                        value={l.sampling?.population ?? samplingDraft.population ?? ""}
                        onChange={(e) => setSamplingDraft({ ...samplingDraft, population: Number(e.target.value) })}
                        style={{ ...inputStyle, width: 90, padding: "4px 6px" }}
                      />
                      <input
                        type="number"
                        placeholder="Sample size"
                        value={l.sampling?.sampleSize ?? samplingDraft.sampleSize ?? ""}
                        onChange={(e) => setSamplingDraft({ ...samplingDraft, sampleSize: Number(e.target.value) })}
                        style={{ ...inputStyle, width: 90, padding: "4px 6px" }}
                      />
                      <input
                        placeholder="Sample IDs"
                        value={l.sampling?.sampleIds ?? samplingDraft.sampleIds ?? ""}
                        onChange={(e) => setSamplingDraft({ ...samplingDraft, sampleIds: e.target.value })}
                        style={{ ...inputStyle, width: 160, padding: "4px 6px" }}
                      />
                      <button
                        onClick={() => setSampling(selectedId, l.id, samplingDraft)}
                        style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                      >
                        Save sampling
                      </button>
                    </div>

                    {l.draftFinding?.savedFindingId && (
                      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid #f1f5f9" }}>
                        <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 11.5, color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>
                          View finding →
                        </Link>
                        {closures[l.draftFinding.savedFindingId] ? (
                          <Link to={`/afi-closure?item=${selectedId}`} style={{ fontSize: 11.5, color: "#9a6b15", fontWeight: 600, textDecoration: "none" }}>
                            Manage closure →
                          </Link>
                        ) : (
                          <Link to={`/afi-closure?item=${selectedId}`} style={{ fontSize: 11.5, color: "#94a3b8", fontWeight: 600, textDecoration: "none" }}>
                            Manage closure → <span style={{ fontWeight: 400 }}>(not started)</span>
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {sortedSpecific.length === 0 && pending.length === 0 && (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No specific lines yet — run "AI first pass" or add one manually.</p>
          )}
        </Card>

        <EvidenceGapPanel generic={generic} specific={specific} req={req} itemId={selectedId} />

        <Card>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Band result</h3>
          {bandResult.started ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                <Metric label="Coverage %" value={`${Math.round(bandResult.coveragePct)}%`} />
                <Metric label="Maturity ceiling" value={<Pill s={bandTone(bandResult.maturityCeiling)}>Band {bandResult.maturityCeiling}</Pill>} />
                <Metric label="Coverage cap" value={<Pill s={bandTone(bandResult.coverageCap)}>Band {bandResult.coverageCap}</Pill>} />
                <Metric label="Final band" value={<Pill s={bandTone(bandResult.finalBand)}>Band {bandResult.finalBand}</Pill>} />
              </div>
              {bandResult.evidenceCapWarning && (
                <div style={{ marginTop: 10, background: "#fbe7e3", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#b23121" }}>
                  <b>Evidence cap:</b> {bandResult.evidenceCapWarning}
                </div>
              )}
              {itemPendingItems.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#92400e" }}>
                  <span aria-hidden>⚠</span>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <b>Possibly stale:</b> a newer evidence run ({itemPendingRunId}) is awaiting review — this Band was computed from the last-approved run, not that one.
                  </span>
                  <Link to={`/evidence-folder?run=${itemPendingRunId}`} style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#b45309", borderRadius: 6, padding: "4px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>
                    Review →
                  </Link>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No band yet — add at least one specific checklist line for this item to compute one.</p>
          )}
          <div style={{ marginTop: 10 }}>
            {itemAudit.length === 0 ? (
              <div style={{ background: TONE.good.bg, color: TONE.good.fg, borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                Evidence check: no gaps found for this item — current band is not standing on unverified evidence.
              </div>
            ) : (
              itemAudit.map((f) => (
                <div key={f.source} style={{ background: "#fbe7e3", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#b23121" }}>
                  <b>Evidence check ({f.source}):</b> {f.reason}
                </div>
              ))
            )}
          </div>
          <p style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
            This module feeds its band back into the workspace's overall scoring engine once it has at least one specific line for this item. Internal
            simulation only — no claim of official SSG result anywhere in this tool.
          </p>
        </Card>
      </div>
      <FeedbackModal
        open={!!lineFeedback}
        aiOutput={lineFeedback?.text ?? ""}
        onClose={() => setLineFeedback(null)}
        onSubmit={(fb) => {
          logHumanDecision({ module: "Line Status", subjectId: selectedId, field: lineFeedback?.id, aiOutput: lineFeedback?.text ?? "", humanDecision: (fb.correction || lineFeedback?.text) ?? "", changed: !!fb.correction, decisionType: "Overridden", reason: fb.reason });
          if (!fb.correct && fb.correction) {
            addCalibrationMemory({ module: "Line Status", subjectId: selectedId, context: lineFeedback?.text ?? "", aiOutput: lineFeedback?.text ?? "", staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: Math.round((lineFeedback?.text?.length ?? 0) / 4) });
          }
          setLineFeedback(null);
        }}
      />
    </div>
    </div>
  );
}

function Quadrant({ label, items, onPick }: { label: string; items: { id: string; title: string; finalBand: number; hasPending?: boolean }[]; onPick: (id: string) => void }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8, minHeight: 70 }}>
      <Pill s={quadrantTone(label)}>{label}</Pill>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => onPick(i.id)}
            title={i.hasPending ? `${i.title} — a newer evidence run is awaiting review; this band may be stale` : i.title}
            style={{
              cursor: "pointer", fontSize: 10.5, padding: "2px 7px", borderRadius: 999,
              border: i.hasPending ? "1px solid #f59e0b" : "1px solid #cbd5e1", background: i.hasPending ? "#fffbeb" : "#fff",
            }}
          >
            {i.hasPending && "⚠ "}{i.id}
          </button>
        ))}
        {items.length === 0 && <span style={{ fontSize: 10.5, color: "#cbd5e1" }}>—</span>}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 9 }}>
      <div style={{ fontSize: 10.5, color: "#94a3b8", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}
