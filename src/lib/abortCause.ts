// Why was a file read aborted?
//
// AbortSignal carries no reason of its own here, so every abort looked the same
// at the catch. The staged loop tested `fileAbort.signal.aborted` BEFORE the
// FILE_TIMEOUT sentinel, and the timeout handler aborts before it rejects, so
// the aborted branch always won and every system timeout was written to the
// evidence ledger as "Skipped by user" — making its `Timed out after Xs` branch
// unreachable. The sweep's per-item timeout was mis-attributed the same way in
// BOTH read loops, and the Option A loop recorded every remaining file as a
// "Drive read error" it never had.
//
// The ledger is the authoritative record of what a run actually read and is
// exported to CSV, so telling a user they skipped files they never touched is
// a data-integrity problem, not a wording one. Aborts now carry a cause and one
// helper turns it into the recorded reason.

export type AbortCause = "user-skip" | "run-cancel" | "timeout" | "sweep-timeout";

const NAME_BY_CAUSE: Record<AbortCause, string> = {
  "user-skip": "UccUserSkip",
  "run-cancel": "UccRunCancel",
  timeout: "UccFileTimeout",
  "sweep-timeout": "UccSweepTimeout",
};

// Built as a DOMException so it travels as AbortSignal.reason, the same idiom
// timeoutSignal already uses in aiClient.
export function abortReason(cause: AbortCause, message: string): DOMException {
  return new DOMException(message, NAME_BY_CAUSE[cause]);
}

export function abortCauseOf(reason: unknown): AbortCause | null {
  const name = (reason as { name?: string } | null | undefined)?.name;
  for (const [cause, n] of Object.entries(NAME_BY_CAUSE)) {
    if (name === n) return cause as AbortCause;
  }
  return null;
}

// What the file ledger records. `err` is the rejection the read loop caught;
// the FILE_TIMEOUT sentinel is still honoured for aborts raised before a cause
// was attached, so an older path degrades to "timed out" rather than to a false
// user skip.
export function skipReasonForCause(cause: AbortCause, timeoutSeconds: number): string {
  switch (cause) {
    case "timeout": return `Timed out after ${timeoutSeconds}s`;
    case "sweep-timeout": return "Sub-criterion hit the full-audit time limit before this file was read";
    case "run-cancel": return "Audit was cancelled before this file was read";
    case "user-skip": return "Skipped by user";
  }
}

export function skipReasonForAbort(
  signalReason: unknown,
  err: unknown,
  timeoutSeconds: number,
): string {
  const cause = abortCauseOf(signalReason);
  if (cause) return skipReasonForCause(cause, timeoutSeconds);
  if (err instanceof Error && err.message === "FILE_TIMEOUT") return `Timed out after ${timeoutSeconds}s`;
  return "Skipped by user";
}
