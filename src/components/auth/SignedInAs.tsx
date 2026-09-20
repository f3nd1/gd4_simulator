// Who you are signed in as, and the way out. Small and quiet: it is a
// footer note, not a feature.
import { useSession, signOut } from "../../lib/auth/useSession";

export function SignedInAs({ align = "left" }: { align?: "left" | "right" }) {
  const state = useSession();
  if (state.status !== "signed-in") return null;
  return (
    <p style={{
      fontSize: 11.5, color: "#64748b", margin: "6px 0 0", lineHeight: 1.5,
      textAlign: align, overflowWrap: "anywhere",
    }}>
      Signed in as {state.email}
      {" · "}
      <button
        type="button"
        onClick={() => { void signOut(); }}
        style={{ border: 0, background: "none", padding: 0, font: "inherit", color: "#6d28d9", fontWeight: 700, cursor: "pointer" }}
      >
        Sign out
      </button>
    </p>
  );
}
