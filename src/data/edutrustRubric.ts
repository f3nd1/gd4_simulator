// The OFFICIAL EduTrust band rubric — quoted VERBATIM from the EduTrust
// Guidance Document Version 4 (January 2025), paragraph 23. This file is the
// SINGLE source of truth for band descriptors: every surface that shows a
// band descriptor (Sub-Criterion Checklist band selector, Rubric & Banding
// page, GD4 Library, AI band-suggestion prompt) must import from here.
// Do NOT paraphrase, reword, or add app-invented descriptor sets — the three
// divergent sets this replaced (RubricBanding's BAND_MEANING,
// gd4Requirements' bandDescriptorsFor, band-calibration.md's narratives) were
// exactly that mistake.
//
// The document phrases the result as placing "your Approach, Processes,
// Systems (or Outcomes) and Review ... in a band" (singular) and gives no
// combination formula. An SSG auditor later clarified that actual practice
// scores the four dimensions SEPARATELY and sums them (A=20%+P=20%+S=10%+R=0%
// = 50% → Band 3). The descriptor text below stays verbatim from the document
// and is the source of truth for descriptors; the summing arithmetic lives in
// checklistBanding.ts (pctForScore/finalBandFromPct). Full history and what is
// still unconfirmed: docs/edutrust-band-scoring.md.

import type { Band } from "../types";

export type EdutrustBandLevel = {
  band: Band;
  name: string; // official level name, e.g. "Meeting Expectation"
  approach: string;
  processes: string;
  systemsOutcomes: string;
  review: string;
};

export const EDUTRUST_BANDS: EdutrustBandLevel[] = [
  {
    band: 1,
    name: "Not evident",
    approach: "No organised approach to item requirements is evident",
    processes: "Processes are not in place or in their infancy stage",
    systemsOutcomes: "Systems and outcomes are non-existent",
    review: "No planned review; no improvement is made",
  },
  {
    band: 2,
    name: "Beginning",
    approach: "The beginning of an organised approach is evident",
    processes: "Processes are established but with weak deployment in key areas",
    systemsOutcomes: "Systems do not interact with one another; there are limited outcomes",
    review: "Early stages of review; improvements to systems and processes are limited",
  },
  {
    band: 3,
    name: "Meeting Expectation",
    approach: "An effective and organised approach meeting the minimum requirement is evident",
    processes: "Processes are deployed and well-managed by owners in key areas",
    systemsOutcomes: "Key systems are established, producing limited outcomes",
    review: "There is evidence that the systems and processes are regularly reviewed and action plans for improvement are implemented",
  },
  {
    band: 4,
    name: "Exceeding",
    approach: "An effective, efficient and organised approach meeting overall requirements is evident",
    processes: "Intended processes are well-managed by owners; desired outputs are produced by these processes",
    systemsOutcomes: "Key systems are interacting with one another, producing desired outcomes with no conflicts",
    review: "Implemented action plans for improvement are monitored for effectiveness and to bring about positive impact resulting in favourable outcomes",
  },
  {
    band: 5,
    name: "Excellent",
    approach: "An effective, efficient and well-integrated approach meeting all requirements is evident",
    processes: "All processes are well-managed by owners leading to quality outputs by all processes",
    systemsOutcomes: "All systems are interacting with one another, producing good quality outcomes",
    review: "Many to most trends and current performance levels are evaluated against relevant comparisons and/or benchmarks",
  },
];

// Official dimension definitions (§23 explanatory notes) — shown wherever the
// four dimensions need explaining, and embedded in the AI suggestion prompt.
export const EDUTRUST_DIMENSIONS = [
  { key: "approach", label: "Approach", definition: "Documented policies/procedures, methods, tools, techniques used to carry out the processes." },
  { key: "processes", label: "Processes", definition: "Actual implementation of those policies and procedures." },
  { key: "systemsOutcomes", label: "Systems & Outcomes", definition: "Desired outcome(s) derived from implementation." },
  { key: "review", label: "Review", definition: "Evaluation of appropriateness, relevance and effectiveness of the approach and process for continual improvement, including comparisons/benchmarking against best practice or the PEI's own past performance." },
] as const;

export function bandLevel(band: Band): EdutrustBandLevel {
  return EDUTRUST_BANDS[band - 1];
}

// "Band 3 — Meeting Expectation" — the one canonical way to caption a band.
export function bandTitle(band: Band): string {
  return `Band ${band} — ${bandLevel(band).name}`;
}
