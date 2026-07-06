import type { CSSProperties, ReactNode } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

// Card is used on every page for every content surface, so it's the single
// highest-leverage place to reach the "Bold" display theme's warmer, less
// stark background — one flip in Settings reaches virtually the whole app
// without touching every page's inline styles.
export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const bold = useWorkspaceStore((s) => s.uiTheme) === "bold";
  return (
    <div
      className="gd-card"
      style={{
        background: bold ? "#fbf9f4" : "#fff",
        border: bold ? "1px solid #e6ded0" : "1px solid #e8edf3",
        borderRadius: 14,
        padding: 18,
        boxShadow: bold ? "0 1px 2px rgba(43,32,16,0.05), 0 2px 6px rgba(43,32,16,0.06)" : "0 1px 2px rgba(16,32,46,0.04), 0 2px 6px rgba(16,32,46,0.05)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const filterSelectStyle: CSSProperties = {
  ...inputStyle,
  width: "auto",
  flex: "1 1 150px",
  minWidth: 0,
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
