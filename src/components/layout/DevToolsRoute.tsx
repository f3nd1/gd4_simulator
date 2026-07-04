import { Navigate, Outlet } from "react-router-dom";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { devToolsRedirect } from "../../nav";

// Route-level guard for developer/diagnostic pages (see DEVELOPER_TOOL_PATHS
// in nav.ts): when the Settings "Show developer tools" toggle is off, these
// routes are inaccessible (redirect to the Dashboard), not merely unlisted.
export function DevToolsRoute() {
  const showDeveloperTools = useWorkspaceStore((s) => s.showDeveloperTools);
  const redirect = devToolsRedirect(showDeveloperTools);
  if (redirect) return <Navigate to={redirect} replace />;
  return <Outlet />;
}
