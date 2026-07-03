import { INK } from "../../lib/theme";

export function Bar({ v, c }: { v: number; c?: string }) {
  return (
    <div style={{ height: 7, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", margin: "5px 0" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, v))}%`, height: "100%", background: c || INK, borderRadius: 999 }} />
    </div>
  );
}
