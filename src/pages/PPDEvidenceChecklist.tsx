import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { computeBand, lineSufficiency, buildDraftFinding } from "../lib/checklistBanding";
import { findingTypeTone, ncSeverityTone } from "../lib/findingClassification";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { PathStepIndicator } from "../components/ui/PathStepIndicator";
import { bandTone } from "../lib/theme";
import type { PPDVerdict, SpecificChecklistLine } from "../types";

// Option A's Step 2. Same store data, same verdict logic, same finding
// creation as the Sub-Criterion Checklist (Option B) — this page only adds a
// PPD baseline column so the two sources can be compared line-by-line. The
// existing single-column checklist is untouched; Option B keeps using it.

function verdictTone(v: PPDVerdict): "good" | "medium" | "critical" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : "critical";
}

function statusTone(status: string): "good" | "medium" | "critical" | "neutral" {
  if (status === "Met") return "good";
  if (status === "Partial") return "medium";
  if (status === "Not met") return "critical";
  return "neutral";
}

const GRID_COLUMNS = "1fr 1fr 1fr";

export function PPDEvidenceChecklist() {
  const [searchParams] = useSearchParams();
  const paramId = searchParams.get("item") || "";
  const paramReq = GD4_REQUIREMENTS.find((r) => r.id === paramId);
  const [selectedId, setSelectedId] = useState<string>(paramId && paramReq ? paramId : "");

  const entries = useChecklistModuleStore((s) => s.entries);
  const setSpecificStatus = useChecklistModuleStore((s) => s.setSpecificStatus);
  const confirmDraftFinding = useChecklistModuleStore((s) => s.confirmDraftFinding);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);

  const req = GD4_REQUIREMENTS.find((r) => r.id === selectedId);
  const sub = req ? GD4_SUB_CRITERIA.find((s) => s.id === req.subCriterionId) : undefined;
  const itemsInSub = req ? GD4_REQUIREMENTS.filter((r) => r.subCriterionId === req.subCriterionId) : [];

  const entry = req ? entries[req.id] : undefined;
  const specific = entry?.specific || [];
  const generic = entry?.generic || [];

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
    return order.map((k) => byKey.get(k)!);
  }, [specific]);

  const bandResult = req ? computeBand(generic, specific, req.gateSensitive) : null;
  const ppdResult = req ? ppdReviewResults[req.subCriterionId] : undefined;
  const ppdBaseline = req ? ppdResult?.rows.find((r) => r.gd4ItemId === req.id) : undefined;

  if (!paramReq) {
    return (
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>PPD Evidence Checklist</h3>
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
          No GD4 item selected. Open this page from the PPD Requirements Review's "Continue to Evidence Checklist →"
          button, or from the <Link to="/evidence-folder" style={{ color: "#4338ca", fontWeight: 600 }}>Evidence Folder</Link> page (Option A path).
        </p>
      </Card>
    );
  }

  if (!req || !sub) return null;

  return (
    <Card>
      <PathStepIndicator
        current={2}
        ppdHref={`/ppd-review?item=${req.subCriterionId}`}
        evidenceHref={`/ppd-evidence-checklist?item=${req.id}`}
        evidenceEnabled
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>PPD Evidence Checklist — {req.id}</h3>
        {req.gateSensitive && <Pill s="high">Gate-sensitive</Pill>}
        {bandResult && bandResult.started && <Pill s={bandTone(bandResult.finalBand)}>Band {bandResult.finalBand}</Pill>}
      </div>
      <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 0 }}>{req.requirement}</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {itemsInSub.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            style={{
              cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
              border: `1px solid ${r.id === selectedId ? "#4338ca" : "#e2e8f0"}`,
              background: r.id === selectedId ? "#4338ca" : "#fff",
              color: r.id === selectedId ? "#fff" : "#374151",
            }}
          >
            {r.id}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Link to={`/findings?item=${req.id}`} style={{ fontSize: 12, color: "#4a5a8a", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}>
          Findings for {req.id} →
        </Link>
        <Link to="/afi-closure" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}>
          Quality Action / AFI →
        </Link>
      </div>

      {/* Sticky column header, aligned to the same 3-column grid as each row below. */}
      <div
        style={{
          display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 10, position: "sticky", top: 0, zIndex: 1,
          background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px 8px 0 0", padding: "6px 12px", marginBottom: -1,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>PPD baseline (Step 1)</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Evidence found</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>AI verdict</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sortedSpecific.length === 0 && (
          <p style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0" }}>
            No checklist lines yet for this item. Run an audit from the Evidence Folder, or add lines on the{" "}
            <Link to={`/sub-checklist?item=${req.id}`} style={{ color: "#4338ca", fontWeight: 600 }}>Sub-Criterion Checklist</Link>.
          </p>
        )}
        {sortedSpecific.map((l) => {
          const suff = lineSufficiency(l);
          const draftableStatus = l.status === "Not met" || l.status === "Partial" || l.status === "Met";
          const draft = draftableStatus ? buildDraftFinding(req, l) : null;

          return (
            <div key={l.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 10, alignItems: "start" }}>
                {/* Column 1 — PPD baseline */}
                <div>
                  <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{req.id}</div>
                  {ppdBaseline ? (
                    <>
                      <Pill s={verdictTone(ppdBaseline.verdict)}>{ppdBaseline.verdict}</Pill>
                      <div style={{ borderLeft: "3px solid #c7d2fe", paddingLeft: 8, marginTop: 5, fontSize: 11.5, color: "#374151", lineHeight: 1.4, fontStyle: "italic" }}>
                        {ppdBaseline.fullComment || ppdBaseline.shortComment || "(no PPD extract)"}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                      No PPD row for this item.{" "}
                      <Link to={`/ppd-review?item=${req.subCriterionId}`} style={{ color: "#4338ca", fontWeight: 600 }}>Run PPD review →</Link>
                    </span>
                  )}
                </div>

                {/* Column 2 — Evidence found */}
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: suff === "Present" ? "#15803d" : suff === "Weak" ? "#b45309" : "#b23121", marginBottom: 4 }}>
                    {l.evidence.length > 0 ? `${l.evidence.length} record${l.evidence.length > 1 ? "s" : ""} · ${suff}` : "No evidence attached"}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {l.evidence.map((ev) => (
                      <li key={ev.id} style={{ fontSize: 11.5, color: "#374151", marginBottom: 2 }}>
                        {ev.drive ? (
                          <a href={ev.drive} target="_blank" rel="noreferrer" style={{ color: "#4338ca" }}>{ev.title || ev.drive}</a>
                        ) : (
                          <span>{ev.title || "(untitled)"}</span>
                        )}
                        <span style={{ color: "#94a3b8" }}> · {ev.type}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: "4px 0 0" }}>{l.text}</p>
                </div>

                {/* Column 3 — AI verdict */}
                <div>
                  <select
                    value={l.status}
                    onChange={(e) => req && setSpecificStatus(req.id, l.id, e.target.value as SpecificChecklistLine["status"])}
                    style={{ fontSize: 11, padding: "3px 5px", borderRadius: 6, border: "1px solid #e2e8f0", marginRight: 6 }}
                  >
                    {(["Not Started", "Met", "Partial", "Not met", "Not Applicable"] as const).map((o) => <option key={o}>{o}</option>)}
                  </select>
                  <Pill s={statusTone(l.status)}>{l.status}</Pill>

                  {draft && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: "#374151" }}>
                      {draft.issue}{" "}
                      {draft.findingType && <Pill s={findingTypeTone(draft.findingType)}>{draft.findingType}</Pill>}
                      {draft.ncSeverity && <Pill s={ncSeverityTone(draft.ncSeverity)}>{draft.ncSeverity}</Pill>}
                    </div>
                  )}

                  <div style={{ marginTop: 6 }}>
                    {l.draftFinding?.savedFindingId ? (
                      <Link to={`/findings?item=${req.id}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>View finding →</Link>
                    ) : draft ? (
                      <button
                        onClick={() => confirmDraftFinding(req.id, l.id, draft)}
                        style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: `1px solid ${draft.findingType === "OBS" ? "#15803d" : "#9a6b15"}`, background: "#fff", color: draft.findingType === "OBS" ? "#15803d" : "#9a6b15" }}
                      >
                        {draft.findingType === "OBS" ? "Save observation" : "Save to findings register"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <Link
          to={`/findings?item=${req.id}`}
          style={{ fontSize: 12.5, fontWeight: 700, textDecoration: "none", padding: "6px 14px", borderRadius: 8, border: "1px solid #4338ca", background: "#4338ca", color: "#fff" }}
        >
          Compile → Findings register
        </Link>
      </div>
    </Card>
  );
}
