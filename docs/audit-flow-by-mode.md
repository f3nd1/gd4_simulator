# The real audit flow, upload to Final Report, by mode

Investigation and reporting only. No application logic, data or config was
changed. Every step cites the file:line where the code actually does it. UK
spelling, no em dashes.

**Commit analysed:** `b76901266748c7a4353eb3a543362d48cfe257be` (local HEAD
confirmed equal to origin/main before analysis, clean tree).

See docs/target-audit-flow.html for the proposed target design this
current-state doc will be compared against.

---

## Correcting the mental model first

Your three guesses, against the actual code:

**Guess 1: "Upload files in Evidence Folder, where they are read and
processed."** Half right. Files are not uploaded into the app at all: they
live in your Google Drive, and the Evidence Folder page only LINKS a Drive
folder (or separate policy/evidence links) to each sub-criterion (stored on
the folder record, `useWorkspaceStore.ts` folders state; bucket routing by
top-level subfolder name, `src/lib/driveGuard.ts` `classifyFileBucket`).
Nothing is read or analysed at link time. Reading and processing happen only
when a RUN is triggered: the run lists the folder, downloads and extracts
each file's text (cached in `fileTextCache`, e.g. the Option A read loops at
`useWorkspaceStore.ts:1327/1758` and the staged reader at `:5292-5344`), and
sends it to the AI passes.

**Guess 2: "Findings go to the Sub-Criterion Checklist - correct? Does it
also go to Findings at this point?"** Terminology correction that unlocks the
whole picture: what a run writes to the Sub-Criterion Checklist is NOT
findings - it is per-requirement-line VERDICTS plus an attached audit
evidence record (status, sufficiency, APSR legs, comments: the
`ChecklistLineWrite` shape, applied by
`useChecklistModuleStore.applyOptionAWrites`). Register Findings are a
SEPARATE, later step, created from those verdicts by an explicit raise
action: `raiseAllUnmetFindings` and/or `compileEvidenceFindings`. WHEN that
step runs is exactly what the mode controls: automatically right after the
verdicts commit in Full auto (`useWorkspaceStore.ts:1701-1704` for Option A,
`:5948-5950` for Option B); after your per-line approval (Option B) or your
Compile click (Option A) in Hybrid; never automatically in Manual.

**Guess 3: "At the Sub-Criterion Checklist, is it analysed again using the
rubric? Does the result go to Findings or straight to Final Report?"** No
re-analysis happens on the checklist. The checklist STORES the upstream
verdicts unchanged. "The rubric" appears there in a different role: the
official §23 APSR band matrix, which is a human decision (you pick the four
dimension scores, with an on-request AI suggestion, and save with a written
justification via `setHolisticBand`, `useChecklistModuleStore.ts:197` - the
only writer of a band). That saved matrix flows to scoring
(`computeChecklistOverrides` -> `buildScored`, `src/hooks/useScored.ts:21-24`)
and thence to the Final Report. The Final Report reads BOTH the checklist
entries AND the Findings register (see question 4 below) - not one or the
other.

---

## The pipeline in one picture

```
Google Drive files
      | (link folder - no analysis yet)
Evidence Folder page (per sub-criterion, per-row Option A or B choice)
      | (RUN - trigger depends on mode)
AI passes -> run RESULTS stored first:
      Option A: ppdReviewResults + evidenceAssessments
      Option B: staged coverage rows -> buildStagedApsr
      | (write-back - THIS is what the mode gates)
Sub-Criterion Checklist: line verdicts + audit evidence records (APSR legs)
      |                          |
      | (raise/compile -         | (human judges the §23 APSR matrix,
      |  mode-gated)             |  AI suggestion on request, saves with
      v                          v  justification - setHolisticBand)
Findings register          holisticBand.matrixScores
(customFindings)                 |
      |                    computeChecklistOverrides -> buildScored
      |                          |
      +----------> FINAL REPORT <+   (buildFinalReport reads scored +
                                      checklist entries + findings)
```

Mode (Start Audit page, `src/lib/runModes.ts:1-31`) controls ONLY: how runs
are triggered (one sweep vs per-row), whether verdict write-backs commit or
queue for approval, and whether findings raise automatically. It never
changes what the engines assess (that is the per-row Option A/B choice), and
it never sets a band (that is always the human matrix).

---

## Full Auto, step by step

1. **Link folders.** You put files in Drive and paste the folder link per
   sub-criterion on the Evidence Folder page. Writes the folder record only;
   no reading, no analysis. Human action, all modes identical.
2. **One click: "Run full audit".** Per-card run buttons are LOCKED in this
   mode (`EvidenceFolder.tsx:2871-2879` renders a disabled button); the
   single sweep (`runFullAudit`, `EvidenceFolder.tsx:2050`) runs every
   sub-criterion by its per-row Option A/B path choice (`analysisPath`).
3. **Engines read and assess.** Files are listed, extracted and cached
   (`fileTextCache`); Option A runs PPD then Evidence passes, storing
   results in `ppdReviewResults`/`evidenceAssessments` FIRST; Option B runs
   the three staged passes and builds four-leg APSR verdicts
   (`buildStagedApsr`, `agentRuntime.ts:1890`). No human gate.
4. **Verdicts write to the checklist automatically.** Option A:
   `partitionOptionAWrites` -> full-auto commits everything
   (`runModes.ts:52-64,82-87`), applied by `applyOptionAWrites`
   (`useWorkspaceStore.ts:1687`). Option B: `partitionWritesByMode` ->
   commit all (`useWorkspaceStore.ts:5925-5926`). This writes/updates
   checklist LINES: status, evidence record, APSR legs. No human gate.
5. **Findings raise automatically.** Option B: `raiseAllUnmetFindings(runId)`
   fires right after the commit, gated on `automationMode === "full-auto"`
   (`useWorkspaceStore.ts:5948-5950`). Option A: `compileEvidenceFindings`
   fires in the run's finish (`useWorkspaceStore.ts:1701-1704`). These create
   register Findings (`customFindings`) deduplicated against existing ones.
   No human gate in this mode.
6. **You still set every band.** Nothing in any mode automates the §23
   matrix: you open the Sub-Criterion Checklist, optionally run the AI band
   suggestion, and save the four-dimension matrix with a written
   justification (`setHolisticBand`, `useChecklistModuleStore.ts:197` - the
   complete-matrix and justification gates live here). Human gate, always.
7. **Final Report renders.** `useScored` derives bands from your saved
   matrices (`useScored.ts:21-24`); `buildFinalReport(scored, entries,
   findings, closures)` combines scoring, checklist entries (the findings
   table, APSR groups) and the Findings register (folded per item)
   (`FinalReport.tsx:27-39`, `finalReport.ts:399`). Read-only derivation on
   every render; the optional AI extras (executive summary, improvement
   suggestions, concise summaries) are separate on-demand buttons.

## Hybrid, step by step

Steps 1, 3, 6 and 7 are IDENTICAL to Full auto. The differences:

2. **Per-row trigger.** You click each row's own run button (Option A "Run
   review" / Option B "Run audit", `EvidenceFolder.tsx:2595-2600`); there is
   no forced single sweep.
4a. **Option A verdicts still commit immediately** - the per-line gate was
   deliberately removed for this path because its two-pass pipeline carries
   deterministic quote verification (`partitionOptionAWrites` maps hybrid to
   full-auto, `runModes.ts:66-87`; the intentional-divergence comment
   explains why). Your control is the checklist card's editable verdict.
4b. **Option B verdicts QUEUE instead of committing.** `partitionWritesByMode`
   returns everything as queue in hybrid (`runModes.ts:59-60`); the writes
   land in `pendingCommits` (`useWorkspaceStore.ts:5927-5938`) and the
   HybridGatePanel shows them one by one beside their evidence. HUMAN GATE:
   each Accept (or per-line override) applies that single write
   (`resolvePendingItem`, `useWorkspaceStore.ts:2707`) and logs the decision.
5. **Findings wait for you.** Option B: each approval raises that line's
   findings (`raiseAllUnmetFindings` at `useWorkspaceStore.ts:2756`,
   `:2710`). Option A: findings are raised only when you click "Compile
   findings" on the Evidence tab (`handleCompile` ->
   `compileEvidenceFindings`, `PPDReview.tsx:1176-1178`) - this click is
   exactly what keeps Hybrid distinct from Full auto on the A path.

Identical in both modes regardless: the per-row Option A/B choice itself,
the on-demand "Also assess Outcomes & Review" pass (its explicit Apply gate
applies in ALL modes by design), the band matrix (always human), and all the
Final Report AI buttons (always on-demand).

## Full Manual, step by step

1. **Link folders** - same as above.
2. **No engine writes anything.** The Evidence Folder card's run button is
   replaced by "Open checklist →" (`EvidenceFolder.tsx:2879-2886`); if an
   engine run does execute, `partitionWritesByMode` maps manual to "nothing
   commits, nothing queues" (`runModes.ts:61-62`), so results stay on the
   review surfaces as suggestions only (`useWorkspaceStore.ts:1678-1681`
   comment: manual commits nothing).
3. **You enter verdicts by hand** on the Sub-Criterion Checklist: line
   statuses, evidence records, sufficiency. AI helps only on request
   (generate checklist lines, per-line suggestions, the band suggestion).
4. **You raise findings by hand**: the checklist's per-line raise-finding
   flow (`confirmDraftFinding`) or the manual finding form. Nothing
   auto-compiles.
5. **Band matrix and Final Report** - identical to the other modes (steps 6
   and 7 above).

**What still happens automatically even in Manual:** text extraction and
caching whenever any read executes (a pre-flight probe, a suggestion
request, the Pre-check detections) - extraction is infrastructure, not
judgement; the Pre-check advisory flags; scoring/report derivation from
whatever you have entered. What never happens in Manual: checklist writes
from engines, automatic findings, any band movement.

---

## The six specific questions, answered

1. **Does processing write directly to the checklist?** No. Both paths write
   run RESULTS first (Option A: `ppdReviewResults` then
   `evidenceAssessments`; Option B: staged coverage rows), and a separate
   write-back step maps those onto checklist lines
   (`buildOptionALineWrites` -> `applyOptionAWrites`;
   `partitionWritesByMode` -> `applyOptionAWrites`). The mode gates only the
   write-back, never the results storage - which is why Manual still shows
   full review results that simply go no further.
2. **When is a register Finding created?** Only by the raise/compile actions,
   never as a side effect of a checklist write itself. Full auto: raised
   automatically right after commit (A: `useWorkspaceStore.ts:1701-1704`;
   B: `:5948-5950`). Hybrid: on your per-line approval (B, `:2756`) or your
   Compile click (A, `PPDReview.tsx:1176-1178`). Manual: only by your own
   raise action.
3. **Does the checklist re-analyse against the rubric?** No. It stores the
   upstream requirement-line verdicts unchanged. The §23 rubric enters twice,
   in two different senses: upstream, the AI passes judge each line
   pass/fail against the requirement text (that is not the band rubric);
   on the checklist, the BAND rubric (the four-dimension APSR matrix) is a
   human selection saved via `setHolisticBand` - the only path to a band -
   which `computeChecklistOverrides` turns into the item's score.
4. **What does the Final Report read?** Both, plus scoring:
   `buildFinalReport(scored, entries, findings, closures)`
   (`FinalReport.tsx:39`, builder at `finalReport.ts:399`) - `scored` (from
   your saved matrices via `useScored.ts:21-24`) for bands and totals,
   checklist `entries` for the per-dimension findings table, and the
   `findings` register (via `useAllFindings`, `FinalReport.tsx:29`) for the
   per-item findings folds.
5. **Hybrid's exact pauses vs Full auto:** pauses at (i) each Option B line
   verdict (queue + HybridGatePanel approval) and (ii) the Option A findings
   compile (your click). Identical to Full auto at: Option A verdict
   commits, the per-row A/B choice, the Outcomes & Review pass Apply gate,
   the band matrix, and everything on the Final Report.
6. **Manual's automatic parts:** text extraction/caching and Pre-check
   detection still run when triggered; run results still store; scoring and
   the report still derive live. Everything judgement-bearing (checklist
   writes, findings, bands) is yours alone.

One repo-only limit stated plainly: whether a given entry point (e.g. a
deep-linked review modal) lets a Manual-mode user start an engine run is a
UI-reachability question across many components; what is certain from the
code is that even if such a run executes, `runModes.ts:61-62` discards its
checklist writes in Manual.
