# Option A plus a background Outcome/Review pass: feasibility and design

Investigation only. No application logic, data or config was changed. Every
claim cites file:line evidence with a stated confidence. This touches
scoring-adjacent code, so each proposed change is treated with stop-and-ask
caution and anything that could move a score is flagged explicitly. UK spelling,
no em dashes.

**Commit analysed:** `d2355a6fa370cf71773573662f99ebe365bfc705` (local HEAD
confirmed equal to origin/main before analysis, working tree clean; checked with
git fetch + rev-parse because a prior investigation had run against stale code).

**The proposal:** when running Option A (PPD + Evidence) on a row, also run
Option B's outcome/review third pass to fill in Systems & Outcomes and Review,
so the user gets all four dimensions without switching the row to Option B. The
user accepts the extra AI cost.

**Headline result:** it is cleanly feasible, and the critical scoring-safety
question comes back reassuring: the per-line APSR the third pass would write does
NOT feed the certification band directly. The band is set only by a separate,
human-gated holistic matrix. So this change moves what is displayed and what the
AI band suggestion sees, never a committed score by itself. Recommended design
is the on-demand button (option b), not the silent auto pass.

---

## Q1. Feasibility: can Option A call ONLY the third pass, in isolation?

Yes, cleanly. `runStagedOutcomeReviewAudit`
(`src/lib/ai/agentRuntime.ts:1824-1873`) is self-contained. Its inputs are:

- `auditPoints: FlatAuditPoint[]` — the requirement's official points, already
  available from `GD4_REQUIREMENTS` in every path.
- `allDocText: string` — the combined policy + evidence document text.
- `settings: AISettings`, `opts: StagedAuditOpts`.

It does NOT take, read, or depend on the policy pass or evidence pass outputs. It
runs through the same generic `runWindowedStagedAudit` engine
(`agentRuntime.ts:1553-1695`) the other two staged passes use, and returns
`OutcomeReviewRow[]` carrying `outcomeEvident` / `reviewEvident` booleans per
point (`:1848-1871`). Confidence: high, the function signature and body show no
cross-pass coupling.

`buildStagedApsr` (`agentRuntime.ts:1890-1933`) is a separate deterministic
merge that maps the three coverage matrices onto the four APSR legs. It is NOT
needed in isolation: for this proposal you would take only the outcome/review
row and map its two booleans onto the Systems & Outcomes and Review legs exactly
as `buildStagedApsr:1917-1930` already does, leaving Option A's Approach and
Processes legs untouched. Confidence: high.

There is no conflict with the Approach/Processes verdicts Option A already
produces, because the third pass writes ONLY the other two legs. Today Option A
hardcodes those two to "Not evident" (`src/lib/optionAChecklistWrite.ts:42-43`);
the change would replace those two hardcoded values with the pass result and
change nothing else on the line. Confidence: high.

One integration point to confirm at build time (not a blocker): the third pass
wants "all documents (policy and evidence combined)"
(`agentRuntime.ts:1837,1858-1860`). Option A reads policy in `runPPDReview` and
evidence in `runEvidenceAssessment` as two separate read loops
(`src/store/useWorkspaceStore.ts:1150,1552`, both via `readDriveFileWithVision`).
The document text is therefore already fetched during an Option A run, but
whether both buckets are retained in memory at the same moment to hand to the
pass is an implementation detail to wire up. The Drive download itself need not
be repeated. Confidence: medium on the exact in-memory availability (would be
resolved by reading the two read-loop bodies in full); high that the text is
fetched somewhere in the Option A flow.

## Q2. Evidence dependency: what does the pass read, and what if evidence is absent?

The pass reads the combined document text and, per audit point, judges two
things from the prompt (`agentRuntime.ts:1839-1841`):

- `outcomeEvident`: true only for actual outcome data, KPIs, results, trends,
  survey data or performance measurements covering the review period, with real
  numbers or trends. A statement that outcomes "will be tracked" does not count.
- `reviewEvident`: true only for records of a formal effectiveness review
  (management review minutes, evaluation reports, improvement actions triggered
  by data). A policy that says "we will review annually" does not count.

If no outcome/review evidence exists, the pass returns "not evident" honestly, by
two independent mechanisms:

- Empty or missing document text short-circuits to the empty verdict
  (`outcomeEvident: false, reviewEvident: false`) with a "No documents provided"
  note, before any AI call (`runWindowedStagedAudit:1574-1576`,
  `runStagedOutcomeReviewAudit:1851-1852`).
- With documents present but nothing relevant in them, the AI returns false for
  both and the row gets the fallback note "No relevant evidence chunk found for
  this dimension" (`:1866`).

So your understanding is correct: **this only fills real gaps where the evidence
actually exists.** Where there is no outcome or review evidence, the result is
the same "Not evident" you get today, just reached by assessing the documents
rather than by a hardcode. Confidence: high.

One honest nuance worth stating: there is a real difference between "we looked at
the documents and found no outcome/review evidence" (what the pass gives you) and
today's "Option A does not assess this dimension" (a hardcoded non-assessment).
Both render as "Not evident", but the first is a genuine judgement and the second
is an abstention. The proposal turns abstentions into judgements, which is the
point, but it means a dimension that currently reads "not assessed by Option A"
would start reading as an assessed gap. That is more informative, but it is a
change in meaning the user should expect. Confidence: high.

## Q3. Scoring safety (the critical question)

**The per-line APSR breakdown does NOT feed the certification band directly.**
This is the decisive finding, traced end to end:

- The item band in scoring comes from `checklistBandOverrides` when present,
  else the old evidence matrix (`src/lib/scoring.ts:106-107,129`).
- `checklistBandOverrides` is built ONLY from `entry.holisticBand.matrixScores`
  (`src/lib/checklistBanding.ts:211-228`, specifically `:218,223,225`). It reads
  the human's four-dimension percentage matrix and nothing else. It does NOT
  read the per-line APSR breakdown (`lineApsr`) at all.
- `holisticBand.matrixScores` is written ONLY by `setHolisticBand`
  (`src/store/useChecklistModuleStore.ts:188-226`), which is gated: the matrix
  must be complete (`:196`), a written justification is required (`:201`), and
  every call is logged as a human decision (`:214-224`) with source "human" or
  "ai-accepted". A human always commits it.

Therefore the per-line APSR that Option A and Option B write feeds only three
things, none of which is the committed band:

1. Display: the Final Report table and the checklist PPD/Evidence tabs.
2. Findings text: `lineDimensionDiagnosis` / `findingDimension`
   (`checklistBanding.ts:245-247,388-401`), which shape a raised finding but
   compile only on the human's explicit action.
3. The AI band SUGGESTION: `runHolisticBandSuggestion` reads `lineApsr(l)` for
   every line and puts all four dimension statuses, including Systems & Outcomes
   and Review, into its prompt (`agentRuntime.ts:302-316`). Its output is a
   suggestion the human must accept via `setHolisticBand`.

So filling Systems & Outcomes and Review via the background pass would:

- change what those two rows display (real judgement instead of a hardcoded
  abstention),
- give the AI band suggestion real S&O/Review inputs instead of "Not evident"
  (today an Option A item makes the AI suggest low bands on those two purely
  because Option A abstained),
- and NOT move any score or band on its own. A score changes only when the human
  opens the Sub-Criterion Checklist and accepts or sets the holistic band.

**Is the mix (Option A Approach/Processes + third-pass S&O/Review) less
trustworthy or differently scaled than a pure run?** No, on both counts:

- Same scale and shape. Both engines emit the identical `ApsrBreakdown` unions:
  Systems & Outcomes is "Evident" | "Limited" | "Not evident", Review is
  "Evident" | "Not evident" (`buildStagedApsr:1918-1930`; Option A already writes
  those same unions at `optionAChecklistWrite.ts:42-43`). Mapping the pass result
  onto those two legs uses the very same code path `buildStagedApsr` uses.
- Same trust level as a pure Option B run on those two dimensions, because a pure
  Option B run ALSO does not auto-commit a band; it too writes per-line APSR and
  leaves the holistic band for the human. The proposal reproduces Option B's
  S&O/Review data by the same function, so it is neither more nor less
  trustworthy than running Option B for those two legs.

The one genuine asymmetry to keep honest: Option A's Approach/Processes come from
its two-pass verified pipeline (deterministic quote verification, citation-gap
downgrades, per `src/lib/runModes.ts:76-81`), whereas the third pass is a
windowed staged pass without that verification layer, which is exactly why
Option B keeps a human approval gate that Option A does not
(`runModes.ts:45-51,76-81`). Mixing them means one item's four legs would come
from two different rigour levels. That is not a scale mismatch and does not
corrupt a score, but it is a reason the S&O/Review legs should carry the same
human review the rest of Option B's staged output carries (see Q5). Confidence:
high on the scoring path, high on the scale equivalence, high on the asymmetry.

**Flag:** no automatic score change is introduced by this proposal as long as
the band continues to come solely from the human holistic matrix. If any future
change were to make the per-line APSR feed `computeChecklistOverrides` or the
band directly, this safety argument would no longer hold and it would need
re-checking. Nothing in this proposal requires that, and it should not be added.

## Q4. Auto vs button vs Hybrid stage

- **(a) Fully automatic** (fires silently after every Option A run). Cost: an
  extra outcome/review pass on every row whether or not outcome/review evidence
  is likely to exist, so the most calls and the least targeted. Fit with "check
  before trusting": poor, it hides a whole assessment step, which is exactly the
  philosophy the user applies against silent automation. Complexity: low to
  wire, but it changes the meaning of every existing Option A run without asking.
  Review risk: highest, it produces S&O/Review verdicts the user never chose to
  run and might not notice before they flow into the AI band suggestion.

- **(b) On-demand button** ("Also assess Outcomes & Review" appears after an
  Option A run; the user clicks it when they want it). Cost: paid only when the
  user asks, on the rows they choose, so the user directly controls spend. Fit
  with "check before trusting": strong, the step is visible, deliberate and
  human-triggered, and the user sees the two new rows appear as a distinct
  action they initiated. Complexity: low to moderate, one control plus the
  isolated pass call and the two-leg merge. Review risk: low, nothing runs
  unrequested, and the result can be surfaced for approval like any other verdict
  (Q5).

- **(c) Hybrid-stage** (the third pass becomes an approvable stage inside the
  Hybrid flow). Cost: same as the button when run. Fit with "check before
  trusting": strongest in principle, it slots into the existing per-verdict gate.
  Complexity: highest, it means threading a new stage through the Hybrid gate
  machinery (`HybridGatePanel`, the staged queue in `partitionWritesByMode`,
  `src/lib/runModes.ts:52-64`), and Option A deliberately does NOT use that
  per-line gate today (`runModes.ts:66-87`), so this reintroduces gate wiring on
  the very path that had it removed for being unfinished. Review risk: low, but
  the build cost and the risk of re-breaking the Option A gate removal are real.

**Recommendation: (b), the on-demand button.** It matches the user's own "see
each step, check before trusting" philosophy, it spends money only when the user
asks and only on rows they pick, it is far simpler than the Hybrid-stage, and it
avoids silently changing the meaning of existing Option A runs the way the
automatic option would. Confidence: high on the tradeoffs; the recommendation is
a judgement call, so it is offered as a recommendation, not a fact.

## Q5. Human gate

Wherever the two new legs are produced, they should reach the committed band only
through the SAME human gate everything else already goes through: the holistic
band matrix on the Sub-Criterion Checklist (`setHolisticBand`,
`useChecklistModuleStore.ts:188-226`), which requires a complete matrix and a
written justification and logs a human decision. Because the per-line APSR never
feeds the band directly (Q3), the pass result cannot commit a score on its own;
it only becomes score-bearing when the human accepts or sets the holistic band.

So the proposal as described does NOT auto-commit a verdict into the band, and
there is no conflict with the "AI recommends, human decides" principle at the
scoring layer. The one place to be deliberate is display and the AI suggestion:
the two new legs would immediately show on the checklist and immediately feed the
next `runHolisticBandSuggestion`. That is advisory, not committing, but to stay
fully consistent with Option B's staged rigour the button result should be
presented as a reviewable AI output (the existing ThumbsButtons + FeedbackModal
pattern on AI outputs), so the user can see and, if wrong, correct the S&O/Review
statuses before leaning on them for the band. Confidence: high that no auto-commit
occurs; medium on the exact best surface for the review affordance (a UI choice
to confirm when building).

## Q6. Cost and latency

The third pass makes `windows x ceil(points / 8)` AI calls
(`STAGED_BATCH_SIZE = 8` at `agentRuntime.ts:1392`; window size 55,000 chars with
5,000 overlap at `:1410-1411`; one `chatComplete` per batch per window at
`runWindowedStagedAudit:1604-1620`).

Concretely, per sub-criterion:

- A sub-criterion has roughly 10 to 30 official points (about 11 on average
  across the 31 requirements), so 2 to 4 batches.
- Windows scale with evidence size: evidence under about 55k characters is 1
  window; the "large volumes" the user typically extracts could be several. Say
  150k to 250k characters is 3 to 5 windows.
- So a typical run is on the order of 2 to 4 calls (small evidence) up to roughly
  10 to 20 calls (large evidence) for that sub-criterion. Each call is a single
  analysis-tier completion over one 55k window.

This is the same order of magnitude the staged third pass costs inside a full
Option B run, because it is literally the same pass. In other words the proposal
adds, per row the user opts into, roughly one Option-B-third-pass worth of calls
and latency, no more. Given the user has said the extra cost is acceptable and
option (b) only spends it on demand, this is a controlled, per-row cost the user
triggers deliberately. Confidence: high on the call-count formula; the dollar and
wall-clock figures depend on the model and evidence size, which are runtime facts
not visible from the repo.

---

## Recommended design

Add an on-demand control after an Option A run, "Also assess Outcomes & Review",
that calls `runStagedOutcomeReviewAudit` in isolation for that sub-criterion's
points over the already-fetched combined document text, maps its two booleans
onto the Systems & Outcomes and Review legs using the same logic as
`buildStagedApsr:1917-1930`, and writes them onto the existing Option A lines in
place of the hardcoded "Not evident" (`optionAChecklistWrite.ts:42-43`). Surface
the result as a reviewable AI output, and let it reach the band only through the
existing human holistic-matrix gate, exactly as every other verdict does. Do not
make it automatic, and do not wire the per-line APSR into the band directly.

## What this means for you

Your idea works and it is safe. The outcome/review pass can be run on its own for
an Option A row, and because it reads the actual documents, it only reports
Systems & Outcomes and Review where the evidence genuinely exists, and honestly
says "Not evident" where it does not, the same as today, just judged rather than
assumed.

The important safety point: filling in those two dimensions does not by itself
change any score or band. In this tool the certification band is only ever set
when you open the Sub-Criterion Checklist and confirm the four-dimension band
yourself, with a written reason. The audit passes, Option A or Option B or this
new one, only feed the display and the AI's suggestion; you always remain the one
who commits the band. So mixing Option A's policy and evidence result with a
background outcome/review result is no riskier than running Option B, and it
never sneaks a number past you.

The recommendation is to make it a button you click after an Option A run, not
something that fires automatically. That keeps it in line with how you like to
work, see the step, check it, then trust it, and it means you only pay for the
extra AI calls on the rows where you actually want the two extra dimensions.
