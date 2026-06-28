import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { auditEvidence } from "../lib/evidenceAudit";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { buildGenericLines } from "../data/checklistSeed";
import { computeBand, lineSufficiency, buildDraftFinding, findingDimension, computeRiskCategory } from "../lib/checklistBanding";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
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
} from "../types";

// Formats the short "GD4 source: …" label for a generated line's provenance.
function sourceLabel(sourceType: ChecklistSourceType, sourceIndex: number | null | undefined): string {
  if (sourceType === "describeShow") return `Describe/Show ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "note") return `Note ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "expectedEvidence") return `Expected Evidence ${(sourceIndex ?? 0) + 1}`;
  if (sourceType === "intent") return "Intent";
  return "Requirement";
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

function sufficiencyTone(s: EvidenceSufficiency): "good" | "medium" | "critical" {
  return s === "Present" ? "good" : s === "Weak" ? "medium" : "critical";
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

function EvidenceGapPanel({ generic, specific, req }: {
  generic: GenericChecklistLine[];
  specific: SpecificChecklistLine[];
  req: GD4Requirement;
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
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", background: finding.bg, borderRadius: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: finding.color, padding: "2px 8px", background: "rgba(255,255,255,0.75)", borderRadius: 6, flexShrink: 0 }}>
            Likely: {finding.type}
          </span>
          <span style={{ fontSize: 11.5, color: "#374151" }}>{finding.desc}</span>
        </div>
      ) : (
        activeLines.length > 0 && (
          <div style={{ fontSize: 12, color: "#15803d" }}>✓ No gaps detected — all active lines are met with present evidence.</div>
        )
      )}
      <p style={{ fontSize: 10.5, color: "#94a3b8", margin: "8px 0 0" }}>
        Maturity from Layer 1 (G1–G4) · gap counts from Layer 2 specific lines · internal simulation only.
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
  const [samplingDraft, setSamplingDraft] = useState<{ population?: number; sampleSize?: number; sampleIds?: string }>({});
  const [reuseFrom, setReuseFrom] = useState<{ lineId: string; evidenceId: string } | null>(null);
  const [reuseTargetItem, setReuseTargetItem] = useState("");
  const [reuseTargetLine, setReuseTargetLine] = useState("");

  const req = GD4_REQUIREMENTS.find((r) => r.id === selectedId)!;
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === req.subCriterionId)!;
  const entry = entries[selectedId];
  const generic = entry?.generic.length ? entry.generic : buildGenericLines();
  const specific = entry?.specific || [];
  const pending = entry?.pendingGenerated || [];

  const bandResult = useMemo(() => computeBand(generic, specific, req.gateSensitive), [generic, specific, req.gateSensitive]);

  const scored = useScored();
  const folders = useWorkspaceStore((s) => s.folders);
  const itemAudit = useMemo(() => {
    const item = scored.items.find((i) => i.id === selectedId);
    return item ? auditEvidence([item], entries, folders) : [];
  }, [scored.items, selectedId, entries, folders]);

  const sortedSpecific = useMemo(() => [...specific].sort((a, b) => (b.afiTag ? 1 : 0) - (a.afiTag ? 1 : 0)), [specific]);

  const chartItems = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.specific.length > 0)
        .map((e) => {
          const r = GD4_REQUIREMENTS.find((x) => x.id === e.gd4ItemId)!;
          const result = computeBand(e.generic, e.specific, r.gateSensitive);
          return { id: e.gd4ItemId, title: r.requirement, ...result, quadrant: quadrantLabel(result.coveragePct, result.maturityCeiling) };
        }),
    [entries]
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
      setEvidenceDraft(emptyEvidenceDraft());
      setSamplingDraft({});
    }
  }

  const reuseTargets = GD4_REQUIREMENTS.filter((r) => r.id !== selectedId && (entries[r.id]?.specific.length || 0) > 0);
  const reuseTargetLines = reuseTargetItem ? entries[reuseTargetItem]?.specific || [] : [];
  const cameFromRubricBanding = searchParams.get("from") === "rubric-banding";

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: menuOpen ? "300px 1fr" : "1fr" }}>
      {menuOpen && (
      <Card style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>24 sub-criteria · 35 items</h3>
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
            {GD4_SUB_CRITERIA.filter((s) => s.criterionId === c.id).map((s) => (
              <div key={s.id} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", paddingLeft: 4 }}>{s.id} {s.title}</div>
                {GD4_REQUIREMENTS.filter((r) => r.subCriterionId === s.id).map((r) => {
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
          {cameFromRubricBanding && (
            <Link
              to={`/rubric-banding?view=item&scrollTo=${selectedId}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: BLUE, textDecoration: "none", marginBottom: 8 }}
            >
              ← Back to Rubric Banding
            </Link>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{req.id} · {req.requirement}</h3>
            {req.gateSensitive && <Pill s="high">Gate-sensitive</Pill>}
          </div>
          <p style={{ fontSize: 11.5, color: "#6b7280" }}>{sub.title} — {sub.description}</p>

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

          <h4 style={{ fontSize: 12.5, margin: "12px 0 6px" }}>Layer 1 · Generic maturity check</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
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

          <h4 style={{ fontSize: 12.5, margin: "16px 0 6px" }}>Layer 2 · Specific testable lines</h4>
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
                  if (confirm(`Remove all ${specific.length} Layer 2 line(s) for ${selectedId}? This clears their statuses and attached evidence too, so you can regenerate from scratch.`)) clearSpecificLines(selectedId);
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
                      GD4 source: {sourceLabel(l.sourceType, l.sourceIndex)}
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
            const needsFinding = l.status === "Not met" || (l.status !== "Not Applicable" && l.status !== "Not Started" && suff === "Missing");
            const draft = needsFinding ? buildDraftFinding(req, l) : null;
            return (
              <div key={l.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 9, marginBottom: 7 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {l.afiTag && <Pill s="critical">AFI {l.afiTag}</Pill>}
                  <span style={{ fontSize: 12 }}>{l.text}</span>
                  {l.clause && <span style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: "ui-monospace,monospace" }}>{l.clause}</span>}
                  {l.sourceType && l.generatedBy === "ai" && (
                    <span
                      style={{ fontSize: 10, color: "#a8a29e", cursor: l.sourceText ? "help" : "default" }}
                      title={l.sourceText ? `Source: "${l.sourceText}"` : undefined}
                    >
                      GD4: {sourceLabel(l.sourceType, l.sourceIndex)}{l.apsrDimension ? ` · ${l.apsrDimension}` : ""}
                    </span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={l.status}
                      onChange={(e) => setSpecificStatus(selectedId, l.id, e.target.value as SpecificLineStatus)}
                      style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}
                    >
                      {SPECIFIC_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                    <Pill s={statusTone(l.status)}>{l.status}</Pill>
                    {l.status !== "Not Applicable" && <Pill s={sufficiencyTone(suff)}>Evidence: {suff}</Pill>}
                    <button
                      onClick={() => toggleEvidence(l.id)}
                      style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: expandedLine === l.id ? "#eef1f5" : "#fff" }}
                    >
                      Evidence ({l.evidence.length})
                    </button>
                    <button onClick={() => removeSpecificLine(selectedId, l.id)} style={{ cursor: "pointer", fontSize: 11, color: "#b23121", border: "none", background: "transparent" }}>
                      Remove
                    </button>
                  </div>
                </div>

                {draft && (
                  <div style={{ marginTop: 7, background: "#faf0d9", borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
                    <b>Draft finding:</b> {draft.issue} <Pill s={draft.severity === "High" ? "high" : "medium"}>{draft.severity}</Pill>
                    {l.draftFinding?.savedFindingId ? (
                      <Pill s="good">Saved as {l.draftFinding.savedFindingId}</Pill>
                    ) : (
                      <button
                        onClick={() => confirmDraftFinding(selectedId, l.id, draft)}
                        style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, marginLeft: 8, padding: "4px 9px", borderRadius: 6, border: "1px solid #9a6b15", background: "#fff", color: "#9a6b15" }}
                      >
                        Save to findings register
                      </button>
                    )}
                  </div>
                )}

                {expandedLine === l.id && (
                  <div style={{ marginTop: 8, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
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
                  </div>
                )}
              </div>
            );
          })}
          {sortedSpecific.length === 0 && pending.length === 0 && (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No specific lines yet — run "AI first pass" or add one manually.</p>
          )}
        </Card>

        <EvidenceGapPanel generic={generic} specific={specific} req={req} />

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
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No band yet — add at least one specific (Layer 2) line for this item to compute one.</p>
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
    </div>
  );
}

function Quadrant({ label, items, onPick }: { label: string; items: { id: string; title: string; finalBand: number }[]; onPick: (id: string) => void }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8, minHeight: 70 }}>
      <Pill s={quadrantTone(label)}>{label}</Pill>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => onPick(i.id)}
            title={i.title}
            style={{ cursor: "pointer", fontSize: 10.5, padding: "2px 7px", borderRadius: 999, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            {i.id}
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
