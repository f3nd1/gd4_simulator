import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { blockWritesIfHydrationFailed } from "./hydrationGate";

// Extracted document text, kept across reloads.
//
// useWorkspaceStore holds the same cache in memory (fileTextCache) and its
// partialize wipes it on every save, so until now closing the tab meant every
// file was downloaded from Drive again and every scanned page sent to the
// vision model again. On a folder of scanned PDFs that is the single largest
// avoidable cost in a run.
//
// It lives in its OWN key rather than inside the workspace blob for the same
// reason useChecklistVerdictStore does: extracted text is large, and the
// workspace row is already the biggest thing this app stores. It is likewise
// in NO_LOCAL_MIRROR (supabaseStorage.ts) — full text to Supabase, no
// localStorage copy, because one folder of PDFs would fill a browser's whole
// 5 MB quota and evict everything that matters.
//
// THE CORRECTNESS RULE: a cached entry is either the file's complete
// extracted text or it is absent. Never a truncated copy. The cap below
// evicts whole entries and refuses oversized ones; it never shortens one.
// A shortened entry would mean a re-run silently assessed less than the first
// run did, with nothing on screen to say so — the exact failure this app
// keeps having to design against.
//
// The key is `${driveFileId}:${modifiedTime}`, so a file edited in Drive
// misses and is re-read. Reuse is only ever of a byte-identical file.

export type CachedFileText = {
  text: string;
  charCount: number;
  fileKind: string;
  fileName?: string;
  filePath?: string;
  cachedAt: number;
  pdfQuality?: { suspectedScannedPdf: boolean; extractedTextQuality: "none" | "low" | "medium" | "high" };
  readMethod?: "text" | "vision";
  visionModel?: string;
};

// One file bigger than this is not persisted at all: it would crowd out every
// other entry. It still reads and caches in memory for the rest of the
// session, exactly as before.
const MAX_ENTRY_CHARS = 600_000;
// Whole-store ceiling. Oldest-first eviction by cachedAt.
const MAX_TOTAL_CHARS = 4_000_000;

type FileTextCacheState = {
  entries: Record<string, CachedFileText>;
  put: (key: string, entry: CachedFileText) => void;
  clear: () => void;
};

// Evicts oldest-first until the total fits. Whole entries only.
export function trimToBudget(entries: Record<string, CachedFileText>): Record<string, CachedFileText> {
  let total = 0;
  for (const e of Object.values(entries)) total += e.text.length;
  if (total <= MAX_TOTAL_CHARS) return entries;
  const byAge = Object.entries(entries).sort((a, b) => (a[1].cachedAt ?? 0) - (b[1].cachedAt ?? 0));
  const out = { ...entries };
  for (const [k, e] of byAge) {
    if (total <= MAX_TOTAL_CHARS) break;
    delete out[k];
    total -= e.text.length;
  }
  return out;
}

export const useFileTextCacheStore = create<FileTextCacheState>()(
  persist(
    (set) => ({
      entries: {},
      put: (key, entry) =>
        set((s) => {
          if (!entry.text || entry.text.length > MAX_ENTRY_CHARS) return {};
          return { entries: trimToBudget({ ...s.entries, [key]: entry }) };
        }),
      clear: () => set({ entries: {} }),
    }),
    {
      name: "ucc-gd4-file-text-cache:v1",
      onRehydrateStorage: blockWritesIfHydrationFailed("ucc-gd4-file-text-cache:v1"),
      storage: workspaceStorage,
      version: 0,
    }
  )
);

/** The stored text for a file, or undefined. Never throws on a hostile blob. */
export function getCachedFileText(key: string): CachedFileText | undefined {
  const e = useFileTextCacheStore.getState().entries?.[key];
  return e && typeof e.text === "string" && e.text.length > 0 ? e : undefined;
}

export function putCachedFileText(key: string, entry: CachedFileText): void {
  useFileTextCacheStore.getState().put(key, entry);
}
