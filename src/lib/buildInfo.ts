// Which build is running, for the screen and for anything filed as a working
// paper.
//
// ONE source: __GIT_INFO__, the constant vite.config.ts bakes in from
// `git rev-parse --short HEAD` at `vite build` time (the same constant the
// Change Log page and the developer footer already read). It cannot go stale,
// because it is not a string anybody edits — it is produced by the build that
// produced the bundle it sits in. A hand-maintained version string would go
// stale exactly when it matters most: the three "the fix did not work" reports
// this project has had were all a stale bundle, and a label someone forgot to
// bump would have made each one invisible instead of obvious.
//
// Guarded because the constant does not exist outside a vite build (a bare
// `tsc`/node import, or a test that loads this file without the define).

function info(): { hash: string; isoTime: string } {
  try {
    const g = __GIT_INFO__;
    return { hash: g?.hash || "unknown", isoTime: g?.isoTime || "" };
  } catch {
    return { hash: "unknown", isoTime: "" };
  }
}

export const BUILD_HASH = info().hash;

// "a1b2c3d · 18 Sep 2026" — short enough for a footer line and for one cell of
// a spreadsheet, specific enough to match against the Change Log.
export function buildLabel(): string {
  const { hash, isoTime } = info();
  if (!isoTime) return hash;
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return hash;
  return `${hash} · ${d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}`;
}

// The line that rides into an exported working paper, so a filed copy records
// which build produced it.
export function buildStamp(): string {
  return `Produced by gd4_simulator build ${buildLabel()}.`;
}
