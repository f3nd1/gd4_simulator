// Is a run still the one the app is waiting on?
//
// The full-audit sweep gives each sub-criterion a time limit. On timeout it
// aborts the run's controller and moves straight to the next item WITHOUT
// awaiting the loser and WITHOUT bumping auditRunToken — deliberately, because
// bumping the token is the user-cancel signal and would end the whole sweep.
// So the timed-out run kept executing: its non-AI phases (Drive listing, file
// downloads, vision calls) only ever checked the token, which had not changed.
// It could then clear the NEXT run's busy flag, overwrite its progress overlay,
// reassign the module-level file-abort used by Skip and Cancel, and commit a
// run record marked "completed".
//
// auditRunToken alone cannot express "this specific run is dead but the sweep
// continues", so runs now also carry a generation. abortActiveRun increments
// it, which makes exactly the aborted run stale while leaving the sweep's token
// untouched.
//
// Pure and separate from the store so the truth table is testable: the store
// cannot be imported by a test (driveClient builds a pdfjs Worker at load).

export function isStaleRun(
  capturedGeneration: number,
  currentGeneration: number,
  signal?: { aborted: boolean },
): boolean {
  return capturedGeneration !== currentGeneration || signal?.aborted === true;
}
