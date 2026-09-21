import { Outlet, useLocation } from "react-router-dom";
import { useSession } from "../../lib/auth/useSession";
import { ADMIN_ONLY_REFUSAL } from "../../lib/auth/peopleAdmin";
import { isAdminOnlyPath } from "../../lib/auth/pageAccess";
import { INK } from "../../lib/theme";

// Route-level guard for every admin-only page, in the shape of DevToolsRoute.
//
// A refusal, NOT a redirect: bouncing somebody to the Dashboard reads as a
// broken link and invites them to try again. It is also not what protects
// anything. For the ten configuration rows it is the write policies on
// workspace_state that refuse, and those apply to a request made outside this
// app entirely; for the rest, this guard hides a page whose data every
// signed-in person can still read. lib/auth/pageAccess.ts records which is
// which, and the People screen prints it.
export function AdminRoute() {
  const state = useSession();
  const { pathname } = useLocation();
  if (state.status === "signed-in" && state.isAdmin) return <Outlet />;
  // A path that is not on the admin list at all should never have been
  // wrapped; fail closed rather than quietly opening.
  if (!isAdminOnlyPath(pathname)) return <Outlet />;
  return (
    <div style={{ maxWidth: 480, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px 22px" }}>
      <h1 style={{ fontSize: 18, margin: 0, color: INK }}>Not available</h1>
      <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.6, margin: "8px 0 0" }}>{ADMIN_ONLY_REFUSAL}</p>
    </div>
  );
}
