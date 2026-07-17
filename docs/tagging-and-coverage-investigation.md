# APSR dimension tagging, and Option A vs B vs Hybrid coverage

Investigation only. No application logic, data or config was changed anywhere.
All claims cite real file:line evidence. Confidence is stated per claim. UK
spelling, no em dashes.

**Commit analysed:** `37d268e87544ebe728c24171dce74a4255d7dc0c` (local HEAD
confirmed equal to origin/main before analysis; a prior investigation had been
run against stale code, so this was checked first with git fetch + rev-parse).

Two separate investigations follow, each with its own "what this means for you"
and, where a change is warranted, a one-line fix sketch that is NOT implemented.

---

# Investigation 1 (Issue 3): make dimension tagging authoritative everywhere

## 1. Every place that decides "which APSR dimension does this belong to"

There are two DIFFERENT concepts in the code that both get called "dimension",
and conflating them is the root of the confusion. Keep them apart:

- **Concept A: the single dimension a line/requirement BELONGS to** (one of
  Approach / Processes / Systems & Outcomes / Review). This is what the Final
  Report groups the findings table by.
- **Concept B: the four-part APSR assessment status of a line** (an
  `ApsrBreakdown`: four statuses, one per dimension, produced by the audit).
  This is a per-line score record, not a single tag.

The tagging sites, each with method and determinism:

| # | Site | file:line | Method | Deterministic? |
|---|---|---|---|---|
| 1 | `classifyApsrByContent(text)` | `src/lib/checklistBanding.ts:264-274` | Keyword classifier over text; ordered Review, S&O, Processes, else Approach | Yes |
| 2 | `REF_DIMENSION` map | `src/lib/checklistBanding.ts:291-294` | Precomputed once: every official GD4 point ref maps to `classifyApsrByContent(officialText)` | Yes |
| 3 | `resolveLineDimension(line)` | `src/lib/checklistBanding.ts:306-310` | Official ref via `REF_DIMENSION` first, `classifyApsrByContent(line.text)` fallback | Yes |
| 4 | Stored `apsrDimension` field | type at `src/types/index.ts:508,527` | A saved tag on the line; written by several paths (below) | Mixed |
| 5 | `findingDimension(line)` | `src/lib/checklistBanding.ts:388-401` | Derived from the line's APSR breakdown: first non-passing leg wins | Yes |
| 6 | `holisticBand.rationale` | read at `src/lib/finalReport.ts:391` | Free AI prose; names dimensions in words, bound to no classifier | No (AI text) |
| 7 | Option A APSR writer `optionAApsr` | `src/lib/optionAChecklistWrite.ts:29-45` | Writes Concept-B breakdown: Approach from PPD, Processes from evidence, S&O + Review hardcoded "Not evident" | Yes |
| 8 | Option B APSR writer `buildStagedApsr` | `src/lib/ai/agentRuntime.ts:1890-1933` | Writes Concept-B breakdown: all four legs from the three staged passes | Yes |

Who WRITES the stored `apsrDimension` (site 4):

- AI checklist generation, AI-chosen and validated against the four legal values
  (`src/lib/ai/agentRuntime.ts:527-550`).
- Offline simulate generation, keyword classifier on the line text
  (`src/lib/ai/simulateAI.ts:171,193,208,220`).
- Human manual picker `setLineApsrDimension`
  (`src/store/useChecklistModuleStore.ts:461`); the manual pick is never
  overwritten later (`:469` fills only untagged lines).
- Accept-AI-band auto-tag of still-untagged lines, `classifyUntaggedLinesByContent`
  (`src/lib/checklistBanding.ts:280-286`) applied via `applyLineDimensionTags`
  (`src/store/useChecklistModuleStore.ts:469`).
- NOT written by the Option A audit: `buildOptionALineWrites` creates lines with
  `sourceRef` but no `apsrDimension` (`src/lib/optionAChecklistWrite.ts:132`).
  This is deliberate and is exactly why site 3 exists.

Who READS the stored `apsrDimension` (site 4):

- `findingGrouper.classifyGapType` (`src/lib/findingGrouper.ts:72-82`): stored
  tag first, `findingDimension` (site 5) fallback. Feeds
  `generateFindingsFromChecklist`.
- `BandImprovementPanel` (`src/components/ui/BandImprovementPanel.tsx:70`):
  filters each line into a dimension column by the stored tag.
- Sub-Criterion Checklist display and the manual picker
  (`src/pages/SubCriterionChecklist.tsx:943,1021-1024,1054,1085-1086,1254`).

Who READS the authoritative resolver (site 3):

- The Final Report findings table, and ONLY it (`src/lib/finalReport.ts:197`).

Confidence: high. All sites above were grep-confirmed across the whole `src`
tree, and the write/read split was read in each file.

## 2. The single source of truth, and is it complete

The intended single source of truth is **`resolveLineDimension` (site 3), backed
by `REF_DIMENSION` (site 2)**. It is the only one that keys off the STABLE
official GD4 requirement ref rather than the AI's rephrasing or a human's pick,
and it is what commit `6ddeb7c` deliberately switched the report grouping to.
"The criteria set defined in a module" the objective refers to is the official
requirement text in `src/data/gd4Requirements.ts` (`flatAuditPoints`), turned
into the ref->dimension map at `checklistBanding.ts:291-294`.

Completeness check (ran a `vite-node` probe over all requirements, then deleted
it):

- **348** official `flatAuditPoints` across the 31 requirements.
- **0** classify to nothing. Every point resolves to exactly one dimension
  (`classifyApsrByContent` always returns a value, defaulting to Approach at
  `checklistBanding.ts:273`).
- **348** distinct normalised refs, **0** collisions, so no ref maps to two
  dimensions.
- `resolveLineDimension(byRef)` equals `classifyApsrByContent(officialText)` for
  all 348 points (0 mismatches), confirming the precomputed map is faithful to
  the classifier.

So there are **no gaps and no "unknown" refs**: the authoritative classifier
tags every official point, and by extension every line that carries a matching
ref, plus every ref-less line via the text fallback. Nothing the resolver is
asked about comes back untagged.

One structural fact worth stating plainly (same probe): the official criteria
are lopsided by dimension.

- Dimension spread of the 348 points: Approach 194, Review 90, Processes 39,
  Systems & Outcomes 25.
- Items (of 31) that have at least one official point in a dimension: Approach
  31, Review 31, Processes 21, Systems & Outcomes 15.

That means **10 items have no official Processes point and 16 have no official
S&O point at all**. For those items the Final Report table will correctly and
permanently show "No lines currently tagged to this dimension", because the
official criteria genuinely contain none. That is not a tagging failure. It is
the shape of the GD4 requirements. 6.2.1 (Management Review) is one of these
review-heavy items, which is why its Processes row reads empty while the prose
still uses the word (matches the prior doc's Issue 3 trace).

## 3. Why the justification paragraph is not bound to the source of truth

The band justification paragraph is `entry.holisticBand.rationale`
(`src/lib/finalReport.ts:391`), rendered raw inside the "Full band
justification" fold (`src/pages/FinalReport.tsx:556-565`). It is a single free
AI string composed by joining the four dimension reasons at
`src/lib/ai/agentRuntime.ts` (the holistic band suggestion), never re-parsed or
constrained by any classifier. So it can name "Processes" in prose even when
`resolveLineDimension` puts zero lines under Processes. It is the one place on
the report that speaks about dimensions without obeying site 3.

Options to make the whole report obey one authoritative tag, WITHOUT re-breaking
`resolveLineDimension` (which stays the grouping key in every option):

- **(a) Generate the justification PER DIMENSION.** Store four short reasons
  keyed by dimension instead of one blob, and render each under its dimension
  heading in the same order the table uses. Touches: the holistic-band
  suggestion shape (`agentRuntime.ts`), the `HolisticBandRecord.rationale` type
  (`src/types/index.ts:566`, would become structured), the fold render
  (`FinalReport.tsx:556-565`), and a migration for old single-string records.
  Does NOT touch scoring (rationale is display only). Regression risk: medium,
  because it changes a persisted field shape, so it needs a `version`+`migrate`
  bump on the checklist store and old records must fall back to showing the
  blob. It does not touch site 3, so the table grouping cannot regress.

- **(b) Keep the paragraph, label it as unbound prose.** Leave the text exactly
  as is but add a one-line caption in the fold, e.g. "AI narrative, not the
  authoritative per-dimension grouping above." Touches: `FinalReport.tsx` only,
  no type, no store, no migration, no scoring. Regression risk: negligible.

- **(c) Suppress the mismatch at the table, not the paragraph.** When a
  dimension's group is empty but its matrix score still fed the band, replace
  the bare "No lines currently tagged" with "No individual line traced to
  Processes; see the band justification" (`FinalReport.tsx:491`). Touches
  `FinalReport.tsx` only. Regression risk: negligible. This is the prior doc's
  Issue 3 sketch (a).

None of (a), (b), (c) touch verdict or scoring logic. Confirmed: the rationale
and the group placeholders are read only for display in `finalReport.ts` /
`FinalReport.tsx`; `buildScored`/`computeBand` never read them.

## 4. Is any assessed line actually UNTAGGED or inconsistently tagged

**Untagged: no.** Because `resolveLineDimension` always returns a dimension
(ref map, then text fallback, then Approach default), no line the Final Report
groups can come back untagged. Nothing "hangs in the air" on the report. The
empty-dimension rows are real, correct emptiness (no official point of that
dimension for the item), not lost lines.

**Inconsistent across views: yes, in two specific places, and it is not the
report table.** The report table (site 3) is authoritative and complete. The
inconsistency is that other surfaces classify the SAME line by a different
method:

1. **The justification paragraph** (free AI prose, site 6) can name a dimension
   the table leaves empty. This is the outlier the user actually saw. It is
   cosmetic (display text disagreeing with a grouping), not a scoring or data
   fault.

2. **The findings register / grouper** (site 4 then site 5 fallback) tags a line
   by its stored `apsrDimension`, or, for every Option A line (which has none),
   by `findingDimension` = the first FAILING APSR leg
   (`findingGrouper.ts:72-82`, `checklistBanding.ts:388-401`). That answers a
   different question ("what kind of gap is this") than the table ("which
   requirement dimension is this"). A Review-dimension requirement can have an
   Evidence-type gap, so the two can legitimately show different APSR words for
   one line. This is a genuine cross-view divergence, but it is arguably correct
   by design, not a bug. Flagging it as a tradeoff, not asserting a defect.

So: the authoritative classifier already covers everything with no gaps. On the
Final Report specifically, the ONLY unbound outlier is the free-text
justification paragraph. That narrows any "make the report agree with itself"
fix to just the paragraph (options a/b/c above). Aligning the findings register
to site 3 as well would be a second, larger change and should be a separate
decision, because it changes what the register's dimension label MEANS.

### What this means for you

Nothing you assess ends up untagged. Every checklist line is placed under a
dimension by a deterministic classifier tied to the official GD4 text, and that
classifier has no gaps (all 348 official points resolve, no collisions). When a
dimension row on the Final Report says "No lines currently tagged", that is
usually the truth for that item: 10 of 31 items have no official Processes
requirement and 16 have no official Systems & Outcomes requirement, so those
rows are meant to be empty.

The one thing that genuinely floats free is the "Full band justification"
paragraph. It is raw AI wording that mentions dimensions loosely and is not tied
to the classifier, which is why it can discuss Processes while the table above
it shows none. That is a wording mismatch on one fold, not lost data.

Fix sketch (not implemented, pick one): either caption the fold as unbound AI
narrative (smallest, `FinalReport.tsx` only), or store the band rationale as
four per-dimension reasons and render each under its dimension so its structure
obeys the same classifier the table uses (larger, needs a store
version+migrate, still never touches scoring).

---

# Investigation 2 (Issue 4): what Option A vs B vs Hybrid actually assess

## The key distinction the question hinges on

"Mode" and "Option" are two independent choices, and mixing them up is the whole
confusion here:

- **Mode** (Full auto / Hybrid / Manual) is one cycle-level choice
  (`src/lib/runModes.ts:9-31`). It decides WHEN verdicts commit and whether you
  are prompted to approve them. It explicitly does NOT change which dimensions
  get assessed: "Modes decide WHEN checklist writes are committed and whether
  the human is prompted; the assessment engines are unchanged"
  (`runModes.ts:3-5`).
- **Option A vs Option B** is a per-row engine choice on the Evidence Folder
  page. It decides WHICH engine runs, and THAT determines dimension coverage.
  - Option A = PPD Review + Evidence assessment (`runPPDReview` /
    `runEvidenceAssessment`), APSR written by `optionAApsr`
    (`src/lib/optionAChecklistWrite.ts:29-45`).
  - Option B = the three-pass staged audit, APSR written by `buildStagedApsr`
    (`src/lib/ai/agentRuntime.ts:1890-1933`).

So "add the Systems & Outcomes / Review feature to Option B" is based on a
mix-up: **Option B is already the one that assesses all four.** It is Option A
that assesses only two, by design.

## Per-dimension coverage, with evidence

Option A (`optionAChecklistWrite.ts:29-45`):

- Approach: assessed, from the PPD verdict (`:32-36`).
- Processes: assessed, from the combined evidence verdict (`:37-41`).
- Systems & Outcomes: **not assessed**, hardcoded "Not evident" with the
  OPTION_A_NOT_ASSESSED_NOTE (`:42`), no branch on run data.
- Review: **not assessed**, hardcoded "Not evident" with the same note (`:43`).
- The design comment states this outright (`:24-28`).

Option B (`agentRuntime.ts:1890-1933`, fed by the three staged passes):

- Approach: assessed, from the policy pass (`:1900-1906`).
- Processes: assessed, from the evidence pass (`:1908-1915`).
- Systems & Outcomes: assessed, from `outcomeRow.outcomeEvident` (`:1917-1922`).
- Review: assessed, from `outcomeRow.reviewEvident` (`:1924-1930`).
- The staged third pass is labelled "Pass 3 of 3, Outcomes and Review check"
  (`src/pages/EvidenceFolder.tsx:710`).

Manual mode (any option not run): the human fills the checklist and sets the
band via the four-dimension matrix on the Sub-Criterion Checklist, so all four
CAN be assessed, by human judgement, with AI only suggesting on request
(`runModes.ts:26-30`).

## Coverage matrix

Columns are the AUTOMATED engines. Mode (auto/hybrid/manual) does not change any
cell, so it is not a column; Hybrid runs whichever option you pick per row, so
its coverage is exactly the column of the option chosen.

| APSR dimension | Option A (PPD + Evidence) | Option B (staged audit) | Manual (human) |
|---|---|---|---|
| Approach | Assessed (PPD verdict) | Assessed (policy pass) | Assessed (human) |
| Processes | Assessed (evidence verdict) | Assessed (evidence pass) | Assessed (human) |
| Systems & Outcomes | **Not assessed** (hardcoded) | Assessed (outcome pass) | Assessed (human) |
| Review | **Not assessed** (hardcoded) | Assessed (review pass) | Assessed (human) |

Evidence: Option A column = `optionAChecklistWrite.ts:32-43`; Option B column =
`agentRuntime.ts:1900-1930`; Manual = `runModes.ts:26-30` plus the matrix band
selector on the Sub-Criterion Checklist.

## What you must run to get all four dimensions assessed

To have all four APSR dimensions assessed automatically for an item, you must
run **Option B (the staged audit)** on that row. Option B's third pass is the
only automated path that looks at outcome data and review records.

Running **Option A** (PPD + Evidence) will only ever fill Approach and
Processes; the other two rows will show the honest "Not assessed by Option A"
note, which reads like an instruction because it is one: run the staged audit,
or attach outcome/review evidence and score those two dimensions yourself on the
Sub-Criterion Checklist.

Mapped to your normal workflow: **Hybrid is a mode, not an engine.** In Hybrid
you still choose Option A or Option B per row. If your Hybrid runs have been
using Option A (the PPD + Evidence path), that is precisely why Systems &
Outcomes and Review keep coming back "Not assessed" - not because Hybrid is
limited, but because the option chosen inside it does not cover those two. Switch
that row to Option B (still in Hybrid mode, so you still approve each verdict) to
get all four.

## Is there a genuine gap

No. Full four-dimension automated coverage IS achievable today, via Option B.
There is no dimension that no mode can assess. The situation is a workflow and
naming mismatch: the user has been running the option (A) that only covers two,
and the note that says so reads like an error after a run that otherwise
succeeded.

### What this means for you

The feature you thought was missing from Option B is already in Option B. It is
Option A that only assesses Approach and Processes; Option B (the staged audit)
assesses all four, because it has a dedicated third pass for Outcomes and Review.
Hybrid does not change this either way, because Hybrid is about when you approve
verdicts, not about which dimensions get looked at; inside Hybrid you still pick
Option A or B per row.

To get all four dimensions filled in for an item: run that item through Option B.
If you prefer Option A for the policy and evidence rigour, you can, but you will
then need Option B's third pass (or your own manual scoring of outcome/review
evidence) to cover the remaining two dimensions.

Fix sketch (not implemented, optional and wording-only): change Option A's
"Not assessed ... run the staged audit" note so it reads as a scope statement
rather than an imperative that looks like a failed run, e.g. "This path (PPD +
Evidence) does not assess this dimension by design; use Option B or score it
manually" (`src/lib/optionAChecklistWrite.ts:18-19`). No engine change.

---

## Summary

| Question | Answer | Confidence |
|---|---|---|
| Is anything left untagged? | No. `resolveLineDimension` tags every line; all 348 official points classify, 0 gaps, 0 collisions | High (probe-verified) |
| Single source of truth? | `resolveLineDimension` + `REF_DIMENSION`, keyed off official GD4 refs; already the Final Report table's basis | High |
| Why do table and paragraph disagree? | Table obeys the classifier; the justification paragraph is free AI prose bound to nothing | High |
| Is the empty "Processes" row a bug? | No; 10 of 31 items have no official Processes point, 16 have no S&O point | High (probe-verified) |
| Cross-view inconsistency? | Yes but confined: the justification paragraph (cosmetic) and the findings register's gap-type (arguably a different question by design) | High on mechanism |
| Which engine assesses all four dimensions? | Option B (staged audit); Option A hardcodes S&O + Review as not assessed | Certain |
| Does Option B already have the S&O/Review feature? | Yes, its third pass; the request to "add it to B" is a mix-up of A and B | Certain |
| Does Hybrid limit coverage? | No; Hybrid is a mode (when you approve), not an engine; coverage follows the option picked per row | High |
