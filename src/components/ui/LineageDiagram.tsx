import { useCallback, useMemo, useState } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ExtractedTextPanel } from "./ExtractedTextPanel";
import { excerptAround, findQuoteSpan, type QuoteExcerpt } from "./quoteMatch";
import { downloadLineageCsv, openLineagePdf, lineageColumnsFor, type LineageExportRow, type LineageExportMeta, type LineageColumnKey, type LineageClauseDetailItem } from "../../lib/lineageExport";
import { ppdVerdictLabel, evVerdictLabel } from "../../lib/verdictTone";
import { samplingCaveat } from "../../lib/samplingCaveat";
import type { PPDReviewResult, PPDReviewRow, EvidenceAssessmentResult, EvidenceAssessmentRow, EvidenceFileRef, AuditFileRecord, PPDVerdict, EvidenceVerdict } from "../../types";

// Requirement coverage MATRIX — one tab-specific table per Option A tab
// (five columns on the policy tab, six on the evidence tab), scannable
// straight down each column without expanding anything.
//
//   Policy tab:   GD4 requirement | Policy verdict | Policy file(s) | Policy clause | Rationale
//   Evidence tab: GD4 requirement (secondary) | Policy promise/clause | Evidence verdict | Evidence file(s) | Supporting passage | Rationale
//
// The evidence tab leads with POLICY → EVIDENCE (the approved reframe): the
// PPD tab already owns Requirement → Policy, so repeating the requirement as
// the evidence tab's widest lead column showed the same mapping twice while
// hiding the tab's real relationship. "Policy promise/clause" surfaces what
// the PPD side found for this same ref (row.ppdExtract/ppdVerdict, populated
// verbatim at evidence-run merge time — never a new AI call) beside what the
// evidence shows; the requirement shrinks to a muted secondary cell so the
// reader still knows which line they're on without it being the emphasis.
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
  // The model cited support but none of it verified against the source — a
  // different, more suspicious state than the diffuse-mention fallback, and
  // shown as such (never as the "spread across the document" claim).
  quoteUnverified?: boolean;
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
  // Evidence tab only: the SAME quote as passagePreview plus the file it was
  // resolved against, so the matrix cell can locate+highlight it exactly like
  // the spine detail does (excerptAround) instead of showing plain italic text.
  passageSource?: { quote: string; sourceFile?: CitedFile };
  rowRationale?: string;   // shortComment (policy) / comment (evidence)
  // Evidence tab only: "what would make this Met" — grounded in the AI's own
  // gap reasoning (agentRuntime's suggestedAction), never a generic template.
  // Only ever set for Partial/Not met rows; undefined on Met rows and on any
  // run recorded before this field existed.
  suggestedAction?: string;
  // Evidence tab only (the lead "Policy promise/clause" column): what the PPD
  // review found for this SAME ref — row.ppdExtract reused verbatim from the
  // PPD pass at evidence-run merge time, never a new AI call — plus its PPD
  // verdict's coverage for the cell's dot. Undefined on very old stored runs
  // predating those fields → the cell shows an em-dash, never an error.
  policyPromise?: string;
  policyCoverage?: Coverage;
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

// Plain-text rendering of a sub-part's located passage / honest fallback —
// the SAME states LocatedPassage renders on screen (exact quote, "spread
// across these passages", the non-failure "spread across the document"
// note, the quote-unverified warning), as export text with NO truncation
// (export's own no-crop rule — the on-screen version windows/clamps for
// display only). Used for the PPD tab's column-2 quote AND the evidence
// tab's File-and-Supporting-passage column, so both stay consistent with
// what LocatedPassage actually shows in-app.
function passageText(item: SpineItem): string | undefined {
  if ((item.found || item.contradicted) && item.quote) return `"${item.quote}"`;
  if (item.found && item.spreadQuotes && item.spreadQuotes.length > 0) {
    return `Covered — spread across these passages: ${item.spreadQuotes.map((sq) => `"${sq.quote}"${sq.sourceFile?.name ? ` (from ${sq.sourceFile.name})` : ""}`).join(" / ")}`;
  }
  if (item.found && item.noExactQuote && !item.quoteUnverified) return "Covered, but spread across the document rather than one passage.";
  if (item.found && item.quoteUnverified) return "The AI cited a supporting passage, but it could not be verified word-for-word against the source document, so it is not shown.";
  return undefined;
}

// PPD tab's export column 2: "§ clause\n\"quote\"" (or the honest fallback
// from passageText) — the plain-text equivalent of what ClauseRow's column 2
// renders for the policy tab.
function clauseCol2Text(item: SpineItem): string {
  const parts: string[] = [];
  if (item.clause) parts.push(`§ ${item.clause}`);
  const p = passageText(item);
  if (p) parts.push(p);
  return parts.join("\n") || "—";
}

// Builds one line's clause-by-clause detail for export — mirrors ClauseRow's
// per-tab column semantics exactly, computed once from the SAME line.items
// already built for on-screen rendering (no new data, no re-derivation).
function buildClauseDetailExport(line: MatrixLine, isEv: boolean): LineageClauseDetailItem[] {
  return line.items.map((it) => ({
    name: it.name,
    found: it.found,
    contradicted: it.contradicted,
    col2: isEv ? (line.policyPromise || "—") : clauseCol2Text(it),
    fileName: it.sourceFile?.name,
    passage: isEv ? passageText(it) : undefined,
    remarks: it.rationale || "",
  }));
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
        // No verified passage. Distinguish "the AI cited support that failed
        // verification" (suspicious — say so) from the true fallback of
        // "documented, but genuinely no extractable passage at all".
        return { name: sc.text, clause: sc.clause, found: true, noExactQuote: true, quoteUnverified: sc.quoteUnverified, sourceFile, rationale: sc.rationale };
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
    const passageItem = items.find((it) => it.found && it.quote);
    const passageQuote = passageItem?.quote ?? (r.evidenceQuote || undefined);
    // Only attribute the fallback (no spine item) quote to a source file when
    // there's exactly one candidate — guessing among several would be a
    // fabricated attribution, so leave it unresolved and fall back to plain text.
    const passageSourceFile = passageItem ? passageItem.sourceFile : (files.length === 1 ? files[0] : undefined);
    // Policy promise/clause: the PPD pass's own extract for this same ref —
    // already on the row (populated verbatim at merge time), never re-derived
    // or re-fetched. Both fields are typed required but very old stored runs
    // predate them, so both reads are guarded: empty extract falls back to a
    // short verdict summary; no verdict either → undefined → em-dash.
    const ppdV = r.ppdVerdict as PPDVerdict | undefined;
    const policyPromise = r.ppdExtract?.trim()
      || (ppdV ? `PPD verdict: ${ppdVerdictLabel(ppdV)} — no PPD extract recorded for this line.` : undefined);
    return {
      ref: r.gdRef, reqLabel: r.requirementText, coverage, expandable, verdictLabel: evVerdictLabel(r.verdict),
      files, clauses: [], passagePreview: passageQuote,
      passageSource: passageQuote ? { quote: passageQuote, sourceFile: passageSourceFile } : undefined,
      rowRationale: r.comment || undefined,
      suggestedAction: r.suggestedAction || undefined,
      policyPromise,
      policyCoverage: ppdV ? ppdCoverage(ppdV) : undefined,
      items,
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

// Policy promise/clause column — the evidence tab's lead pairing: what the
// PPD review found for this SAME ref, so "policy said X" reads directly
// beside "evidence shows Y" without flipping to the PPD tab. The dot reuses
// the ONE coverage colour scale (COV_DOT, hollow for not-checked — same
// convention as VerdictCell); the text is the row's own ppdExtract (or the
// verdict-summary fallback built in buildEvidenceLines). Long text expands
// in place with the same Show more/less control RationaleCell uses. An
// em-dash means a very old stored run predating the ppdExtract/ppdVerdict
// fields — honest absence, never an error.
// Clamps text at `max` chars with a "Show more/less" toggle — shared by
// PolicyPromiseCell and RationaleCell, which both need the identical pattern.
function ExpandableText({ text, max = 220, style }: { text: string; max?: number; style?: React.CSSProperties }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > max;
  const shown = long && !expanded ? `${text.slice(0, max).trimEnd()}…` : text;
  return (
    <span style={{ fontSize: 11, color: "#475569", lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "normal", ...style }}>
      {shown}
      {long && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }} style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 600, color: "#4338ca", background: "transparent", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}

function PolicyPromiseCell({ promise, coverage }: { promise?: string; coverage?: Coverage }) {
  if (!promise) return <span style={{ color: "#94a3b8" }}>—</span>;
  const hollow = coverage === "not-checked";
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
        {coverage && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: hollow ? "transparent" : COV_DOT[coverage], border: `1.5px solid ${COV_DOT[coverage]}` }} />}
        <span style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>From PPD review</span>
      </div>
      <ExpandableText text={promise} style={{ display: "block" }} />
    </div>
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

// The ONE yellow-highlight treatment for a located quote, shared by every
// place that shows an excerpt (spine detail, Supporting Passage cell) — do
// not re-style a second copy of this <mark>.
function ExcerptSpan({ excerpt }: { excerpt: QuoteExcerpt }) {
  return (
    <>
      {excerpt.clippedStart && "… "}{excerpt.before}
      <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{excerpt.match}</mark>
      {excerpt.after}{excerpt.clippedEnd && " …"}
    </>
  );
}

// Supporting Passage column (evidence tab). Resolves the row's passage quote
// against its source file's extracted text and highlights the exact matched
// span with ExcerptSpan — the SAME logic the spine detail uses, not a second
// implementation. Falls back to plain italic text (no highlight) when the
// source text isn't resolvable yet or the quote can't be located verbatim.
function PassageCell({ source, fallbackText, muted, resolveText }: { source?: { quote: string; sourceFile?: CitedFile }; fallbackText?: string; muted: boolean; resolveText: ResolveText }) {
  const text = source?.sourceFile?.record ? resolveText(source.sourceFile.record) : undefined;
  const excerpt = source && typeof text === "string" ? excerptAround(text, source.quote, 90) : null;
  if (muted || (!fallbackText && !source)) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <span title={fallbackText ?? source?.quote} style={{ fontSize: 11, color: "#475569", fontStyle: "italic", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
      {excerpt ? <ExcerptSpan excerpt={excerpt} /> : (fallbackText ?? source?.quote)}
    </span>
  );
}

// Rationale column. Unlike PassageCell/StackCell's bare "—" (used for
// genuinely-N/A cells, e.g. a flat gap row's Supporting Passage), an empty
// rationale here is never
// "not applicable" — every line's shortComment/comment is meant to carry one.
// A blank one means the AI genuinely returned none for this line, which is
// worth saying plainly rather than hiding behind a dash indistinguishable
// from "nothing to show here".
//
// Long rationale text wraps in full rather than clamping — the same "don't
// crop, wrap instead" convention used for filenames/clauses — up to a soft
// cap; beyond that a "Show more" toggle avoids letting one outlier row blow
// out every row's height by default. suggestedAction (evidence tab, Partial/
// Not met only) renders as a distinct "To reach Met" callout underneath.
function RationaleCell({ text, suggestedAction }: { text?: string; suggestedAction?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {!text ? (
        <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>No rationale returned by the AI for this line</span>
      ) : (
        <ExpandableText text={text} />
      )}
      {suggestedAction && (
        <div style={{ fontSize: 10.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "3px 6px", lineHeight: 1.4 }}>
          <span style={{ fontWeight: 700 }}>To reach Met: </span>{suggestedAction}
        </div>
      )}
    </div>
  );
}

// Vision-provenance tag on quote attributions. Text read by the vision model
// is an AI TRANSCRIPTION of an image/scan, not extracted text — so a quote
// "verified" against it is verified against the transcription, which can
// itself mishear the original. An auditor citing such a quote must know to
// check the original document, so the attribution says so explicitly.
function VisionProvenanceTag({ record }: { record?: AuditFileRecord }) {
  if (record?.readMethod !== "vision") return null;
  return (
    <span style={{ fontSize: 10, color: "#92400e", marginLeft: 5 }}>
      · text extracted by vision (AI transcription) — not verified against the original
    </span>
  );
}

// The located-passage block for ONE sub-part's own check — the exact quote
// states the spine used to stack vertically, now a reusable block placed in
// whichever column owns "the passage" for the active tab (col 2 on the PPD
// tab = the policy quote; col 3/File on the Evidence tab, since col 2 there
// is the linked PPD extract). Returns null when there is genuinely no located
// passage to show (a pure not-found sub-part) — that case is carried by the
// File column's badge + attribution text instead. Every honesty state is
// preserved verbatim: exact-quote highlight, the context-unavailable
// fallback, the real "spread across these passages" list, the non-failure
// "spread across the document" italic, and the quote-unverified warning.
function LocatedPassage({ item, resolveText }: { item: SpineItem; resolveText: ResolveText }) {
  const text = item.sourceFile?.record ? resolveText(item.sourceFile.record) : undefined;
  const quoted = (item.found || item.contradicted) && item.quote;
  // Sentence-boundary-aware windowing (excerptAround itself extends to the
  // nearest REAL sentence start/end, never a fixed character cut) — radius
  // is now the max distance it may search for that boundary, not the exact
  // excerpt length, so a well-punctuated match ends up shorter than this on
  // its own. Raised from the outer matrix's tighter 90 (PassageCell, a
  // 2-line-clamped summary cell — out of scope here) to 400: this column is
  // the reader's actual evidence, so it is allowed to run longer to show a
  // complete sentence rather than compress one to a fixed length. No visual
  // line-clamp on the rendered excerpt below — the row grows taller instead,
  // never clipping real content. A punctuation-free run of text (a raw
  // table/agenda dump with nothing to break it up — the extraction-quality
  // case investigated separately) still caps at this radius rather than
  // growing unboundedly; that is an honest, bounded fallback, not a cut.
  const excerpt = quoted && typeof text === "string" ? excerptAround(text, item.quote!, 400) : null;
  const hasSpread = item.found && item.spreadQuotes && item.spreadQuotes.length > 0;
  const nothingToShow = !quoted && !hasSpread && !(item.found && item.noExactQuote) && !(item.found && item.quoteUnverified);
  if (nothingToShow) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {quoted && excerpt && (
        <div title={item.quote} style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
          <ExcerptSpan excerpt={excerpt} />
        </div>
      )}
      {quoted && !excerpt && (
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
          “{shorten(item.quote!, 600)}” <span style={{ color: "#94a3b8", fontStyle: "italic" }}>(context unavailable — re-run to refresh the cache)</span>
        </div>
      )}
      {/* "Spread across the document" shows the ACTUAL matched passages, not
          just the claim — up to 5, each with its own file attribution; only
          the true diffuse-mention fallback (below) has nothing to show. */}
      {hasSpread && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 10.5, color: "#64748b", fontStyle: "italic" }}>Covered — spread across {item.spreadQuotes!.length > 1 ? "these" : "this"} passage{item.spreadQuotes!.length > 1 ? "s" : ""} rather than one:</div>
          {item.spreadQuotes!.slice(0, 5).map((sq, i) => (
            <div key={i} style={{ fontSize: 11, color: "#475569", lineHeight: 1.5, paddingLeft: 8, borderLeft: "2px solid #e2e8f0" }}>
              “{shorten(sq.quote, 600)}”
              {sq.sourceFile?.name && (
                <div style={{ fontSize: 10.5, marginTop: 2 }}>
                  {sq.sourceFile.url
                    ? <a href={sq.sourceFile.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>from {sq.sourceFile.name} ↗</a>
                    : <span style={{ color: "#64748b" }}>from {sq.sourceFile.name}</span>}
                  <VisionProvenanceTag record={sq.sourceFile.record} />
                </div>
              )}
            </div>
          ))}
          {item.spreadQuotes!.length > 5 && (
            <div style={{ fontSize: 10.5, color: "#94a3b8", fontStyle: "italic", paddingLeft: 8 }}>
              …and {item.spreadQuotes!.length - 5} more spread across the document.
            </div>
          )}
        </div>
      )}
      {/* Non-failure state — must stay reading as "covered" (neutral slate +
          serif italic), never recoloured to look like a gap in the table. */}
      {item.found && item.noExactQuote && !item.quoteUnverified && (
        <div style={{ fontSize: 11.5, color: "#64748b", fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Covered, but spread across the document rather than one passage.
        </div>
      )}
      {/* The AI cited support that failed word-for-word verification against
          the source — say exactly that, never the "spread across" claim
          (which asserts a fact about the document nothing supports here). */}
      {item.found && item.quoteUnverified && (
        <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "3px 6px", lineHeight: 1.45 }}>
          ⚠ The AI cited a supporting passage, but it could not be verified word-for-word against the source document, so it is not shown. Treat this sub-part's coverage with caution — re-running the review may resolve it.
        </div>
      )}
    </div>
  );
}

// Found / Not found / Contradicted pill for the File column (prototype's
// badge). Single coverage axis: green = found, grey = not found, red-tinted
// = contradicted (a distinct not-found variant, same as the spine spelled it
// out in words). Never recolours the non-failure "spread across the document"
// state — that item is `found`, so it reads green here too.
function FoundBadge({ item }: { item: SpineItem }) {
  const [label, bg, fg] = item.found
    ? ["Found", "#dcfce7", "#15803d"]
    : item.contradicted
    ? ["Contradicted", "#fee2e2", "#b91c1c"]
    : ["Not found", "#f1f5f9", "#64748b"];
  return (
    <span style={{ display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 3, background: bg, color: fg }}>{label}</span>
  );
}

// The File column's attribution: the specific source file this sub-part was
// attributed to (via chunkId → resolveSourceFile, so it's the ONE file among
// several the row cites, not the whole row list), as the working "from …↗"
// Drive link, plus the found/not-found badge, plus the honest not-found /
// contradicted sentence naming the file that WAS searched (or a bare "Not
// found." when none was). An old run with no attributed file degrades to an
// em-dash rather than an error.
function FileCell({ item }: { item: SpineItem }) {
  const attr = item.sourceFile?.name;
  const attrUrl = item.sourceFile?.url;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      {attr ? (
        <span style={{ fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word" }}>
          {attrUrl
            ? <a href={attrUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>from {attr} ↗</a>
            : <span style={{ color: "#64748b" }}>from {attr}</span>}
          <VisionProvenanceTag record={item.sourceFile?.record} />
        </span>
      ) : (
        <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
      )}
      <FoundBadge item={item} />
      {!item.found && (
        <span style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.4 }}>
          {item.contradicted ? "Contradicted" : "Not found"}{attr ? ` in ${attr}` : ""}.
        </span>
      )}
    </div>
  );
}

// One clause-matrix row = one sub-part, four cells. Column 2 differs per tab
// (PPD: this sub-part's own policy clause + located quote; Evidence: the
// LINE's linked PPD extract, the same reference promise on every sub-part
// row — carried in via policyPromise/policyCoverage). The evidence-side
// located passage rides in the File column on the evidence tab, since col 2
// there belongs to the PPD reference. Mobile labels (.cm-cell-label) self-
// label each cell once the grid stacks below 900px.
function ClauseRow({ item, isEv, resolveText, headers, policyPromise, policyCoverage }: {
  item: SpineItem; isEv: boolean; resolveText: ResolveText; headers: [string, string, string, string];
  policyPromise?: string; policyCoverage?: Coverage;
}) {
  const barColor = item.found ? "#16a34a" : "#cbd5e1"; // solid green = found, grey = not (single axis)
  const cellStyle: React.CSSProperties = { padding: "11px 14px", borderLeft: "1px solid #f1f5f9", minWidth: 0 };
  const passage = <LocatedPassage item={item} resolveText={resolveText} />;
  return (
    <div className={`clause-matrix-row${isEv ? " cm-ev" : ""}`} style={{ borderTop: "1px solid #f1f5f9", borderLeft: `3px solid ${barColor}` }}>
      {/* Col 1 — Clause requirement (dot + name, muted when not found) */}
      <div style={{ ...cellStyle, borderLeft: "none" }}>
        <span className="cm-cell-label">{headers[0]}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span aria-hidden style={{ marginTop: 4, width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: item.found ? "#16a34a" : "transparent", border: item.found ? "none" : "1.5px solid #94a3b8" }} />
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.45, color: item.found ? "#1e293b" : "#64748b" }}>{item.name}</span>
        </div>
      </div>

      {/* Col 2 — PPD tab: policy clause + located policy quote. Evidence tab:
          the linked PPD extract (reference promise) — same on every row. */}
      <div style={cellStyle}>
        <span className="cm-cell-label">{headers[1]}</span>
        {isEv ? (
          policyPromise ? (
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                {policyCoverage && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: policyCoverage === "not-checked" ? "transparent" : COV_DOT[policyCoverage], border: `1.5px solid ${COV_DOT[policyCoverage]}` }} />}
                <span style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>From PPD review</span>
              </div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, fontStyle: "italic", overflowWrap: "anywhere", wordBreak: "break-word" }}>“{shorten(policyPromise, 300)}”</div>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
          )
        ) : (
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            {item.clause && <div style={{ fontSize: 10.5, fontWeight: 600, color: "#475569" }}>§ {item.clause}</div>}
            {passage ?? <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>}
          </div>
        )}
      </div>

      {/* Col 3 — File: specific attributed file + link + badge, plus (evidence
          tab only) the located evidence passage, since col 2 there is the PPD ref. */}
      <div style={cellStyle}>
        <span className="cm-cell-label">{headers[2]}</span>
        <FileCell item={item} />
        {isEv && passage && <div style={{ marginTop: 6 }}>{passage}</div>}
      </div>

      {/* Col 4 — Remarks / Rationale */}
      <div style={cellStyle}>
        <span className="cm-cell-label">{headers[3]}</span>
        {item.rationale
          ? <span style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5, overflowWrap: "anywhere", wordBreak: "break-word" }}>{item.rationale}</span>
          : <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>—</span>}
      </div>
    </div>
  );
}

// The clause-by-clause detail as a 4-column matrix (replaces the old vertical
// spine): a header row + one ClauseRow per sub-part. Column-2 header/meaning
// is per-tab (see ClauseRow). Passes the line's linked PPD promise down so the
// evidence tab's col 2 can show it on every sub-part row.
function ClauseMatrix({ line, isEv, resolveText }: { line: MatrixLine; isEv: boolean; resolveText: ResolveText }) {
  // Evidence tab: "File" → "File and Supporting passage" — this column now
  // legitimately carries the filename, the working Drive link, the found/
  // not-found badge, AND the located evidence excerpt (Task 1's column-
  // width rebalance gives it ~50% of the row to match). PPD tab keeps its
  // narrower, unchanged "File" column — its own located quote already lives
  // in column 2 ("Policy clause & quote"), so column 3 there is filename-only.
  const headers: [string, string, string, string] = isEv
    ? ["Clause requirement", "PPD clause / extract", "File and Supporting passage", "Remarks"]
    : ["Clause requirement", "Policy clause & quote", "File", "Rationale"];
  const headerCell: React.CSSProperties = { padding: "7px 14px", fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, borderLeft: "1px solid #eef2f6" };
  return (
    <div style={{ border: "1px solid #eef2f6", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
      <div className={`clause-matrix-head${isEv ? " cm-ev" : ""}`} style={{ background: "#f8fafc", borderBottom: "1px solid #eef2f6" }}>
        <span style={{ ...headerCell, borderLeft: "none" }}>{headers[0]}</span>
        <span style={headerCell}>{headers[1]}</span>
        <span style={headerCell}>{headers[2]}</span>
        <span style={headerCell}>{headers[3]}</span>
      </div>
      {line.items.map((it, i) => (
        <ClauseRow key={i} item={it} isEv={isEv} resolveText={resolveText} headers={headers} policyPromise={line.policyPromise} policyCoverage={line.policyCoverage} />
      ))}
    </div>
  );
}

// The expanded detail for one covered/partial row: the clause-by-clause
// matrix (4 columns, see ClauseMatrix — replaced the old vertical spine), a
// "Read the full document" toggle per cited readable file, and "Jump to full
// line detail". Owns the per-file full-text open state. `isEv` selects the
// column-2 semantics (PPD: policy clause & quote; Evidence: linked PPD extract).
function RowDetail({ line, isEv, resolveText, onOpenLine }: { line: MatrixLine; isEv: boolean; resolveText: ResolveText; onOpenLine: (ref: string) => void }) {
  const [fullFile, setFullFile] = useState<string | null>(null);
  const readable = line.files.filter((f) => f.record);
  const firstQuoteFor = (name: string) => line.items.find((it) => it.found && it.quote && it.sourceFile?.name === name)?.quote;

  return (
    <div style={{ margin: "2px 0 8px 26px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, padding: "10px 12px" }}>
      {/* Unconditional — every expanded covered/partial row gets this caption,
          never just some (a prior version dropped it for some row shapes). */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Clause by clause</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>Same detail as a table: what each sub-part required, {isEv ? "the linked PPD promise" : "the matched policy clause"}, the file it was checked in, and why it does or doesn't satisfy the requirement.</div>
      </div>
      <ClauseMatrix line={line} isEv={isEv} resolveText={resolveText} />
      {line.suggestedAction && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", lineHeight: 1.45 }}>
          <span style={{ fontWeight: 700 }}>To reach Met: </span>{line.suggestedAction}
        </div>
      )}
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
  // Export column picker state — hooks live above the empty-lines early
  // return; the handlers that use them are defined further down with the
  // export meta/rows they operate on.
  const [exportPicker, setExportPicker] = useState<"csv" | "pdf" | null>(null);
  const [exportCols, setExportCols] = useState<Set<LineageColumnKey>>(new Set());
  // Clause-by-clause detail is a separate toggle from the column checkboxes
  // (it isn't a flat-matrix column at all) — defaults to included per row,
  // resetting to true every time the picker opens.
  const [includeClauseDetail, setIncludeClauseDetail] = useState(true);
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
  // Evidence tab (approved Policy → Evidence reframe): the NEW Policy
  // promise/clause column takes the lead 1.6fr share the requirement used to
  // hold, the requirement shrinks to a 1.1fr secondary cell, and the verdict/
  // files/passage/rationale columns each give back a little width so all six
  // fit without overflow at the same breakpoints the old five-column layout
  // supported. Policy tab: untouched — its file column keeps the wider share
  // (1.1fr → 1.6fr) plus a 170px floor so full filenames wrap instead of
  // clipping (FileListCell).
  const gridCols = isEv
    ? "minmax(0,1.1fr) minmax(0,1.6fr) 108px minmax(150px,1.4fr) minmax(0,1.3fr) minmax(0,1.4fr)"
    : "minmax(0,2fr) 118px minmax(170px,1.6fr) minmax(0,1.3fr) minmax(0,1.6fr)";
  const headerCell: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 };
  const col4Header = isEv ? "Supporting passage" : "Policy clause";

  // Export reuses EXACTLY the rows currently rendered above — full,
  // untruncated text (the on-screen "+N more"/2-line clamp is display-only;
  // the underlying strings were never truncated) — and only THIS tab's mode,
  // never the other tab's data.
  // Sampling basis: this run's conclusions cover only the files it read.
  const runFileCount = (isEv ? evidence?.fileLedger : ppd?.fileLedger)?.length;
  const runAtIso = isEv ? evidence?.runAt : ppd?.runAt;
  const caveat = samplingCaveat(runFileCount, runAtIso);
  const exportMeta: LineageExportMeta = {
    tab: isEv ? "evidence" : "policy",
    runLabel: runLabel || (isEv ? evidence?.subCriterionId : ppd?.subCriterionId) || "lineage",
    runAt: runAtIso || new Date(0).toISOString(),
    caveat,
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
    suggestedAction: isEv ? l.suggestedAction : undefined,
    policyPromise: isEv ? l.policyPromise : undefined,
    barColor: COV_DOT[l.coverage], // same solid colour scale the verdict dot uses (border-left can't take the on-screen gradient)
    clauseDetail: l.expandable && l.items.length > 0 ? buildClauseDetailExport(l, isEv) : undefined,
  }));
  const exportBtnStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#0f766e", padding: "4px 9px", border: "1px solid #99f6e4", borderRadius: 6, background: "#f0fdfa", whiteSpace: "nowrap", cursor: "pointer" };

  // Export column picker — ONE picker serving both formats (CSV and PDF pick
  // from the SAME lineageColumnsFor registry the builders use). Opens with
  // every column checked, so confirming without touching anything exports
  // exactly what the fixed export always did; unchecking trims columns only —
  // content within a kept column is never truncated. Zero columns can't be
  // exported (the button disables), so the file can never come out empty.
  const exportTab: LineageExportMeta["tab"] = isEv ? "evidence" : "policy";
  const openExportPicker = (format: "csv" | "pdf") => {
    setExportCols(new Set(lineageColumnsFor(exportTab).map((c) => c.key))); // all checked by default
    setIncludeClauseDetail(true); // defaults to included
    setExportPicker(format);
  };
  const toggleExportCol = (key: LineageColumnKey) =>
    setExportCols((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const runExport = () => {
    // Filter the registry (not the Set) so the export keeps matrix order.
    const keys = lineageColumnsFor(exportTab).map((c) => c.key).filter((k) => exportCols.has(k));
    if (keys.length === 0) return;
    if (exportPicker === "csv") downloadLineageCsv(exportMeta, exportRows, keys, includeClauseDetail);
    else openLineagePdf(exportMeta, exportRows, keys, includeClauseDetail);
    setExportPicker(null);
  };

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
            untruncated file/clause lists (no "+N more"). Each button opens
            the column picker (all columns pre-checked) rather than exporting
            immediately. stopPropagation so clicking an export button doesn't
            also collapse the panel. */}
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); openExportPicker("csv"); }} style={exportBtnStyle} title="Choose columns, then download every row above (full file lists) as a CSV">⬇ CSV</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); openExportPicker("pdf"); }} style={exportBtnStyle} title="Choose columns, then open every row above as a printable/PDF table (new tab)">⬇ PDF</button>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Column picker — shown for whichever format was clicked, even while
          the matrix itself is collapsed (the export buttons work either way).
          All columns start checked = exact parity with the old fixed export. */}
      {exportPicker && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 12px", background: "#f0fdfa", borderBottom: "1px solid #f1f5f9" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#0f766e" }}>Columns to include in the {exportPicker === "csv" ? "CSV" : "PDF"}:</span>
          {lineageColumnsFor(exportTab).map((c) => (
            <label key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#334155", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={exportCols.has(c.key)} onChange={() => toggleExportCol(c.key)} />
              {c.label}
            </label>
          ))}
          {/* Not a flat-matrix column — a separate toggle for whether each
              covered/partial line's clause-by-clause sub-parts are exported
              at all (CSV: a flattened row per sub-part; PDF: a nested
              4-column table beneath the line). Defaults to included. */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#334155", cursor: "pointer", whiteSpace: "nowrap", borderLeft: "1px solid #99f6e4", paddingLeft: 12 }}>
            <input type="checkbox" checked={includeClauseDetail} onChange={() => setIncludeClauseDetail((v) => !v)} />
            Clause-by-clause detail
          </label>
          <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
            <button type="button" disabled={exportCols.size === 0} onClick={runExport} style={{ ...exportBtnStyle, opacity: exportCols.size === 0 ? 0.5 : 1, cursor: exportCols.size === 0 ? "not-allowed" : "pointer" }}>
              Export {exportPicker === "csv" ? "CSV" : "PDF"}
            </button>
            <button type="button" onClick={() => setExportPicker(null)} style={{ fontSize: 11, fontWeight: 600, color: "#64748b", padding: "4px 9px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer" }}>Cancel</button>
          </span>
          {exportCols.size === 0 && <span style={{ fontSize: 10.5, color: "#b45309", width: "100%" }}>Select at least one column to export.</span>}
        </div>
      )}

      {open && (
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {/* Sampling basis — same sentence the CSV/PDF exports carry. */}
          <div style={{ fontSize: 10.5, color: "#92400e", padding: "5px 12px", borderBottom: "1px solid #f6f7f9", background: "#fffdf5" }}>{caveat}</div>
          {/* Column headers — aligned with the 3px accent-bar offset below. */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", borderBottom: "1px solid #eef2f6" }}>
            <div style={{ width: 3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: gridCols, gap: 12, padding: "7px 12px 7px 8px", alignItems: "center" }}>
              <span style={headerCell}>GD4 requirement</span>
              {isEv && <span style={headerCell}>Policy promise/clause</span>}
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
                    {/* GD4 requirement (chevron slot reserved so refs align on every row).
                        Evidence tab: secondary/muted treatment — smaller, greyer — the
                        line's identity, not its emphasis (that's the Policy promise). */}
                    <div style={{ minWidth: 0, display: "flex", gap: 6 }}>
                      <span aria-hidden style={{ width: 9, flexShrink: 0, color: "#94a3b8", fontSize: 9, marginTop: 2 }}>{line.expandable ? (isOpen ? "▾" : "▸") : ""}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: isEv ? 10 : 10.5, fontWeight: 700, color: isEv ? "#64748b" : "#4338ca" }}>{line.ref}</span>
                        <span style={{ fontSize: isEv ? 11 : 12, color: isEv ? "#64748b" : "#334155", marginLeft: isEv ? 5 : 6 }} title={line.reqLabel}>{shorten(line.reqLabel, 90)}</span>
                      </span>
                    </div>
                    {isEv && <PolicyPromiseCell promise={line.policyPromise} coverage={line.policyCoverage} />}
                    <VerdictCell coverage={line.coverage} label={line.verdictLabel} />
                    <FileListCell files={line.files} muted={!line.expandable} />
                    {isEv
                      ? <PassageCell source={line.passageSource} fallbackText={line.passagePreview} muted={!line.expandable} resolveText={resolveText} />
                      : <StackCell items={line.clauses} muted={!line.expandable} more="clause" />}
                    <RationaleCell text={line.rowRationale} suggestedAction={isEv ? line.suggestedAction : undefined} />
                  </div>

                  {isOpen && line.expandable && <RowDetail line={line} isEv={isEv} resolveText={resolveText} onOpenLine={onOpenLine} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
