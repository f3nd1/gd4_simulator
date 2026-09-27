import type { AuditFileRecord } from "../types";

// One phrasing for "this file was read in part", shared by the File Ledger,
// the ledger CSV, the run warnings and the per-line marker, so the four
// surfaces cannot describe the same cap in four different ways.
export function partialReadLabel(p: NonNullable<AuditFileRecord["partialRead"]>): string {
  return `${p.read.toLocaleString()} of ${p.total.toLocaleString()} ${p.kind} read`;
}

/** Files a run read only in part, in ledger order. */
export function partiallyReadFiles(ledger: AuditFileRecord[] | undefined): AuditFileRecord[] {
  return (ledger ?? []).filter((f) => f.partialRead && f.partialRead.read < f.partialRead.total);
}

// The run-warning sentence. Undefined when nothing was capped, so a clean run
// gains no noise.
export function partialReadWarning(ledger: AuditFileRecord[] | undefined): string | undefined {
  const hit = partiallyReadFiles(ledger);
  if (hit.length === 0) return undefined;
  const shown = hit.slice(0, 5).map((f) => `${f.name} (${partialReadLabel(f.partialRead as NonNullable<AuditFileRecord["partialRead"]>)})`);
  return `${hit.length} file(s) were read only in part, so any line relying on them was judged on a fraction of the record: ${shown.join("; ")}${hit.length > 5 ? ", …" : ""}. Raise the limits in Settings, or split the file, then re-run.`;
}

// The capped files a requirement line's verdict actually rests on.
//
// Matched by CHUNK ID against the ledger's own chunkIds, not by file name:
// Drive permits two files with the same name side by side, and a name match
// could attach a warning to the wrong record or miss the right one. A line
// citing no chunks returns nothing, which is correct — there is no cited file
// to have been cut short.
export function partialFilesForLine(
  citedChunkIds: string[] | undefined,
  ledger: AuditFileRecord[] | undefined,
): AuditFileRecord[] {
  const cited = new Set(citedChunkIds ?? []);
  if (cited.size === 0) return [];
  return partiallyReadFiles(ledger).filter((f) => (f.chunkIds ?? []).some((c) => cited.has(c)));
}

/** The sentence shown on a line whose evidence was cut short. */
export function linePartialReadNote(files: AuditFileRecord[]): string | undefined {
  if (files.length === 0) return undefined;
  const list = files.map((f) => `${f.name} (${partialReadLabel(f.partialRead as NonNullable<AuditFileRecord["partialRead"]>)})`).join("; ");
  return `Judged partly on ${files.length === 1 ? "a file" : "files"} read only in part: ${list}. A gap here may be an unread part of the record rather than a missing record.`;
}
