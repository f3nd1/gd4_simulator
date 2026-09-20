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
import { notOnListMessage, TABLE_MISSING_HINT } from "../../lib/auth/allowList";
import { useSupabaseSettingsStore } from "../../store/useSupabaseSettingsStore";
import { consumeSignInError } from "../../lib/supabaseClient";
import { buildLabel } from "../../lib/buildInfo";

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
  // A real failure carried back in the landing URL. Without this the screen
  // was a blank sign-in card with no hint that anything had gone wrong, which
  // is what made a failed redirect so hard to read.
  const [error, setError] = useState(() => consumeSignInError() ?? "");

  if (state.status === "signed-in") return <>{children}</>;

  if (state.status === "loading") {
    return <div style={shell}><div style={card}><p style={{ ...muted, margin: 0 }}>Checking your sign-in&hellip;</p></div></div>;
  }

  // No database connection, so there is nobody to ask who this is. The app
  // must not open. The two fields below are the Supabase URL and PUBLISHABLE
  // key, which are public values and grant nothing on their own: without a
  // UCC Google account, filling them in still shows no data.
  if (state.status === "unconfigured") return <ConnectionSetup />;

  // A real United Ceres account that is not one of the named people. It must
  // not look broken and must not describe what is inside, so it says only
  // that the app is limited to the audit team, names the address they used so
  // they can tell they picked the wrong account, and gives them a way out.
  if (state.status === "not-on-list") {
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={{ fontSize: 19, margin: 0, color: INK }}>GD4 EduTrust audit</h1>
          <p style={muted}>{notOnListMessage(state.email)}</p>
          <button
            type="button"
            onClick={() => { void signOut(); }}
            style={{ width: "100%", marginTop: 16, padding: "11px 14px", fontSize: 14, fontWeight: 700, borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", color: INK, cursor: "pointer" }}
          >
            Sign out and try another account
          </button>
          <BuildStamp />
        </div>
      </div>
    );
  }

  // The list could not be read. Not a refusal: saying "you are not permitted"
  // because the network dropped is wrong, and it would send somebody to Felix
  // over a problem he cannot fix.
  if (state.status === "check-failed") {
    // A missing table and a dropped connection both land here, and they need
    // opposite advice: one is "try again", the other is "a setup step has not
    // been run". Saying "usually a connection problem" to somebody whose
    // database simply has no list yet sends them looking in the wrong place,
    // which is what the lockout on a43c855 cost.
    const setupNotRun = state.reason === TABLE_MISSING_HINT;
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={{ fontSize: 19, margin: 0, color: INK }}>
            {setupNotRun ? "This app is not set up yet" : "Could not check your access"}
          </h1>
          <p style={muted}>
            You are signed in as <b style={{ color: INK }}>{state.email}</b>, but the app could not check
            whether you have access, so it is not showing anything.
            {setupNotRun ? " Nothing is wrong with your account." : " This is usually a connection problem rather than a problem with your account."}
          </p>
          <p style={setupNotRun
            ? { ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px" }
            : { ...muted, fontSize: 12, fontFamily: "ui-monospace,monospace" }}>{state.reason}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ width: "100%", marginTop: 16, padding: "11px 14px", fontSize: 14, fontWeight: 700, borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", color: INK, cursor: "pointer" }}
          >
            Try again
          </button>
          <BuildStamp />
        </div>
      </div>
    );
  }

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
            Sign-in did not finish: {error}
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
        <BuildStamp />
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
        <BuildStamp />
      </div>
    </div>
  );
}

// Which build this browser is actually running, on the sign-in screen itself.
//
// The Change Log page carries the same stamp, but it sits BEHIND this gate: a
// person who cannot sign in has no way to tell a genuine fault from a server
// that has not been rebuilt, or from a browser still holding the previous
// bundle. Both have now cost a debugging round each.
function BuildStamp() {
  return (
    <p style={{ ...muted, fontSize: 11, marginTop: 14, paddingTop: 10, borderTop: "1px solid #eef2f7" }}>
      Build <span style={{ fontFamily: "ui-monospace,monospace" }}>{buildLabel()}</span>
      {". "}
      If this is not the build you expect, the page was served from a cache: reload with
      Ctrl and Shift and R (Cmd, Shift and R on a Mac).
    </p>
  );
}
