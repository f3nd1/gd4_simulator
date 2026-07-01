import { useState } from "react";

type Props = {
  onAccept: () => void;
  onReject: () => void;
  size?: "sm" | "md";
};

export function ThumbsButtons({ onAccept, onReject, size = "sm" }: Props) {
  const [logged, setLogged] = useState(false);

  function handleAccept() {
    onAccept();
    setLogged(true);
    setTimeout(() => setLogged(false), 1800);
  }

  const pad = size === "md" ? "3px 9px" : "2px 6px";
  const fs  = size === "md" ? 13 : 12;

  if (logged) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: fs, padding: pad, borderRadius: 5, background: "#dcfce7", color: "#15803d", fontWeight: 600, border: "1px solid #bbf7d0" }}>
          ✓ Logged
        </span>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        onClick={handleAccept}
        title="AI was helpful — log as accepted"
        style={{ background: "none", border: "1px solid #d1fae5", borderRadius: 5, cursor: "pointer", fontSize: fs, padding: pad, color: "#15803d" }}
      >
        👍
      </button>
      <button
        onClick={onReject}
        title="AI was wrong — give feedback"
        style={{ background: "none", border: "1px solid #fee2e2", borderRadius: 5, cursor: "pointer", fontSize: fs, padding: pad, color: "#b91c1c" }}
      >
        👎
      </button>
    </span>
  );
}
