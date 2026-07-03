export const GOLD = "#ce9e5d";
export const BLUE = "#8295bd";
export const INK = "#16202e";

export type Tone = "good" | "progress" | "medium" | "high" | "critical" | "neutral";

export const TONE: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: "#1f7a4d", bg: "#e3f3ea" },
  progress: { fg: "#4a5a8a", bg: "#eaeef6" },
  medium: { fg: "#9a6b15", bg: "#faf0d9" },
  high: { fg: "#9a3412", bg: "#ffedd5" },
  critical: { fg: "#b23121", bg: "#fbe7e3" },
  neutral: { fg: "#475569", bg: "#eef1f5" },
};

// Maps a raw status string to a Tone.
export const STATUS_TONE: Record<string, Tone> = {
  good: "good",
  "In Progress": "progress",
  Partial: "medium",
  Missing: "critical",
  Critical: "critical",
  Pass: "good",
  Fail: "critical",
  "At risk": "medium",
  "Not Started": "neutral",
  "Not Applicable": "neutral",
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] || "neutral";
}

export function bandTone(b: number): Tone {
  return b >= 4 ? "good" : b === 3 ? "progress" : b === 2 ? "medium" : "critical";
}

export function gateTone(g: string): Tone {
  return g === "Pass" ? "good" : g === "At risk" ? "medium" : "critical";
}
