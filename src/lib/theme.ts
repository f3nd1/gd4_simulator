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

// A duller, warmer variant of TONE for the "Bold" display theme — same
// meaning per tone, less saturated background so status pills read as less
// visually loud next to the theme's heavier text weight.
export const TONE_BOLD: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: "#1f6b46", bg: "#e6e9df" },
  progress: { fg: "#454f70", bg: "#e6e4dc" },
  medium: { fg: "#8a641d", bg: "#efe6d3" },
  high: { fg: "#8a3f22", bg: "#ecdccb" },
  critical: { fg: "#96382a", bg: "#ecdcd8" },
  neutral: { fg: "#514a3f", bg: "#e6e2d8" },
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
