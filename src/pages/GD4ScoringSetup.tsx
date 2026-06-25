import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";

export function GD4ScoringSetup() {
  return (
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
  );
}
