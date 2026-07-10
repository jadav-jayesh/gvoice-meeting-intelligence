import { NavLink, Link, Outlet, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { Avatar } from "../components/ui/Avatar";
import { ThemeToggle } from "../theme/ThemeToggle";
import { useAuth } from "../auth/AuthProvider";

const adminNav = [
  { to: "/admin/users", label: "Users", icon: Icon.Users },
  { to: "/admin/analytics", label: "Analytics", icon: Icon.Insights },
  { to: "/admin/settings", label: "Settings", icon: Icon.Cog }
];

// Shell for the Super Admin section. Mirrors the user App shell but with its
// own nav and a clear "Admin" identity, plus a link back to the user app.
export function AdminApp() {
  return (
    <div className="min-h-screen bg-bg">
      <AdminSidebar />
      <main className="lg:pl-[var(--sidebar-w)] pb-20 lg:pb-0 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}

function AdminSidebar() {
  return (
    <aside
      className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-30 bg-surface border-r border-line"
      style={{ width: "var(--sidebar-w)" }}
    >
      <div className="flex items-center justify-center h-16 px-5 border-b border-line">
        <Link
          to="/admin"
          className="focus-ring rounded-md transition-transform duration-200 hover:scale-[1.02]"
          aria-label="gVoice Admin"
        >
          <BrandLogo height={28} />
        </Link>
      </div>

      <div className="px-5 pt-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-400">
          <Icon.Sparkles size={12} />
          Super Admin
        </span>
      </div>

      <nav className="flex-1 px-3 pt-4">
        <p className="px-2 mb-1.5 text-[10px] uppercase tracking-widest text-inkFaint">Manage</p>
        <ul className="space-y-0.5">
          {adminNav.map((item) => (
            <li key={item.to}>
              <AdminNavLink {...item} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="px-3 pb-3 pt-2 border-t border-line space-y-3">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] text-inkSoft hover:text-ink hover-soft focus-ring"
        >
          <Icon.ArrowRight size={15} className="rotate-180" />
          Back to app
        </Link>
        <div className="flex items-center justify-between px-2">
          <span className="text-[10px] uppercase tracking-widest text-inkFaint">Theme</span>
          <ThemeToggle />
        </div>
        <AdminUserMenu />
      </div>
    </aside>
  );
}

function AdminNavLink({
  to,
  label,
  icon: ItemIcon,
  end
}: {
  to: string;
  label: string;
  icon: typeof Icon.Dashboard;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] transition-colors focus-ring",
          isActive ? "text-ink bg-surfaceHi" : "text-inkSoft hover:text-ink hover-soft"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-brand-500" />}
          <ItemIcon size={15} className={isActive ? "text-brand-500 dark:text-brand-400" : ""} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function AdminUserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const fullName = `${user.firstName} ${user.lastName}`.trim() || user.email;

  return (
    <div className="flex items-center gap-2.5 px-2 py-2">
      <Avatar name={fullName} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink truncate">{fullName}</span>
        <span className="block text-[11px] text-inkMute truncate">{user.email}</span>
      </span>
      <button
        type="button"
        aria-label="Log out"
        onClick={async () => {
          await logout();
          navigate("/login", { replace: true });
        }}
        className="p-1.5 rounded-md text-negative hover:bg-negative/5 focus-ring"
      >
        <Icon.ArrowRight size={15} />
      </button>
    </div>
  );
}
