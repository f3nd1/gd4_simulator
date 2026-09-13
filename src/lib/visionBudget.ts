// The File Ledger note for a file that was left unread because the run's
// vision-image budget ran out.
//
// Two problems this fixes, both reported from real use:
//
// 1. The old wording opened "Scanned PDF — read attempted; …" and only reached
//    the word "Recoverable:" at the end. By then the reader had already
//    concluded the file had failed to read, because the ledger row's status
//    badge says not-read too. It is not a failure: the file is deliberately
//    deferred to cap cost, and it can still be read.
//
// 2. There were two hand-written variants of the same sentence. One told the
//    user to click "Proceed with all", which only exists while the blocking
//    vision-budget prompt is on screen (the Option A read path). On the
//    staged/full paths there is no prompt, so that instruction pointed at a
//    button that was not there. `canResumeNow` makes that mistake structurally
//    impossible: the recovery clause is chosen, never re-typed.
export function visionBudgetSkipNote(kind: "pdf" | "image", maxImages: number, canResumeNow: boolean): string {
  const what = kind === "pdf" ? "scanned PDF" : "image";
  const recovery = canResumeNow
    ? `Click "Proceed with all" on the vision prompt to read it now.`
    : "Re-run to read it.";
  return `Skipped for now — this run's ${maxImages}-image vision budget ran out before this ${what} was read. ${recovery}`;
}
