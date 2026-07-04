// One-file workspace backup: bundles every persisted app key from
// localStorage into a single JSON document the user can download before a
// high-stakes day (the real SSG assessment) and re-import by hand if the
// browser profile or Supabase ever lets them down. Pure functions — the
// download trigger lives in the page.

const BACKUP_KEY_PREFIXES = ["ucc-gd4-", "profile-of-pei"];

export type WorkspaceBackup = {
  app: "gd4-workspace";
  exportedAt: string; // ISO
  keys: Record<string, unknown>;
};

export function isBackupKey(key: string): boolean {
  return BACKUP_KEY_PREFIXES.some((p) => key.startsWith(p));
}

// Collects all persisted app entries from the given storage. Values are
// parsed JSON where possible (every zustand-persist value is JSON), raw
// strings otherwise.
export function collectBackup(storage: Pick<Storage, "length" | "key" | "getItem">, now: Date): WorkspaceBackup {
  const keys: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !isBackupKey(k)) continue;
    const raw = storage.getItem(k);
    if (raw == null) continue;
    try {
      keys[k] = JSON.parse(raw);
    } catch {
      keys[k] = raw;
    }
  }
  return { app: "gd4-workspace", exportedAt: now.toISOString(), keys };
}

export function backupFilename(now: Date): string {
  return `gd4-workspace-backup-${now.toISOString().slice(0, 10)}.json`;
}
