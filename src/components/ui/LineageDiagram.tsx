import { useCallback, useMemo, useState } from "react";
import { normalizeAuditRef } from "../../lib/gd4Refs";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ExtractedTextPanel } from "./ExtractedTextPanel";
import { excerptAround, findQuoteSpan } from "./quoteMatch";
import type { PPDReviewResult, PPDReviewRow, EvidenceAssessmentResult, EvidenceAssessmentRow, EvidenceFileRef, AuditFileRecord, PPDVerdict, EvidenceVerdict } from "../../types";

// Requirement → Policy → Evidence coverage MATRIX.
//
// A read-only view of data ALREADY computed per requirement line by the PPD
// review / evidence assessment — no recompute, no re-fetch, no change to any
// verdict/quote/scoring logic. It renders as an aligned MATRIX with real
// column headers, scannable straight down each column without expanding:
//   PPD Review tab (4 cols): Ref | Requirement | Policy verdict | Policy file(s)
//   Evidence tab   (6 cols): + Evidence verdict | Evidence file(s)
//
// ONE colour axis: a per-row left-edge bar encodes COVERAGE only — solid green
// (covered), half-amber (partial), plain grey (not covered), dotted grey (not
// checked). Verdict cells repeat that coverage colour as a small dot + text;
// colour is used for nothing else. The yellow highlight on a matched quote is
// a text-highlight of the located passage, not a status colour.
//
// MULTI-FILE IS REAL. A requirement can be backed by several policy files AND
// several evidence files: policy citations come from the row's chunkIds mapped
// through chunkFileNames; evidence citations from the row's evidenceFiles list.
// The file cell stacks up to two names then "+N more file(s)". (The stored data
// always supported this — the earlier one-file-per-verdict display was a bug.)
//
// Covered/partial rows expand to a SPINE detail (a single 1px rule with items
// hanging off it, filled dot = found, hollow = not found) — two columns on the
// Evidence tab ("What the policy says" | "What the evidence shows"), one on the
// PPD tab. Each found sub-part shows its plain-English name, the located passage
// (context faint, matched sentence highlighted), and a mandatory "from
// <filename> ↗" attribution so every quote traces to its true source file when
// several files back one requirement. A sub-part checked but with no single
// locatable quote keeps its honest, NON-failure note ("Covered, but spread
// across the document…"). Gap and unchecked rows are FLAT and non-expandable —
// an em-dash in the file column, nothing to drill into.

type Coverage = "covered" | "partial" | "not-covered" | "not-checked";

// One cited source file: its name, a Drive link where resolvable, and (where
// the run's ledger has it) the AuditFileRecord so its extracted text can be
// read from the cache for highlighting.
type CitedFile = { name: string; url?: string; record?: AuditFileRecord };

// One independently-checked sub-part of a requirement line, resolved for
// display. `found` drives the spine dot (filled vs hollow); the rest is the
// located passage + its source-file attribution, or an honest gap/absence.
type SpineItem = {
  name: string;            // plain-English sub-part name (never "Sub-part C")
  found: boolean;
  quote?: string;          // verbatim excerpt to locate + highlight
  noExactQuote?: boolean;  // covered but no single locatable passage (honest, NOT a failure)
  contradicted?: boolean;  // evidence-only: the passage contradicts the promise
  sourceFile?: CitedFile;  // which file this passage/absence pertains to
};

type SideDetail = { files: CitedFile[]; items: SpineItem[] };
type SideData = { coverage: Coverage; label: string; files: CitedFile[]; detail?: SideDetail };
type MatrixLine = {
  ref: string;
  reqLabel: string;
  rowCoverage: Coverage;   // combined verdict → left bar + expandability
  expandable: boolean;
  policy: SideData;
  evidence?: SideData;     // Evidence tab only
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

const POLICY_LABEL: Record<Coverage, string> = { covered: "Documented", partial: "Partly", "not-covered": "Not covered", "not-checked": "Not checked" };
const EVID_LABEL: Record<Coverage, string> = { covered: "Evidenced", partial: "Partly", "not-covered": "No evidence", "not-checked": "Not checked" };
// The single coverage colour scale, reused by the left bar and the verdict dots.
const COV_DOT: Record<Coverage, string> = { covered: "#16a34a", partial: "#d97706", "not-covered": "#94a3b8", "not-checked": "#94a3b8" };
function coverageBar(c: Coverage): string {
  if (c === "covered") return "#16a34a";
  if (c === "partial") return "linear-gradient(180deg,#f59e0b 0 50%,#e2e8f0 50% 100%)";
  if (c === "not-covered") return "#cbd5e1";
  return "repeating-linear-gradient(180deg,#cbd5e1 0 3px,transparent 3px 7px)"; // not-checked → dotted
}

// Policy files a row cites: unique source-file names across its chunkIds,
// resolved to their ledger records (for extracted text + Drive link). The
// list — not just chunkIds[0] — so every backing policy file surfaces.
function citedPolicyFiles(chunkIds: string[], chunkFileNames?: Record<string, string>, ledger?: AuditFileRecord[]): CitedFile[] {
  return uniqStrings(chunkIds.map((id) => chunkFileNames?.[id])).map((name) => {
    const record = ledger?.find((f) => f.name === name);
    return { name, record, url: driveUrlFor(record) };
  });
}

// Evidence files a row cites: the row's own evidenceFiles list (already
// {name,url}), resolved to ledger records where available so their extracted
// text can be read for highlighting.
function citedEvidenceFiles(files: EvidenceFileRef[], ledger?: AuditFileRecord[]): CitedFile[] {
  return files.map((f) => ({ name: f.name, url: f.url, record: ledger?.find((r) => r.name === f.name) }));
}

type ResolveText = (f: AuditFileRecord) => string | null | undefined;

// Attribute a located quote to whichever cited file's extracted text actually
// contains it — the SAME verbatim match (findQuoteSpan) the highlighter uses,
// so when several files back one requirement each quote names its true source.
// Never guesses: returns undefined if no cited file's cached text contains it.
function attributeQuote(quote: string, files: CitedFile[], resolveText: ResolveText): CitedFile | undefined {
  for (const cf of files) {
    const text = cf.record ? resolveText(cf.record) : undefined;
    if (typeof text === "string" && findQuoteSpan(text, quote)) return cf;
  }
  return undefined;
}

// PPD-side spine: the STEP 1 sub-clause decomposition (each its own
// documented/not verdict + own quote), else a single line-level fallback.
function policySpine(row: PPDReviewRow, files: CitedFile[], resolveText: ResolveText): SpineItem[] {
  const subs = row.subClauses;
  const only = files.length === 1 ? files[0] : undefined;
  if (subs && subs.length > 0) {
    return subs.map((sc) => {
      if (sc.verdict === "documented") {
        if (sc.quote) {
          const src = attributeQuote(sc.quote, files, resolveText) ?? only;
          return { name: sc.text, found: true, quote: sc.quote, sourceFile: src };
        }
        return { name: sc.text, found: true, noExactQuote: true, sourceFile: only };
      }
      return { name: sc.text, found: false, sourceFile: only };
    });
  }
  // No decomposition — single line-level item (same fallback as before).
  if (row.supportQuote) {
    const src = attributeQuote(row.supportQuote, files, resolveText) ?? files[0];
    return [{ name: "This requirement", found: true, quote: row.supportQuote, sourceFile: src }];
  }
  return [{ name: "This requirement", found: true, noExactQuote: true, sourceFile: files[0] }];
}

// Evidence-side spine: each PPD promise verified against the Actual Evidence
// (evidenced / not evidenced / contradicted), each carrying its own chunkIds
// so its passage attributes directly to a file.
function evidenceSpine(row: EvidenceAssessmentRow, files: CitedFile[], chunkFileNames: Record<string, string> | undefined, resolveText: ResolveText): SpineItem[] {
  const checks = row.promiseChecks;
  const only = files.length === 1 ? files[0] : undefined;
  const byName = (name?: string): CitedFile | undefined => (name ? (files.find((f) => f.name === name) ?? { name }) : undefined);
  if (checks && checks.length > 0) {
    return checks.map((c) => {
      const named = byName(uniqStrings(c.chunkIds.map((id) => chunkFileNames?.[id]))[0]);
      if (c.verdict === "evidenced") {
        if (c.quote) {
          const src = attributeQuote(c.quote, files, resolveText) ?? named ?? only;
          return { name: c.promiseText, found: true, quote: c.quote, sourceFile: src };
        }
        return { name: c.promiseText, found: true, noExactQuote: true, sourceFile: named ?? only };
      }
      if (c.verdict === "contradicted") {
        const src = c.quote ? (attributeQuote(c.quote, files, resolveText) ?? named) : named;
        return { name: c.promiseText, found: false, contradicted: true, quote: c.quote, sourceFile: src };
      }
      return { name: c.promiseText, found: false, sourceFile: named };
    });
  }
  if (row.evidenceQuote) {
    const src = attributeQuote(row.evidenceQuote, files, resolveText) ?? files[0];
    return [{ name: "This requirement", found: true, quote: row.evidenceQuote, sourceFile: src }];
  }
  return [{ name: "This requirement", found: true, noExactQuote: true, sourceFile: files[0] }];
}

function buildPpdLines(ppd: PPDReviewResult, resolveText: ResolveText): MatrixLine[] {
  return ppd.rows.map((r) => {
    const cov = ppdCoverage(r.verdict);
    const files = citedPolicyFiles(r.chunkIds, ppd.chunkFileNames, ppd.fileLedger);
    const expandable = cov === "covered" || cov === "partial";
    return {
      ref: r.ref, reqLabel: r.requirementText, rowCoverage: cov, expandable,
      policy: { coverage: cov, label: POLICY_LABEL[cov], files, detail: expandable ? { files, items: policySpine(r, files, resolveText) } : undefined },
    };
  });
}

function buildEvidenceLines(ev: EvidenceAssessmentResult, ppd: PPDReviewResult | undefined, resolveText: ResolveText): MatrixLine[] {
  const ppdByRef = new Map<string, PPDReviewRow>();
  if (ppd) for (const r of ppd.rows) ppdByRef.set(normalizeAuditRef(r.ref), r);
  return ev.rows.map((r) => {
    const pr = ppdByRef.get(normalizeAuditRef(r.gdRef));
    const pcov = ppdCoverage(r.ppdVerdict);
    const ecov = evCoverage(r.verdict); // combined verdict → row bar + expandability
    const policyFiles = pr ? citedPolicyFiles(pr.chunkIds, ppd?.chunkFileNames, ppd?.fileLedger) : [];
    const evidenceFiles = citedEvidenceFiles(r.evidenceFiles, ev.fileLedger);
    const expandable = ecov === "covered" || ecov === "partial";
    return {
      ref: r.gdRef, reqLabel: r.requirementText, rowCoverage: ecov, expandable,
      policy: { coverage: pcov, label: POLICY_LABEL[pcov], files: policyFiles, detail: expandable ? { files: policyFiles, items: pr ? policySpine(pr, policyFiles, resolveText) : [] } : undefined },
      evidence: { coverage: ecov, label: EVID_LABEL[ecov], files: evidenceFiles, detail: expandable ? { files: evidenceFiles, items: evidenceSpine(r, evidenceFiles, ev.chunkFileNames, resolveText) } : undefined },
    };
  });
}

// ── Cell / detail sub-components ────────────────────────────────────────────

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

// Up to two filenames, then "+N more file(s)". Em-dash on a flat row (nothing
// to drill into) or when this side cited no file at all.
function FileCell({ files, muted }: { files: CitedFile[]; muted: boolean }) {
  if (muted || files.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  const show = files.slice(0, 2);
  const more = files.length - show.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      {show.map((f) => (
        <span key={f.name} title={f.name} style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
      ))}
      {more > 0 && <span style={{ fontSize: 10.5, color: "#94a3b8" }}>+{more} more file{more === 1 ? "" : "s"}</span>}
    </div>
  );
}

function SpineItemView({ item, resolveText }: { item: SpineItem; resolveText: ResolveText }) {
  const text = item.sourceFile?.record ? resolveText(item.sourceFile.record) : undefined;
  const excerpt = item.found && item.quote && typeof text === "string" ? excerptAround(text, item.quote) : null;
  const attribution = item.sourceFile?.name;
  const attrUrl = item.sourceFile?.url;

  return (
    <div style={{ position: "relative", paddingLeft: 2 }}>
      {/* Spine dot: filled = found, hollow = not found (shape, not colour). */}
      <span aria-hidden style={{ position: "absolute", left: -18, top: 3, width: 8, height: 8, borderRadius: "50%", background: item.found ? "#64748b" : "transparent", border: "1.5px solid #94a3b8" }} />
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#334155", marginBottom: 3 }}>{item.name}</div>

      {item.found && item.quote && excerpt && (
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
          {excerpt.clippedStart && "… "}{excerpt.before}
          <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{excerpt.match}</mark>
          {excerpt.after}{excerpt.clippedEnd && " …"}
        </div>
      )}
      {item.found && item.quote && !excerpt && (
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
          “{shorten(item.quote, 220)}” <span style={{ color: "#94a3b8", fontStyle: "italic" }}>(context unavailable — re-run to refresh the cache)</span>
        </div>
      )}
      {item.found && item.noExactQuote && (
        <div style={{ fontSize: 11.5, color: "#64748b", fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Covered, but spread across the document rather than one passage.
        </div>
      )}
      {item.contradicted && item.quote && excerpt === null && typeof text === "string" && (
        // Contradicting passage, when its own excerpt couldn't be located, still shown as plain text.
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>“{shorten(item.quote, 220)}”</div>
      )}
      {item.contradicted && item.quote && excerpt && (
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
          {excerpt.clippedStart && "… "}{excerpt.before}
          <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{excerpt.match}</mark>
          {excerpt.after}{excerpt.clippedEnd && " …"}
        </div>
      )}

      {/* Attribution — mandatory for a found passage; also names the file
          searched for a not-found / contradicted sub-part. */}
      {item.found ? (
        attribution && (
          <div style={{ fontSize: 10.5, marginTop: 3 }}>
            {attrUrl
              ? <a href={attrUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#4338ca", textDecoration: "none" }}>from {attribution} ↗</a>
              : <span style={{ color: "#64748b" }}>from {attribution}</span>}
          </div>
        )
      ) : (
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {item.contradicted ? "Contradicted" : "Not found"}{attribution ? ` in ${attribution}` : ""}.
        </div>
      )}
    </div>
  );
}

function DetailColumn({ title, detail, resolveText }: { title: string; detail: SideDetail; resolveText: ResolveText }) {
  const [fullFile, setFullFile] = useState<string | null>(null);
  const n = detail.files.length;
  const readable = detail.files.filter((f) => f.record);
  // Highlight, in each file's full-text view, the first located quote that
  // this column attributed to that file.
  const firstQuoteFor = (name: string) => detail.items.find((it) => it.found && it.quote && it.sourceFile?.name === name)?.quote;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 8 }}>
        {n > 0 ? `${n} file${n === 1 ? "" : "s"} · each passage below names its source` : "No file cited"}
      </div>
      {detail.items.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#94a3b8", fontStyle: "italic" }}>No sub-parts to show.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderLeft: "1px solid #e2e8f0", marginLeft: 4, paddingLeft: 16 }}>
          {detail.items.map((it, i) => <SpineItemView key={i} item={it} resolveText={resolveText} />)}
        </div>
      )}
      {readable.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
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

export function LineageDiagram({ mode, ppd, evidence, onOpenLine }: {
  mode: "ppd" | "evidence";
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
  onOpenLine: (ref: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback<ResolveText>(
    (f) => (f.driveFileId ? fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text : undefined),
    [fileTextCache]
  );

  const lines = useMemo<MatrixLine[]>(
    () => (mode === "ppd" ? (ppd ? buildPpdLines(ppd, resolveText) : []) : (evidence ? buildEvidenceLines(evidence, ppd, resolveText) : [])),
    [mode, ppd, evidence, resolveText]
  );
  if (lines.length === 0) return null;

  const gaps = lines.filter((l) => l.rowCoverage === "not-covered" || l.rowCoverage === "not-checked").length;
  // Header + every row share this template so columns line up down the matrix.
  const gridCols = mode === "evidence"
    ? "minmax(64px,auto) minmax(0,1.9fr) 104px minmax(0,1.05fr) 104px minmax(0,1.05fr)"
    : "minmax(64px,auto) minmax(0,2.2fr) 104px minmax(0,1.5fr)";
  const headerCell: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 };

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 12, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: open ? "1px solid #f1f5f9" : "none", flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Requirement → Policy{mode === "evidence" ? " → Evidence" : ""} map
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{lines.length} line{lines.length !== 1 ? "s" : ""}{gaps > 0 ? ` · ${gaps} with a gap` : " · all covered"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, fontSize: 10.5, color: "#64748b", flexWrap: "wrap" }}>
          <LegendSwatch bar={coverageBar("covered")} label="covered" />
          <LegendSwatch bar={coverageBar("partial")} label="partial" />
          <LegendSwatch bar={coverageBar("not-covered")} label="not covered" />
          <LegendSwatch bar={coverageBar("not-checked")} label="not checked" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 3px" }}>abc</mark> exact quote
          </span>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {/* Column headers — aligned with the 3px accent-bar offset below. */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", borderBottom: "1px solid #eef2f6" }}>
            <div style={{ width: 3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: gridCols, gap: 12, padding: "7px 12px 7px 8px", alignItems: "center" }}>
              <span style={headerCell}>Ref</span>
              <span style={headerCell}>Requirement</span>
              <span style={headerCell}>Policy verdict</span>
              <span style={headerCell}>Policy file(s)</span>
              {mode === "evidence" && <span style={headerCell}>Evidence verdict</span>}
              {mode === "evidence" && <span style={headerCell}>Evidence file(s)</span>}
            </div>
          </div>

          {lines.map((line, i) => {
            const isOpen = openRef === line.ref;
            return (
              <div key={line.ref + i} style={{ display: "flex", alignItems: "stretch", borderTop: i ? "1px solid #f6f7f9" : "none" }}>
                {/* Left accent bar — the ONE coverage colour; spans row + detail. */}
                <div aria-hidden style={{ width: 3, flexShrink: 0, background: coverageBar(line.rowCoverage) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={line.expandable ? () => setOpenRef(isOpen ? null : line.ref) : undefined}
                    style={{ display: "grid", gridTemplateColumns: gridCols, gap: 12, padding: "7px 12px 7px 8px", alignItems: "center", cursor: line.expandable ? "pointer" : "default" }}
                  >
                    {/* Ref (+ chevron slot, reserved so refs align on every row) */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                      <span aria-hidden style={{ width: 9, flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{line.expandable ? (isOpen ? "▾" : "▸") : ""}</span>
                      <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, fontWeight: 700, color: "#4338ca", whiteSpace: "nowrap" }}>{line.ref}</span>
                    </span>
                    <span style={{ fontSize: 12, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={line.reqLabel}>{shorten(line.reqLabel)}</span>
                    <VerdictCell coverage={line.policy.coverage} label={line.policy.label} />
                    <FileCell files={line.policy.files} muted={!line.expandable} />
                    {mode === "evidence" && line.evidence && <VerdictCell coverage={line.evidence.coverage} label={line.evidence.label} />}
                    {mode === "evidence" && line.evidence && <FileCell files={line.evidence.files} muted={!line.expandable} />}
                  </div>

                  {/* Detail spine — covered/partial rows only. */}
                  {isOpen && line.expandable && (
                    <div style={{ padding: "4px 14px 12px 24px" }}>
                      {mode === "evidence" && line.evidence?.detail && line.policy.detail ? (
                        <div className="lineage-detail-cols">
                          <DetailColumn title="What the policy says" detail={line.policy.detail} resolveText={resolveText} />
                          <DetailColumn title="What the evidence shows" detail={line.evidence.detail} resolveText={resolveText} />
                        </div>
                      ) : line.policy.detail ? (
                        <DetailColumn title="What the policy says" detail={line.policy.detail} resolveText={resolveText} />
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenLine(line.ref); }}
                        style={{ marginTop: 10, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4338ca", border: "none", background: "transparent", padding: 0 }}
                      >
                        Jump to full line detail →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
