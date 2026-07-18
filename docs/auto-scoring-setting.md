# The "Auto-score bands" setting, in plain English

This page explains the setting "Auto-score bands in Full Auto / Hybrid draft"
on the GD4 Scoring Setup page: what it does, what it never does, and how to
tell an AI-scored band from one you set yourself.

## What it does and does not do

- **What it does (when ON):** during a fully automatic run (a Full Auto sweep,
  or the planned Hybrid "first draft" run), the app may fill in an item's band
  by itself, using the AI's suggested scores for the four dimensions
  (Approach, Processes, Systems & Outcomes, Review) and the AI's own written
  reasoning as the justification. The band appears on the report straight
  away, clearly labelled as AI-scored.
- **What it never does:** it never changes a band you have already saved. It
  never stops you opening any band and changing it. It never affects bands you
  set yourself on the Sub-Criterion Checklist - those are yours, exactly as
  before, whatever this setting says. Turning the setting off later leaves any
  AI-scored bands (and their labels) exactly as they are; it only changes what
  FUTURE automatic runs do.

## The default is OFF, and why

Off means what the tool has always meant: the AI recommends, and **you** decide
every certification band, with a written justification, before it counts. That
is the safe default because the band is the score that feeds the certification
result - the one number where a wrong AI guess matters most. The setting stays
off for every new and existing workspace until you deliberately turn it on,
and turning it on always asks you to confirm first - it can never switch on
silently.

## Exactly what changes when it is ON

- **The write path:** the band is still saved through the same single gate
  every band goes through (the save that requires all four dimensions scored
  and a written justification - neither check is loosened). The difference is
  the save is marked as made by the AI automatically, not by you.
- **The justification:** the AI's own written reasoning (the same text you see
  when you ask for a band suggestion) is stored as the justification. The
  "every band must carry a written justification" rule is still enforced; what
  changes is who wrote it.
- **The record:** the Human Decision Log entry for an auto-scored band says an
  AI decision was made automatically. It is never recorded as if you had
  clicked save - an AI save and a human save are always distinguishable in
  the log and in the stored data.
- **The label:** every place the band appears (the Sub-Criterion Checklist,
  the Final Report, the scorecard, exports) shows a clear "AI-scored, not yet
  reviewed" label on a band the AI set.

## What makes the label disappear

One thing only: **you** open that item's band matrix on the Sub-Criterion
Checklist and save it yourself (either accepting the AI's scores or choosing
your own). That save is recorded as your decision and the label clears.
The label never disappears on its own - not with time, not by viewing the
page, not by re-running anything automatically.

## The philosophy point, stated honestly

Everything in this tool was built on one promise: *the AI recommends, a human
decides the certification score.* This setting, when on, deliberately flips
that for automatic runs: *the AI decides, and the human reviews and corrects
afterwards instead of before.* That can be the right trade for your workflow -
a complete draft in one click, refined afterwards - because this is an
internal readiness simulation, never an official SSG result. But it is a real
change of who decides, which is why it is off by default, needs an explicit
confirmation to enable, and marks every band it touches until you have
personally reviewed it. (Background: docs/target-flow-gap-analysis.md.)

## How to tell if a band was auto-scored

Look for the "AI-scored, not yet reviewed" label:

- On the **Sub-Criterion Checklist**, next to the saved band on the item's
  band panel (where a band you saved says it was set by the reviewer).
- On the **Final Report**, beside that item's band.
- In **exports** that include bands.
- In the **Human Decision Log**, the entry for that band says the decision
  was made automatically by the AI, not by a named human action.

If you see the label, the AI set that band and nobody has confirmed it yet.
Open the item's band matrix, check the four dimension scores against the
evidence, and save - the band then becomes yours and the label goes.

## Current status

Built so far: this setting and its confirmation dialog, the AI-vs-human
record keeping (an automatic save is stored and logged as "Automatic", never
as a human decision), and the "AI-scored, not yet reviewed" labels on the
Sub-Criterion Checklist, Final Report, Criterion Scorecard, and Export
Centre (page and exported pack). Still to come: the fully automatic "one
click runs everything including the band" flow this setting governs. Until
that flow lands, no automatic run sets a band regardless of this setting,
so turning it on has no effect yet beyond recording your choice. This
section will be updated when that flow ships.
