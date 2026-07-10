import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <AuthSpinner />;
  if (status === "anonymous") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

function AuthSpinner() {
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
