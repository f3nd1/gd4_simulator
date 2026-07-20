// Thin orchestration layer between the workspace store and the AI client.
// Builds the prompt, calls chatComplete (the one place that knows how to
// reach OpenAI), and parses the reply. The deterministic score/band always
// comes from scoring.ts and is passed in unchanged — the LLM is only asked
// for justification/explanation text, never for the score itself, so the
// official GD4 scoring engine never depends on a live AI call.

import type { AgentDefinition, ItemEvidence, AISettings, ApsrWorkingScores, Band, Confidence, GD4Requirement, ApsrBreakdown, GeneratedChecklistLine, FlatAuditPoint, PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, SpecificChecklistLine, StagedCoverageStatus, PPDVerdict, PPDReviewRow, EvidenceVerdict, PPDSubClause, PPDPromise, PPDContradiction, PromiseCheck } from "../../types";
import { chatComplete, AIClientError, addUsage, verdictTemp, type AIUsage, type ChatSchema } from "./aiClient";
import { sObj, sArr, sStr, sBool, sEnum } from "./schemaHelpers";
import type { SimulatedItemVerdict, SimulatedClosureVerdict, EvidenceFillDraft, FolderAuditLineVerdict } from "./simulateAI";
import { deriveApsrStatus, apsrReason } from "./simulateAI";
import { buildSystemPrompt, buildDomainBlock, type SkillCalibrationExample, type SkillCalibrationMemory } from "./skills";
import { domainExpertiseFor } from "../../data/skills/domainExpertise";
import type { AuditorProfile, PanelAuditorReview, PanelCallLog, PanelReviewPosition, PanelReviewResult, PanelSynthesis } from "../../types";
import { perspectiveOf, perspectiveLabel, perspectiveGuidance, detectPanelDisagreement } from "../reviewPanel";
import { normalizeAuditRef } from "../gd4Refs";
import { lineSufficiency, lineApsr } from "../checklistBanding";
import { isOptionANotAssessedNote } from "../optionAChecklistWrite";
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS } from "../../data/edutrustRubric";

// ─── Strict Structured Outputs schemas for every verdict-producing call ─────
// Each mirrors the response shape its prompt already describes — the schema
// changes HOW the reply is structured (guaranteed valid JSON, no drift),
// never WHAT the model is asked to assess. Reasoning/rationale fields are
// listed BEFORE verdict fields at every level (constrained decoding emits
// fields in schema order — the model must reason before it decides). The
// existing parse + quote/clause verification stays as defence in depth.

const ITEM_REVIEW_SCHEMA: ChatSchema = { name: "item_review", schema: sObj({
  justification: sStr, higherBand: sStr, confidence: sEnum("Low", "Medium", "High"),
}) };

const CLOSURE_REVIEW_SCHEMA: ChatSchema = { name: "closure_review", schema: sObj({
  reason: sStr, evidenceNeeded: sStr, verdict: sEnum("Acceptable", "Partial", "Maintain Finding", "Escalate"),
}) };

const PANEL_REVIEW_SCHEMA: ChatSchema = { name: "panel_review", schema: sObj({
  analysis: sStr, classification: sStr, severity: sStr, rootCauseDirection: sStr,
}) };

const STAGED_COVERAGE_SCHEMA: ChatSchema = { name: "staged_coverage", schema: sObj({
  results: sArr(sObj({ ref: sStr, note: sStr, chunkIds: sArr(sStr), covered: sEnum("Yes", "Partial", "No") })),
}) };

const STAGED_OUTCOME_SCHEMA: ChatSchema = { name: "staged_outcome_review", schema: sObj({
  results: sArr(sObj({ ref: sStr, note: sStr, chunkIds: sArr(sStr), outcomeEvident: sBool, reviewEvident: sBool })),
}) };

const apsrDim = (...statuses: string[]) => sObj({ note: sStr, sourceChunkIds: sArr(sStr), status: sEnum(...statuses) });
const FOLDER_AUDIT_SCHEMA: ChatSchema = { name: "folder_audit_batch", schema: sObj({
  lines: sArr(sObj({
    lineId: sStr,
    approach: apsrDim("Meeting", "Beginning", "Not evident"),
    processes: apsrDim("Deployed", "Weak", "Not evident"),
    systemsOutcomes: apsrDim("Evident", "Limited", "Not evident"),
    review: apsrDim("Evident", "Not evident"),
    overallReason: sStr,
    sources: sArr(sStr),
  })),
  folderWarnings: sArr(sStr),
}) };

const PPD_CONTRADICTION_SCHEMA: ChatSchema = { name: "ppd_contradictions", schema: sObj({
  contradictions: sArr(sObj({ description: sStr, quoteA: sStr, chunkA: sStr, quoteB: sStr, chunkB: sStr })),
}) };

// Holistic band suggestion (structured): each dimension reports the band its
// evidence best matches + a short reason that cites the requirement-line refs
// / file·chunk references already in the digest (never invents citations),
// then the ONE holistic overall band (a judgment, NOT the average of the four
// — no arithmetic) with the dimension(s) that limit it. Field order puts the
// four dimensions + limiting factor BEFORE the overall band so the model
// reasons across the columns before committing the holistic pick.
const bandEnum = sEnum("1", "2", "3", "4", "5");
const holisticDim = sObj({ reason: sStr, band: bandEnum });
const HOLISTIC_BAND_SCHEMA: ChatSchema = { name: "holistic_band", schema: sObj({
  approach: holisticDim, processes: holisticDim, systemsOutcomes: holisticDim, review: holisticDim,
  limitingFactor: sStr, band: bandEnum,
}) };

const EVIDENCE_ASSESSMENT_SCHEMA: ChatSchema = { name: "evidence_assessment", schema: sObj({
  results: sArr(sObj({
    ref: sStr, evidenceSummary: sStr, comment: sStr,
    promiseChecks: sArr(sObj({
      promiseText: sStr, evidence: sStr, chunkIds: sArr(sStr), quote: sStr, rationale: sStr, chunkId: sStr,
      verdict: sEnum("evidenced", "not evidenced", "contradicted"),
    })),
    verdict: sEnum("Met", "Partial", "Not met"),
    chunkIds: sArr(sStr), evidenceQuote: sStr, suggestedAction: sStr,
  })),
}) };

// ─── Two-pass extract-then-judge (Phase 2) ───────────────────────────────────
// Option A's PPD review and evidence assessment each run as TWO calls instead
// of one: Pass 1 (EXTRACT) reads the document and returns candidate passages
// only — no verdicts; every candidate is then verified deterministically
// (quoteExistsInSource / verifyClauseRef) and pooled across sliding windows.
// Pass 2 (JUDGE) never sees the document — it decides each line's verdict
// from the verified passages alone, ONCE per line (not once per window), so
// the old cross-window best-verdict merge and its ordering artifacts are gone.

// Verdict/comment self-consistency guard (both judges): the judge returns a
// verdict enum and freeform comment prose in ONE JSON response with nothing
// cross-checking them against each other. Confirmed on real exported data
// (run EV-6.3-MRHXOO1Y, line 6.3.1.DS1: evidenceVerdict "Partial" while the
// comment concluded "...this requirement is assessed as Met.") that the model
// can contradict itself this way — a genuine LLM self-contradiction, not a
// code bug. NOT dead / NOT speculative: this guard exists for that real case;
// keep it. (Flagged once in a cleanup audit — do not remove.) Literal substring patterns only
// (never fuzzy/semantic matching, per this project's conservative-matching
// rule), checked ONLY against the comment's last 300 characters (its
// concluding sentence(s)) so an earlier mid-comment mention — e.g. "this
// promise was not evidenced, but the requirement is nonetheless assessed as
// Met overall" — can't false-trigger on language that isn't the model's
// actual stated conclusion. Option A only (Evidence + PPD judges) — Option
// B's top-level verdict is derived deterministically from structured dimension
// data (see buildStagedApsr/apsrAuditNote below), so this class of
// contradiction cannot occur there by construction; do not wire this in there.
const POSITIVE_CONCLUSION_PATTERNS = ["assessed as met", "assessed as adequate", "fully satisfies", "fully meets", "fully evidenced"];
const NEGATIVE_CONCLUSION_PATTERNS = ["assessed as not met", "assessed as partial", "assessed as not documented", "not evidenced", "does not satisfy", "does not meet"];
function conclusionMismatch(isPositiveVerdict: boolean, comment: string): string | undefined {
  const tail = comment.slice(-300).toLowerCase();
  const positiveHit = POSITIVE_CONCLUSION_PATTERNS.find((p) => tail.includes(p));
  const negativeHit = NEGATIVE_CONCLUSION_PATTERNS.find((p) => tail.includes(p));
  if (isPositiveVerdict && negativeHit && !positiveHit) return negativeHit;
  if (!isPositiveVerdict && positiveHit && !negativeHit) return positiveHit;
  return undefined;
}

const PPD_EXTRACT_SCHEMA: ChatSchema = { name: "ppd_extract", schema: sObj({
  results: sArr(sObj({
    ref: sStr,
    candidates: sArr(sObj({ aspect: sStr, quote: sStr, clause: sStr, chunkId: sStr })),
    promises: sArr(sObj({ promiseText: sStr, sourceQuote: sStr, chunkId: sStr })),
  })),
}) };

// Judge output = the old single-pass row shape minus promises (extracted in
// Pass 1, not judged). Reasoning fields still precede verdicts (schema order).
const PPD_JUDGE_SCHEMA: ChatSchema = { name: "ppd_judge", schema: sObj({
  results: sArr(sObj({
    ref: sStr,
    subClauses: sArr(sObj({
      text: sStr, clause: sStr, quote: sStr,
      spreadQuotes: sArr(sObj({ quote: sStr, chunkId: sStr })),
      rationale: sStr, chunkId: sStr,
      verdict: sEnum("documented", "not documented"),
    })),
    shortComment: sStr, fullComment: sStr,
    verdict: sEnum("Adequate", "Partial", "Not documented"),
    suggestedRewrite: sStr,
    chunkIds: sArr(sStr),
    supportQuote: sStr,
  })),
}) };

const EVIDENCE_EXTRACT_SCHEMA: ChatSchema = { name: "evidence_extract", schema: sObj({
  results: sArr(sObj({
    ref: sStr,
    candidates: sArr(sObj({ aspect: sStr, quote: sStr, kind: sEnum("record", "policy"), chunkId: sStr })),
  })),
}) };

// Deterministic Met/Partial boundary rules for the requirement-line patterns
// the consistency baseline showed flip-flopping (3.1.1.DS1, 3.1.1.DS2.a/.f/.g,
// 3.1.1.DS3.a/.b, 3.1.1.DS4, 6.3.1.DS1/.DS2/.DS3/.DS5, 6.1.1.DS2). Each rule
// generalises the requirement WORDING pattern — never any school's specific
// evidence, per the Tuning Advisor's own instruction. Exported so tests can
// pin their presence in the judge prompts.
export const PPD_BOUNDARY_RULES = `DETERMINISTIC BOUNDARY RULES — fixed rules for recurring line patterns. They OVERRIDE general judgement: identical passages must always produce the identical verdict.
1. REVIEW lines ("Review the [X] process/procedures for continual improvement"): "Adequate" ONLY when a passage names (i) who reviews THAT specific process (role/committee) AND (ii) a frequency or trigger for the review. A generic whole-of-PPD review clause ("all policies are reviewed annually") that does not name this process = "Partial". No review passage at all = "Not documented".
2. CONTRACT-CONTENT lines (one named term the agent contract must cover — e.g. contract period, service performance indicators, actions on breach and termination conditions): "Adequate" ONLY when a passage explicitly requires or states THAT term. The term addressed but incompletely (e.g. actions on breach without termination conditions; "performance will be monitored" without named indicators) = "Partial". Passages about agent contracts that never state the term (e.g. "agreements will be signed with all agents") = "Not documented" for that term.
3. REGISTER/LIST-FIELD lines (one named field an agent list/register must record — e.g. countries of recruitment, contract start and end dates): "Adequate" ONLY when a passage requires the register/list to record THAT field. A register/list requirement that omits the field = "Partial". No register/list requirement at all = "Not documented".
4. MECHANISM lines ("Encourage/facilitate…", "Implement…", "Invest in…"): "Adequate" ONLY when a passage names a concrete mechanism (WHAT is done), an owner (WHO), and — where the obligation is recurring — a frequency. Stated intent without a named mechanism ("the PEI is committed to continual improvement") = "Partial". Nothing on the topic = "Not documented".
5. MULTI-PART lines (several obligations joined in one line, e.g. "identify, select and appoint agents… including setting selection criteria and Management approval"): decompose into ALL named parts and verdict each; "Adequate" requires EVERY part documented — including any named approval authority (a selection process whose approver is not the named authority level leaves that part missing). Any missing part = "Partial", naming it.
6. SINGLE-CLAUSE CONTRACT SAFEGUARD lines (one specific protective clause the agent contract must contain — the provisions applying the laws of Singapore to the contract; the non-collection of monies from students beyond the permitted fees/commission): BINARY. "Adequate" ONLY when the PPD or contract template contains the explicit clause (an explicit governing-law provision naming Singapore; an explicit prohibition on collecting other monies from students). Anything less — a general legal-compliance statement, conduct text that never states the prohibition — is "Not documented" for this line, never "Partial". Do not credit adjacent topics.
7. ROLES-PLUS-NAMED-DUTY lines ("roles and responsibilities, including conducting pre-course counselling"): "Adequate" ONLY when the contract/template sets out the agent's roles AND explicitly assigns the named duty (pre-course counselling, by name); roles documented without the named duty explicitly assigned = "Partial" — implicit coverage by a general roles clause does NOT count; neither roles nor the duty = "Not documented".
8. PAIRED-ARTIFACT lines ("terms of engagement and code of conduct"): exactly two parts — (i) terms of engagement in the contract, and (ii) a code of conduct that exists as a NAMED code/annex/schedule (behavioural expectations scattered through ordinary contract clauses are NOT a code of conduct). Both = "Adequate"; exactly one = "Partial"; neither = "Not documented".
9. SERVICE-PERFORMANCE-INDICATOR lines: named, measurable indicators (or an explicit requirement that the contract set them) = "Adequate"; any passage committing to monitor/review/evaluate agent performance WITHOUT named indicators = "Partial"; no passage about agent performance at all = "Not documented".
10. AFI/CAP PROCESS lines ("compiling all strengths and Areas for Improvement (AFIs) and developing Corrective Action Plans (CAPs) for all AFIs"; "defining the owners and completion timelines for all CAPs"): "Adequate" ONLY when the PPD commits to the FULL obligation (compiling line: results compiled covering BOTH strengths and AFIs, AND a CAP for EVERY AFI; owners/timelines line: EVERY CAP carries an owner AND a completion timeline). FLOOR: if ANY passage addresses recording assessment results, AFIs, corrective actions or CAPs — however incompletely — the verdict is at least "Partial"; "Not documented" ONLY when no passage touches any of these artifacts.
11. REVIEW-LINE FLOOR (supplements rule 1, changing nothing above): "Not documented" on a review line requires NO review passage of ANY scope that would cover this process; a generic clause reviewing all policies/procedures (whose scope would include this one) = "Partial", never "Not documented". A review of a DIFFERENT specific process does not count at all.`;

export const EVIDENCE_BOUNDARY_RULES = `DETERMINISTIC EVIDENCE RULES for recurring line patterns — they fix what "an actual implementation record supports the requirement" means (rule 4b): identical records must always produce the identical verdict.
- REVIEW lines: only a dated record OF a review of that specific process (minutes, or a review report with decisions/changes) counts. A policy stating that reviews happen counts for nothing here.
- CONTRACT-CONTENT lines: only an executed contract (or contract register entry) actually showing that term counts.
- REGISTER/LIST-FIELD lines: only a current register/list actually showing that field populated counts.
- MECHANISM lines: only a dated record of the mechanism having run (minutes, log entries, completed forms, published outputs) counts.
- CONTRACT-TERM and CONTRACT-SAFEGUARD lines are judged across ALL provided signed agent contracts: the term/clause present in EVERY provided signed contract = evidenced/"Met" for that check; present in some but not all = "Partial" (state the count); in none = "Not met". The signed contract containing the explicit safeguard clause (governing law of Singapore; non-collection prohibition) IS the implementation record for that line — never demand transaction-level proof of a negative (e.g. proof that no monies were ever collected); the signed prohibition is the record.
- ROLES-PLUS-NAMED-DUTY lines: "Met" only when the signed contracts explicitly assign the named duty (pre-course counselling); a general roles clause without the named duty = "Partial".
- PAIRED-ARTIFACT lines ("terms of engagement and code of conduct"): both present in the signed contract set (a named code counts whether embedded or a signed annex) = "Met"; exactly one = "Partial"; neither = "Not met".
- REGISTER-FIELD lines: "Met" only when the current register/list records the field for EVERY listed agent; recorded for some but not all = "Partial" (state how many lack it); the field absent from the register entirely = "Not met".
- AFI/CAP PROCESS lines: "Met" = an internal assessment output compiling BOTH strengths and AFIs plus CAPs covering EVERY AFI (or, for the owners/timelines line, EVERY CAP showing an owner AND a timeline); "Partial" = the artifacts exist but incomplete (CAPs for only some AFIs; strengths or AFIs missing from the compilation; some CAPs lacking an owner or timeline); "Not met" ONLY when no assessment report, AFI list or CAP record appears among the given passages at all.
- REVIEW-LINE FLOOR: a dated review record whose broader scope covers this process = "Partial" (not "Met", not "Not met"); "Not met" only when no review record of any covering scope exists.`;

export { AIClientError };

// Extracts the first valid JSON object from a model response (which may have
// preamble text before the object). Uses a non-greedy scan over brace depth
// to avoid the greedy-regex problem of matching the outermost { to the last }
// when the response contains multiple objects.
function extractFirstJSONObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJSONObject(text: string, requiredKeys?: string[]): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (requiredKeys && requiredKeys.some((k) => !(k in v))) return null;
        return v as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    return null;
  };
  return tryParse(text) ?? (extractFirstJSONObject(text) ? tryParse(extractFirstJSONObject(text)!) : null) ?? {};
}

export async function runLiveItemReview(
  agent: AgentDefinition,
  item: { id: string; eff: number; band: number; checklistOverride: boolean },
  ev: ItemEvidence,
  settings: AISettings
): Promise<Omit<SimulatedItemVerdict, "live"> & { live: true; usage?: AIUsage }> {
  const itemDomainSkill = domainExpertiseFor(item.id);
  const system = `You are ${agent.name}, an EduTrust GD4 internal audit review agent with focus area "${agent.focus}". You assist a human auditor and never decide the official GD4 score or band yourself — that figure is fixed by the workspace's scoring engine (sourced from the Sub-Criterion Checklist outcome where one exists, otherwise from the evidence matrix below) and given to you here; you must not contradict it or imply a different one. Your tone must match that fixed band exactly: never use positive, encouraging or reassuring language when the band is low, when any evidence limb below is "Missing", or when the Drive evidence link is absent — in every such case you must name the gap plainly instead of softening it. A missing Drive evidence link is itself a real gap to call out even if the four evidence limbs look strong, because it means the human auditor cannot actually verify the evidence. Write a short, specific justification (2-3 sentences) referencing only the evidence given, and one concrete recommendation for reaching a higher band. Respond with JSON only: {"justification": string, "higherBand": string, "confidence": "Low" | "Medium" | "High"}.${buildSystemPrompt("bandRecommend", null, "runLiveItemReview", item.id, itemDomainSkill)}${buildDomainBlock(itemDomainSkill)}`;
  const user = `Item ${item.id}. Fixed evidence score: ${item.eff}/100, fixed band: ${item.band} (source: ${item.checklistOverride ? "Sub-Criterion Checklist outcome" : "evidence matrix quick rating"}). Evidence: approach=${ev.approach}, processes=${ev.processes}, systemsOutcomes=${ev.systemsOutcomes}, review=${ev.review}, traceability=${ev.trace}%, evidence age=${ev.age} days, owner=${ev.owner || "(unassigned)"}, Drive evidence link=${ev.drive ? ev.drive : "MISSING — no link has been provided"}.`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { schema: ITEM_REVIEW_SCHEMA, onUsage: (u) => { usage = u; } }
  );
  const parsed = parseJSONObject(content, ["justification", "higherBand", "confidence"]);

  return {
    score: item.eff,
    band: item.band,
    confidence: (parsed.confidence as Confidence) || "Medium",
    justification: (parsed.justification as string) || content,
    higherBand: (parsed.higherBand as string) || "Add or strengthen the weakest evidence limb and re-run this review.",
    by: agent.name,
    live: true,
    usage,
  };
}

// ─── Holistic band suggestion (official EduTrust rubric, paragraph 23) ───────
// A JUDGMENT task, not a calculation: the model reads the item's per-line
// evidence digest against the verbatim official band table and returns, for
// EACH of the four dimensions, the band its evidence best matches + a short
// cited reason — then the ONE holistic overall band (a judgment across the
// columns, explicitly NOT the average of the four) and the dimension(s) that
// limit it. It never commits anything: the human accepts (or ignores) the
// suggestion on the checklist's rubric table. Deliberately separate from the
// per-line Met/Partial/Not-met machinery, which answers a different question.
export type HolisticDimensionAssessment = { band: Band; reason: string };
export type HolisticBandSuggestionResult = {
  band: Band; // the holistic overall pick — NOT an average of the four below
  dimensions: {
    approach: HolisticDimensionAssessment;
    processes: HolisticDimensionAssessment;
    systemsOutcomes: HolisticDimensionAssessment;
    review: HolisticDimensionAssessment;
  };
  // The four per-dimension scores, in the ApsrMatrixScores shape, so the
  // reviewer's APSR matrix can be auto-populated from the AI's first-pass
  // suggestion (the human accepts or overrides — this IS the official input
  // now, not a side diagnostic).
  dimensionBands: ApsrWorkingScores;
  limitingFactor: string; // which dimension(s) hold the total down
  // Human-readable summary composed from the structured output above — this
  // is what fills the mandatory justification when the human accepts the AI's
  // own band (it cites all four dimensions, satisfying the requirement).
  rationale: string;
  // Note: per-line dimension TAGGING is no longer done by the AI. It proved
  // unreliable (all-Review on review-themed items); the accept flow now tags
  // lines deterministically by content (classifyApsrByContent in
  // checklistBanding.ts). The AI here only scores/diagnoses the dimensions.
  promptSent?: string;
};

function buildBandEvidenceDigest(specific: SpecificChecklistLine[]): string {
  const graded = specific.filter((l) => l.status !== "Not Applicable");
  const lines = graded.map((l) => {
    const suff = lineSufficiency(l);
    const apsr = lineApsr(l);
    // Surface the most INFORMATIVE real note, not the review note alone. The
    // old code appended only apsr.review.note, which for an Option A line is
    // ALWAYS the "not assessed by Option A" boilerplate — so every line's
    // digest entry featured Review + a note while the actual assessment
    // (Approach from the PPD verdict, Processes from the evidence verdict)
    // stayed hidden. That biased the line-dimension classifier toward Review.
    // Prefer the notes that carry real assessment; drop the not-assessed
    // sentinel entirely so it never nudges the classification.
    const realNote = apsr
      ? [apsr.approach.note, apsr.processes.note, apsr.systemsOutcomes.note, apsr.review.note]
          .find((n) => n && !isOptionANotAssessedNote(n))
      : undefined;
    const apsrPart = apsr
      ? ` | APSR: Approach ${apsr.approach.status}; Processes ${apsr.processes.status}; Systems&Outcomes ${apsr.systemsOutcomes.status}; Review ${apsr.review.status}${realNote ? ` (${realNote.slice(0, 160)})` : ""}`
      : "";
    return `- [${l.clause || l.sourceRef || "manual"}] ${l.text.slice(0, 180)} → status: ${l.status || "Not Started"}; evidence: ${suff}${apsrPart}`;
  });
  const na = specific.length - graded.length;
  return `${lines.join("\n")}${na > 0 ? `\n(${na} line(s) marked Not Applicable — excluded)` : ""}`.slice(0, 9000);
}

function officialBandTableBlock(): string {
  return EDUTRUST_BANDS.map((b) =>
    `Band ${b.band} — ${b.name}\n  Approach: ${b.approach}\n  Processes: ${b.processes}\n  Systems & Outcomes: ${b.systemsOutcomes}\n  Review: ${b.review}`
  ).join("\n") + "\n\nDimension definitions:\n" + EDUTRUST_DIMENSIONS.map((d) => `  ${d.label}: ${d.definition}`).join("\n");
}

export async function runHolisticBandSuggestion(
  req: GD4Requirement,
  specific: SpecificChecklistLine[],
  settings: AISettings,
  opts?: { memories?: SkillCalibrationMemory[]; onUsage?: (u: AIUsage) => void }
): Promise<HolisticBandSuggestionResult> {
  const domainSkill = domainExpertiseFor(req.id);
  const system = `You are a GD4 EduTrust assessor placing ONE sub-criterion item in a band using the OFFICIAL rubric from the EduTrust Guidance Document v4 (Jan 2025), paragraph 23, quoted verbatim below.

OFFICIAL BAND TABLE (verbatim):
${officialBandTableBlock()}

Do TWO things:
1. DIAGNOSE each of the four dimensions (Approach, Processes, Systems & Outcomes, Review) SEPARATELY: for each, say which band level (1–5) its own evidence best matches, and a SHORT reason. The reason MUST cite the evidence it relies on using the references already present in the digest — the requirement-line ref (e.g. "6.2.1.DS1") and any "file · chunk" reference shown in a line's APSR note. Never invent a citation or a record not in the digest; missing/weak evidence reads DOWN per the descriptors.
2. JUDGE the ONE holistic overall band for the whole item. This is a judgment reading the four descriptors of a level together — it is NOT the average, sum, or any calculation of the four dimension bands above. It may sit below the strongest dimension when a weak dimension limits the whole (the official rubric's descriptors gate this way). State which dimension(s) are the limiting factor for your holistic pick.

Rules:
- Every band is 1 to 5.
- A suggestion, not a decision — a human reviewer makes the final call.
Respond with JSON only: {"approach": {"reason": string, "band": "1".."5"}, "processes": {...}, "systemsOutcomes": {...}, "review": {...}, "limitingFactor": string, "band": "1".."5"}.${buildSystemPrompt("bandRecommend", null, "runHolisticBandSuggestion", req.id, domainSkill, undefined, opts?.memories)}${buildDomainBlock(domainSkill)}`;
  const user = `GD4 item ${req.id}: "${req.requirement}"${req.gateSensitive ? " (gate-sensitive)" : ""}.

Per-requirement-line evidence digest (status from the audits/reviewer, evidence sufficiency, per-line APSR notes with any file·chunk citations where a live audit recorded them):
${buildBandEvidenceDigest(specific) || "(no checklist lines exist yet — there is nothing on file for this item)"}

Diagnose each dimension, then place this item in ONE holistic official band.`;

  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { schema: HOLISTIC_BAND_SCHEMA, onUsage: opts?.onUsage }
  );
  const parsed = parseJSONObject(content, ["approach", "processes", "systemsOutcomes", "review", "band"]);
  const toBand = (v: unknown, where: string): Band => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Band suggestion returned an invalid band for ${where} (${String(v)}).`);
    return n as Band;
  };
  const readDim = (key: string): HolisticDimensionAssessment => {
    const d = (parsed[key] ?? {}) as Record<string, unknown>;
    const reason = String(d.reason || "").trim();
    if (!reason) throw new Error(`Band suggestion returned no reason for ${key}.`);
    return { band: toBand(d.band, key), reason };
  };
  const dimensions = {
    approach: readDim("approach"),
    processes: readDim("processes"),
    systemsOutcomes: readDim("systemsOutcomes"),
    review: readDim("review"),
  };
  const band = toBand(parsed.band, "overall");
  const limitingFactor = String(parsed.limitingFactor || "").trim();
  const dimensionBands: ApsrWorkingScores = {
    approach: dimensions.approach.band,
    processes: dimensions.processes.band,
    systemsOutcomes: dimensions.systemsOutcomes.band,
    review: dimensions.review.band,
  };
  // Composed justification (satisfies the mandatory-rationale requirement when
  // the human accepts the AI's own band): names each dimension's band + the
  // limiting factor — no arithmetic, just the structured judgment in prose.
  const dimLabel: Record<string, string> = { approach: "Approach", processes: "Processes", systemsOutcomes: "Systems & Outcomes", review: "Review" };
  const rationale =
    (Object.keys(dimensions) as (keyof typeof dimensions)[])
      .map((k) => `${dimLabel[k]}: Band ${dimensions[k].band} — ${dimensions[k].reason}`)
      .join(" ") +
    ` Overall: Band ${band}${limitingFactor ? ` (limiting factor: ${limitingFactor})` : ""}.`;
  return { band, dimensions, dimensionBands, limitingFactor, rationale, promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}` };
}

function extractFirstJSONArray(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "]") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJSONArray(text: string): unknown[] {
  const tryArr = (s: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as Record<string, unknown>).lines)) return (parsed as Record<string, unknown>).lines as unknown[];
    } catch {
      // fall through
    }
    return null;
  };
  return tryArr(text) ?? (extractFirstJSONArray(text) ? tryArr(extractFirstJSONArray(text)!) : null) ?? [];
}

// Result type for runLiveChecklistGeneration — valid lines plus a count of
// any AI-proposed lines that were rejected for lacking source traceability.
export type ChecklistGenerationResult = {
  lines: GeneratedChecklistLine[];
  rejectedCount: number;
  rejectedIdeas?: { text: string; reason: string }[];
  promptSent?: string;
};

// Converts a GD4 item's official text into traceable, testable checklist lines.
// The prompt is strict: the model must not invent requirements beyond the
// official Describe/Show, Notes and Expected Evidence supplied; every line must
// cite its exact GD4 source point so it can be displayed and validated.
// Lines returned by the model without a sourceText are rejected automatically
// (counted in rejectedCount) so invented lines never reach the checklist.
export async function runLiveChecklistGeneration(
  req: GD4Requirement,
  settings: AISettings,
  onUsage?: (u: AIUsage) => void
): Promise<ChecklistGenerationResult> {
  const VALID_SOURCE_TYPES: GeneratedChecklistLine["sourceType"][] = ["describeShow", "note", "expectedEvidence", "requirement", "intent"];
  const VALID_APSR: GeneratedChecklistLine["apsrDimension"][] = ["Approach", "Processes", "Systems & Outcomes", "Review"];

  const system = `You are converting official GD4 EduTrust item text into traceable, testable audit checklist lines. You are NOT creating a new audit checklist from scratch. Every line you generate MUST be directly supported by one official source point provided in the prompt, identified by its ref (e.g. "1.1.1.DS1.a"). If you cannot point to the exact source point, do not create the line.

STRICT RULES — violations cause your output to be discarded:
1. Do NOT invent requirements that do not appear in the official source points provided.
2. Do NOT add generic internal-audit checks (e.g. "check if the process is effective").
3. Do NOT add "good practice" items unless those exact words appear in the official GD4 wording.
4. Do NOT infer extra requirements from PEI context or your general knowledge.
5. The text field of each checklist line must use the exact wording from the source point — word for word. Do NOT rephrase, summarise, or rewrite. Copy the source text directly into the text field. The only permitted prefix is "Verify that:" or "Confirm evidence of:" when it aids clarity, but the remainder must be verbatim source text.
6. Avoid creating multiple nearly-identical lines for the same source point; one clear line per source point.
7. The sourceRef must be the exact ref string from the source point (e.g. "1.1.1.DS1.a"). The sourceText must contain verbatim text from that source point. Empty sourceText or sourceRef invalidates the line.

APSR dimension classification:
- Approach: documented policy, procedure, plan, framework, method, responsibility, workflow
- Processes: implementation records, logs, forms, screenshots, registers, actual use of the process
- Systems & Outcomes: results, KPIs, trends, targets, outcomes, performance data, analysis
- Review: review records, minutes, evaluation, improvement actions, effectiveness review

Also list any ideas you considered and rejected in rejectedIdeas with the reason.

Respond with JSON only (no preamble):
{"lines": [{"text": string, "clause": string, "sourceRef": string, "sourceType": "describeShow"|"note"|"expectedEvidence", "sourceText": string, "apsrDimension": "Approach"|"Processes"|"Systems & Outcomes"|"Review"}], "rejectedIdeas": [{"text": string, "reason": string}]}${buildSystemPrompt("checklistScoring", null, "runLiveChecklistGeneration", req.id, domainExpertiseFor(req.id))}${buildDomainBlock(domainExpertiseFor(req.id))}`;

  // Build the source points list. Use flatAuditPoints when available so the AI
  // sees the same granular sub-items that the offline fallback uses; otherwise
  // fall back to the flat DS/EE/Notes arrays.
  const sourceBlock =
    req.flatAuditPoints && req.flatAuditPoints.length > 0
      ? req.flatAuditPoints
          .map((p) => {
            const prefix =
              p.sourceType === "describeShow"
                ? "DS"
                : p.sourceType === "expectedEvidence"
                  ? "EE"
                  : "N";
            const label = p.parentText ? `${p.parentText} → ${p.text}` : p.text;
            return `${prefix}:${p.ref}. ${label}`;
          })
          .join("\n")
      : [
          ...req.describeShow.map((d, i) => `DS:${req.id}.DS${i + 1}. ${d}`),
          ...req.expectedEvidence.map((e, i) => `EE:${req.id}.EE${i + 1}. ${e}`),
          ...req.notes.map((n, i) => `N:${req.id}.N${i + 1}. ${n}`),
        ].join("\n");

  const user = `GD4 item ${req.id} — ${req.requirement}

Intent: ${req.intent}

Official source points (each line = one auditable requirement; ref = official GD4 reference):
${sourceBlock}${req.gateSensitive ? "\n\nNote: This item is gate-sensitive — a minimum Band 3 average applies to this sub-criterion under the official GD4 standard. Lines must be especially precise and unambiguous." : ""}`;

  // Generative (fixed, ignores verdictTemperature): this GENERATES checklist
  // lines from requirement text — a bit of variation helps phrase distinct
  // testable lines. Not a Met/Partial verdict, and not exercised by the
  // consistency test (scratch runs assess flatAuditPoints directly).
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { temperature: 0.3, onUsage }
  );

  const parsed = parseJSONObject(content);
  const rawLines = Array.isArray(parsed.lines) ? (parsed.lines as unknown[]) : [];
  const rawRejected = Array.isArray(parsed.rejectedIdeas) ? (parsed.rejectedIdeas as unknown[]) : [];

  const lines: GeneratedChecklistLine[] = [];
  rawLines.forEach((x) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const sourceText = typeof r.sourceText === "string" ? r.sourceText.trim() : "";
    const sourceType = VALID_SOURCE_TYPES.includes(r.sourceType as GeneratedChecklistLine["sourceType"])
      ? (r.sourceType as GeneratedChecklistLine["sourceType"])
      : null;
    const apsrDimension = VALID_APSR.includes(r.apsrDimension as GeneratedChecklistLine["apsrDimension"])
      ? (r.apsrDimension as GeneratedChecklistLine["apsrDimension"])
      : null;
    const sourceRef = typeof r.sourceRef === "string" ? r.sourceRef.trim() : "";
    // Reject any line the model produced without a valid sourceText, sourceType, sourceRef or apsrDimension.
    if (!text || !sourceText || !sourceType || !apsrDimension || !sourceRef) return;
    // Derive originalIndex from sourceRef (e.g. "1.1.1.DS2" → index 1; sub-items "1.1.1.DS1.a" → null)
    const dsSimple = /\.DS(\d+)$/.exec(sourceRef);
    const eeSimple = /\.EE(\d+)$/.exec(sourceRef);
    const nSimple = /\.N(\d+)$/.exec(sourceRef);
    const derivedIndex = dsSimple
      ? parseInt(dsSimple[1], 10) - 1
      : eeSimple
        ? parseInt(eeSimple[1], 10) - 1
        : nSimple
          ? parseInt(nSimple[1], 10) - 1
          : null;
    lines.push({
      text: text.endsWith(".") ? text : `${text}.`,
      clause: typeof r.clause === "string" && r.clause ? r.clause : `GD4 ${sourceRef}`,
      sourceType,
      sourceIndex: derivedIndex,
      sourceText,
      apsrDimension,
      sourceRef,
    });
  });

  const rejectedCount = rawLines.length - lines.length;
  const rejectedIdeas = rawRejected
    .filter((r): r is Record<string, string> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string")
    .map((r) => ({ text: r.text, reason: r.reason || "Not directly supported by official GD4 wording" }));

  return { lines, rejectedCount, rejectedIdeas, promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}` };
}

export async function runLiveClosureReview(
  closure: { root?: string; corr?: string; prev?: string; evid?: string },
  settings: AISettings,
  calibration?: SkillCalibrationExample[],
  criterionId?: string
): Promise<Omit<SimulatedClosureVerdict, "live"> & { live: true; usage?: AIUsage }> {
  // Closure review previously got NO criterion specialist knowledge — the one
  // reviewer deciding whether a fix is adequate judged it generically. Inject
  // the same domain block every other per-item call gets.
  const domainSkill = domainExpertiseFor(criterionId);
  const domainBlock = buildDomainBlock(domainSkill);
  const system = `You are the Closure Reviewer Agent for an EduTrust GD4 internal audit. Assess whether a corrective/preventive action closure is Acceptable, Partial, should Maintain Finding, or should Escalate, using only the narrative given — never assume evidence that wasn't described, and never let well-written narrative substitute for missing evidence. If no closure evidence link is provided, you must return "Maintain Finding" regardless of how complete or convincing the narrative sounds. Respond with JSON only: {"verdict": "Acceptable" | "Partial" | "Maintain Finding" | "Escalate", "reason": string, "evidenceNeeded": string}.${buildSystemPrompt("afiClosure", null, "runLiveClosureReview", criterionId, domainSkill, calibration)}${domainBlock}`;
  const user = `Root cause: ${closure.root || "(none provided)"}\nCorrective action: ${closure.corr || "(none provided)"}\nPreventive action: ${closure.prev || "(none provided)"}\nClosure evidence link: ${closure.evid || "(none provided — no evidence is linked)"}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { schema: CLOSURE_REVIEW_SCHEMA, onUsage: (u) => { usage = u; } }
  );
  const parsed = parseJSONObject(content);

  // Hard guardrail mirroring simulateClosure's rule in simulateAI.ts: a
  // missing closure evidence link forces "Maintain Finding" regardless of
  // what the model returned, the same way the score/band for item review is
  // never left to the model alone.
  if (!closure.evid) {
    return {
      verdict: "Maintain Finding",
      reason: "No closure evidence linked, so the finding stands regardless of the narrative.",
      evidenceNeeded: (parsed.evidenceNeeded as string) || "Link the evidence that supports this closure.",
      live: true,
      usage,
    };
  }

  return {
    verdict: (parsed.verdict as SimulatedClosureVerdict["verdict"]) || "Maintain Finding",
    reason: (parsed.reason as string) || content,
    evidenceNeeded: (parsed.evidenceNeeded as string) || "Specify the evidence still needed.",
    live: true,
    usage,
  };
}

// Automation: drafts a root cause + corrective + preventive action for a
// finding so the auditor starts from a first draft instead of a blank form.
// These are SUGGESTIONS to edit, never a closure — the prompt is explicit that
// they are proposals and the Closure Reviewer still requires real evidence to
// actually clear the finding.
export async function runLiveClosureDraft(
  finding: { issue: string; gd4ItemId: string },
  settings: AISettings,
  context?: { standard?: string; apsr?: string; calibration?: SkillCalibrationExample[] }
): Promise<{ root: string; corr: string; prev: string; usage?: AIUsage; promptSent?: string }> {
  const closureDomainSkill = domainExpertiseFor(finding.gd4ItemId);
  const system = `You are an EduTrust GD4 quality-action assistant. Given an audit finding (and, where provided, the official GD4 requirement it relates to and the APSR breakdown of which rubric dimension fell short), propose: a ROOT CAUSE that names WHY the gap exists — use the 5-Why methodology to reach the systemic level (Level 3): distinguish an Approach gap (policy/procedure missing or too generic) from a Processes gap (documented but not implemented) from a Systems & Outcomes gap (no desired outcomes produced) from a Review gap (no evaluation for continual improvement) — name the governance, training, data-collection, or review gap as the root cause, not the symptom — then a CORRECTIVE action that fixes this specific gap now (time-bound, names the record/document and responsible role), and a PREVENTIVE action that changes the system so the gap cannot recur (must be different from the corrective action — a new checkpoint, policy section, or standing review item). Be concrete and specific to the requirement; reference the actual evidence/records that should exist. These are draft suggestions the auditor will edit and must still evidence — do not claim the finding is closed. Respond with JSON only: {"root": string, "corr": string, "prev": string}.${buildSystemPrompt("afiClosure", null, "runLiveClosureDraft", finding.gd4ItemId, closureDomainSkill, context?.calibration)}${buildDomainBlock(closureDomainSkill)}`;
  const user = `Finding (GD4 ${finding.gd4ItemId}): ${finding.issue}${context?.standard ? `\n\nOfficial GD4 requirement:\n${context.standard}` : ""}${context?.apsr ? `\n\nAPSR assessment of this line:\n${context.apsr}` : ""}`;
  // Higher temperature for drafting (natural, varied narrative) vs deterministic verdicts.
  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.7, onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["root", "corr", "prev"]);
  return {
    root: (parsed.root as string) || "",
    corr: (parsed.corr as string) || "",
    prev: (parsed.prev as string) || "",
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// Drafts evidence metadata from a pasted link for the Sub-Criterion
// Checklist's "AI fill from link" button. The model is given only the link
// string and the checklist line text — never the document itself, which
// this app has no way to fetch — so the prompt explicitly forbids inventing
// document content and requires the drafted note to flag what is unverified.
export async function runLiveEvidenceFill(
  link: string,
  lineText: string,
  settings: AISettings
): Promise<Omit<EvidenceFillDraft, "live"> & { live: true; usage?: AIUsage; promptSent?: string }> {
  const system = `You are an evidence intake assistant for an EduTrust GD4 internal audit. You are given only a document link/filename and the checklist line it is meant to support — you cannot open or read the document, so never assume or invent its content. Suggest plausible metadata from the link/filename alone, and draft a short auditor note (1-2 sentences) that explicitly tells the human auditor what they still need to verify themselves. Respond with JSON only: {"title": string, "type": "Policy/Procedure" | "Record/Log" | "System screenshot" | "Minutes" | "Survey/Feedback" | "Other", "date": string (YYYY-MM-DD, or "" when the date cannot be determined from the link/filename — NEVER guess a date), "sufficiency": "Present" | "Weak" | "Missing", "auditorNote": string}.${buildSystemPrompt("evidenceTracking", null, "runLiveEvidenceFill")}`;
  const user = `Evidence link: ${link}\nChecklist line this evidence is meant to support: ${lineText}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content);

  // Validate against the allowed set and default UNFAVOURABLY: a missing or
  // malformed sufficiency must never self-certify as "Present" (the only
  // favourable default in the app was here), and an unknown date stays blank
  // rather than being stamped with today (fabricated dates would feed the
  // evidence-timeliness checks).
  const sufficiency: EvidenceFillDraft["sufficiency"] =
    parsed.sufficiency === "Present" || parsed.sufficiency === "Weak" || parsed.sufficiency === "Missing"
      ? parsed.sufficiency : "Missing";
  const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : "";
  return {
    title: (parsed.title as string) || link,
    type: (parsed.type as string) || "Other",
    date,
    sufficiency,
    auditorNote: (parsed.auditorNote as string) || `Verify this evidence actually demonstrates: "${lineText}".`,
    live: true,
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// Drives the Evidence Folder page's "Run audit" action once real Drive text
// has been extracted (see lib/drive/driveClient.ts and
// useWorkspaceStore.auditFolderContents). Unlike every other live function
// in this file, the model genuinely is given real document content here —
// the honesty constraint becomes the opposite one: it must judge each line
// ONLY against the text actually provided, not invent or assume anything
// about parts of the folder that weren't readable/exported.
const STRICTNESS_CLAUSE: Record<string, string> = {
  Lenient: " Calibration: give reasonable benefit of the doubt on each APSR dimension — if the documents broadly address it, lean towards the more favourable rating.",
  Standard: "",
  Strict:
    " Calibration: be conservative and hard to satisfy on every APSR dimension. Rate approach.status \"Meeting\" ONLY when the documented policy/procedure is genuinely specific, complete and sustainable; rate processes.status \"Deployed\" ONLY when records explicitly show it implemented; rate systemsOutcomes.status \"Evident\" ONLY when the desired outcomes are actually produced; rate review.status \"Evident\" ONLY when there is a real review for continual improvement. When in doubt, choose the lower rating — a high band must be genuinely earned.",
};

export type FolderAuditOpts = {
  strictness?: "Lenient" | "Standard" | "Strict";
  // The official GD4 requirement context for this sub-criterion (intent +
  // Describe/Show + Notes + expected evidence) so lines are judged against the
  // real standard, not just their own short wording.
  standard?: string;
  // The criterion / sub-criterion / item id this folder belongs to (e.g. "4.2"
  // or "4"). Used to inject the matching specialist domain-expertise skill so
  // the audit reasons like an auditor who specialises in that criterion.
  criterionId?: string;
  // When set, this is a second "challenge" pass: re-examine these prior
  // verdicts and downgrade any not fully and explicitly evidenced.
  challenge?: { lineId: string; status: string }[];
  // Called as each parallel audit batch completes so the UI can show live
  // batch progress ("Auditing batch 2 of 5"). current is 1-based.
  onBatchProgress?: (current: number, total: number) => void;
  // Calibration examples from the Human Decision Log to inject into the prompt.
  calibration?: SkillCalibrationExample[];
  memories?: SkillCalibrationMemory[];
};

// Wall-clock-safe ceiling on how much extracted document text is sent to one
// audit call. Shared with the store so its condense-to-fit pass targets the
// SAME budget — otherwise the store could condense to just over this and the
// audit would re-truncate (and show an alarming "files may be missing" note)
// even though every document was already read and summarised. ~32k chars is
// Store-level condensing budget (chars). The store pre-condenses documents to
// fit the whole folder into this limit before calling runLiveFolderAudit.
export const FOLDER_DOC_CAP = 60_000;

// Per-batch document budget (chars). Raised from 20k to 60k so the AI sees the
// full evidence folder rather than silently discarding the tail. Models with
// 128k context windows handle this comfortably; total input stays under ~20k tokens
// (system prompt ~5k + doc ~15k).
const BATCH_DOC_CAP = 60_000;

// Per-batch timeout. With 4 lines × 4 dims × ≤25-word notes ≈ 400 output
// tokens, a standard model finishes in ~15–40 s. 90 s leaves a generous buffer
// while still being short enough for the 1-retry strategy to recover transient
// slowdowns within a tolerable wall-clock window.
const AUDIT_BATCH_TIMEOUT_MS = 90_000;

// The two-pass JUDGE call (Option A PPD-review and evidence-assessment
// second pass) is the one call whose input GROWS with folder size: it
// receives every verified passage the extract pass pooled for the batch, so
// a large folder (measured: 6.1 Option A — 6 files incl. big oversight /
// mapping PDFs) pools enough passages that a single judge call blows past
// the flat 90 s ceiling. That timeout is caught honestly, but a run that
// times out looks (to a consistency test) indistinguishable from one that
// finished — the alternating "sometimes fast enough, sometimes not" pattern.
// Scale the judge ceiling with the pooled-passage prompt size, floored at
// the shared 90 s base (small folders wait no longer than before) and
// HARD-CAPPED so a runaway prompt still fails with the SAME honest timeout
// diagnostic rather than hanging forever — never a silent "unassessed".
// Extract calls keep the flat base: they are per-window, already bounded by
// WINDOW_SIZE, so their input does not grow with total folder size.
export const JUDGE_TIMEOUT_CAP_MS = 300_000; // 5 min hard cap
export function judgeTimeoutMs(promptChars: number): number {
  const scaled = AUDIT_BATCH_TIMEOUT_MS + Math.floor(promptChars / 10_000) * 30_000;
  return Math.min(JUDGE_TIMEOUT_CAP_MS, Math.max(AUDIT_BATCH_TIMEOUT_MS, scaled));
}

// ─── Auditor Review Panel ─────────────────────────────────────────────────────
// A panel of the user's own auditor profiles reviews one finding from their
// assigned perspectives, then a synthesis call combines them into one balanced
// conclusion that fills the closure scaffold. Reuses the base auditor skills +
// criterion skill; each call is logged to the AI Debug Log via buildSystemPrompt.

export type PanelFindingInput = {
  issue: string;
  gd4ItemId: string;
  clause?: string;
  observation?: string;
  criteria?: string;
  evidenceStatusSummary?: string;
  findingTypeLabel?: string;   // e.g. "NC (Major)"
  // Raw source text (evidence/PPD) if available, for quote verification.
  sourceText?: string;
  // The stable hash the store computed for cache invalidation.
  findingHash: string;
};

function strictnessWordFrom(n: number): "lenient" | "standard" | "strict" {
  return n >= 78 ? "strict" : n <= 45 ? "lenient" : "standard";
}

export async function runAuditorPanel(
  finding: PanelFindingInput,
  panel: AuditorProfile[],
  settings: AISettings,
  opts: { onProgress?: (detail: string) => void; signal?: AbortSignal; onUsage?: (u: AIUsage) => void } = {}
): Promise<PanelReviewResult> {
  const criterionId = finding.gd4ItemId;
  const domainSkill = domainExpertiseFor(criterionId);
  const domainBlock = buildDomainBlock(domainSkill);
  const findingBlock = [
    `Finding (GD4 ${finding.gd4ItemId}${finding.clause ? `, clause ${finding.clause}` : ""}): ${finding.issue}`,
    finding.findingTypeLabel ? `Current classification: ${finding.findingTypeLabel}` : "",
    finding.observation ? `Observation:\n${finding.observation}` : "",
    finding.criteria ? `What GD4 requires:\n${finding.criteria}` : "",
    finding.evidenceStatusSummary ? `Available / missing evidence:\n${finding.evidenceStatusSummary}` : "",
  ].filter(Boolean).join("\n\n");
  const verifyAgainst = [finding.sourceText, finding.observation, finding.criteria, finding.evidenceStatusSummary].filter(Boolean).join("\n");

  const warnings: string[] = [];
  const reviews: PanelAuditorReview[] = [];
  // Every AI sub-call, captured with its REAL input prompt (system + user) and
  // output so each is inspectable in the AI Review Log — not just the synthesis.
  const callLog: PanelCallLog[] = [];

  // One review call per panellist. A failed call is noted and skipped — the
  // synthesis proceeds from whoever succeeded, so one bad call never hangs
  // or aborts the panel.
  for (const auditor of panel) {
    if (opts.signal?.aborted) { warnings.push("Panel review cancelled before all auditors were consulted."); break; }
    const perspective = perspectiveOf(auditor);
    const label = perspectiveLabel(perspective);
    opts.onProgress?.(`${auditor.name} reviewing as ${label}…`);
    const strictness = strictnessWordFrom(auditor.strictness);
    const system = `You are ${auditor.name}, ${auditor.role || "an auditor"} on a GD4 EduTrust review panel${auditor.focusArea ? `, specialising in ${auditor.focusArea}` : ""}. You are reviewing ONE audit finding through a specific lens.

REVIEW PERSPECTIVE — ${label}: ${perspectiveGuidance(perspective)}

Apply a ${strictness} standard. Review the finding ONLY through your perspective above — do not try to cover every angle; the panel's other members cover theirs. Base every point on the finding text and the stated evidence; do not invent documents or quote anything not present. Use neutral, factual language (state what exists or is absent; do not use praise words). Keep the analysis to 3-6 sentences.

Also state your STRUCTURED POSITION so the panel can detect disagreement:
- classification: the type you would assign — one of "NC", "OFI", "Observation" or "No issue".
- severity: "Major", "Minor" or "None".
- rootCauseDirection: one short phrase naming the direction — one of documentation, process, training, data, review, or none.

Respond with JSON only: {"analysis": string, "classification": string, "severity": string, "rootCauseDirection": string}.${buildSystemPrompt("findingWriter", null, `runAuditorPanel · ${auditor.name} (${label})`, criterionId, domainSkill)}${domainBlock}`;
    try {
      let callUsage: AIUsage | undefined;
      const content = await chatComplete(
        [{ role: "system", content: system }, { role: "user", content: findingBlock }],
        settings,
        { schema: PANEL_REVIEW_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      const analysisRaw = typeof parsed.analysis === "string" && parsed.analysis.trim() ? parsed.analysis.trim() : content.trim();
      const analysis = verifyAgainst ? flagUnverifiedQuotes(analysisRaw, verifyAgainst) : analysisRaw;
      const ps = (k: string) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "");
      const position: PanelReviewPosition = {
        classification: ps("classification"),
        severity: ps("severity"),
        rootCauseDirection: ps("rootCauseDirection"),
      };
      reviews.push({ auditorId: auditor.id, auditorName: auditor.name, perspective, perspectiveLabel: label, analysis, position });
      callLog.push({
        kind: "round1",
        label: `Panel · ${auditor.name} · ${label} · Round 1`,
        promptSent: `SYSTEM:\n${system}\n\nUSER:\n${findingBlock}`,
        output: content,
        verdict: position.classification ? `${position.classification}${position.severity && position.severity.toLowerCase() !== "none" ? ` (${position.severity})` : ""}` : "Reviewed",
        usage: callUsage,
      });
    } catch (err) {
      if (opts.signal?.aborted) { warnings.push("Panel review cancelled mid-run."); break; }
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`${auditor.name} (${label}) review failed — ${msg}. Synthesised from the remaining panellists.`);
      reviews.push({ auditorId: auditor.id, auditorName: auditor.name, perspective, perspectiveLabel: label, analysis: "", failed: true, error: msg });
      callLog.push({
        kind: "round1",
        label: `Panel · ${auditor.name} · ${label} · Round 1`,
        promptSent: `SYSTEM:\n${system}\n\nUSER:\n${findingBlock}`,
        output: `Call failed — ${msg}`,
        verdict: "Call failed",
        failed: true,
      });
    }
  }

  // ── Round 2 — rebuttal (only when the Round-1 positions materially disagree).
  // Each surviving panellist is shown the OTHERS' Round-1 views and asked to
  // respond from their own lens: agree, challenge, or revise — and flag where
  // and why they disagree. Their perspective/strictness is unchanged.
  let discussionTriggered = false;
  const round1Usable = reviews.filter((r) => !r.failed && r.analysis);
  const disagreement = detectPanelDisagreement(reviews);
  if (disagreement.disagree && round1Usable.length >= 2 && !opts.signal?.aborted) {
    discussionTriggered = true;
    warnings.push(`Panellists disagreed, so a rebuttal round was held. ${disagreement.reasons.join(" ")}`);
    for (const auditor of panel) {
      if (opts.signal?.aborted) { warnings.push("Rebuttal round cancelled before all auditors responded."); break; }
      const review = reviews.find((r) => r.auditorId === auditor.id);
      if (!review || review.failed || !review.analysis) continue; // skip failed Round-1 panellists
      const others = round1Usable.filter((r) => r.auditorId !== auditor.id);
      if (others.length === 0) continue;
      const perspective = review.perspective;
      const label = review.perspectiveLabel;
      opts.onProgress?.(`${auditor.name} responding to the panel as ${label}…`);
      const strictness = strictnessWordFrom(auditor.strictness);
      const othersDigest = others.map((r) => {
        const pos = r.position ? ` (position: ${r.position.classification || "—"} / ${r.position.severity || "—"} / ${r.position.rootCauseDirection || "—"})` : "";
        return `[${r.auditorName} — ${r.perspectiveLabel}]${pos}\n${r.analysis}`;
      }).join("\n\n");
      const rebSystem = `You are ${auditor.name}, ${auditor.role || "an auditor"} on a GD4 EduTrust review panel${auditor.focusArea ? `, specialising in ${auditor.focusArea}` : ""}. You already gave your independent view of ONE finding. The panel disagreed, so you are now in a discussion round.

REVIEW PERSPECTIVE — ${label}: ${perspectiveGuidance(perspective)}

Apply a ${strictness} standard and KEEP your perspective. Read the other panellists' views below and respond from your own lens: state clearly where you AGREE, where you CHALLENGE them (and why), and whether you REVISE any part of your own position. Explicitly name the points of disagreement. Do not simply repeat your first review and do not adopt another lens. Base every point on the finding text and stated evidence; do not invent documents. Keep it to 3-6 sentences.

Respond with JSON only: {"rebuttal": string}.${buildSystemPrompt("findingWriter", null, `runAuditorPanel · rebuttal · ${auditor.name} (${label})`, criterionId, domainSkill)}${domainBlock}`;
      const rebUser = `The finding under review:\n${findingBlock}\n\nYour Round-1 view:\n${review.analysis}\n\nThe other panellists' Round-1 views:\n${othersDigest}\n\nRespond to the panel.`;
      try {
        let callUsage: AIUsage | undefined;
        const content = await chatComplete(
          [{ role: "system", content: rebSystem }, { role: "user", content: rebUser }],
          settings,
          { temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const rebRaw = typeof parsed.rebuttal === "string" && parsed.rebuttal.trim() ? parsed.rebuttal.trim() : content.trim();
        review.rebuttal = verifyAgainst ? flagUnverifiedQuotes(rebRaw, verifyAgainst) : rebRaw;
        callLog.push({
          kind: "rebuttal",
          label: `Panel · ${auditor.name} · ${label} · rebuttal`,
          promptSent: `SYSTEM:\n${rebSystem}\n\nUSER:\n${rebUser}`,
          output: content,
          verdict: "Rebuttal",
          usage: callUsage,
        });
      } catch (err) {
        if (opts.signal?.aborted) { warnings.push("Rebuttal round cancelled mid-run."); break; }
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${auditor.name} (${label}) rebuttal failed — ${msg}. Synthesised from their Round-1 view.`);
        callLog.push({
          kind: "rebuttal",
          label: `Panel · ${auditor.name} · ${label} · rebuttal`,
          promptSent: `SYSTEM:\n${rebSystem}\n\nUSER:\n${rebUser}`,
          output: `Call failed — ${msg}`,
          verdict: "Call failed",
          failed: true,
        });
      }
    }
  }

  const usable = reviews.filter((r) => !r.failed && r.analysis);
  const emptySynthesis: PanelSynthesis = {
    summary: "The panel could not be synthesised — every panellist review failed. Re-run the panel once the AI connection is restored.",
    riskImpact: "", rootCause: "", immediateCorrection: "", correctiveAction: "", evidenceForClosure: "", finalClassification: "",
  };

  let synthesis = emptySynthesis;
  if (usable.length > 0 && !opts.signal?.aborted) {
    opts.onProgress?.("Synthesising the panel's conclusion…");
    const panelDigest = usable.map((r) => {
      const base = `[${r.auditorName} — ${r.perspectiveLabel}]\n${r.analysis}`;
      return r.rebuttal ? `${base}\nAfter discussion: ${r.rebuttal}` : base;
    }).join("\n\n");
    const synthSystem = `You are the chair of a GD4 EduTrust audit review panel. You are given several panellists' reviews of ONE finding, each from a different perspective (strict auditor, process owner, risk challenger, academic/QA guardian, management reviewer)${discussionTriggered ? ", along with their post-discussion responses after a rebuttal round in which they disagreed" : ""}. Combine them into ONE balanced, evidence-based conclusion — reconcile the disagreement, weigh the post-discussion views, do not overstate, and do not simply repeat each panellist.

The ROOT CAUSE must name a SYSTEM or PROCESS cause (a governance, documentation, training, data-collection or review gap) — never "human error", "forgot", "poor communication" or blame of an individual.

Respond with JSON only, all fields plain text:
{"summary": "Balanced Finding Summary", "riskImpact": "Risk / Impact", "rootCause": "system/process root cause", "immediateCorrection": "Immediate Correction", "correctiveAction": "Corrective Action", "evidenceForClosure": "Evidence Required for Closure", "finalClassification": "MUST start with exactly one of: NC (Major), NC (Minor), OFI, OBS — followed by an em-dash and a brief justification, no overstatement. Use no other classification word (no CAR, no improvement)."}.${buildSystemPrompt("afiClosure", null, "runAuditorPanel · synthesis", criterionId, domainSkill)}${domainBlock}`;
    const synthUser = `The finding under review:\n${findingBlock}\n\nPanellists' reviews:\n${panelDigest}\n\nWrite the panel's combined conclusion.`;
    try {
      let callUsage: AIUsage | undefined;
      const content = await chatComplete(
        [{ role: "system", content: synthSystem }, { role: "user", content: synthUser }],
        settings,
        { temperature: verdictTemp(settings), onUsage: (u) => { callUsage = u; opts.onUsage?.(u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const p = parseJSONObject(content);
      const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
      const vq = (t: string) => (verifyAgainst && t ? flagUnverifiedQuotes(t, verifyAgainst) : t);
      synthesis = {
        summary: vq(s("summary")) || emptySynthesis.summary,
        riskImpact: vq(s("riskImpact")),
        rootCause: vq(s("rootCause")),
        immediateCorrection: vq(s("immediateCorrection")),
        correctiveAction: vq(s("correctiveAction")),
        evidenceForClosure: vq(s("evidenceForClosure")),
        finalClassification: s("finalClassification"),
      };
      callLog.push({
        kind: "synthesis",
        label: "Panel · chair synthesis",
        promptSent: `SYSTEM:\n${synthSystem}\n\nUSER:\n${synthUser}`,
        output: content,
        verdict: synthesis.finalClassification || "Synthesised",
        usage: callUsage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!opts.signal?.aborted) warnings.push(`Synthesis call failed — ${msg}. Showing the individual reviews only.`);
      callLog.push({
        kind: "synthesis",
        label: "Panel · chair synthesis",
        promptSent: `SYSTEM:\n${synthSystem}\n\nUSER:\n${synthUser}`,
        output: `Call failed — ${msg}`,
        verdict: "Call failed",
        failed: true,
      });
    }
  }

  return {
    reviews,
    synthesis,
    runAt: new Date().toISOString(),
    live: true,
    runWarnings: warnings.length > 0 ? warnings : undefined,
    findingHash: finding.findingHash,
    discussionTriggered,
    callLog,
  };
}

// Retry once on timeout or 5xx before giving up on a batch. A single retry
// with a short backoff handles transient API slowdowns without hanging the
// audit for several minutes.
const AUDIT_BATCH_MAX_RETRIES = 1;
const AUDIT_BATCH_RETRY_DELAY_MS = 6_000;

// Maximum checklist lines per audit call. 4 lines × 4 APSR dims × ≤25-word
// notes ≈ 400 output tokens → finishes in 15–40 s per call. A 30-line audit
// becomes 8 parallel batches; all complete well within the 90 s ceiling.
const AUDIT_BATCH_SIZE = 4;

export type FolderAuditResult = {
  verdicts: FolderAuditLineVerdict[];
  parseWarnings: string[];
  truncationNote?: string;
  // AI-detected file mis-filing warnings (e.g. a record found in the Policy
  // folder, or a pure policy doc found in the Evidence folder).
  folderWarnings: string[];
  // Model + token usage for this audit (undefined offline).
  usage?: AIUsage;
  // Line ids for which AI calls timed out after retries. Those lines receive
  // placeholder "Not met" verdicts and should be re-audited.
  timedOutLineIds?: string[];
};

// One chatComplete call for a single batch of lines against the same docText.
// Shared prompt construction (system + user) is identical across batches so
// the model sees the same documents for every line it assesses.
async function runLiveFolderAuditBatch(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts
): Promise<FolderAuditResult> {
  const strictness = opts.strictness || "Standard";
  // Specialist domain expertise for this criterion (corporate finance for C1,
  // student-protection for C4, pedagogy/assessment for C5, etc.) so the audit
  // applies the deep, criterion-specific knowledge a human specialist would.
  const domainSkill = domainExpertiseFor(opts.criterionId);
  // APSR assessment using the official EduTrust Scoring Rubric dimensions
  // (GD4 §23): Approach → Processes → Systems & Outcomes → Review, assessed in
  // that order. The overall Met/Partial/Not met is NOT decided by the model — it
  // is derived in code by deriveApsrStatus (Approach hard-gates), the same way
  // the score/band are never left to the model alone.
  const base = `You are a GD4 internal auditor applying the official EduTrust Scoring Rubric, which assesses four dimensions — Approach, Processes, Systems & Outcomes, Review (APSR). You are given the official GD4 requirement, the institution's documents split into a "=== POLICY & PROCEDURE ===" section and an "=== ACTUAL EVIDENCE ===" section (each chunk headed by a chunk ID and its file path and type, e.g. "[CHUNK:C001] --- path [kind] ---"), and checklist statements. Assess each statement on the four rubric dimensions IN ORDER, using ONLY the text given and never assuming content that isn't there:
1. APPROACH (documented policies and procedures — the methods, tools and techniques used to meet the requirement). Read the POLICY & PROCEDURE text against the requirement WORD BY WORD. approach.status: "Meeting" only if the documented approach is specific, complete against the requirement AND sustainable (states who does what, when and how, repeatable year on year); "Beginning" if it is vague, boilerplate, copy-paste, not specific to this institution, or not sustainable; "Not evident" if no documented approach addresses it. Be critical — comment in approach.note on why it is or isn't sustainable / too generic.
2. PROCESSES (actual implementation of those policies and procedures). Using ONLY the ACTUAL EVIDENCE text, processes.status: "Deployed" if records show it implemented and managed, "Weak" if deployment is weak/partial, "Not evident" if there is no implementation evidence (a documented approach on paper is NOT implementation).
3. SYSTEMS & OUTCOMES (the desired outcomes derived from that implementation). systemsOutcomes.status: "Evident" if the desired outcomes/results are actually produced, "Limited" if outcomes are limited, "Not evident" if none.
4. REVIEW (evaluation of the appropriateness, relevance and effectiveness of the approach and process for continual improvement). review.status: "Evident" if there is a real review with improvement action, "Not evident" otherwise.
Each "note" must be a critical AUDITOR ANALYSIS, not a description or summary of the document. Never merely restate what the document contains. For approach.note: judge HOW WELL the documented approach meets THIS requirement — name specifically which Describe/Show expectations it covers and which it omits or addresses only weakly, say whether it is genuinely specific to this institution or boilerplate/generic, whether it is sustainable (repeatable, with named owners and timing) or ad hoc, and end with ONE concrete improvement the institution should make. For processes/systemsOutcomes/review notes: state what evidence WOULD prove the dimension and what is actually missing, not a paraphrase of any text found. A note that only describes the document's contents is a failure — write the auditor's judgement of its adequacy and gaps.
For EVERY non-empty positive claim (i.e. status is not "Not evident"), cite the specific chunk ID(s) from the document headers (e.g. "C001", "C002") in "sourceChunkIds" on that dimension. If no chunk directly supports a positive status, leave sourceChunkIds as an empty array — do NOT invent chunk IDs. Also populate the top-level "sources" array with file paths for backward compatibility. Cross-check file types: if a file in the POLICY & PROCEDURE section looks like an operational record, log, attendance sheet, minutes or filled-in form (not a policy/SOP/procedure/plan/framework), or a file in the ACTUAL EVIDENCE section looks like a pure undated policy document with no implementation records, add a one-sentence warning per problematic file to "folderWarnings" (e.g. "Policy folder: 'HR_Attendance_Log_Jan.xlsx' appears to be an attendance record, not a procedure — move to Actual Evidence"). Also flag evidence-timeliness issues: documents dated within 4 weeks of audit, records that don't span the full review period, and any claims about outcomes that lack a stated survey response rate.${STRICTNESS_CLAUSE[strictness] || ""}${buildSystemPrompt("evidenceReview", null, "runLiveFolderAuditBatch", opts.criterionId, domainSkill, opts.calibration, opts.memories)}`;
  const challengeRule = opts.challenge
    ? ` This is a SECOND, stricter review pass. Earlier overall verdicts are given; re-examine each and DOWNGRADE any generous rating — in particular, demote approach.status from "Meeting" to "Beginning" unless the documented approach is genuinely specific and sustainable, and demote processes.status unless implementation is explicitly evidenced.`
    : "";
  // Inject the criterion's specialist domain knowledge as its own prominent
  // block (not mixed into the generic skill bundle) so it is never truncated
  // and clearly frames the auditor persona for this criterion.
  const domainBlock = domainSkill
    ? `\n\n## Apply this specialist domain expertise for THIS criterion\n\nAudit this folder with the depth of the specialist below. Use its specific cross-checks, red flags and calibration — generic observations are not acceptable where this expertise lets you be precise.\n\n${domainSkill.trim()}`
    : "";
  const system = `${base}${domainBlock}${challengeRule} Each "note" must be 2–3 targeted sentences: name the specific file, record, role, or procedure gap you found; state precisely what is missing and what the institution must do to fix it; include dates, counts, or named roles where visible in the documents. Write as an auditor's direct assessment — never merely describe or summarise the document's contents. Respond with JSON only: {"lines": [{"lineId": string, "approach": {"status": "Meeting"|"Beginning"|"Not evident", "note": string, "sourceChunkIds": string[]}, "processes": {"status": "Deployed"|"Weak"|"Not evident", "note": string, "sourceChunkIds": string[]}, "systemsOutcomes": {"status": "Evident"|"Limited"|"Not evident", "note": string, "sourceChunkIds": string[]}, "review": {"status": "Evident"|"Not evident", "note": string, "sourceChunkIds": string[]}, "overallReason": string, "sources": string[]}], "folderWarnings": ["optional one-sentence warnings about mis-filed documents"]}.`;

  const DOC_CAP = BATCH_DOC_CAP;
  const truncated = docText.length > DOC_CAP;
  const truncationNote = truncated
    ? `Document text (${docText.length.toLocaleString()} chars) exceeds the ${DOC_CAP.toLocaleString()}-char per-call limit; last ${(docText.length - DOC_CAP).toLocaleString()} chars were not sent to the AI. The store-level condensing budget is ${FOLDER_DOC_CAP.toLocaleString()} chars — if docText is still larger, split this folder or remove duplicates and re-run.`
    : undefined;
  const truncationHint = truncated
    ? ` (NOTE: only the first ${DOC_CAP.toLocaleString()} of ${docText.length.toLocaleString()} characters are included below — some content is missing)`
    : "";

  const standardBlock = opts.standard ? `The official GD4 requirement this folder must satisfy (judge the APPROACH against THIS standard, word by word):\n"""\n${opts.standard.slice(0, 4000)}\n"""\n\n` : "";
  const priorBlock = opts.challenge ? `Earlier (first-pass) overall verdicts to re-examine and toughen:\n${opts.challenge.map((c) => `[${c.lineId}] ${c.status}`).join("\n")}\n\n` : "";
  const user = `${standardBlock}${priorBlock}Document text extracted from the folder (split into POLICY & PROCEDURE and ACTUAL EVIDENCE; each chunk headed by file path + type${truncationHint}):\n"""\n${docText.slice(0, DOC_CAP)}\n"""\n\nChecklist statements to assess:\n${lines
    .map((l) => `[${l.id}] ${l.text}`)
    .join("\n")}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { schema: FOLDER_AUDIT_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS },
  );
  const arr = parseJSONArray(content);
  // Extract optional folderWarnings from the same response object (backward
  // compatible — older/simpler model responses that return a plain array won't
  // have this key and will safely produce an empty warnings list).
  const parsedTop = parseJSONObject(content);
  const folderWarnings = Array.isArray(parsedTop.folderWarnings)
    ? (parsedTop.folderWarnings as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  type RawLeg = { status?: unknown; note?: unknown; sourceChunkIds?: unknown };
  type RawLine = { lineId: string; approach?: RawLeg; processes?: RawLeg; systemsOutcomes?: RawLeg; review?: RawLeg; sources?: unknown; overallReason?: unknown };
  const byId = new Map(
    arr
      .filter((x): x is RawLine => !!x && typeof x === "object" && typeof (x as { lineId?: unknown }).lineId === "string")
      .map((x) => [x.lineId, x])
  );

  // Coerce each dimension into the typed APSR shape, defaulting to the WORST
  // value so a missing/garbled dimension never accidentally credits the line.
  // Track any dimension that fell back so the caller can log a warning.
  // Also extracts sourceChunkIds — the chunk IDs the model cited for each dimension.
  const parseWarnings: string[] = [];
  const leg = <T extends string>(raw: RawLeg | undefined, allowed: readonly T[], fallback: T, dimName: string, lineId: string): { status: T; note: string; sourceChunkIds?: string[] } => {
    const s = raw?.status;
    const ok = (allowed as readonly string[]).includes(s as string);
    if (!ok) parseWarnings.push(`Line ${lineId} — ${dimName} status "${String(s)}" not in allowed set; defaulted to "${fallback}"`);
    const sourceChunkIds = Array.isArray(raw?.sourceChunkIds)
      ? (raw!.sourceChunkIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    return { status: ok ? (s as T) : fallback, note: typeof raw?.note === "string" ? raw.note : "", sourceChunkIds };
  };

  const verdicts = lines.map((l) => {
    const v = byId.get(l.id);
    const apsr: ApsrBreakdown = {
      approach: leg(v?.approach, ["Meeting", "Beginning", "Not evident"] as const, "Not evident", "approach", l.id),
      processes: leg(v?.processes, ["Deployed", "Weak", "Not evident"] as const, "Not evident", "processes", l.id),
      systemsOutcomes: leg(v?.systemsOutcomes, ["Evident", "Limited", "Not evident"] as const, "Not evident", "systemsOutcomes", l.id),
      review: leg(v?.review, ["Evident", "Not evident"] as const, "Not evident", "review", l.id),
    };
    const status = deriveApsrStatus(apsr);
    const sources = Array.isArray(v?.sources) ? (v!.sources as unknown[]).filter((s): s is string => typeof s === "string") : undefined;
    const reason = v ? apsrReason(apsr) : "The model did not return a verdict for this line; treated as unmet pending re-run.";
    const overallReason = typeof v?.overallReason === "string" ? v.overallReason : undefined;
    return { lineId: l.id, status, reason, sources, apsr, overallReason };
  });

  return { verdicts, parseWarnings, truncationNote, folderWarnings, usage };
}

// Outcome type for runBatchWithRetry — either a successful result or a record
// of which lines failed so placeholders can be inserted without losing the
// verdicts from all the OTHER batches that succeeded.
type BatchOutcome =
  | { ok: true; result: FolderAuditResult; batchLines: { id: string; text: string }[] }
  | { ok: false; batchLines: { id: string; text: string }[]; error: string };

// Runs a single batch with up to AUDIT_BATCH_MAX_RETRIES retries on timeout or
// transient server errors. Auth/bad-request errors are not retried (permanent).
// Returns a BatchOutcome rather than throwing so the caller can collect partial
// results from the other concurrent batches.
async function runBatchWithRetry(
  batchLines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  batchOpts: FolderAuditOpts
): Promise<BatchOutcome> {
  let lastError = "";
  for (let attempt = 0; attempt <= AUDIT_BATCH_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, AUDIT_BATCH_RETRY_DELAY_MS));
    try {
      const result = await runLiveFolderAuditBatch(batchLines, docText, settings, batchOpts);
      return { ok: true, result, batchLines };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Only retry transient failures. Auth / bad-request are permanent.
      const retryable =
        err instanceof AIClientError &&
        (lastError.includes("timed out") || /50[0-9]/.test(lastError));
      if (!retryable || attempt >= AUDIT_BATCH_MAX_RETRIES) break;
    }
  }
  return { ok: false, batchLines, error: lastError };
}

export async function runLiveFolderAudit(
  lines: { id: string; text: string }[],
  docText: string,
  settings: AISettings,
  opts: FolderAuditOpts = {}
): Promise<FolderAuditResult> {
  const batches: { id: string; text: string }[][] = [];
  for (let i = 0; i < lines.length; i += AUDIT_BATCH_SIZE) {
    batches.push(lines.slice(i, i + AUDIT_BATCH_SIZE));
  }

  opts.onBatchProgress?.(0, batches.length);
  let completed = 0;

  // Single batch: propagate errors to the store's existing catch block.
  // Retry still applies via runBatchWithRetry.
  if (batches.length === 1) {
    const outcome = await runBatchWithRetry(lines, docText, settings, opts);
    opts.onBatchProgress?.(1, 1);
    if (!outcome.ok) throw new AIClientError(outcome.error);
    return outcome.result;
  }

  // Multi-batch: run all in parallel, but resilient — a single timeout does
  // NOT cancel sibling batches. A failed batch's lines get NO verdict at all
  // (they are reported via timedOutLineIds and left "not assessed") — a
  // fabricated "Not met" placeholder must never reach the checklist or raise
  // findings. The completed work from other batches is kept.
  const outcomes = await Promise.all(
    batches.map(async (batchLines) => {
      // For the challenge pass, only surface prior verdicts that belong to the
      // lines in THIS batch — sending irrelevant verdicts wastes tokens and
      // confuses the model about which lines it should re-examine.
      const batchLineIds = new Set(batchLines.map((l) => l.id));
      const batchOpts: FolderAuditOpts = opts.challenge
        ? { ...opts, challenge: opts.challenge.filter((c) => batchLineIds.has(c.lineId)) }
        : opts;
      const outcome = await runBatchWithRetry(batchLines, docText, settings, batchOpts);
      opts.onBatchProgress?.(++completed, batches.length);
      return outcome;
    })
  );

  const succeeded = outcomes.filter((o): o is BatchOutcome & { ok: true } => o.ok);
  const failed = outcomes.filter((o): o is BatchOutcome & { ok: false } => !o.ok);
  const timedOutLineIds = failed.flatMap((o) => o.batchLines.map((l) => l.id));

  // Merge: verdicts and warnings flatten; truncationNote is shared (all batches
  // see the same docText, so truncation either fires in all or none);
  // folderWarnings deduplicated because every batch sees the same documents and
  // would emit the same mis-filing warning independently; usage summed.
  return {
    verdicts: succeeded.flatMap((o) => o.result.verdicts),
    parseWarnings: succeeded.flatMap((o) => o.result.parseWarnings),
    truncationNote: succeeded.find((o) => o.result.truncationNote)?.result.truncationNote,
    folderWarnings: [...new Set(succeeded.flatMap((o) => o.result.folderWarnings))],
    usage: succeeded.reduce<AIUsage | undefined>((acc, o) => addUsage(acc, o.result.usage), undefined),
    timedOutLineIds: timedOutLineIds.length ? timedOutLineIds : undefined,
  };
}

// Cross-criterion strategic analysis: synthesises criterion bands, open
// findings, and the audit journal into strategic priorities, systemic issues,
// a path to 4-Year Star, and immediate actions. This is the only AI function
// that looks across ALL criteria at once — every other function is per-item.
export async function runLiveCrossCriterionAnalysis(
  input: {
    journal: string;
    findings: Array<{
      gd4ItemId: string;
      issue: string;
      observation?: string;
      effect?: string;
      dimension?: string;
      riskCategory?: string;
    }>;
    criterionBands: Array<{ id: string; title: string; band: number }>;
    totalScore: number;
    award: string;
  },
  settings: AISettings
): Promise<{
  priorities: string[];
  systemicIssues: string[];
  starPath: string;
  immediateActions: string[];
  usage?: AIUsage;
}> {
  const system = `You are a senior EduTrust strategic consultant reviewing a complete internal audit result for a Singapore PEI. Analyse the criterion bands, open findings, and audit journal to produce: (1) top 3 strategic priorities (most impactful gaps to address first), (2) systemic issues (cross-cutting root causes that appear in multiple criteria — use root-cause methodology to find the underlying governance/training/data gap, not the symptoms), (3) a concrete path to 4-Year (Star) — what specifically needs to change at each band level with concrete benchmarks for Band 4–5 behaviour, (4) the single most urgent immediate action. Be specific to the GD4 standard, cite criterion and sub-criterion numbers. Do not soften or hedge. Respond with JSON only: {"priorities": string[], "systemicIssues": string[], "starPath": string, "immediateActions": string[]}.${buildSystemPrompt("bandRecommend", null, "runLiveCrossCriterionAnalysis")}`;

  const criterionBandLines = input.criterionBands.map((c) => `C${c.id} Band ${c.band} — ${c.title}`).join("\n");

  const catCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const f of input.findings) if (f.riskCategory && f.riskCategory in catCounts) catCounts[f.riskCategory]++;
  const catSummary = Object.entries(catCounts)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `Cat ${c}: ${n}`)
    .join(", ");

  const topFindings = input.findings
    .filter((f) => f.riskCategory === "A" || f.riskCategory === "B")
    .slice(0, 5)
    .map((f) => `[${f.gd4ItemId}${f.riskCategory ? ` Cat${f.riskCategory}` : ""}] ${f.issue}${f.observation ? ` — ${f.observation.slice(0, 200)}` : ""}${f.effect ? ` Effect: ${f.effect.slice(0, 200)}` : ""}`)
    .join("\n");

  const journalBlock = input.journal ? input.journal.slice(0, 3000) : "(no audit journal entries)";

  const user = `Criterion bands:\n${criterionBandLines}\n\nOverall score: ${input.totalScore}/1000 — Award: ${input.award}\nOpen findings by category: ${catSummary || "none"} (total ${input.findings.length})\n\nTop Category A+B findings:\n${topFindings || "(none)"}\n\nAudit journal (latest entries):\n${journalBlock}`;

  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["priorities", "systemicIssues", "starPath", "immediateActions"]);

  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

  return {
    priorities: toStrArr(parsed.priorities),
    systemicIssues: toStrArr(parsed.systemicIssues),
    starPath: typeof parsed.starPath === "string" ? parsed.starPath : "",
    immediateActions: toStrArr(parsed.immediateActions),
    usage,
  };
}

// Drafts the three structured body sections of a finding — Observation,
// Criteria, Effect — using the finding-specificity skill so the AI writes
// with the required specificity: WHO, WHAT, WHEN, HOW MANY, GD4 clause, and
// a concrete regulatory/certification consequence. Where exact counts or names
// are unknown, the AI uses explicit [placeholder] markers so the auditor knows
// what to fill in. These are drafts — the auditor edits before finalising.
export async function runLiveFindingObservation(
  req: { id: string; requirement: string; describeShow: string[]; expectedEvidence: string[] },
  line: { text: string; status: string },
  dimension: string,
  apsr: ApsrBreakdown | undefined,
  settings: AISettings
): Promise<{ observation: string; criteria: string; effect: string; usage?: AIUsage; promptSent?: string }> {
  const apsrSummary = apsr
    ? [
        `Approach: ${apsr.approach.status}${apsr.approach.note ? ` — ${apsr.approach.note}` : ""}`,
        `Processes: ${apsr.processes.status}${apsr.processes.note ? ` — ${apsr.processes.note}` : ""}`,
        `Systems & Outcomes: ${apsr.systemsOutcomes.status}${apsr.systemsOutcomes.note ? ` — ${apsr.systemsOutcomes.note}` : ""}`,
        `Review: ${apsr.review.status}${apsr.review.note ? ` — ${apsr.review.note}` : ""}`,
      ].join("; ")
    : "No APSR breakdown available (offline/manual finding).";

  const system = `You are an EduTrust GD4 audit finding writer. Given a checklist line that failed, its GD4 requirement, its APSR assessment, and the rubric dimension that fell short, write three sections of a formal audit finding:

1. OBSERVATION — what was found. Must follow the WHO/WHAT/WHEN/HOW MANY rule: name the responsible role (use [Role Name] if unknown), the specific document or record type, the period reviewed, and the count of gaps (use [N of M reviewed] if the exact count is unavailable). Use the APSR notes to be specific about what was absent or insufficient. This must be a factual observation of the gap, not a statement of the requirement.

2. CRITERIA — what the standard requires. Cite GD4 ${req.id} precisely. Include the specific describeShow expectation that was not met and the expected evidence.

3. EFFECT — the regulatory, certification, or operational consequence of this gap. Name the specific EduTrust band ceiling or SSG compliance risk. Be direct, not generic.

Use [bracketed placeholders] wherever you need specific data (names, dates, counts) that the auditor must fill in. Do not soften or hedge the observation.
Apply root-cause methodology: distinguish symptom → immediate cause → systemic root cause, and use 5-Why thinking to reach the system-level cause in the observation. State any sample denominator if visible in the APSR notes. Cite the specific regulatory provision (not just the GD4 item) in the criteria section where applicable. In the effect section, name the specific band ceiling and the concrete regulatory or certification consequence using benchmarking reference points.
Write all finding sections (Observation, Criteria, Effect) in factual, neutral language. State what was found and what the standard requires. Do not characterise evidence as adequate, inadequate, good, or poor — only state what exists or is absent. Avoid phrases like "the policy is adequate" or "well-written" — instead say "a policy document was provided" or "no policy document was found". The reader will judge adequacy — you only state facts.
Respond with JSON only: {"observation": string, "criteria": string, "effect": string}.${buildSystemPrompt("findingWriter", null, "runLiveFindingObservation", req.id, domainExpertiseFor(req.id))}${buildDomainBlock(domainExpertiseFor(req.id))}`;

  const user = `GD4 ${req.id}: ${req.requirement}
Describe/Show: ${req.describeShow.slice(0, 3).join("; ")}
Expected evidence: ${req.expectedEvidence.length ? req.expectedEvidence.join("; ") : "(not specified)"}

Checklist line: "${line.text}" — status: ${line.status}
APSR assessment: ${apsrSummary}
Dimension (APSR leg that fell short): ${dimension}`;

  let usage: AIUsage | undefined;
  // Generative (fixed): writes the finding OBSERVATION prose (WHO/WHAT/WHEN
  // narrative), not a verdict — natural varied wording is desirable here.
  const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.5, onUsage: (u) => { usage = u; } });
  const parsed = parseJSONObject(content, ["observation", "criteria", "effect"]);
  return {
    observation: (parsed.observation as string) || `${line.text} — status: ${line.status}. [Auditor: add WHO, WHAT, WHEN, and HOW MANY specifics here.]`,
    criteria: (parsed.criteria as string) || `GD4 ${req.id} requires: ${req.requirement}`,
    effect: (parsed.effect as string) || `This gap must be resolved before the EduTrust assessment. See the dimension (${dimension}) for the applicable band ceiling.`,
    usage,
    promptSent: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Staged folder audit — three focused AI stages + deterministic APSR builder.
//
// The key constraint: policy documents can only satisfy Approach; evidence
// documents satisfy Processes; outcome data satisfies Systems & Outcomes; review
// records satisfy Review. The old single-pass audit let the model decide APSR in
// one undifferentiated call. The staged approach enforces these boundaries in code.
// ──────────────────────────────────────────────────────────────────────────────

export type StagedPolicyAuditResult = {
  rows: PolicyCoverageRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

export type StagedEvidenceAuditResult = {
  rows: EvidenceCoverageRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

export type StagedOutcomeReviewAuditResult = {
  rows: OutcomeReviewRow[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed?: number;
  totalCharsAssessed?: number;
  totalCharsAvailable?: number;
  fullCoverage?: boolean;
  windowErrors?: string[];
};

const STAGED_BATCH_SIZE = 8; // audit points per AI call (each is smaller than a full checklist line)
const REQ_BATCH_SIZE = 8; // requirement lines per AI call — Option A's runPPDRequirementsReview and runEvidenceAssessment

// Per-AI-call skip (2026-07-20). A run can appear to hang on one slow extract
// call (the AI "thinking" over a document window). onCallAbort lets the caller
// (the store) register a resolver for the CURRENT call; the UI's "Skip this
// step" button invokes it, and raceCallSkip returns CALL_SKIPPED so the loop
// treats that call exactly like an empty/failed reply (its points fall through
// to other windows or are marked "not assessed" — honest, never fabricated).
// The abandoned chatComplete keeps running to its own AUDIT_BATCH_TIMEOUT_MS in
// the background (harmless: nothing awaits it once skipped). Same Promise.race
// shape as the Drive file-read skip, so no in-flight-abort plumbing is needed.
export const CALL_SKIPPED = Symbol("ai-call-skipped");
type CallAbortReg = (abort: (() => void) | null) => void;
export async function raceCallSkip<T>(onCallAbort: CallAbortReg | undefined, call: Promise<T>): Promise<T | typeof CALL_SKIPPED> {
  if (!onCallAbort) return call;
  let resolveSkip!: () => void;
  const skip = new Promise<typeof CALL_SKIPPED>((res) => { resolveSkip = () => res(CALL_SKIPPED); });
  onCallAbort(resolveSkip);
  try { return await Promise.race([call, skip]); }
  finally { onCallAbort(null); }
}

// Shared assessor-register rule appended to every staged-audit prompt. Brings
// the staged (Option B) notes to the same standard as the Option A prompts —
// Technique 1 (decompose and name the missing obligation), Technique 4 (named
// example with dates/versions) and Technique 5 (SSG phrasing register). Write
// the note as an assessor writes a finding, never as a summary.
const SSG_NOTE_REGISTER = ` Write the "note" the way an SSG EduTrust assessor writes a finding — specific, decomposed, evidenced — NEVER as a generic summary:
- DECOMPOSE the requirement into its distinct obligations and name WHICH specific obligation is missing, weak, or met — e.g. "the documents cover the code of conduct but not the non-collection of monies from students", not merely "the requirement is partially met". Where the point has (a)/(b)/(c) parts, say which part fails.
- Every "Partial"/"No"/"Not evident" note MUST open with the SSG register — "It was not evident that the PEI had [documented / implemented / established] …" — and MUST cite at least one concrete example: the specific document name, section, version, date or record entry that demonstrates the gap; or, where the topic is wholly absent, name what was searched and found absent.
- Where dates or versions can be compared (a record dated after the period it governs; a document that never moves past V0; evidence created only just before the audit), PERFORM the comparison and state it explicitly in the note.
- A negative note that does not name the specific missing obligation AND give a concrete example is unsupported and unacceptable — do not write "no relevant evidence found" or "the requirement is not met" on their own.
- Positive notes stay factual and specific (which record, which section, which date) — no praise adjectives ("good", "robust", "comprehensive", "well-structured").`;

// Sliding window constants. Windows overlap so evidence that straddles a
// boundary is not missed. Each window is sent as a separate AI call set and
// the results merged (best verdict wins across windows).
const WINDOW_SIZE = 55_000;
const WINDOW_OVERLAP = 5_000;

type DocWindow = { text: string; start: number; end: number; index: number; total: number };

function buildDocWindows(text: string): DocWindow[] {
  if (!text || text.length <= WINDOW_SIZE) {
    return [{ text, start: 0, end: text.length, index: 0, total: 1 }];
  }
  const windows: DocWindow[] = [];
  const step = WINDOW_SIZE - WINDOW_OVERLAP;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + WINDOW_SIZE, text.length);
    windows.push({ text: text.slice(start, end), start, end, index: windows.length, total: 0 });
    if (end >= text.length) break;
    start += step;
  }
  const total = windows.length;
  for (const w of windows) w.total = total;
  return windows;
}

// The distinct chunk IDs ("[CHUNK:C001] --- path ---") a window's text
// actually contains, in first-seen order — lets a caller (useWorkspaceStore's
// run loops) resolve which SOURCE FILES the in-flight AI call for this window
// covers, via its own chunkId -> file-name map, for a live "currently
// processing: <files>" indicator. Shared by runPPDRequirementsReview and
// runEvidenceAssessment rather than duplicated.
function chunkIdsInWindow(text: string): string[] {
  const seen = new Set<string>();
  const re = /\[CHUNK:([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) seen.add(m[1]);
  return [...seen];
}

// Coverage priority: Yes > Partial > No. Returns the better of the two.
function mergeCoverage(a: StagedCoverageStatus, b: StagedCoverageStatus): StagedCoverageStatus {
  if (a === "Yes" || b === "Yes") return "Yes";
  if (a === "Partial" || b === "Partial") return "Partial";
  return "No";
}

// Tracks the specific note (and the chunk IDs that supported it) each window
// contributed for one audit-point ref, so the final note can cite every
// window that found something — with a source citation — rather than
// silently discarding all but the single "best" window's text.
type WindowNote = { window: number; note: string; chunkIds: string[] };

function pushWindowNote(parts: WindowNote[], windowIndex: number, note: string, chunkIds: string[]): WindowNote[] {
  const trimmed = note.trim();
  if (!trimmed) return parts;
  return [...parts, { window: windowIndex + 1, note: trimmed, chunkIds }];
}

// For a NEGATIVE (gap) verdict the SSG-register prompt still asks the model to
// write a specific "It was not evident that the PEI had… Example: …" note. We
// used to discard those notes (keeping only positive-coverage notes), so every
// gap — exactly the lines that become findings — fell back to a generic string
// like "No implementation evidence found…", which is why Option B read generic.
// Keep the single MOST SUBSTANTIVE negative note (longest wins as a proxy for
// "carries the named example"); across windows the fullest observation survives
// rather than a bare "not found in this window".
function betterNegNote(prev: WindowNote | undefined, windowIndex: number, note: string, chunkIds: string[]): WindowNote | undefined {
  const trimmed = note.trim();
  if (!trimmed) return prev;
  const candidate: WindowNote = { window: windowIndex + 1, note: trimmed, chunkIds };
  if (!prev || trimmed.length > prev.note.length) return candidate;
  return prev;
}

// Renders the accumulated per-window notes for one ref as one numbered,
// blank-line-separated paragraph per contributing window:
//   #1 [filename.pdf · C001]: <note text>
//
//   #2 [other.pdf · C003]: <note text>
// `resolveFile` maps a chunk ID back to its source file name (from the
// evidence file ledger) — when it can't resolve a chunk (or a window cited
// none), the bracketed citation is simply omitted for that entry.
// IMPORTANT: `p.note` is used verbatim — never slice/truncate it here or in
// any caller that assembles the final APSR/checklist/finding text. The only
// place notes are shortened is the compact one-line "Gap detail" bullet list
// in useWorkspaceStore.ts (noteSummary()), which is a deliberately abbreviated
// overview and separate from this full-observation rendering.
function renderWindowNotes(parts: WindowNote[], fallback: string, resolveFile?: (chunkId: string) => string | undefined): string {
  if (parts.length === 0) return fallback;
  // Numbered by POSITION in this contributing list (i + 1), not by
  // `p.window` (the note's absolute position in the whole sliding-window
  // sweep). Using the absolute window number meant the very first window to
  // find nothing (e.g. window 1 covered="No") left a gap: window 2's note
  // would render as "#2:" with no "#1:" ever appearing. Every list must
  // start at #1 regardless of which windows actually contributed.
  return parts.map((p, i) => {
    const citation = p.chunkIds
      .map((cid) => {
        const file = resolveFile?.(cid);
        return file ? `${file} · ${cid}` : cid;
      })
      .join(", ");
    const label = citation ? `#${i + 1} [${citation}]` : `#${i + 1}`;
    return `${label}:\n${p.note}`;
  }).join("\n\n");
}

function buildStagedPointsBlock(auditPoints: FlatAuditPoint[]): string {
  return auditPoints.map((p, i) =>
    `[${p.ref}] (${i + 1}) ${p.text}${p.parentText ? ` [parent: ${p.parentText}]` : ""}`
  ).join("\n");
}

// Shared opts shape for all three staged passes below.
type StagedAuditOpts = { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; fileType?: "spreadsheet" | "scanned" | null; onProgress?: (detail: string) => void; shouldStop?: () => boolean; signal?: AbortSignal; resolveChunkFile?: (chunkId: string) => string | undefined };

// Per-ref accumulator across sliding windows: the merged verdict so far, the
// positive-coverage notes collected (one per contributing window), and the
// single best negative note retained for a pure gap (see betterNegNote).
type StagedBest<V> = { verdict: V; notes: WindowNote[]; negNote?: WindowNote; chunkIds: string[] };

type WindowedStagedAuditResult<Row> = {
  rows: Row[];
  usage?: AIUsage;
  promptSent?: string;
  truncationNote?: string;
  windowsProcessed: number;
  totalCharsAssessed: number;
  totalCharsAvailable: number;
  fullCoverage: boolean;
  windowErrors?: string[];
};

// Shared window→batch→chatComplete→parse→merge pipeline behind
// runStagedPolicyAudit / runStagedEvidenceAudit / runStagedOutcomeReviewAudit.
// The three staged passes differ only in: prompt wording (buildSystem/
// buildUser), the JSON schema, how one AI result row parses into a per-point
// verdict (extractVerdict), whether a verdict counts as "found something"
// (isPositive), how two windows' verdicts merge (mergeVerdict — Yes/Partial/No
// priority vs OR-of-booleans), and the final row shape (buildRow). Everything
// else — the sliding-window/batch loop, per-batch progress heartbeat, stop/
// abort handling, failed-batch → notAssessed accounting, and the fullCoverage/
// truncationNote bookkeeping — was identical copy-paste three times before
// this helper existed; a fix to one no longer risks silently missing the
// other two.
async function runWindowedStagedAudit<V, Row>(
  auditPoints: FlatAuditPoint[],
  docText: string,
  settings: AISettings,
  opts: StagedAuditOpts,
  cfg: {
    noDocsNote: string;
    emptyVerdict: V;
    schema: ChatSchema;
    label: string;      // "Policy" | "Evidence" | "Outcome/review" — progress/error/truncation text
    funcName: string;   // "runStagedPolicyAudit" etc — per-call system-prompt label
    logTag: string;     // "[StagedPolicyAudit]" etc — console.error tag
    buildSystem: (label: string) => string;
    buildUser: (batch: FlatAuditPoint[], win: DocWindow, windowLabel: string) => string;
    extractVerdict: (r: Record<string, unknown> | undefined) => V;
    isPositive: (v: V) => boolean;
    mergeVerdict: (prev: V, next: V) => V;
    fallbackNote: (windowsCompleted: number) => string;
    buildRow: (p: FlatAuditPoint, verdict: V, note: string, chunkIds: string[], notAssessed?: boolean) => Row;
  }
): Promise<WindowedStagedAuditResult<Row>> {
  if (auditPoints.length === 0 || !docText.trim()) {
    return { rows: auditPoints.map((p) => cfg.buildRow(p, cfg.emptyVerdict, cfg.noDocsNote, [])), windowsProcessed: 0, totalCharsAssessed: 0, totalCharsAvailable: 0, fullCoverage: true };
  }

  const windows = buildDocWindows(docText);
  const totalCharsAvailable = docText.length;

  const bestByRef = new Map<string, StagedBest<V>>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let totalCharsAssessed = 0;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // Stop = user skip/cancel (shouldStop) or an aborted signal. A stopped run
  // must report itself as partial and must NOT fabricate verdicts for points
  // it never put in front of the AI.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: FlatAuditPoint[][] = [];
  for (let i = 0; i < auditPoints.length; i += STAGED_BATCH_SIZE) {
    batches.push(auditPoints.slice(i, i + STAGED_BATCH_SIZE));
  }

  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    totalCharsAssessed += win.end - win.start;
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} total]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      // Emit progress before EVERY batch, not just once per window. Each window
      // makes `batches.length` sequential AI calls; the store uses this callback
      // to refresh the audit heartbeat, so emitting only once per window let the
      // stuck-detector fire mid-window during normal (slow) operation, which
      // misled users into hitting "Skip pass" and cutting the run short.
      opts.onProgress?.(`${cfg.label} audit — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      const user = cfg.buildUser(batch, win, windowLabel);
      const system = cfg.buildSystem(windows.length > 1 ? `${cfg.funcName} (window ${win.index + 1}/${win.total})` : cfg.funcName);
      if (!firstPromptSent) firstPromptSent = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      try {
        const content = await chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { schema: cfg.schema, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        const byRef = new Map(results.map((r) => [normalizeAuditRef(String(r.ref ?? "")), r]));
        for (const p of batch) {
          const r = byRef.get(normalizeAuditRef(p.ref));
          const verdict = cfg.extractVerdict(r);
          const chunkIds = Array.isArray(r?.chunkIds) ? (r!.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
          const note = typeof r?.note === "string" ? r.note : "";
          const positive = cfg.isPositive(verdict);
          const prev = bestByRef.get(p.ref);
          if (!prev) {
            bestByRef.set(p.ref, {
              verdict,
              notes: positive ? pushWindowNote([], win.index, note, chunkIds) : [],
              negNote: positive ? undefined : betterNegNote(undefined, win.index, note, chunkIds),
              chunkIds,
            });
          } else {
            const merged = cfg.mergeVerdict(prev.verdict, verdict);
            const mergedNotes = positive ? pushWindowNote(prev.notes, win.index, note, chunkIds) : prev.notes;
            const mergedNeg = positive ? prev.negNote : betterNegNote(prev.negNote, win.index, note, chunkIds);
            const mergedChunks = [...new Set([...prev.chunkIds, ...chunkIds])];
            bestByRef.set(p.ref, { verdict: merged, notes: mergedNotes, negNote: mergedNeg, chunkIds: mergedChunks });
          }
        }
      } catch (err) {
        // A cancel/abort surfaces here as a thrown "AI call cancelled." — that
        // is a stop, not a failure: no error row, no fabricated negative verdict.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const errLabel = windows.length > 1 ? `${cfg.label} window ${win.index + 1}/${win.total}` : `${cfg.label} AI call`;
        const errNote = `${errLabel} failed — ${msg}`;
        windowErrors.push(errNote);
        console.error(cfg.logTag, errNote);
        // Do NOT seed a negative verdict for the failed batch's points — an API
        // failure is not an assessed gap. Points that never get a verdict in ANY
        // window become "Not assessed" rows below, exactly like a stopped run.
      }
    }
    // A window whose batch sweep was cut short is NOT a completed window —
    // counting it (as before) made a stopped run report fullCoverage=true.
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  let notAssessedCount = 0;
  const rows: Row[] = auditPoints.map((p) => {
    const best = bestByRef.get(p.ref);
    // A stopped run OR a batch whose AI call failed in every window leaves the
    // point with no verdict at all — mark it Not assessed instead of
    // fabricating a negative verdict (a false negative that would flow into
    // checklist statuses and findings).
    if (!best) {
      notAssessedCount++;
      const reason = stoppedEarly
        ? "the run was stopped before this audit point was reviewed"
        : "the AI call for this audit point failed in every window it was sent to";
      return cfg.buildRow(p, cfg.emptyVerdict, `Not assessed — ${reason}. No verdict was produced.`, [], true);
    }
    // Positive-coverage notes win; for a pure gap, surface the retained
    // negative note (specific SSG observation) instead of the generic fallback.
    const noteParts = best.notes.length ? best.notes : best.negNote ? [best.negNote] : [];
    return cfg.buildRow(p, best.verdict, renderWindowNotes(noteParts, cfg.fallbackNote(windowsCompleted), opts.resolveChunkFile), best.chunkIds);
  });

  // Full coverage means every window completed AND every point actually got a
  // verdict — a run where a batch failed in all windows is PARTIAL even though
  // the window loop technically finished.
  const fullCoverage = !stoppedEarly && windowsCompleted === windows.length && notAssessedCount === 0;
  const truncationNote = !fullCoverage
    ? `${cfg.label} content assessed via ${windowsCompleted} of ${windows.length} sliding windows — ${totalCharsAssessed.toLocaleString()} chars of ${totalCharsAvailable.toLocaleString()} total (${WINDOW_OVERLAP.toLocaleString()}-char overlap). Assessed ${auditPoints.length - notAssessedCount} of ${auditPoints.length} audit points.${notAssessedCount > 0 ? ` ${notAssessedCount} audit point(s) were NOT assessed (${stoppedEarly ? "run stopped early" : "AI call failures"}); results are PARTIAL.` : ` ${(totalCharsAvailable - totalCharsAssessed).toLocaleString()} chars were not assessed.`}`
    : undefined;

  return { rows, usage, promptSent: firstPromptSent, truncationNote, windowsProcessed: windowsCompleted, totalCharsAssessed, totalCharsAvailable, fullCoverage, windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}

// Stage 2: Policy Adequacy Audit.
// Reads POLICY documents only; checks if each FlatAuditPoint has a documented
// approach. Does NOT look at evidence documents or outcome data.
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedPolicyAudit(
  auditPoints: FlatAuditPoint[],
  policyDocText: string,
  settings: AISettings,
  opts: StagedAuditOpts = {}
): Promise<StagedPolicyAuditResult> {
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // Built per actual AI call (inside runWindowedStagedAudit's window/batch
  // loop) rather than once for the whole function — buildSystemPrompt() has a
  // dev-only debug-log side effect, and the debug log is meant to show every
  // real chatComplete() call. The label is the only thing that varies between
  // calls; the resulting prompt text sent to the AI is unchanged from before.
  const buildSystem = (label: string) => `You are auditing ONLY the POLICY & PROCEDURE documents for a GD4 EduTrust sub-criterion. Your task for each audit point: does this institution's policy documentation DOCUMENT an approach that addresses this requirement? You are assessing APPROACH only — not whether it is implemented, not whether outcomes are achieved.

Decide deterministically by counting which of the four specifics are documented — WHO owns it, WHAT they do, WHEN/how often, and WHAT record results — the same policy text must always yield the same verdict:
"Yes" = all four specifics are documented (named owner, the action, timing/frequency, and the resulting record). Full, specific, sustainable.
"Partial" = the requirement is addressed but ONE OR MORE of the four specifics is missing or is boilerplate not specific to this institution. Name which specific is missing.
"No" = the policy does not address this requirement at all.
BOUNDARY RULE (Yes vs Partial): if you can name even one missing specific (owner / action / timing / record), it is "Partial", not "Yes". When unsure between "Yes" and "Partial", choose "Partial" (resolve down).

IMPORTANT: Do NOT credit evidence of implementation (records, logs, filled forms) as policy. A record of doing something is NOT a documented approach.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the coverage verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  return runWindowedStagedAudit<StagedCoverageStatus, PolicyCoverageRow>(
    auditPoints, policyDocText, settings, opts,
    {
      noDocsNote: "No policy documents provided.",
      emptyVerdict: "No",
      schema: STAGED_COVERAGE_SCHEMA,
      label: "Policy",
      funcName: "runStagedPolicyAudit",
      logTag: "[StagedPolicyAudit]",
      buildSystem,
      buildUser: (batch, win, windowLabel) => {
        const pointsBlock = buildStagedPointsBlock(batch);
        return `Policy & Procedure documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for APPROACH coverage:\n${pointsBlock}`;
      },
      extractVerdict: (r) => (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus) ? (r!.covered as StagedCoverageStatus) : "No",
      isPositive: (v) => v !== "No",
      mergeVerdict: mergeCoverage,
      fallbackNote: (windowsCompleted) => `No relevant policy evidence found in the ${windowsCompleted} window(s) reviewed.`,
      buildRow: (p, verdict, note, chunkIds, notAssessed) =>
        notAssessed
          ? { ref: p.ref, pointText: p.text, covered: verdict, note, chunkIds, notAssessed: true }
          : { ref: p.ref, pointText: p.text, covered: verdict, note, chunkIds },
    }
  );
}

// Stage 3: Evidence Implementation Audit.
// Reads EVIDENCE documents only; checks if each FlatAuditPoint has actual
// implementation evidence. Receives policy results so it can distinguish
// "policy exists but not implemented" from "nothing at all".
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedEvidenceAudit(
  auditPoints: FlatAuditPoint[],
  evidenceDocText: string,
  policyRows: PolicyCoverageRow[],
  settings: AISettings,
  opts: StagedAuditOpts = {}
): Promise<StagedEvidenceAuditResult> {
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";
  const policyByRef = new Map(policyRows.map((r) => [r.ref, r]));

  // See runStagedPolicyAudit's comment on `buildSystem`: built per actual AI
  // call (inside runWindowedStagedAudit's loop) so the debug log gets one
  // entry per real chatComplete() call instead of a single entry for the
  // whole stage.
  const buildSystem = (label: string) => `You are auditing ONLY the ACTUAL EVIDENCE documents for a GD4 EduTrust sub-criterion. Your task: does the evidence show that the institution actually IMPLEMENTS each requirement in practice? You are assessing PROCESSES only — not the documented policy (assessed separately), not outcomes.

Decide "covered" deterministically — the same evidence must always yield the same verdict; count records, do not judge "feel":
"Yes" = at least one real implementation record (log, form, screenshot, register, operational record) directly demonstrates this requirement being carried out, AND nothing indicates it was done only once/partially. Cite the record.
"Partial" = implementation records exist but are INCOMPLETE by a concrete, stateable measure — covers only part of the review period, a single instance where the requirement implies a recurring process, or only some of the requirement's sub-parts. You MUST name which part is missing.
"No" = no implementation record in these documents demonstrates this requirement at all.
BOUNDARY RULE (Yes vs Partial): award "Yes" only when the evidence covers the requirement in FULL; if any nameable part is uncovered, it is "Partial", not "Yes". If you cannot name what is missing, it is "Yes"; if you can, it is "Partial". When genuinely unsure between "Yes" and "Partial", choose "Partial" (resolve down).

IMPORTANT: A policy document, SOP, or procedure does NOT count as implementation evidence, even if it is filed in the evidence folder. Only actual records of doing something count.
Cite the exact chunk ID(s) from document headers (e.g. "C001") in chunkIds. Leave chunkIds empty if no chunk directly supports the verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "covered": "Yes"|"Partial"|"No", "note": string, "chunkIds": string[]}]}`;

  return runWindowedStagedAudit<StagedCoverageStatus, EvidenceCoverageRow>(
    auditPoints, evidenceDocText, settings, opts,
    {
      noDocsNote: "No evidence documents provided.",
      emptyVerdict: "No",
      schema: STAGED_COVERAGE_SCHEMA,
      label: "Evidence",
      funcName: "runStagedEvidenceAudit",
      logTag: "[StagedEvidenceAudit]",
      buildSystem,
      buildUser: (batch, win, windowLabel) => {
        const pointsBlock = batch.map((p, i) => {
          const pol = policyByRef.get(p.ref);
          const polNote = pol ? ` [Policy adequacy: ${pol.covered}${pol.covered !== "No" ? ` — "${pol.note.slice(0, 80)}"` : ""}]` : "";
          return `[${p.ref}] (${i + 1}) ${p.text}${p.parentText ? ` [parent: ${p.parentText}]` : ""}${polNote}`;
        }).join("\n");
        return `Actual evidence documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for IMPLEMENTATION evidence:\n${pointsBlock}`;
      },
      extractVerdict: (r) => (["Yes", "Partial", "No"] as StagedCoverageStatus[]).includes(r?.covered as StagedCoverageStatus) ? (r!.covered as StagedCoverageStatus) : "No",
      isPositive: (v) => v !== "No",
      mergeVerdict: mergeCoverage,
      fallbackNote: (windowsCompleted) => `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`,
      buildRow: (p, verdict, note, chunkIds, notAssessed) =>
        notAssessed
          ? { ref: p.ref, pointText: p.text, covered: verdict, note, chunkIds, notAssessed: true }
          : { ref: p.ref, pointText: p.text, covered: verdict, note, chunkIds },
    }
  );
}

// Stage 4: Outcome & Review Audit.
// Reads ALL documents; checks for outcome data (Systems & Outcomes) and
// review/improvement records (Review). Both outcomes and review are assessed
// together in one call since they both require looking at all documents.
// Uses a sliding window so the full text is assessed even when it exceeds one AI call.
export async function runStagedOutcomeReviewAudit(
  auditPoints: FlatAuditPoint[],
  allDocText: string,
  settings: AISettings,
  opts: StagedAuditOpts = {}
): Promise<StagedOutcomeReviewAuditResult> {
  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // See runStagedPolicyAudit's comment on `buildSystem`: built per actual AI
  // call (inside runWindowedStagedAudit's loop) so the debug log gets one
  // entry per real chatComplete() call instead of a single entry for the
  // whole stage.
  const buildSystem = (label: string) => `You are auditing ALL documents (policy and evidence combined) for outcome data and review/improvement records for a GD4 EduTrust sub-criterion. For each audit point assess:

outcomeEvident: true if there is actual outcome data, KPIs, results, trends, survey data, or performance measurements for this requirement — not just a statement that outcomes will be tracked. The data must cover the review period, name targets or results, and show actual numbers or trends.

reviewEvident: true if there are records of a formal review of this requirement's effectiveness — meeting minutes with agenda item, management review records, improvement actions triggered by data review, or evaluation reports. A policy that says "we will review annually" is NOT evidence of a review having happened.

Cite chunk IDs from document headers in chunkIds. Leave chunkIds empty if no chunk directly supports a true verdict. Write "note" as a complete observation for THIS window — do not abbreviate or summarise it; a later merge step, not you, is responsible for keeping the final text concise.${SSG_NOTE_REGISTER}${buildSystemPrompt("evidenceReview", opts.fileType ?? null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

Respond with JSON only:
{"results": [{"ref": string, "outcomeEvident": boolean, "reviewEvident": boolean, "note": string, "chunkIds": string[]}]}`;

  return runWindowedStagedAudit<{ outcomeEvident: boolean; reviewEvident: boolean }, OutcomeReviewRow>(
    auditPoints, allDocText, settings, opts,
    {
      noDocsNote: "No documents provided.",
      emptyVerdict: { outcomeEvident: false, reviewEvident: false },
      schema: STAGED_OUTCOME_SCHEMA,
      label: "Outcome/review",
      funcName: "runStagedOutcomeReviewAudit",
      logTag: "[StagedOutcomeReviewAudit]",
      buildSystem,
      buildUser: (batch, win, windowLabel) => {
        const pointsBlock = buildStagedPointsBlock(batch);
        return `All documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nAssess each audit point for OUTCOME DATA and REVIEW RECORDS:\n${pointsBlock}`;
      },
      extractVerdict: (r) => ({ outcomeEvident: r?.outcomeEvident === true, reviewEvident: r?.reviewEvident === true }),
      // For outcome/review: OR across windows (true if any window finds evidence).
      isPositive: (v) => v.outcomeEvident || v.reviewEvident,
      mergeVerdict: (prev, next) => ({ outcomeEvident: prev.outcomeEvident || next.outcomeEvident, reviewEvident: prev.reviewEvident || next.reviewEvident }),
      fallbackNote: (windowsCompleted) => `No relevant evidence chunk found for this dimension in the ${windowsCompleted} window(s) reviewed.`,
      buildRow: (p, verdict, note, chunkIds, notAssessed) =>
        notAssessed
          ? { ref: p.ref, pointText: p.text, outcomeEvident: verdict.outcomeEvident, reviewEvident: verdict.reviewEvident, note, chunkIds, notAssessed: true }
          : { ref: p.ref, pointText: p.text, outcomeEvident: verdict.outcomeEvident, reviewEvident: verdict.reviewEvident, note, chunkIds },
    }
  );
}

// Stage 5: Deterministic APSR verdict builder.
// Maps the three coverage matrices to the four APSR dimensions WITHOUT any AI call.
// Key rule: policy coverage → Approach, evidence coverage → Processes,
// outcome data → Systems & Outcomes, review records → Review.
// Policy documents cannot satisfy Processes; evidence documents cannot satisfy Approach
// (unless they contain a procedure, but that classification happens in Stage 2/3).
//
// opts.requireCitations (live AI runs): a positive dimension status with no
// cited chunk IDs is downgraded one level — a verdict that cannot point at
// the source text that supports it must not carry a full positive rating.
// Offline keyword simulation never produces chunk IDs, so callers pass this
// only for live runs (leaving simulate-based rows on the old behaviour would
// otherwise be impossible).
const UNCITED_DOWNGRADE_NOTE ="Downgraded: no source chunks cited to support this verdict.";

export function buildStagedApsr(
  policyRow: PolicyCoverageRow | undefined,
  evidenceRow: EvidenceCoverageRow | undefined,
  outcomeRow: OutcomeReviewRow | undefined,
  opts: { requireCitations?: boolean } = {}
): ApsrBreakdown {
  const uncited = (chunkIds: string[] | undefined) => !!opts.requireCitations && (!chunkIds || chunkIds.length === 0);
  const downgradedNote = (note: string) => `${note ? `${note}\n\n` : ""}${UNCITED_DOWNGRADE_NOTE}`;

  // Approach — from policy adequacy only
  const approach: ApsrBreakdown["approach"] = policyRow?.covered === "Yes"
    ? uncited(policyRow.chunkIds)
      ? { status: "Beginning", note: downgradedNote(policyRow.note), sourceChunkIds: [] }
      : { status: "Meeting", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
    : policyRow?.covered === "Partial"
      ? { status: "Beginning", note: policyRow.note, sourceChunkIds: policyRow.chunkIds }
      : { status: "Not evident", note: policyRow?.note || "No policy documentation found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Processes — from evidence coverage only
  const processes: ApsrBreakdown["processes"] = evidenceRow?.covered === "Yes"
    ? uncited(evidenceRow.chunkIds)
      ? { status: "Weak", note: downgradedNote(evidenceRow.note), sourceChunkIds: [] }
      : { status: "Deployed", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
    : evidenceRow?.covered === "Partial"
      ? { status: "Weak", note: evidenceRow.note, sourceChunkIds: evidenceRow.chunkIds }
      : { status: "Not evident", note: evidenceRow?.note || "No implementation evidence found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Systems & Outcomes — from outcome data
  const systemsOutcomes: ApsrBreakdown["systemsOutcomes"] = outcomeRow?.outcomeEvident
    ? uncited(outcomeRow.chunkIds)
      ? { status: "Limited", note: downgradedNote(outcomeRow.note), sourceChunkIds: [] }
      : { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
    : { status: "Not evident", note: outcomeRow?.note || "No outcome data (KPIs, results, trends) found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  // Review — from review records. Review's union is binary
  // ("Evident" | "Not evident"), so one level down IS "Not evident".
  const review: ApsrBreakdown["review"] = outcomeRow?.reviewEvident
    ? uncited(outcomeRow.chunkIds)
      ? { status: "Not evident", note: downgradedNote(outcomeRow.note), sourceChunkIds: [] }
      : { status: "Evident", note: outcomeRow.note, sourceChunkIds: outcomeRow.chunkIds }
    : { status: "Not evident", note: outcomeRow?.note || "No review or improvement records found for this requirement in the documents reviewed.", sourceChunkIds: [] };

  return { approach, processes, systemsOutcomes, review };
}

// Simulate staged audit (offline, no AI) — produces deterministic coverage rows
// from the document text using keyword matching, mirroring the same heuristic
// as simulateFolderAudit but per-audit-point rather than per-checklist-line.
export function simulateStagedPolicyAudit(auditPoints: FlatAuditPoint[], policyDocText: string): PolicyCoverageRow[] {
  const docLower = policyDocText.toLowerCase();
  return auditPoints.map((p) => {
    const words = p.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const matches = words.filter((w) => docLower.includes(w)).length;
    const covered: StagedCoverageStatus = matches >= 3 ? "Yes" : matches >= 1 ? "Partial" : "No";
    return { ref: p.ref, pointText: p.text, covered, note: `Offline estimate: ${matches} of ${words.length} keywords found in policy documents.`, chunkIds: [] };
  });
}

export function simulateStagedEvidenceAudit(auditPoints: FlatAuditPoint[], evidenceDocText: string): EvidenceCoverageRow[] {
  const docLower = evidenceDocText.toLowerCase();
  return auditPoints.map((p) => {
    const words = p.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const matches = words.filter((w) => docLower.includes(w)).length;
    const covered: StagedCoverageStatus = matches >= 3 ? "Yes" : matches >= 1 ? "Partial" : "No";
    return { ref: p.ref, pointText: p.text, covered, note: `Offline estimate: ${matches} of ${words.length} keywords found in evidence documents.`, chunkIds: [] };
  });
}

export function simulateStagedOutcomeReview(auditPoints: FlatAuditPoint[], allDocText: string): OutcomeReviewRow[] {
  const docLower = allDocText.toLowerCase();
  const outcomeWords = ["outcome", "result", "kpi", "trend", "survey", "data", "rate", "percentage", "score", "target"];
  const reviewWords = ["review", "minute", "meeting", "decision", "improvement", "action", "evaluate"];
  const hasOutcome = outcomeWords.some((w) => docLower.includes(w));
  const hasReview = reviewWords.some((w) => docLower.includes(w));
  return auditPoints.map((p) => ({
    ref: p.ref, pointText: p.text,
    outcomeEvident: hasOutcome,
    reviewEvident: hasReview,
    note: `Offline estimate: outcome keywords ${hasOutcome ? "found" : "not found"}, review keywords ${hasReview ? "found" : "not found"}.`,
    chunkIds: [],
  }));
}

// ─── PPD Requirements Review ────────────────────────────────────────────────
// Reads ONLY the Policy & Procedure Document(s) for a sub-criterion and, for
// EACH GD4 requirement LINE (one FlatAuditPoint — a Describe/Show bullet,
// not the whole requirement item), decides whether the PPD documents it,
// with a suggested rewrite for anything short of Adequate. Orchestration
// (reading the Policy folder, calling this, logging to the AI Review Log)
// lives in useWorkspaceStore.runPPDReview — this function only makes the AI
// call(s), same division of responsibility as every other function in this
// file.

export type PPDRequirementInput = { ref: string; gd4ItemId: string; requirementText: string };

export type PPDRequirementsReviewResult = {
  rows: PPDReviewRow[];
  // Internal contradictions found by the dedicated per-window hunt pass.
  contradictions?: PPDContradiction[];
  // A 2-4 sentence AI synthesis of the whole sub-criterion (strongest areas,
  // where the gaps are) — a roll-up, not a repeat of the per-line comments.
  // undefined if the narrative call failed or was skipped.
  overallNarrative?: string;
  usage?: AIUsage;
  promptSent?: string;
  windowsProcessed?: number;
  fullCoverage?: boolean;
  // Failed window/batch AI calls — the caller must surface these; a run with
  // errors must never present as a clean success (a revoked key mid-run used
  // to yield all-"Not documented" rows logged as successful).
  windowErrors?: string[];
  // True when the run was stopped/aborted before every line was reviewed.
  stoppedEarly?: boolean;
};

// Fix for the PPD-quote hallucination channel: the prompt asks for verbatim
// excerpts in double quotes, but nothing checked they exist in the source.
// This deterministic verifier extracts every substantial quoted span from a
// fullComment and substring-checks it against the (whitespace/quote-
// normalised) source text. Failing quotes are NOT dropped — the comment is
// annotated so the auditor knows the "quote" is unverified.
const QUOTE_MIN_CHARS = 20;
function normaliseForQuoteMatch(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
// Deterministic single-quote check for structured fields (promise
// sourceQuote, contradiction quoteA/quoteB) — same normalisation rules as
// flagUnverifiedQuotes. Short quotes pass (term names, "Adequate", etc.).
export function quoteExistsInSource(quote: string, sourceText: string): boolean {
  const inner = quote.replace(/^(\.{3}|…)\s*/, "").replace(/\s*(\.{3}|…)$/, "").trim();
  if (inner.length < QUOTE_MIN_CHARS) return true;
  const srcNorm = normaliseForQuoteMatch(sourceText);
  if (srcNorm.includes(normaliseForQuoteMatch(inner))) return true;
  // Elided quote ("start ... end"): models routinely shorten a long sentence
  // with a mid-quote ellipsis. Only the leading/trailing ellipses were being
  // stripped, so a genuinely-verbatim-except-elision quote failed and was
  // SILENTLY dropped — presenting downstream as "no exact quote" ("spread
  // across the document"). Accept it only when EVERY segment between
  // ellipses appears verbatim, in order, in the source — elision marks
  // omitted text, never licence to paraphrase.
  const segments = inner.split(/\s*(?:\.{3}|…)\s*/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return false;
  let pos = 0;
  for (const seg of segments) {
    if (seg.length < 8) return false; // tiny fragments prove nothing
    const idx = srcNorm.indexOf(normaliseForQuoteMatch(seg), pos);
    if (idx < 0) return false;
    pos = idx + normaliseForQuoteMatch(seg).length;
  }
  return true;
}

// A named clause reference counts as REAL only when it — or its leading heading
// segment, before the first comma — appears verbatim in the source (same
// anti-hallucination stance as quote verification). A model-tidied or invented
// reference fails this and is dropped, so the lineage map shows an honest
// em-dash rather than a clause an assessor would navigate to and never find.
// The comma fallback lets a legitimate "4.2 Heading, Step 1: Sub-heading"
// pass when the document splits heading and sub-heading across lines.
//
// Deliberately does NOT reuse quoteExistsInSource: that helper auto-passes
// any string under 20 chars (fine for incidental short quotes like term
// names), which for clauses meant every short reference — including bullet
// fragments like "- Responsibilities" (18 chars) — passed "verification"
// against ANY document without being checked at all (the real bug behind
// seven rows showing "- Responsibilities" as their Policy clause). A clause
// must actually appear in the source, whatever its length.
export function clauseAppearsInSource(clause: string, sourceText: string): boolean {
  const c = clause.trim();
  if (c.length < 4) return false;
  const srcNorm = normaliseForQuoteMatch(sourceText);
  if (srcNorm.includes(normaliseForQuoteMatch(c))) return true;
  const head = c.split(",")[0].trim();
  return head.length >= 4 && head !== c && srcNorm.includes(normaliseForQuoteMatch(head));
}

// Strips a leading numbered/bulleted section identifier (e.g. "7.3", "7.4(a)",
// "3.2.1") from a clause string, if the string starts with one — used ONLY as
// a SECOND verification attempt when the numbered form doesn't verify
// verbatim (the model may put whitespace/line-break differences between the
// number and heading that the source doesn't have). Falling back to the
// unnumbered heading here means asking the model for the number can never
// REGRESS a clause that would have verified fine unnumbered before this
// change — it either gains a verified number, keeps the plain heading it
// always had, or (same as before) drops to undefined. Returns undefined when
// the string has no recognisable leading number to strip.
function stripLeadingClauseNumber(clause: string): string | undefined {
  const m = clause.match(/^\(?\d+(?:\.\d+)*\)?\s*\(?[a-zA-Z]?\)?\s+(.+)$/);
  return m ? m[1].trim() : undefined;
}

// Full clause-reference verification used by the PPD parse: sanitise, then
// verify against source. A bare list marker ("- Responsibilities",
// "• Fees") is a bullet fragment, not a clause identifier — it is stripped
// BEFORE verification so it can neither render as a fake "heading" nor ride
// through on the marker-plus-text form. Real numbered identifiers
// ("7.3(a) Audit Report") are kept and verified as-is, with the
// number-stripped heading as the second-chance fallback (see
// stripLeadingClauseNumber). Returns the verified reference to display, or
// undefined when nothing verifies — never an unverified or marker-prefixed one.
export function verifyClauseRef(rawClause: string, sourceText: string): string | undefined {
  const stripped = rawClause.trim().replace(/^[-–—•*·▪◦>]+\s+/, "").trim();
  if (!stripped) return undefined;
  if (clauseAppearsInSource(stripped, sourceText)) return stripped;
  const unnumbered = stripLeadingClauseNumber(stripped);
  return unnumbered && clauseAppearsInSource(unnumbered, sourceText) ? unnumbered : undefined;
}
const UNVERIFIED_QUOTE_NOTE = " [⚠ unverified quote — not found in source]";

export function flagUnverifiedQuotes(fullComment: string, sourceText: string): string {
  if (!fullComment || !sourceText) return fullComment;
  const sourceNorm = normaliseForQuoteMatch(sourceText);
  const commentNorm = fullComment.replace(/[“”]/g, '"');
  const unverified: string[] = [];
  const quoteRe = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(commentNorm)) !== null) {
    // Strip the leading/trailing ellipses the prompt's example format uses —
    // they mark elision, not literal source characters.
    const inner = m[1].replace(/^(\.{3}|…)\s*/, "").replace(/\s*(\.{3}|…)$/, "").trim();
    if (inner.length < QUOTE_MIN_CHARS) continue; // skip short incidental quotes ("Adequate", term names)
    if (!sourceNorm.includes(normaliseForQuoteMatch(inner))) unverified.push(inner);
  }
  if (unverified.length === 0) return fullComment;
  const flags = unverified
    .slice(0, 3)
    .map((q) => `⚠ "${q.length > 80 ? `${q.slice(0, 80)}…` : q}" — unverified: not found in source.`)
    .join("\n");
  const more = unverified.length > 3 ? `\n⚠ …and ${unverified.length - 3} more unverified quote(s).` : "";
  return `${fullComment}\n\n${flags}${more}`;
}

// Purely-observational live events emitted as the review proceeds, so the UI
// can show a detailed activity view (same idea as EvidenceRunEvent above).
// Emitting them changes no assessment behaviour — they mirror the window/
// batch loop the run already performs.
export type PPDRunEvent =
  // chunkIds: the chunk IDs this window's text actually contains, so the
  // caller can resolve which source files the in-flight call covers.
  // stage: which pass this window/batch belongs to — "extract" (Pass 1,
  // finding candidate passages) or "judge" (Pass 2, deciding verdicts from
  // the verified pool) — so a caller diagnosing a failure (or building a
  // live view) knows WHICH call was in flight, not just that "PPD" failed.
  | { type: "window-start"; window: { current: number; total: number }; refs: string[]; chunkIds: string[]; stage: "extract" | "judge" }
  | { type: "batch-done"; verdicts: { ref: string; verdict: PPDVerdict }[] }
  // error: the real failure reason (exception message, or "no parseable
  // verdicts" for a malformed/empty reply) — never just "it failed".
  | { type: "batch-failed"; refs: string[]; error: string; stage: "extract" | "judge" };

export async function runPPDRequirementsReview(
  requirements: PPDRequirementInput[],
  policyDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; onProgress?: (detail: string) => void; onEvent?: (ev: PPDRunEvent) => void; shouldStop?: () => boolean; signal?: AbortSignal; onCallAbort?: CallAbortReg } = {}
): Promise<PPDRequirementsReviewResult> {
  if (requirements.length === 0 || !policyDocText.trim()) {
    return {
      rows: requirements.map((r) => ({
        ref: r.ref,
        gd4ItemId: r.gd4ItemId,
        requirementText: r.requirementText,
        verdict: "Not documented" as PPDVerdict,
        shortComment: "No Policy & Procedure documents were provided.",
        fullComment: "No Policy & Procedure documents were found for this sub-criterion, so this requirement cannot be assessed as documented.",
        chunkIds: [],
      })),
    };
  }

  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";

  // ── Pass 1 (EXTRACT) system prompt: find + copy passages, NO verdicts. ──
  // Built per actual AI call (inside the loops below): buildSystemPrompt() has
  // a dev-only AI Debug Log side effect, and every real chatComplete() call
  // should get its own debug-log entry. Extraction gets the skills/domain
  // blocks (they aid recall and verbatim discipline) but NOT the calibration/
  // memories/rule injections — those shape VERDICTS, which are the judge's.
  const extractSystem = (label: string) => `You are the EXTRACTION pass of a two-pass SSG EduTrust review of a PEI's Policy & Procedure Document (PPD). Your ONLY job is to find and copy out the PPD passages relevant to each GD4 requirement line below. You give NO verdicts — a separate judge decides from what you extract, and a passage you miss is invisible to it, so include every passage that even partially addresses a line.

For each requirement line return:
- candidates: one entry per relevant passage —
  - quote: ONE sentence (or short contiguous passage) copied VERBATIM, character-for-character. Never paraphrase, tidy, merge or invent text.
  - clause: the section/clause heading the passage sits under, copied exactly as printed, INCLUDING its leading number if the document prints one (e.g. "7.3(a) Audit Report"); "" when no identifiable heading exists. Never construct, renumber or tidy a reference. A bare list dash/bullet ("- ", "• ") is a list marker, not a clause identifier — never include it.
  - chunkId: the chunk ID from the document header the quote came from (e.g. "C001").
  - aspect: 3-8 words naming which part of the requirement this passage addresses.
- promises: every specific, verifiable commitment the PPD makes for this line — named mechanisms ("peer reviews"), frequencies ("annually", "within 5 working days"), scopes ("all part-time academic staff"), named roles, named records — each with its VERBATIM sourceQuote and chunkId. These are verified against implementation records in a later pass; extract only what the PPD actually commits to, never invent.

An empty candidates array is the correct answer when nothing in this window addresses the line.

Respond with JSON only:
{"results": [{"ref": string, "candidates": [{"aspect": string, "quote": string, "clause": string, "chunkId": string}], "promises": [{"promiseText": string, "sourceQuote": string, "chunkId": string}]}]}${buildSystemPrompt("ppdReview", null, label, opts.criterionId, domainSkill)}${domainBlock}`;

  // ── Pass 2 (JUDGE) system prompt: verdicts from VERIFIED extracts only. ──
  // The rubric is stated ONCE, and its core is REPEATED at the very end of the
  // prompt (after the knowledge-base/domain injections) — recency measurably
  // improves instruction-following on long prompts.
  const judgeSystem = (label: string) => `You are an SSG EduTrust assessor deciding whether a PEI's Policy & Procedure Document (PPD) documents each GD4 requirement line. You are NOT given the document. For each line you are given the complete set of VERIFIED passages an extraction pass found in the PPD — every quote is a confirmed verbatim excerpt (shown with its section heading and chunk ID where identified). Decide strictly from these passages: if support for an obligation is not among them, that obligation is NOT documented — never assume unshown text exists, and never soften a gap because the document "probably" covers it elsewhere.

DECIDE EACH LINE IN THREE STEPS:

STEP 1 — DECOMPOSE the line into its sub-clauses: the explicit (a)/(b)/(c) parts if present, otherwise each distinct obligation in the sentence.

STEP 2 — VERDICT each sub-clause "documented" or "not documented". "Documented" ONLY when at least one given passage establishes that obligation clearly, specifically and sustainably (named responsible role, what they do, when/how often, what record is produced). For a documented sub-clause: quote = the ONE best supporting passage copied EXACTLY as given (or, when several passages together support it, leave quote empty and list them in spreadQuotes, each copied exactly with its chunkId); clause and chunkId = that passage's heading and chunk ID as given ("" where none was shown); rationale = one short auditor-register sentence on WHY. A "not documented" sub-clause gets an empty quote — never invent one or reuse another sub-clause's.

STEP 3 — LINE VERDICT from the sub-clauses:
- "Adequate" = EVERY sub-clause documented (per STEP 2's bar).
- "Partial" = some sub-clauses documented, others missing or vague — the comment MUST name exactly which are missing (e.g. "Sub-clause (b) — non-collection of monies from students — is not addressed in any PPD passage.").
- "Not documented" = no sub-clause is addressed at all.
When unsure between two adjacent verdicts, choose the LOWER one.

${PPD_BOUNDARY_RULES}

PHRASING REGISTER (mandatory):
- Negatives use the official SSG register: "It was not evident that the PEI had documented [the specific process/sub-clause(s)] in its PPD…" — name the specific missing obligations, listing sub-clauses where multiple.
- Positives stay factual and specific (what is documented, in which clause) — no praise adjectives.

For each line return:
- subClauses: the STEP 1-2 decomposition, one entry per sub-clause, text naming that obligation tightly (by what it IS, e.g. "Manpower planning").
- verdict: "Adequate" | "Partial" | "Not documented" — per STEP 3.
- shortComment: MANDATORY for every verdict, never blank — one sentence stating WHY ("Documented, because…" is exactly as required as a negative's reason).
- fullComment: (1) the justification — for Adequate, the named owner, mechanism, frequency or record that satisfies it; for Partial/Not documented, the SSG register naming each missing sub-clause; then (2) a verbatim quoted excerpt in double quotes with its chunk ID, e.g. "...auditors must be independent of the area they audit..." (C001) — for Not documented, state that no PPD passage addresses this requirement instead.
- suggestedRewrite: for Partial/Not documented ONLY — a concrete, institution-ready PPD paragraph closing the gap (responsible role, frequency, record). Empty string for Adequate.
- chunkIds: the chunk IDs of the passages the verdict relies on. Empty if none — never invent a chunk ID.
- supportQuote: for Adequate/Partial ONLY — the single given passage that most directly documents the line, copied exactly, or "" when none/spread.

Respond with JSON only:
{"results": [{"ref": string, "subClauses": [{"text": string, "verdict": "documented"|"not documented", "quote": string, "spreadQuotes": [{"quote": string, "chunkId": string}], "clause": string, "rationale": string, "chunkId": string}], "verdict": "Adequate"|"Partial"|"Not documented", "shortComment": string, "fullComment": string, "suggestedRewrite": string, "chunkIds": string[], "supportQuote": string}]}${buildSystemPrompt("ppdReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

## Final verdict rubric (repeated last so it is freshest — this is the decision rule)
- "Adequate" = EVERY sub-clause documented clearly, specifically and sustainably (named role, what, when/how often, what record) by the verified passages given.
- "Partial" = some sub-clauses documented, others missing or vague — name the missing ones.
- "Not documented" = no sub-clause addressed by any given passage.
- Judge ONLY from the verified passages. Ties resolve DOWN. The DETERMINISTIC BOUNDARY RULES override general judgement.`;

  // Technique 2 — internal contradiction hunt. Run as its OWN pass per
  // window (not folded into the per-requirement prompt) so the requirement
  // batches stay within budget and the hunt reads the window whole.
  const contradictionSystem = (label: string) => `You are an SSG EduTrust assessor reading a PEI's Policy & Procedure Document looking ONLY for INTERNAL CONTRADICTIONS: places where the PPD states two inconsistent values, timelines, percentages, responsibilities, or procedures for the SAME thing (e.g. a refund processed "within 5 working days" in one section and "within 3 working days" in another; two different owners for the same process; two different review frequencies for the same record).

Rules:
- Only report REAL inconsistencies about the same subject — different processes legitimately having different timelines is NOT a contradiction.
- Each contradiction must carry BOTH passages quoted verbatim in double quotes with their chunk IDs. Never invent or paraphrase inside the quotes.
- description: one factual sentence naming the subject and the two conflicting values, in the SSG register (e.g. "The PPD states two different refund timelines for the same process: 'within 5 working days' and 'within 3 working days'.").
- Report nothing if the window contains no contradiction — an empty array is the correct answer for a consistent PPD.

Respond with JSON only: {"contradictions": [{"description": string, "quoteA": string, "chunkA": string, "quoteB": string, "chunkB": string}]}${buildSystemPrompt("ppdReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;

  const windows = buildDocWindows(policyDocText);

  // ── Pass 1 state: verified candidates + promises, pooled across windows. ──
  type PPDCandidate = { aspect: string; quote: string; clause?: string; chunkId?: string };
  const candByRef = new Map<string, PPDCandidate[]>();
  const candKeys = new Set<string>(); // "ref::normalised-quote" — cross-window dedupe
  const promisesByRef = new Map<string, PPDPromise[]>();
  // Refs an extraction call actually covered successfully at least once, vs.
  // refs covered ONLY by failed calls — for the latter, "no candidates" is
  // missing data, never a real absence.
  const extractedOk = new Set<string>();
  const extractFailedRefs = new Set<string>();
  // How many candidates the model RETURNED per ref, before verification —
  // pooled across windows. "Returned 4, none verified" is an extraction/
  // verification defect and must never be presented as "nothing in the
  // document addresses this line" (the silent conflation behind the
  // measured collapse-to-Not-met investigation).
  const rawCandidateCount = new Map<string, number>();

  const addCandidate = (ref: string, cand: PPDCandidate) => {
    const key = `${ref}::${normaliseForQuoteMatch(cand.quote)}`;
    if (candKeys.has(key)) return;
    candKeys.add(key);
    const list = candByRef.get(ref) ?? [];
    list.push(cand);
    candByRef.set(ref, list);
  };

  // Contradictions merged across windows, deduped on the two quotes.
  const contradictions: PPDContradiction[] = [];
  const contradictionKeys = new Set<string>();

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let windowsCompleted = 0;
  const windowErrors: string[] = [];
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: PPDRequirementInput[][] = [];
  for (let i = 0; i < requirements.length; i += REQ_BATCH_SIZE) {
    batches.push(requirements.slice(i, i + REQ_BATCH_SIZE));
  }

  // ── Pass 1 — EXTRACT: window × batch; verify and pool candidates. ──
  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()}]` : "";

    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      opts.onProgress?.(`PPD extraction — window ${win.index + 1}/${win.total} · batch ${bi + 1}/${batches.length}`);
      opts.onEvent?.({ type: "window-start", window: { current: win.index + 1, total: win.total }, refs: batch.map((r) => r.ref), chunkIds: chunkIdsInWindow(win.text), stage: "extract" });
      const pointsBlock = batch.map((r, i) => `[${r.ref}] (${i + 1}) ${r.requirementText}`).join("\n");
      const user = `Policy & Procedure documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nExtract the relevant PPD passages and promises for each GD4 requirement line:\n${pointsBlock}`;
      const system = extractSystem(windows.length > 1 ? `runPPDRequirementsReview (extract, window ${win.index + 1}/${win.total})` : "runPPDRequirementsReview (extract)");
      if (!firstPromptSent) firstPromptSent = `SYSTEM (extract):\n${system}\n\nUSER:\n${user}`;
      try {
        const raced = await raceCallSkip(opts.onCallAbort, chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { schema: PPD_EXTRACT_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        ));
        if (raced === CALL_SKIPPED) {
          const label = windows.length > 1 ? `PPD extraction window ${win.index + 1}/${win.total}, batch ${bi + 1}/${batches.length}` : `PPD extraction batch ${bi + 1}/${batches.length}`;
          windowErrors.push(`${label} skipped by user — its points fall through to other windows or are marked not assessed.`);
          for (const r of batch) if (!extractedOk.has(r.ref)) extractFailedRefs.add(r.ref);
          opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref), error: "Skipped by user.", stage: "extract" });
          continue;
        }
        const content = raced;
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        // The call RETURNED but nothing parseable came back — a failure per
        // "never fabricate from failures" (same rule as the old single pass),
        // never silently treated as "nothing found".
        if (results.length === 0) {
          const label = windows.length > 1 ? `PPD extraction window ${win.index + 1}/${win.total}, batch ${bi + 1}/${batches.length}` : `PPD extraction batch ${bi + 1}/${batches.length}`;
          windowErrors.push(`${label} returned no parseable passages — the AI reply was empty or not valid JSON.`);
          console.error("[PPDRequirementsReview]", label, "no parseable results");
          for (const r of batch) if (!extractedOk.has(r.ref)) extractFailedRefs.add(r.ref);
          opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref), error: "The AI reply was empty or not valid JSON — no passages could be parsed from it.", stage: "extract" });
          continue;
        }
        const byRef = new Map(results.map((x) => [normalizeAuditRef(String(x.ref ?? "")), x]));
        for (const [idx, r] of batch.entries()) {
          // Positional recovery: some models keep the order but drop "ref" —
          // same fallback as the old single pass.
          const res = byRef.get(normalizeAuditRef(r.ref)) ?? (results.length === batch.length ? results[idx] : undefined);
          if (!res) continue;
          extractedOk.add(r.ref);
          extractFailedRefs.delete(r.ref);
          // A candidate survives ONLY when its quote verifies as a real
          // verbatim excerpt — the judge must never see a passage that is not
          // actually in the PPD (deterministic gate, not an AI opinion).
          const rawCands = Array.isArray(res.candidates) ? res.candidates as Array<Record<string, unknown>> : [];
          rawCandidateCount.set(r.ref, (rawCandidateCount.get(r.ref) ?? 0) + rawCands.length);
          for (const c of rawCands) {
            const quote = typeof c.quote === "string" ? c.quote.trim() : "";
            if (!quote || !quoteExistsInSource(quote, policyDocText)) continue;
            const rawClause = typeof c.clause === "string" ? c.clause.trim() : "";
            addCandidate(r.ref, {
              aspect: typeof c.aspect === "string" ? c.aspect.trim() : "",
              quote,
              // Clause verified the same way as before (verifyClauseRef strips
              // list markers, falls back to the number-stripped heading).
              clause: rawClause ? verifyClauseRef(rawClause, policyDocText) : undefined,
              chunkId: typeof c.chunkId === "string" && c.chunkId.trim() ? c.chunkId.trim() : undefined,
            });
          }
          // Promises: verified/annotated exactly as before, pooled + deduped
          // on promiseText. A promise whose sourceQuote verifies is ALSO
          // pooled as a candidate — a line carrying a verified commitment
          // quote cannot honestly be scored "no passage found".
          const rawPromises = Array.isArray(res.promises) ? res.promises as Array<Record<string, unknown>> : [];
          const pooled = promisesByRef.get(r.ref) ?? [];
          for (const pr of rawPromises) {
            if (typeof pr?.promiseText !== "string" || !pr.promiseText) continue;
            if (pooled.some((q) => q.promiseText === pr.promiseText)) continue;
            const sourceQuote = typeof pr.sourceQuote === "string" ? pr.sourceQuote : "";
            const verified = !!sourceQuote && quoteExistsInSource(sourceQuote, policyDocText);
            pooled.push({
              promiseText: pr.promiseText,
              sourceQuote: sourceQuote && !verified ? `${sourceQuote}${UNVERIFIED_QUOTE_NOTE}` : sourceQuote,
              chunkId: typeof pr.chunkId === "string" ? pr.chunkId : "",
            });
            if (verified) addCandidate(r.ref, { aspect: "PPD commitment", quote: sourceQuote.trim(), chunkId: typeof pr.chunkId === "string" && pr.chunkId.trim() ? pr.chunkId.trim() : undefined });
          }
          promisesByRef.set(r.ref, pooled);
        }
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `PPD extraction window ${win.index + 1}/${win.total}, batch ${bi + 1}/${batches.length}` : `PPD extraction batch ${bi + 1}/${batches.length}`;
        windowErrors.push(`${label} failed — ${msg}`);
        console.error("[PPDRequirementsReview]", label, msg);
        for (const r of batch) if (!extractedOk.has(r.ref)) extractFailedRefs.add(r.ref);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref), error: msg, stage: "extract" });
      }
    }
    if (stoppedEarly) break;

    // Technique 2 — internal contradiction hunt, one dedicated call per
    // window. Best-effort: a failed hunt is a warning, never a fake finding.
    if (!stopRequested()) {
      opts.onProgress?.(`PPD contradiction hunt — window ${win.index + 1}/${win.total}`);
      const huntLabel = windows.length > 1 ? `runPPDRequirementsReview (contradiction hunt, window ${win.index + 1}/${win.total})` : "runPPDRequirementsReview (contradiction hunt)";
      try {
        const content = await chatComplete(
          [
            { role: "system", content: contradictionSystem(huntLabel) },
            { role: "user", content: `Policy & Procedure documents (chunk IDs in headers)${windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}]` : ""}:\n"""\n${win.text}\n"""\n\nList every internal contradiction, or an empty array if there are none.` },
          ],
          settings,
          { schema: PPD_CONTRADICTION_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        );
        const parsed = parseJSONObject(content);
        const found = Array.isArray(parsed.contradictions) ? parsed.contradictions as Array<Record<string, unknown>> : [];
        for (const c of found) {
          if (typeof c?.description !== "string" || !c.description.trim()) continue;
          const quoteA = typeof c.quoteA === "string" ? c.quoteA : "";
          const quoteB = typeof c.quoteB === "string" ? c.quoteB : "";
          const key = normaliseForQuoteMatch(`${quoteA}::${quoteB}`);
          if (contradictionKeys.has(key)) continue;
          contradictionKeys.add(key);
          contradictions.push({
            description: c.description.trim(),
            quoteA: quoteA && !quoteExistsInSource(quoteA, policyDocText) ? `${quoteA}${UNVERIFIED_QUOTE_NOTE}` : quoteA,
            chunkA: typeof c.chunkA === "string" ? c.chunkA : "",
            quoteB: quoteB && !quoteExistsInSource(quoteB, policyDocText) ? `${quoteB}${UNVERIFIED_QUOTE_NOTE}` : quoteB,
            chunkB: typeof c.chunkB === "string" ? c.chunkB : "",
          });
        }
      } catch (err) {
        if (stopRequested()) { stoppedEarly = true; break; }
        windowErrors.push(`Contradiction hunt (window ${win.index + 1}/${win.total}) failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    windowsCompleted++;
  }

  // ── Pass 2 — JUDGE: verdicts from the verified pool, ONCE per line. ──
  type JudgedPPD = { verdict: PPDVerdict; shortComment: string; fullComment: string; suggestedRewrite?: string; chunkIds: string[]; subClauses?: PPDSubClause[]; supportQuote?: string };
  const judgedByRef = new Map<string, JudgedPPD>();
  const judgeFailedRefs = new Set<string>();

  // Only lines with at least one verified passage go to the judge. A line
  // with NO verified passages is decided deterministically below ("Not
  // documented") — asking a model to judge empty input invites invention.
  const judgeInputs = requirements.filter((r) => (candByRef.get(r.ref)?.length ?? 0) > 0);
  const judgeBatches: PPDRequirementInput[][] = [];
  for (let i = 0; i < judgeInputs.length; i += REQ_BATCH_SIZE) judgeBatches.push(judgeInputs.slice(i, i + REQ_BATCH_SIZE));

  for (const [bi, batch] of judgeBatches.entries()) {
    if (stopRequested()) { stoppedEarly = true; break; }
    opts.onProgress?.(`PPD verdicts — batch ${bi + 1}/${judgeBatches.length} (judging verified extracts)`);
    const pointsBlock = batch.map((r, i) => {
      const cands = candByRef.get(r.ref) ?? [];
      const candLines = cands.map((c, ci) => `   (${ci + 1}) [${c.chunkId ?? "no chunk"}${c.clause ? ` · ${c.clause}` : ""}]${c.aspect ? ` (${c.aspect})` : ""} "${c.quote}"`).join("\n");
      return `[${r.ref}] (${i + 1}) ${r.requirementText}\n  Verified PPD passages:\n${candLines}`;
    }).join("\n\n");
    const user = `Requirement lines with the verified PPD passages found for each:\n\n${pointsBlock}\n\nDecide each line's PPD documentation verdict strictly from its verified passages.`;
    const system = judgeSystem(judgeBatches.length > 1 ? `runPPDRequirementsReview (judge, batch ${bi + 1}/${judgeBatches.length})` : "runPPDRequirementsReview (judge)");
    if (firstPromptSent && !firstPromptSent.includes("SYSTEM (judge):")) firstPromptSent += `\n\n════════ SECOND PASS (judge) ════════\n\nSYSTEM (judge):\n${system}\n\nUSER:\n${user}`;
    try {
      const content = await chatComplete(
        [{ role: "system", content: system }, { role: "user", content: user }],
        settings,
        { schema: PPD_JUDGE_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: judgeTimeoutMs(user.length), signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
      if (results.length === 0) {
        windowErrors.push(`PPD judge batch ${bi + 1}/${judgeBatches.length} returned no parseable verdicts — the AI reply was empty or not valid JSON.`);
        console.error("[PPDRequirementsReview]", `judge batch ${bi + 1}`, "no parseable results");
        for (const r of batch) judgeFailedRefs.add(r.ref);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref), error: "The AI reply was empty or not valid JSON — no verdicts could be parsed from it.", stage: "judge" });
        continue;
      }
      const byRef = new Map(results.map((x) => [normalizeAuditRef(String(x.ref ?? "")), x]));
      const batchVerdicts: { ref: string; verdict: PPDVerdict }[] = [];
      for (const [idx, r] of batch.entries()) {
        const res = byRef.get(normalizeAuditRef(r.ref)) ?? (results.length === batch.length ? results[idx] : undefined);
        if (!res) {
          // Nothing came back for this specific ref — honest "Not assessed"
          // (the old code defaulted this to a fabricated "Not documented").
          judgeFailedRefs.add(r.ref);
          continue;
        }
        const verdict = (["Adequate", "Partial", "Not documented"] as PPDVerdict[]).includes(res.verdict as PPDVerdict)
          ? (res.verdict as PPDVerdict) : "Not documented";
        const shortComment = typeof res.shortComment === "string" ? res.shortComment : "";
        const fullComment = typeof res.fullComment === "string" ? res.fullComment : "";
        const suggestedRewrite = typeof res.suggestedRewrite === "string" && res.suggestedRewrite.trim() ? res.suggestedRewrite : undefined;
        const chunkIds = Array.isArray(res.chunkIds) ? (res.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
        // Exact supporting quote — stored ONLY when it verifies as a real
        // verbatim excerpt of the policy text (the judge is instructed to copy
        // candidates exactly, but defence in depth stays).
        const rawSupportQuote = typeof res.supportQuote === "string" ? res.supportQuote.trim() : "";
        const supportQuote = rawSupportQuote && quoteExistsInSource(rawSupportQuote, policyDocText) ? rawSupportQuote : undefined;
        // Per-sub-clause quote/spreadQuotes/clause: verified against the full
        // policy text — a sub-clause quote that isn't a real verbatim substring
        // is dropped to undefined, never stored as a fabricated match.
        const subClauses: PPDSubClause[] = Array.isArray(res.subClauses)
          ? (res.subClauses as Array<Record<string, unknown>>)
              .filter((c) => typeof c?.text === "string" && (c?.verdict === "documented" || c?.verdict === "not documented"))
              .map((c) => {
                const rawQuote = typeof c.quote === "string" ? c.quote.trim() : "";
                const quote = rawQuote && quoteExistsInSource(rawQuote, policyDocText) ? rawQuote : undefined;
                const spreadQuotes: PPDSubClause["spreadQuotes"] = Array.isArray(c.spreadQuotes)
                  ? (c.spreadQuotes as Array<Record<string, unknown>>)
                      .map((sq) => ({
                        quote: typeof sq?.quote === "string" ? sq.quote.trim() : "",
                        chunkId: typeof sq?.chunkId === "string" && sq.chunkId.trim() ? sq.chunkId.trim() : undefined,
                      }))
                      .filter((sq) => sq.quote && quoteExistsInSource(sq.quote, policyDocText))
                  : [];
                const rawClause = typeof c.clause === "string" ? c.clause.trim() : "";
                const clause = rawClause ? verifyClauseRef(rawClause, policyDocText) : undefined;
                const rationale = typeof c.rationale === "string" && c.rationale.trim() ? c.rationale.trim() : undefined;
                const chunkId = typeof c.chunkId === "string" && c.chunkId.trim() ? c.chunkId.trim() : undefined;
                // The model DID cite support but none of it verified — a
                // materially different state from "no single passage exists";
                // the UI must not present it as the honest "spread across the
                // document" note.
                const rawSpreadCount = Array.isArray(c.spreadQuotes) ? (c.spreadQuotes as unknown[]).length : 0;
                const quoteUnverified = (!!rawQuote || rawSpreadCount > 0) && !quote && spreadQuotes.length === 0 ? true : undefined;
                return { text: c.text as string, verdict: c.verdict as PPDSubClause["verdict"], quote, spreadQuotes: spreadQuotes.length > 0 ? spreadQuotes : undefined, clause, rationale, chunkId, quoteUnverified };
              })
          : [];
        judgedByRef.set(r.ref, { verdict, shortComment, fullComment, suggestedRewrite, chunkIds, subClauses: subClauses.length > 0 ? subClauses : undefined, supportQuote });
        batchVerdicts.push({ ref: r.ref, verdict });
      }
      opts.onEvent?.({ type: "batch-done", verdicts: batchVerdicts });
    } catch (err) {
      if (stopRequested()) { stoppedEarly = true; break; }
      const msg = err instanceof Error ? err.message : String(err);
      windowErrors.push(`PPD judge batch ${bi + 1}/${judgeBatches.length} failed — ${msg}`);
      console.error("[PPDRequirementsReview]", "judge batch failed", msg);
      for (const r of batch) judgeFailedRefs.add(r.ref);
      opts.onEvent?.({ type: "batch-failed", refs: batch.map((r) => r.ref), error: msg, stage: "judge" });
    }
  }

  const rows: PPDReviewRow[] = requirements.map((r) => {
    const judged = judgedByRef.get(r.ref);
    const pooledPromises = promisesByRef.get(r.ref);
    // Pass 1 visibility on every row: how many candidate passages the model
    // returned for this line vs how many survived verbatim verification.
    // "N raw → 0 verified" and "0 raw" are different diagnoses and must
    // never be conflated (see the branches below).
    const extractionStats = { raw: rawCandidateCount.get(r.ref) ?? 0, verified: candByRef.get(r.ref)?.length ?? 0 };
    if (!judged) {
      const hadCandidates = extractionStats.verified > 0;
      // A line never decided: its judge call failed / the run stopped (it had
      // candidates), or extraction never covered it. Honest "Not assessed" —
      // NOT a fabricated "Not documented" gap.
      if (hadCandidates || judgeFailedRefs.has(r.ref) || extractFailedRefs.has(r.ref) || stoppedEarly) {
        const stopped = stoppedEarly && !judgeFailedRefs.has(r.ref) && !extractFailedRefs.has(r.ref);
        return {
          ref: r.ref,
          gd4ItemId: r.gd4ItemId,
          requirementText: r.requirementText,
          verdict: "Not assessed" as PPDVerdict,
          shortComment: stopped ? "Not assessed — the run was stopped before this line was reviewed." : "Not assessed — the AI call covering this line failed.",
          fullComment: stopped
            ? "Not assessed — the run was stopped before this requirement line was reviewed. Re-run the PPD review to assess it."
            : "Not assessed — the AI call covering this requirement line failed. Re-run the PPD review to assess it.",
          chunkIds: [],
          extractionStats,
        };
      }
      // The model DID return passages but NONE verified as verbatim source
      // text. That is an extraction/verification defect (paraphrased quotes,
      // OCR-mangled source), NOT proof the requirement is undocumented —
      // ruling "Not documented" here would fabricate a gap from a pipeline
      // failure, so the honest verdict is "Not assessed".
      if (extractionStats.raw > 0) {
        return {
          ref: r.ref,
          gd4ItemId: r.gd4ItemId,
          requirementText: r.requirementText,
          verdict: "Not assessed" as PPDVerdict,
          shortComment: `Not assessed — the extraction pass returned ${extractionStats.raw} passage${extractionStats.raw === 1 ? "" : "s"} for this line but none verified as verbatim source text.`,
          fullComment: `Not assessed — the extraction pass returned ${extractionStats.raw} candidate passage${extractionStats.raw === 1 ? "" : "s"} for this requirement, but none could be verified as an exact excerpt of the source documents, so no verdict was reached. This usually means the model paraphrased its quotes instead of copying them, or the document text reached the app in a form the verifier cannot match (e.g. OCR/vision artifacts). Re-run the PPD review; if it persists, this is an extraction defect — NOT evidence that the requirement is undocumented.`,
          chunkIds: [],
          extractionStats,
        };
      }
      // Extraction covered this line cleanly and the model returned ZERO
      // candidates — a deterministic "Not documented", not an AI coin-flip
      // on empty input.
      return {
        ref: r.ref,
        gd4ItemId: r.gd4ItemId,
        requirementText: r.requirementText,
        verdict: "Not documented" as PPDVerdict,
        shortComment: "It was not evident that the PEI had documented this requirement in its PPD — no relevant passage was found.",
        fullComment: "It was not evident that the PEI had documented this requirement in its PPD. The extraction pass read every provided Policy & Procedure document and returned no candidate passage for this requirement (0 extracted).",
        chunkIds: [],
        promises: pooledPromises?.length ? pooledPromises : undefined,
        extractionStats,
      };
    }
    // An "Adequate" verdict that cannot point at any supporting PPD chunk is
    // downgraded to "Partial" — same uncited-positive rule as buildStagedApsr.
    const uncitedAdequate = judged.verdict === "Adequate" && judged.chunkIds.length === 0;
    let verdict: PPDVerdict = uncitedAdequate ? "Partial" : judged.verdict;
    // Quote verification: annotate any quoted excerpt that does not exist
    // verbatim in the source, so hallucinated "quotes" can't pass as real.
    let verifiedComment = flagUnverifiedQuotes(
      uncitedAdequate ? `${judged.fullComment || ""}\n\n${UNCITED_DOWNGRADE_NOTE}` : (judged.fullComment || ""),
      policyDocText
    );
    let shortComment = judged.shortComment || "";
    // Verdict/comment self-consistency guard — skipped when the uncited-
    // Adequate gate above already fired: that gate's own appended note
    // already explains its downgrade, and checking the now-stale ORIGINAL
    // comment (which legitimately concluded "Adequate" before the downgrade)
    // against the NEW "Partial" verdict would misfire on the gate's own work.
    if (!uncitedAdequate) {
      const mismatch = conclusionMismatch(verdict === "Adequate", verifiedComment);
      if (mismatch) {
        const originalVerdict = verdict;
        verdict = "Not assessed";
        shortComment = `Not assessed — the model's verdict ("${originalVerdict}") and its own comment's stated conclusion ("${mismatch}") disagreed. Re-run to get a consistent assessment.`;
        verifiedComment = `${verifiedComment}\n\n⚠ Verdict/comment mismatch: the model returned verdict "${originalVerdict}" but its own comment concluded "${mismatch}". Re-run to get a consistent assessment.`;
      }
    }
    return {
      ref: r.ref,
      gd4ItemId: r.gd4ItemId,
      requirementText: r.requirementText,
      verdict,
      shortComment,
      fullComment: verifiedComment,
      suggestedRewrite: judged.suggestedRewrite,
      chunkIds: judged.chunkIds,
      subClauses: judged.subClauses,
      promises: pooledPromises?.length ? pooledPromises : undefined,
      // Only carry the exact quote for a positive, cited verdict — a downgraded
      // or Not-documented line shows the passage without a (stale) highlight.
      supportQuote: (verdict === "Adequate" || verdict === "Partial") ? judged.supportQuote : undefined,
      extractionStats,
    };
  });

  // One extra AI call synthesising the whole sub-criterion into a 2-4
  // sentence roll-up — the per-line verdicts feed it, so no document re-read
  // is needed. Best-effort: a failure here leaves overallNarrative undefined
  // and the UI falls back to a deterministic summary. Skipped if the run was
  // stopped mid-way (partial rows would make a misleading synthesis).
  let overallNarrative: string | undefined;
  if (!stopRequested() && !stoppedEarly) {
    opts.onProgress?.("PPD requirements review — overall synthesis");
    const lineDigest = rows.map((r) => `[${r.ref}] ${r.verdict}: ${r.requirementText} — ${r.shortComment}`).join("\n");
    const narrativeSystem = `You are writing a short overall roll-up of a PPD (Policy & Procedure Document) requirements review for one GD4 EduTrust sub-criterion. You are given the per-requirement-line verdicts already decided ("Adequate" / "Partial" / "Not documented"). Write a 2-4 sentence synthesis of the sub-criterion AS A WHOLE: whether the PPD documents this sub-criterion's requirements overall, which areas are strongest (documented), and where the gaps are (Partial / Not documented lines). This is a roll-up — do NOT repeat each line's comment verbatim. Keep it factual and neutral: state what is documented and what is missing; do not editorialise with words like "good"/"poor"/"excellent". Respond with JSON only: {"narrative": string}.${buildSystemPrompt("ppdReview", null, "runPPDRequirementsReview (overall synthesis)", opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}`;
    const narrativeUser = `Per-requirement-line verdicts for this sub-criterion:\n${lineDigest}\n\nWrite the overall roll-up narrative.`;
    try {
      // Generative (fixed): a 2-4 sentence roll-up NARRATIVE synthesising the
      // already-decided line verdicts — prose, not itself a verdict. The
      // per-line verdicts above (which the consistency test measures) use the
      // tunable verdictTemperature; this summary does not affect them.
      const content = await chatComplete(
        [{ role: "system", content: narrativeSystem }, { role: "user", content: narrativeUser }],
        settings,
        { temperature: 0.2, onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      if (typeof parsed.narrative === "string" && parsed.narrative.trim()) overallNarrative = parsed.narrative.trim();
    } catch (err) {
      if (!stopRequested()) {
        windowErrors.push(`Overall synthesis call failed — ${err instanceof Error ? err.message : String(err)}`);
      }
      console.error("[PPDRequirementsReview] overall synthesis failed", err instanceof Error ? err.message : String(err));
    }
  }

  return {
    rows,
    contradictions,
    overallNarrative,
    usage,
    promptSent: firstPromptSent,
    windowsProcessed: windowsCompleted,
    fullCoverage: !stoppedEarly && windowsCompleted === windows.length,
    windowErrors: windowErrors.length > 0 ? windowErrors : undefined,
    stoppedEarly: stoppedEarly || undefined,
  };
}

// ─── Evidence Assessment (Option A, Evidence tab) ───────────────────────────
// For each GD4 requirement line: takes the PPD verdict ALREADY decided by the
// PPD Requirements Review (does NOT re-assess the policy), reads the Actual
// Evidence documents (sliding window, same mechanism as the staged evidence
// pass), and returns a combined verdict: documented AND implemented -> "Met";
// documented but not evidenced -> "Partial"; neither -> "Not met". Same
// division of responsibility as every other function here — the store does
// the folder reading/logging, this makes the AI call(s).

export type EvidenceAssessmentInput = {
  ref: string;
  requirementText: string;
  ppdVerdict: PPDVerdict;
  ppdExtract: string;
  promises?: PPDPromise[];
  // Flagged pre-analysis checklist items for this line — either an auto
  // detection that returned "flag", or a manual item the user ticked as a
  // confirmed concern. Advisory context ONLY: the assessor forms its own
  // independent judgement (see the prompt wording below); this is never an
  // instruction and never overrides the verdict logic. Clean/unflagged items
  // are omitted entirely so they add no prompt noise.
  preCheckFlags?: string[];
};

export type EvidenceAssessmentLineResult = {
  ref: string;
  evidenceSummary: string;
  verdict: EvidenceVerdict;
  comment: string;
  chunkIds: string[];
  failed?: boolean;
  // Per-PPD-promise verification (Technique 3 — "not implemented in
  // accordance with its documented PPD").
  promiseChecks?: PromiseCheck[];
  // Exact verbatim excerpt from the cited evidence proving implementation —
  // verified real substring, or absent ("no exact quote identified").
  evidenceQuote?: string;
  // "What would make this Met" — grounded in the SAME gap comment/promiseChecks
  // already identified, never a generic template. Only ever populated for
  // Partial/Not met (empty string for Met, per the prompt's own honesty rule).
  suggestedAction?: string;
  // Pass 1 visibility: candidate passages the extraction pass RETURNED for
  // this line vs how many survived verbatim verification. "N raw → 0
  // verified" (extraction defect) and "0 raw" (genuinely nothing found)
  // are different diagnoses — this field is what tells them apart.
  extractionStats?: { raw: number; verified: number };
};

export type EvidenceAssessmentRunResult = {
  rows: EvidenceAssessmentLineResult[];
  usage?: AIUsage;
  promptSent?: string;
  windowsProcessed?: number;
  fullCoverage?: boolean;
  // Real per-batch failure reasons (API error, malformed reply) — the same
  // honesty guard runPPDRequirementsReview already had. Previously these
  // were only console.error'd and lost; the caller had no way to tell WHY
  // lines came back "Assessment failed — retry."
  windowErrors?: string[];
};

// Purely-observational live events emitted as the assessment proceeds, so the
// UI can show a detailed activity view. Emitting them changes no assessment
// behaviour — they mirror the window/batch loop the run already performs.
export type EvidenceRunEvent =
  // chunkIds: the chunk IDs this window's text actually contains, so the
  // caller can resolve which source files the in-flight call covers.
  // stage: "extract" (Pass 1, finding candidate passages) or "judge" (Pass
  // 2, deciding verdicts from the verified pool) — see PPDRunEvent.
  | { type: "window-start"; window: { current: number; total: number }; refs: string[]; firstLine: number; lastLine: number; chunkIds: string[]; stage: "extract" | "judge" }
  | { type: "batch-done"; verdicts: { ref: string; verdict: EvidenceVerdict }[]; usage?: AIUsage }
  // error: the real failure reason (exception message) — never just "it failed".
  | { type: "batch-failed"; refs: string[]; error: string; stage: "extract" | "judge" };

export async function runEvidenceAssessment(
  inputs: EvidenceAssessmentInput[],
  evidenceDocText: string,
  settings: AISettings,
  opts: { criterionId?: string; calibration?: SkillCalibrationExample[]; memories?: SkillCalibrationMemory[]; ruleInjection?: string; onProgress?: (detail: string, pct?: number) => void; onEvent?: (ev: EvidenceRunEvent) => void; shouldStop?: () => boolean; signal?: AbortSignal; onCallAbort?: CallAbortReg } = {}
): Promise<EvidenceAssessmentRunResult> {
  if (inputs.length === 0) return { rows: [] };

  const domainSkill = domainExpertiseFor(opts.criterionId);
  const domainBlock = domainSkill ? `\n\n## Domain expertise for this criterion\n\n${domainSkill.trim()}` : "";
  const noEvidence = !evidenceDocText.trim();

  // ── Pass 1 (EXTRACT) system prompt: find implementation-record passages. ──
  // Extraction gets the skills/domain blocks (recall + verbatim discipline)
  // but NOT the calibration/memories/rule injections — those shape VERDICTS,
  // which belong to the judge pass.
  const extractSystem = (label: string) => `You are the EXTRACTION pass of a two-pass SSG EduTrust evidence assessment. Your ONLY job is to find and copy out passages from the PEI's ACTUAL EVIDENCE documents that bear on each requirement line or on any of its listed PPD promises. You give NO verdicts — a separate judge decides from what you extract, and a passage you miss is invisible to it, so include every passage that even partially bears on a line or promise, INCLUDING passages that appear to CONTRADICT a promise (e.g. a record dated after the deadline the PPD commits to) — contradictions are exactly what the judge must see.

For each requirement line return candidates, one entry per relevant passage:
- quote: ONE sentence (or short contiguous passage, e.g. a log/register row) copied VERBATIM, character-for-character. Never paraphrase, tidy, merge or invent text.
- kind: "record" when the passage is from an actual implementation record (a completed/signed form, a dated log or register entry, minutes, a report, a filled checklist); "policy" when it is from a policy/SOP/manual/handbook that merely describes the process.
- chunkId: the chunk ID from the document header the quote came from (e.g. "C001").
- aspect: 3-8 words naming what the passage evidences (name the promise number where one applies, e.g. "promise 2: peer review record").

PROHIBITION / NEGATIVE requirements ("non-collection of monies…", "must not…", "under any circumstance"): no record can show an absence, so NEVER return an empty list merely because nothing "shows" the negative happening. The passages to extract for these lines are: the signed contract / code-of-conduct clause STATING the prohibition (kind "record" when it sits in a signed/executed document), any fee/receipt/complaint entry bearing on the subject, and any record that CONTRADICTS the prohibition. The judge decides what they prove — your job is only to surface them.

An empty candidates array is the correct answer when nothing in this window bears on the line.

Respond with JSON only:
{"results": [{"ref": string, "candidates": [{"aspect": string, "quote": string, "kind": "record"|"policy", "chunkId": string}]}]}${buildSystemPrompt("evidenceReview", null, label, opts.criterionId, domainSkill)}${domainBlock}`;

  // ── Pass 2 (JUDGE) system prompt: verdicts from VERIFIED extracts only. ──
  // The decision procedure is stated ONCE, and repeated at the very end of
  // the prompt (after the knowledge-base/domain injections) — recency
  // measurably improves instruction-following on long prompts.
  const judgeSystem = (label: string) => `You are an SSG EduTrust assessor deciding whether a PEI IMPLEMENTS its documented policies. You are NOT given the evidence documents. For each requirement line you are given: (1) the PPD verdict already decided (whether the requirement is documented), (2) the specific PROMISES the PPD makes for that line, and (3) the complete set of VERIFIED passages an extraction pass found in the evidence documents — every quote is a confirmed verbatim excerpt, labelled "record" (an actual implementation record) or "policy" (process description only). Decide strictly from these passages: if a record is not among them, it was not found — never assume unshown records exist.

PROMISE VERIFICATION (the core task). Each promise listed under a requirement is a NAMED CHECK. For each one verdict:
- "evidenced" — a given RECORD passage shows the promise being carried out; cite its chunk.
- "not evidenced" — no given passage shows it. Phrase the finding: "It was not evident that the PEI had [promise], in accordance with its documented PPD."
- "contradicted" — a given passage shows the OPPOSITE of the promise (e.g. the PPD promises contracts signed before fee collection and a contract is dated after the receipt). Quote the contradicting passage.
Only "record" passages count as implementation evidence; a "policy" passage proves the approach exists on paper, never that it ran — and reclassify a mislabelled passage from its content when needed.

COMBINED LINE VERDICT — apply this decision procedure IN ORDER and stop at the first rule that matches. It is deterministic: the same PPD verdict and the same promise-check counts must ALWAYS yield the same line verdict (count the checks — never "feels thin/strong").
1. If ANY promise is "contradicted" → "Not met". (A contradiction is a hard fail regardless of everything else.)
2. Else if the PPD verdict is "Not documented" → "Not met".
3. Else if the PPD verdict is "Partial" → "Partial". (A weak documented approach caps the whole line, no matter how complete the evidence — never "Met".)
4. Else (PPD verdict is "Adequate"), decide by the promise checks:
   a. With extractable promises: let E = number "evidenced", T = total. "Met" if E === T; "Partial" if 0 < E < T; "Not met" if E === 0.
   b. With NO promises for this line: "Met" if at least one given RECORD passage directly evidences the requirement; "Partial" if only "policy" passages (or nothing concrete) were given.
When unsure between two adjacent verdicts, choose the LOWER one. "Met" requires every applicable promise evidenced with a cited record — it is never awarded on partial or ambiguous evidence.

${EVIDENCE_BOUNDARY_RULES}

PRE-CHECK FLAGS: some lines carry a "Pre-check flags" note — a concern the app's own pattern-scan (or the reviewer) noted before your assessment. Treat it as a prompt to look closer at that specific concern in the given passages, nothing more — it is NOT a verdict, and it must never override what the passages actually show. Confirm, refute or find it moot; do not defer to it.

NAMED EXAMPLES ARE MANDATORY on every negative: each "Partial"/"Not met" line verdict and each "not evidenced"/"contradicted" promise MUST cite at least one concrete example — a given passage (quoted, with its chunk ID) demonstrating the gap, or a plain statement that no given passage shows the record. Where dates or versions in the given passages can be compared (a record dated after the period it governs), PERFORM the comparison and state it explicitly. SSG REGISTER on negatives: "It was not evident that the PEI had [implemented/established]…, in accordance with its documented PPD. Example: …". Positive verdicts stay factual and specific (which record, where) — no praise adjectives.

For each line return:
- evidenceSummary: 1-2 sentences on what implementation evidence the passages show (or that none was found), factual and neutral.
- verdict: "Met" | "Partial" | "Not met" — per the decision procedure.
- comment: justification referencing the PPD state, the promise checks and the named example(s), in the register above.
- promiseChecks: one entry PER promise given for the line, promiseText copied exactly. evidence = the citation/description or "No record found in the evidence documents." quote = the ONE given passage that proves (or, for "contradicted", disproves) THIS specific promise, copied exactly as given — "" for "not evidenced" (nothing to quote), never invented, never another promise's quote. rationale = ONE short auditor-register sentence on WHY (distinct from the quote), or "" — do not pad. chunkId = that passage's chunk ID, or "". Empty array only when the line has no promises.
- chunkIds: the chunk IDs of the passages the line verdict relies on. Empty if none.
- evidenceQuote: for Met/Partial ONLY — the single given passage that most directly proves implementation for this line, copied exactly, or "".
- suggestedAction: for Partial or Not met ONLY — one or two sentences on the SPECIFIC evidence or action that would move this line to Met, grounded in the SAME gap you identified in comment/promiseChecks (name the specific record, how many items, which document/register — e.g. "Add owner and timeline fields to the remaining 17 unassigned actions in the Management Review Meeting minutes"), never generic advice like "add more evidence". If you cannot state something concrete, return "" — do not pad. "" for Met.

Respond with JSON only:
{"results": [{"ref": string, "evidenceSummary": string, "verdict": "Met"|"Partial"|"Not met", "comment": string, "promiseChecks": [{"promiseText": string, "verdict": "evidenced"|"not evidenced"|"contradicted", "evidence": string, "chunkIds": string[], "quote": string, "rationale": string, "chunkId": string}], "chunkIds": string[], "evidenceQuote": string, "suggestedAction": string}]}${buildSystemPrompt("evidenceReview", null, label, opts.criterionId, domainSkill, opts.calibration, opts.memories, opts.ruleInjection)}${domainBlock}

## Final decision procedure (repeated last so it is freshest — apply IN ORDER, stop at the first match)
1. Any promise contradicted → "Not met".
2. PPD "Not documented" → "Not met".
3. PPD "Partial" → "Partial".
4. PPD "Adequate": with promises → "Met" (all evidenced) / "Partial" (some) / "Not met" (none); with no promises → "Met" (a record passage evidences it) / "Partial" (only policy passages).
- Judge ONLY from the given verified passages. Ties resolve DOWN. The DETERMINISTIC EVIDENCE RULES override general judgement.`;

  const windows = noEvidence ? [] : buildDocWindows(evidenceDocText);

  // ── Pass 1 state: verified candidates pooled across windows. ──
  type EvCandidate = { aspect: string; quote: string; kind: "record" | "policy"; chunkId?: string };
  const candByRef = new Map<string, EvCandidate[]>();
  const candKeys = new Set<string>(); // "ref::normalised-quote" — cross-window dedupe
  const extractedOk = new Set<string>();
  // Refs whose AI calls failed and never succeeded — surfaced per line as
  // "Assessment failed — retry" so one stuck call cannot silently vanish.
  const failedRefs = new Set<string>();
  // Raw candidates the model returned per ref, before verification — same
  // diagnostic as the PPD side: "returned but none verified" is a pipeline
  // defect, never proof that no evidence exists.
  const rawCandidateCount = new Map<string, number>();
  // Real per-batch failure reasons, in call order — mirrors
  // runPPDRequirementsReview's windowErrors (was entirely absent here; every
  // failure below used to reach only console.error, never the caller).
  const windowErrors: string[] = [];

  const addCandidate = (ref: string, cand: EvCandidate) => {
    const key = `${ref}::${normaliseForQuoteMatch(cand.quote)}`;
    if (candKeys.has(key)) return;
    candKeys.add(key);
    const list = candByRef.get(ref) ?? [];
    list.push(cand);
    candByRef.set(ref, list);
  };

  let usage: AIUsage | undefined;
  let firstPromptSent: string | undefined;
  let windowsCompleted = 0;
  // See runStagedPolicyAudit: stopped runs must not fabricate verdicts.
  const stopRequested = () => !!opts.shouldStop?.() || !!opts.signal?.aborted;
  let stoppedEarly = false;

  const batches: EvidenceAssessmentInput[][] = [];
  for (let i = 0; i < inputs.length; i += REQ_BATCH_SIZE) batches.push(inputs.slice(i, i + REQ_BATCH_SIZE));

  // Progress accounting (cosmetic): extraction units + judge units.
  const totalUnits = Math.max(1, (windows.length || 1) * batches.length + batches.length);
  let unitsDone = 0;

  // Per-line context block shared by BOTH passes: the extractor uses promises
  // and pre-check flags to target its search; the judge uses them to decide.
  const lineBlock = (r: EvidenceAssessmentInput, i: number): string => {
    const promisesBlock = (r.promises ?? []).length > 0
      ? `\n  PPD promises to verify:${(r.promises ?? []).map((p, pi) => `\n    (${pi + 1}) ${p.promiseText}`).join("")}`
      : "";
    // Advisory only — a flag is a prompt to look closer, not a verdict to
    // adopt; form your own independent judgement from the evidence.
    const preCheckBlock = (r.preCheckFlags ?? []).length > 0
      ? `\n  Pre-check flags (for your consideration, not a directive — form your own independent judgement from the evidence):${(r.preCheckFlags ?? []).map((f, fi) => `\n    (${fi + 1}) ${f}`).join("")}`
      : "";
    return `[${r.ref}] (${i + 1}) ${r.requirementText} [PPD verdict: ${r.ppdVerdict}${r.ppdExtract ? ` — "${r.ppdExtract.slice(0, 100)}"` : ""}]${promisesBlock}${preCheckBlock}`;
  };

  // ── Pass 1 — EXTRACT: window × batch; verify and pool candidates. ──
  for (const win of windows) {
    if (stopRequested()) { stoppedEarly = true; break; }
    const windowLabel = windows.length > 1 ? ` [Window ${win.index + 1} of ${win.total}, chars ${win.start.toLocaleString()}–${win.end.toLocaleString()}]` : "";
    for (const [bi, batch] of batches.entries()) {
      if (stopRequested()) { stoppedEarly = true; break; }
      const firstLine = bi * REQ_BATCH_SIZE + 1;
      const lastLine = Math.min(inputs.length, firstLine + batch.length - 1);
      const lineLabel = inputs.length === 1 ? "line 1 of 1" : `lines ${firstLine}–${lastLine} of ${inputs.length}`;
      const winLabel = windows.length > 1 ? ` · window ${win.index + 1}/${win.total}` : "";
      opts.onProgress?.(`Extracting evidence for ${lineLabel}${winLabel}…`, Math.round((unitsDone / totalUnits) * 100));
      opts.onEvent?.({ type: "window-start", window: { current: win.index + 1, total: win.total }, refs: batch.map((b) => b.ref), firstLine, lastLine, chunkIds: chunkIdsInWindow(win.text), stage: "extract" });
      const pointsBlock = batch.map((r, i) => lineBlock(r, i)).join("\n");
      const user = `Actual evidence documents (chunk IDs in headers)${windowLabel}:\n"""\n${win.text}\n"""\n\nExtract every passage that bears on each requirement line or its PPD promises:\n${pointsBlock}`;
      const system = extractSystem(windows.length > 1 ? `runEvidenceAssessment (extract, window ${win.index + 1}/${win.total})` : "runEvidenceAssessment (extract)");
      if (!firstPromptSent) firstPromptSent = `SYSTEM (extract):\n${system}\n\nUSER:\n${user}`;
      try {
        const raced = await raceCallSkip(opts.onCallAbort, chatComplete(
          [{ role: "system", content: system }, { role: "user", content: user }],
          settings,
          { schema: EVIDENCE_EXTRACT_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: AUDIT_BATCH_TIMEOUT_MS, signal: opts.signal }
        ));
        if (raced === CALL_SKIPPED) {
          const label = windows.length > 1 ? `evidence extraction window ${win.index + 1}/${win.total}` : "evidence extraction call";
          windowErrors.push(`Evidence ${label} skipped by user — its points fall through to other windows or are marked not assessed.`);
          for (const r of batch) if (!extractedOk.has(r.ref)) failedRefs.add(r.ref);
          opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref), error: "Skipped by user.", stage: "extract" });
          unitsDone++;
          continue;
        }
        const content = raced;
        const parsed = parseJSONObject(content);
        const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
        // Empty/unparseable reply = a failure per "never fabricate from
        // failures" — never treated as "no evidence exists".
        if (results.length === 0) {
          const label = windows.length > 1 ? `extraction window ${win.index + 1}/${win.total}` : "extraction call";
          windowErrors.push(`Evidence ${label} returned no parseable passages — the AI reply was empty or not valid JSON.`);
          for (const r of batch) if (!extractedOk.has(r.ref)) failedRefs.add(r.ref);
          opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref), error: "The AI reply was empty or not valid JSON — no passages could be parsed from it.", stage: "extract" });
          console.error("[EvidenceAssessment]", label, "no parseable results");
          unitsDone++;
          continue;
        }
        const byRef = new Map(results.map((x) => [normalizeAuditRef(String(x.ref ?? "")), x]));
        for (const [idx, r] of batch.entries()) {
          const res = byRef.get(normalizeAuditRef(r.ref)) ?? (results.length === batch.length ? results[idx] : undefined);
          if (!res) continue;
          extractedOk.add(r.ref);
          failedRefs.delete(r.ref);
          // A candidate survives ONLY when its quote verifies as a real
          // verbatim excerpt of the evidence text (deterministic gate).
          const rawCands = Array.isArray(res.candidates) ? res.candidates as Array<Record<string, unknown>> : [];
          rawCandidateCount.set(r.ref, (rawCandidateCount.get(r.ref) ?? 0) + rawCands.length);
          for (const c of rawCands) {
            const quote = typeof c.quote === "string" ? c.quote.trim() : "";
            if (!quote || !quoteExistsInSource(quote, evidenceDocText)) continue;
            addCandidate(r.ref, {
              aspect: typeof c.aspect === "string" ? c.aspect.trim() : "",
              quote,
              // Default "policy" on a missing/invalid label — the safer class:
              // it can only understate evidence (rule 4b), never inflate "Met".
              kind: c.kind === "record" ? "record" : "policy",
              chunkId: typeof c.chunkId === "string" && c.chunkId.trim() ? c.chunkId.trim() : undefined,
            });
          }
        }
      } catch (err) {
        // Cancel/abort is a stop, not a failure — see runStagedPolicyAudit.
        if (stopRequested()) { stoppedEarly = true; break; }
        const msg = err instanceof Error ? err.message : String(err);
        const label = windows.length > 1 ? `extract window ${win.index + 1}/${win.total}` : "extract call";
        windowErrors.push(`Evidence ${label} failed — ${msg}`);
        for (const r of batch) if (!extractedOk.has(r.ref)) failedRefs.add(r.ref);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref), error: msg, stage: "extract" });
        console.error("[EvidenceAssessment]", label, msg);
      }
      unitsDone++;
    }
    if (stoppedEarly) break;
    windowsCompleted++;
  }

  // ── Pass 2 — JUDGE: verdicts from the verified pool, ONCE per line. ──
  // FOLLOW-UP (not built here): this judge call batches by REQUEST line
  // (REQ_BATCH_SIZE), so ALL of a batch's pooled passages — potentially every
  // window's worth on a large folder — travel in ONE call. judgeTimeoutMs now
  // scales the ceiling with that prompt size, but the more durable fix for
  // very large folders is to batch the judge BY WINDOW too (judge each
  // window's verified passages, then reconcile per line with the existing
  // best-verdict merge), so no single call ever has to process the whole
  // folder at once. Deferred because it touches the verdict-merge path and
  // this task is a call-configuration fix only.
  type JudgedEv = { evidenceSummary: string; verdict: EvidenceVerdict; comment: string; chunkIds: string[]; promiseChecks?: PromiseCheck[]; evidenceQuote?: string; suggestedAction?: string };
  const judgedByRef = new Map<string, JudgedEv>();

  // Only lines with at least one verified passage go to the judge; a line
  // with NO passages is decided deterministically below by the same decision
  // procedure — asking a model to judge empty input invites invention.
  const judgeInputs = inputs.filter((r) => (candByRef.get(r.ref)?.length ?? 0) > 0);
  const judgeBatches: EvidenceAssessmentInput[][] = [];
  for (let i = 0; i < judgeInputs.length; i += REQ_BATCH_SIZE) judgeBatches.push(judgeInputs.slice(i, i + REQ_BATCH_SIZE));

  for (const [bi, batch] of judgeBatches.entries()) {
    if (stopRequested()) { stoppedEarly = true; break; }
    opts.onProgress?.(`Judging verified evidence — batch ${bi + 1}/${judgeBatches.length}…`, Math.round((unitsDone / totalUnits) * 100));
    const pointsBlock = batch.map((r, i) => {
      const cands = candByRef.get(r.ref) ?? [];
      const candLines = cands.map((c, ci) => `   (${ci + 1}) [${c.chunkId ?? "no chunk"} · ${c.kind}]${c.aspect ? ` (${c.aspect})` : ""} "${c.quote}"`).join("\n");
      return `${lineBlock(r, i)}\n  Verified evidence passages:\n${candLines}`;
    }).join("\n\n");
    const user = `Requirement lines with the verified evidence passages found for each:\n\n${pointsBlock}\n\nVerify each listed PPD promise against the given passages, then give the COMBINED PPD-plus-evidence verdict per the decision procedure.`;
    const system = judgeSystem(judgeBatches.length > 1 ? `runEvidenceAssessment (judge, batch ${bi + 1}/${judgeBatches.length})` : "runEvidenceAssessment (judge)");
    if (firstPromptSent && !firstPromptSent.includes("SYSTEM (judge):")) firstPromptSent += `\n\n════════ SECOND PASS (judge) ════════\n\nSYSTEM (judge):\n${system}\n\nUSER:\n${user}`;
    try {
      const content = await chatComplete(
        [{ role: "system", content: system }, { role: "user", content: user }],
        settings,
        { schema: EVIDENCE_ASSESSMENT_SCHEMA, temperature: verdictTemp(settings), onUsage: (u) => { usage = addUsage(usage, u); }, timeoutMs: judgeTimeoutMs(user.length), signal: opts.signal }
      );
      const parsed = parseJSONObject(content);
      const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : [];
      // The call RETURNED but nothing parseable came back — same failure
      // class as the extract loop and PPD's judge loop (was previously
      // silently absorbed: every ref in the batch fell through to the
      // generic per-ref !res branch below with NO diagnostic captured).
      if (results.length === 0) {
        const label = judgeBatches.length > 1 ? `judge batch ${bi + 1}/${judgeBatches.length}` : "judge call";
        windowErrors.push(`Evidence ${label} returned no parseable verdicts — the AI reply was empty or not valid JSON.`);
        console.error("[EvidenceAssessment]", label, "no parseable results");
        for (const r of batch) failedRefs.add(r.ref);
        opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref), error: "The AI reply was empty or not valid JSON — no verdicts could be parsed from it.", stage: "judge" });
        unitsDone++;
        continue;
      }
      const byRef = new Map(results.map((x) => [normalizeAuditRef(String(x.ref ?? "")), x]));
      const batchVerdicts: { ref: string; verdict: EvidenceVerdict }[] = [];
      for (const [idx, inp] of batch.entries()) {
        const res = byRef.get(normalizeAuditRef(inp.ref)) ?? (results.length === batch.length ? results[idx] : undefined);
        if (!res) {
          // Nothing came back for this ref — honest failure, never a
          // fabricated "Not met".
          failedRefs.add(inp.ref);
          continue;
        }
        const verdict = (["Met", "Partial", "Not met"] as EvidenceVerdict[]).includes(res.verdict as EvidenceVerdict)
          ? (res.verdict as EvidenceVerdict) : "Not met";
        const evidenceSummary = typeof res.evidenceSummary === "string" ? res.evidenceSummary : "";
        const comment = typeof res.comment === "string" ? res.comment : "";
        const chunkIds = Array.isArray(res.chunkIds) ? (res.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
        // Exact evidence quote — stored ONLY when it verifies as a real
        // verbatim excerpt; a paraphrase/invention is dropped to undefined.
        const rawEvidenceQuote = typeof res.evidenceQuote === "string" ? res.evidenceQuote.trim() : "";
        const evidenceQuote = rawEvidenceQuote && quoteExistsInSource(rawEvidenceQuote, evidenceDocText) ? rawEvidenceQuote : undefined;
        // "What would make this Met": reasoning text, stored as-is (no source
        // verification) — only meaningful for Partial/Not met per the prompt.
        const suggestedAction = typeof res.suggestedAction === "string" ? res.suggestedAction.trim() : "";
        const promiseChecks: PromiseCheck[] = Array.isArray(res.promiseChecks)
          ? (res.promiseChecks as Array<Record<string, unknown>>)
              .filter((p) => typeof p?.promiseText === "string" && ["evidenced", "not evidenced", "contradicted"].includes(p?.verdict as string))
              .map((p) => {
                // Per-promise quote: verified against the evidence text — same
                // anti-hallucination rule as evidenceQuote, per promise.
                const rawQuote = typeof p.quote === "string" ? p.quote.trim() : "";
                const quote = rawQuote && quoteExistsInSource(rawQuote, evidenceDocText) ? rawQuote : undefined;
                const rationale = typeof p.rationale === "string" && p.rationale.trim() ? p.rationale.trim() : undefined;
                const chunkId = typeof p.chunkId === "string" && p.chunkId.trim() ? p.chunkId.trim() : undefined;
                return {
                  promiseText: p.promiseText as string,
                  verdict: p.verdict as PromiseCheck["verdict"],
                  // Quote verification on the cited evidence — same rule as comments.
                  evidence: typeof p.evidence === "string" ? flagUnverifiedQuotes(p.evidence, evidenceDocText) : "",
                  chunkIds: Array.isArray(p.chunkIds) ? (p.chunkIds as unknown[]).filter((x): x is string => typeof x === "string") : [],
                  quote,
                  rationale,
                  chunkId,
                };
              })
          : [];
        judgedByRef.set(inp.ref, { evidenceSummary, verdict, comment, chunkIds, promiseChecks: promiseChecks.length > 0 ? promiseChecks : undefined, evidenceQuote, suggestedAction });
        failedRefs.delete(inp.ref);
        batchVerdicts.push({ ref: inp.ref, verdict });
      }
      opts.onEvent?.({ type: "batch-done", verdicts: batchVerdicts, usage });
    } catch (err) {
      if (stopRequested()) { stoppedEarly = true; break; }
      const msg = err instanceof Error ? err.message : String(err);
      const label = judgeBatches.length > 1 ? `judge batch ${bi + 1}/${judgeBatches.length}` : "judge call";
      windowErrors.push(`Evidence ${label} failed — ${msg}`);
      for (const inp of batch) if (!judgedByRef.has(inp.ref)) failedRefs.add(inp.ref);
      opts.onEvent?.({ type: "batch-failed", refs: batch.map((b) => b.ref), error: msg, stage: "judge" });
      console.error("[EvidenceAssessment]", label, msg);
    }
    unitsDone++;
  }

  const rows: EvidenceAssessmentLineResult[] = inputs.map((inp) => {
    const best = judgedByRef.get(inp.ref);
    // Pass 1 visibility on every row — raw candidates returned vs verified.
    const extractionStats = { raw: rawCandidateCount.get(inp.ref) ?? 0, verified: candByRef.get(inp.ref)?.length ?? 0 };
    if (best) {
      const verifiedComment = flagUnverifiedQuotes(best.comment || "", evidenceDocText);
      // Code-level APSR Approach hard-gate: a line whose PPD verdict is not
      // "Adequate" is capped at "Partial" whatever the AI combined — the same
      // facts must not show "Partial" on the PPD tab and "Met" here.
      if (best.verdict === "Met" && inp.ppdVerdict !== "Adequate") {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}[Capped at Partial: the PPD verdict for this line is "${inp.ppdVerdict}" — under the APSR Approach hard-gate a line cannot be Met until the documented approach is Adequate, regardless of implementation evidence.]`,
          chunkIds: best.chunkIds,
          promiseChecks: best.promiseChecks,
          evidenceQuote: best.evidenceQuote,
          suggestedAction: best.suggestedAction || undefined,
          extractionStats,
        };
      }
      // A "Met" verdict that cannot cite any evidence chunk is downgraded to
      // "Partial" — same uncited-positive rule as buildStagedApsr.
      if (best.verdict === "Met" && best.chunkIds.length === 0) {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}${UNCITED_DOWNGRADE_NOTE}`,
          chunkIds: [],
          promiseChecks: best.promiseChecks,
          suggestedAction: best.suggestedAction || undefined,
          extractionStats,
        };
      }
      // Promise hard-gate: a "Met" line with an unfulfilled or contradicted
      // PPD promise is capped at "Partial" — "not implemented in accordance
      // with its documented PPD" is exactly the gap real assessors raise.
      const unmetPromises = (best.promiseChecks ?? []).filter((p) => p.verdict !== "evidenced");
      if (best.verdict === "Met" && unmetPromises.length > 0) {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Partial",
          comment: `${verifiedComment ? `${verifiedComment}\n\n` : ""}[Capped at Partial: ${unmetPromises.length} PPD promise${unmetPromises.length === 1 ? "" : "s"} not evidenced — ${unmetPromises.map((p) => `"${p.promiseText}"`).join("; ")}. It was not evident that the PEI had implemented ${unmetPromises.length === 1 ? "this commitment" : "these commitments"} in accordance with its documented PPD.]`,
          chunkIds: best.chunkIds,
          promiseChecks: best.promiseChecks,
          evidenceQuote: best.evidenceQuote,
          suggestedAction: best.suggestedAction || undefined,
          extractionStats,
        };
      }
      // Verdict/comment self-consistency guard — only reachable here, past
      // all three hard-gates above, so a line those already downgraded (and
      // already appended its own explanatory note to) never also gets this
      // check applied to its now-gate-modified comment text.
      const mismatch = conclusionMismatch(best.verdict === "Met", verifiedComment);
      if (mismatch) {
        return {
          ref: inp.ref,
          evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.",
          verdict: "Not assessed",
          comment: `${verifiedComment}\n\n⚠ Verdict/comment mismatch: the model returned verdict "${best.verdict}" but its own comment concluded "${mismatch}". Re-run to get a consistent assessment.`,
          chunkIds: best.chunkIds,
          promiseChecks: best.promiseChecks,
          evidenceQuote: best.evidenceQuote,
          suggestedAction: best.suggestedAction || undefined,
          extractionStats,
        };
      }
      return { ref: inp.ref, evidenceSummary: best.evidenceSummary || "No implementation evidence found for this requirement.", verdict: best.verdict, comment: verifiedComment, chunkIds: best.chunkIds, promiseChecks: best.promiseChecks, evidenceQuote: best.evidenceQuote, suggestedAction: best.suggestedAction || undefined, extractionStats };
    }
    if (failedRefs.has(inp.ref)) {
      // A failed/timed-out call is MISSING DATA, not a negative finding — the
      // honest verdict is "Not assessed" (matching the stoppedEarly and
      // extraction-defect branches below), NEVER "Not met". Returning "Not
      // met" here fabricated a negative for any consumer reading .verdict
      // without also checking .failed; "Not assessed" is neutral (excluded
      // from the findings compile and from consistency gap/band counts).
      return { ref: inp.ref, evidenceSummary: "Assessment failed — retry.", verdict: "Not assessed", comment: "The AI call for this line failed or timed out. Re-run the evidence assessment to retry.", chunkIds: [], failed: true };
    }
    // A line never put in front of the AI because the run stopped early is
    // "Not assessed" — NOT a fabricated "Not met".
    if (stoppedEarly) {
      return {
        ref: inp.ref,
        evidenceSummary: "Not assessed — the run was stopped before this line was reviewed.",
        verdict: "Not assessed",
        comment: "The run was stopped before this requirement line was reviewed. Re-run the evidence assessment to assess it.",
        chunkIds: [],
      };
    }
    // No evidence documents at all: deterministic verdict from the PPD state.
    if (noEvidence) {
      return {
        ref: inp.ref,
        evidenceSummary: "No Actual Evidence documents were found for this sub-criterion.",
        verdict: "Not met",
        comment: `PPD verdict was "${inp.ppdVerdict}", but no implementation evidence was available to assess.`,
        chunkIds: [],
      };
    }
    // The model DID return passages but NONE verified as verbatim source
    // text — an extraction/verification defect, NOT proof that no evidence
    // exists. Firing the zero-evidence floor here would fabricate a "Not
    // met" from a pipeline failure; the honest verdict is "Not assessed".
    if (extractionStats.raw > 0) {
      return {
        ref: inp.ref,
        evidenceSummary: `Not assessed — the extraction pass returned ${extractionStats.raw} passage${extractionStats.raw === 1 ? "" : "s"} but none verified as verbatim source text.`,
        verdict: "Not assessed",
        comment: `Not assessed — the extraction pass returned ${extractionStats.raw} candidate passage${extractionStats.raw === 1 ? "" : "s"} for this line, but none could be verified as an exact excerpt of the evidence documents, so no verdict was reached. This usually means the model paraphrased its quotes instead of copying them, or the document text reached the app in a form the verifier cannot match (e.g. OCR/vision artifacts). Re-run the evidence assessment; if it persists, this is an extraction defect — NOT evidence that the requirement is unimplemented.`,
        chunkIds: [],
        extractionStats,
      };
    }
    // Extraction covered this line cleanly and the model returned NOTHING —
    // decided deterministically by the SAME decision procedure the judge
    // applies, with zero evidence (replaces the old AI coin-flip on empty
    // support, one of the measured flip-flop sources).
    const promises = inp.promises ?? [];
    const promiseChecks: PromiseCheck[] = promises.map((p) => ({ promiseText: p.promiseText, verdict: "not evidenced" as const, evidence: "No record found in the evidence documents.", chunkIds: [] }));
    let verdict: EvidenceVerdict;
    if (inp.ppdVerdict === "Not documented") verdict = "Not met";
    else if (inp.ppdVerdict === "Adequate") verdict = promises.length > 0 ? "Not met" : "Partial";
    else verdict = "Partial"; // PPD "Partial" (or an unassessed PPD) caps the line
    return {
      ref: inp.ref,
      evidenceSummary: "No implementation evidence found for this requirement.",
      verdict,
      comment: `It was not evident that the PEI had implemented this requirement, in accordance with its documented PPD. The extraction pass read every provided evidence document and returned no candidate passage for this line${promises.length > 0 ? ` or its ${promises.length} PPD promise${promises.length === 1 ? "" : "s"}` : ""} (0 extracted). PPD verdict was "${inp.ppdVerdict}".`,
      chunkIds: [],
      promiseChecks: promiseChecks.length > 0 ? promiseChecks : undefined,
      extractionStats,
    };
  });

  return { rows, usage, promptSent: firstPromptSent, windowsProcessed: windowsCompleted, fullCoverage: !stoppedEarly && (windows.length === 0 || windowsCompleted === windows.length), windowErrors: windowErrors.length > 0 ? windowErrors : undefined };
}
