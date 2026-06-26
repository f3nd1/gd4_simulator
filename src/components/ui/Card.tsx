import type { CSSProperties, ReactNode } from "react";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8edf3",
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 1px 2px rgba(16,32,46,0.04), 0 2px 6px rgba(16,32,46,0.05)",
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
