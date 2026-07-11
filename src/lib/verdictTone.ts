import type { PPDVerdict, EvidenceVerdict } from "../types";

// Verdict → display tone/color, shared by PPDReview.tsx's tables and
// LineageDiagram.tsx's per-line status pill — one mapping, reused everywhere
// a PPD/Evidence verdict needs a color, so the two surfaces can never
// disagree on what "Adequate"/"Met" etc. look like.

export function ppdVerdictTone(v: PPDVerdict): "good" | "medium" | "critical" | "neutral" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : v === "Not assessed" ? "neutral" : "critical";
}

export function ppdVerdictBorderColor(v: PPDVerdict): string {
  return v === "Adequate" ? "#22c55e" : v === "Partial" ? "#f59e0b" : v === "Not assessed" ? "#94a3b8" : "#ef4444";
}

export function evVerdictTone(v: EvidenceVerdict): "good" | "medium" | "critical" | "neutral" {
  return v === "Met" ? "good" : v === "Partial" ? "medium" : v === "Not assessed" ? "neutral" : "critical";
}

export function evVerdictBorderColor(v: EvidenceVerdict): string {
  return v === "Met" ? "#22c55e" : v === "Partial" ? "#f59e0b" : v === "Not assessed" ? "#94a3b8" : "#ef4444";
}
