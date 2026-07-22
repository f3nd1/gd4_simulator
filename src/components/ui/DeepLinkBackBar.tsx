import { Link, useSearchParams } from "react-router-dom";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import { scopeTitle } from "../../lib/evidenceScope";

// The pages a deep link can come FROM. `?from=<key>` on the target's URL says
// which one; the bar links back to it, carrying the item so the source scrolls
// back to where you were. rubric-banding is deliberately absent — it has its own
// bespoke scrollTo back link on the Sub-Criterion Checklist.
const SOURCES: Record<string, { path: string; label: string }> = {
  "final-report": { path: "/final-report", label: "Final Report" },
  "sub-checklist": { path: "/sub-checklist", label: "Sub-Criterion Checklist" },
  "findings": { path: "/findings", label: "Findings" },
  "afi-closure": { path: "/afi-closure", label: "Quality Action / AFI" },
  "clarification": { path: "/clarification", label: "Clarification round" },
};

// Human label for the deep-linked item: "4.2.1 Student Contract".
function itemLabel(item: string): string {
  const req = GD4_REQUIREMENTS.find((r) => r.id === item);
  const title = req?.requirement ?? scopeTitle(item);
  return title ? `${item} ${title}` : item;
}

// One-line "← Back to [source] · [item]" wayfinding link, shown only when the
// page was reached via a ?from= deep link. Reused across every ?item= flow so
// the user can always get back to where they came from. Renders nothing when
// there is no recognised source, so it is safe to drop at the top of any page.
export function DeepLinkBackBar() {
  const [params] = useSearchParams();
  const from = params.get("from");
  const item = params.get("item");
  const src = from ? SOURCES[from] : undefined;
  if (!src) return null;
  const to = item ? `${src.path}?item=${encodeURIComponent(item)}` : src.path;
  return (
    <div className="no-print" style={{ marginBottom: 8 }}>
      <Link
        to={to}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#4f46e5", textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}
      >
        ← Back to {src.label}{item ? ` · ${itemLabel(item)}` : ""}
      </Link>
    </div>
  );
}
