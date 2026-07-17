# A dimension band with no requirement lines: ladder, phantom band, or honest?

Investigation only. No application logic, data or config was changed. Every
claim cites file:line evidence with a stated confidence. No fixes are proposed
or made this round beyond naming where a wording change could live. UK
spelling, no em dashes.

**Commit analysed:** `35fdba571fa8390ea0adc1323d88553ce308a2eb` (local HEAD
confirmed equal to origin/main before analysis, clean tree).

**The case:** on item 6.1.1 (Internal Assessment) the Final Report shows the
Systems & Outcomes dimension with a band pill (e.g. "B2 · 10%") while the
per-line table under it says "No lines currently tagged to this dimension."
The user objects: bands are a ladder, so how can a dimension hold a band with
no requirement lines under it? Is this the INV-01/R1 phantom-band problem
again?

**Verdict in one line:** the ladder objection does not match how the confirmed
APSR formula works; the Systems & Outcomes band on 6.1.1 is not a phantom band
in the INV-01 sense, because 6.1.1's official rubric genuinely defines no
Systems & Outcomes requirement line and the band comes from the human-gated
holistic matrix, not from lines; but the display IS confusing, and the user's
Outcomes & Review pass, while it did produce a real S&O judgement, does NOT
move that band pill by itself.

---

## Question 1: is the APSR model a ladder or independent per-dimension scoring?

**Independent per-dimension scoring, summed. Not a ladder. Confidence: certain
(this is the arithmetic).**

The scoring pipeline, in full:

- Each of the four dimensions carries its own score, a band 1 to 5 or a
  genuine 0 (`ApsrDimensionScore`, stored in `holisticBand.matrixScores`).
- A dimension's percentage is a DIRECT multiplication of that score:
  `pctForScore` is `(s * scale.maxPctPerDimension) / 5`, i.e. Band N is worth
  N x 5% under the default 25%-per-dimension scale
  (`src/lib/checklistBanding.ts:86-88`). There is no conditional logic, no
  check of any other band, no "clearing" requirement.
- The four percentages are summed to a 0 to 100% total
  (`apsrMatrixResult`, `checklistBanding.ts:114-123`).
- The ITEM's final band is read off that total through four threshold bounds
  (`finalBandFromPct`, `checklistBanding.ts:93-97`, default 20/40/60/80).

This is the SSG auditor's confirmed model, reconstructed from their worked
example "A=20%, P=20%, S=10%, R=0% = 50% which is Band 3"
(`checklistBanding.ts:62-72` and `docs/edutrust-band-scoring.md`). In that very
example one dimension scores 0% while others score 20% — the dimensions move
independently, and the official answer was reached by summing, not by rung
clearing.

So, plainly: within a single dimension, a band is a judgement of WHICH official
§23 descriptor best fits the evidence, selected by the human (or AI-suggested,
human-accepted) on the Sub-Criterion Checklist. Reaching Band 4 on a dimension
is not conditional in code on Band 3 having been "cleared". The ladder
intuition is fair as a reading of the descriptors themselves (each higher
descriptor describes a more mature state that in practice subsumes the lower
ones), but the certification arithmetic this tool implements, per the auditor,
is independent scores summed to a threshold total.

**What this means for you:** your ladder picture applies to how you should
JUDGE a dimension (pick the descriptor whose whole story fits, do not skip
rungs in your own judgement), but the formula the auditor confirmed does not
enforce rungs, and the overall item band is a sum of four independent
percentages. A dimension can legitimately sit at Band 2 while another sits at
Band 5.

---

## Question 2: can a dimension carry a band with zero requirement lines, and is that a phantom band?

**It can, it is legitimate by design here, and it is NOT the INV-01/R1 class.
Confidence: high, with one honest caveat below.**

### Where the Systems & Outcomes band on 6.1.1 comes from

The band pill is the holistic matrix, not the lines. `buildFindingsGroups`
reads `const score = hb.matrixScores[key]` per dimension
(`src/lib/finalReport.ts:234`) and pushes it as the group's band
(`finalReport.ts:277`); the UI renders it as "B{band} · {pct}%"
(`src/pages/FinalReport.tsx:568`). `matrixScores` is written ONLY by
`setHolisticBand` (`src/store/useChecklistModuleStore.ts:197`), which requires
a complete four-dimension matrix and a written justification and logs a human
decision — a human always commits it (source "human" or "ai-accepted").

The rows under the pill come from a different mechanism entirely: lines are
grouped by which OFFICIAL requirement dimension they belong to
(`resolveLineDimension`, applied at `finalReport.ts:242`). For 6.1.1 that
grouping is genuinely empty for Systems & Outcomes, because the official GD4
text for 6.1.1 defines no outcome-flavoured audit point at all. Probe of the
official `flatAuditPoints` (run read-only, then deleted): 6.1.1 has 12 points —
4 classify Approach, 4 Processes, 4 Review, **0 Systems & Outcomes**. "No lines
currently tagged" is the truth of the official criteria, not missing data.

### Why this is not INV-01/R1

R1 is precise: it fires when an item has `holisticBand.matrixScores` while the
item's ENTIRE line list is empty — `(entry.specific?.length ?? 0) === 0`
(`src/lib/consistencyChecker.ts:98-103`). That is a band resting on nothing:
the evidence base was deleted out from under a saved band. 6.1.1 is not that
case: the item has its full set of requirement lines; it is one DIMENSION whose
official rubric happens to define no line.

These are different problems:

- INV-01/R1: evidence existed, was removed, band survived. Unsound.
- 6.1.1 Systems & Outcomes: the official rubric never demanded an
  outcome-specific line for this item, yet the §23 banding model still requires
  every item to be judged on all four dimensions — the four-dimension matrix is
  universal (the save gate at `useChecklistModuleStore.ts:197` onward REQUIRES
  all four scored before any band can be saved). A dimension score without a
  same-dimension requirement line is exactly what the model demands here.

### The honest caveat

"Legitimate by design" does not mean "automatically grounded". The dimension
grouping (what a line is ABOUT) and the per-line APSR legs (every assessed
line carries a judgement on ALL FOUR dimensions, `ApsrBreakdown`) are different
axes. Real Systems & Outcomes evidence for 6.1.1, where it exists, lives on the
lines' `apsr.systemsOutcomes` legs — which is exactly what the AI band
suggestion reads when proposing matrix scores (`buildBandEvidenceDigest`
includes every line's four APSR statuses, `src/lib/ai/agentRuntime.ts:298-320`)
— and in the saved band's own written rationale. So the score is meant to rest
on evidence that this table simply cannot show, because the table's rows are
organised by requirement wording, not by assessment legs. Whether the CURRENT
saved score for 6.1.1 actually reflects assessed outcome evidence or an early
guess is a runtime fact in your workspace (see the pass confirmation below),
not decidable from the repository.

**What this means for you:** the band is not resting on nothing by design. The
official rubric simply has no outcome-worded requirement line for 6.1.1, while
the banding model still requires an outcomes judgement for every item — that
judgement is the matrix score you (or the AI suggestion you accepted) set, with
a written justification. It is not the deleted-lines phantom band from before.

---

## Question 3: is the display honest?

**The data shown is true, but the juxtaposition is genuinely confusing, and
your reading of it is reasonable. Confidence: high.**

The pill ("B2 · 10%") states the saved matrix judgement. The placeholder ("No
lines currently tagged to this dimension.", `FinalReport.tsx:575`) states the
line grouping. Both are individually accurate. Side by side, they read as "a
confident score for a category with nothing in it", because the table gives the
reader no way to see what the score IS grounded on: the outcome evidence, when
it exists, is on other lines' Systems & Outcomes assessment legs (visible on
the Sub-Criterion Checklist card's expanded APSR view) and in the band's
written rationale (the "Full band justification" fold), not in this grouping.

So: the display does not fabricate anything, but it under-explains, and for an
item like 6.1.1 it will read as self-contradictory every time. A wording-only
change to the empty-group placeholder (for example, distinguishing "the
official rubric defines no requirement line of this type for this item; the
band is the holistic matrix judgement, see the justification below" from a
bare "no lines") would resolve the confusion without touching any score. Per
this round's constraints, that is NOT implemented — flagged only.

**What this means for you:** you are not misreading a bug; the page really does
show a score above an empty list without explaining the link. The score's
grounding lives on the checklist card and in the justification fold, not in
this table. The fix, when you want it, is wording, not scoring.

---

## Confirmation: what your Outcomes & Review pass actually did on 6.1.1

**The pass DID produce a real Systems & Outcomes judgement, but that judgement
does NOT drive the band pill. Confidence: high on the mechanism; the state of
your specific workspace is runtime data, checkable at the surfaces named
below.**

Mechanism, as built and verified:

- The pass judges every one of 6.1.1's official points for outcome data and
  review records, and stores the result in
  `outcomeReviewResults["6.1"]` (`runOutcomeReviewPass`,
  `src/store/useWorkspaceStore.ts` — the panel on the Evidence tab renders it).
- Clicking "Apply to checklist" writes ONLY the per-line
  `apsr.systemsOutcomes` and `apsr.review` legs onto the matched checklist
  lines (`applyOutcomeReviewLegs`,
  `src/store/useChecklistModuleStore.ts:543`), replacing the "not assessed by
  Option A" placeholders with the pass's judgement.
- It deliberately NEVER touches `holisticBand.matrixScores` — the
  no-band-movement guarantee, proven byte-identical by test
  (`src/store/__tests__/outcomeReviewApply.test.ts`).

Therefore the "B2 · 10%" pill you see is whatever matrix score was last SAVED
for 6.1.1 via `setHolisticBand` — it predates or is independent of the pass.
The pass's Systems & Outcomes judgement reaches the band only through you: the
applied legs feed the NEXT AI band suggestion (`agentRuntime.ts:298-320` reads
them), and the matrix moves when you accept that suggestion or re-save the
band yourself, justification and all.

To confirm your own workspace state (runtime facts, not verifiable from the
repository):

1. Evidence Folder → 6.1's review → Evidence tab → the "Systems & Outcomes /
   Review — optional extra pass" panel: an "Applied to N lines" pill means the
   legs were written; no pill means the result was generated but never applied.
2. Sub-Criterion Checklist → 6.1.1 → expand a line's APSR view: the Systems &
   Outcomes leg should show the pass's judgement instead of "Not assessed by
   Option A" if the apply happened.
3. Human Decision Log: a "Line Status" entry naming the OR- run id records the
   apply; "Holistic Band" entries show when the matrix was last saved, and by
   what source — if the last band save predates the apply, the pill does not
   yet reflect the pass.

**What this means for you:** your run genuinely assessed outcomes for 6.1.1 —
the judgement exists and is stored. But the band pill will not move on its own,
by design: nothing in this tool changes a band without you confirming it. To
fold the pass's findings into the band, open the Sub-Criterion Checklist for
6.1.1, re-run the AI band suggestion (it now sees the real outcome legs), and
save the matrix if you agree with it.

---

## Final verdict

| Question | Answer | Confidence |
|---|---|---|
| Is the ladder objection valid? | No, not against this formula: each dimension is an independent best-fit score (band x 5%), summed to a total that maps to the item band — the SSG auditor's own worked example has one dimension at 0% alongside others at 20% | Certain (arithmetic cited) |
| Is the S&O band on 6.1.1 a phantom band? | No. INV-01/R1 is a band surviving DELETED lines (`consistencyChecker.ts:98-103`); here the item has all its lines, and 6.1.1's official rubric defines zero outcome-worded lines (probe: 12 points = 4 Approach, 4 Processes, 4 Review, 0 S&O) while the §23 model still requires a four-dimension judgement — which the human-gated matrix provides | High |
| Is the display honest? | True but under-explained: score and empty list are both accurate, yet the table cannot show what grounds the score (the legs and rationale live elsewhere), so it reads as contradictory. A wording-only placeholder change would fix it; not made this round | High |
| Did the O/R pass assess S&O on 6.1.1, and does it drive the pill? | It produced and stored a real judgement (and, if applied, wrote it onto the lines' legs), but the pill is the last SAVED matrix score — the pass never moves a band by design; re-run and accept the band suggestion to fold it in | High on mechanism; workspace state checkable at the three surfaces listed |
