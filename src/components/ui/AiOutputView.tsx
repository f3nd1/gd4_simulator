import type { CSSProperties } from "react";

// The one shared renderer for an AI-generated output/prompt block — extracted
// verbatim from the AI Review Log's inline "Output"/"Prompt Sent" body
// (src/pages/AIReview.tsx) so the Prompt Review page reuses the exact same
// presentation instead of building a second output viewer. Pre-wrapped
// monospace so whitespace/newlines in the output are preserved.
export function AiOutputView({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace", fontSize: 11.5, ...style }}>
      {text || <span style={{ color: "#94a3b8" }}>(no content)</span>}
    </div>
  );
}
