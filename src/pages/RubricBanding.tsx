import { useState } from "react";
import { useScored } from "../hooks/useScored";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK, bandTone } from "../lib/theme";

const BAND_MEANING: Record<number, string> = {
  1: "Missing or weak evidence, mostly policy only.",
  2: "Some implementation evidence, but inconsistent or weakly reviewed.",
  3: "Evidence exists and implementation is reasonably consistent.",
  4: "Evidence is systematic, reviewed and improved.",
  5: "Strong, mature, outcome-driven evidence with continual improvement.",
};

type ViewMode = "criterion" | "item";

export function RubricBanding() {
  const scored = useScored();
  const [view, setView] = useState<ViewMode>("criterion");

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Internal band descriptors</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          The official GD4 rubric should override these descriptors once available; these are internal interpretation only.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          {[1, 2, 3, 4, 5].map((b) => (
            <div key={b} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
              <Pill s={bandTone(b)}>Band {b}</Pill>
              <div style={{ fontSize: 12, marginTop: 4 }}>{BAND_MEANING[b]}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Applied banding</h3>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              onClick={() => setView("criterion")}
              style={{
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${GOLD}`,
                background: view === "criterion" ? GOLD : "#fff",
                color: view === "criterion" ? INK : "#475569",
              }}
            >
              Overall by criterion
            </button>
            <button
              onClick={() => setView("item")}
              style={{
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${GOLD}`,
                background: view === "item" ? GOLD : "#fff",
                color: view === "item" ? INK : "#475569",
              }}
            >
              By item (sub-criterion detail)
            </button>
          </div>
        </div>

        {view === "criterion" ? (
          <table>
            <thead><tr><th>Criterion</th><th>Avg effective score</th><th>Band</th><th>Scored points</th><th>Why this band</th></tr></thead>
            <tbody>
              {scored.crits.map((c) => (
                <tr key={c.id} className="rowh">
                  <td><b>C{c.id}</b> {c.title}</td>
                  <td>{Math.round(c.avg)}</td>
                  <td><Pill s={bandTone(c.band)}>Band {c.band}</Pill></td>
                  <td>{c.scored} / {c.points}</td>
                  <td style={{ fontSize: 12, color: "#6b7280" }}>{BAND_MEANING[c.band]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Item</th><th>Effective score</th><th>Band</th><th>Why this band</th></tr></thead>
            <tbody>
              {scored.items.map((it) => (
                <tr key={it.id} className="rowh">
                  <td><b>{it.id}</b> {it.title}</td>
                  <td>{it.eff}</td>
                  <td><Pill s={bandTone(it.band)}>Band {it.band}</Pill></td>
                  <td style={{ fontSize: 12, color: "#6b7280" }}>{BAND_MEANING[it.band]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
