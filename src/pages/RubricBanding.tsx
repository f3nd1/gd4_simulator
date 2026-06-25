import { useScored } from "../hooks/useScored";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone } from "../lib/theme";

const BAND_MEANING: Record<number, string> = {
  1: "Missing or weak evidence, mostly policy only.",
  2: "Some implementation evidence, but inconsistent or weakly reviewed.",
  3: "Evidence exists and implementation is reasonably consistent.",
  4: "Evidence is systematic, reviewed and improved.",
  5: "Strong, mature, outcome-driven evidence with continual improvement.",
};

export function RubricBanding() {
  const scored = useScored();

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
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Applied banding by item</h3>
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
      </Card>
    </div>
  );
}
