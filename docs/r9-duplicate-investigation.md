# R9 duplicate findings: investigation

Investigation only. No code or data changed. Explains how four gaps on item
6.2.1 (refs DS1.a, DS1.f, DS3, DS4) each came to hold two open findings, with
file:line evidence.

Access caveat, stated up front: I can read the repository, not the live
workspace. The mechanism below is proven from code; the exact live sequence is
reconstructed with stated confidence, and section 4 lists the four fields on
the live findings that pin it exactly in about two minutes.

## 1. Every path that raises a finding, and its guards

There are five creation paths. Four are guarded; their guards all share one
blind spot (section 2).

| Path | Creates id | Guards before creating |
|---|---|---|
| `confirmDraftFinding` (per-line raise; also the funnel the two paths below go through) | `CKL-...` (useChecklistModuleStore.ts:40-43) | (1) the line's own `draftFinding.savedFindingId` (:641); (2) register composite key `item::ref::type` via `findingDedupeKey`/`findingKeyOf` (:646-652, lib/gd4Refs.ts:22-39): on a hit it RELINKS the line to the existing finding instead of creating |
| `raiseAllUnmetFindings` (auto-raise after staged/full audits, useWorkspaceStore.ts:4633, :5716, and Option A gate accepts :2476, :2522) | delegates to `confirmDraftFinding` (:734) | line `savedFindingId` skip (:724); a set of every register finding's composite key plus a text-prefix fallback for ref-less lines (:713-732) |
| Option A `compileEvidenceFindings` (:2065; called at :1656, :2482, :2525, :2558) | delegates to `confirmDraftFinding` (:2171); PPD-contradiction findings are direct (`EV-...-CONTRAn`, :2208-2236) | row's own `savedFindingId` (:2105); `existingByKey`, seeded from EVERY register finding via `findingKeyOf` (:2077-2082); the matched line's `savedFindingId` (:2152); and it types the draft off the ROW verdict, not the possibly stale line status (:2155-2160, itself a fix for an earlier duplicate bug) |
| `confirmGroupedDraft` (grouped finding writer) | `GF-...` (useFindingDraftStore.ts:333) | three checks (:299-330): (a) register composite key on the group's first ref + `classifyGroup` type (:306, :317); (b) any contributing LIVE line already stamped (:312-316); (c) `isCoveredByExistingFinding`, a TYPE-BLIND overlap check on line ids or any shared ref (:318; findingGrouper.ts:199-208). On any hit it relinks, not creates. It also stamps every contributing line afterwards (:397-399; the stamp helper writes a minimal draftFinding even on lines that had none, useChecklistModuleStore.ts:760-771) |
| Manual form (Findings page) | `FIND-...` (Findings.tsx:208) | NO dedupe at all (:205-231). However, it sets no `clause` and no `linkedSourceRefs`, so its findings have a null `carryoverKey` and CANNOT appear in an R9 pair. The manual path is therefore exonerated for these four |

`addCustomFinding` itself (:6139-6146) never dedupes; carried-over findings on
a new cycle are written directly, bypassing it entirely (comment :6142-6144).

## 2. The structural blind spot: the guards key on type, R9 does not

Every creation guard's key is `gd4ItemId::normalisedRef::findingType`
(gd4Refs.ts:22-30). The checker's R9 groups by `carryoverKey`, which is
`gd4ItemId::normalisedRef` with the type DELIBERATELY ignored, because a gap
that was an OFI last time and an NC this time is still the same gap
(cycleCarryover.ts:17-24).

Consequence, provable without live data: since R9 paired two open findings per
ref, and any same-type second raise would have been relinked by the register
composite-key check in whichever pipeline ran second, THE TWO FINDINGS IN EACH
PAIR MUST CARRY DIFFERENT `findingType` VALUES (one of them may be undefined,
which keys as `item::ref::` and matches no typed key; older findings from
before the classification existed, including cycle-carried ones, can lack it).

The type flips with the verdict: `findingTypeForStatus` maps Not met to NC,
Partial to OFI, Met to OBS (findingClassification.ts:9-14; `classifyGroup` uses
the same mapping on the group's worst line, findingGrouper.ts:214-218). So a
line judged Not met on one pass and Partial on another produces two findings
the guards consider different and R9 correctly calls the same gap.

## 3. Reconstructing the sequence

For a second finding to be CREATED (not relinked), two things must both hold:

1. The typed key missed: the second raise's `findingType` differed from the first finding's (verdict changed between raises, or the first finding has no `findingType`), AND
2. The line-stamp guard missed: the checklist line the second raise anchored to had no `draftFinding.savedFindingId`. The stamp survives status edits, so this means the LINE ITSELF was new: lines regenerated (Remove all then regenerate), a new cycle (entries wiped by `replaceAllEntries({})` while open findings carry over, useWorkspaceStore.ts:2860, :2865-2899), or Option A creating the line fresh at compile (:2128-2149).

Candidate causes you asked about, assessed:

- Option A run twice on 6.2.1: on its own, guarded. A second run's rows are fresh (no `savedFindingId`), and its key uses the same `findingDedupeKey`, but the compile still checks the matched LINE's stamp (:2152) and reuses the first finding. It only double-raises if the verdict type changed AND the line was recreated between runs. So "run twice" is necessary context here, not sufficient cause.
- Dedupe key changing when the derived findingType changes: CONFIRMED, this is the core mechanism, exactly as INV-11 predicted (docs/consistency-invariants.md). Section 2 above is the precise code path.
- Timing/race: ruled out within one tab. Every guard reads synchronous in-memory state and the raise loops are synchronous; a second call cannot interleave mid-loop in single-threaded JS. Two tabs open at once would not merge duplicates either: the whole findings array lives in one store blob and the sync is last-writer-wins per key, which loses one tab's writes rather than combining them. Not the cause.

Most likely live sequence (medium confidence on the specifics, high on the
shape): 6.2.1 was audited and its unmet lines (DS1.a, DS1.f, DS3, DS4) raised
one finding each, typed off that pass's verdicts. The checklist lines for
6.2.1 were then recreated (regenerated, or a re-run created them fresh), and a
later pass judged the same four gaps with a DIFFERENT verdict class (Not met
versus Partial), so the second raise keyed differently and created four
siblings. The four duplicated refs being exactly one item's unmet set is what
this shape predicts.

## 4. Pin it exactly from the live data (two minutes)

For each of the four pairs, read these fields on both findings in the register
export or the Findings page:

- `id` prefix: `CKL-` = per-line/compile pipeline; `GF-` = grouped writer; `FIND-` = manual; `EV-...-CONTRAn` = PPD contradiction.
- `findingType`: expect the pair to differ (e.g. NC vs OFI), or one to be blank.
- `source`: "Checklist" / "ai_audit" / "PPD Review" / "Manual".
- `createdAt`: orders the two raises.

If each pair shows the same prefix with NC on the older and OFI on the newer
(or the reverse), the section 3 sequence is confirmed. If one member of each
pair is `GF-`, the grouped writer was the second pipeline instead.

## 5. Verdict

(a) A REAL gap that will recur, not a narrow edge case. Confidence: high. Any
future re-run over recreated lines where a verdict class changes (Not met to
Partial is the ordinary "we improved the evidence" trajectory) reproduces it,
and any old finding without a `findingType` can never dedupe against a typed
raise. The individual pipelines are internally well guarded; the hole is the
shared key DESIGN, so it cannot be closed by fixing one caller.

## 6. What a fix would need to do (not implemented)

Add a type-blind second pass to the shared guard sites: after the existing
typed-key check misses, also look up the register by the type-ignoring key
(reuse `carryoverKey`, do not invent a third scheme). On a hit, do not create.
What happens instead is a human decision, not something to default silently:

- Option 1: relink to the existing finding and update its classification to the new type, logging the change.
- Option 2: relink but flag "classification changed since first raised" for human review (fits the app's human-gate rule).

Scoring impact: none. Findings feed only the open-AFIs count
(scoring.ts:204-206), never bands or points, and the guard sites
(useChecklistModuleStore, useFindingDraftStore, the compile in
useWorkspaceStore) are register logic, not scoring code. No change to
scoring.ts, checklistBanding.ts or consistencyChecker.ts would be required, so
no scoring stop-and-ask is triggered; the only decision needed is the
relink-versus-review policy above, plus what to do with the four existing live
pairs (merge or close one of each by hand; the checker links each one).
