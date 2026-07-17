# Final Report findings: six symptoms, three root causes

Investigation only. No application logic, data or config was changed. Every
claim cites file:line evidence with stated confidence. No fixes are made; each
section ends with a one-line fix sketch only. UK spelling, no em dashes.

**Commit analysed:** `b946b3f5b04cd8aa4fdc20886d9ccd3a60ec9d4d` (local HEAD
confirmed equal to origin/main before analysis, clean tree).

**Headline:** these are not six unrelated bugs. Four of the six trace to one
structural fact about how the findings table is built (the "axis conflation"
described under the cross-cutting section), one is raw engine text rendered
verbatim, and one is unenforced AI-response completeness. Symptom 3 is not a
defect at all: the data the user wants is already stored separately.

---

## Symptom 1: AI suggestion appears under weakness rows but not strength rows

**Root cause: two stacked mechanisms, one certain and one runtime-dependent.
Confidence: high on the mechanisms; which one the user saw needs the AI Debug
Log (named below).**

The suggestion is generated and stored PER ITEM-DIMENSION, not per row (the
approved item-3 design): one storage key `itemId::dimensionKey` and one
rendered row appended AFTER all of a group's rows
(`src/pages/FinalReport.tsx:610`, the `${g.key}-ai-suggestion` row pushed
after `rowEls`). Two consequences:

1. **Placement reads as row-level.** In a group containing both strength and
   weakness rows, the single dimension-level suggestion row sits under the
   LAST row. Visually it attaches to whatever row happens to be last (often a
   weakness), and the strength rows above appear to "not have" a suggestion.
   The design intent (suggestion for the dimension, covering both row types)
   is invisible in the layout.
2. **No completeness enforcement.** The prompt asks the model for "EACH
   dimension in the user message" (`FinalReport.tsx:476`), and strength-only
   dimensions ARE included in the prompt (`buildAiSuggestionUserPrompt`
   includes strength rows, `src/lib/finalReport.ts`). But `filterAiSuggestions`
   keeps whatever the model actually returned; nothing checks that every
   eligible dimension came back, re-asks, or renders a "no suggestion
   returned" marker. A model that interprets "how to improve" as
   weaknesses-only silently produces exactly the observed asymmetry.

Which mechanism produced the 6.1.1 observation is a runtime fact: check the AI
Debug Log entry for `FinalReport.generateImprovementSuggestions` (was the
strength dimension in the reply?) or the stored `reportAiSuggestions` keys.

**Fixable: yes.** Fix sketch (not implemented): after parsing, treat an
eligible dimension missing from the reply as a visible gap ("no suggestion
returned, regenerate"), and label/band the suggestion row explicitly as
dimension-level (or render it under every row) so strengths visibly share it.

---

## Symptom 2: "Weakness" label on strength-toned text (R4 / INV-06)

**Root cause: the label and the text come from two different axes.
Confidence: high (deterministic, code cited).**

- The row's verdict comes from the LINE's overall state:
  `const isWeakness = l.status !== "Met" || lineSufficiency(l) !== "Present"`
  (`src/lib/finalReport.ts:268`). This is line-level: one status for the whole
  requirement line.
- The row's text comes from the DIMENSION LEG:
  `lineDimensionDiagnosis(l, key)` reads `apsr[key].note` for the group's own
  dimension (`checklistBanding.ts:245-247`).

6.1.1.DS1.d sits in the Approach group. Its line is overall Not met or
evidence-insufficient (so: Weakness label), but its Approach LEG is positive —
the PPD does document CAP owners and timelines, status "Meeting", note
"Documented, because…". Line axis says weakness; leg axis says strength; the
row prints the weakness label over the strength text.

R4 detects exactly this, deterministically, from the structured enum rather
than the prose (`src/lib/consistencyChecker.ts:150-168`, polarity sets at
`:44-47`): a weakness-labelled row whose `apsr[key].status` is positive fires
INV-06. So yes: the checker flags it, and the report itself has no equivalent
guard — nothing in `buildFindingsGroups` consults the leg's own status when
assigning the verdict.

**Fixable: yes, and it kills the recurring class.** Fix sketch (not
implemented): derive the row verdict from the LEG's own status (positive leg →
strength row, negative → weakness, middle values fall back to the line
status), which makes R4 structurally impossible on this page. Display grouping
only; no score input changes.

---

## Symptom 3: split findings into PPD / Evidence / Overall in the table

**Not a defect: the three parts are ALREADY stored separately and verbatim for
Option A lines. Confidence: high.**

Per audited line, the checklist evidence item stores, as distinct fields
written at commit time and never parsed back out of free text
(`src/types/index.ts:322-333`):

- PPD view: `ppdVerdict` (`:322`) + `ppdComment` (`:332`), plus the Approach
  leg's own note (`apsr.approach.note`, the PPD-pass short comment).
- Evidence view: `evidenceVerdict` (`:331`) + `evidenceComment` (`:333`), plus
  the Processes leg note, plus `promiseChecks` (verified quotes) and
  `suggestedAction`.
- Overall: the line's own `status` (the combined Met/Partial/Not met) and the
  same fields the checklist card's tabs already render.

The current table row is NOT a fused blob: it shows exactly ONE leg's note
(`lineDimensionDiagnosis(l, key)`), chosen by the group's dimension. The other
parts exist and are retrievable; the Sub-Criterion Checklist card already
renders them as separate PPD/Evidence tabs, which is the proof the split works
from stored data.

Caveats: Option B staged lines have the four leg notes but no
`ppdComment`/`evidenceComment` (the Approach/Processes leg notes serve the
same roles); very old rows may have neither. A three-part render must show
only fields that exist, never synthesise a missing part.

**Fixable: yes, without fabrication.** Fix sketch (not implemented): render
three labelled blocks per finding row from `ppdVerdict + ppdComment`,
`evidenceVerdict + evidenceComment (+ promiseChecks)`, and the line status +
leg note, hiding any block whose field is absent.

---

## Symptom 4: finding text far too long (the "#1 … #8" dump)

**Root cause: the Outcomes & Review pass stores a multi-window merged note
verbatim on the APSR leg, and the report now renders leg notes in full.
Confidence: high.**

The numbered format is the staged engine's note merge: each window's positive
note is kept (`pushWindowNote`, `src/lib/ai/agentRuntime.ts:1460`) and the
final row note is rendered as numbered, citation-labelled entries
`#N [file · chunk]: …` (`renderWindowNotes`, `:1495-1510`, applied at
`:1683`). The on-demand pass carries that merged note verbatim onto the line's
`apsr.review` / `apsr.systemsOutcomes` legs (via `buildStagedApsr`'s note
passthrough in `outcomeReviewLegs`, `src/lib/outcomeReviewApply.ts`). 6.1.1's
DS1.a is a Review-type line, so its Review leg now holds the whole merged
note, and since the Item 1 fix (full text, no truncation) the table prints it
whole. The old truncation was hiding this; removing it exposed it.

**Is there a shorter real field?** No. For these legs the merged note is the
only stored text; the pass keeps no per-point short summary
(`OutcomeReviewRow` carries one `note`, `src/types/index.ts:735-744`, which IS
this merged text). The individually numbered entries inside it are themselves
short, and each carries its own citation.

**Fixable: yes, three honest options.** Fix sketch (not implemented): (a)
presentational fold — show the first numbered entry, expand for the rest; (b)
a generate-once-and-save 2-3 sentence summary reusing the item-3 pattern,
clearly AI-labelled, with the full note behind a fold; (c) engine change so
the pass also stores a short summary field. (a) is smallest and fabricates
nothing.

---

## Symptom 5: report tone too technical

**A mapping question, not a bug. Confidence: high on the classification.**

- **(a) Verbatim official text — must NOT be reworded:** the EduTrust band
  descriptors quoted in strength AFIs and as AI-suggestion targets
  (`EDUTRUST_BANDS` via `bandLevel`, declared verbatim in
  `src/data/edutrustRubric.ts:1-9`), official requirement/point text and ref
  labels (`gd4Requirements.ts`), and any quoted GD4 wording inside findings.
- **(b) Real AI-generated stored text — plainer voice is possible but only by
  REGENERATION, never in-place edit:** leg diagnoses/notes, `suggestedAction`,
  `holisticBand.rationale`, `reportAiSuggestions`, the executive summary. Tone
  is set by the system prompts and skills (`src/lib/ai/skills.ts`, the judge
  prompts in `agentRuntime.ts`); a plain-English style instruction there
  changes future runs. Existing stored text keeps its voice until re-run —
  that is the honest cost.
- **(c) Fixed UI microcopy — freely rewritable, zero risk:** the deterministic
  overall-summary phrase bank (`DIM_FACE`, `src/lib/finalReport.ts` around
  `:280-305`), the two empty-group placeholders, fold captions, table headers,
  `generalNote` strings, `NOT_ASSESSED_FINDING`/`NOT_ASSESSED_AFI`.

**Fix sketch (not implemented):** rewrite (c) directly; add a tone instruction
to the prompts behind (b) for future runs; never touch (a).

---

## Symptom 6: Systems & Outcomes shows a placeholder while Review shows rich content

**Confirmed on all three sub-questions. Confidence: high.**

- **Why Review has rows and S&O does not:** grouping is by the OFFICIAL
  requirement dimension of each line (`resolveLineDimension`, applied at
  `src/lib/finalReport.ts:242`). 6.1.1's official points classify as 4
  Approach, 4 Processes, 4 Review (DS1.a, DS2, EE4, N1) and ZERO Systems &
  Outcomes (probe recorded in
  docs/dimension-band-without-lines-investigation.md). Review-type lines
  exist, so Review gets rows; no S&O-type line can ever exist for this item.
- **Where the S&O judgement lives and why it never surfaces:** the Outcomes &
  Review pass judges BOTH legs for every line; the Apply click writes the
  real note and status onto each matched line's `apsr.systemsOutcomes` leg
  (`applyOutcomeReviewLegs`, `src/store/useChecklistModuleStore.ts:543`), and
  the raw per-point results also persist in `outcomeReviewResults`. But
  `buildFindingsGroups` only ever reads a leg's note for lines GROUPED UNDER
  that dimension (`lineDimensionDiagnosis(l, key)` for `dimLines` only,
  `finalReport.ts:242` onward). With zero lines grouped under S&O, no code on
  this page ever reads those legs — the only S&O trace shown is the band
  number from the human matrix.
- **Can the report show the real S&O content without fabricating?** Yes. The
  data already exists on two real, citable surfaces: the lines'
  `apsr.systemsOutcomes` legs (note + status + cited chunks, non-sentinel
  after an applied pass) and the stored pass rows. Rendering, under an
  empty-but-scored dimension, the item's lines' non-sentinel legs for that
  dimension (each with its line ref) is a pure read of stored assessment text
  — the exact mirror of what Review shows via its grouped lines. The user's
  "how can you assess Review but not S&O" is answered: both WERE assessed per
  line; only one has requirement lines to hang the display on.

**Fixable: yes.** Fix sketch (not implemented): when a dimension group has a
band but no grouped lines, render the real per-line `apsr[key]` assessments
(ref + status + note, sentinel-filtered) in place of the placeholder's second
sentence.

---

## Cross-cutting: the real root causes

**Root cause 1 — axis conflation (symptoms 2, 6, and half of 1).** The table
has one organising axis (which OFFICIAL dimension a requirement line is
worded about) but the assessment data lives on a second axis (every line
carries judgements on ALL FOUR dimensions via its APSR legs), and row labels
come from a third (the line's overall status). Symptom 2 is label-axis vs
text-axis divergence on one row; symptom 6 is leg-axis content hidden because
the grouping axis has no hook to hang it on; symptom 1's placement confusion
is dimension-level content rendered inside a row-level layout. Any fix that
re-derives row verdicts from the leg's own status and surfaces leg content
independently of grouping addresses all three at the cause.

**Root cause 2 — raw engine text rendered verbatim, no conciseness layer
(symptoms 4 and 5b).** The staged pass's multi-window merged notes were
written for completeness, not reading; the report now (correctly) shows full
text, so the missing piece is a deliberate presentation layer: fold or
summarise, and set the tone of FUTURE generations in the prompts.

**Root cause 3 — AI-response completeness is not enforced (symptom 1's other
half).** The suggestion pipeline trusts the model to cover every eligible
dimension and renders silence as absence.

Symptom 3 belongs to no defect class: the PPD/Evidence/Overall parts are
already stored separately; showing them is a feature enabled by root cause 1's
fix.

## Recommended build order (fix causes, not symptoms)

1. **Rework the row model in `buildFindingsGroups` once (root cause 1):**
   verdict from the leg's own status (middle values fall back to line
   status), and for a scored dimension with no grouped lines, surface the
   real per-line leg assessments instead of only a placeholder. This fixes
   symptoms 2 and 6 together, makes R4 structurally impossible on this page,
   and creates the hooks for step 2. Display only; `computeChecklistOverrides`
   and all scoring inputs untouched.
2. **Three-part PPD / Evidence / Overall rendering (symptom 3)** from the
   stored `ppdVerdict/ppdComment`, `evidenceVerdict/evidenceComment/
   promiseChecks` and line-status fields, hiding absent parts, on top of the
   step-1 row model.
3. **Conciseness and tone layer (root cause 2, symptoms 4 and 5):** fold the
   numbered multi-window notes to their first entry (or add a
   generate-once-and-save summary via the existing item-3 pattern), rewrite
   the deterministic microcopy in plain English, and add a plain-voice
   instruction to the generation prompts for future runs. Never touch verbatim
   rubric or official text.
4. **Suggestion completeness (root cause 3, symptom 1):** enforce per-eligible-
   dimension coverage after parsing (visible "no suggestion returned,
   regenerate" for gaps) and label the suggestion row explicitly as
   dimension-level (or render it per row) so strengths visibly share it.

Each step is independently verifiable, none touches scoring, and steps 2 to 4
each depend only on step 1 having landed.
