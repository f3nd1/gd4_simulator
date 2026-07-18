# Gap analysis: current flow vs the target-audit-flow diagram

Investigation only. No application logic, scoring, or write behaviour was
changed. Every claim cites the file:line where the code actually does it. UK
spelling, no em dashes.

**Commit analysed:** `7be8f8d3c528385f4a29427fcd2757ab82b9da5e` (local HEAD
confirmed equal to origin/main before analysis; this commit added
docs/target-audit-flow.html and this analysis compares against it).

The target diagram (docs/target-audit-flow.html) proposes three changes from
current behaviour (docs/audit-flow-by-mode.md). They are NOT one change: #1 and
#2 alter the certification-scoring safety model and are HIGH RISK; #3 is a
UI/workflow affordance and is LOW RISK. They are assessed separately and carry
different recommendations. No code for #1 or #2 may be written without the
explicit decision named in the final section.

---

## Change 1 (HIGH RISK): Full Auto auto-scores the band matrix

### What the diagram asks

At the end of an automatic Full Auto run, the 6x4 APSR band matrix should set
itself (the gold "AI sets the band" node, target-audit-flow.html:86), instead
of always requiring a human save.

### What is in the way, with evidence

- The band is written ONLY by `setHolisticBand`
  (`useChecklistModuleStore.ts:197-234`), and it carries two hard gates and a
  mandatory log:
  - Gate 1, complete matrix: rejects unless all four dimensions are scored
    (`:204-207`).
  - Gate 2, written justification: rejects an empty/whitespace rationale
    (`:208-212`) — this IS invariant INV-17 ("A saved band must carry a
    written rationale", `docs/consistency-invariants.md` INV-17 row).
  - Human-decision log: every save writes a `logHumanDecision` record with
    `module: "Holistic Band"` and a comment "Band selection is a scoring
    decision — always on the human record" (`:223-233`).
- The Full Auto sweep sets NO band today. `runFullAudit`
  (`useWorkspaceStore.ts:2603-2673`) runs each sub-criterion via
  `runOptionAFullAuto` or `auditFolderStaged`; `runOptionAFullAuto`
  (`:2781-2793`) is exactly PPD review, evidence assessment, compile findings,
  and stops. No `setHolisticBand`, no `suggestBand` anywhere in the sweep.
- An AI band SUGGESTION already exists and already produces a rationale:
  `suggestBand` (`useChecklistModuleStore.ts:244-294`) calls
  `runHolisticBandSuggestion`, which returns `{ band, dimensions,
  dimensionBands, rationale, limitingFactor }`. But by design it "never commits
  itself" (`:269`) — it returns to the caller for a human to accept.

So making #1 true means: after the sweep, call `suggestBand` per item, then
call `setHolisticBand` with the AI's scores and `source: "ai-accepted"`. The
matrix and the arithmetic are not the obstacle. The GATES are.

### Safety implications (this is the crux)

- **The justification requirement (Gate 2 / INV-17).** An auto-score would pass
  the AI's own `result.rationale` as the rationale. That satisfies the gate
  MECHANICALLY (a non-empty string), but it changes what INV-17 MEANS: today
  "a written rationale" is a human's justification; after this it is
  AI-generated prose that no human has read or endorsed. INV-17 would not be
  violated at the code level, but its INTENT would be hollowed out. Leaving the
  rationale blank is not an option — Gate 2 would reject the save outright, so
  the band simply would not set. So the only way to auto-score is to accept an
  AI-written justification standing in for a human one.
- **Human-decision logging.** `setHolisticBand` unconditionally logs the save
  as a human decision (`:223-233`). An auto-score would write a "Holistic Band"
  log entry that no human made. Either the log becomes untrue (records a human
  decision that did not happen), or it needs a new "auto" decision type — and
  every consumer of the Human Decision Log (the log page, exports, the
  learning loop) currently assumes these entries are human acts.
- **The "a pass never moves a band" property.** The Outcomes & Review pass was
  built and TESTED on the guarantee that nothing but a human save moves
  `matrixScores` (the byte-identical `computeChecklistOverrides`/`buildScored`
  test in `src/store/__tests__/outcomeReviewApply.test.ts`; INV-14 keeps the
  live `apsrMatrix` and the saved band as two copies only a human save
  reconciles). That test does not break (it exercises the O/R pass, not the
  run), but the PROPERTY it encodes — "the certification band only changes when
  a human decides" — would no longer hold for Full Auto. Any future reasoning
  or feature that leaned on that property (as the O/R pass explicitly did)
  would need re-checking.
- **The consistency checker.** No R-rule currently forbids an auto-set band, so
  none would fire — but that is because the checker was written in a world
  where bands are human. INV-17's status would move from "yes, enforced and
  meaningful" to "enforced but satisfiable by AI text", which the invariants
  doc should be updated to say honestly.

### What would need to happen to build this safely, if at all

This is not primarily an engineering task; it is a policy decision (see the
final STOP). IF the decision is taken, the minimum honest implementation is:
(a) a distinct `source` value and a distinct human-decision `decisionType` so
an auto-set band is never recorded as a human act; (b) an unmistakable UI mark
on every auto-scored band ("AI-scored, not yet reviewed") carried into the
Final Report and exports; (c) INV-17 reworded in the invariants doc to state
that the rationale may be AI-authored in Full Auto; (d) the "AI recommends,
human decides" wording in CLAUDE.md (hard rule 3) and in
`suggestBand`'s own comment (`:269`) updated so the code does not contradict
its own stated contract. None of (a) to (d) is safe to write before the policy
decision.

### What this means for you

Auto-scoring the band is not blocked by missing capability — the AI already
produces a scorable suggestion with a rationale. It is blocked by three
on-purpose safety gates. Turning it on means an AI-written justification stands
in for a human one, the human-decision log records a decision no human made,
and the tool's core promise flips (see STOP).

---

## Change 2 (HIGH RISK, contains #1): Hybrid's first pass runs like Full Auto

### What the diagram asks

Hybrid's first click should run end to end exactly like Full Auto — including
auto-scoring the band — to produce a complete draft Final Report, instead of
pausing (target-audit-flow.html:98).

### What is in the way, with evidence

- **Option B per-line queue.** In hybrid, `partitionWritesByMode` returns every
  staged verdict as `queue`, not `commit` (`runModes.ts:52-64`, hybrid case
  `:59-60`); the writes land in `pendingCommits` and wait for the
  HybridGatePanel (`useWorkspaceStore.ts:5927-5938`). This gate is DELIBERATE:
  the staged path lacks Option A's verified two-pass rigour, so the per-line
  human review is its compensating control (`runModes.ts:45-51`). Making the
  first pass auto-commit means routing hybrid Option B through the full-auto
  commit path.
- **Option A compile click.** Option A verdicts already commit immediately in
  hybrid (`partitionOptionAWrites` maps hybrid to full-auto, `runModes.ts:82-87`),
  but findings wait for the human's "Compile findings" click
  (`PPDReview.tsx:1176-1178` -> `compileEvidenceFindings`). Auto-drafting means
  calling compile automatically.
- **The band.** Same as Change 1 — the first-pass draft "including the band"
  requires the auto-score, so Change 2 CONTAINS Change 1 and inherits all of
  its safety implications in full.

### Safety implications

Change 2 is Change 1 plus removing Option B's per-line gate for the first pass.
That gate exists precisely because staged verdicts "can be uncited or carry
unverified excerpts" (`runModes.ts:48-51`, `stagedWriteConfidence`
`:92-108`). Auto-committing them on the first pass means the draft Final Report
can contain unreviewed, possibly-uncited verdicts AND an AI-set band derived
from them — two compounding "AI decides" steps with no human between evidence
and certification score. The diagram's own answer is "human judgement lives in
the refinement" (the iterate loop, Change 3) rather than in blocking — that is
a coherent philosophy, but it is a DIFFERENT philosophy from the one every
safety gate in this codebase was built to enforce.

### What would need to happen to build this safely, if at all

All of Change 1's (a) to (d), PLUS: the draft must mark every auto-committed
Option B verdict as unreviewed (reuse `stagedWriteConfidence`'s
`lowConfidence`/`reason`, `runModes.ts:92-108`, which already exists and is
currently shown at the gate) and surface that "N verdicts not yet reviewed"
prominently on the draft Final Report, so a draft is never mistaken for a
reviewed result. Same STOP applies.

---

## Change 3 (LOW RISK, no scoring): the Hybrid iterate loop

### What the diagram asks

After the first draft, jump back into any module, adjust, re-run just that
piece, and see the Final Report update, repeatably (target-audit-flow.html:104-118).

### What is in the way, with evidence

Very little. Almost every piece already exists:

- **Re-run buttons** already exist per module: "Re-run PPD review" and "Re-run
  evidence assessment" (Option A, `PPDReview.tsx`), per-row "Run audit"
  (Option B), "Re-run Outcomes & Review pass" (`PPDReview.tsx` OutcomeReviewPanel),
  and the band suggestion regenerate (`suggestBand`,
  `useChecklistModuleStore.ts:244`).
- **Regenerate buttons** on the Final Report already exist and are
  generate-once-and-save: "Generate AI summary", "Generate AI improvement
  suggestions", "Write concise summaries" (`FinalReport.tsx`).
- **Live report recalculation** already happens: `buildFinalReport` runs in a
  `useMemo` over `scored`/`entries`/`findings`/`closures`
  (`FinalReport.tsx:39`), and `useScored` recomputes overrides and score on
  every relevant change (`src/hooks/useScored.ts:21-24`). Any edit to a
  checklist line, finding, or band re-lands on an updated report with no extra
  plumbing.

So the "iterate" capability is 90 percent present. What is missing is not
engine work but WORKFLOW GLUE: a clear "you are iterating a draft" affordance —
for example a persistent link from the Final Report back to each module, and a
signal that a module's inputs changed since the last report view. This is
presentational and touches no scoring, no write-gate, no invariant.

### Safety implications

None to certification scoring. Re-running a module uses the existing gated
write paths unchanged; the report already recalculates from committed state.
The only cost is AI calls (below), which the diagram already flags as expected.

### What would need to happen to build this

A normal build task: add navigation affordances (report-to-module links,
"inputs changed, re-run to refresh" hints) and optionally a lightweight
"draft vs reviewed" status marker. No new engine, no scoring change. This can
proceed as an ordinary proposal without the Change 1/2 decision.

---

## Cost implications (per the O/R investigation's method)

Reusing the call-count method from
docs/optionA-plus-outcome-review-investigation.md (windows x ceil(points/8)
per staged pass; one analysis call for a band suggestion):

- **Full Auto today, per sub-criterion:** Option A = PPD pass + Evidence pass
  (each windowed); Option B = 3 staged passes (policy, evidence,
  outcome/review), each windowed. Roughly a handful to a couple of dozen calls
  depending on evidence size.
- **Adding the O/R pass (the diagram's "Outcomes & Review runs + applies" for
  Full Auto, needed only on Option A rows — Option B already runs it as its
  third staged pass):** +1 windowed pass per Option A sub-criterion, on the
  order of 2 to 4 calls for small evidence up to roughly 10 to 20 for large
  evidence (the O/R investigation's own figure).
- **Adding band auto-score:** +1 analysis call PER ITEM (one
  `runHolisticBandSuggestion` each). A sub-criterion holds 1 to 3 items, so +1
  to 3 calls per sub-criterion.
- **Whole-workspace Full Auto / Hybrid first pass:** the band auto-score alone
  adds one call for every one of the 31 GD4 items (about +31 analysis calls),
  plus the O/R additions on Option A rows. "One click does everything" is
  materially more expensive than today's one click, and the band and O/R
  additions are the new cost. Dollar and latency figures depend on model and
  evidence size and are runtime facts, not derivable from the repo.

---

## STOP — the decision you must make before any band-auto-scoring code

Changes 1 and 2 are not merely features; they invert the safety model this
entire project has been built on. Every prior investigation, the O/R pass, the
consistency invariants, the `setHolisticBand` gates and CLAUDE.md hard rule 3
all encode the SAME promise:

> **Today: the AI recommends, the human decides the certification score.**

Auto-scoring the band in Full Auto and in Hybrid's first pass changes that to:

> **Proposed: the AI decides the certification score, the human can override
> after the fact.**

That is a defensible design for an internal readiness SIMULATION (the tool
never issues an official SSG result), and the diagram's "judgement lives in the
refinement" is a coherent philosophy. But it is a deliberate reversal of the
tool's core contract, not a refactor. **Do not write any code for Change 1 or
Change 2 without the user's direct, explicit confirmation that they want this
philosophy change**, and, if confirmed, only with the honesty safeguards named
in each section (distinct source/decisionType, an unmistakable "AI-scored, not
yet reviewed" mark carried into the report and exports, INV-17 reworded, and
the "AI recommends" wording updated wherever the code currently promises the
opposite).

Change 3 (the iterate loop) carries none of this and may be proposed and built
as an ordinary, scoring-neutral workflow task whenever you want it.
