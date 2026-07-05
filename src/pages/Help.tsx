import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { INK, GOLD } from "../lib/theme";
import { visibleNav } from "../nav";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

// The guide's structure (groups, order, labels, which pages exist) comes
// straight from NAV so this page can never drift from the actual app again.
// Only the "What / How" prose lives here; a page with no entry falls back to
// its nav hint, so a new nav item is never invisible in the guide.
type Detail = { what: string; how: string };

const DETAILS: Record<string, Detail> = {
  "/": {
    what: "Your home base: overall readiness score out of 1000, EduTrust award, score-gate status and a step-by-step workflow guide.",
    how: "Start here to see where you stand. Buttons: 'Use demo data' fills sample data to explore; 'Recheck all evidence' lists unverified-evidence gaps; 'Audit all folders → score' reads every linked Drive folder and scores them in one pass.",
  },
  "/analytics": {
    what: "A visual read-out of everything — score gauge, items by band, band by criterion, critical gates, findings, evidence/audit progress and checklist coverage.",
    how: "Open it any time for an at-a-glance picture. Nothing to fill in; it reflects your live data.",
  },
  "/draft-workspace": {
    what: "Save and restore named versions (snapshots) of the entire workspace.",
    how: "Save a version before a big change so you can roll back. Restore brings the whole workspace (scores, checklist, findings) back to that point.",
  },
  "/profile-of-pei": {
    what: "A structured background profile of the PEI: ERF/EduTrust status, key personnel, financials, courses, student and staff profiles.",
    how: "Fill this first. It is injected into every AI assessment so the AI judges evidence like a briefed auditor, not blind.",
  },
  "/audit-cycle": {
    what: "The cycle name, period, owner and lifecycle status (Draft / In Progress / Locked), and the owning departments.",
    how: "Set the cycle details once. Lock it at the end to freeze the audit.",
  },
  "/auditors": {
    what: "The auditors / team running this audit.",
    how: "Add each auditor so evidence and reviews can be attributed to an owner.",
  },
  "/gd4-scoring-setup": {
    what: "The points/weightage reference per criterion AND the tunable difficulty: EduTrust tier cut-offs and AI banding strictness.",
    how: "Pick a difficulty preset (Standard / Hard / Very hard) or set custom thresholds, and choose how strict the AI is when marking evidence Met.",
  },
  "/gd4-library": {
    what: "Reference text for every GD4 requirement — intent, expected evidence and band descriptors.",
    how: "Look up what each item is asking for before attaching evidence.",
  },
  "/start-audit": {
    what: "The upfront choice of how much the AI does for the whole cycle: Full auto (runs and commits everything), Hybrid (stops at every verdict for your approval) or Manual (you decide everything, AI suggests on request).",
    how: "Pick a mode card, then continue to Evidence Folder. You can come back and change the mode at any time.",
  },
  "/evidence-folder": {
    what: "One Drive folder per sub-criterion, in two tabs: Policy & Procedure and Actual Evidence. Plus a school-wide Additional info folder.",
    how: "Paste the folder link, 'Check access' to confirm Drive can see it, then 'Run audit' — it reads the files (PDF/Word/text/images/spreadsheets) in three staged passes and routes the results to PPD Review or the checklist depending on the analysis path you chose.",
  },
  "/ppd-review": {
    what: "One row per GD4 requirement line: does the Policy & Procedure Document actually document it? Two tabs — PPD Review (documentation) and Evidence (combined documented-AND-implemented verdict).",
    how: "Run the review, read each verdict and suggested rewrite, then 'Compile findings' on the Evidence tab to raise findings from the gaps. Rows already covered by an audit-raised finding link to it instead of duplicating.",
  },
  "/sub-checklist": {
    what: "The source of truth for scoring. Each item is broken into testable Layer 2 lines with evidence attached and a maturity (Layer 1) check.",
    how: "Generate lines (AI or manual), attach evidence, mark each Met / Partial / Not met. The coverage % and maturity ceiling produce the band that feeds the overall score.",
  },
  "/evidence-matrix": {
    what: "A quick first-draft four-limb rating per item (Approach / Processes / Systems & Outcomes / Review).",
    how: "Use only for a rough early read. Without a Drive evidence link it is capped at Band 1 — the checklist is the real scoring path.",
  },
  "/scorecard": {
    what: "The official band per item, per criterion and overall.",
    how: "Review the resulting bands; justify or override where needed.",
  },
  "/rubric-banding": {
    what: "Shows how coverage % and maturity ceiling combine to produce each band.",
    how: "Use it to understand why an item landed on its band and what would move it up.",
  },
  "/evidence-intelligence": {
    what: "Read-only evidence health checks at three levels — Overall (everything), By criterion, and By item — plus AI agent explanations.",
    how: "Start on Overall to spot weak areas, drill into a criterion, then open a single item for the full check list and an AI justification.",
  },
  "/sampling": {
    what: "Risk-based sample sizes per item.",
    how: "Record the population and the sample you tested.",
  },
  "/interview": {
    what: "An interview question simulator to prepare for the on-site audit.",
    how: "Generate and rate readiness for likely interview questions.",
  },
  "/findings": {
    what: "The register of all findings raised — NC / OFI / OBS classification, grouped by sub-criterion, with dimension and risk-category filters.",
    how: "Raise and track findings; filter by criterion, severity or status. 'Raise all unmet' turns every failing checklist line into a finding in one click.",
  },
  "/afi-closure": {
    what: "Where each finding's closure is decided — root cause, corrective and preventive action, closure evidence, with AI and human verification.",
    how: "Fill the closure narrative and link evidence. Without closure evidence the finding stays open.",
  },
  "/ai-review": {
    what: "A log of every AI review run (live or simulated) with usage stats.",
    how: "Audit-trail of what the AI was asked and what it returned.",
  },
  "/ai-debug": {
    what: "A log of every system-prompt build: which skills were injected, for which module and function. In-memory only — cleared on reload.",
    how: "Open a row to verify exactly what guidance reached the model on a given call.",
  },
  "/human-decision-log": {
    what: "An audit trail of every human override or acceptance of an AI output.",
    how: "Nothing to fill in — it records decisions automatically as you accept or edit AI results.",
  },
  "/human-review": {
    what: "Confirm or override a band, with a written justification.",
    how: "A human signs off the AI/auto result; large overrides require justification.",
  },
  "/final-report": {
    what: "The consolidated report: EduTrust attainment ladder, overall + per-item banding, strengths, gaps, how to reach a higher band, the findings register with root cause/closure, and charts.",
    how: "Review it, optionally 'Generate AI summary', then 'Print / Save as PDF' for a clean report-only document.",
  },
  "/management-review": {
    what: "Leadership decisions needed before closeout.",
    how: "Record management decisions on items that need sign-off.",
  },
  "/finalisation": {
    what: "Final checks before locking the audit.",
    how: "Work through the checklist, then lock the final version.",
  },
  "/export": {
    what: "Export the finished audit pack.",
    how: "Download the management pack (Markdown) and the findings register (CSV).",
  },
  "/settings": {
    what: "Integrations: Supabase (sync), OpenAI (analysis + utility models and API key) and Google Drive.",
    how: "Connect Drive and add your OpenAI key here before using the AI and folder-audit features.",
  },
  "/ai-memories": {
    what: "Calibration memories — corrections the team has made to past AI outputs, fed back into future assessments.",
    how: "Review, keep or retire memories so the AI keeps learning your standards without accumulating stale ones.",
  },
  "/ai-calibration": {
    what: "A measurement harness comparing the app's AI results against UCC's real SSG assessment reports: per real AFI it records caught / partially caught / missed, with an over-rating check and a CSV export.",
    how: "Paste the real report AFIs into src/data/benchmarkAFIs.ts once, run your PPD/evidence assessments, then 'Run match analysis' — edit any AI judgement by hand; human edits are never overwritten.",
  },
  "/change-log": {
    what: "History of every app update (git push/pull) the app recorded, with a plain-English summary of what changed.",
    how: "Nothing to fill in — check it to see what changed in the app between sessions.",
  },
};

export function Help() {
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const NAV = visibleNav(showDeveloperTools);
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: INK, color: "#fff" }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Help &amp; guide</h3>
        <p style={{ fontSize: 12.5, color: "#aeb8c7", margin: 0 }}>
          What every page is and how to use it. A typical run: <b style={{ color: GOLD }}>Profile of PEI → Audit Cycle → Evidence Folder (link &amp; run audit) →
          PPD Review or Sub-Criterion Checklist → Scorecard → Findings &amp; closure → Re-audit → Final Report → Export</b>. The Sub-Criterion Checklist is the scoring source of truth.
        </p>
      </Card>

      {NAV.map((g) => {
        const items = g.items.filter((it) => it.path !== "/help");
        if (items.length === 0) return null;
        return (
          <Card key={g.group}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>{g.group}</h3>
            {g.hint && <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>{g.hint}</p>}
            <div style={{ display: "grid", gap: 8 }}>
              {items.map((it) => {
                const d = DETAILS[it.path];
                return (
                  <div key={it.path} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                    <Link to={it.path} style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", textDecoration: "none" }}>{it.label} →</Link>
                    <div style={{ fontSize: 12.5, color: "#374151", marginTop: 3 }}><b style={{ color: "#475569" }}>What:</b> {d?.what ?? it.hint}</div>
                    {d?.how && <div style={{ fontSize: 12.5, color: "#374151", marginTop: 2 }}><b style={{ color: "#475569" }}>How:</b> {d.how}</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
