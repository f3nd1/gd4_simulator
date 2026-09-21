// Who is accountable for each GD4 area, and who audits it.
//
// Taken from the approved workbook's "Person in Charge and Internal Auditors"
// table. Stored by AUDITOR ID, never by name: "Dr Yasser" and "Dr Yasser
// Mattar" appear in the same sheet for the same person, and independence
// needs a roster profile on both sides, which a name cannot give.
//
// Keyed by RUN SCOPE, all 30 of them, not by the workbook's grouped rows.
// The workbook groups 2.1, 2.3, 2.4, 4.2, 5.1 and 5.2 for compactness; storing
// the groups would need a second group-to-scope mapping, which is the duplicate
// source of truth this repo keeps refusing to create. The setup screen offers
// the same grouping as a bulk edit, so the typing effort is unchanged.
//
// PIC means ACCOUNTABLE MANAGER, confirmed by the audit lead. It is NOT the
// owning department's process owner: on 22 of the 30 areas the PIC belongs to
// a different department from the one that owns the procedures. So a PIC being
// from another department is NOT an independence finding; only an AUDITOR
// whose own department owns the area is.

export type AreaAssignment = { picId?: string; auditorIds: string[] };

const F = "AUD-FELIX", R = "AUD-RENZO", I = "AUD-IRENE", W = "AUD-WENDY";
const Z = "AUD-ZHENGLIN", Y = "AUD-YASSER", J = "AUD-JOBELLE";

// The workbook's grouped rows, expanded to the run scopes each one covers.
const GROUPS: { scopes: string[]; picId: string; auditorIds: string[] }[] = [
  { scopes: ["1.1"],                     picId: F, auditorIds: [R, I, Y] },
  { scopes: ["1.2"],                     picId: F, auditorIds: [R, I, Y] },
  { scopes: ["2.1.1", "2.1.2"],          picId: I, auditorIds: [W, F, Y] },
  { scopes: ["2.2"],                     picId: J, auditorIds: [Z, R, F] },
  { scopes: ["2.3.1", "2.3.2"],          picId: R, auditorIds: [I, W, F] },
  { scopes: ["2.4.1", "2.4.2", "2.4.3"], picId: I, auditorIds: [W, F, Y] },
  { scopes: ["3.1"],                     picId: F, auditorIds: [R, Z, W] },
  { scopes: ["3.2"],                     picId: F, auditorIds: [R, Z, W] },
  { scopes: ["4.1"],                     picId: W, auditorIds: [R, I, F] },
  { scopes: ["4.2.1", "4.2.2"],          picId: W, auditorIds: [R, I, F] },
  { scopes: ["4.3"],                     picId: W, auditorIds: [R, I, F] },
  { scopes: ["4.4"],                     picId: W, auditorIds: [R, I, F] },
  { scopes: ["4.5"],                     picId: W, auditorIds: [R, I, F] },
  { scopes: ["4.6"],                     picId: W, auditorIds: [R, I, F] },
  { scopes: ["5.1.1", "5.1.2"],          picId: Y, auditorIds: [W, Z, F] },
  { scopes: ["5.2.1", "5.2.2"],          picId: Y, auditorIds: [W, Z, F] },
  { scopes: ["5.3"],                     picId: Y, auditorIds: [W, Z, F] },
  { scopes: ["5.4"],                     picId: Y, auditorIds: [W, Z, F] },
  { scopes: ["5.5"],                     picId: Y, auditorIds: [W, Z, F] },
  { scopes: ["6.1"],                     picId: F, auditorIds: [R, W, Y] },
  { scopes: ["6.2"],                     picId: F, auditorIds: [Z, I, Y] },
  { scopes: ["6.3"],                     picId: F, auditorIds: [R, Z, Y] },
  // The workbook's row reads "7.1 / 7.2". 7.2 Achievement of Outcomes was
  // folded into 7.1.1 for this PEI on 2026-07-05, so this is one assignment
  // over one scope, not a missing area.
  { scopes: ["7.1"],                     picId: F, auditorIds: [R, I, Y] },
];

export const DEFAULT_AREA_ASSIGNMENTS: Record<string, AreaAssignment> =
  Object.fromEntries(GROUPS.flatMap((g) => g.scopes.map((s) => [s, { picId: g.picId, auditorIds: g.auditorIds }])));

// The grouping the setup screen offers, so a change to "2.4" edits its three
// scopes in one go. Display only.
export const ASSIGNMENT_GROUPS: { label: string; scopes: string[] }[] =
  GROUPS.map((g) => ({ label: g.scopes.length === 1 ? g.scopes[0] : g.scopes[0].split(".").slice(0, 2).join("."), scopes: g.scopes }));
