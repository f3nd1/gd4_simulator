// Converts the Audit Checklist Library's checks into walkthrough questions for
// the Manual audit worksheet export (lib/manualWorksheet.ts).
//
// WHY AN AI PASS AND NOT A DETERMINISTIC TRANSFORM
// The source checks are prose arguments aimed at the model, not structured
// data. Measured across all 155 shipped checks: only 59% open with a bold
// lead-in, the median is 2 sentences / 203 characters, and a cue-word split
// into "procedural" vs "documentary" leaves 46 of them matching neither
// pattern. A rule-based transform can therefore only re-emit the sentence it
// picked, which produces things like "Describe how you: The person who
// approves payments must not be the person who reconciles the bank." — the raw
// instruction with a stem bolted on, which is exactly what the worksheet is
// supposed to stop being. Turning "Audited financials, not management
// accounts…" into "Show me the signed independent external auditor's report
// for both years, with the firm, the date and the opinion" is a rewrite, and a
// rewrite is what a language model is for. The pass also always reflects the
// current text, which matters because these checks are user-editable.
//
// The cost is one AI call per batch of BATCH_SIZE checks at export time, and a
// dependency on AI being configured — the button says so rather than falling
// back to a cruder transform, because a worksheet that quietly reads worse
// than the last one you printed is a trap.
//
// The model REPHRASES ONLY. It is told not to add requirements, and the audit
// content it works from is the check text alone; nothing here reaches a
// prompt, a verdict or a score.

import { chatComplete, effectiveSettings, type ChatSchema } from "./aiClient";
import { sArr, sEnum, sObj, sStr } from "./schemaHelpers";
import type { AISettings } from "../../types";
import type { DomainChecklistRow } from "../domainChecklist";
import { ensureAskStem, newQuestionId, type AskType, type WorksheetQuestion } from "../manualWorksheet";

// Bumped whenever the SYSTEM prompt below changes in a way that should make
// existing questions re-generatable. Stored against each check so a question
// written by an older prompt shows a badge instead of passing as current —
// the staleness hash only tracks the CHECK text, so without this a weak or
// outdated write was invisible until someone read the CSV.
//
// v2: the two failures found in a real export — questions returned as bare
// noun phrases with no ask stem, and the forbidden "describe X" + "show me the
// record of X" pairing appearing on almost every check.
export const WORKSHEET_PROMPT_VERSION = 2;

// Small enough that one malformed reply costs little and progress is visible,
// large enough to keep a full 186-check worksheet to single-figure calls.
export const BATCH_SIZE = 20;

// Batches run concurrently. Safe to do here, and deliberately NOT the pattern
// used by the audit runs: those funnel through useWorkspaceStore's
// module-level singletons (_currentRunAbort, _currentFileAbort, the `busy`
// flag), which are documented as one-run-at-a-time and would cancel each other
// if run in parallel. This path touches no store and no module state at all —
// it takes settings and a signal as arguments and returns a value — and
// aiClient's fetchWithTimeout builds a FRESH AbortController per call, so
// concurrent calls cannot abort one another. 4 keeps well inside browser
// per-host connection limits, and aiClient already backs off on 429.
export const CONCURRENCY = 4;

// Which checks get converted is decided by the caller, not here: the Library
// stores each question against its check and asks only for the ones that are
// missing, stale, or explicitly picked for regeneration. This function does one
// job — convert the rows it is handed.

// A FLAT list of questions per check, each with its own type — not a
// {describe, showMe} pair. The pair was the cause of the duplication: both
// halves hung off one ask, so the model was structurally invited to state the
// same audit point twice. Here it emits as many questions as the check
// warrants and types each one.
const WORKSHEET_SCHEMA: ChatSchema = { name: "worksheet_questions", schema: sObj({
  checks: sArr(sObj({
    id: sStr,
    questions: sArr(sObj({ askType: sEnum("Process", "Document"), text: sStr })),
  })),
}) };

const SYSTEM = `You convert an internal audit checklist into a printable walkthrough worksheet.

Each input check is an instruction written AT an AI assessor. Your job is to turn it into the questions a human auditor would ask a member of staff, face to face, during a site visit.

Return a list of questions for each check. Every question has:
- "text": the question itself, addressed to the person.
- "askType": "Process" if you are asking them to describe how something is done, "Document" if you are asking them to produce a record.

HARD RULES
1. NEVER SAY THE SAME THING TWICE. Do not pair a "describe how you do X" question with a "show me the record of X" question about the same point. Pick the ONE that actually tests it: if the control is proved by a record, ask for the record; if it is proved by how people behave, ask them to describe it. Two questions may only cover the same subject when they test genuinely different things.
2. AS MANY QUESTIONS AS THE CHECK WARRANTS, no more. A narrow check gets one question. A rich check covering several distinct obligations gets one per obligation, typically up to four. Never pad a simple check to hit a number, and never compress a rich one into a single question.
3. REPHRASE ONLY. Never add a requirement, threshold, document type, date or authority that is not in the check you were given. Never soften or drop one either.
4. KEEP THE SPECIFICS. The question must still name the exact thing that would constitute a finding: the named document, the number ("at least 7 working days"), the sequencing ("dated before the contract"), the separation ("evidencing role separation"), the authority ("approved by the Academic Board"). A question that reads as a generic prompt has failed.
5. GUIDANCE PARAGRAPHS. Some checks are band-level guidance rather than an ask (they discuss what separates a Band 3 from a Band 4). For these, return the concrete questions the paragraph implies, usually asking for the analysis itself and for what changed as a result. Drop the band commentary; the auditor does not read banding theory aloud.
6. Address the person, not the file. "Describe how you verify…" or "Show me…", not "The PEI must verify…".
7. British spelling. No em dashes. Keep each question under about 45 words.

8. EVERY question is a COMPLETE SENTENCE that starts with the ask. Several checks are expected-evidence lists written as "**3.1.1 Selection & Appointment:** agent selection records, signed agreements, an up-to-date agent list". Drop the bold label and ASK for the list: "Show me the agent selection records, the signed agreements and the up-to-date agent list." Never return the list on its own — a question that starts "the agent agreements." is not a question.

Return every input id exactly once, in the order given.

## Before you answer, re-read these two (they are the ones most often broken)
- ONE question per audit point. If a record proves it, ask for the record and do NOT also ask them to describe it. "Describe how the risk register has named owners and review dates" followed by "Show me the risk register showing named owners and review dates" is ONE point asked twice, and is wrong.
- Every question starts with the ask ("Show me…", "Describe how you…"), never with the object of the ask.`;

function userBlock(rows: DomainChecklistRow[]): string {
  return rows
    .map((r) => `--- id: ${r.id}\nsection: ${r.sectionKey}\nrefs: ${r.subCriterionIds.join(" ") || "(criterion-wide)"}\ncheck: ${r.text}`)
    .join("\n\n");
}

export type WorksheetProgress = { done: number; total: number };

// Returns asks keyed by source check id. A batch whose reply cannot be parsed
// is reported in `failed` rather than silently yielding no questions, so the
// caller can tell "the model returned nothing for these" apart from "these had
// nothing to ask".
export async function runWorksheetConversion(
  rows: DomainChecklistRow[],
  settings: AISettings,
  opts: { onProgress?: (p: WorksheetProgress) => void; signal?: AbortSignal } = {},
): Promise<{ questionsById: Map<string, WorksheetQuestion[]>; failed: string[] }> {
  const questionsById = new Map<string, WorksheetQuestion[]>();
  const failed: string[] = [];

  const batches: DomainChecklistRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  // ANALYSIS, not utility. This ran on the utility model, which defaults to
  // the smallest one available, and it showed: seven hard rules across a
  // 20-check batch is more instruction-following than that model sustains, and
  // the rules at the bottom of the prompt were the ones dropped. It is a
  // rewriting task with real constraints, not a formatting chore.
  const call = effectiveSettings(settings, { purpose: "analysis" });
  let done = 0;

  const runBatch = async (batch: DomainChecklistRow[]) => {
    // Cancel must stop batches still queued behind the in-flight ones, not
    // just abort the requests already open.
    if (opts.signal?.aborted) { for (const r of batch) failed.push(r.id); return; }
    try {
      const reply = await chatComplete(
        [{ role: "system", content: SYSTEM }, { role: "user", content: userBlock(batch) }],
        call,
        { temperature: 0.2, schema: WORKSHEET_SCHEMA, signal: opts.signal },
      );
      const parsed = JSON.parse(reply) as { checks?: { id?: string; questions?: { text?: string; askType?: string }[] }[] };
      const inBatch = new Set(batch.map((r) => r.id));
      const seen = new Set<string>();
      for (const c of parsed.checks ?? []) {
        // An id the model invented, or one belonging to another batch, is
        // dropped rather than stored against a check it was not written for.
        if (!c?.id || !Array.isArray(c.questions) || !inBatch.has(c.id)) continue;
        seen.add(c.id);
        questionsById.set(c.id, c.questions
          .map((q) => ({
            id: newQuestionId(),
            // Deterministic backstop for HARD RULES 6/8 — see ensureAskStem.
            text: ensureAskStem(String(q?.text ?? ""), (q?.askType === "Process" ? "Process" : "Document")),
            // Anything the model returns outside the two allowed values is
            // read as a documentary ask rather than stored as a junk tag.
            askType: (q?.askType === "Process" ? "Process" : "Document") as AskType,
            source: "ai" as const,
          }))
          .filter((q) => q.text !== ""));
      }
      for (const r of batch) if (!seen.has(r.id)) failed.push(r.id);
    } catch {
      for (const r of batch) failed.push(r.id);
    }
    done += batch.length;
    opts.onProgress?.({ done, total: rows.length });
  };

  // Fixed-size worker pool: each worker pulls the next batch as it frees up,
  // so a slow batch does not stall the others behind a wave boundary.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]);
    }),
  );

  return { questionsById, failed };
}
