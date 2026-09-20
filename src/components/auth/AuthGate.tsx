// Nothing renders until a United Ceres Google account is signed in.
//
// This gate decides what is DRAWN. It is not what protects the data: a
// determined visitor can edit the page in their browser and remove it. What
// actually protects the data is the row-level security policy in Postgres
// (every read and write must carry a UCC session) and the drive-oauth
// function's own caller check. Both apply to a request made with curl and
// the publishable key, which this gate cannot see at all.
import { useState } from "react";
import { useSession, signInWithGoogle, signOut } from "../../lib/auth/useSession";
import { ALLOWED_EMAIL_DOMAIN, WRONG_DOMAIN_MESSAGE } from "../../lib/auth/domain";
import { useSupabaseSettingsStore } from "../../store/useSupabaseSettingsStore";

const INK = "#1f2733";
const shell: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20, background: "#f6f8fb", boxSizing: "border-box",
};
const card: React.CSSProperties = {
  width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 14, padding: "26px 24px", boxShadow: "0 1px 3px rgba(15,23,42,.06)",
};
const muted: React.CSSProperties = { fontSize: 13.5, color: "#64748b", lineHeight: 1.6, margin: "8px 0 0" };
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13,
  border: "1px solid #cbd5e1", borderRadius: 8, marginTop: 4,
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const state = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (state.status === "signed-in") return <>{children}</>;

  if (state.status === "loading") {
    return <div style={shell}><div style={card}><p style={{ ...muted, margin: 0 }}>Checking your sign-in&hellip;</p></div></div>;
  }

  // No database connection, so there is nobody to ask who this is. The app
  // must not open. The two fields below are the Supabase URL and PUBLISHABLE
  // key, which are public values and grant nothing on their own: without a
  // UCC Google account, filling them in still shows no data.
  if (state.status === "unconfigured") return <ConnectionSetup />;

  const onSignIn = async () => {
    setBusy(true); setError("");
    const err = await signInWithGoogle();
    if (err) { setError(err); setBusy(false); }
  };

  return (
    <div style={shell}>
      <div style={card}>
        <h1 style={{ fontSize: 19, margin: 0, color: INK }}>GD4 EduTrust audit</h1>
        <p style={muted}>
          This workspace holds audit findings and student records, so it is open only to
          United Ceres staff. Sign in with your <b style={{ color: INK }}>@{ALLOWED_EMAIL_DOMAIN}</b> Google account.
        </p>

        {state.status === "wrong-domain" && (
          <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px" }}>
            {WRONG_DOMAIN_MESSAGE} You are currently signed in as <b>{state.email}</b>.
          </p>
        )}
        {error && (
          <p style={{ ...muted, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "10px 12px" }}>
            Sign-in did not start: {error}
          </p>
        )}

        <button
          type="button"
          onClick={state.status === "wrong-domain" ? () => { void signOut(); } : onSignIn}
          disabled={busy}
          style={{
            width: "100%", marginTop: 16, padding: "11px 14px", fontSize: 14, fontWeight: 700,
            borderRadius: 9, border: "1px solid #cbd5e1", background: busy ? "#f1f5f9" : "#fff",
            color: INK, cursor: busy ? "default" : "pointer",
          }}
        >
          {state.status === "wrong-domain" ? "Sign out and try another account" : busy ? "Opening Google…" : "Sign in with Google"}
        </button>

        <p style={{ ...muted, fontSize: 12 }}>
          If your account is refused, ask Felix to add you. Nothing in this app is visible until you are signed in.
        </p>
      </div>
    </div>
  );
}

// Shown only when the app has no database connection at all. Deliberately the
// ONLY thing reachable in that state: an unconfigured app cannot check who
// anyone is, so it opens nothing.
function ConnectionSetup() {
  const { url, publishableKey, setUrl, setPublishableKey } = useSupabaseSettingsStore();
  const [u, setU] = useState(url);
  const [k, setK] = useState(publishableKey);
  return (
    <div style={shell}>
      <div style={card}>
        <h1 style={{ fontSize: 19, margin: 0, color: INK }}>Not connected yet</h1>
        <p style={muted}>
          This app cannot check who you are until it is connected to its database, so it is
          showing nothing. A normal deployment carries these two values already; if you are
          seeing this screen, ask Felix.
        </p>
        <label style={{ ...muted, display: "block", marginTop: 14, color: INK, fontWeight: 700, fontSize: 13 }}>
          Database address
          <input style={field} value={u} onChange={(e) => setU(e.target.value)} placeholder="https://xxxxxxxxxxxx.supabase.co" />
        </label>
        <label style={{ ...muted, display: "block", marginTop: 10, color: INK, fontWeight: 700, fontSize: 13 }}>
          Publishable key
          <input style={field} value={k} onChange={(e) => setK(e.target.value)} placeholder="eyJ&hellip;" />
        </label>
        <button
          type="button"
          onClick={() => { setUrl(u); setPublishableKey(k); window.location.reload(); }}
          style={{ width: "100%", marginTop: 14, padding: "11px 14px", fontSize: 14, fontWeight: 700, borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", color: INK, cursor: "pointer" }}
        >
          Save and continue to sign-in
        </button>
        <p style={{ ...muted, fontSize: 12 }}>
          Both values are public and grant nothing by themselves. You still have to sign in
          with a United Ceres Google account before any data appears.
        </p>
      </div>
    </div>
  );
}
