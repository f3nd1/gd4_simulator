// Who you are signed in as, and the way out.
//
// This used to be an 11.5px grey line sitting in the content column above the
// page. Process owners use this app on shared office machines, where the way
// out has to be where people look for it: the top right of the chrome, at
// every width. `tone` exists because the workspace header is dark ink and the
// self-check page, which renders outside that header, is white.
import { useState } from "react";
import { useSession, signOut } from "../../lib/auth/useSession";
import { wipeThisDevice } from "../../lib/auth/deviceWipe";
import { flushPendingSaves } from "../../store/supabaseStorage";

type Tone = "dark" | "light";

const PALETTE: Record<Tone, { text: string; action: string; border: string }> = {
  dark: { text: "#aeb8c7", action: "#f0d290", border: "#3a4660" },
  light: { text: "#64748b", action: "#6d28d9", border: "#cbd5e1" },
};

export function SignedInAs({ tone = "light" }: { tone?: Tone }) {
  const state = useSession();
  const [asking, setAsking] = useState(false);
  if (state.status !== "signed-in") return null;
  const c = PALETTE[tone];
  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: c.text, minWidth: 0 }}>
        {/* The address is the nice-to-have; the button is the point. It is the
            address that goes at narrow widths, never the way out. */}
        <span className="hidden sm:inline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.email}
        </span>
        <button
          type="button"
          onClick={() => setAsking(true)}
          style={{
            flexShrink: 0, cursor: "pointer", font: "inherit", fontWeight: 700,
            color: c.action, background: "transparent", border: `1px solid ${c.border}`,
            borderRadius: 7, padding: "4px 10px", lineHeight: 1.3,
          }}
        >
          Sign out
        </button>
      </span>
      {asking && <SignOutPanel email={state.email} onCancel={() => setAsking(false)} />}
    </>
  );
}

// Signing out clears the Supabase session and nothing else: the workspace, the
// findings and the OpenAI key stay in this browser's storage (lib/auth/
// deviceWipe.ts). On a shared machine that is the whole question, so it is
// stated here rather than left to be discovered.
function SignOutPanel({ email, onCancel }: { email: string; onCancel: () => void }) {
  const [refused, setRefused] = useState("");
  const [saving, setSaving] = useState(false);
  const leave = (wipe: boolean) => {
    if (wipe) {
      const plan = wipeThisDevice();
      if (!plan.ok) { setRefused(plan.reason); return; }
    }
    void signOut();
    onCancel();
  };
  // Without this the refusal is a dead end. The markers it trips on are
  // written whenever an upload failed, including a brief network blip, and
  // they survive until the value goes up — so someone standing at a shared
  // machine was told "no" with nothing to do about it. Found by running it,
  // not by reading it: the markers appear in ordinary use.
  const saveThenRetry = async () => {
    setSaving(true);
    try { await flushPendingSaves(); } catch { /* the re-check below is the real answer */ }
    setSaving(false);
    const plan = wipeThisDevice();
    if (!plan.ok) { setRefused(plan.reason); return; }
    void signOut();
    onCancel();
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign out"
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 430, background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "22px 20px", boxSizing: "border-box", boxShadow: "0 10px 30px rgba(15,23,42,.18)" }}
      >
        <h2 style={{ margin: 0, fontSize: 17, color: "#1f2733" }}>Sign out of the audit app?</h2>
        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: "10px 0 0" }}>
          You are signed in as <b style={{ color: "#1f2733" }}>{email}</b>. Signing out ends your session,
          so nobody can open this app on this computer without signing in again.
        </p>
        <p style={{ fontSize: 12.5, color: "#92400e", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 9, padding: "10px 12px", lineHeight: 1.55, margin: "12px 0 0" }}>
          A copy of the workspace stays saved in this browser after you sign out. Nobody can see it on
          screen without signing in, but on a shared or public computer you should remove it. Everything
          is safely stored in the database and comes back the next time you sign in.
        </p>
        {refused && (
          <div style={{ fontSize: 12.5, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, padding: "10px 12px", lineHeight: 1.55, margin: "10px 0 0" }}>
            <p style={{ margin: 0 }}>{refused}</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => { void saveThenRetry(); }}
              style={{ marginTop: 8, cursor: saving ? "default" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 11px", borderRadius: 7, border: "1px solid #b91c1c", background: saving ? "#fef2f2" : "#fff", color: "#991b1b" }}
            >
              {saving ? "Saving\u2026" : "Try saving it now, then remove"}
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => leave(true)} style={{ flex: "1 1 210px", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 9, border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff" }}>
            Sign out and remove it from this computer
          </button>
          <button type="button" onClick={() => leave(false)} style={{ flex: "1 1 120px", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", color: "#1f2733" }}>
            Just sign out
          </button>
          <button type="button" onClick={onCancel} style={{ flex: "1 1 90px", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "10px 12px", borderRadius: 9, border: "1px solid transparent", background: "transparent", color: "#64748b" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
