import { useCallback, useMemo, useState } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ExtractedTextPanel } from "./ExtractedTextPanel";
import { excerptAround, findQuoteSpan } from "./quoteMatch";
import { downloadLineageCsv, openLineagePdf, type LineageExportRow, type LineageExportMeta } from "../../lib/lineageExport";
import { ppdVerdictLabel, evVerdictLabel } from "../../lib/verdictTone";
import type { PPDReviewResult, PPDReviewRow, EvidenceAssessmentResult, EvidenceAssessmentRow, EvidenceFileRef, AuditFileRecord, PPDVerdict, EvidenceVerdict } from "../../types";

// Requirement coverage MATRIX — one tab-specific five-column table per Option A
// tab, scannable straight down each column without expanding anything.
//
//   Policy tab:   GD4 requirement | Policy verdict | Policy file(s) | Policy clause | Rationale
//   Evidence tab: GD4 requirement | Evidence verdict | Evidence file(s) | Supporting passage | Rationale
//
// A read-only view of data ALREADY computed per requirement line — no recompute,
// no re-fetch, no change to any verdict/quote/scoring logic.
//
// ONE colour axis: a 3px left-edge bar encodes COVERAGE only — solid green
// (met), half-amber (partial), plain grey (not met), dotted grey (not checked).
// The verdict cell repeats that coverage colour as a dot + text; colour is used
// for nothing else. (The yellow highlight on a matched quote is a text-highlight
// of the located passage, not a status colour.)
//
// MULTI-FILE IS REAL. A requirement can be backed by several files: policy
// citations come from the row's chunkIds mapped through chunkFileNames; evidence
// citations from the row's evidenceFiles list. The file cell stacks up to two
// names then "+N more file(s)".
//
// The "Policy clause" column names the SOURCE document's own section reference
// (e.g. "4.2 Competency-Based Recruitment…, Step 1: Manpower Planning"), never a
// filename — and shows an em-dash when the assessment could not honestly
// identify one. (The Evidence tab has no clause structure, so its fourth column
// is "Supporting passage" — the located evidence excerpt — per the audit's own
// data, which carries filename + text span but no internal clause reference.)
//
// Gap and unchecked rows are FLAT and non-expandable — em-dash in the file and
// clause/passage columns, nothing to drill into. Covered/partial rows expand to
// a SPINE: a single 1px rule with the sub-parts hanging off it (filled dot =
// found, hollow = not found), indented and shaded under the parent row. Each
// found sub-part shows its plain-English name, its clause reference (policy),
// the located passage (context faint, match highlighted), a mandatory "from
// <filename> ↗" attribution, and its per-clause rationale beneath. A sub-part
// checked but with no single locatable quote keeps its honest, NON-failure note
// ("Covered, but spread across the document rather than one passage.").

type Coverage = "covered" | "partial" | "not-covered" | "not-checked";

// One cited source file: name, a Drive link where resolvable, and (where the
// run's ledger has it) the AuditFileRecord so its extracted text can be read.
type CitedFile = { name: string; url?: string; record?: AuditFileRecord };

// One independently-checked sub-part, resolved for display. `found` drives the
// spine dot; the rest is the located passage + attribution + rationale, or an
// honest gap/absence.
type SpineItem = {
  name: string;            // what the sub-part IS (never "Sub-part C")
  clause?: string;         // policy: the SOURCE document's clause reference
  found: boolean;
  quote?: string;
  // Real matched passages for a "covered but spread across the document"
  // sub-part — shown INSTEAD of (never alongside) noExactQuote, so the
  // honest state has actual evidence behind it, not just an assertion.
  spreadQuotes?: { quote: string; sourceFile?: CitedFile }[];
  noExactQuote?: boolean;  // covered, no single passage AND no spreadQuotes either (the true diffuse-mention fallback)
  contradicted?: boolean;  // evidence-only: the passage contradicts the promise
  sourceFile?: CitedFile;
  rationale?: string;      // per-clause / per-promise "why"
};

type MatrixLine = {
  ref: string;
  reqLabel: string;
  coverage: Coverage;      // the tab's own verdict → left bar + expandability
  expandable: boolean;
  verdictLabel: string;
  files: CitedFile[];
  clauses: string[];       // policy: distinct clause references for the matrix cell
  passagePreview?: string; // evidence: supporting-passage preview for the matrix cell
  rowRationale?: string;   // shortComment (policy) / comment (evidence)
  items: SpineItem[];      // spine, only for expandable rows
};

function shorten(s: string, n = 110): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

function uniqStrings(arr: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const s of arr) if (s && !out.includes(s)) out.push(s);
  return out;
}

// Same Drive-link pattern used across the app (FileLedger, PreAnalysisChecklistPanel).
function driveUrlFor(rec?: AuditFileRecord): string | undefined {
  return rec?.driveFileId ? `https://drive.google.com/file/d/${rec.driveFileId}/view` : undefined;
}

function ppdCoverage(v: PPDVerdict): Coverage {
  return v === "Adequate" ? "covered" : v === "Partial" ? "partial" : v === "Not assessed" ? "not-checked" : "not-covered";
}
function evCoverage(v: EvidenceVerdict): Coverage {
  return v === "Met" ? "covered" : v === "Partial" ? "partial" : v === "Not assessed" ? "not-checked" : "not-covered";
}

// The single coverage colour scale, reused by the left bar and the verdict dots.
const COV_DOT: Record<Coverage, string> = { covered: "#16a34a", partial: "#d97706", "not-covered": "#94a3b8", "not-checked": "#94a3b8" };
function coverageBar(c: Coverage): string {
  if (c === "covered") return "#16a34a";
  if (c === "partial") return "linear-gradient(180deg,#f59e0b 0 50%,#e2e8f0 50% 100%)";
  if (c === "not-covered") return "#cbd5e1";
  return "repeating-linear-gradient(180deg,#cbd5e1 0 3px,transparent 3px 7px)"; // not-checked → dotted
}

// Policy files a row cites: unique source-file names across its chunkIds,
// resolved to their ledger records (for extracted text + Drive link).
function citedPolicyFiles(chunkIds: string[], chunkFileNames?: Record<string, string>, ledger?: AuditFileRecord[]): CitedFile[] {
  return uniqStrings(chunkIds.map((id) => chunkFileNames?.[id])).map((name) => {
    const record = ledger?.find((f) => f.name === name);
    return { name, record, url: driveUrlFor(record) };
  });
}

// Evidence files a row cites: the row's own evidenceFiles list (already
// {name,url}), resolved to ledger records where available for highlighting.
function citedEvidenceFiles(files: EvidenceFileRef[], ledger?: AuditFileRecord[]): CitedFile[] {
  return files.map((f) => ({ name: f.name, url: f.url, record: ledger?.find((r) => r.name === f.name) }));
}

type ResolveText = (f: AuditFileRecord) => string | null | undefined;

// Attribute a quote to whichever cited file's extracted text actually contains
// it — the SAME verbatim match (findQuoteSpan) the highlighter uses. Never guesses.
function attributeQuote(quote: string, files: CitedFile[], resolveText: ResolveText): CitedFile | undefined {
  for (const cf of files) {
    const text = cf.record ? resolveText(cf.record) : undefined;
    if (typeof text === "string" && findQuoteSpan(text, quote)) return cf;
  }
  return undefined;
}

// Resolve a sub-part's source file: DIRECT via its stored chunkId (new runs),
// else by locating its quote in a cited file (older runs), else the sole file.
function resolveSourceFile(chunkId: string | undefined, quote: string | undefined, files: CitedFile[], chunkFileNames: Record<string, string> | undefined, resolveText: ResolveText): CitedFile | undefined {
  const name = chunkId ? chunkFileNames?.[chunkId] : undefined;
  if (name) return files.find((f) => f.name === name) ?? { name };
  if (quote) { const a = attributeQuote(quote, files, resolveText); if (a) return a; }
  return files.length === 1 ? files[0] : undefined;
}

function policySpine(row: PPDReviewRow, files: CitedFile[], chunkFileNames: Record<string, string> | undefined, resolveText: ResolveText): SpineItem[] {
  const subs = row.subClauses;
  if (subs && subs.length > 0) {
    return subs.map((sc) => {
      const sourceFile = resolveSourceFile(sc.chunkId, sc.quote, files, chunkFileNames, resolveText);
      if (sc.verdict === "documented") {
        if (sc.quote) return { name: sc.text, clause: sc.clause, found: true, quote: sc.quote, sourceFile, rationale: sc.rationale };
        // No single quote — show the real matched passages behind "spread
        // across the document" instead of only asserting it (Task 4).
        const spreadQuotes = (sc.spreadQuotes ?? []).map((sq) => ({
          quote: sq.quote,
          sourceFile: resolveSourceFile(sq.chunkId, sq.quote, files, chunkFileNames, resolveText),
        }));
        if (spreadQuotes.length > 0) return { name: sc.text, clause: sc.clause, found: true, spreadQuotes, sourceFile, rationale: sc.rationale };
        // True fallback: documented, but genuinely no extractable passage at all.
        return { name: sc.text, clause: sc.clause, found: true, noExactQuote: true, sourceFile, rationale: sc.rationale };
      }
      return { name: sc.text, clause: sc.clause, found: false, sourceFile, rationale: sc.rationale };
    });
  }
  // No decomposition — one line-level item (older runs). Its rationale is the
  // row rationale (shown in the Rationale column already), so leave it off here.
  if (row.supportQuote) {
    return [{ name: "This requirement", found: true, quote: row.supportQuote, sourceFile: resolveSourceFile(undefined, row.supportQuote, files, chunkFileNames, resolveText) }];
  }
  return [{ name: "This requirement", found: true, noExactQuote: true, sourceFile: files[0] }];
}

function evidenceSpine(row: EvidenceAssessmentRow, files: CitedFile[], chunkFileNames: Record<string, string> | undefined, resolveText: ResolveText): SpineItem[] {
  const checks = row.promiseChecks;
  if (checks && checks.length > 0) {
    return checks.map((c) => {
      const sourceFile = resolveSourceFile(c.chunkId ?? c.chunkIds[0], c.quote, files, chunkFileNames, resolveText);
      if (c.verdict === "evidenced") {
        return c.quote
          ? { name: c.promiseText, found: true, quote: c.quote, sourceFile, rationale: c.rationale }
          : { name: c.promiseText, found: true, noExactQuote: true, sourceFile, rationale: c.rationale };
      }
      if (c.verdict === "contradicted") {
        return { name: c.promiseText, found: false, contradicted: true, quote: c.quote, sourceFile, rationale: c.rationale };
      }
      return { name: c.promiseText, found: false, sourceFile, rationale: c.rationale };
    });
  }
  if (row.evidenceQuote) {
    return [{ name: "This requirement", found: true, quote: row.evidenceQuote, sourceFile: resolveSourceFile(undefined, row.evidenceQuote, files, chunkFileNames, resolveText) }];
  }
  return [{ name: "This requirement", found: true, noExactQuote: true, sourceFile: files[0] }];
}

function buildPpdLines(ppd: PPDReviewResult, resolveText: ResolveText): MatrixLine[] {
  return ppd.rows.map((r) => {
    const coverage = ppdCoverage(r.verdict);
    const files = citedPolicyFiles(r.chunkIds, ppd.chunkFileNames, ppd.fileLedger);
    const expandable = coverage === "covered" || coverage === "partial";
    const items = expandable ? policySpine(r, files, ppd.chunkFileNames, resolveText) : [];
    return {
      ref: r.ref, reqLabel: r.requirementText, coverage, expandable, verdictLabel: ppdVerdictLabel(r.verdict),
      files, clauses: uniqStrings(items.map((it) => it.clause)), rowRationale: r.shortComment || undefined, items,
    };
  });
}

function buildEvidenceLines(ev: EvidenceAssessmentResult, resolveText: ResolveText): MatrixLine[] {
  return ev.rows.map((r) => {
    const coverage = evCoverage(r.verdict);
    const files = citedEvidenceFiles(r.evidenceFiles, ev.fileLedger);
    const expandable = coverage === "covered" || coverage === "partial";
    const items = expandable ? evidenceSpine(r, files, ev.chunkFileNames, resolveText) : [];
    return {
      ref: r.gdRef, reqLabel: r.requirementText, coverage, expandable, verdictLabel: evVerdictLabel(r.verdict),
      files, clauses: [], passagePreview: items.find((it) => it.found && it.quote)?.quote ?? (r.evidenceQuote || undefined),
      rowRationale: r.comment || undefined, items,
    };
  });
}

// ── Cell components ─────────────────────────────────────────────────────────

function VerdictCell({ coverage, label }: { coverage: Coverage; label: string }) {
  const color = COV_DOT[coverage];
  const hollow = coverage === "not-checked";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#334155", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: hollow ? "transparent" : color, border: `1.5px solid ${color}` }} />
      {label}
    </span>
  );
}

// Up to two entries, then "+N more <thing>(s)". Em-dash when muted (flat row) or empty.
// Used for the Policy Clause column only — clause text has no Drive link.
function StackCell({ items, muted, more, mono }: { items: string[]; muted: boolean; more: string; mono?: boolean }) {
  if (muted || items.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  const show = items.slice(0, 2);
  const extra = items.length - show.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      {show.map((t, i) => (
        <span key={i} title={t} style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: mono ? "ui-monospace,monospace" : undefined }}>{t}</span>
      ))}
      {extra > 0 && <span style={{ fontSize: 10.5, color: "#94a3b8" }}>+{extra} more {more}{extra === 1 ? "" : "s"}</span>}
    </div>
  );
}

// Policy File(s) / Evidence File(s) column. Full filenames only — never
// clipped with an ellipsis or shortened; long names wrap onto extra lines
// instead (the row simply grows taller). Each filename is the SAME working
// Drive link the spine's "from [filename] ↗" attribution uses (driveUrlFor /
// EvidenceFileRef.url, already resolved onto CitedFile.url). Only the FIRST
// two files show by default for scannability; "+N more" is itself a toggle —
// expanding it reveals the rest exactly the same way (full, wrapped, linked),
// never a second, more-truncated tier, and never a hover-only reveal.
function FileListCell({ files, muted }: { files: CitedFile[]; muted: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (muted || files.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  const show = expanded ? files : files.slice(0, 2);
  const extra = files.length - Math.min(2, files.length);
  const nameStyle: React.CSSProperties = { fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "normal" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {show.map((f) => (
        f.url
          ? <a key={f.name} href={f.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...nameStyle, color: "#4338ca", textDecoration: "none" }}>{f.name} ↗</a>
          : <span key={f.name} style={{ ...nameStyle, color: "#475569" }}>{f.name}</span>
      ))}
      {!expanded && extra > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(true); }} style={{ fontSize: 10.5, fontWeight: 600, color: "#4338ca", background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", textDecoration: "underline" }}>
          +{extra} more file{extra === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function TextCell({ text, muted, italic }: { text?: string; muted: boolean; italic?: boolean }) {
  if (muted || !text) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <span title={text} style={{ fontSize: 11, color: "#475569", fontStyle: italic ? "italic" : undefined, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</span>
  );
}

// Rationale column. Unlike TextCell's bare "—" (used for genuinely-N/A cells,
// e.g. a flat gap row's Supporting Passage), an empty rationale here is never
// "not applicable" — every line's shortComment/comment is meant to carry one.
// A blank one means the AI genuinely returned none for this line, which is
// worth saying plainly rather than hiding behind a dash indistinguishable
// from "nothing to show here".
function RationaleCell({ text }: { text?: string }) {
  if (!text) return <span style={{ color: "#94a3b8", fontStyle: "italic" }}>No rationale returned by the AI for this line</span>;
  return (
    <span title={text} style={{ fontSize: 11, color: "#475569", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</span>
  );
}

function SpineItemView({ item, resolveText }: { item: SpineItem; resolveText: ResolveText }) {
  const text = item.sourceFile?.record ? resolveText(item.sourceFile.record) : undefined;
  const quoted = (item.found || item.contradicted) && item.quote;
  const excerpt = quoted && typeof text === "string" ? excerptAround(text, item.quote!) : null;
  const attr = item.sourceFile?.name;
  const attrUrl = item.sourceFile?.url;

  return (
    <div style={{ position: "relative", paddingLeft: 2 }}>
      {/* Spine dot: filled = found, hollow = not found (shape, not colour). */}
      <span aria-hidden style={{ position: "absolute", left: -18, top: 3, width: 8, height: 8, borderRadius: "50%", background: item.found ? "#64748b" : "transparent", border: "1.5px solid #94a3b8" }} />
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#334155" }}>{item.name}</div>
      {item.clause && (
        <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 1 }}>§ {item.clause}</div>
      )}

      {quoted && excerpt && (
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginTop: 3 }}>
          {excerpt.clippedStart && "… "}{excerpt.before}
          <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{excerpt.match}</mark>
          {excerpt.after}{excerpt.clippedEnd && " …"}
        </div>
      )}
      {quoted && !excerpt && (
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5, marginTop: 3 }}>
          “{shorten(item.quote!, 220)}” <span style={{ color: "#94a3b8", fontStyle: "italic" }}>(context unavailable — re-run to refresh the cache)</span>
        </div>
      )}
      {/* "Spread across the document" shows the ACTUAL matched passages, not
          just the claim — up to 5, each with its own file attribution; only
          the true diffuse-mention fallback (below) has nothing to show. */}
      {item.found && item.spreadQuotes && item.spreadQuotes.length > 0 && (
        <div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 10.5, color: "#64748b", fontStyle: "italic" }}>Covered — spread across {item.spreadQuotes.length > 1 ? "these" : "this"} passage{item.spreadQuotes.length > 1 ? "s" : ""} rather than one:</div>
          {item.spreadQuotes.slice(0, 5).map((sq, i) => (
            <div key={i} style={{ fontSize: 11, color: "#475569", lineHeight: 1.5, paddingLeft: 8, borderLeft: "2px solid #e2e8f0" }}>
              “{shorten(sq.quote, 180)}”
              {sq.sourceFile?.name && (
                <div style={{ fontSize: 10.5, marginTop: 2 }}>
                  {sq.sourceFile.url
                    ? <a href={sq.sourceFile.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>from {sq.sourceFile.name} ↗</a>
                    : <span style={{ color: "#64748b" }}>from {sq.sourceFile.name}</span>}
                </div>
              )}
            </div>
          ))}
          {item.spreadQuotes.length > 5 && (
            <div style={{ fontSize: 10.5, color: "#94a3b8", fontStyle: "italic", paddingLeft: 8 }}>
              …and {item.spreadQuotes.length - 5} more spread across the document.
            </div>
          )}
        </div>
      )}
      {item.found && item.noExactQuote && (
        <div style={{ fontSize: 11.5, color: "#64748b", fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif", marginTop: 3 }}>
          Covered, but spread across the document rather than one passage.
        </div>
      )}

      {/* Attribution — mandatory for a found/contradicted passage; also names the
          file searched for a not-found sub-part. */}
      {item.found ? (
        attr && (
          <div style={{ fontSize: 10.5, marginTop: 3 }}>
            {attrUrl
              ? <a href={attrUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>from {attr} ↗</a>
              : <span style={{ color: "#64748b" }}>from {attr}</span>}
          </div>
        )
      ) : (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: quoted ? 3 : 2 }}>
          {item.contradicted ? "Contradicted" : "Not found"}{attr ? ` in ${attr}` : ""}.
          {attrUrl && <> <a href={attrUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>↗</a></>}
        </div>
      )}

      {item.rationale && (
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.45, marginTop: 4 }}>{item.rationale}</div>
      )}
    </div>
  );
}

// The expanded detail for one covered/partial row: the spine (indented + shaded
// under the parent), a "Read the full document" toggle per cited readable file,
// and "Jump to full line detail". Owns the per-file full-text open state.
function RowDetail({ line, resolveText, onOpenLine }: { line: MatrixLine; resolveText: ResolveText; onOpenLine: (ref: string) => void }) {
  const [fullFile, setFullFile] = useState<string | null>(null);
  const readable = line.files.filter((f) => f.record);
  const firstQuoteFor = (name: string) => line.items.find((it) => it.found && it.quote && it.sourceFile?.name === name)?.quote;

  return (
    <div style={{ margin: "2px 0 8px 26px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, padding: "10px 12px" }}>
      {/* Unconditional — every expanded covered/partial row gets this caption,
          never just some (a prior version dropped it for some row shapes). */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Clause by clause</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>Each clause shows the exact wording, the file it came from, and why it does or doesn't satisfy the requirement.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, borderLeft: "1px solid #cbd5e1", marginLeft: 4, paddingLeft: 16 }}>
        {line.items.map((it, i) => <SpineItemView key={i} item={it} resolveText={resolveText} />)}
      </div>
      {readable.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {readable.map((f) => (
            <div key={f.name}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFullFile((v) => (v === f.name ? null : f.name)); }}
                style={{ cursor: "pointer", fontSize: 10.5, fontWeight: 600, color: "#4338ca", border: "none", background: "transparent", padding: 0, textDecoration: "underline" }}
              >
                {fullFile === f.name ? `Hide full document (${f.name})` : `Read the full document (${f.name}) →`}
              </button>
              {fullFile === f.name && f.record && (
                <div style={{ marginTop: 4 }}>
                  <ExtractedTextPanel file={f.record} resolveText={resolveText} highlight={firstQuoteFor(f.name)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenLine(line.ref); }}
        style={{ marginTop: 10, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4338ca", border: "none", background: "transparent", padding: 0 }}
      >
        Jump to full line detail →
      </button>
    </div>
  );
}

function LegendSwatch({ bar, label }: { bar: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden style={{ width: 4, height: 12, borderRadius: 1, background: bar }} />
      {label}
    </span>
  );
}

export function LineageDiagram({ mode, ppd, evidence, onOpenLine, runLabel }: {
  mode: "ppd" | "evidence";
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult; // NOTE: evidence tab is self-contained; `ppd` is unused there.
  onOpenLine: (ref: string) => void;
  // Sub-criterion id + title (e.g. "6.2 Management Review"), for the CSV/PDF
  // export's header and filename only — optional so existing callers that
  // don't pass it still render exactly as before, just with a plain ref-only
  // export label instead of the human title.
  runLabel?: string;
}) {
  const [open, setOpen] = useState(true);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback<ResolveText>(
    (f) => (f.driveFileId ? fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text : undefined),
    [fileTextCache]
  );

  const lines = useMemo<MatrixLine[]>(
    () => (mode === "ppd" ? (ppd ? buildPpdLines(ppd, resolveText) : []) : (evidence ? buildEvidenceLines(evidence, resolveText) : [])),
    [mode, ppd, evidence, resolveText]
  );
  if (lines.length === 0) return null;

  const gaps = lines.filter((l) => l.coverage === "not-covered" || l.coverage === "not-checked").length;
  const isEv = mode === "evidence";
  // Header + every row share this template so columns line up down the matrix.
  // The file column got a wider share (1.1fr → 1.6fr) plus a 170px floor —
  // full filenames now wrap instead of clipping (FileListCell), so this
  // column needs real room; Requirement and Clause/Passage were trimmed
  // slightly to compensate rather than letting the row overflow.
  const gridCols = isEv
    ? "minmax(0,2fr) 118px minmax(170px,1.6fr) minmax(0,1.5fr) minmax(0,1.6fr)"
    : "minmax(0,2fr) 118px minmax(170px,1.6fr) minmax(0,1.3fr) minmax(0,1.6fr)";
  const headerCell: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 };
  const col4Header = isEv ? "Supporting passage" : "Policy clause";

  // Export reuses EXACTLY the rows currently rendered above — full,
  // untruncated text (the on-screen "+N more"/2-line clamp is display-only;
  // the underlying strings were never truncated) — and only THIS tab's mode,
  // never the other tab's data.
  const exportMeta: LineageExportMeta = {
    tab: isEv ? "evidence" : "policy",
    runLabel: runLabel || (isEv ? evidence?.subCriterionId : ppd?.subCriterionId) || "lineage",
    runAt: (isEv ? evidence?.runAt : ppd?.runAt) || new Date(0).toISOString(),
    statusLine: Object.entries(
      lines.reduce<Record<string, number>>((acc, l) => { acc[l.verdictLabel] = (acc[l.verdictLabel] ?? 0) + 1; return acc; }, {})
    ).map(([label, n]) => `${n} ${label}`).join(" · "),
  };
  const exportRows: LineageExportRow[] = lines.map((l) => ({
    ref: l.ref,
    requirementText: l.reqLabel,
    verdictLabel: l.verdictLabel,
    fileNames: l.files.map((f) => f.name),
    clauseOrPassage: isEv ? (l.passagePreview || "") : l.clauses.join("; "),
    rationale: l.rowRationale || "",
    barColor: COV_DOT[l.coverage], // same solid colour scale the verdict dot uses (border-left can't take the on-screen gradient)
  }));
  const exportBtnStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#0f766e", padding: "4px 9px", border: "1px solid #99f6e4", borderRadius: 6, background: "#f0fdfa", whiteSpace: "nowrap", cursor: "pointer" };

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 12, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: open ? "1px solid #f1f5f9" : "none", flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Requirement coverage — {isEv ? "evidence" : "policy"}
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{lines.length} line{lines.length !== 1 ? "s" : ""}{gaps > 0 ? ` · ${gaps} with a gap` : " · all covered"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, fontSize: 10.5, color: "#64748b", flexWrap: "wrap" }}>
          <LegendSwatch bar={coverageBar("covered")} label="met" />
          <LegendSwatch bar={coverageBar("partial")} label="partial" />
          <LegendSwatch bar={coverageBar("not-covered")} label="not met" />
          <LegendSwatch bar={coverageBar("not-checked")} label="not checked" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 3px" }}>abc</mark> exact quote
          </span>
        </span>
        {/* Export the rows exactly as rendered above — this tab only, full
            untruncated file/clause lists (no "+N more"). stopPropagation so
            clicking an export button doesn't also collapse the panel. */}
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); downloadLineageCsv(exportMeta, exportRows); }} style={exportBtnStyle} title="Every row above, full file lists, as a CSV">⬇ CSV</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); openLineagePdf(exportMeta, exportRows); }} style={exportBtnStyle} title="Every row above as a printable/PDF table (opens a new tab)">⬇ PDF</button>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {/* Column headers — aligned with the 3px accent-bar offset below. */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", borderBottom: "1px solid #eef2f6" }}>
            <div style={{ width: 3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: gridCols, gap: 12, padding: "7px 12px 7px 8px", alignItems: "center" }}>
              <span style={headerCell}>GD4 requirement</span>
              <span style={headerCell}>{isEv ? "Evidence verdict" : "Policy verdict"}</span>
              <span style={headerCell}>{isEv ? "Evidence file(s)" : "Policy file(s)"}</span>
              <span style={headerCell}>{col4Header}</span>
              <span style={headerCell}>Rationale</span>
            </div>
          </div>

          {lines.map((line, i) => {
            const isOpen = openRef === line.ref;
            return (
              <div key={line.ref + i} style={{ display: "flex", alignItems: "stretch", borderTop: i ? "1px solid #f6f7f9" : "none" }}>
                {/* Left accent bar — the ONE coverage colour; spans row + detail. */}
                <div aria-hidden style={{ width: 3, flexShrink: 0, background: coverageBar(line.coverage) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={line.expandable ? () => setOpenRef(isOpen ? null : line.ref) : undefined}
                    style={{ display: "grid", gridTemplateColumns: gridCols, gap: 12, padding: "8px 12px 8px 8px", alignItems: "start", cursor: line.expandable ? "pointer" : "default" }}
                  >
                    {/* GD4 requirement (chevron slot reserved so refs align on every row) */}
                    <div style={{ minWidth: 0, display: "flex", gap: 6 }}>
                      <span aria-hidden style={{ width: 9, flexShrink: 0, color: "#94a3b8", fontSize: 9, marginTop: 2 }}>{line.expandable ? (isOpen ? "▾" : "▸") : ""}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, fontWeight: 700, color: "#4338ca" }}>{line.ref}</span>
                        <span style={{ fontSize: 12, color: "#334155", marginLeft: 6 }} title={line.reqLabel}>{shorten(line.reqLabel, 90)}</span>
                      </span>
                    </div>
                    <VerdictCell coverage={line.coverage} label={line.verdictLabel} />
                    <FileListCell files={line.files} muted={!line.expandable} />
                    {isEv
                      ? <TextCell text={line.passagePreview} muted={!line.expandable} italic />
                      : <StackCell items={line.clauses} muted={!line.expandable} more="clause" />}
                    <RationaleCell text={line.rowRationale} />
                  </div>

                  {isOpen && line.expandable && <RowDetail line={line} resolveText={resolveText} onOpenLine={onOpenLine} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
