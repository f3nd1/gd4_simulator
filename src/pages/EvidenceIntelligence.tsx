import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import type { Scored } from "../lib/scoring";
import type { Finding } from "../types";
import { GD4_CRITERIA } from "../data/gd4Requirements";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { TONE, BLUE, INK } from "../lib/theme";

type Status = "Pass" | "Partial" | "Fail";
type Check = { label: string; status: Status; detail: string };
type ScoredItem = Scored["items"][number];

const STATUS_TONE: Record<Status, "good" | "medium" | "critical"> = { Pass: "good", Partial: "medium", Fail: "critical" };

// Honest per-item checks. The key fix: an item with no evidence at all no
// longer shows green on age/linkage/etc. — "0 days" is only a Pass when there
// is actually evidence to be 0 days old.
function computeChecks(item: ScoredItem, findings: Finding[]): Check[] {
  const ev = item.ev;
  const hasEvidence = !!ev.drive || item.checklistOverride || ev.approach !== "Missing" || ev.processes !== "Missing" || ev.systemsOutcomes !== "Missing" || ev.review !== "Missing";
  const itemFindings = findings.filter((f) => f.gd4ItemId === item.id);
  const overdue = itemFindings.some((f) => f.overdue);
  return [
    { label: "Evidence age", status: !hasEvidence ? "Fail" : ev.age <= 180 ? "Pass" : "Fail", detail: hasEvidence ? `${ev.age} days` : "No evidence linked yet" },
    { label: "Evidence strength", status: item.ais >= 55 ? "Pass" : item.ais > 0 ? "Partial" : "Fail", detail: `${item.ais}/100` },
    { label: "Processes consistency", status: ev.processes === "good" ? "Pass" : ev.processes === "Partial" ? "Partial" : "Fail", detail: ev.processes },
    { label: "Review limb present", status: ev.review !== "Missing" ? "Pass" : "Fail", detail: ev.review },
    { label: "Systems & outcomes evidence", status: ev.systemsOutcomes !== "Missing" ? "Pass" : "Fail", detail: ev.systemsOutcomes },
    { label: "Cross-criterion linkage", status: hasEvidence && ev.owner ? "Pass" : hasEvidence ? "Partial" : "Fail", detail: !hasEvidence ? "No evidence to link" : ev.owner ? `Owner ${ev.owner} can link related criteria` : "Set an owner to manage linkage" },
    { label: "Traceability", status: ev.trace >= 75 ? "Pass" : ev.trace > 0 ? "Partial" : "Fail", detail: `${ev.trace}%` },
    { label: "Owner assigned", status: ev.owner ? "Pass" : "Fail", detail: ev.owner || "No owner set" },
    { label: "Drive folder linked", status: ev.drive ? "Pass" : "Fail", detail: ev.drive ? "Linked" : "Missing" },
    { label: "Repeat finding detector", status: itemFindings.length ? "Fail" : "Pass", detail: itemFindings.length ? "Prior finding on this item" : "None" },
    { label: "Due date monitoring", status: overdue ? "Fail" : "Pass", detail: overdue ? "Overdue action(s) linked" : "No overdue actions" },
    { label: "Gate item", status: item.gate ? (item.band >= 3 ? "Pass" : "Fail") : "Pass", detail: item.gate ? "Critical area" : "Not gated" },
  ];
}

const CHECK_LABELS = computeChecks({ ev: {} } as unknown as ScoredItem, []).map((c) => c.label);

// Tally Pass/Partial/Fail per check across a set of items (for the rollups).
function aggregate(items: ScoredItem[], findings: Finding[]): Record<string, { Pass: number; Partial: number; Fail: number }> {
  const out: Record<string, { Pass: number; Partial: number; Fail: number }> = {};
  for (const l of CHECK_LABELS) out[l] = { Pass: 0, Partial: 0, Fail: 0 };
  for (const it of items) for (const c of computeChecks(it, findings)) out[c.label][c.status]++;
  return out;
}

function CountBar({ counts }: { counts: { Pass: number; Partial: number; Fail: number } }) {
  const total = counts.Pass + counts.Partial + counts.Fail || 1;
  const seg = (n: number, color: string) => (n ? <div style={{ width: `${(n / total) * 100}%`, background: color }} /> : null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", height: 12, width: 120, borderRadius: 999, overflow: "hidden", background: "#eef1f5" }}>
        {seg(counts.Pass, "#2f9e6e")}
        {seg(counts.Partial, "#d97706")}
        {seg(counts.Fail, "#c0392b")}
      </div>
      <span style={{ fontSize: 11.5, color: "#475569" }}>
        <b style={{ color: "#1f7a4d" }}>{counts.Pass}</b> · <b style={{ color: "#9a6b15" }}>{counts.Partial}</b> · <b style={{ color: "#b23121" }}>{counts.Fail}</b>
      </span>
    </div>
  );
}

function RollupTable({ items, findings }: { items: ScoredItem[]; findings: Finding[] }) {
  const agg = useMemo(() => aggregate(items, findings), [items, findings]);
  return (
    <table>
      <thead><tr><th>Check</th><th>Pass · Partial · Fail (across {items.length} item{items.length === 1 ? "" : "s"})</th></tr></thead>
      <tbody>
        {CHECK_LABELS.map((l) => (
          <tr key={l}><td style={{ fontWeight: 600 }}>{l}</td><td><CountBar counts={agg[l]} /></td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function EvidenceIntelligence() {
  const scored = useScored();
  const findings = useAllFindings();
  const agents = useWorkspaceStore((s) => s.agents);
  const itemReviews = useWorkspaceStore((s) => s.itemReviews);
  const runItemAI = useWorkspaceStore((s) => s.runItemAI);
  const busy = useWorkspaceStore((s) => s.busy);

  const [view, setView] = useState<"overall" | "criterion" | "item">("overall");
  const [selCrit, setSelCrit] = useState(GD4_CRITERIA[0]?.id);
  const [selItem, setSelItem] = useState(scored.items[0]?.id);
  const item = scored.items.find((i) => i.id === selItem) || scored.items[0];
  const review = itemReviews[item?.id];

  const critItems = scored.items.filter((i) => i.crit === selCrit);
  const itemChecks = item ? computeChecks(item, findings) : [];

  // Overall health: count failing checks across everything.
  const overall = useMemo(() => {
    const agg = aggregate(scored.items, findings);
    const totals = Object.values(agg).reduce((a, c) => ({ Pass: a.Pass + c.Pass, Partial: a.Partial + c.Partial, Fail: a.Fail + c.Fail }), { Pass: 0, Partial: 0, Fail: 0 });
    const withEvidence = scored.items.filter((i) => i.ev.drive || i.checklistOverride).length;
    const gateAtRisk = scored.items.filter((i) => i.gate && i.band < 3).length;
    return { totals, withEvidence, gateAtRisk };
  }, [scored.items, findings]);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Evidence intelligence</h3>
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {([["overall", "Overall"], ["criterion", "By criterion"], ["item", "By item"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 999, border: `1px solid ${view === k ? INK : "#cbd5e1"}`, background: view === k ? INK : "#fff", color: view === k ? "#fff" : "#475569" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "#6b7280", margin: "6px 0 0" }}>
          Read-only evidence health checks. Three levels: everything at a glance, rolled up per criterion, or the full check list for one item.
        </p>
      </Card>

      {view === "overall" && (
        <>
          <Card>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <Stat label="Items with evidence" value={`${overall.withEvidence}/${scored.items.length}`} tone={overall.withEvidence ? "good" : "critical"} />
              <Stat label="Checks passing" value={`${overall.totals.Pass}`} tone="good" />
              <Stat label="Checks partial" value={`${overall.totals.Partial}`} tone="medium" />
              <Stat label="Checks failing" value={`${overall.totals.Fail}`} tone="critical" />
              <Stat label="Gate items at risk" value={`${overall.gateAtRisk}`} tone={overall.gateAtRisk ? "critical" : "good"} />
            </div>
          </Card>
          <Card>
            <h4 style={{ marginTop: 0, fontSize: 13 }}>All checks across all 35 items</h4>
            <RollupTable items={scored.items} findings={findings} />
          </Card>
        </>
      )}

      {view === "criterion" && (
        <Card>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "#6b7280" }}>Criterion</span>
            <select value={selCrit} onChange={(e) => setSelCrit(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
              {GD4_CRITERIA.map((c) => <option key={c.id} value={c.id}>C{c.id} — {c.title}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{critItems.length} item(s)</span>
          </div>
          <RollupTable items={critItems} findings={findings} />
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {critItems.map((i) => (
              <button key={i.id} onClick={() => { setSelItem(i.id); setView("item"); }} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 9px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff" }}>
                {i.id} <Pill s={i.band >= 4 ? "good" : i.band === 3 ? "progress" : "critical"}>B{i.band}</Pill>
              </button>
            ))}
          </div>
        </Card>
      )}

      {view === "item" && item && (
        <Card>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <select value={selItem} onChange={(e) => setSelItem(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
              {scored.items.map((i) => <option key={i.id} value={i.id}>{i.id} {i.title}</option>)}
            </select>
            <Pill s={item.band >= 4 ? "good" : item.band === 3 ? "progress" : "critical"}>Band {item.band}</Pill>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {agents.map((a) => (
                <button key={a.id} onClick={() => runItemAI(a.id, item.id)} disabled={busy === item.id + a.id} style={{ cursor: "pointer", fontSize: 11.5, padding: "6px 9px", borderRadius: 7, border: `1px solid ${BLUE}`, background: TONE.progress.bg, color: TONE.progress.fg }}>
                  {busy === item.id + a.id ? "…" : a.name}
                </button>
              ))}
            </div>
          </div>
          {review && (
            <div style={{ marginBottom: 12, background: TONE.progress.bg, borderRadius: 8, padding: "9px 11px", fontSize: 12.5 }}>
              <b>{review.by} · score {review.score} Band {review.band} ({review.confidence}):</b> {review.justification} <i>Higher band: {review.higherBand}</i>
            </div>
          )}
          <table>
            <tbody>
              {itemChecks.map((c) => (
                <tr key={c.label}>
                  <td style={{ fontWeight: 600 }}>{c.label}</td>
                  <td><Pill s={STATUS_TONE[c.status]}>{c.status}</Pill></td>
                  <td style={{ color: "#6b7280" }}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "medium" | "critical" }) {
  const c = TONE[tone];
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c.fg }}>{value}</div>
    </div>
  );
}
