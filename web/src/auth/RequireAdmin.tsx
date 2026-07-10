import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

// Gate for the Super Admin section. Sits inside RequireAuth, so by here the
// user is authenticated; we only need to check the role. Non-admins are sent
// back to their dashboard rather than /login (they ARE logged in).
export function RequireAdmin() {
  const { user, status } = useAuth();

  if (status === "loading") return <AdminSpinner />;
  if (!user || user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function AdminSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <span
        className="w-6 h-6 rounded-full border-2 border-brand-500 border-r-transparent animate-spin"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
