import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { useScoringConfigStore, AWARD_PRESETS, type AiStrictness } from "../store/useScoringConfigStore";
import { pctForScore, finalBandFromPct, DEFAULT_APSR_SCALE } from "../lib/checklistBanding";
import { bandTitle } from "../data/edutrustRubric";
import { INK } from "../lib/theme";

const STRICTNESS: AiStrictness[] = ["Lenient", "Standard", "Strict"];

function presetName(t: { provisional: number; fourYear: number; star: number }): string {
  for (const [name, p] of Object.entries(AWARD_PRESETS)) {
    if (p.provisional === t.provisional && p.fourYear === t.fourYear && p.star === t.star) return name;
  }
  return "Custom";
}

export function GD4ScoringSetup() {
  const { awardThresholds, aiStrictness, apsrScale, autoScoreBands, setAwardThresholds, setAiStrictness, setApsrScale, resetApsrScale, applyPreset, setAutoScoreBands } = useScoringConfigStore();
  const avg = (v: number) => (v / 200).toFixed(2);
  const isDefaultScale =
    apsrScale.maxPctPerDimension === DEFAULT_APSR_SCALE.maxPctPerDimension &&
    apsrScale.bandThresholds.every((t, i) => t === DEFAULT_APSR_SCALE.bandThresholds[i]);
  // Live worked example under the CURRENT scale (default: A=20+P=20+S=10+R=0=50→Band 3).
  const exScores = [4, 4, 2, 0] as const;
  const exPcts = exScores.map((s) => pctForScore(s, apsrScale));
  const exTotal = exPcts.reduce((a, b) => a + b, 0);
  const setThreshold = (i: number, v: number) => {
    const t = [...apsrScale.bandThresholds] as [number, number, number, number];
    t[i] = Math.max(0, Math.min(100, v));
    setApsrScale({ ...apsrScale, bandThresholds: t });
  };

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
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Band auto-scoring — Full Auto / Hybrid first draft</h3>
        {/* Mandatory confirm on enable: this flips the tool's standing
            contract ("AI recommends, the human decides the certification
            score") for automatic runs — never silently activated. Turning it
            OFF needs no confirm and never touches bands already saved.
            The automatic run step this governs is wired separately; see
            docs/auto-scoring-setting.md and docs/target-flow-gap-analysis.md. */}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={autoScoreBands}
            onChange={(e) => {
              if (!e.target.checked) { setAutoScoreBands(false); return; }
              if (confirm(
                "Turning this on means the AI will set your certification band automatically during a Full Auto run or a Hybrid first-pass draft, without your review at the moment it is set.\n\nEvery band set this way is marked \"Draft (AI) · Confirm to finalise\" wherever it appears, and you can still open and change any band afterward. Bands you have already saved are never changed by this setting.\n\nAre you sure?"
              )) setAutoScoreBands(true);
            }}
            style={{ marginTop: 2 }}
          />
          <span>
            <b>Auto-score bands in Full Auto / Hybrid draft</b>{" "}
            {autoScoreBands ? <Pill s="medium">On — AI decides, you review after</Pill> : <Pill s="neutral">Off — you decide every band (default)</Pill>}
            <span style={{ display: "block", fontSize: 11.5, color: "#6b7280", marginTop: 3, lineHeight: 1.55 }}>
              <b>What this affects:</b> only the certification <b>band</b> (the 1 to 5 score), and only when it is produced by a <b>Full Auto run</b> (the "Run full audit" sweep). It does not change any verdict, finding, or evidence rating, and it does not touch a manual single-folder audit or a band you set yourself.
              <br />
              <b>Off (the default):</b> a Full Auto run stops at verdicts and findings and leaves every band blank for you to set on the Sub-Criterion Checklist. The AI only ever suggests a band; you decide it.
              <br />
              <b>On:</b> at the end of a Full Auto run, for each item it assessed, the AI also fills in the band itself from its own per-dimension scores and written reasoning. Each band set this way is marked <b>"Draft (AI) · Confirm to finalise"</b> on the Sub-Criterion Checklist, the Final Report (and its PDF), the Criterion Scorecard, and the Export Centre pack, and is logged as an <b>Automatic</b> decision in the Human Decision Log. The label clears only when a human confirms it — either the one-click Confirm button next to the label, or by opening that item and saving the band yourself; both log the same human decision. Bands you have already saved are never changed, and you can always override an AI-scored one. An item the AI cannot score cleanly is left blank and listed for you to do by hand, never guessed. Plain-English details: docs/auto-scoring-setting.md.
            </span>
          </span>
        </label>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>APSR percentage scale</h3>
          {isDefaultScale ? <Pill s="neutral">Reconstructed default</Pill> : <Pill s="medium">Edited</Pill>}
          {!isDefaultScale && <button onClick={resetApsrScale} style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#475569" }}>Reset to reconstructed default</button>}
        </div>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 6 }}>
          How each dimension's band converts to a percentage, and how the summed total maps to the final band. <b>These values are internal placeholders reconstructed from a single SSG auditor example</b> — the exact cut-offs and whether 0% is valid are not auditor-confirmed; do not present as an official result. Changing them here <b>immediately re-bands every item</b> on the Scorecard, Final Report and Sub-Criterion Checklist, not just future ones.
        </p>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Max % per dimension</span>
            <input
              type="number" min={0} max={100} step={0.5}
              value={apsrScale.maxPctPerDimension}
              onChange={(e) => setApsrScale({ ...apsrScale, maxPctPerDimension: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={{ ...inputStyle, marginTop: 3, width: 120 }}
            />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>÷ 5 = {(apsrScale.maxPctPerDimension / 5)}% per band step (100 ÷ 4 dimensions = 25 default)</span>
          </label>
          <div>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Band steps (derived)</span>
            <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} style={{ fontSize: 11, fontWeight: 700, color: "#475569", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 7px" }}>B{n} · {pctForScore(n as 1 | 2 | 3 | 4 | 5, apsrScale)}%</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Total % → final band thresholds (inclusive upper bound of each band)</span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            {([0, 1, 2, 3] as const).map((i) => (
              <label key={i} style={{ display: "block" }}>
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Band {i + 1} up to</span>
                <input
                  type="number" min={0} max={100}
                  value={apsrScale.bandThresholds[i]}
                  onChange={(e) => setThreshold(i, Number(e.target.value) || 0)}
                  style={{ ...inputStyle, marginTop: 2, width: 90 }}
                />
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>%</span>
              </label>
            ))}
            <div style={{ alignSelf: "center", fontSize: 10.5, color: "#94a3b8" }}>Band 5 = above {apsrScale.bandThresholds[3]}%</div>
          </div>
        </div>

        <div style={{ marginTop: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", fontSize: 12 }}>
          <b>Worked example under this scale:</b>{" "}
          <span style={{ fontFamily: "ui-monospace,monospace" }}>{exPcts[0]}% + {exPcts[1]}% + {exPcts[2]}% + {exPcts[3]}% = {exTotal}%</span>{" → "}
          <Pill s="medium">{bandTitle(finalBandFromPct(exTotal, apsrScale))}</Pill>
          <span style={{ color: "#94a3b8" }}> (A=Band 4, P=Band 4, S=Band 2, R=0% — the auditor's example lands on Band 3 at the default scale)</span>
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
