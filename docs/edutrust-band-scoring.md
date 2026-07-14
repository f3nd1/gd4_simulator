# EduTrust band scoring — model, history, and what is still unconfirmed

> **If you are changing how bands are calculated, update this file in the same
> commit.** This document is the running record of *why* the scoring model is
> the shape it is. Code without this context has repeatedly been "corrected"
> back into a wrong model. Keep it current.

The band selector UI links here ("Why is scoring built this way? →"). The
verbatim rubric lives in [`src/data/edutrustRubric.ts`](../src/data/edutrustRubric.ts);
the formula lives in [`src/lib/checklistBanding.ts`](../src/lib/checklistBanding.ts)
(`pctForScore` / `finalBandFromPct` / `apsrMatrixResult`).

---

## 1. The source of truth

EduTrust **Guidance Document Version 4 (January 2025)**, paragraphs 22–23.
The descriptor text below is quoted verbatim and is mirrored exactly in
`edutrustRubric.ts` (`EDUTRUST_BANDS`, `EDUTRUST_DIMENSIONS`) — that file, not
this one, is the single source of truth for descriptor wording; if they ever
differ, `edutrustRubric.ts` wins.

### §22 — point allocation

The certification instrument allocates **1,000 points** across the seven
criteria; each requirement item is scored on the 5-band scale and rolled up by
weight. (Point weights per criterion live in `src/data/gd4Requirements.ts`.)

### §23 — the five bands and four dimensions

Four dimensions are assessed for each item:

| Dimension | Official definition (§23 explanatory notes) |
|---|---|
| **Approach** | Documented policies/procedures, methods, tools, techniques used to carry out the processes. |
| **Processes** | Actual implementation of those policies and procedures. |
| **Systems & Outcomes** | Desired outcome(s) derived from implementation. |
| **Review** | Evaluation of appropriateness, relevance and effectiveness of the approach and process for continual improvement, including comparisons/benchmarking against best practice or the PEI's own past performance. |

The five bands (verbatim descriptors per dimension are in `edutrustRubric.ts`):

1. **Not evident** · 2. **Beginning** · 3. **Meeting Expectation** ·
4. **Exceeding** · 5. **Excellent**

The published document phrases the result as placing the four dimensions "in a
band" (singular) and gives **no combination formula**. That wording drove the
second model below — and, per the auditor consultation, does **not** reflect
how SSG actually scores. See §3.

---

## 2. Scoring model history (in order, with why each was replaced)

### (a) Original ladder model — *app-invented, retired*

G1–G4 Met/Partial/Not-met ticks with a "highest-ticked-lens-wins" maturity
ceiling, multiplied by a coverage %. **Never matched any official source.**
Replaced because it silently floored bands (a Band-5-worthy item with thin
line coverage was capped down by a formula the Guidance Document never
defines) and had no basis in the document at all.

### (b) Holistic single-band model — *commits 751b476 / 7862fee, retired*

One band per item, chosen by a human reading the evidence against all four
dimension descriptors and picking the level that best fits **overall**. Built
directly on the Guidance Document's literal wording ("a band," singular, §23),
on the reasoning that no combination formula appears anywhere in the document,
and cross-checked against an older GD3 version's near-identical "a band for
each criterion" phrasing.

Replaced because an **SSG auditor, consulted directly by the user, confirmed
that actual assessment practice differs from the document's literal wording**:
the dimensions **are** scored separately and summed. The document is
authoritative on descriptors; it is not a complete description of the scoring
arithmetic.

### (c) APSR percentage-matrix model — *current*

Built from the SSG auditor's stated worked example, quoted to the user:

> "For APSR, the banding is assessed separately for A, P, S, and R. Each
> component has its own score... The final band is determined based on the
> combined APSR score. For example, A may score 20%, P 20%, S 10%, and R 0%,
> giving a total score of 50%, which corresponds to the applicable overall
> band."

**Source of this model is the auditor consultation, NOT the Guidance Document
text.** It is confirmed real-world SSG practice that the published document
does not spell out.

Reconstructed formula (see §4 for what is *not* confirmed):

- 100% ÷ 4 dimensions = **25% maximum per dimension**.
- 25% ÷ 5 bands = **5% per band step**: Band 1 = 5%, Band 2 = 10%,
  Band 3 = 15%, Band 4 = 20%, Band 5 = 25%. A dimension may also score **0%**
  (below Band 1 / "Not evident").
- Sum the four dimension percentages → **total %** (0–100%).
- Total % → final band in five equal 20-point ranges: 0–20% = Band 1,
  21–40% = Band 2, 41–60% = Band 3, 61–80% = Band 4, 81–100% = Band 5.

**The scale is not hardcoded.** Because every number above is reconstructed,
the max-%-per-dimension and the four band-threshold cut-offs are editable on the
**GD4 Scoring Setup** page (`useScoringConfigStore.apsrScale`, default =
`DEFAULT_APSR_SCALE`). The band is **derived** from the stored `matrixScores`
under the current scale at every read site (`apsrMatrixResult`,
`computeChecklistOverrides`), never trusted from a frozen snapshot — so editing
the scale immediately re-bands every item on the Scorecard, Final Report and
Sub-Criterion Checklist. Reconfirming the real cut-offs (§5) is then a settings
edit, not a code change (though this file must still be updated to record it).

**Worked example reproduces exactly:** A = 20% (Band 4) + P = 20% (Band 4) +
S = 10% (Band 2) + R = 0% = **50% → Band 3**, matching the auditor's stated
result. This is the regression test in
`src/lib/__tests__/checklistBanding.test.ts` (`apsrMatrixResult` describe block)
and the store test in `src/store/__tests__/holisticBandGuards.test.ts`.

Migration: items banded under model (a) or (b) are **not** carried forward.
`needsReassessment()` flags any item that has checklist lines but no
`matrixScores`, and the Sub-Criterion Checklist shows a "needs re-assessment
under the confirmed APSR percentage method" banner. No band is silently
converted between models.

---

## 3. Why the document's literal wording was not enough

The Guidance Document says "a band" and gives no formula, which is exactly why
model (b) was a *reasonable* reading of the text. The lesson recorded here so
it is not re-litigated: **the published descriptor text is authoritative for
descriptors, but the auditor consultation is authoritative for the
arithmetic.** When they conflict, the arithmetic follows the auditor; the
descriptor wording stays verbatim from the document.

---

## 4. What is STILL UNCONFIRMED (do not present as settled)

The formula in §2(c) is reconstructed from **one** worked example. These points
are flagged in the UI (`INFERRED_THRESHOLDS` in `checklistBanding.ts`, the
amber disclaimer in `ApsrMatrixSelector.tsx`) and must not be presented to a
user as fully confirmed:

1. **The 20/40/60/80 band cut-offs.** Five equal 20-point ranges is an
   inference from the single example (50% → Band 3). The real cut-offs could be
   unequal, or rounded differently at boundaries.
2. **Whether 0% is a valid score.** R = 0% in the example does not match any
   5%-per-band step (Band 1 would be 5%). The UI allows a genuine 0% ("below
   Band 1 / Not evident") rather than forcing it into Band 1, but whether SSG
   treats 0% as a real input or as shorthand for "Band 1 / not scored" is
   unknown.
3. **The equal 25%-per-dimension weighting.** The example is consistent with
   four equally-weighted 25% dimensions, but a single example cannot prove the
   weights are equal across all criteria/items.
4. **Other auditor points captured separately** (Major/Minor NC severity,
   the three-pillar scope of certification, PDCA "Act"-stage emphasis) come
   from the same consultation and are implemented elsewhere; they do not change
   this formula but share its provenance.

## 5. How to reconfirm

- Ask the SSG auditor for a **second and third** worked example that stress the
  boundaries — especially one that lands on a cut-off (e.g. a 40% or 60% total)
  and one with a 0% dimension — to confirm the ranges and the 0% question.
- If the confirmed cut-offs differ, change `finalBandFromPct` and the range
  copy in `ApsrMatrixSelector.tsx`, set `INFERRED_THRESHOLDS = false`, remove
  the amber disclaimer, and **update this file in the same commit** with the
  new source and the date it was confirmed.
