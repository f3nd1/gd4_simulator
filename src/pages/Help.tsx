import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { ControlLegend } from "../components/ui/ControlLegend";
import { INK, GOLD } from "../lib/theme";
import { visibleNav } from "../nav";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

// ─── Page-by-page reference (Users tab tail) ────────────────────────────────
// The reference's structure (groups, order, labels, which pages exist) comes
// straight from NAV so it can never drift from the actual app. Only the
// "What / How" prose lives here; a page with no entry falls back to its nav
// hint, so a new nav item is never invisible in the guide.
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
    how: "Add each auditor so evidence and reviews can be attributed to an owner. A run will not start without an active auditor selected.",
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
    what: "The cycle-level choice of how much the AI does: Full auto (runs and commits everything), Hybrid (verdicts commit, you review on the checklist; staged verdicts stop for approval) or Manual (you decide everything, AI suggests on request).",
    how: "Pick a mode card, then continue to Evidence Folder. You can come back and change the mode at any time.",
  },
  "/evidence-folder": {
    what: "One Drive folder per sub-criterion (4.2 is split into 4.2.1 and 4.2.2 on purpose — they gate independently), with a Policy & Procedure and an Actual Evidence side, plus a school-wide Additional info folder. Each row also picks its analysis path: Option A (PPD-first, assessor-grade) or Option B (staged, faster sweep).",
    how: "Paste the folder link, 'Check access' to confirm Drive can see it, then run. Scanned PDFs and images are read through AI vision with a per-run image budget — if the budget runs out mid-run, a prompt asks whether to spend more ('Proceed with all') or finish without those files ('Skip the rest'). Stuck runs have per-file Skip and 'Skip this AI step' controls.",
  },
  "/sub-checklist": {
    what: "The source of truth for scoring. Each item is broken into testable requirement lines with evidence attached, plus the item's APSR band matrix: you score Approach, Processes, Systems & Outcomes and Review against the official §23 descriptors; the four percentages sum to the band.",
    how: "Generate lines (AI or manual), attach evidence, mark each Met / Partial / Not met, then score the four dimensions on the matrix (an AI first pass can suggest them). A written justification is required. Note the on-page disclaimer: the percentage thresholds are reconstructed from one SSG auditor's worked example and not fully confirmed.",
  },
  "/scorecard": {
    what: "The official band per item, per criterion and overall.",
    how: "Review the resulting bands; justify or override where needed.",
  },
  "/rubric-banding": {
    what: "The official EduTrust §23 band rubric (verbatim) and every item's applied band and points.",
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
    what: "The register of all findings raised — NC / OFI / OBS classification, grouped by sub-criterion, with dimension and risk-category filters, and a per-finding 'Re-check this finding' button for targeted re-assessment.",
    how: "Raise and track findings; filter by criterion, severity or status. 'Raise all unmet' turns every failing checklist line into a finding in one click. For batch re-checking after new evidence, use the Clarification round page instead.",
  },
  "/clarification": {
    what: "The batch version of re-checking: all open findings in one list, grouped by sub-criterion, re-checked together as numbered rounds with visible history.",
    how: "Tick the findings you have new evidence for (or 'Check for updated evidence' to see which folders changed), open each row's 'Open Evidence folder ↗' link to upload in Drive without losing your place, then click 'Re-check selected'. A resolved finding is never closed automatically — you decide in Quality Action / AFI.",
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
  "/run-log": {
    what: "What an automated run actually did, step by step — including the real reason any step was skipped (no auditor, budget, human-judgement pre-checks, user skip).",
    how: "Check it after a Full Auto or Hybrid run before assuming something silently failed — the reason is recorded here.",
  },
  "/final-report": {
    what: "The consolidated report: EduTrust attainment ladder, overall + per-item banding grouped by APSR dimension, strengths, gaps, the findings register with root cause/closure, and charts.",
    how: "Review it, optionally 'Generate AI summary', then 'Print / Save as PDF'. Each item links onward: 'Sub-Criterion Checklist →' to edit its lines, 'Clarify / strengthen these findings →' to batch re-check its open findings. The Sub-criterion filter lists 4.2.1 and 4.2.2 separately.",
  },
  "/finalisation": {
    what: "Final checks before locking the audit.",
    how: "Work through the checklist, then lock the final version.",
  },
  "/export": {
    what: "Export the finished audit pack: management pack (Markdown), findings register (CSV), board summary, internal QA appendix, and the Traceability matrix (CSV) — one row per requirement line with its PPD verdict, evidence verdict, cited file(s), chunk(s), read method and verbatim quote.",
    how: "Download what you need. Honest limit on the traceability matrix: it cites the file and the exact quote, but never a page number — page-level location is not captured for any file type, so none is claimed.",
  },
  "/settings": {
    what: "Integrations: Supabase (sync), OpenAI (analysis + utility models and API key) and Google Drive.",
    how: "Connect Drive and add your OpenAI key here before using the AI and folder-audit features. The Drive connection now survives reloads (a server-side refresh token) — if it ever drops, reconnect here or on the Evidence Folder page.",
  },
  "/ai-memories": {
    what: "Calibration memories — corrections the team has made to past AI outputs (👎 + a correction anywhere in the app), fed back into future assessments.",
    how: "Review, keep or retire memories so the AI keeps learning your standards without accumulating stale ones.",
  },
  "/ai-calibration": {
    what: "The measurement lab: Benchmark (caught / partially caught / missed per real SSG finding, 59 seeded), Consistency (same run N times — repeatability), A vs B (path accuracy), Rule Tuning (champion-gated rule drafts), plus the Tuning Advisor.",
    how: "Run your audits first, then 'Run match analysis'. Edit any AI judgement by hand — human edits are never overwritten. Upload a new assessment report to add ground truth. Nothing here changes prompts or audit results by itself.",
  },
  "/prompt-review": {
    what: "Human review of the app's own AI prompts: rate, correct, AI-revise — with an explicit 'Make live' gate.",
    how: "Nothing changes what the app sends until you click 'Make live' on a revision.",
  },
  "/change-log": {
    what: "History of every app update (git push/pull) the app recorded, with a plain-English summary of what changed.",
    how: "Nothing to fill in — check it to see what changed in the app between sessions. The deployed commit hash shown here confirms which version is live.",
  },
};

// ─── Small shared bits ──────────────────────────────────────────────────────

function H({ children }: { children: ReactNode }) {
  return <h3 style={{ marginTop: 0, fontSize: 14 }}>{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.55, marginTop: 6, marginBottom: 6 }}>{children}</p>;
}
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#374151", lineHeight: 1.5, marginBottom: 5 }}>
      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 999, background: "#eef2ff", color: "#4338ca", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{n}</span>
      <span>{children}</span>
    </div>
  );
}
function Code({ children }: { children: ReactNode }) {
  return <code style={{ fontSize: 11.5, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "0 4px", whiteSpace: "nowrap" }}>{children}</code>;
}
function DevBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

// The audit lifecycle, as a dependency-free inline SVG (same approach as the
// app's other charts — see components/ui/charts.tsx; no charting library).
function LifecycleDiagram() {
  const stages = [
    { label: "Setup", sub: "Profile · Cycle · Auditors · Drive" },
    { label: "Run", sub: "Full auto / Hybrid / Manual" },
    { label: "Review", sub: "Checklist · Band matrix · Findings" },
    { label: "Clarify", sub: "Add evidence · Re-check rounds" },
    { label: "Finalise", sub: "Scorecard · Final Report" },
    { label: "Export", sub: "Packs · Traceability CSV" },
  ];
  const W = 1040, H = 96, boxW = 150, boxH = 56, gap = (W - stages.length * boxW) / (stages.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Audit lifecycle: Setup, Run, Review, Clarify, Finalise, Export">
      <defs>
        <marker id="help-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
        </marker>
      </defs>
      {stages.map((s, i) => {
        const x = i * (boxW + gap);
        return (
          <g key={s.label}>
            <rect x={x} y={16} width={boxW} height={boxH} rx={10} fill={i === 2 ? "#fffbeb" : "#f8fafc"} stroke={i === 2 ? GOLD : "#cbd5e1"} strokeWidth={i === 2 ? 2 : 1.2} />
            <text x={x + boxW / 2} y={40} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>{s.label}</text>
            <text x={x + boxW / 2} y={58} textAnchor="middle" fontSize={9.5} fill="#64748b">{s.sub}</text>
            {i < stages.length - 1 && (
              <line x1={x + boxW + 3} y1={16 + boxH / 2} x2={x + boxW + gap - 5} y2={16 + boxH / 2} stroke="#94a3b8" strokeWidth={1.6} markerEnd="url(#help-arrow)" />
            )}
          </g>
        );
      })}
      {/* Clarify loops back into Review until findings resolve */}
      <path d={`M ${3 * (boxW + gap) + boxW / 2} ${16 + boxH} C ${3 * (boxW + gap) + boxW / 2} ${H - 2}, ${2 * (boxW + gap) + boxW / 2} ${H - 2}, ${2 * (boxW + gap) + boxW / 2} ${16 + boxH + 4}`} fill="none" stroke="#b45309" strokeWidth={1.4} strokeDasharray="4 3" markerEnd="url(#help-arrow)" />
      <text x={2.5 * (boxW + gap) + boxW / 2} y={H - 6} textAnchor="middle" fontSize={9.5} fill="#b45309">re-check until resolved</text>
    </svg>
  );
}

// ─── Tab 1: For Users ───────────────────────────────────────────────────────

function UsersTab({ nav }: { nav: ReturnType<typeof visibleNav> }) {
  return (
    <>
      <Card>
        <H>The audit lifecycle at a glance</H>
        <LifecycleDiagram />
        <P>
          Everything in this app follows that loop. You set up once, run the audit, review what the AI found,
          clarify the gaps by adding evidence and re-checking, then finalise and export. The Clarify stage loops
          back into Review as many times as you need — that is normal, not a failure.
        </P>
      </Card>

      <Card>
        <H>1 · Set up</H>
        <Step n={1}>Fill <Link to="/profile-of-pei">Profile of PEI</Link> — the AI reads it on every assessment, so it judges like a briefed auditor.</Step>
        <Step n={2}>Set the <Link to="/audit-cycle">Audit Cycle</Link> and add <Link to="/auditors">Auditors</Link> (a run will not start without one selected).</Step>
        <Step n={3}>On <Link to="/settings">Settings</Link>, connect Google Drive and add the OpenAI key. The Drive connection survives reloads; if it ever drops, a Reconnect appears here and on the Evidence Folder page.</Step>
      </Card>

      <Card>
        <H>2 · Run an audit — the three modes</H>
        <P>One choice on <Link to="/start-audit">Start Audit</Link> decides how much the AI does for the whole cycle. You can change it at any time.</P>
        <ControlLegend items={[
          { label: "Full auto", text: "the AI runs everything and commits verdicts, findings and drafts. Fastest first pass; read the Run Log afterwards." },
          { label: "Hybrid (step by step)", text: "verdicts commit to the checklist and you review or edit them there; staged-audit verdicts stop for your approval. The recommended default." },
          { label: "Manual", text: "you enter every verdict yourself; the AI only suggests when you ask, item by item." },
        ]} />
        <P>
          Whatever the mode, the AI never finalises the audit: bands need your justification, findings never close
          themselves, and every AI write is either reviewable or logged in the <Link to="/human-decision-log">Human Decision Log</Link> and <Link to="/run-log">Run Log</Link>.
        </P>
      </Card>

      <Card>
        <H>3 · Evidence Folder — linking, running, and the vision budget</H>
        <Step n={1}>Each sub-criterion has a row (4.2 is deliberately split into 4.2.1 Student Contract and 4.2.2 FPS — they gate independently). Paste the Drive folder links: Policy &amp; Procedure and Actual Evidence.</Step>
        <Step n={2}>Click <b>Check access</b> — it confirms Drive can see the folder and warns about mis-filed documents.</Step>
        <Step n={3}>Pick the row's path — <b>Option A</b> (PPD-first, assessor-grade, the default) or <b>Option B</b> (staged, faster sweep) — then run.</Step>
        <P>
          Scanned PDFs and photos are read with AI vision, which costs money — so each run has an image budget (30 images;
          smaller files are read first so one giant scan cannot starve the rest). If the budget runs out mid-run, the run
          <b> pauses and asks you</b>:
        </P>
        <ControlLegend items={[
          { label: "Proceed with all", text: "raises the budget and reads the deferred files now — the prompt shows the estimated extra cost first." },
          { label: "Skip the rest", text: "finishes the run without those files. Their ledger rows say the read was attempted and is recoverable — nothing is silently lost." },
        ]} />
      </Card>

      <Card>
        <H>4 · Checklist, band and findings</H>
        <P>
          The <Link to="/sub-checklist">Sub-Criterion Checklist</Link> is the scoring source of truth. Each requirement line is
          Met / Partial / Not met with evidence attached. The item's band comes from the <b>APSR matrix</b>: you score
          Approach, Processes, Systems &amp; Outcomes and Review against the official descriptors, the four percentages sum,
          and the total maps to the band. An <b>AI first pass</b> can suggest the four scores; a written justification is
          always required, and the page honestly notes the percentage thresholds are reconstructed from one SSG auditor's
          example. Failing lines become findings on the <Link to="/findings">Findings</Link> page ('Raise all unmet' does it in one click).
        </P>
      </Card>

      <Card>
        <H>5 · Clarification round — closing gaps with new evidence</H>
        <P>
          When the institution produces new evidence for open findings, don't re-run whole audits. The{" "}
          <Link to="/clarification">Clarification round</Link> page lists every open finding grouped by sub-criterion;
          tick the ones to re-check and run them as one numbered round. Rounds and their before → after results stay
          visible in the history. Two similar buttons do very different things:
        </P>
        <ControlLegend items={[
          { label: "Re-check selected", text: "runs the AI re-assessment on the ticked findings (re-reads each item's evidence folder). This spends AI." },
          { label: "Check for updated evidence", text: "just refreshes the “evidence changed” badges by comparing Drive files against the last run. No AI, no verdict change." },
        ]} />
        <P>
          Each finding row has an <b>Open Evidence folder ↗</b> link that opens the right Drive folder in a new tab — upload
          there, come back, and your ticks and scroll position are untouched. A resolved finding is never closed for you:
          you decide in <Link to="/afi-closure">Quality Action / AFI</Link>.
        </P>
      </Card>

      <Card>
        <H>6 · Final Report — reading it and jumping onward</H>
        <P>
          The <Link to="/final-report">Final Report</Link> shows the attainment ladder, per-item banding grouped by APSR
          dimension, and each item's findings. From any item you can jump straight to its{" "}
          <b>Sub-Criterion Checklist →</b> (edit lines) or <b>Clarify / strengthen these findings →</b> (batch re-check) — and
          the destination shows a <b>← Back to Final Report · [item]</b> breadcrumb so you never lose your way back.
          The Sub-criterion filter lists 4.2.1 and 4.2.2 separately.
        </P>
      </Card>

      <Card>
        <H>7 · AI Calibration — how good is the AI, and how to improve it</H>
        <P>
          <Link to="/ai-calibration">AI Calibration</Link> grades the app's AI against <b>real SSG assessor findings</b> (59 seeded
          from UCC's actual reports): per finding it records caught / partially caught / missed, with breakdowns by report
          year and gap pattern. It is measurement only — it never changes prompts or audit results by itself. After a run,
          the <b>Tuning Advisor</b> turns weaknesses into recommendations: two small settings apply on a click (AI temperature
          and per-item path defaults); everything about improving prompts is a <b>copyable instruction — paste it to your
          developer / Claude Code</b>, who makes the change deliberately. Re-run afterwards and watch the 'Improvement over
          time' line climb. Your hand-edited judgements are never overwritten by a re-run.
        </P>
      </Card>

      <Card>
        <H>8 · Export Centre — including the Traceability matrix</H>
        <P>
          <Link to="/export">Export Centre</Link> has the management pack, findings register CSV, board summary, QA appendix,
          and the <b>Traceability matrix (CSV)</b>: one row per requirement line with its PPD verdict, evidence verdict, the
          specific evidence file(s), cited chunk(s), how each file was read (typed text vs vision/OCR) and the verbatim
          supporting quote. <b>Honest limit:</b> it cites the file and the exact quote, but never a page number — page-level
          location inside a document is not captured for any file type, so the export refuses to claim one.
        </P>
      </Card>

      <Card>
        <H>9 · Pre-check — automatic vs manual checks</H>
        <P>
          The Evidence Folder's Pre-check step runs <b>4 automatic detectors</b> (e.g. the date-discrepancy scan and record
          counts) and lists <b>manual tick-box checks</b> drawn from real past findings. In hands-off runs (Full auto / Hybrid)
          the AI-answerable manual checks are folded into the AI's evidence prompt automatically as "Check —" hints; the four
          that genuinely need human judgement (staff-qualification fit, Academic Board substance, auditor independence,
          audit-cert independence) are skipped and <b>named in the Run Log</b> so nothing disappears silently. Flags are
          advisory only — they make the AI look closer, they never change a verdict on their own.
        </P>
      </Card>

      <Card style={{ background: "#fffbeb", border: "1px solid #f59e0b" }}>
        <H>Worked example 1 — "New evidence just arrived for an open finding"</H>
        <Step n={1}>Open <Link to="/final-report">Final Report</Link>, find the item, click <b>Clarify / strengthen these findings →</b>. You land on Clarification, filtered to that item, the finding highlighted.</Step>
        <Step n={2}>Click the finding's <b>Open Evidence folder ↗</b> — Drive opens in a new tab. Upload the new document there and close that tab.</Step>
        <Step n={3}>Back on Clarification (your place is kept), tick the finding and click <b>Re-check selected (Round N)</b>. Wait — it re-reads the folder and re-assesses only that finding's lines.</Step>
        <Step n={4}>Read the round summary ("Round N: X of Y now resolved"). ✅ Pass if the finding's line moved from No evidence/Partially met to Evidenced.</Step>
        <Step n={5}>If resolved, close the finding yourself in <Link to="/afi-closure">Quality Action / AFI</Link> — the app never closes it for you.</Step>
      </Card>

      <Card style={{ background: "#fffbeb", border: "1px solid #f59e0b" }}>
        <H>Worked example 2 — "My run seems stuck"</H>
        <Step n={1}>Look at the run panel. If it says <b>Reading [file]…</b> for a long time, click that file's <b>Skip</b> — the run moves to the next file (any single file also auto-skips after 10 minutes; the ledger records why).</Step>
        <Step n={2}>If it is in an AI step (extraction/judging), click <b>Skip this AI step →</b> — only the stuck call is abandoned; its lines are marked 'Not assessed' honestly and the run continues. Never guessed.</Step>
        <Step n={3}>If a <b>Vision image budget reached</b> prompt is showing, the run is not stuck — it is waiting for your answer. Choose Proceed with all (spend more) or Skip the rest.</Step>
        <Step n={4}>Afterwards, open the <Link to="/run-log">Run Log</Link>: every skipped step and file records its real reason. If a whole run must be abandoned, Cancel releases it — nothing half-writes.</Step>
      </Card>

      <Card style={{ background: "#fffbeb", border: "1px solid #f59e0b" }}>
        <H>Worked example 3 — "Is the AI actually catching what SSG would catch?"</H>
        <Step n={1}>Run your audits (Evidence Folder) so there are real results to grade.</Step>
        <Step n={2}>Open <Link to="/ai-calibration">AI Calibration</Link> → <b>Run match analysis</b>. Read the scoreboard: green = caught, amber = partially, red = missed.</Step>
        <Step n={3}>Look at the <b>by-pattern breakdown</b> — a mostly-red pattern row (e.g. "not implemented per PPD") is a specific weakness, not a vague one.</Step>
        <Step n={4}>Open the <b>Tuning Advisor</b> panel: apply the one-click settings if offered, and <b>copy the prompt-improvement instruction</b> — paste it to your developer / Claude Code to make the change.</Step>
        <Step n={5}>After the change is deployed, re-run the match analysis. ✅ Pass if the caught count on that pattern climbs on the 'Improvement over time' chart.</Step>
      </Card>

      <Card style={{ background: INK, color: "#fff" }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Page-by-page reference</h3>
        <p style={{ fontSize: 12, color: "#aeb8c7", margin: 0 }}>Every page in the sidebar, in order — what it is and how to use it.</p>
      </Card>
      {nav.map((g) => {
        const items = [...g.items, ...(g.tools ?? [])].filter((it) => it.path !== "/help");
        if (items.length === 0) return null;
        return (
          <Card key={g.group}>
            <H>{g.group}</H>
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
    </>
  );
}

// ─── Tab 2: For Developers ──────────────────────────────────────────────────

function DevelopersTab() {
  return (
    <>
      <Card style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}>
        <H>Standing working rules (inherit these — they were learned the hard way)</H>
        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.65 }}>
          <b>Investigate first.</b> Read the code before asserting behaviour; when the task is investigate/report, report — do not fix.{" "}
          <b>Live-verify every "it works" claim</b> in a real browser (Playwright cookbook in CLAUDE.md), with a screenshot — a passing code read is not verification.{" "}
          <b>Locked files:</b> <Code>scoring.ts</Code>, <Code>checklistBanding.ts</Code>'s override computation, <Code>gd4Requirements.ts</Code>, <Code>consistencyChecker.ts</Code> — never modify without explicit approval.{" "}
          <b>Style:</b> UK spelling, no em dashes in user-facing copy.{" "}
          <b>Git:</b> all work on <Code>main</Code>, full commit bodies (the Change Log renders them to the user), verify <Code>origin/main == HEAD</Code> after every push.{" "}
          <b>Honesty invariants:</b> a failed/skipped AI call is "Not assessed", never a fabricated negative; nothing auto-promotes/auto-closes/auto-verifies; every AI artifact cites real sources; exact-normalised matching beats fuzzy.
        </div>
      </Card>

      <Card>
        <H>Architecture in one breath</H>
        <DevBlock title="Client-only SPA + Supabase sync">
          React 19 + Zustand 5 + Vite, HashRouter (<Code>src/App.tsx</Code> routes, <Code>src/nav.ts</Code> nav — this Help page derives its reference from NAV).
          All persisted stores go through <Code>src/store/supabaseStorage.ts</Code> (Supabase-synced, localStorage fallback, ~600ms debounced writes, beforeunload flush).
          Persist keys never change on rename; migrations use zustand <Code>version</Code>+<Code>migrate</Code> (checklist store is at version 2 — the stores table in CLAUDE.md is the reference).
          Google Drive access uses a server-side refresh token (<Code>supabase/functions/drive-oauth</Code>, the app's only backend) so the connection outlives the ~1h token.
        </DevBlock>
        <DevBlock title="Run modes are commit gating, not different engines">
          <Code>src/lib/runModes.ts</Code> — Full auto / Hybrid / Manual decide WHEN checklist writes commit and whether a human is prompted
          (<Code>splitWritesByMode</Code>); the assessment engines are identical across modes. Hybrid is default.
        </DevBlock>
        <DevBlock title="The ?item= deep-link pattern">
          Cross-page navigation carries <Code>?item=&lt;gd4ItemId&gt;</Code> (+ <Code>&amp;from=&lt;page&gt;</Code>); targets pre-filter/scroll/highlight, and{" "}
          <Code>components/ui/DeepLinkBackBar.tsx</Code> renders the "← Back to [source] · [item]" line from <Code>?from=</Code>.
          Any dropdown listing sub-criteria/items MUST build options from <Code>filterableScopes()</Code> in <Code>src/lib/evidenceScope.ts</Code> —
          the canonical split-aware list. Building from <Code>GD4_SUB_CRITERIA</Code> directly is exactly how the merged-"4.2" filter bug recurred four times.
        </DevBlock>
      </Card>

      <Card>
        <H>Feature map with the reasoning that is not obvious from the code</H>
        <DevBlock title="4.2 gate-split (and why 2.2 is not split)">
          <Code>PER_ITEM_SPLIT_SUBS</Code> in <Code>src/lib/evidenceScope.ts</Code> is the single source: 4.2's two items gate independently and keep separate
          Drive folders/runs, at Felix's explicit request. 2.2 has the same two-item shape but was deliberately left merged. Scope helpers
          (<Code>scopeIdForItem</Code>, <Code>folderScopeId</Code>, <Code>runScopesForSub</Code>) keep the special case in one place — never scatter a literal "4.2".
        </DevBlock>
        <DevBlock title="Band scoring: human APSR matrix; line dimension tags are display-only">
          The band comes from the four-dimension percentage matrix (<Code>apsrMatrixResult</Code> in <Code>checklistBanding.ts</Code>,{" "}
          <Code>setHolisticBand</Code>/<Code>setApsrMatrix</Code> in <Code>useChecklistModuleStore</Code>) — reconstructed from a real SSG auditor's worked example
          (A 20% + P 20% + S 10% + R 0% = 50% → Band 3); thresholds are flagged on-page as inferred, and 0% is allowed (the R=0% open question is surfaced, not resolved).
          Per-LINE dimension tags never feed the band — the Final Report's cross-cutting dimension grouping is display-only, protected by byte-identical
          band regression tests. AI band suggestions populate the working grid but the human saves, with mandatory justification.
        </DevBlock>
        <DevBlock title="Vision budget + reading order + the 10-minute cap">
          <Code>DEFAULT_VISION_IMAGE_BUDGET = 30</Code> (<Code>useWorkspaceStore.ts</Code>, one constant — it was four drifting literals of 10), 5 pages max per file.
          Files are read smallest-first (<Code>orderBySizeForVisionBudget</Code> in <Code>lib/drive/textUtils.ts</Code>) so one large scan cannot starve the rest —
          budget exhaustion produced false "no evidence found" gaps. On exhaustion the run BLOCKS on <Code>visionBudgetPrompt</Code>{" "}
          (modal mounted globally in Layout — it was once mounted per-page and an invisible prompt hung a 6-hour run). <Code>DRIVE_FILE_HARD_CAP_MS</Code> (10 min)
          races every per-file read alongside the user's Skip so no single file can hang a run; budget-skipped ledger rows say the read was attempted and is recoverable.
        </DevBlock>
        <DevBlock title="Skip a stuck AI call (and why there is no per-file de-batching)">
          <Code>skipCurrentAiCall()</Code> (store) → <Code>raceCallSkip</Code>/<Code>CALL_SKIPPED</Code> in <Code>agentRuntime.ts</Code>: abandons only the in-flight
          window/batch call; its refs become "Not assessed" (honest missing data), the loop continues. Full per-file de-batching was explicitly rejected —
          it multiplies calls (cost) and changes windowing (consistency risk). The "Skip this AI step →" button is gated to AI stages
          (between-files states have no call registered to abort — that was a real dead-button bug).
        </DevBlock>
        <DevBlock title="Option A two-pass honesty (extract → judge)">
          Pass 1 extracts candidate passages; every quote is verified verbatim (<Code>quoteExistsInSource</Code>) before Pass 2 judges from verified passages alone —
          the judge never sees the documents, so it cannot cite what does not exist. Clean-zero extraction is decided deterministically in code, never AI-guessed;
          all-candidates-failed-verification is "Not assessed" (extraction defect), never a fabricated gap. Verdict/comment self-contradictions are caught by the
          three-class <Code>conclusionMismatch</Code> guard (Partial and Not met are distinct classes; "rated X" and "assessed as X" both recognised) and stored
          legacy contradictions are flagged in the checklist tabs via <Code>verdictNarrativeMismatch</Code>. The SPECIFIC-PROMISE RULE (prompt + evidence-standards skill)
          stops adjacent activity being credited to a different promise — the "not implemented per PPD" class of SSG finding.
        </DevBlock>
        <DevBlock title="Clarification Round: sequential by necessity">
          <Code>runClarificationRound</Code> (<Code>useWorkspaceStore.ts</Code>) groups selected findings by scope via the shared <Code>resolveRecheckTarget</Code>{" "}
          (same resolver as per-finding <Code>recheckFinding</Code>) and runs <Code>runEvidenceAssessment(scope, retryRefs)</Code> once per scope SEQUENTIALLY —
          the engine keys a single <Code>busy</Code> string and module-level abort singletons, so concurrent scopes would cancel each other. Rounds are recorded to{" "}
          <Code>clarificationRounds</Code> (cap 50) with before → after weakest-line verdicts and honest skipped/blocker lists. Evidence drift
          (<Code>checkEvidenceDrift</Code>/<Code>diffEvidenceFiles</Code>) is an advisory badge only — never a gate — and a resolved finding is never auto-closed.
        </DevBlock>
        <DevBlock title="Pre-check: advisory flags, never verdict gates">
          <Code>src/lib/preAnalysisChecklist.ts</Code>: 4 auto detectors (fixed <Code>DETECTION_REGISTRY</Code>, honest "unknown" over false positives) + manual checks.
          <Code>computeFlaggedPreCheckItems(..., autoIncludeManual)</Code> folds AI-answerable manual checks into the evidence prompt as "Check —" hints in hands-off
          runs (no extra AI call); the 4 <Code>HUMAN_JUDGEMENT_ONLY</Code> ids are skipped and disclosed in the Run Log + coverage note. Flags ride prompts as context
          and never override a verdict: a false gate would hide real gaps, and the human-gate principle (draft/verified on the Setup page) governs every checklist change.
        </DevBlock>
        <DevBlock title="Calibration Lab: measurement may never mutate">
          <Code>calibrationRunner.ts</Code> scratch runs re-run the REAL engines with production-parity prompts but write nothing to audit results (top-of-file
          GUARANTEE); <Code>judgeVsBenchmark</Code> and the Benchmark tab's match analysis write only to <Code>useCalibrationStore</Code>{" "}
          (human-override-wins: <Code>setAiMatch</Code> refuses to overwrite a human <Code>setMatch</Code>). The Tuning Advisor (<Code>lib/tuningAdvisor.ts</Code>)
          one-click-applies ONLY temperature and path defaults (visible, reversible, logged); prompt/skill changes are copyable instructions for a developer.
          Rule Tuning is champion-gated (<Code>useRuleTuningStore.championInjection</Code> — drafts never go live without an explicit "Make Champion").
          Every path from measurement back into the engine requires a deliberate human click.
        </DevBlock>
        <DevBlock title="The learning loop (both ends must stay wired)">
          Write side: <Code>ThumbsButtons</Code> + <Code>FeedbackModal</Code> → <Code>addCalibrationMemory</Code> (module "Line Status" for line verdicts).
          Read side: every line-assessing engine call selects active Line Status memories (top 5 by effectiveness) and passes them as <Code>memories:</Code>.
          A new engine call that omits the read side silently breaks learning — this was a real Option A bug.
        </DevBlock>
        <DevBlock title="Traceability matrix + the page-precision truth">
          <Code>exportTraceabilityMatrixCsv</Code> (<Code>lib/auditCsvExport.ts</Code>) joins PPD rows to evidence rows per line, audit-wide. Chunks know their file,
          never their page: text-PDF extraction drops page labels, vision keeps only inline "--- Page N ---" markers decoupled from 24k-char chunk boundaries.
          So the export cites file + verbatim quote and deliberately has no page column — do not add one without building real page tracking first.
        </DevBlock>
      </Card>

      <Card style={{ background: "#fffbeb", border: "1px solid #f59e0b" }}>
        <H>Known limitations / parked items</H>
        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.65 }}>
          <b>Calibration grades 4.2 merged:</b> benchmark entries key on <Code>subCriterion: "4.2"</Code> (with finer <Code>gd4Ref</Code> unused for matching), so the
          Benchmark/Consistency/A-vs-B machinery works at sub-criterion level while the rest of the app splits 4.2.1/4.2.2. Known, low priority — calibration is
          diagnostic-only so nothing leaks into real results.{" "}
          <b>Nil-return log/register idea:</b> parked pending Felix confirming the institution actually keeps one — do not build without that.{" "}
          <b>Human-only pre-check items are drafts:</b> all four <Code>HUMAN_JUDGEMENT_ONLY</Code> items ship <Code>verified: false</Code>; their run-log disclosure
          appears once approved on the Setup page.{" "}
          <b>Option B staged passes have no per-batch event stream</b> (unlike Option A), so skip diagnostics there are coarser.{" "}
          <b>Stale comment:</b> <Code>aiClient.ts</Code> (~line 61) still claims the OpenAI key "never syncs" — it does sync via Supabase; do not propagate the claim.{" "}
          <b>Page-level location is not captured anywhere</b> (see Traceability above).
        </div>
      </Card>

      <Card>
        <H>Where to look first when something breaks</H>
        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.65 }}>
          "The fix doesn't work" → Change Log's deployed hash + a hard refresh + a FRESH run (stale build and stale results are the two usual false alarms).{" "}
          "The AI said/read something odd" → AI Debug Log (exact prompt), AI Review Log (usage), File Ledger (what a run actually read, per file, with read method).{" "}
          "A run skipped something" → Run Log records the real per-step reason.{" "}
          Full architecture, store table, DoD gauntlet and Playwright cookbook: <Code>CLAUDE.md</Code> at the repo root — read it before changing anything.
        </div>
      </Card>
    </>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function Help() {
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const NAV = visibleNav(showDeveloperTools);
  const [tab, setTab] = useState<"users" | "devs">("users");
  const tabBtn = (active: boolean) => ({
    cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "7px 16px", borderRadius: 8,
    border: active ? "none" : "1px solid #cbd5e1",
    background: active ? GOLD : "#fff", color: INK,
  });
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: INK, color: "#fff" }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Help &amp; guide</h3>
        <p style={{ fontSize: 12.5, color: "#aeb8c7", margin: "0 0 10px" }}>
          <b style={{ color: GOLD }}>For Users</b> is the plain-English walkthrough of the whole audit journey.{" "}
          <b style={{ color: GOLD }}>For Developers</b> documents the architecture, the reasoning behind design decisions, and the working rules.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("users")} style={tabBtn(tab === "users")}>For Users</button>
          <button onClick={() => setTab("devs")} style={tabBtn(tab === "devs")}>For Developers</button>
        </div>
      </Card>
      {tab === "users" ? <UsersTab nav={NAV} /> : <DevelopersTab />}
    </div>
  );
}
