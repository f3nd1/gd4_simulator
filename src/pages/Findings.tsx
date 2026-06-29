import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useFindingDraftStore } from "../store/useFindingDraftStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { Card, filterSelectStyle, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { GOLD, INK } from "../lib/theme";
import type { Finding, FindingType, Severity, FindingDimension, GroupedFindingDraft } from "../types";
import { runLiveFindingObservation, AIClientError } from "../lib/ai/agentRuntime";
import { effectiveSettings } from "../lib/ai/aiClient";
import { lineApsr, findingDimension, computeRiskCategory } from "../lib/checklistBanding";

const TYPES: (FindingType | "All")[] = ["All", "AFI", "Improvement Action", "Observation", "Quality Action", "Critical Readiness Risk"];
const SEVERITIES: (Severity | "All")[] = ["All", "Critical", "High", "Medium", "Low"];
const RAISABLE_TYPES: FindingType[] = ["AFI", "Improvement Action", "Observation", "Quality Action", "Critical Readiness Risk"];
const DIMENSIONS: (FindingDimension | "All")[] = ["All", "Procedure", "Evidence", "Outcomes", "Review", "Unverified"];
const RISK_CATS: ("A" | "B" | "C" | "D" | "All")[] = ["All", "A", "B", "C", "D"];

function severityTone(sev: Severity) {
  return sev === "Critical" || sev === "High" ? "critical" : sev === "Medium" ? "medium" : "neutral";
}

// Procedure (documented policy) vs Evidence (implementation) are the two the
// user most cares about, so they get the two strongest, most distinct colours.
function dimensionTone(d: FindingDimension): "good" | "medium" | "critical" | "neutral" | "high" | "progress" {
  return d === "Procedure" ? "progress" : d === "Evidence" ? "medium" : d === "Outcomes" ? "high" : d === "Unverified" ? "critical" : "neutral";
}

function dimensionLabel(d: FindingDimension): string {
  return d === "Procedure" ? "Procedure (policy)" : d === "Evidence" ? "Evidence (implementation)" : d;
}

function riskCatTone(c: "A" | "B" | "C" | "D"): string {
  return c === "A" ? "critical" : c === "B" ? "high" : c === "C" ? "medium" : "progress";
}

function riskCatLabel(c: "A" | "B" | "C" | "D"): string {
  return c === "A" ? "Cat A — Regulatory" : c === "B" ? "Cat B — Star risk" : c === "C" ? "Cat C — Band cap" : "Cat D — Enhance";
}

const EMPTY_FORM = {
  gd4ItemId: GD4_REQUIREMENTS[0]?.id || "",
  issue: "",
  observation: "",
  criteria: "",
  effect: "",
  type: "AFI" as FindingType,
  severity: "Medium" as Severity,
  owner: "",
  dueDate: "",
  repeatFinding: false,
  dimension: "" as FindingDimension | "",
  riskCategory: "" as "A" | "B" | "C" | "D" | "",
};

export function Findings() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const closures = useWorkspaceStore((s) => s.closures);
  const addCustomFinding = useWorkspaceStore((s) => s.addCustomFinding);
  const removeCustomFinding = useWorkspaceStore((s) => s.removeCustomFinding);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  const raiseAllUnmetFindings = useChecklistModuleStore((s) => s.raiseAllUnmetFindings);
  const scored = useScored();
  const allFindings = useAllFindings();
  const [searchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<FindingType | "All">("All");
  const [sevFilter, setSevFilter] = useState<Severity | "All">("All");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [subCritFilter, setSubCritFilter] = useState<string>(() => searchParams.get("subCrit") ?? "All");
  const [dimFilter, setDimFilter] = useState<FindingDimension | "All">("All");
  const [riskCatFilter, setRiskCatFilter] = useState<"A" | "B" | "C" | "D" | "All">("All");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [sortCol, setSortCol] = useState<"raised" | "id" | "gd4">("raised");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fromItem = searchParams.get("item"); // e.g. "1.1.1" — jumps to that item's sub-criterion filter
  useEffect(() => {
    if (fromItem) {
      const req = GD4_REQUIREMENTS.find((r) => r.id === fromItem);
      if (req) setSubCritFilter(req.subCriterionId);
    }
  }, [fromItem]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedSubCrits, setExpandedSubCrits] = useState<Set<string>>(new Set());
  const [detailFinding, setDetailFinding] = useState<Finding | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [genNote, setGenNote] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const aiSettings = useAISettingsStore((s) => s);
  const aiEnabled = aiSettings.enabled && !!aiSettings.apiKey;
  const pushAIReviewLog = useWorkspaceStore((s) => s.pushAIReviewLog);

  // Counts by dimension across the whole register, so the procedure-vs-evidence
  // split is visible at a glance above the table.
  const dimCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of allFindings) if (f.dimension) c[f.dimension] = (c[f.dimension] || 0) + 1;
    return c;
  }, [allFindings]);

  // Counts by risk category across the whole register.
  const riskCatCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of allFindings) if (f.riskCategory) c[f.riskCategory] = (c[f.riskCategory] || 0) + 1;
    return c;
  }, [allFindings]);

  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );

  async function draftObservation() {
    const req = GD4_REQUIREMENTS.find((r) => r.id === form.gd4ItemId);
    if (!req || !aiEnabled) return;
    setDraftError(null);
    setDraftBusy(true);
    try {
      // Use real checklist data if available — find the worst Not-met line.
      const entries = useChecklistModuleStore.getState().entries;
      const entry = entries[form.gd4ItemId];
      let lineArg: { text: string; status: string };
      let dimensionArg: string;
      let apsrArg: ReturnType<typeof lineApsr> | undefined;

      if (entry && entry.specific.length > 0) {
        const notMetLines = entry.specific.filter((l) => l.status === "Not met");
        // Prefer a line that has APSR data attached
        const worst =
          notMetLines.find((l) => lineApsr(l) !== undefined) ||
          notMetLines[0] ||
          entry.specific[0];
        lineArg = { text: worst.text, status: worst.status };
        dimensionArg = findingDimension(worst);
        apsrArg = lineApsr(worst);
      } else {
        // No checklist data — fall back to generic requirement text
        lineArg = { text: req.requirement, status: "Not met" };
        dimensionArg = form.dimension || "Procedure";
        apsrArg = undefined;
      }

      const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
      const result = await runLiveFindingObservation(req, lineArg, dimensionArg, apsrArg, settings);
      pushAIReviewLog({
        agent: "Finding Body Drafter",
        reviewType: "Finding",
        subjectId: req.id,
        verdict: "Draft",
        confidence: "Medium",
        keyConcerns: [dimensionArg],
        recommendedAction: "Review and edit the drafted finding body before saving",
        live: settings.enabled,
        generatedContent: `OBSERVATION:\n${result.observation}\n\nCRITERIA:\n${result.criteria}\n\nEFFECT:\n${result.effect}`,
        promptSent: result.promptSent,
        usage: result.usage,
      });
      setForm((f) => ({
        ...f,
        observation: result.observation,
        criteria: result.criteria,
        effect: result.effect,
        issue: f.issue || req.requirement.slice(0, 100),
      }));
    } catch (e) {
      setDraftError(e instanceof AIClientError ? e.message : "AI draft failed — check your API key in Settings.");
    } finally {
      setDraftBusy(false);
    }
  }

  function handleGd4ItemChange(newItemId: string) {
    const req = GD4_REQUIREMENTS.find((r) => r.id === newItemId);
    // Auto-compute riskCategory from the requirement
    const newRiskCategory: "A" | "B" | "C" | "D" | "" = req
      ? computeRiskCategory(req, "Evidence")
      : "";
    setForm((f) => ({
      ...f,
      gd4ItemId: newItemId,
      dimension: "",
      riskCategory: newRiskCategory,
    }));
  }

  function submitFinding() {
    if (!form.issue.trim() || !form.gd4ItemId) return;
    const finding: Finding = {
      id: `FIND-${Date.now()}`,
      auditCycleId: cycle.id,
      gd4ItemId: form.gd4ItemId,
      issue: form.issue.trim(),
      observation: form.observation.trim() || undefined,
      criteria: form.criteria.trim() || undefined,
      effect: form.effect.trim() || undefined,
      type: form.type,
      severity: form.severity,
      owner: form.owner.trim(),
      dueDate: form.dueDate,
      repeatFinding: form.repeatFinding,
      overdue: false,
      managementDecisionNeeded: form.severity === "Critical" || form.severity === "High",
      status: "Open",
      source: "Manual",
      createdAt: new Date().toISOString(),
      dimension: form.dimension || undefined,
      riskCategory: (form.riskCategory as "A" | "B" | "C" | "D") || undefined,
    };
    addCustomFinding(finding);
    setForm(EMPTY_FORM);
    setShowForm(false);
    setDraftError(null);
  }

  const rows = useMemo(() => {
    const filtered = allFindings.filter((f) => {
      if (typeFilter !== "All" && f.type !== typeFilter) return false;
      if (sevFilter !== "All" && f.severity !== sevFilter) return false;
      if (dimFilter !== "All" && f.dimension !== dimFilter) return false;
      if (riskCatFilter !== "All" && f.riskCategory !== riskCatFilter) return false;
      if (dateFilter !== "all" && f.createdAt) {
        const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 90;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        if (new Date(f.createdAt).getTime() < cutoff) return false;
      }
      const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
      if (critFilter !== "All" && req?.criterion !== critFilter) return false;
      if (subCritFilter !== "All" && req?.subCriterionId !== subCritFilter) return false;
      return true;
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "raised") {
        cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      } else if (sortCol === "id") {
        cmp = a.id.localeCompare(b.id);
      } else if (sortCol === "gd4") {
        cmp = a.gd4ItemId.localeCompare(b.gd4ItemId);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return filtered;
  }, [allFindings, typeFilter, sevFilter, dimFilter, riskCatFilter, dateFilter, critFilter, subCritFilter, sortCol, sortDir]);

  const SEV_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

  const groupedRows = useMemo(() => {
    const map = new Map<string, { subCritId: string; findings: Finding[] }>();
    for (const f of rows) {
      const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
      const scId = req?.subCriterionId ?? f.gd4ItemId;
      if (!map.has(scId)) map.set(scId, { subCritId: scId, findings: [] });
      map.get(scId)!.findings.push(f);
    }
    return Array.from(map.values()).sort((a, b) => a.subCritId.localeCompare(b.subCritId));
  }, [rows]);

  const summaryStats = useMemo(() => {
    const subCrits = new Set(rows.map((f) => {
      const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
      return req?.subCriterionId ?? f.gd4ItemId;
    }));
    const open = rows.filter((f) => (closures[f.id]?.human || "") !== "Accepted").length;
    return { subCrits: subCrits.size, gaps: rows.length, open, closed: rows.length - open };
  }, [rows, closures]);

  function generateFromGaps() {
    const n = raiseAllUnmetFindings();
    setGenNote(n > 0 ? `Raised ${n} new finding${n === 1 ? "" : "s"} from audit/checklist gaps.` : "No new gaps to raise — every unmet line already has a finding.");
  }

  const draftStore = useFindingDraftStore();
  const allDraftsBySubCrit = draftStore.draftsBySubCriterion;
  const draftStoreBusy = draftStore.busy;
  const [groupGenNote, setGroupGenNote] = useState<string | null>(null);
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);

  // Flatten all drafts that are not yet confirmed for the "Grouped findings" section.
  const pendingGroupedDrafts = useMemo(() => {
    const out: GroupedFindingDraft[] = [];
    for (const arr of Object.values(allDraftsBySubCrit)) {
      for (const d of arr) {
        if (d.status !== "confirmed") out.push(d);
      }
    }
    return out;
  }, [allDraftsBySubCrit]);

  async function generateGroupedFindings() {
    setGroupGenNote(null);
    const aiOn = aiSettings.enabled && !!aiSettings.apiKey;
    const result = await draftStore.generateFindingsFromChecklist({ live: aiOn });
    if (result.created > 0) {
      setGroupGenNote(`Created ${result.created} grouped draft${result.created !== 1 ? "s" : ""}${result.skipped > 0 ? `, skipped ${result.skipped} already covered` : ""}.`);
    } else {
      setGroupGenNote(result.skipped > 0 ? `All ${result.skipped} groups already have findings — nothing new to create.` : "No failing checklist lines found — run a folder audit or mark lines in the Sub-Criterion Checklist.");
    }
  }

  const openFindings = allFindings.filter((f) => (closures[f.id]?.human || "") !== "Accepted");
  // 90-day roadmap: group open findings by urgency into three monthly buckets.
  // Cat A (regulatory breach) + Critical severity = Month 1 — must fix now.
  // Cat B (Star-disqualifying) + High severity = Month 2 — fix this quarter.
  // Cat C/D + lower severity = Month 3 — plan and schedule.
  const roadmap = {
    m1: openFindings.filter((f) => f.riskCategory === "A" || f.severity === "Critical"),
    m2: openFindings.filter((f) => f.riskCategory !== "A" && f.severity !== "Critical" && (f.riskCategory === "B" || f.severity === "High")),
    m3: openFindings.filter((f) => !["A", "B"].includes(f.riskCategory || "") && !["Critical", "High"].includes(f.severity)),
  };
  const showRoadmap = openFindings.length > 0;

  return (
    <Fragment>
    {/* Cross-module navigation bar */}
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
      <Link to="/sub-checklist" style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}>
        ← Sub-Criterion Checklist
      </Link>
      {fromItem && (
        <Link to={`/sub-checklist?item=${fromItem}`} style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#e0e7ff" }}>
          ← Back to {fromItem}
        </Link>
      )}
      <Link to="/afi-closure" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4", marginLeft: "auto" }}>
        Quality Action / AFI →
      </Link>
    </div>
    {showRoadmap && (
      <Card style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>90-day remediation roadmap</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          Open findings grouped by urgency. Cat A / Critical findings must be resolved immediately before any EduTrust submission.
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {[
            { label: "Month 1 — Days 1–30", desc: "Cat A (regulatory) + Critical", items: roadmap.m1, color: "#fff1f2", border: "#fca5a5", headColor: "#b91c1c" },
            { label: "Month 2 — Days 31–60", desc: "Cat B (Star risk) + High severity", items: roadmap.m2, color: "#fff7ed", border: "#fdba74", headColor: "#c2410c" },
            { label: "Month 3 — Days 61–90", desc: "Cat C/D + Medium / Low severity", items: roadmap.m3, color: "#f0fdf4", border: "#86efac", headColor: "#15803d" },
          ].map(({ label, desc, items, color, border, headColor }) => (
            <div key={label} style={{ background: color, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: headColor }}>{label}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{desc}</div>
              {items.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "#9ca3af" }}>None</div>
              ) : (
                items.slice(0, 4).map((f) => (
                  <div key={f.id} style={{ fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <b>{f.gd4ItemId}</b> {f.issue.slice(0, 55)}{f.issue.length > 55 ? "…" : ""}
                    {items.length > 4 && items[3] === f && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>+{items.length - 4} more</div>}
                  </div>
                ))
              )}
              {items.length > 0 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}><b>{items.length}</b> finding{items.length !== 1 ? "s" : ""}</div>}
            </div>
          ))}
        </div>
      </Card>
    )}
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Grouped findings from checklist</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {pendingGroupedDrafts.length > 0 ? `${pendingGroupedDrafts.length} draft${pendingGroupedDrafts.length !== 1 ? "s" : ""} awaiting review` : "No pending drafts"}
        </span>
        <button
          onClick={generateGroupedFindings}
          disabled={draftStoreBusy}
          title="Analyse all failing checklist lines and group them into logical finding drafts. Related gaps (same GD4 source ref + same APSR dimension) are consolidated into one finding."
          style={{ marginLeft: "auto", cursor: draftStoreBusy ? "not-allowed" : "pointer", border: "1px solid #818cf8", background: "#eef2ff", color: "#3730a3", fontWeight: 700, padding: "6px 12px", borderRadius: 8, fontSize: 12, opacity: draftStoreBusy ? 0.6 : 1 }}
        >
          {draftStoreBusy ? "Generating…" : pendingGroupedDrafts.length > 0 ? "Regenerate drafts" : "Generate grouped findings"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0, marginBottom: groupGenNote ? 6 : 10 }}>
        Consolidates failing checklist lines into grouped finding drafts (same GD4 source-ref parent + same APSR dimension → one finding). Review, edit, then confirm each draft to add it to the register.
      </p>
      {groupGenNote && <div style={{ fontSize: 12, color: "#15803d", marginBottom: 10 }}>{groupGenNote}</div>}

      {pendingGroupedDrafts.length === 0 && !draftStoreBusy && (
        <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "10px 0" }}>
          No pending drafts. Click <b>Generate grouped findings</b> to analyse failing checklist lines.
        </div>
      )}

      {pendingGroupedDrafts.map((draft) => {
        const isExpanded = expandedDraftId === draft.id;
        const statusColor = draft.status === "draft" ? "#15803d" : draft.status === "writing" ? "#b45309" : draft.status === "error" ? "#b91c1c" : "#6b7280";
        const statusLabel = draft.status === "draft" ? "Draft ready" : draft.status === "writing" ? "Writing…" : draft.status === "error" ? "Error" : draft.status;
        return (
          <div key={draft.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8, background: "#fff" }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", flexWrap: "wrap" }}
              onClick={() => setExpandedDraftId(isExpanded ? null : draft.id)}
            >
              <span style={{ color: "#94a3b8", fontSize: 12 }}>{isExpanded ? "▾" : "▸"}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#6b7280" }}>{draft.gd4ItemId}</span>
              <Pill s={draft.group.severity === "High" ? "critical" : "medium"}>{draft.group.severity}</Pill>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{draft.title ?? `${draft.group.gapType} gap`}</span>
              <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
              {draft.live && <Pill s="good">AI</Pill>}
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{draft.group.lines.length} line{draft.group.lines.length !== 1 ? "s" : ""}</span>
            </div>
            {isExpanded && (
              <GroupedDraftDetail
                draft={draft}
                onConfirm={() => {
                  draftStore.confirmGroupedDraft(draft.subCriterionId, draft.id);
                  setExpandedDraftId(null);
                }}
                onDiscard={() => {
                  draftStore.discardDraft(draft.subCriterionId, draft.id);
                  if (expandedDraftId === draft.id) setExpandedDraftId(null);
                }}
                onUpdate={(patch) => draftStore.updateDraftField(draft.subCriterionId, draft.id, patch)}
              />
            )}
          </div>
        );
      })}
    </Card>

    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Findings register</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {scored.openAFIs} of {allFindings.length} still open
        </span>
        <button
          onClick={generateFromGaps}
          title="Turn every Not-met / unverified checklist line into a finding (deduped). Runs automatically after each folder audit too."
          style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid #c9a24a", background: "#fbf3df", color: "#7a5c12", fontWeight: 700, padding: "6px 12px", borderRadius: 8, fontSize: 12 }}
        >
          Generate from gaps
        </button>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "6px 12px", borderRadius: 8, fontSize: 12 }}
        >
          {showForm ? "Cancel" : "Raise finding"}
        </button>
      </div>

      {/* Procedure-vs-evidence breakdown — answers "what kind of gaps do I have". */}
      {Object.keys(dimCounts).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>By dimension</span>
          {(["Procedure", "Evidence", "Outcomes", "Review", "Unverified"] as FindingDimension[]).filter((d) => dimCounts[d]).map((d) => (
            <button
              key={d}
              onClick={() => setDimFilter((cur) => (cur === d ? "All" : d))}
              title={`Filter to ${dimensionLabel(d)} findings`}
              style={{ cursor: "pointer", border: dimFilter === d ? "1px solid #1f2937" : "1px solid transparent", background: "transparent", borderRadius: 999, padding: 0 }}
            >
              <Pill s={dimensionTone(d)}>{dimensionLabel(d)}: {dimCounts[d]}</Pill>
            </button>
          ))}
        </div>
      )}

      {/* Risk category breakdown. */}
      {Object.keys(riskCatCounts).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>By risk category</span>
          {(["A", "B", "C", "D"] as const).filter((c) => riskCatCounts[c]).map((c) => (
            <button
              key={c}
              onClick={() => setRiskCatFilter((cur) => (cur === c ? "All" : c))}
              title={`Filter to ${riskCatLabel(c)} findings`}
              style={{ cursor: "pointer", border: riskCatFilter === c ? "1px solid #1f2937" : "1px solid transparent", background: "transparent", borderRadius: 999, padding: 0 }}
            >
              <Pill s={riskCatTone(c) as Parameters<typeof Pill>[0]["s"]}>{riskCatLabel(c)}: {riskCatCounts[c]}</Pill>
            </button>
          ))}
        </div>
      )}

      {genNote && <div style={{ fontSize: 12, color: "#15803d", marginBottom: 10 }}>{genNote}</div>}

      {showForm && (
        <Card style={{ background: "#f8fafc", marginBottom: 12 }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>GD4 item</span>
              <select value={form.gd4ItemId} onChange={(e) => handleGd4ItemChange(e.target.value)} style={{ ...inputStyle, marginTop: 3 }}>
                {GD4_REQUIREMENTS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} — {r.requirement.slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FindingType })} style={{ ...inputStyle, marginTop: 3 }}>
                {RAISABLE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Severity</span>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })} style={{ ...inputStyle, marginTop: 3 }}>
                {(["Critical", "High", "Medium", "Low"] as Severity[]).map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Risk category</span>
              <select value={form.riskCategory} onChange={(e) => setForm({ ...form, riskCategory: e.target.value as "A" | "B" | "C" | "D" | "" })} style={{ ...inputStyle, marginTop: 3 }}>
                <option value="">— not classified —</option>
                <option value="A">A — Regulatory breach (SSG mandatory)</option>
                <option value="B">B — Star-disqualifying (Criterion 7 / gate-sensitive)</option>
                <option value="C">C — Band-limiting</option>
                <option value="D">D — Enhancement opportunity</option>
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Owner</span>
              <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="Department acronym" style={{ ...inputStyle, marginTop: 3 }} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Due date</span>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input type="checkbox" checked={form.repeatFinding} onChange={(e) => setForm({ ...form, repeatFinding: e.target.checked })} />
              <span style={{ fontSize: 12.5 }}>Repeat finding</span>
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Issue (title — shown in the register)</span>
              <input
                value={form.issue}
                onChange={(e) => setForm({ ...form, issue: e.target.value })}
                placeholder="Short summary, e.g. GD4 4.2.1 — Pre-Course Counselling Records Missing"
                style={{ ...inputStyle, marginTop: 3 }}
              />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Observation — what was found <span style={{ fontStyle: "italic", textTransform: "none" }}>(WHO · WHAT · WHEN · HOW MANY)</span></span>
              <textarea
                value={form.observation}
                onChange={(e) => setForm({ ...form, observation: e.target.value })}
                placeholder="e.g. Form ADM-05 (Pre-Course Counselling Record) was absent from 8 of 23 student intake files reviewed (Jan–Jun 2025 cohort). All 8 relate to international students enrolled after 1 April 2025. The Admissions Counsellor confirmed records are completed manually with no system prompt."
                rows={3}
                style={{ ...inputStyle, marginTop: 3, resize: "vertical" }}
              />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Criteria — what GD4 requires <span style={{ fontStyle: "italic", textTransform: "none" }}>(cite the clause)</span></span>
              <textarea
                value={form.criteria}
                onChange={(e) => setForm({ ...form, criteria: e.target.value })}
                placeholder="e.g. GD4 4.2.1 requires documented pre-course counselling for every student before enrolment, covering course details, fees, FPS arrangement, and withdrawal/refund policy."
                rows={2}
                style={{ ...inputStyle, marginTop: 3, resize: "vertical" }}
              />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Effect — why it matters <span style={{ fontStyle: "italic", textTransform: "none" }}>(regulatory / band consequence)</span></span>
              <textarea
                value={form.effect}
                onChange={(e) => setForm({ ...form, effect: e.target.value })}
                placeholder="e.g. This is a mandatory SSG requirement. Incomplete records expose the institution to enforcement action and will cap this sub-criterion at Band 2 regardless of policy quality."
                rows={2}
                style={{ ...inputStyle, marginTop: 3, resize: "vertical" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={submitFinding}
              disabled={!form.issue.trim()}
              style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 14px", borderRadius: 8, fontSize: 12.5 }}
            >
              Save finding
            </button>
            {aiEnabled && (
              <button
                onClick={draftObservation}
                disabled={draftBusy || !form.gd4ItemId}
                title="AI drafts Observation, Criteria and Effect from the selected GD4 item's real checklist APSR data. Uses [placeholders] where you need to fill in specific names, dates, and counts."
                style={{ cursor: "pointer", border: "1px solid #c9a24a", background: "#fbf3df", color: "#7a5c12", fontWeight: 700, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
              >
                {draftBusy ? "Drafting…" : "AI draft finding body"}
              </button>
            )}
            {draftError && <span style={{ fontSize: 11.5, color: "#b23121" }}>{draftError}</span>}
          </div>
        </Card>
      )}

      {/* Filters — single row, compact labels */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "nowrap", overflowX: "auto", alignItems: "center" }}>
        {([
          { value: critFilter, onChange: (v: string) => { setCritFilter(v); setSubCritFilter("All"); }, options: [{ value: "All", label: "Criterion" }, ...GD4_CRITERIA.map((c) => ({ value: c.id, label: `${c.id}` }))] },
          { value: subCritFilter, onChange: (v: string) => setSubCritFilter(v), options: [{ value: "All", label: "Sub-crit" }, ...subCritOptions.map((sc) => ({ value: sc.id, label: sc.id }))] },
          { value: dimFilter, onChange: (v: string) => setDimFilter(v as FindingDimension | "All"), options: [{ value: "All", label: "Dimension" }, ...DIMENSIONS.slice(1).map((d) => ({ value: d, label: d === "Procedure" ? "Procedure" : d === "Evidence" ? "Evidence" : d }))] },
          { value: riskCatFilter, onChange: (v: string) => setRiskCatFilter(v as "A" | "B" | "C" | "D" | "All"), options: [{ value: "All", label: "Risk cat" }, ...RISK_CATS.slice(1).map((c) => ({ value: c, label: `Cat ${c}` }))] },
          { value: typeFilter, onChange: (v: string) => setTypeFilter(v as FindingType | "All"), options: [{ value: "All", label: "Type" }, ...TYPES.slice(1).map((t) => ({ value: t, label: t }))] },
          { value: sevFilter, onChange: (v: string) => setSevFilter(v as Severity | "All"), options: [{ value: "All", label: "Severity" }, ...SEVERITIES.slice(1).map((s) => ({ value: s, label: s }))] },
          { value: dateFilter, onChange: (v: string) => setDateFilter(v as "all" | "7d" | "30d" | "90d"), options: [{ value: "all", label: "All time" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }] },
        ] as const).map((f, i) => (
          <select key={i} value={f.value} onChange={(e) => (f.onChange as (v: string) => void)(e.target.value)} style={{ ...filterSelectStyle, minWidth: 0, flex: "0 0 auto", fontSize: 11.5, padding: "4px 6px" }}>
            {(f.options as readonly { value: string; label: string }[]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {/* Summary bar */}
      {rows.length > 0 && (
        <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 10, display: "flex", gap: 12, alignItems: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", flexWrap: "wrap" }}>
          <span><b>{summaryStats.subCrits}</b> sub-criteria</span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span><b>{summaryStats.gaps}</b> gaps</span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span style={{ color: "#b91c1c" }}><b>{summaryStats.open}</b> open</span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span style={{ color: "#15803d" }}><b>{summaryStats.closed}</b> closed</span>
        </div>
      )}

      {/* Grouped findings list */}
      {groupedRows.length === 0 ? (
        <div style={{ padding: "18px 4px", color: "#6b7280", fontSize: 12.5 }}>
          No findings to show. Run a folder audit (Evidence Folder page) — findings are raised automatically from the gaps — or click <b>Generate from gaps</b> above to create them from the current Sub-Criterion Checklist.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groupedRows.map(({ subCritId, findings: grpFindings }) => {
            const sc = GD4_SUB_CRITERIA.find((s) => s.id === subCritId);
            const isOpen = expandedSubCrits.has(subCritId);
            const closedCount = grpFindings.filter((f) => (closures[f.id]?.human || "") === "Accepted").length;
            const openCount = grpFindings.length - closedCount;
            const highestSev = grpFindings.reduce((best, f) => (SEV_ORDER[f.severity] ?? 0) > (SEV_ORDER[best] ?? 0) ? f.severity : best, "Low" as Severity);
            const statusLabel = closedCount === 0 ? "All open" : openCount === 0 ? "All closed" : "In progress";
            const statusColor = openCount === 0 ? "#15803d" : closedCount > 0 ? "#b45309" : "#b91c1c";
            const earliestDate = grpFindings.reduce<string | undefined>((e, f) => (!e || (f.createdAt && f.createdAt < e)) ? f.createdAt : e, undefined);
            const earliestStr = earliestDate ? new Date(earliestDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "";
            return (
              <div key={subCritId} style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                {/* Sub-criterion group row */}
                <div
                  className="rowh"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", background: isOpen ? "#f8fafc" : "#fff", flexWrap: "wrap" }}
                  onClick={() => setExpandedSubCrits((prev) => {
                    const next = new Set(prev);
                    if (next.has(subCritId)) next.delete(subCritId); else next.add(subCritId);
                    return next;
                  })}
                >
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>{isOpen ? "▾" : "▸"}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca", minWidth: 36 }}>{subCritId}</span>
                  {sc && <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.title}</span>}
                  <span style={{ fontSize: 11.5, color: "#6b7280", whiteSpace: "nowrap" }}>{grpFindings.length} gap{grpFindings.length !== 1 ? "s" : ""}</span>
                  <Pill s={severityTone(highestSev)}>{highestSev}</Pill>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: statusColor, whiteSpace: "nowrap" }}>{statusLabel}</span>
                  {earliestStr && <span style={{ fontSize: 10.5, color: "#94a3b8", whiteSpace: "nowrap" }}>from {earliestStr}</span>}
                </div>

                {/* Individual finding rows (compact) */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid #f1f5f9" }}>
                    {grpFindings.map((f) => {
                      const closed = (closures[f.id]?.human || "") === "Accepted";
                      const isSelected = detailFinding?.id === f.id;
                      const truncatedIssue = f.issue.length > 80 ? f.issue.slice(0, 80) + "…" : f.issue;
                      return (
                        <div
                          key={f.id}
                          className="rowh"
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px 7px 28px", cursor: "pointer", background: isSelected ? "#eef2ff" : "#fff", borderTop: "1px solid #f8fafc", flexWrap: "wrap" }}
                          onClick={() => setDetailFinding(isSelected ? null : f)}
                        >
                          <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.issue}>{truncatedIssue}</span>
                          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#94a3b8", whiteSpace: "nowrap" }}>{f.gd4ItemId}</span>
                          {f.dimension && <Pill s={dimensionTone(f.dimension)}>{f.dimension}</Pill>}
                          <Pill s={severityTone(f.severity)}>{f.severity}</Pill>
                          <Pill s={closed ? "good" : "critical"}>{closed ? "Closed" : "Open"}</Pill>
                          <span style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                            {confirmDeleteId === f.id ? (
                              <>
                                <button onClick={() => { removeCustomFinding(f.id); setConfirmDeleteId(null); if (detailFinding?.id === f.id) setDetailFinding(null); }} style={{ fontSize: 11, color: "#fff", background: "#ef4444", border: "none", borderRadius: 4, padding: "2px 7px", cursor: "pointer", marginRight: 4 }}>Delete</button>
                                <button onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 11, color: "#6b7280", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>Cancel</button>
                              </>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(f.id)} style={{ fontSize: 11, color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }} title="Remove finding">✕</button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>
          {seedFindingsLoaded && "Includes findings carried over from the loaded demo dataset. "}
          Click a sub-criterion to expand, then click a finding to view full details.
        </span>
        <Link to="/afi-closure" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, textDecoration: "none", padding: "3px 9px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}>
          Manage closure in Quality Action / AFI →
        </Link>
      </div>

      {/* Side panel — full finding detail */}
      {detailFinding && (
        <div
          style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "100vw", background: "#fff", boxShadow: "-4px 0 20px rgba(0,0,0,0.12)", zIndex: 200, overflowY: "auto", padding: "16px 20px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <b style={{ color: "#ce9e5d", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{detailFinding.id}</b>
            <Pill s={severityTone(detailFinding.severity)}>{detailFinding.severity}</Pill>
            {detailFinding.dimension && <Pill s={dimensionTone(detailFinding.dimension)}>{detailFinding.dimension}</Pill>}
            <Pill s={(closures[detailFinding.id]?.human || "") === "Accepted" ? "good" : "critical"}>{(closures[detailFinding.id]?.human || "") === "Accepted" ? "Closed" : "Open"}</Pill>
            <button onClick={() => setDetailFinding(null)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", fontSize: 18, color: "#94a3b8", lineHeight: 1, padding: "2px 4px" }} title="Close panel">✕</button>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, lineHeight: 1.4 }}>{detailFinding.issue}</div>
          <FindingDetail finding={detailFinding} />
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Link to="/afi-closure" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, textDecoration: "none", padding: "5px 12px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}>
              Manage closure →
            </Link>
            <Link to={`/sub-checklist?item=${detailFinding.gd4ItemId}`} style={{ fontSize: 12, color: "#4f46e5", fontWeight: 600, textDecoration: "none", padding: "5px 12px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}>
              View checklist →
            </Link>
          </div>
        </div>
      )}
      {detailFinding && (
        <div onClick={() => setDetailFinding(null)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.08)" }} />
      )}
    </Card>
    </Fragment>
  );
}

type DraftPatch = Partial<Pick<GroupedFindingDraft, "title" | "observation" | "criteria" | "effect" | "rootCause" | "corrective" | "preventive" | "apsrBullets">>;

function GroupedDraftDetail({
  draft,
  onConfirm,
  onDiscard,
  onUpdate,
}: {
  draft: GroupedFindingDraft;
  onConfirm: () => void;
  onDiscard: () => void;
  onUpdate: (patch: DraftPatch) => void;
}) {
  const TextSection = ({ label, field }: { label: string; field: keyof DraftPatch }) => {
    const val = (draft[field as keyof GroupedFindingDraft] as string) ?? "";
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
        <textarea
          value={val}
          onChange={(e) => onUpdate({ [field]: e.target.value } as DraftPatch)}
          rows={3}
          style={{ ...inputStyle, marginTop: 3, resize: "vertical", fontSize: 12 }}
        />
      </div>
    );
  };

  const dim = draft.group.primaryApsrDimension;
  const bullets = draft.apsrBullets;
  const refList = draft.group.sourceRefs.join(", ") || "—";

  return (
    <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
      {draft.status === "error" && (
        <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 8 }}>Error: {draft.errorMessage ?? "Unknown error"}</div>
      )}
      {draft.status === "writing" && (
        <div style={{ color: "#b45309", fontSize: 12, marginBottom: 8 }}>Writing draft… please wait.</div>
      )}

      {draft.status === "draft" && (
        <>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr", marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 11, color: "#6b7280" }}>Gap type: </span>
              <b style={{ fontSize: 12 }}>{draft.group.gapType}</b>
            </div>
            <div>
              <span style={{ fontSize: 11, color: "#6b7280" }}>APSR dimension: </span>
              <b style={{ fontSize: 12 }}>{dim}</b>
            </div>
            <div>
              <span style={{ fontSize: 11, color: "#6b7280" }}>GD4 refs: </span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11 }}>{refList}</span>
            </div>
            <div>
              <span style={{ fontSize: 11, color: "#6b7280" }}>Evidence: </span>
              <span style={{ fontSize: 11 }}>{draft.evidenceStatusSummary}</span>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>Title (issue)</div>
            <input
              value={draft.title ?? ""}
              onChange={(e) => onUpdate({ title: e.target.value })}
              style={{ ...inputStyle, marginTop: 3, fontSize: 12 }}
            />
          </div>
          <TextSection label="Observation — what was found (WHO · WHAT · WHEN · HOW MANY)" field="observation" />
          <TextSection label="Criteria — what GD4 requires" field="criteria" />
          <TextSection label="Effect — regulatory / band consequence" field="effect" />
          <TextSection label="Root cause" field="rootCause" />
          <TextSection label="Corrective action" field="corrective" />
          <TextSection label="Preventive action" field="preventive" />

          {bullets && (
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>APSR breakdown bullets</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 6 }}>
                {(["approach", "processes", "systemsOutcomes", "review"] as const).map((key) => (
                  <div key={key} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", background: "#fafafa" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3, textTransform: "capitalize" }}>{key === "systemsOutcomes" ? "Systems & Outcomes" : key}</div>
                    {(bullets[key] ?? []).map((b, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#475569", lineHeight: 1.4, marginBottom: 2 }}>• {b}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={onConfirm}
              style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 14px", borderRadius: 8, fontSize: 12.5 }}
            >
              Confirm → add to register
            </button>
            <button
              onClick={onDiscard}
              style={{ cursor: "pointer", border: "1px solid #fca5a5", background: "#fff1f2", color: "#b91c1c", fontWeight: 600, padding: "7px 12px", borderRadius: 8, fontSize: 12 }}
            >
              Discard draft
            </button>
          </div>

          <div style={{ marginTop: 8, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Contributing checklist lines</div>
            {draft.group.lines.map((l) => (
              <div key={l.id} style={{ fontSize: 11.5, color: "#475569", marginBottom: 3, display: "flex", gap: 6, alignItems: "flex-start" }}>
                <Pill s={l.status === "Not met" ? "critical" : l.status === "Partial" ? "medium" : "neutral"}>{l.status}</Pill>
                <span>{l.text}</span>
                {l.sourceRef && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#94a3b8" }}>{l.sourceRef}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The expandable per-finding report: the detailed root-cause / corrective /
// preventive analysis plus the APSR rubric breakdown the audit produced, so the
// "why" behind each finding is visible here, not just on the closure screen.
function FindingDetail({ finding: f }: { finding: Finding }) {
  const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
  const apsr = f.apsr;
  const Section = ({ label, text }: { label: string; text?: string }) =>
    text ? (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{text}</div>
      </div>
    ) : null;
  return (
    <div>
      {req && (
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
          GD4 {req.id} · {req.requirement}
          {f.clause && <span style={{ fontFamily: "ui-monospace,monospace", marginLeft: 8 }}>{f.clause}</span>}
          {f.source && <Pill s="neutral">{f.source}</Pill>}
          {f.auditRunId && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#6b7280", marginLeft: 6 }}>Run: {f.auditRunId}</span>}
          {f.dimension && <span style={{ marginLeft: 4 }}><Pill s={dimensionTone(f.dimension)}>{dimensionLabel(f.dimension)}</Pill></span>}
          {f.riskCategory && <span style={{ marginLeft: 4 }}><Pill s={riskCatTone(f.riskCategory) as Parameters<typeof Pill>[0]["s"]}>{riskCatLabel(f.riskCategory)}</Pill></span>}
        </div>
      )}
      <Section label="Observation — what was found (WHO · WHAT · WHEN · HOW MANY)" text={f.observation} />
      <Section label="Criteria — what the standard requires" text={f.criteria} />
      <Section label="Effect — regulatory / certification consequence" text={f.effect} />
      {(f.observation || f.criteria || f.effect) && (f.rootCause || f.corrective || f.preventive) && (
        <div style={{ borderTop: "1px solid #e2e8f0", margin: "8px 0" }} />
      )}
      <Section label="Root cause" text={f.rootCause} />
      <Section label="Corrective action (fix it now)" text={f.corrective} />
      <Section label="Preventive action (stop recurrence)" text={f.preventive} />
      {(f.linkedSourceRefs?.length || f.evidenceStatusSummary || f.createdFromAuditRunId) && (
        <div style={{ marginTop: 6, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Traceability</div>
          {f.linkedSourceRefs?.length ? <div style={{ fontSize: 11.5, color: "#475569" }}>GD4 refs: {f.linkedSourceRefs.join(", ")}</div> : null}
          {f.evidenceStatusSummary ? <div style={{ fontSize: 11.5, color: "#475569", marginTop: 2 }}>{f.evidenceStatusSummary}</div> : null}
          {f.createdFromAuditRunId ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, fontFamily: "ui-monospace,monospace" }}>Audit run: {f.createdFromAuditRunId}</div> : null}
          {f.linkedChecklistLineIds?.length ? (
            <div style={{ fontSize: 11, marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "#94a3b8" }}>{f.linkedChecklistLineIds.length} linked checklist line{f.linkedChecklistLineIds.length !== 1 ? "s" : ""}</span>
              <Link to={`/sub-checklist?item=${f.gd4ItemId}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>View in checklist →</Link>
            </div>
          ) : null}
        </div>
      )}
      {apsr && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>APSR rubric breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 6 }}>
            {([
              ["Approach (policy)", apsr.approach],
              ["Processes (implementation)", apsr.processes],
              ["Systems & Outcomes", apsr.systemsOutcomes],
              ["Review", apsr.review],
            ] as const).map(([label, leg]) => (
              <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", background: "#fff" }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{label}: {leg.status}</div>
                {leg.note && (
                  leg.note.includes("\n")
                    ? <ul style={{ margin: "2px 0 0 14px", padding: 0, fontSize: 11, color: "#6b7280", lineHeight: 1.45 }}>
                        {leg.note.split("\n").filter(Boolean).map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    : <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, lineHeight: 1.45 }}>{leg.note}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
