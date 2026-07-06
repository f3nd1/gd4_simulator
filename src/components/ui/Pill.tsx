import type { ReactNode } from "react";
import { TONE, TONE_BOLD, toneFor, type Tone } from "../../lib/theme";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

export function Pill({ s, children }: { s: string; children?: ReactNode }) {
  const bold = useWorkspaceStore((st) => st.uiTheme) === "bold";
  const tone: Tone = (TONE as Record<string, unknown>)[s] ? (s as Tone) : toneFor(s);
  const t = (bold ? TONE_BOLD : TONE)[tone];
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 11.5,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        margin: 2,
        display: "inline-block",
      }}
    >
      {children ?? s}
    </span>
  );
}
