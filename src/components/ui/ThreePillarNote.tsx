// Scope disclosure: EduTrust certification has three pillars confirmed by SSG
// (Process Quality, Student Numbers, Financial Capacity). This tool models only
// Process Quality — the overall score/band it shows is NOT a whole-certification
// verdict. Shown wherever that score/band is prominent (Dashboard, Final Report,
// Export Centre) so it is never mistaken for the full SSG assessment. One
// component + one string so the wording can't drift between placements. Matches
// the existing inline "internal simulation only" muted-line pattern; `dark` is
// for the INK score cards, the default reads on light pages.
export const THREE_PILLAR_NOTE =
  "This tool assesses Process Quality only, one of three EduTrust certification pillars confirmed by SSG. Student Numbers and Financial Capacity are assessed separately by SSG and are not represented in this tool.";

export function ThreePillarNote({ dark }: { dark?: boolean }) {
  return (
    <div style={{ fontSize: 11, color: dark ? "#7e8da0" : "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
      {THREE_PILLAR_NOTE}
    </div>
  );
}
