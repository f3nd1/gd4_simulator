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
import type { WorksheetAsk } from "../manualWorksheet";

// Small enough that one malformed reply costs little and progress is visible,
// large enough to keep a full 155-check worksheet to single-figure calls.
export const BATCH_SIZE = 20;

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

export type WorksheetProgress = { done: number; total: number };

// Returns asks keyed by source check id. A batch whose reply cannot be parsed
// is reported in `failed` rather than silently yielding no questions, so the
// caller can tell "the model returned nothing for these" apart from "these had
// nothing to ask".
export async function runWorksheetConversion(
  rows: DomainChecklistRow[],
  settings: AISettings,
  opts: { onProgress?: (p: WorksheetProgress) => void; signal?: AbortSignal } = {},
): Promise<{ asksById: Map<string, WorksheetAsk[]>; failed: string[] }> {
  const asksById = new Map<string, WorksheetAsk[]>();
  const failed: string[] = [];
  const batches: DomainChecklistRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  const call = effectiveSettings(settings, { purpose: "utility" });
  let done = 0;
  for (const batch of batches) {
    try {
      const reply = await chatComplete(
        [{ role: "system", content: SYSTEM }, { role: "user", content: userBlock(batch) }],
        call,
        { temperature: 0.2, schema: WORKSHEET_SCHEMA, signal: opts.signal },
      );
      const parsed = JSON.parse(reply) as { checks?: { id?: string; asks?: WorksheetAsk[] }[] };
      const seen = new Set<string>();
      for (const c of parsed.checks ?? []) {
        if (!c?.id || !Array.isArray(c.asks)) continue;
        seen.add(c.id);
        asksById.set(c.id, c.asks.map((a) => ({ describe: String(a?.describe ?? ""), showMe: String(a?.showMe ?? "") })));
      }
      for (const r of batch) if (!seen.has(r.id)) failed.push(r.id);
    } catch {
      for (const r of batch) failed.push(r.id);
    }
    done += batch.length;
    opts.onProgress?.({ done, total: rows.length });
  }
  return { asksById, failed };
}
