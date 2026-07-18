# Investigation: rewriting user-facing text into auditor-narrative style

Investigation only. No application logic or data changed. UK spelling, no em
dashes. Checkout confirmed at start: **HEAD == origin/main == `bad1fd3`**,
clean tree (`git fetch && git status` run before any file was read).

Everything below is cited to real file:line evidence. Where I could not
verify something with certainty I say so explicitly rather than guess.

---

## 0. The gold-standard example, preserved, with why-it-works analysis

**BEFORE (current terse/imperative style, illustrative of the pattern this
task replaces):** "Ensure X. Include Y. Provide Z."

**AFTER (target style), a Weakness paragraph:**

> "The sampled completed Quality Action records generally included defined
> objectives, action plans, resource requirements, implementation status and
> measurable indicators for specific initiatives, such as the live teacher and
> agent register, student support module and data-masking controls. The 2025
> improvement portfolio also consolidated 34 completed actions, including
> quantified savings, costs and monitoring notes. However, the records did not
> consistently demonstrate the source of stakeholder feedback, evidence of
> approval by the Principal or HOD-SGL before implementation, or complete
> planning details such as the assigned owner, timeline and key tasks."

Plus: a separate neutral **Band Assessment** line, a **Required Action**
written as a professional recommendation (not a barked instruction), and a
**Strength** paragraph in the same evidence-grounded voice.

**Why it works, preserved:**

1. **Names the sampled evidence first** — "the sampled completed Quality
   Action records", "the 2025 improvement portfolio", specific named
   initiatives (teacher/agent register, student support module, masking
   controls) and a real count (34 actions). The reader can tell this was
   written by someone who actually looked at specific documents, not a
   template.
2. **States what IS present before what is wrong** — the paragraph opens
   with the positive coverage (objectives, action plans, resources, status,
   indicators) before the pivot.
3. **The pivot word "However,"** is the entire structural hinge: it is the
   one word that turns a document description into an audit finding. Without
   it, the paragraph would just be a summary; with it, the reader knows
   exactly where "in place" ends and "gap" begins.
4. **The gap is itemised, not vague** — "the source of stakeholder feedback",
   "evidence of approval by the Principal or HOD-SGL before implementation",
   "assigned owner, timeline and key tasks" are concrete, checkable absences,
   not "process weaknesses" in the abstract.
5. **No adjectives doing the work** — nothing is called "weak", "poor" or
   "inadequate"; the absence of the specific fact IS the finding. This is
   also the register the app's own existing `findingWriter.ts` prompt already
   mandates (see §2 below) — the gold example is not inventing a new
   register, it is the same one already built, applied with more evidence
   density.
6. **Separation of concerns**: a neutral Band Assessment line (the score,
   stated without editorial colour), a Required Action written as a
   recommendation ("the school should…", not "Ensure…"), and a Strength
   paragraph in the identical evidence-grounded voice — four distinct fields,
   not one wall of text.

This pattern — **name the sample → what's present → "However," → what's
absent, itemised → separately, a plain band line and a recommendation** — is
the reusable shape for every surface below.

---

## 1. Per-surface findings

### Surface 1 — Final Report findings text

**Generation sites (file:line):**

| Text | Site | AI or templated |
|---|---|---|
| Findings-table rows (`finding`/`afi`) | `src/lib/finalReport.ts:270-317` (`buildFindingsGroups`) | **Neither new** — restructures `lineDimensionDiagnosis(l, key)` (real AI text from an earlier audit pass) and `lineSuggestedAction(l)` verbatim. Comment at `finalReport.ts:241-243`: "no new AI call, no free-text parsing." |
| Overall per-item summary (`ItemReport.overallSummary`) | `finalReport.ts:385-434` (`buildOverallSummary`), fragments at `:346-371` (`DIM_FACE`) | **Templated** — fixed vocabulary of ~4 pre-written clauses per dimension, joined by string concatenation. Deterministic, no AI call (`finalReport.ts:376-384`). |
| Executive summary | `src/pages/FinalReport.tsx:76-128` (`generateSummary`) | **AI**, on-demand button (`FinalReport.tsx:170-177`), `chatComplete`/`effectiveSettings`. |
| Concise auditor-voice row summaries | `FinalReport.tsx:481-509` (`generateConciseSummaries`) | **AI**, generate-once-and-save. **This is the existing gold-standard precedent** — see §2. |
| AI improvement suggestions | `FinalReport.tsx:511-541` (`generateSuggestions`) | **AI**, generate-once-and-save. |
| Findings register rows shown here | `finalReport.ts:651-673` | Passthrough of `Finding.issue`/`closures[f.id]` — sourced from Surface 2, no generation here. |

**Current style, quoted:** the templated overall summary produces a real
sentence, e.g. `"${strongPhrase}, but ${joinFaces(weakKeys, "weak")}."`
(`finalReport.ts:407`) from a fixed 4-phrase vocabulary per dimension — a
short sentence, not a fragment, but not evidence-specific prose either.

**Grounded data available (exhaustive):** per-line status/verdict
(`SpecificChecklistLine.status`); per-dimension APSR status+note+citations
(`ApsrBreakdown`, `types/index.ts:288-293`); real AI-authored per-dimension
diagnosis text (`lineDimensionDiagnosis()`, `checklistBanding.ts:245-247`);
the judge's own suggested action (`lineSuggestedAction()`,
`checklistBanding.ts:317-320`); evidence item titles
(`SubChecklistEvidenceItem.title`, `types/index.ts:297`) and auditor notes
(`.auditorNote`, `:308-310`); verbatim GD4 requirement text
(`GD4Requirement.requirement`/`.expectedEvidence`, `:154,161`); verbatim
next-band rubric descriptor (`finalReport.ts:38-39,608-611`); per-line
completeness counts (`LineCompleteness`); dimension band/percentage.

**Persistence:** executive summary is a plain `useState` in
`FinalReport.tsx:46-47` — **does not persist**, re-rolls (and re-bills) on
every button click, lost on reload. Concise summaries and AI suggestions
persist in `useWorkspaceStore.reportConciseFindings`/`.reportAiSuggestions`
(not excluded from `partialize`) — genuine generate-once-and-save.

**Verdict: enough real grounded data to narrate truthfully — YES, and
proven in production already.** The concise-summary feature is a working,
shipped instance of exactly the target style (see §2).

---

### Surface 2 — Findings (register): root cause / gap wording

**Generators (file:line):**

| Generator | File:line | AI or templated |
|---|---|---|
| `simulateGroupedFindingWriter` | `src/lib/ai/findingWriter.ts:101-179` | Templated (offline fallback) |
| `runLiveGroupedFindingWriter` | `findingWriter.ts:182-289` | **AI** |
| `buildDraftFinding` | `src/lib/checklistBanding.ts:416-543` | Templated |
| Manual entry | `src/pages/Findings.tsx:590-650` | Human-typed |

**Current style, quoted — this surface is already closest to the gold
standard.** The live system prompt (`findingWriter.ts:199-200`) already
mandates: *"You MUST base everything on the checklist evidence provided — do
NOT invent or assume information that is not in the lines. For the root
cause: apply 5-Why methodology — reach the systemic Level 3 root cause… For
the criteria section: quote the GD4 requirement text EXACTLY, word-for-word…
PHRASING REGISTER (mandatory): the observation MUST use the official SSG
assessor register — open with 'It was not evident that the PEI had
[documented/implemented/established]…', name the specific process…, and
close with an 'Example:' block citing the concrete case."* Output is full
paragraph-length `observation`/`criteria`/`effect`/`rootCause` fields
(schema `findingWriter.ts:218-235`).

The one piece that is **not** yet narrative: `buildDraftFinding`'s
`corrective`/`suggestedActionText` is an imperative-fragment template —
`checklistBanding.ts:521`: *"Create, approve and file the required
{dim} documentation for GD4 {req.id}…"* This is the field the gold example's
"Required Action written as a professional recommendation" maps onto.

**Grounded data:** GD4 requirement id/area/gate-sensitivity, per-line
status/sufficiency/ref/text, per-line APSR status+notes (all four
dimensions), evidence item titles+sufficiency (capped at 6), group-level gap
type/dimension/severity/risk, evidence status summary counts, domain-expert
skill block — all listed with file:line by the agent trace.

**Critical guardrail — must not be touched by any narrative rewrite:** the
`criteria` field is checked by a **deterministic, non-AI verifier**,
`src/lib/findingCriteriaCheck.ts:31-39` (`criteriaQuotesRequirement`) —
requires the `criteria` string to literally **contain** the official GD4
requirement text (normalised whitespace/case, min 20 chars). Wired at write
time in three places (`useFindingDraftStore.ts:243`,
`useWorkspaceStore.ts:5121`, `:6238`), setting `criteriaUnverified` on
failure, cleared only by an explicit human edit
(`useFindingDraftStore.ts:480`), surfaced via `CriteriaUnverifiedFlag`
(`Findings.tsx:909,996,1087`). **A narrativised/paraphrased `criteria` field
would trip this check.** The `criteria` field must stay a verbatim quote,
full stop — the narrative treatment applies to `observation`/`rootCause`/
`corrective`/`preventive`, never to `criteria`.

**Verdict: enough grounded data — YES.** This is the most mature surface
already; the only real change needed is upgrading `corrective`/
`suggestedActionText` from imperative template to recommendation register,
using data already fed to the same prompt.

---

### Surface 3 — Quality Action / AFI text

Scope: closure record fields on `src/pages/AFIClosure.tsx` /
`ClosureState` (`useWorkspaceStore.ts:437-470`).

**Bluntly: this surface is NOT 100% manual.** `root`/`corr`/`prev` are
**already AI-generated by default** (via a button click), landing in an
editable textarea:

| Field | Human path | AI path(s) |
|---|---|---|
| `root`, `corr` | textarea (`AFIClosure.tsx:217-227,246`) | `draftClosureActions`→`runLiveClosureDraft` (`agentRuntime.ts:613-632`); panel synthesis (`panelConclusion.ts:20-28`); auto full-audit Pass 2 (`useWorkspaceStore.ts:5158-5168`) |
| `prev` | textarea (`:247`) | `runLiveClosureDraft` + auto Pass 2 only (panel synthesis has no `prev` key, `panelConclusion.ts:16-17,61`) |
| `containment`, `evid` | textarea | Panel synthesis only |
| Owner, deadline, effectiveness note | input fields | **None — 100% manual, no AI path at all** |

**Current style, quoted:** `runLiveClosureDraft`'s prompt
(`agentRuntime.ts:619`) already reads close to the target: *"propose: a ROOT
CAUSE that names WHY the gap exists — use the 5-Why methodology to reach the
systemic level (Level 3)… a CORRECTIVE action that fixes this specific gap
now (time-bound, names the record/document and responsible role), and a
PREVENTIVE action that changes the system so the gap cannot recur… Be
concrete and specific to the requirement; reference the actual
evidence/records that should exist… do not claim the finding is closed."*
Run at `temperature: 0.7` "for drafting (natural, varied narrative)"
(`agentRuntime.ts:621`).

**One deliberate style choice works AGAINST the gold-standard paragraph
form today:** `formatDraftedClosureText` (`useWorkspaceStore.ts:167-174`)
takes the model's paragraph and **splits it into one sentence per line**
("reads as a scannable list… instead of a wall of text",
`useWorkspaceStore.ts:162-166`). This is the opposite of "complete audit-style
paragraphs" — it is a deliberate anti-paragraph choice made for a different
UX reason (scannability). Changing this to gold-standard paragraph form is a
straightforward reversal, not a grounding problem.

**Grounded data already wired:** finding text (`f.issue`), GD4 requirement
text (`req.requirement`/`.intent`/`.expectedEvidence`), the matched
checklist line's APSR breakdown, calibration examples (past human
corrections for this module). **Grounded data that EXISTS but is NOT
currently passed in** (candidates, not gaps that block truthful narration):
prior closure/recurrence history (`Finding.repeatFinding`,
`.escalatedToMajor`), the finding's own enriched `observation`/`criteria`/
`effect` text, evidence-item verdicts, panel `rootCauseDirection`.

**Verdict: enough grounded data — YES**, largely already wired. The change
needed is (a) reversing the one-sentence-per-line split back to paragraph
form for the narrative fields, and (b) optionally widening the grounding to
the unused-but-available fields above.

---

### Surface 4 — Sub-Criterion Checklist: per-line diagnosis text

**Not independently generated.** The checklist page's PPD/Evidence tabs
**display** `aiItem.ppdComment`/`.evidenceComment`/`.apsr.*.note`
(`SubCriterionChecklist.tsx:1209-1210,1230-1231`) — the exact same raw judge
output that also feeds Surface 5, copied verbatim at commit time
(`optionAChecklistWrite.ts:155-159`). Confirmed by an explicit comment,
`SubCriterionChecklist.tsx:1157-1161`: *"PPD / Evidence reasoning tabs —
read-only views of the ONE AI run whose write produced this line."*

**Current style is deliberately terse by prompt design, not by data
scarcity:** `agentRuntime.ts:2215` — *"shortComment: MANDATORY for every
verdict, never blank — one sentence stating WHY."* The `ApsrBreakdown.note`
field (`types/index.ts:288-293`) is instructed to be a short sentence
throughout; no prompt anywhere instructs multi-sentence prose for it.

**An existing paragraph-style precedent already lives in the same file:**
`overallNarrative` — a 2-4 sentence roll-up synthesis of the whole
sub-criterion, generated once, explicitly told *"do NOT repeat each line's
comment verbatim… keep it factual and neutral"* (`agentRuntime.ts:2633`,
type `types/index.ts:995`). This is the closest existing analogue to the
gold-standard narrative for this surface, and it already exists at the
sub-criterion level (not per-line).

**Grounded data (very rich, exhaustive):** verdict, verbatim requirement
text, **verified** quotes + chunk IDs (only quotes that pass
`quoteExistsInSource()` survive, `agentRuntime.ts:2334-2335`), clause
headings, PPD "promise" checks, extraction stats (raw candidates → verified
count), prior PPD verdict feeding the evidence judge, evidence file
names/titles, running completeness counts, deterministic boundary-rule
floors (`PPD_BOUNDARY_RULES`/`EVIDENCE_BOUNDARY_RULES`, `agentRuntime.ts:171-194`).

**Verdict: enough grounded data — YES, the richest of the five**, because
of the existing quote-verification pipeline. The genuinely low-risk build
target is expanding/repurposing `overallNarrative` toward the gold-standard
structure (it already exists, is already grounded-only, and is already
per-sub-criterion — the natural unit for a Strength/Weakness/Band/Required
Action block), rather than rewriting the per-line `note` fields themselves
(which are load-bearing short citations used elsewhere and intentionally
terse).

---

### Surface 5 — Evidence Folder: review/verdict wording

**One pipeline feeds both Surface 4 and Surface 5** — same `PPDReviewRow`/
`EvidenceAssessmentRow` objects, same judge prompts. Specifics:

- `EvidenceFolder.tsx` itself shows **no comment text** — its `VerdictTable`
  (`EvidenceFolder.tsx:313-346`) is Line/Result/APSR/Cited columns only. The
  prose lives on `PPDReview.tsx`, reached via "review verdicts" links.
- PPD comment (behind a toggle): `PPDReview.tsx:349-360` — `{row.fullComment
  || row.shortComment}`.
- Evidence comment: `PPDReview.tsx:1020-1032` — `{row.comment}`.
- The inline matrix-table one-liner (`rowRationale`) is UI-truncated at 220
  chars with "Show more" (`LineageDiagram.tsx:319,348,381-395,519-534`) — a
  **display-layer** truncation distinct from the stored text.

**Prompt style, quoted:** `fullComment` = *"(1) the justification… (2) a
verbatim quoted excerpt in double quotes with its chunk ID"*
(`agentRuntime.ts:2216`) — allowed to be a short two-part statement, but
explicitly justification-plus-citation, not narrative prose.
`suggestedAction`: *"one or two sentences… If you cannot state something
concrete, return "" — do not pad"* (`agentRuntime.ts:2807`) — an explicit
anti-fabrication instruction already in place.

**Grounded data:** identical to Surface 4, plus contradiction pairs
(`PPDContradiction`, two verbatim passages + chunk IDs,
`types/index.ts:916-925`), real file names (`chunkFileNames`,
`types/index.ts:989`; `EvidenceFileRef.name`, `:1032`).

**Persistence:** persisted at two layers — the run result store
(`useWorkspaceStore.ppdReviewResults`, capped) and the frozen snapshot copied
onto the checklist line at commit time. Not regenerated on render.

**Verdict: enough grounded data — YES**, same infrastructure as Surface 4.

---

## 2. The fabrication-risk assessment (the single most important finding)

**Blunt summary: every one of the five surfaces has enough real, non-invented
data available to produce gold-standard narrative TRUTHFULLY — but two
distinct risks exist, and they are different risks, not the same one.**

### Risk A — the model pads to sound complete (real risk, needs a guardrail)

The gold example cites a specific number ("34 completed actions") and named
initiatives. **That number is not something any prompt can promise to
produce** — it is real because, in that real audit, 34 actions genuinely
existed in the sampled portfolio. If a school's actual sampled evidence
contains only 3 thin records, a prompt instructed to "write in this style"
without a hard anti-invention constraint could be tempted to write as if
more evidence existed, invent a plausible-sounding count, or imply
completeness the sample does not support.

**This is a solved problem in this codebase already** — every existing
narrative-generation prompt traced above carries an explicit, working
counter-instruction:
- `findingWriter.ts:199-200`: *"do NOT invent or assume information that is
  not in the lines."*
- `FinalReport.tsx:487`: *"You must not invent any fact, number, document or
  citation that is not in the source text."*
- `agentRuntime.ts:2807`: *"If you cannot state something concrete, return
  "" — do not pad."*
- `agentRuntime.ts:619` (closure drafting): *"reference the actual
  evidence/records that should exist… do not claim the finding is closed."*

**The guardrail pattern to reuse everywhere:** (1) build the grounding block
from ONLY real fields already in the data model (never invented text), (2)
put an explicit "do not invent X/Y/Z, if absent say so or omit it" clause in
every narrative prompt, (3) an honesty filter on the reply that discards any
output not keyed to a row the caller actually asked about (`filterConcise
Summaries`, `finalReport.ts:576-585`, is the reference implementation),
(4) accept that a thin sample legitimately produces a thin paragraph — the
prompt must never be told to "reach" a target length or richness.

### Risk B — narrativising a field that has a hard verbatim contract (real
risk, narrow and specific)

Two fields in this codebase are checked byte-for-byte (after light
normalisation) against real source text, not just "grounded in spirit":

1. **Findings register `criteria`** — `findingCriteriaCheck.ts:31-39`,
   enforced at write time, flags `criteriaUnverified` on mismatch. **A
   narrative rewrite must never paraphrase this field.**
2. **The APSR/rubric verbatim quotes** (`EDUTRUST_BANDS`/`EDUTRUST_DIMENSIONS`
   descriptor text, `src/data/edutrustRubric.ts:15,31,76`) and the
   verified quote/chunkId pairs inside `PPDReviewRow`/`EvidenceAssessmentRow`
   (only quotes passing `quoteExistsInSource()` survive,
   `agentRuntime.ts:2334-2335`) — these exist specifically so a claim can be
   traced to an exact source string. **A narrative pass may reference or
   quote these, but must never rephrase the quoted portion itself.**

Both risks are already-solved patterns in this codebase (the verbatim
checker is deterministic code, not a prompt instruction — it cannot be
"forgotten" by a new prompt as long as the field it guards is left alone).
**The instruction for the build: narrative rewrite targets the surrounding
prose (observation, root cause, corrective action, Strength/Weakness
paragraphs); it must never be the mechanism that writes `criteria` or a
verbatim rubric quote.**

### Per-surface confidence

| Surface | Enough grounded data to narrate truthfully? | Confidence |
|---|---|---|
| 1. Final Report | Yes — richest existing precedent, already shipped | High |
| 2. Findings register | Yes — most mature prompt already, only `corrective` needs the style upgrade | High |
| 3. Quality Action / AFI | Yes — AI generation already exists; needs paragraph form restored | High |
| 4. Sub-Criterion Checklist | Yes — richest raw grounding (verified quotes); build on `overallNarrative`, don't rewrite the terse per-line note | High |
| 5. Evidence Folder | Yes — same infrastructure as #4 | High |

I found no surface where the honest answer is "not enough data" — this
project's AI pipeline was already built with citation/verification discipline
(quote-existence checks, chunk IDs, honesty filters) well ahead of most of
its user-facing text having caught up to a narrative register. The work is
substantially a *prompt and rendering* change, not a *new plumbing* problem.

---

## 3. The log-split design

**The mechanism already exists — it does not need to be invented.**
`AIReviewLogEntry` (`types/index.ts:1310-1344`) already carries `promptSent`
(full SYSTEM+USER text) and `generatedContent` (raw model output) for every
AI call across the app, pushed via `pushAIReviewLog`/inline `set()` calls
from ~10+ call sites in `useWorkspaceStore.ts`, capped at 500 entries
(`.slice(0, 500)`), and surfaced **only** on a separate diagnostic route,
`/ai-review` ("AI Review Log", `src/nav.ts:66`, `src/App.tsx:65`) — not one
of the five target surfaces. This is precisely the "raw technical/AI
reasoning → log, not front end" split the user is asking for, already built
and already in continuous use.

**What already implements the split correctly (reference cases):**
- Quality Action / AFI closure drafting: the model's raw paragraph is logged
  verbatim to `aiReviewLog.generatedContent`
  (`useWorkspaceStore.ts:3521`-area), while a **reformatted** (sentence-split)
  version lands in the user-facing textarea via `formatDraftedClosureText`
  (`useWorkspaceStore.ts:167-174`). This is the closest existing instance of
  "raw to the log, polished to the front end" — it just needs its
  reformatting step changed from "one sentence per line" to "one flowing
  paragraph" to match the gold standard.
- The generate-once-and-save persistence shape (`ReportAiSuggestion`,
  `types/index.ts:1133`: `{text, generatedAt, model}`) is the right shape
  for a "polished narrative" field: it stores only the finished text, keyed
  per row, separate from any raw reasoning.

**A genuine gap found, stated bluntly:** `generateConciseSummaries`
(`FinalReport.tsx:481-509`) and `generateSuggestions` (`:511-541`) — the
two newest, most gold-standard-adjacent generators — call `chatComplete`
directly and **do not** push to `aiReviewLog`. I confirmed this by grep
(`grep -n "pushAIReviewLog\|aiReviewLog" src/pages/FinalReport.tsx` returns
only a read of `aiReviewLog` for the provenance line, never a write from
either generator). **This means the two features closest to the target
style currently have NO raw-reasoning log at all** — if the model ever
under-delivers or a user disputes a summary, there is nothing to inspect.
This should be fixed as part of the rollout, not left as-is: every new/
modified narrative generator should call `pushAIReviewLog` with the raw
`promptSent`/`generatedContent`, exactly as the closure-drafting and
Option A/B judge passes already do.

**Recommended log-split design, concretely:**
1. **Raw reasoning** (system+user prompt sent, raw model reply, verdict/
   confidence/model/tokens) → `pushAIReviewLog` into the existing
   `aiReviewLog` (already the log; already isolated to `/ai-review`). No new
   store, no new type needed.
2. **Polished narrative** (the thing a user reads) → a new field on the
   existing per-surface `ReportAiSuggestion`-shaped record (or a
   surface-appropriate equivalent — the closure module already has this via
   its textarea fields), generate-once-and-save, keyed per row/item, never
   regenerated on render.
3. Every narrative generator does BOTH steps in the same call — logs the raw
   exchange, then filters/saves only the polished text. This reuses
   `chatComplete`/`effectiveSettings` exactly as today; no new AI plumbing.
4. Persistence confirmed reused, not reinvented, for surfaces 1 (concise
   summaries/suggestions already do this) and 3 (closure textareas already
   persist as part of `customFindings`/`closures`). Surfaces 2, 4, 5 would
   need new persisted narrative fields following the same
   `{text, generatedAt, model}` shape.

---

## 4. Shared vs per-surface prompt

**Recommendation: one shared "auditor-voice" instruction module, injected
into each surface's own grounding-specific prompt — not five independent
prompts, and not literally one prompt call for all five.**

Reasoning:
- The **register** (name the sample → present → "However," → itemised
  absence; neutral Band line; recommendation-register Required Action;
  matching Strength paragraph) is identical across all five surfaces — this
  is exactly what a shared instruction block should own.
- The **grounding data** is different per surface (Final Report reads
  per-item rollups; Findings reads checklist-line groups; AFI reads a single
  finding + requirement; Checklist/Evidence Folder reads per-line judge
  output) — this must stay per-surface, because the user-message/grounding
  block is inherently different shaped data each time (as it already is
  today, per `buildConciseUserPrompt`/`buildGroupContext`/
  `buildAiSuggestionUserPrompt`, all distinct functions).
- **This project already has the exact mechanism for a shared instruction
  block**: `src/lib/ai/skills.ts`'s `buildSystemPrompt()` / `MODULE_SKILLS`
  injection map (`skills.ts:129,205,258-266`), used by every judge/writer
  prompt in the app to append shared, capped skill text. A new
  `auditor-narrative-voice` skill module, injected via the same mechanism,
  is the least-duplicative approach: one canonical statement of the register
  and the anti-invention rule, reused by every surface's own
  generation call, exactly the way `buildSystemPrompt("findingWriter", …)`
  and `buildSystemPrompt("bandRecommend", …)` already work today
  (`findingWriter.ts:201`, `FinalReport.tsx:488,518`).

Do not build five separate one-off prompts (duplicates the register wording
five times, drifts over time) and do not build one single call that tries to
produce all five surfaces' narratives at once (the grounding data is too
differently shaped, and it would break the generate-once-and-save,
per-row/per-item cadence each surface already has).

---

## 5. Interaction with existing features

- **(a) Verbatim rubric quotes** — must STAY verbatim, never narrativised.
  Covered in §2 Risk B. The `criteria` field (Findings) and the
  `EDUTRUST_BANDS`/`EDUTRUST_DIMENSIONS` descriptor text and verified
  quote/chunkId pairs are the specific fields to exclude from narrative
  rewriting; everything else (observation, root cause, diagnosis, Strength/
  Weakness prose) is fair territory.
- **(b) Strength/Weakness polarity fix** — the consistency checker's **R4**
  rule (`consistencyChecker.ts:150-170`, INV-06) compares a row's
  Strength/Weakness label against the **structured `apsr.status` enum**,
  never the prose (explicit comment: *"Deterministic: compares the row
  verdict against the structured apsr.status enum, never the prose"*). A
  narrative rewrite of the *wording* cannot trip R4 as long as the
  underlying `status` field is untouched — which it must be regardless,
  since R10 (INV-12, `consistencyChecker.ts:205-225`) separately locks
  `apsr[key].status`/`evidenceVerdict`/`line.status` to fixed vocabularies.
  **Safe to co-exist, provided the narrative layer only ever writes to new
  text fields, never to `status`.**
- **(c) Policy/Evidence pills** — these render off the same structured
  `status`/verdict enums (Surface 4/5 findings above), not off the prose
  text. No conflict identified; the pills and a longer narrative paragraph
  are complementary (pill = at-a-glance status, paragraph = the write-up).
- **(d) Consistency checker's text checks** — **R3** (`:128-148`, INV-05)
  flags empty-where-expected or truncated text (unbalanced parentheses, or a
  cut mid-abbreviation like "e."/"i.") on `report.items[].overallSummary`
  and `findingsGroups[].rows[].finding/.afi` — the **Final Report's derived
  fields**, not the raw `ppdComment`/`evidenceComment`. Any new narrative
  text that ultimately flows into those specific Final Report fields must
  not be truncated by any new UI-layer cutoff in a way that breaks mid-word
  or mid-abbreviation (the existing `ExpandableText`/220-char truncation
  pattern on `PPDReview.tsx`/`LineageDiagram.tsx` truncates at a word
  boundary already — reuse that, don't invent a new truncator). **R8**
  (`:76-78,227-230`) checks the `OPTION_A_NOT_ASSESSED_NOTE` sentinel string
  stays byte-identical in three places — a narrative rewrite must not alter
  this specific sentinel or its detection prefix (`isOptionANotAssessedNote`,
  free-text-prefix match). Everything else in R1-R10 reads structured
  fields, not prose, and is unaffected.

No conflicts found that would block this work; the two items requiring
active care while building are the `criteria` verbatim check (§2 Risk B) and
the `OPTION_A_NOT_ASSESSED_NOTE` sentinel (R8) — both narrow, both already
have a clear "leave this field/string alone" boundary.

---

## 6. Recommended build order

**Pilot first on Surface 1's existing concise-summary feature — do not
build five new generators before proving the shared-skill approach on one
real, already-shipped surface.**

1. **Pilot: extend the existing `generateConciseSummaries`
   (`FinalReport.tsx`)** to the full gold-standard shape (Strength +
   Weakness paragraphs, neutral Band line, Required Action recommendation)
   and add the missing `pushAIReviewLog` call (§3 gap). This is the lowest
   risk starting point because: the generate-once-and-save plumbing, the
   honesty filter, and the "ground only in text already present" prompt
   pattern are all already built and shipped; the only change is prompt
   content (richer structure) and adding the log-split write. Verify live
   before moving on.
2. **Findings register (`corrective`/`suggestedActionText` only)** — swap
   `buildDraftFinding`'s imperative template for the recommendation
   register, reusing the exact grounding already fed to
   `runLiveGroupedFindingWriter`. Do not touch `criteria`.
3. **Quality Action / AFI** — change `formatDraftedClosureText` from
   sentence-split to paragraph form; add the missing log-split write for
   `draftClosureActions` if not already present (needs re-confirmation at
   build time — the agent trace found `generatedContent` logging exists for
   this path via the AI Review Log entries already built at
   `useWorkspaceStore.ts:3521`-area, but confirm the RAW un-split text, not
   the reformatted one, is what's logged).
4. **Sub-Criterion Checklist** — extend/restructure `overallNarrative`
   toward the gold-standard shape at the sub-criterion level; leave the
   per-line `shortComment`/`note` fields as short citations (they are
   load-bearing elsewhere as one-line evidence pointers, not the narrative
   surface itself).
5. **Evidence Folder** — since Surface 4 and 5 share the same underlying
   data and prompts, this should fall out of step 4 with no separate
   generation work — only a rendering decision on `PPDReview.tsx` about
   whether/where the extended `overallNarrative` also displays.

Introduce the shared `auditor-narrative-voice` skill module (§4) once, at
step 1, and reuse it unchanged through steps 2-5 — this is what proves
(or disproves) the "least-duplicative" claim in §4 before committing to it
project-wide.

---

## What this means for you

Every surface has enough real evidence behind it today to write in the gold
standard's voice honestly — the app was already built with unusually strict
citation discipline (verified quotes, chunk IDs, honesty filters, a
deterministic verbatim-quote checker) well ahead of the prose actually using
it. The two things that need real care, not just prompt-writing, are: never
let the narrative pass touch the `criteria` field or a verbatim rubric quote
(there is a hard, code-level check on one of those already), and close the
one real gap found — the two newest AI generators (concise summaries,
improvement suggestions) do not currently write their raw output to the log,
so that needs adding as part of the rollout, not assumed already covered.
Nothing here was built or changed; this is the map for the STOP-and-decide
conversation before the first line of that build is written.
