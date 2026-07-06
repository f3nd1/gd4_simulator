import type { AuditFileRecord, EvidenceDriftCheck } from "../types";

// Pure diff between the Actual Evidence folder's CURRENT Drive listing and a
// stored assessment's fileLedger — factored out from useWorkspaceStore's
// checkEvidenceDrift so the comparison itself (unlike the Drive fetch around
// it) is unit-testable without mocking the Drive client. Matches purely by
// Drive file id; a file whose id isn't in the ledger at all is "added", a
// ledger entry whose id is no longer in the current listing is "removed",
// and a shared id whose modifiedTime differs is "modified". Names (not ids)
// are returned for display.
export function diffEvidenceFiles(
  current: { id: string; name: string; modifiedTime?: string }[],
  ledger: AuditFileRecord[]
): EvidenceDriftCheck {
  const currentById = new Map(current.map((f) => [f.id, f]));
  const ledgerById = new Map(ledger.filter((r) => r.driveFileId).map((r) => [r.driveFileId as string, r]));

  const added = current.filter((f) => !ledgerById.has(f.id)).map((f) => f.name);
  const removed = ledger.filter((r) => r.driveFileId && !currentById.has(r.driveFileId)).map((r) => r.name);
  const modified = current
    .filter((f) => {
      const rec = ledgerById.get(f.id);
      return !!rec && rec.driveModifiedTime !== f.modifiedTime;
    })
    .map((f) => f.name);

  const status = added.length > 0 || removed.length > 0 || modified.length > 0 ? "changed" : "unchanged";
  return { status, added, removed, modified };
}
