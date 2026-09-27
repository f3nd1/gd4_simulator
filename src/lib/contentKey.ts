// A key for "this is the same document text", used to read a file once even
// when it sits in several Drive folders.
//
// ON CONTENT, NEVER ON NAME. Two different documents can share a name: a real
// 5.5 run held two files both called "United Ceres College Mail - Assessment
// Results for DBM001.pdf", one of 1,433 characters and one of 2,828. Matching
// by name would have thrown one of them away.
//
// FNV-1a over the text, paired with its length. Not a cryptographic hash and
// not trying to be: the only question is whether two extractions of the same
// run produced identical text, and a length mismatch settles most of it before
// the hash is even compared.
export function contentKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(36)}`;
}

// THE TRAP, written down because it is one-directional and silent.
//
// De-duplication must happen WITHIN a bucket only. A file that appears in both
// the policy folder and the evidence folder has to be counted in both, because
// the both-folders warning (findFolderMixups in driveGuard.ts) is built from
// the two ledgers and fires precisely when the same document appears in each.
// Collapsing across buckets would switch that warning off without a word,
// which is the opposite of what it exists to do.
//
// The two run loops are already bucket-scoped: each keeps its own map, built
// fresh inside its own pass. This constant exists so the rule is greppable.
export const DEDUPE_IS_PER_BUCKET = true;
