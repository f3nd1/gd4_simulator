# Investigation: the per-dimension matrix shows dashes for an auto-scored band

Date: 2026-07-18. Investigation only, no code or data changed. Checkout at
`0147efc` (HEAD == origin/main).

## Symptom

Item 6.2.1 was auto-scored by a real Full Auto run with the auto-score
setting on: the saved band is Band 2, APSR total 35%, source "ai-auto", with a
full written justification. It shows correctly on the Final Report, marked
"AI-scored - not yet reviewed".

On the Sub-Criterion Checklist page for 6.2.1, the "APSR band - per-dimension
percentage matrix" grid shows every dimension as a dash ("-"), as if nothing
were scored, and the "AI first pass (suggest scores)" button behaves as if no
band exists - clicking it produces a fresh, different suggestion (Band 3, 45%)
that does not match the saved Band 2 / 35%.

## Root cause: the page keeps TWO separate matrices, and the auto path only
fills one

There are two distinct per-dimension stores on a checklist entry:

1. `entry.holisticBand.matrixScores` - the **saved band record**. This is the
   load-bearing one: it drives the certification score
   (`computeChecklistOverrides`), the Final Report, the Scorecard and exports.
2. `entry.apsrMatrix` - a separate **live working copy**, the editable grid you
   click on to score each dimension.

The Sub-Criterion Checklist page reads them from different places:

- The **saved-band panel** (the "Band 2 - ... APSR total 35% - AI-scored, not
  yet reviewed" line with its justification) reads the saved record:
  `src/pages/SubCriterionChecklist.tsx:354` derives `savedBand` from
  `holisticBand.matrixScores`, rendered at `:711`-`:728`. This panel shows the
  correct saved values.
- The **editable grid below it** reads the working copy:
  `src/pages/SubCriterionChecklist.tsx:832` - `<ApsrMatrixSelector
  scores={entry?.apsrMatrix} .../>`. The grid renders a dash for any dimension
  whose working-copy value is `undefined`
  (`src/components/ui/ApsrMatrixSelector.tsx:74` - `val === undefined ? "-"`).

In the **human** scoring flow the two are always co-written, so they agree:
`runBandSuggestion` seeds the working copy dimension-by-dimension via
`setApsrMatrix` (`SubCriterionChecklist.tsx:458`), then `saveBand` reads that
same working copy and writes the saved record
(`SubCriterionChecklist.tsx:477`, `:487`). The working copy is part of the
persisted entry, so it survives reload and the grid stays populated.

The **automatic** (Full Auto / ai-auto) flow does not touch the working copy.
`autoScoreAssessedItems` (in `src/store/useWorkspaceStore.ts`) calls
`setHolisticBand({ ..., source: "ai-auto" })` directly, and the store's
`setHolisticBand` writes **only** the `holisticBand` record
(`src/store/useChecklistModuleStore.ts:220`-`229`) - it never seeds
`apsrMatrix`. So after an auto-score, `holisticBand.matrixScores` holds Band 2
/ 35% but `apsrMatrix` is still empty, and the grid therefore shows dashes.

This is not specific to any one dimension or to 6.2.1 - it is every item
scored only by the automatic path.

## Answers to the four questions

1. **Where does the grid read from?** The editable grid reads
   `entry.apsrMatrix` (the working copy), NOT `holisticBand.matrixScores` (the
   saved record). The saved-band panel above it reads the saved record.
   (`SubCriterionChecklist.tsx:832` vs `:354`/`:711`.)

2. **Why dashes when a real saved band exists?** Because the auto path filled
   only the saved record, leaving the working copy `apsrMatrix` empty, and the
   grid is bound to the empty working copy. This is a **display / state-seeding
   bug**: correct data exists, but in a field the grid does not read. It is not
   a rendering-logic error in the grid itself (the dash is correct for an
   empty working copy) and not a hydration timing issue.

3. **What does "AI first pass (suggest scores)" do when a band already
   exists?** It regenerates unconditionally. The button calls
   `runBandSuggestion` (`:763`), which runs a fresh AI call (`suggestBand`) and
   writes the new suggestion into the working copy. It does not read, show, or
   pre-fill from the saved band. The "already suggested" state it checks
   (`bandSuggestion`) is component-local React state that is `null` on every
   page load, so on a fresh visit the button always reads "AI first pass
   (suggest scores)" and always makes a new call. Because the AI call is
   non-deterministic, that new suggestion (Band 3 / 45%) differs from the saved
   Band 2 / 35%. There is no "band already set - showing saved values" mode for
   the grid.

4. **Is the saved data intact? (most important)** **Yes - high confidence.**
   The saved ai-auto band (Band 2, 35%, with justification) is stored intact in
   `holisticBand.matrixScores` and is what the saved-band panel, the Final
   Report, the Scorecard, exports and the certification score all read. The
   empty grid reads a different field (`apsrMatrix`) that the automatic path
   simply never populated. Nothing overwrote or corrupted the saved band; the
   page does not silently overwrite it on load. This is a display bug, not data
   loss.

## What this means for you

Your saved band is safe. The Band 2 / 35% auto-score genuinely exists and is
the value that counts everywhere it matters - the report, the scorecard, the
exports and the final score all use it. The dashes in the editable grid are
cosmetic: that grid is a blank scratchpad, not the saved band, and it was left
blank because the automatic scorer wrote the band record without also filling
the scratchpad.

One thing to be careful of until this is fixed: on that page, if you click "AI
first pass (suggest scores)" and then "Accept AI scores & save", you would
replace the saved Band 2 / 35% with a fresh, different suggestion. Nothing does
that on its own - it only happens if you click Save - but the blank grid makes
it look like there is nothing to lose, when there is. If you just want to keep
the auto-score, leave the page alone; the saved band stands.

## Fix sketch (not implemented)

Root-cause option (recommended): seed the working copy from the saved record at
the single writer. In `setHolisticBand`
(`src/store/useChecklistModuleStore.ts:220`), when saving, also set
`apsrMatrix` to a copy of `input.matrixScores`. This fixes every caller at once
(auto and any future path), keeps the grid identical to the saved band, and is
a small change. On the human flow it is a harmless no-op because `apsrMatrix`
already equals those values at save time.

Pure-display alternative (lowest risk, no persistence change): make the grid
fall back to the saved record when the working copy is absent -
`scores={entry?.apsrMatrix ?? holisticBand?.matrixScores}` at
`SubCriterionChecklist.tsx:832`. This shows the saved values immediately;
editing any dimension then writes `apsrMatrix` as usual.

Related follow-up (separate, UX not data): when a band already exists, the "AI
first pass" button and its "Accept & save" path could warn that saving will
replace the current (including ai-auto) band, to prevent an accidental
overwrite driven by the misleading blank grid.

Either fix keeps verdict and scoring logic untouched - the certification band
already flows solely from `holisticBand.matrixScores`; this only concerns what
the editable grid displays and what the working copy is seeded with.
