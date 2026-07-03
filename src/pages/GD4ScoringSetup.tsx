import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { useScoringConfigStore, AWARD_PRESETS, type AiStrictness } from "../store/useScoringConfigStore";
import { INK } from "../lib/theme";

const STRICTNESS: AiStrictness[] = ["Lenient", "Standard", "Strict"];

function presetName(t: { provisional: number; fourYear: number; star: number }): string {
  for (const [name, p] of Object.entries(AWARD_PRESETS)) {
    if (p.provisional === t.provisional && p.fourYear === t.fourYear && p.star === t.star) return name;
  }
  return "Custom";
}

export function GD4ScoringSetup() {
  const { awardThresholds, aiStrictness, setAwardThresholds, setAiStrictness, applyPreset } = useScoringConfigStore();
  const avg = (v: number) => (v / 200).toFixed(2);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Difficulty — EduTrust tier cut-offs &amp; AI strictness</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Set how hard each EduTrust tier is to attain (score out of 1000) and how strictly the AI marks evidence. Tuned here, not hardcoded — changes apply live to the score, Final Report and Data Dashboard.
        </p>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center" }}>Preset:</span>
          {Object.keys(AWARD_PRESETS).map((name) => {
            const active = presetName(awardThresholds) === name;
            return (
              <button key={name} onClick={() => applyPreset(name)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 999, border: `1px solid ${active ? INK : "#cbd5e1"}`, background: active ? INK : "#fff", color: active ? "#fff" : "#475569" }}>
                {name}
              </button>
            );
          })}
          {presetName(awardThresholds) === "Custom" && <Pill s="medium">Custom</Pill>}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          {([
            ["Provisional (1-Year) from", "provisional"],
            ["EduTrust (4-Year) from", "fourYear"],
            ["EduTrust Star from", "star"],
          ] as const).map(([label, key]) => (
            <label key={key} style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={awardThresholds[key]}
                onChange={(e) => setAwardThresholds({ ...awardThresholds, [key]: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
                style={{ ...inputStyle, marginTop: 3 }}
              />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>≈ average Band {avg(awardThresholds[key])} across all criteria</span>
            </label>
          ))}
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>AI banding strictness</span>
            <select value={aiStrictness} onChange={(e) => setAiStrictness(e.target.value as AiStrictness)} style={{ ...inputStyle, marginTop: 3 }}>
              {STRICTNESS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>How hard the AI is when marking evidence Met during "Run audit".</span>
          </label>
        </div>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>
          Below {awardThresholds.provisional} = Not certified. Bigger gaps between tiers make the jump harder — "Hard" makes both Provisional→4-Year and 4-Year→Star large, so Star is genuinely difficult while Provisional stays attainable. Strict AI marking lowers coverage, which also raises the bar.
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>GD4 scoring setup</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Configured max points, weightage and gate-sensitive flags per criterion and item. <b>These point values are internal placeholders</b> — replace
          with UCC's official GD4 scoring table once available; do not present as a final result.
        </p>
        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr><th>Criterion</th><th>Area</th><th>Max points</th></tr>
          </thead>
          <tbody>
            {GD4_CRITERIA.map((c) => (
              <tr key={c.id}>
                <td><b>C{c.id}</b></td>
                <td>{c.title}</td>
                <td>{c.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr><th>Item</th><th>Criterion</th><th>Requirement</th><th>Weightage</th><th>Gate sensitive</th></tr>
          </thead>
          <tbody>
            {GD4_REQUIREMENTS.map((r) => (
              <tr key={r.id} className="rowh">
                <td><b>{r.itemNumber}</b></td>
                <td>C{r.criterion}</td>
                <td style={{ fontSize: 12.5 }}>{r.requirement}</td>
                <td>{r.weightage}</td>
                <td>{r.gateSensitive ? <Pill s="medium">Yes</Pill> : <Pill s="neutral">No</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
