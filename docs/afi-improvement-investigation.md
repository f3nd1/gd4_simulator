# Investigation: improving the generic Strength AFI text

**Date:** 2026-07-16
**Status:** Investigation and proposed wording. No code written yet, awaiting go-ahead.
**Scope:** the Final Report per-item findings table only. Display text (the AFI
column for strength rows). No scoring, banding, verdict or derivation change.

## 1. What the text is today

On the Final Report, each item's findings table has an "AFI (to reach next band)"
column. For a **strength** row (a line that is Met and whose evidence is Present),
the AFI is a single fixed sentence:

> Keep this in place and re-evidence it at each review cycle so it stays audit-ready.

Source: `src/lib/finalReport.ts:32` (`STRENGTH_MAINTENANCE_AFI`), assigned at
`src/lib/finalReport.ts:210-214`:

```ts
return {
  lineId: l.id, itemRef, verdict: "strength",
  finding: text ? firstSentence(text) : "No evidence summary recorded for this line.",
  afi: result.band < 5 ? STRENGTH_MAINTENANCE_AFI : undefined,
};
```

It is the same sentence for every strength on every dimension at every band from
1 to 4. It tells the user nothing about *what a stronger version of this evidence
would look like*, which is what the column header ("to reach next band") promises.

## 2. Is there enough data to do better, without inventing anything?

**Yes.** At the exact point the strength AFI is set, the code already holds
everything a next-band-specific line needs:

| What we need | Where it already is | file:line |
|---|---|---|
| The dimension this row belongs to | `key` (`"approach"` / `"processes"` / `"systemsOutcomes"` / `"review"`) | `finalReport.ts:176` |
| **The current band of THIS dimension** | `score = hb.matrixScores[key]` (a `Band`, 1-5) | `finalReport.ts:177` |
| The official descriptor for the **next band up**, for this dimension | `EDUTRUST_BANDS` / `bandLevel(score + 1)[key]` | `edutrustRubric.ts:31-72, 83-85` |

`EdutrustBandLevel` has one field per dimension named exactly `approach`,
`processes`, `systemsOutcomes`, `review` (`edutrustRubric.ts:22-29`), so
`bandLevel(score + 1)[key]` returns the **verbatim** GD4 §23 descriptor for the
next band, for the correct dimension. `edutrustRubric.ts` is already the single
source of truth for these descriptors and forbids paraphrasing.

So a better AFI reuses stored verbatim rubric text; only the sentence *around* the
quote is light templating. Nothing is fabricated.

### One correctness note about the gate

The current gate is `result.band < 5`, where `result.band` is the **overall item
band**. But "next band up" is inherently **per-dimension**. The right gate for a
next-band line is the dimension's own band, `score < 5`:

- A dimension already at Band 5 inside a Band-3 item has no higher rubric rung, so
  it should get no next-band line (today it still gets the generic sentence).
- A dimension at Band 3 inside a Band-5 item does have a rung above it (today it
  gets no AFI at all, because `result.band` is 5).

Switching the gate from `result.band` to `score` changes *which* strength rows
carry an AFI. It changes no band, %, or verdict. It is still a display change, but
it is a visible behaviour change, so I am flagging it rather than folding it in
silently. **Decision needed:** gate on the dimension band `score` (correct for a
per-dimension "next band" line) or leave the gate on `result.band` (fewer rows
change, but the line can then quote a "next band" for a dimension already at 5).
My recommendation: gate on `score`.

## 3. Proposed wording

Template (the only non-verbatim part is the fixed frame; the quote is verbatim
`EDUTRUST_BANDS` text):

> **Band {N} strength.** To reach Band {N+1} on {Dimension}, the EduTrust rubric
> looks for: "{verbatim next-band descriptor for this dimension}". Keep this
> evidenced and build toward that at the next review cycle.

### Worked example A (real rubric data): Review at Band 3

`key = "review"`, `score = 3`, `bandLevel(4).review` =
"Implemented action plans for improvement are monitored for effectiveness and to
bring about positive impact resulting in favourable outcomes".

> **Band 3 strength.** To reach Band 4 on Review, the EduTrust rubric looks for:
> "Implemented action plans for improvement are monitored for effectiveness and to
> bring about positive impact resulting in favourable outcomes". Keep this
> evidenced and build toward that at the next review cycle.

### Worked example B (real rubric data): Approach at Band 4

`key = "approach"`, `score = 4`, `bandLevel(5).approach` =
"An effective, efficient and well-integrated approach meeting all requirements is
evident".

> **Band 4 strength.** To reach Band 5 on Approach, the EduTrust rubric looks for:
> "An effective, efficient and well-integrated approach meeting all requirements is
> evident". Keep this evidenced and build toward that at the next review cycle.

## 4. Cases where it cannot be done cleanly (flagged, not papered over)

1. **Dimension already at Band 5.** There is no Band 6 descriptor
   (`bandLevel(6)` is undefined). Keep the AFI **blank** for these rows, exactly as
   today's Band-5 behaviour. Do not invent an "above excellent" line.

2. **Very low current band (1 or 2).** The next-band descriptor is still verbatim
   and honest, but reads as faint praise. Example, Systems & Outcomes at Band 1,
   `bandLevel(2).systemsOutcomes` = "Systems do not interact with one another;
   there are limited outcomes", aiming for that as a "next band" sounds like
   aiming at a limitation. In practice a **strength** row requires status Met and
   Present evidence, so strengths almost never sit at Band 1-2; but the wording
   should not break if one does. Two options: (a) accept the verbatim text as-is
   (fully honest, occasionally awkward), or (b) suppress the next-band line below a
   floor band and fall back to the current generic maintenance sentence. My
   recommendation: (a), keep it verbatim and honest; the awkwardness is the
   rubric's, not ours, and suppressing hides real information.

3. **Descriptor text is a full sentence already.** Some descriptors end without
   punctuation, some are two clauses joined by a semicolon. The frame wraps them in
   quotes so they read as a citation regardless. No trimming or rewording of the
   quote.

## 5. What this must never become

- No AI call, no free-text generation. This is a deterministic read of
  `matrixScores[key]` plus a verbatim `EDUTRUST_BANDS` lookup, in the same spirit
  as the rest of `buildFindingsGroups`.
- No paraphrasing of the descriptor. Quote it verbatim from `edutrustRubric.ts`.
- The weakness-row AFI (`lineSuggestedAction`) and the not-assessed AFI
  (`NOT_ASSESSED_AFI`) are unchanged. This touches strength rows only.

## 6. Recommendation

Feasible and worth doing. Gate on the dimension band `score` (Section 2 note),
quote the next-band descriptor verbatim, keep Band-5 rows blank, keep low-band
descriptors verbatim. One small unit test on the new text builder (Band 3 Review
produces the Band 4 quote; Band 5 produces blank; unknown/absent score is safe).
Awaiting go-ahead on: (a) the gate-source decision, and (b) the exact frame
wording in Section 3.
