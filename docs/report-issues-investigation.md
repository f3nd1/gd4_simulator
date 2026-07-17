# Final Report investigation: four issues on item 6.2.1 (Option A)

Investigation only. No application logic or data was changed. All claims cite
real file:line evidence at the current `main`. Confidence is stated per finding.
UK spelling, no em dashes.

The Final Report page is `src/pages/FinalReport.tsx`; its data builder is
`buildFinalReport` in `src/lib/finalReport.ts`. Per item it renders an overall
summary, a findings table grouped by APSR dimension (approach, processes,
systems and outcomes, review), a collapsed "Full band justification" fold, and
the findings register.

---

## Issue 1: AFI text should be AI-generated improvement advice, not a rubric quote

### Where each row's AFI text is set

The findings table has three row verdicts, each with its own AFI source
(`src/lib/finalReport.ts:198-227`):

- Strength rows: AFI comes from `strengthNextBandAfi`
  (`src/lib/finalReport.ts:33-40`). It quotes the official EduTrust rubric
  descriptor for the band ABOVE this dimension's current band:
  `bandLevel(next)[key]`. `bandLevel` is a plain array index into
  `EDUTRUST_BANDS` (`src/data/edutrustRubric.ts:83-85`), which is declared
  verbatim from EduTrust GD4 section 23 ("quoted VERBATIM ... Do NOT paraphrase",
  `src/data/edutrustRubric.ts:1-9`). So the strength AFI is a real, verbatim
  rubric descriptor wrapped in a fixed frame, no AI, no paraphrase. Example for
  `review`, dimBand 3: 'To reach Band 4 on Review, the EduTrust rubric looks for:
  "Implemented action plans for improvement are monitored for effectiveness ..."'.
  This is exactly the "rubric quote" you are seeing.
- Weakness rows: `finding` = `lineDimensionDiagnosis(l, key)` and `afi` =
  `lineSuggestedAction(l)` (`src/lib/finalReport.ts:200,211,215`). These ARE
  real per-line AI-authored text (the diagnosis and suggested action recorded
  when the line was assessed), not rubric quotes.
- Not-assessed rows: fixed `NOT_ASSESSED_AFI`
  (`src/lib/finalReport.ts:24,207`).

The AFI column renders at `src/pages/FinalReport.tsx:509` (via `renderAfi`,
`:398-425`), under the header "AFI (to reach next band)" (`:477`).

So the specific complaint, "Strength rows show a rubric quote", is accurate and
is `strengthNextBandAfi`. Weakness rows already carry genuine per-line advice.

### This was a deliberate, documented choice, and there is already a doc

`docs/afi-improvement-investigation.md` (dated 2026-07-16) investigated this
exact column. It records that the strength AFI USED to be a single fixed generic
maintenance sentence (same text for every strength at every band), which told
the reader nothing about the "next band" the column header promises. It
concluded the next-band descriptor could be shown verbatim with no AI call and
no fabrication, gated on the dimension's own band. The shipped
`strengthNextBandAfi` implements exactly that. So the current rubric-quote
behaviour is intentional and recent, not an accident.

What you are now asking for is a further change: replace that verbatim rubric
quote (and, for weaknesses, optionally augment the recorded diagnosis) with
genuinely AI-generated "here is what to do to improve" prose.

### What data is available for an AI suggestion at that point

Everything is already in scope in `buildFindingsGroups`/`analyseItem`
(`src/lib/finalReport.ts:182-231, 347-397`): the dimension `key` and label, the
dimension's own band `score` and percentage, the item band and title, the
per-line real text (`lineDimensionDiagnosis`), the per-line suggested action
(`lineSuggestedAction`), the verbatim next-band descriptor (`bandLevel`), and
the whole holistic band rationale (`entry.holisticBand.rationale`). An
improvement prompt would have plenty to ground on.

### How AI is already called on this page (reuse this)

`generateSummary` (`src/pages/FinalReport.tsx:75-127`) is the existing pattern:
`effectiveSettings(aiSettings, { purpose: "analysis", ... })` (`:79`) +
`buildSystemPrompt("bandRecommend", null, ...)` (`:80-81`) +
`chatComplete([...], settings)` (`:100`). `chatComplete`/`effectiveSettings`
live in `src/lib/ai/aiClient.ts`; `buildSystemPrompt` in `src/lib/ai/skills.ts`.
A future AI-AFI call should reuse this, passing `purpose: "analysis"`.

### Storage: generate-once-and-save vs regenerate-per-render

The executive summary is NOT persisted today: it lives in component `useState`
(`FinalReport.tsx:45-46`, set at `:120-121`), is regenerated on every "Generate
AI summary" click, and is lost on unmount. Only the human's accept/edit decision
is logged (`logHumanDecision`, `:65-73`), never the text itself.

For AI-AFI you would choose one of:

- Regenerate per render/click (like the summary today): no new persistence, but
  a fresh OpenAI cost every time, non-deterministic wording, and the on-screen
  text can disagree with the printed PDF. Poor fit for a report meant to be
  stable and printable.
- Generate once and save: one cost per item, stable wording that survives reload
  and matches the PDF, and it can be human-edited-and-logged like the summary.
  Requires a persisted field (keyed by item id, or per row) plus the usual human
  gate.

### The design question you must confirm

AI-generated improvement prose is fabricated text by definition. It breaks the
project's standing rule ("never fabricate guidance; reuse stored fields
verbatim; every AI artefact cites real sources"). Note the current design went
the OTHER way on purpose: it chose a verbatim rubric quote precisely to avoid
fabrication (`finalReport.ts:31-32` comment, and the afi-improvement doc). So
this is a deliberate reversal you are requesting. It is defensible (the Final
Report is explicitly an internal readiness aid, not an SSG result), but it
should carry the same guardrails as the summary: clearly labelled "AI",
generated once and saved, and editable-and-logged so a human owns the wording.

### What this means for you

The strength AFI is a verbatim EduTrust rubric line by design, not a bug and not
AI. Weakness rows already show real recorded advice. Turning strength (and,
if you want, weakness) AFIs into genuine AI improvement suggestions is
straightforward using the existing `generateSummary` pattern, but it is a
conscious break from the no-fabrication rule that the current code deliberately
avoided, and it needs a save-once, human-editable field rather than per-render
regeneration.

Fix sketch (not implemented): add an optional persisted `aiAfi` per row (or per
item-dimension), populated by one `chatComplete({purpose:"analysis"})` call
grounded on the dimension band, the real per-line diagnosis, and the next-band
descriptor, rendered under a clear "AI suggestion" label with the existing
thumbs/FeedbackModal gate, generated on demand and saved, never re-rolled on
render.

---

## Issue 2: PPD vs Evidence not distinguished on findings

### No pass field exists

The `Finding` type (`src/types/index.ts:196-268`) has no field naming which
Option A pass produced it. The provenance-ish fields are:

- `source?: "Audit" | "Checklist" | "Manual" | "Seed" | "ai_audit" | "PPD Review"`
  (`src/types/index.ts:214`).
- `dimension?: FindingDimension` (`:216`), a rubric dimension, not a pass.
- `apsr?: ApsrBreakdown` (`:238`), which carries both the approach (PPD) and
  processes (evidence) legs together.
- `linkedSourceRefs?`, `linkedChecklistLineIds`, `auditRunId`, `clause`:
  line/run traceability, no pass tag.

### A normal Option A finding is indistinguishable by source

The main Option A compile path routes through `confirmDraftFinding`
(`compileEvidenceFindings`, `src/store/useWorkspaceStore.ts:2171`), which
hardcodes `source: "Checklist"` (`src/store/useChecklistModuleStore.ts:686`),
the SAME value Option B's staged audit produces. So `source` does not even
separate Option A from Option B, let alone PPD from Evidence, for these row
findings.

The only findings with a clean PPD identity are the PPD internal-contradiction
findings, built directly with `source: "PPD Review"`
(`src/store/useWorkspaceStore.ts:2221`).

### The structural catch: Option A fuses both passes into one finding

`buildOptionALineWrites`/`optionAApsr` write ONE line per requirement whose
single APSR combines both verdicts: `approach.status` from the PPD verdict and
`processes.status` from the evidence verdict
(`src/lib/optionAChecklistWrite.ts:29-45`, applied at `:159`). The line's own
status is the evidence verdict (`:106`), and the evidence item stores both
`ppdVerdict` and `evidenceVerdict`. So a normal Option A finding inherently
reflects both passes at once, and a single "PPD vs Evidence" pill on it would be
ambiguous.

The finding does already carry the distinction internally: its `apsr.approach`
note is the PPD-pass result and its `apsr.processes` note is the Evidence-pass
result, so a reader can see which pass drove the gap by which APSR leg failed.

### Confidence

High. The absent pass field, the shared `source: "Checklist"`, and the
two-passes-into-one-line fusion are all directly evidenced.

### What this means for you

There is no "which pass" flag today, and because Option A folds the policy
verdict and the evidence verdict into a single finding, one raw PPD/Evidence
pill would be misleading for most findings. What IS clean and already stored is
the APSR dimension: Approach = policy/PPD, Processes = evidence.

Fix sketch (not implemented): render a small pill from the existing
`dimension`/`apsr` data, "Policy gap (PPD)" when Approach failed, "Evidence gap"
when Processes failed, and tag the contradiction findings
(`useWorkspaceStore.ts:2221`) explicitly as "PPD". No schema change needed for
the common case. A genuine standalone pass field would only be worth it if you
later split Option A into two separate findings per line.

---

## Issue 3: "Processes: No lines currently tagged" but the band justification discusses Processes

### The two texts come from two unrelated dimension-assignment paths

The per-dimension grouping and the band justification are produced by different
mechanisms that are never reconciled:

- The per-dimension table groups each line by `resolveLineDimension(l)`
  (`src/lib/finalReport.ts:197`). `resolveLineDimension`
  (`src/lib/checklistBanding.ts:306-310`) does NOT read the stored
  `apsrDimension` field. It resolves from the line's official source ref
  (`sourceRef`/`clause`) via a `REF_DIMENSION` map, and only falls back to a
  keyword classifier on the line text when the ref is unknown. `REF_DIMENSION`
  is built once by running the deterministic keyword classifier
  `classifyApsrByContent` over every GD4 requirement's official `flatAuditPoints`
  text (`src/lib/checklistBanding.ts:264-294`). When no line resolves to
  "Processes", the group is pushed with `rows: []` (`finalReport.ts:228`) and the
  UI shows "No lines currently tagged to this dimension."
  (`src/pages/FinalReport.tsx:491`).
- The band justification is `entry.holisticBand.rationale`
  (`src/lib/finalReport.ts:391`), rendered as one raw AI-authored blob in the
  "Full band justification" fold (`src/pages/FinalReport.tsx:556-565`). It is
  NOT split or constrained by dimension, so it can name Processes freely.

So the table says "no Processes lines" from a deterministic ref classifier,
while the justification discusses Processes from unconstrained AI prose. They
disagree because they are two independent judgements of "what counts as
Processes", not one shared source.

### Why 6.2.1 specifically

6.2.1 is Management Review, so its official points are dominated by review
language. For example the DS2 point (`src/data/gd4Requirements.ts:482`) reads
"Make use of the findings from the management review for continual improvement",
which contains "review", so `classifyApsrByContent` classifies it as Review, not
Processes. The only points that map to Processes are ones like the follow-up
action register (evidence ref, "register" keyword) or DS3 "Monitor the
implementation" ("implement" keyword). If those lines are absent, Not
Applicable, or simply were not written for this item, the Processes group is
genuinely empty, while the AI rationale still loosely calls the follow-up or
implementation activity "Processes".

### Is this commit 6ddeb7c resurfacing, or a different cause

Different cause, high confidence. Commit `6ddeb7c` fixed a real bug where the
grouping read the stored `apsrDimension` tag, which the Option A audit never
writes, so every dimension showed empty. That fix switched grouping to
`resolveLineDimension` (official-ref based), and the current code uses it as the
only grouping filter (`finalReport.ts:197`), with no second path still reading
the stored tag. So the fix is intact and working.

The Issue 3 mismatch is NOT that regression returning. It is a genuine, expected
artefact of having two different dimension vocabularies in play: a deterministic
ref-and-keyword classifier for the grouping, versus free AI rationale text that
is not bound to that classifier. For a review-heavy item like 6.2.1 the
classifier legitimately leaves Processes empty while the prose still mentions it.

### Confidence

High on the mechanism (two independent dimension-assignment paths, one
deterministic and grouped, one free-text and ungrouped). Medium-high that the
6.2.1 Processes-empty case specifically is the DS2-maps-to-Review keyword
behaviour traced above (it depends on exactly which lines this run wrote).

### What this means for you

The empty "Processes" row and the Processes discussion in the justification are
not contradicting each other about the facts; they are two different ways of
deciding which dimension a line belongs to. The table uses a strict
ref/keyword classifier (which, for a review-focused item, can correctly find no
pure "Processes" line), while the justification is free AI text that uses the
word more loosely. It is not the earlier bug returning.

Fix sketch (only if you want them to agree, not clearly a defect): either (a)
suppress or soften the empty-dimension placeholder when the dimension's matrix
score still contributed to the band (say "No individual line traced to Processes;
see the band justification" instead of a bare "No lines currently tagged"), or
(b) have the justification generated per dimension so its vocabulary matches the
grouping. Both are presentational; neither touches scoring. Confirm which
behaviour you actually want before any change.

---

## Issue 4: Systems and Outcomes / Review show "Not assessed by Option A, run the staged audit"

### This is by design, with certainty

Option A structurally assesses only two of the four APSR dimensions. `optionAApsr`
hardcodes the other two (`src/lib/optionAChecklistWrite.ts:42-43`):

```
systemsOutcomes: { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
review:          { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
```

with `notAssessedNote = OPTION_A_NOT_ASSESSED_NOTE`
(`src/lib/optionAChecklistWrite.ts:18-19`), set unconditionally (no branch on
run data). The design comment (`:24-28`) states it plainly: "Systems and
Outcomes and Review are NOT assessed by this path, recorded honestly as 'Not
evident' with a note saying so, never fabricated."

The Final Report reads that sentinel and renders those rows as the neutral
"not-assessed" verdict, not a weakness: `isOptionANotAssessedNote`
(`src/lib/optionAChecklistWrite.ts:20-22`) is checked at
`src/lib/finalReport.ts:206`, before the status-based weakness test, so an
unassessed dimension is never mislabelled a finding.

The only path that DOES assess these two is the Option B staged audit's third
pass: `runStagedOutcomeReviewAudit` feeds `buildStagedApsr`, which sets Systems
and Outcomes from `outcomeRow.outcomeEvident` and Review from
`outcomeRow.reviewEvident` (`src/lib/ai/agentRuntime.ts:1824,1890-1932`). That
pass is "Pass 3 of 3, Outcomes and Review check"
(`src/pages/EvidenceFolder.tsx:710`).

### Confidence

Certain. The hardcoded statuses, the explaining comment, and the separate Option
B third pass are unambiguous.

### What this means for you

Running the audit via Option A (the PPD plus Evidence path) genuinely only
covers Approach (your policy) and Processes (implementation evidence). It cannot,
by design, assess Systems and Outcomes (outcome and trend data) or Review
(periodic review feeding improvement). Those need either the Option B staged
audit's third pass, or outcome/review evidence attached and scored on the
Sub-Criterion Checklist. The message is telling the truth: you ran Option A, and
Option A does not look at those two dimensions. It is a scope and expectation
mismatch, not a failed run.

No engine fix is warranted. The only optional improvement is wording: the note
could say "This path (PPD and Evidence) does not assess this dimension by
design" rather than an imperative that can read like an error after a successful
run.

---

## Summary table

| Issue | Verdict | Confidence | Fix warranted |
|---|---|---|---|
| 1 Strength AFI is a rubric quote | Intentional, verbatim rubric descriptor (`strengthNextBandAfi`); weakness rows already use real per-line advice. AI-AFI is a deliberate reversal of the no-fabrication choice | High | Optional, opt-in AI field, save-once, human-gated |
| 2 PPD vs Evidence tag | No pass field; normal Option A finding is `source:"Checklist"` (same as Option B); Option A fuses both passes into one finding, so a single tag is ambiguous; APSR already separates them | High | Partial, tag by APSR dimension not a raw pass flag |
| 3 Processes "no lines" vs justification | Two independent dimension paths: deterministic ref/keyword grouping vs ungrouped AI rationale text; not the 6ddeb7c bug returning; expected for a review-heavy item | High on mechanism, medium-high on the exact 6.2.1 cause | Optional and presentational only |
| 4 S and O / Review "not assessed" | By design; Option A cannot assess these two; message is correct | Certain | No engine fix, optional wording clarification |
