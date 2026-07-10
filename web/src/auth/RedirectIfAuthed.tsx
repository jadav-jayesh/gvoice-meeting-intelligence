import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function RedirectIfAuthed() {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === "loading") {
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
  if (status === "authenticated") {
    const next = params.get("next");
    return <Navigate to={next && next.startsWith("/") ? next : "/dashboard"} replace />;
  }
  return <Outlet />;
}
