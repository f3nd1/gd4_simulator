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
import { sArr, sObj, sStr } from "./schemaHelpers";
import type { AISettings } from "../../types";
import type { DomainChecklistRow } from "../domainChecklist";
import { worksheetCacheKey, type WorksheetAsk } from "../manualWorksheet";

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

// Bump when SYSTEM changes: it is folded into every cache key, so a reworded
// prompt invalidates cached questions instead of leaving a worksheet that is
// half old wording and half new.
export const PROMPT_VERSION = "v1";

const WORKSHEET_SCHEMA: ChatSchema = { name: "worksheet_questions", schema: sObj({
  checks: sArr(sObj({
    id: sStr,
    asks: sArr(sObj({ describe: sStr, showMe: sStr })),
  })),
}) };

const SYSTEM = `You convert an internal audit checklist into a printable walkthrough worksheet.

Each input check is an instruction written AT an AI assessor. Your job is to turn it into the question a human auditor would ask a member of staff, face to face, during a site visit.

For each check return one or more "asks". Each ask has two halves:
- "describe": the procedural question, phrased as an ask to the person — "Describe how you…", "Walk me through…", "Who approves…".
- "showMe": the documentary question — "Show me…" followed by the specific records, naming them.

HARD RULES
1. REPHRASE ONLY. Never add a requirement, threshold, document type, date or authority that is not in the check you were given. Never soften or drop one either.
2. KEEP THE SPECIFICS. The question must still name the exact thing that would constitute a finding: the named document, the number ("at least 7 working days"), the sequencing ("dated before the contract"), the separation ("evidencing role separation"), the authority ("approved by the Academic Board"). A question that reads as a generic prompt has failed.
3. LEAVE A HALF GENUINELY BLANK. If a check is purely documentary, return "" for describe. If purely procedural, return "" for showMe. Do NOT invent filler to fill a cell.
4. SPLIT ONLY REAL SPLITS. If a check contains two genuinely distinct asks (for example a record-keeping PROCESS and a certified STATEMENT), return two asks. If it is one ask, return one. Do not pad.
5. GUIDANCE PARAGRAPHS. Some checks are band-level guidance rather than a single ask (they discuss what separates a Band 3 from a Band 4). For these, return the 1-2 most concrete questions the paragraph implies — usually "show me the analysis" and "show me what changed as a result". Drop the band commentary itself; the auditor does not read banding theory aloud.
6. Address the person, not the file. "Describe how you verify…", not "The PEI must verify…".
7. British spelling. No em dashes. Keep each half under about 45 words.

Return every input id exactly once, in the order given.`;

function userBlock(rows: DomainChecklistRow[]): string {
  return rows
    .map((r) => `--- id: ${r.id}\nsection: ${r.sectionKey}\nrefs: ${r.subCriterionIds.join(" ") || "(criterion-wide)"}\ncheck: ${r.text}`)
    .join("\n\n");
}

export type WorksheetProgress = { done: number; total: number; cached: number };

// Returns asks keyed by source check id. A batch whose reply cannot be parsed
// is reported in `failed` rather than silently yielding no questions, so the
// caller can tell "the model returned nothing for these" apart from "these had
// nothing to ask".
export async function runWorksheetConversion(
  rows: DomainChecklistRow[],
  settings: AISettings,
  opts: {
    onProgress?: (p: WorksheetProgress) => void;
    signal?: AbortSignal;
    cache?: Record<string, WorksheetAsk[]>;
    onCache?: (next: Record<string, WorksheetAsk[]>) => void;
  } = {},
): Promise<{ asksById: Map<string, WorksheetAsk[]>; failed: string[]; generated: number; cached: number }> {
  const asksById = new Map<string, WorksheetAsk[]>();
  const failed: string[] = [];
  const cache = opts.cache ?? {};
  const fresh: Record<string, WorksheetAsk[]> = {};

  // Cache pass first: anything whose source text is byte-identical to a
  // previous conversion is reused, so only genuinely changed or new checks
  // reach the model.
  const todo: DomainChecklistRow[] = [];
  for (const r of rows) {
    const hit = cache[worksheetCacheKey(PROMPT_VERSION, r.text)];
    if (hit) asksById.set(r.id, hit);
    else todo.push(r);
  }
  const cached = rows.length - todo.length;

  const batches: DomainChecklistRow[][] = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));

  const call = effectiveSettings(settings, { purpose: "utility" });
  let done = cached;
  opts.onProgress?.({ done, total: rows.length, cached });

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
      const parsed = JSON.parse(reply) as { checks?: { id?: string; asks?: WorksheetAsk[] }[] };
      const byId = new Map(batch.map((r) => [r.id, r]));
      const seen = new Set<string>();
      for (const c of parsed.checks ?? []) {
        if (!c?.id || !Array.isArray(c.asks)) continue;
        const source = byId.get(c.id);
        if (!source) continue;
        seen.add(c.id);
        const asks = c.asks.map((a) => ({ describe: String(a?.describe ?? ""), showMe: String(a?.showMe ?? "") }));
        asksById.set(c.id, asks);
        fresh[worksheetCacheKey(PROMPT_VERSION, source.text)] = asks;
      }
      for (const r of batch) if (!seen.has(r.id)) failed.push(r.id);
    } catch {
      for (const r of batch) failed.push(r.id);
    }
    done += batch.length;
    opts.onProgress?.({ done, total: rows.length, cached });
  };

  // Fixed-size worker pool: each worker pulls the next batch as it frees up,
  // so a slow batch does not stall the others behind a wave boundary.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]);
    }),
  );

  if (Object.keys(fresh).length > 0) opts.onCache?.(fresh);
  return { asksById, failed, generated: todo.length - failed.length, cached };
}
