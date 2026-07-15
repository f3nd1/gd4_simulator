# R1 and R2 live-workspace findings: investigation

Investigation only. No application logic, data or scoring was changed. This
document explains the R1 and R2 issues the Consistency Checker flagged against
the real workspace, with file:line evidence, so a fix can be decided
separately.

One access caveat stated up front, because it shapes what can and cannot be
answered: I can read the repository code, but I cannot read the live workspace
data at apps.unitedceres.edu.sg. So I can trace exactly HOW these states arise
and what they mean, but I cannot enumerate the live values (which ten finding
ids, each item's other-item state, the stored holisticBand.source for 1.1.1).
Where the answer needs a live value, I say what to look at and why, rather than
guessing.

## Issue Set 1 (R1): item 1.1.1 has a band with zero lines behind it

### How a band can exist with no lines: every write path

There are exactly three places that write `holisticBand`:

1. `setHolisticBand` (src/store/useChecklistModuleStore.ts:186-211) - the save path. It has two gates and only two: the four APSR dimensions must all be scored (:194) and a written rationale must be present (:199). It does NOT read `entry.specific.length`. So a band can be saved whether or not any checklist lines exist.
2. `clearHolisticBand` (src/store/useChecklistModuleStore.ts:226) - sets it to undefined.
3. `clearSpecificLines` (src/store/useChecklistModuleStore.ts:426) - the "Remove all" button. It clears the lines AND the band AND the working matrix together. This is the commit 7da9b1e fix.

And there are exactly two places that remove lines:

- `clearSpecificLines` (:426) - clears the band too (as above).
- `removeSpecificLine` (:415) - removes ONE line by id and does NOT touch `holisticBand` or `apsrMatrix`.

The APSR matrix that a band is calculated from is filled in by `setApsrMatrix`
(:228-231, one dimension at a time) or by accepting the AI first-pass. Neither
of those requires lines to exist either.

### The two possible root causes for 1.1.1, and which is more likely

Because the save gate never checks line count, item 1.1.1 could have reached
"band, no lines" by either of two distinct routes. These are genuinely
different causes and would need different handling, so they are kept separate.

Cause A - lines existed, band was saved, then lines were deleted one at a
time. `removeSpecificLine` (:415) removes a single line and leaves the band
untouched. Deleting the last line this way (rather than via "Remove all")
leaves exactly the observed state: a saved band with `specific.length === 0`.
This is INV-01 in docs/consistency-invariants.md, and it is the most likely
route if the item was ever scored through the normal checklist flow (which
needs lines to run the AI first-pass).

Cause B - a band was saved with the matrix selector while the item never had
lines. Since `setHolisticBand` (:186) gates only on the matrix and the
rationale, a person could set all four dimensions by hand, type a rationale,
and Save, with zero lines ever present. The APSR total of 20% is consistent
with this (for example one dimension at Band 4 and the other three at 0, or two
at Band 2), but so is Cause A, so the percentage alone does not decide it.

A third, lower-likelihood route worth recording: `replaceAllEntries`
(used by snapshot restore, src/store/useWorkspaceStore.ts:2709) writes entries
wholesale and bypasses the `setHolisticBand` gates entirely. This does not
CREATE the inconsistency from valid state, it only carries forward whatever was
in the snapshot, but it means a restore could reintroduce a band-with-no-lines
state that a later "Remove all" had cleaned up.

Confidence: I cannot distinguish Cause A from Cause B from the repository alone.
The deciding evidence is in the live entry and is two fields you can read
directly: `holisticBand.source` and `holisticBand.decidedAt`
(src/types/index.ts:568). If `source` is `"ai-accepted"`, the AI first-pass was
used, and that pass reads the checklist lines, which means lines existed when
the band was saved, which points firmly to Cause A (lines deleted afterwards).
If `source` is `"human"`, either cause remains possible. The Human Decision Log
would also show any line deletions or status edits on 1.1.1 with timestamps.

### Score impact of clearing this stale band

First, the numbers behind the band. An APSR total of 20% maps to Band 1
(`finalBandFromPct(20)` returns 1, src/lib/checklistBanding.ts:93-97). The
override the band produces is `{ eff: bandToScore(1) = 20, band: 1 }`
(src/lib/checklistBanding.ts:199-201, 225-226). Criterion 1 is worth 60 points
and has two items, 1.1.1 and 1.2.1; sub-criterion 1.1 contains only 1.1.1, so
its proportional share is 30 points. At Band 1 that shows as (1/5) x 30 = 6, so
the "6/30" you see is the sub-criterion 1.1 rollup on the Final Report.

Now what clearing the band would do. There are two different figures and they
move differently, which matters:

- The sub-criterion 1.1 rollup on the Final Report DOES drop from 6/30 to 0/30. That rollup uses `rawAvg` (the mean of item effective scores) as a zero-gate: `scoredPts = rawAvg === 0 ? 0 : Math.round((band / 5) * points)` (src/lib/finalReport.ts:325-329). Clearing the band removes the override, so 1.1.1 falls back to the evidence matrix; with no evidence-matrix score behind it, its effective score becomes 0, `rawAvg` becomes 0, and the sub-criterion shows 0/30.

- The certification TOTAL (the number that actually gates and awards, summed at criterion level, src/lib/scoring.ts:154-164) may not move at all. The total uses each item's BAND, not its effective score, and an item with no evidence still floors at Band 1: `capBandForEvidence(getBand(0), ...)` returns 1 (src/lib/scoring.ts:45-47, 76-82). So 1.1.1's band is 1 with the override and still 1 without it, which means Criterion 1's `cappedAvg` and its band do not change. Criterion 1's scored points only change if the criterion's `avg` (mean effective score) drops to exactly 0, and that only happens if the OTHER item, 1.2.1, is also at effective score 0.

So the honest impact statement is conditional on 1.2.1, which I cannot see:
- If 1.2.1 has any effective score (it is started), clearing 1.1.1's band changes the certification total by roughly nothing; it only corrects the inflated 6/30 shown at the sub-criterion 1.1 rollup.
- If 1.2.1 is also unstarted (effective score 0), then clearing 1.1.1 tips Criterion 1's `avg` to 0, and Criterion 1's whole scored contribution drops to 0 (src/lib/scoring.ts:160), which would be a real total drop.

To know which, check whether item 1.2.1 currently has any score (a confirmed or
reviewer score, or its own saved band) on the live workspace. Note also that if
1.1.1 itself happens to carry an evidence-matrix score underneath the band,
clearing the band would reveal that instead of 0; the "falls to 0" case assumes
the item was scored purely through the checklist, which is the usual pattern.

Human decision needed, not assumed: whether to clear the band, or instead
re-create the lines it was meant to summarise, is a judgement call. Clearing it
removes an inflated sub-criterion figure; re-creating the lines preserves the
band if it was a considered score whose lines were lost. The checker only
flags; it does not decide.

## Issue Set 2 (R2): ten open findings whose lines have since moved

### I cannot list the ten from the repository

R2's `ref` for each issue is the finding id, and its message states which drift
applies ("the line is now Met" versus "the line's dimension is now Not
assessed"). Those ids, the items, and each line's current status are live
workspace values. I have no access to that data, so I cannot honestly produce
the "id, item, current line status" table you asked for. You can read it
directly: each R2 row on the Finalisation page names the finding id and the
reason, and the linked line's current status is on that item's Sub-Criterion
Checklist. What I CAN do is explain the mechanism precisely, which is what
determines the fix.

### Two different triggers, one shared cause

R2 fires when a still-open finding's source line has moved away from the gap it
was raised on (src/lib/consistencyChecker.ts, the R2 block). Under items 6.2.1
and 6.3.1 there are two distinct ways that happens, and they are not the same
event:

- Trigger (i): the line was later re-marked "Met" or "Not Applicable". This is a human status edit on the checklist line after the finding was raised. The finding still describes a gap that the line no longer reports.
- Trigger (ii): the line "picked up the not-assessed sentinel". 6.2.1 and 6.3.1 are Criterion 6 items. If Option A (the PPD plus Evidence path) was re-run on them, that run rewrites each line's Systems and Outcomes and Review dimensions with the fixed "Not assessed by Option A" note (src/lib/optionAChecklistWrite.ts). A finding raised from an EARLIER staged or full audit (which did assess those dimensions) then points at a line whose current assessment says that dimension was not assessed at all. The finding is stale not because the item improved, but because a later run stopped assessing that dimension.

Each of your ten will be one or the other; the R2 message says which. They
should not be treated as one blanket case: trigger (i) is "the gap was closed
or reclassified by a human", trigger (ii) is "a re-run superseded the run the
finding came from". A sensible response to (i) may be to close the finding; a
sensible response to (ii) may be to re-raise or re-run, because the dimension
is now simply unassessed rather than passing. That is a human decision, stated
here rather than assumed.

### Is there a mechanism that should have closed or flagged these? No.

There is no code path that reacts to a line status change by updating,
closing or flagging the finding raised from it. `setSpecificStatus`
(src/store/useChecklistModuleStore.ts:428-443) is the only place a line's
status changes; it writes the new status and records an audit entry in the
Human Decision Log (module "Line Status"), and it does nothing to the finding
the line is linked to through `draftFinding.savedFindingId`. The back-pointer
exists only to stop the same gap being raised twice (:641, :724); it is not a
live link that keeps the two in step. This is exactly INV-04 ("no mechanism")
from docs/consistency-invariants.md. So the answer to "why did the mechanism
not fire" is that there is no such mechanism to fire. Whether one should exist,
and whether it should auto-close or only flag for human review, is a decision
for you, not something to infer.

### Timestamps: partial, not enough to fully order events from stored data

You asked when each finding was raised relative to when its line last changed.
The stored data only partly supports this:
- A finding may carry `createdAt` (src/types/index.ts:255), but it is optional, so older or seeded findings can lack it.
- A checklist line carries NO timestamp for a status change. `setSpecificStatus` does not stamp the line, so there is no per-line "last changed" field to compare against.
- The one place a line-status change is timestamped is the Human Decision Log entry it writes (module "Line Status", useChecklistModuleStore.ts:431). So the ordering CAN in principle be reconstructed per finding, by comparing that finding's `createdAt` against the Human Decision Log entry for its line, but only from the live workspace, and only where both timestamps exist. It cannot be reconstructed from the repository.

### "Open AFIs: 6" versus 10 stale versus 15 total: the reconciliation

These three counts are computed on three different criteria and are not
supposed to match. The important structural point is that the app has TWO
separate notions of "closed", and R2 and the dashboard key on different ones.

- Register total (about 15): every finding in `useAllFindings` (customFindings plus any loaded demo seeds). No filter.
- Dashboard "Open AFIs" (6): `src/lib/scoring.ts:204-206` counts a finding only if its closure is NOT accepted (`closures[id].human !== "Accepted"`) AND it is not an OBS AND it is not risk category D. So accepted-closure, OBS and category-D findings are all excluded from the 6.
- R2 stale (10): the checker skips a finding only if `f.status === "Closed"`, then flags it if its line has moved. It does not look at OBS, category D, or closure acceptance.

The catch is that accepting a closure sets `closures[afiId].human = "Accepted"`
and `closedAt` (src/store/useWorkspaceStore.ts:3249-3261) but does NOT set the
finding's own `status` field to "Closed". So a finding can be:
- excluded from the dashboard 6 (its closure is accepted), yet
- still counted by R2 (its `status` is still "Open", because acceptance never changed the status field), if its line has also moved.

So the dashboard open-count does not cleanly include or exclude the ten stale
findings. It includes only those stale findings that are also genuine open AFIs
(not OBS, not category D, not closure-accepted); it excludes the rest, which
are exactly the OBS, category-D and already-accepted ones that the 15-item
register showed tagged that way. A precise per-finding reconciliation needs the
live data (each finding's type, risk category, closure acceptance, and status
field), but the reason the numbers look inconsistent is not a miscount, it is
that "closed" means one thing to the dashboard (closure accepted) and a
different thing to R2 (status field), and the two are never synchronised.

## Summary of what needs a human decision, not a silent fix

1. R1 / 1.1.1: whether to clear the stale band or re-create its lines, and (before deciding the total impact) whether item 1.2.1 is started. The sub-criterion display is inflated by 6 points either way; the certification total moves only if 1.2.1 is also unstarted.
2. R2 trigger (i) versus (ii): the ten are not one case. Human-reclassified-to-Met is a different situation from superseded-by-a-later-Option-A-run, and the right response differs.
3. Whether the app should gain a mechanism that reconciles a finding when its line changes (INV-04), and if so whether it auto-closes or only flags.
4. Whether "acceptance of a closure" should also set the finding's `status` to "Closed", so that the dashboard count and any status-based check agree on what "closed" means. This mismatch is the root of the 6-versus-10 confusion.
