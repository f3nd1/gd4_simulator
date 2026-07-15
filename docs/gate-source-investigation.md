# Gate band-source investigation (INV-13)

Plain-English investigation of one question: when the certification gate
(EduTrust section 20) averages the bands for sub-criteria 4.2, 4.6 and
Criterion 5, are the per-item bands it averages all on the same scale and do
they all mean the same thing? A prior note (docs/consistency-invariants.md, row
INV-13) worried that the gate might "blend matrix-derived and evidence-capped
bands", i.e. average numbers that are not comparable.

This is investigation only. No code was changed. The gate arithmetic itself
(the average, the pass/fail test, the rounding) was already verified elsewhere
and is not re-examined here. This document only traces where each band VALUE
comes from before the average is taken.

A quick note on one term used throughout: a "band" is a whole number from 1 to
5 (in the code it is the type `Band`, which can only ever be 1, 2, 3, 4 or 5).
It is the maturity grade the tool gives an item. The gate rule says the average
of an item group's bands must be at least 3.

## The one line that matters

The gate averages the field called `band` on each item:

- `src/lib/scoring.ts:177` - `avgBand = sum(i.band) / count` for each gate group.

So the whole question reduces to: where does each item's `band` come from, and
is it always the same kind of number?

## Question 1 - where does each per-item band come from?

Each item's `band` is set in exactly one place:

- `src/lib/scoring.ts:129` - `band: override ? override.band : capBandForEvidence(getBand(eff), ev)`

Read in plain English, this says: "if this item has a checklist override, use
the override's band; otherwise work the band out from the evidence matrix and
apply the evidence caps." The two halves of that sentence are the only two
sources. They are mutually exclusive: an item takes the first path if it has an
override and the second path if it does not. No item can take both.

**Source A - the checklist / APSR matrix path (`override.band`)**

- The override for an item comes from `checklistBandOverrides[item.id]`, read at `src/lib/scoring.ts:106`.
- That override is built in `src/lib/checklistBanding.ts:211-229` (`computeChecklistOverrides`). It only exists for an item that has a current-model saved band with a full APSR matrix (`if (!hb?.matrixScores) return;` at `checklistBanding.ts:223`).
- The band value is `apsrMatrixResult(hb.matrixScores, scale).band` (`checklistBanding.ts:225`).
- `apsrMatrixResult` adds up the four dimension percentages and maps the total to a band via `finalBandFromPct` (`checklistBanding.ts:122-123`).
- `finalBandFromPct` returns a whole number 1 to 5 (`checklistBanding.ts:93-97`).

So Source A is: add the four APSR dimension percentages, get a 0 to 100 total,
map that total to a band 1 to 5.

**Source B - the evidence-matrix fallback path (`capBandForEvidence(getBand(eff), ev)`)**

- `eff` is the item's effective score, a number from 0 to 100. It is the confirmed reviewer score if there is one, otherwise the reviewer score, otherwise the AI score (`src/lib/scoring.ts:107`, and `aiScore` at `:35-43`).
- `getBand(eff)` turns that 0 to 100 score into a band 1 to 5 using fixed thresholds (85, 70, 55, 40) at `src/lib/scoring.ts:45-47`.
- `capBandForEvidence` then may LOWER that band for evidence reasons at `src/lib/scoring.ts:76-82`: review evidence Missing caps it at 3, processes Missing caps it at 2, and no linked Drive evidence at all caps it at 1.

So Source B is: turn the evidence-limb score into a band, then possibly floor
that band down if the evidence cannot be verified.

Note that Source B has three sub-inputs for `eff` (confirmed score, reviewer
score, or AI score), but all three are just a 0 to 100 number fed through the
same `getBand`, so they do not add extra band scales. There is no third band
source. The field `aiBand` at `scoring.ts:130` is a separate display value and
is NOT used by the gate.

## Question 2 - are all the sources on the same scale and unit?

**Yes.** Every path ends in the same thing: a whole number band from 1 to 5.

- Source A ends in `finalBandFromPct`, which by its type and its code returns 1, 2, 3, 4 or 5 (`checklistBanding.ts:93-97`).
- Source B ends in `capBandForEvidence`, which takes a band and returns a band, 1 to 5 (`scoring.ts:76-82`); its input `getBand` also returns 1 to 5 (`scoring.ts:45-47`).

In the code both are the exact same type, `Band`. There is no case where one
path yields a percentage and the other a band, or one yields a decimal and the
other a whole number. The per-item band is always a whole number 1 to 5. The
gate then averages those whole numbers, which is why the average itself can be a
decimal (for example 2.67), and that is compared against 3. That is the
intended "group average" behaviour, not a mixing error.

So on the narrow question the INV-13 note raised - "are these numbers on the
same scale before they are averaged" - the answer is that they are. The gate is
not averaging percentages with bands, or capped scores with raw scores. It is
averaging bands with bands.

## Question 3 - can mixing the two sources flip the gate result?

The honest answer is that the phrase "if all bands came from a single
consistent source" does not have a clean meaning here, because each item only
ever has ONE applicable source. An item either has a saved checklist band or it
does not. You cannot re-derive the same item's band from the "other" source
without changing the item's underlying data, so there is no like-for-like
counterfactual to compare against. Given a fixed set of item data, the gate
result is fully determined; there is no second answer that "single source"
would have produced.

What CAN be shown is whether the mixing biases the gate in a dangerous
direction. It does not, and here is why.

Worked example. Take sub-criterion 4.2 with two items:

- Item X is scored through the checklist. Its APSR matrix gives Band 5 (Source A). No evidence cap is applied on this path (see the comment at `scoring.ts:66-69`, the caps only run on the fallback path).
- Item Y is scored through the evidence matrix. Its four limbs are all rated "good", which would give Band 5 through `getBand`, but it has no linked Drive evidence, so `capBandForEvidence` floors it to Band 1 (`scoring.ts:80`).

Gate average = (5 + 1) / 2 = 3.0, which passes (3 or above).

Now the key property. The evidence caps in Source B can only ever move a band
DOWN, never up (every branch in `capBandForEvidence` is of the form "if the band
is above N, bring it to N"; `scoring.ts:78-80`). So a capped item always
contributes less than or equal to its uncapped band. This means mixing a capped
item into the gate can only make the average the same or LOWER, never higher. In
plain terms: the caps can only make the gate HARDER to pass, never easier.

That is the safe direction for a certification gate. The failure mode you would
fear - the gate wrongly saying "certified" - cannot be caused by the caps,
because caps never lift a band. The only thing the caps can do is hold an item
down, which is exactly what they are designed for: the comment at
`scoring.ts:69-75` states outright that an item with all limbs "good" but no
linked evidence must not score Band 5, because there is nothing verifiable
behind it. So Item Y contributing Band 1 to the gate is intended behaviour, not
a comparability bug.

So: no worked example produces a WRONG pass from mixing, and any downward pull
from a capped item is deliberate and conservative.

## Question 4 - honest verdict

INV-13, read literally as "the gate averages numbers that are not on the same
scale", is NOT a real correctness risk. The evidence is:

1. Both band sources end in the identical unit, a whole number band 1 to 5 (`finalBandFromPct` at `checklistBanding.ts:93-97`; `capBandForEvidence`/`getBand` at `scoring.ts:45-47`, `76-82`). The gate averages bands with bands (`scoring.ts:177`).
2. The two sources are mutually exclusive per item (`scoring.ts:129`), so no item is counted twice or scored two ways, and there is no ambiguous item whose band could be read differently by the gate.
3. The evidence caps only ever lower a band, so mixing cannot cause a false PASS; it can only make the gate stricter, which is the safe direction for a certification decision.

There is one real difference between the two sources, but it is a difference of
MEANING, not of scale, and it does not corrupt the pass/fail:

- A Source A band (checklist/APSR) reflects assessed maturity directly.
- A Source B band can be floored for an evidence-provenance reason (no Drive link, missing review or processes evidence) rather than for low maturity.

So two items that both read "Band 3" in the gate average can mean slightly
different things ("assessed at maturity 3" versus "would be higher but capped
because evidence is not verifiable"). A person reading WHY a gate failed should
know that some items in the group may be held down for evidence-linking reasons
rather than genuine weakness. That is a reporting and interpretation nuance, not
a maths fault, and it does not make the gate pass or fail incorrectly.

## What you would need to confirm to be fully certain

The arithmetic is safe by construction. The only open point is a policy
question, not a code bug, and I cannot settle it from the code alone:

- Checklist-scored gate items are NOT subject to the "no Drive link caps the item to Band 1" rule; only evidence-matrix items are (the caps are bypassed on the override path, `scoring.ts:66-69` and `:129`). This is deliberate - the checklist path has its own evidence discipline through its line-by-line assessment - but it does mean a checklist-scored gate item and an evidence-scored gate item are held to different evidence-verifiability standards before their bands enter the same gate average. Whether that asymmetry is acceptable for the section 20 gate is a judgement for the audit owner, not something the code can answer. If you want them held to the same standard, that is a design change to consider separately (and outside this investigation, which changed no code).

Everything else about the blend is safe: same unit, mutually exclusive per
item, and caps that only ever push in the fail-safe direction.
