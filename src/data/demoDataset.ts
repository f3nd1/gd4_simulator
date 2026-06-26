// Fully-populated demo dataset for the workflow-progress fields that start
// empty by default (reviewer drafts, sign-offs, closures, checklist results,
// samples, interview prep, management review pack, export log). Derived
// entirely from the existing real GD4 items, findings and checklist library —
// it does not invent any new GD4 criteria, sub-criteria, items or rubric text.
import type {
  ItemEvidence,
  ManagementReviewItem,
  SampleRecord,
  SampleRecordType,
  InterviewQuestion,
  ExportLogEntry,
  ChecklistStatus,
} from "../types";
import { GD4_REQUIREMENTS } from "./gd4Requirements";
import { FINDINGS } from "./findings";
import { CHECKLIST_LIB } from "./agents";
import { aiScore, getBand } from "../lib/scoring";

const TYPE_BY_CRITERION: Record<string, SampleRecordType> = {
  "1": "Academic",
  "2": "Staff",
  "3": "Academic",
  "4": "Student",
  "5": "Academic",
  "6": "QA",
  "7": "Financial",
};

export function buildDemoDataset(evidence: Record<string, ItemEvidence>) {
  const reviewer: Record<string, number> = {};
  const confirmed: Record<string, number | null> = {};
  const justify: Record<string, string> = {};

  GD4_REQUIREMENTS.forEach((req, idx) => {
    const ev = evidence[req.id];
    if (!ev) return;
    const ais = aiScore(ev);
    // A reviewer's draft score nudges slightly off the AI suggestion, the
    // way a human auditor's read of the evidence rarely matches it exactly.
    const nudge = idx % 3 === 0 ? -4 : idx % 3 === 1 ? 3 : 0;
    const rev = Math.max(0, Math.min(100, ais + nudge));
    reviewer[req.id] = rev;
    if (idx % 3 !== 2) confirmed[req.id] = rev;
    justify[req.id] =
      ev.review === "Missing" || ev.processes === "Missing"
        ? `Evidence gap noted for ${req.id}; reviewer score reflects missing ${ev.processes === "Missing" ? "processes" : "review"} evidence.`
        : `Reviewed against the rubric for ${req.id}; current evidence supports a score of ${rev}.`;
  });

  const closures: Record<string, { root: string; corr: string; prev: string; evid: string; human: "" | "Accepted"; ai: string; aiReason: string; aiNeed: string; live: boolean }> = {};
  FINDINGS.forEach((f, idx) => {
    const closeIt = f.severity === "Low" || f.severity === "Medium" || (f.severity === "High" && idx % 2 === 0);
    closures[f.id] = {
      root: `Root cause: ${f.issue}`,
      corr: `Update the PPD for ${f.gd4ItemId} to explicitly document the missing element and retrain the owning team.`,
      prev: `Add this point to the ${f.gd4ItemId} PPD review checklist so future drafts are checked against it.`,
      evid: closeIt ? `Drive: Evidence/${f.gd4ItemId}/${f.id}-closure-evidence.pdf` : "",
      human: closeIt ? "Accepted" : "",
      ai: closeIt ? "Acceptable" : f.severity === "Critical" ? "Maintain Finding" : "Partial",
      aiReason: closeIt
        ? "Corrective and preventive actions are documented and closure evidence is linked."
        : "Closure evidence link is still missing or the root cause needs more detail.",
      aiNeed: closeIt ? "" : "Closure evidence link (Drive record) showing the corrective action was implemented.",
      live: false,
    };
  });

  const checklist: Record<string, { status: ChecklistStatus; comment: string }> = {};
  CHECKLIST_LIB.forEach((c, idx) => {
    const status: ChecklistStatus = idx % 7 === 6 ? "Fail" : idx % 5 === 4 ? "Partial" : "Pass";
    checklist[c.id] = {
      status,
      comment:
        status === "Pass"
          ? "Confirmed against current evidence set."
          : status === "Partial"
          ? "Partially evidenced; follow-up required before sign-off."
          : "Not evidenced — see linked finding.",
    };
  });

  const weakItems = GD4_REQUIREMENTS.filter((req) => {
    const ev = evidence[req.id];
    return ev && (req.gateSensitive || getBand(aiScore(ev)) < 3);
  }).slice(0, 12);
  const samples: SampleRecord[] = weakItems.map((req, idx) => {
    const ev = evidence[req.id];
    const score = aiScore(ev);
    return {
      id: `SMP-${req.id}-${idx}`,
      auditCycleId: "cycle-1",
      gd4ItemId: req.id,
      recordType: TYPE_BY_CRITERION[req.criterion] || "QA",
      reference: `${req.id} record set ${idx + 1}`,
      riskReason: req.gateSensitive ? "Gate-sensitive item" : `Evidence score ${score}, below Band 3`,
      selected: true,
      testedOutcome: (idx % 3 === 0 ? "Fail" : idx % 3 === 1 ? "Partial" : "Pass") as SampleRecord["testedOutcome"],
      notes: getBand(score) < 3 ? "Sample tested against current PPD; gap consistent with evidence rating." : "Sample tested; no material exceptions noted.",
    };
  });

  const interviewQuestions: InterviewQuestion[] = GD4_REQUIREMENTS.filter((req) => {
    const ev = evidence[req.id];
    return ev && (ev.review !== "good" || ev.systemsOutcomes !== "good" || ev.processes !== "good");
  }).map((req, idx) => ({
    id: `IQ-${req.id}`,
    gd4ItemId: req.id,
    question: `Walk me through how ${req.requirement.toLowerCase()} is implemented, reviewed and how the outcome is measured.`,
    expectedAnswer: `Staff should describe the documented process, point to a recent review record, and quote an outcome metric or trend for ${req.id}.`,
    readiness: (idx % 3 === 0 ? "Weak" : idx % 3 === 1 ? "Adequate" : "Strong") as InterviewQuestion["readiness"],
    notes: idx % 3 === 0 ? "Practice run surfaced gaps consistent with the evidence rating." : "Practice run went well.",
  }));

  const managementReviewItems: ManagementReviewItem[] = [
    {
      id: "MR-DEMO-1",
      auditCycleId: "cycle-1",
      section: "Evidence Gaps",
      content: "Sub-criteria 5.1 and 5.5 carry the most severe AFIs (B13, B18) and need closure before the next mock audit.",
      decisionNeeded: true,
      decision: "Approved follow-up plan; ALI/CM to own closure by next quarter.",
      decidedBy: "SGL Governance Reviewer",
      decidedAt: new Date().toLocaleString(),
    },
    {
      id: "MR-DEMO-2",
      auditCycleId: "cycle-1",
      section: "Gate Risk",
      content: "Sub-criterion 4.6 and Criterion 5 averages are tracking close to the Band 3 gate threshold; recommend prioritising evidence refresh there.",
      decisionNeeded: true,
    },
    {
      id: "MR-DEMO-3",
      auditCycleId: "cycle-1",
      section: "Management Review Follow-up",
      content: "B19: most 2025 Management Review follow-up actions lack execution timelines; propose a standard timeline field for future actions.",
      decisionNeeded: false,
    },
  ];

  const exportLog: ExportLogEntry[] = [
    {
      id: "EXP-DEMO-1",
      auditCycleId: "cycle-1",
      exportName: "GD4_Management_Pack.md",
      format: "Markdown",
      exportedAt: new Date(Date.now() - 86400000).toLocaleString(),
      exportedBy: "SQ",
    },
  ];

  return { reviewer, confirmed, justify, closures, checklist, samples, interviewQuestions, managementReviewItems, exportLog };
}
