import { Outlet } from "react-router-dom";
import { useSession } from "../../lib/auth/useSession";
import { isAdminEmail } from "../../lib/auth/domain";
import { ADMIN_ONLY_REFUSAL } from "../../lib/auth/peopleAdmin";
import { INK } from "../../lib/theme";

// Route-level guard for the People page, in the shape of DevToolsRoute.
//
// A refusal, NOT a redirect: bouncing somebody to the Dashboard reads as a
// broken link and invites them to try again. It is also not what protects the
// list — the insert and delete policies on allowed_users do that, and they
// apply to a request made outside this app entirely. This only decides what is
// drawn, and it says nothing about what is behind it.
export function PeopleRoute() {
  const state = useSession();
  if (state.status === "signed-in" && isAdminEmail(state.email)) return <Outlet />;
  return (
    <div style={{ maxWidth: 480, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px 22px" }}>
      <h1 style={{ fontSize: 18, margin: 0, color: INK }}>Not available</h1>
      <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.6, margin: "8px 0 0" }}>{ADMIN_ONLY_REFUSAL}</p>
    </div>
  );
}
