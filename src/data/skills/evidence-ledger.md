# Evidence Ledger Skill

## File lifecycle states

Every file retrieved from a Drive folder moves through a defined sequence of states. Each state is distinct and meaningful:

- **found**: The Drive API listed the file. No content has been read yet.
- **reading**: The audit engine is currently fetching and extracting content from the file.
- **read**: Text was successfully extracted from the file and is ready for audit use.
- **condensed**: The extracted text was too large for the audit budget and was summarised by the utility model. The condensed summary — not the original — was sent to the AI auditor.
- **skipped**: The file type is recognised but has no text extraction path (e.g. video, audio, unknown binary). A recognised skip is NOT a failure — it is a deliberate exclusion. The skip reason must be recorded.
- **failed**: An attempt was made to read the file but it threw an error (corrupt PDF, permission denied, unsupported encoding, worker crash). Failed files must be named and their reason surfaced.
- **sent_to_ai**: The file's text (or condensed summary) was included in the document block sent to the AI verdict call.
- **cited**: The AI returned a verdict that named a chunk from this file in sourceChunkIds for at least one checklist line.
- **used**: Synonym for cited — the file contributed to at least one positive AI finding.
- **not_used**: The file was read successfully and sent to the AI, but no verdict cited any chunk from it.

## Why each state is distinct

The distinction between skipped, failed, condensed, cited, and not_used matters because:
- A skipped file may contain important evidence the auditor should know was not assessed.
- A failed file may hide a critical gap (e.g. a corrupt policy PDF).
- A condensed file may have lost nuance in summarisation — the auditor should know.
- A not_used file that was read successfully means the AI found it irrelevant — this is informative, not neutral.
- A cited file carries evidential weight for the verdict and should be traceable.

## UI requirements

The progress modal MUST show every file's current status at every stage. Files that were not used must be explicitly listed as "not used" — they must not silently disappear from the file list. Skipped and failed files need visible reasons surfaced in the UI, not just an icon.

## Background-context files

Files from the workspace-wide "Additional Info" folder are background context, not primary evidence for any specific sub-criterion. They must never be cited as primary evidence for a checklist line verdict. They provide school-wide background (e.g. organisation chart, student handbook) that the AI auditor uses to understand context, not to prove compliance.
