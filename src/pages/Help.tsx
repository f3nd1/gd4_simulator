import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { INK, GOLD } from "../lib/theme";

type Entry = { path: string; label: string; what: string; how: string };
type Group = { group: string; intro?: string; items: Entry[] };

const GUIDE: Group[] = [
  {
    group: "Overview",
    items: [
      { path: "/", label: "Dashboard", what: "Your home base: overall readiness score out of 1000, EduTrust award, score-gate status and a step-by-step workflow guide.", how: "Start here to see where you stand. Buttons: 'Use demo data' fills sample data to explore; 'Recheck all evidence' lists unverified-evidence gaps; 'Audit all folders → score' reads every linked Drive folder and scores them in one pass." },
      { path: "/analytics", label: "Data Dashboard", what: "A visual read-out of everything — score gauge, items by band, band by criterion, critical gates, findings, evidence/audit progress and checklist coverage.", how: "Open it any time for an at-a-glance picture. Nothing to fill in; it reflects your live data." },
      { path: "/draft-workspace", label: "Draft Workspace", what: "Save and restore named versions (snapshots) of the entire workspace.", how: "Save a version before a big change so you can roll back. Restore brings the whole workspace (scores, checklist, findings) back to that point." },
    ],
  },
  {
    group: "1 · Setup",
    intro: "Brief the AI on the school, set up the cycle and team, and confirm the scoring reference before collecting evidence.",
    items: [
      { path: "/school-context", label: "School Context", what: "A persistent markdown briefing about the institution (mission, size, programmes, governance) plus an optional Drive link.", how: "Fill this first. It is injected into every AI assessment so the AI judges evidence like a briefed auditor, not blind. Toggle it off or trim it to control cost." },
      { path: "/audit-cycle", label: "Audit Cycle", what: "The cycle name, period, owner and lifecycle status (Draft / In Progress / Locked), and the owning departments.", how: "Set the cycle details once. Lock it at the end to freeze the audit." },
      { path: "/auditors", label: "Auditor Creation", what: "The auditors / team running this audit.", how: "Add each auditor so evidence and reviews can be attributed to an owner." },
      { path: "/gd4-scoring-setup", label: "GD4 Scoring Setup", what: "The points/weightage reference per criterion AND the tunable difficulty: EduTrust tier cut-offs and AI banding strictness.", how: "Pick a difficulty preset (Standard / Hard / Very hard) or set custom thresholds, and choose how strict the AI is when marking evidence Met." },
      { path: "/gd4-library", label: "GD4 Library", what: "Reference text for every GD4 requirement — intent, expected evidence and band descriptors.", how: "Look up what each item is asking for before attaching evidence." },
    ],
  },
  {
    group: "2 · Evidence",
    intro: "Attach evidence for each item. The Sub-Criterion Checklist is the recommended, scoring source of truth.",
    items: [
      { path: "/evidence-folder", label: "Evidence Folder", what: "One Drive folder per sub-criterion, in two tabs: Policy & Procedure and Actual Evidence. Plus a school-wide Additional info folder.", how: "Paste the folder link, 'Check access' to confirm Drive can see it, then 'Run audit' — it generates the checklist lines if missing, reads the files (PDF/Word/text/images), sets each line's status and updates the band." },
      { path: "/sub-checklist", label: "Sub-Criterion Checklist", what: "The source of truth for scoring. Each item is broken into testable Layer 2 lines with evidence attached and a maturity (Layer 1) check.", how: "Generate lines (AI or manual), attach evidence, mark each Met / Partial / Not met. The coverage % and maturity ceiling produce the band that feeds the overall score." },
      { path: "/evidence-matrix", label: "Evidence Matrix", what: "A quick first-draft four-limb rating per item (Approach / Processes / Systems & Outcomes / Review).", how: "Use only for a rough early read. Without a Drive evidence link it is capped at Band 1 — the checklist is the real scoring path." },
    ],
  },
  {
    group: "3 · Scoring",
    items: [
      { path: "/scorecard", label: "Criterion Scorecard", what: "The official band per item, per criterion and overall.", how: "Review the resulting bands; justify or override where needed." },
      { path: "/rubric-banding", label: "Rubric Banding", what: "Shows how coverage % and maturity ceiling combine to produce each band.", how: "Use it to understand why an item landed on its band and what would move it up." },
      { path: "/evidence-intelligence", label: "Evidence Intelligence", what: "Read-only evidence health checks at three levels — Overall (everything), By criterion, and By item — plus AI agent explanations.", how: "Start on Overall to spot weak areas, drill into a criterion, then open a single item for the full check list and an AI justification." },
    ],
  },
  {
    group: "4 · Testing & Sampling",
    items: [
      { path: "/sampling", label: "Sampling", what: "Risk-based sample sizes per item.", how: "Record the population and the sample you tested." },
      { path: "/interview", label: "Interview", what: "An interview question simulator to prepare for the on-site audit.", how: "Generate and rate readiness for likely interview questions." },
    ],
  },
  {
    group: "5 · Findings & Review",
    items: [
      { path: "/findings", label: "Findings", what: "The register of all AFIs / quality actions raised.", how: "Raise and track findings; filter by criterion, severity or status." },
      { path: "/afi-closure", label: "Quality Action / AFI", what: "Where each finding's closure is decided — root cause, corrective and preventive action, closure evidence, with AI and human verification.", how: "Fill the closure narrative and link evidence. Without closure evidence the finding stays open." },
      { path: "/ai-review", label: "AI Agent Review", what: "A log of every AI review run (live or simulated) with usage stats.", how: "Audit-trail of what the AI was asked and what it returned." },
      { path: "/human-review", label: "Human Review / Override", what: "Confirm or override a band, with a written justification.", how: "A human signs off the AI/auto result; large overrides require justification." },
      { path: "/re-audit", label: "Re-audit and Re-score", what: "Re-check items that were below band or had closed findings.", how: "Run after rectification to confirm the band has moved." },
    ],
  },
  {
    group: "6 · Closeout",
    items: [
      { path: "/final-report", label: "Final Report", what: "The consolidated report: EduTrust attainment ladder, overall + per-item banding, strengths, gaps, how to reach a higher band, the findings register with root cause/closure, and charts.", how: "Review it, optionally 'Generate AI summary', then 'Print / Save as PDF' for a clean report-only document." },
      { path: "/management-review", label: "Management Review", what: "Leadership decisions needed before closeout.", how: "Record management decisions on items that need sign-off." },
      { path: "/finalisation", label: "Finalisation Checklist", what: "Final checks before locking the audit.", how: "Work through the checklist, then lock the final version." },
      { path: "/export", label: "Export Centre", what: "Export the finished audit pack.", how: "Download the management pack (Markdown) and the findings register (CSV)." },
    ],
  },
  {
    group: "Settings",
    items: [
      { path: "/settings", label: "Settings", what: "Integrations: Supabase (sync), OpenAI (analysis + utility models and API key) and Google Drive.", how: "Connect Drive and add your OpenAI key here before using the AI and folder-audit features." },
    ],
  },
];

export function Help() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: INK, color: "#fff" }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Help &amp; guide</h3>
        <p style={{ fontSize: 12.5, color: "#aeb8c7", margin: 0 }}>
          What every page is and how to use it. A typical run: <b style={{ color: GOLD }}>School Context → Audit Cycle → Evidence Folder (link &amp; run audit) →
          Sub-Criterion Checklist → Scorecard → Findings &amp; closure → Re-audit → Final Report → Export</b>. The Sub-Criterion Checklist is the scoring source of truth.
        </p>
      </Card>

      {GUIDE.map((g) => (
        <Card key={g.group}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>{g.group}</h3>
          {g.intro && <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>{g.intro}</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {g.items.map((it) => (
              <div key={it.path} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                <Link to={it.path} style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", textDecoration: "none" }}>{it.label} →</Link>
                <div style={{ fontSize: 12.5, color: "#374151", marginTop: 3 }}><b style={{ color: "#475569" }}>What:</b> {it.what}</div>
                <div style={{ fontSize: 12.5, color: "#374151", marginTop: 2 }}><b style={{ color: "#475569" }}>How:</b> {it.how}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
