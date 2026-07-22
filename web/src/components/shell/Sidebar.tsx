import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "../Icon";
import { BrandLogo } from "../BrandLogo";
import { Avatar } from "../ui/Avatar";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { useAuth } from "../../auth/AuthProvider";

interface Props {
  onOpenPalette: () => void;
}

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: Icon.Dashboard },
  { to: "/meetings", label: "Meetings", icon: Icon.Meetings },
  { to: "/calendar", label: "Calendar", icon: Icon.Calendar },
  { to: "/insights", label: "Insights", icon: Icon.Insights }
];

export function Sidebar({ onOpenPalette }: Props) {
  return (
    <aside
      className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-30 bg-surface border-r border-line"
      style={{ width: "var(--sidebar-w)" }}
    >
      {/* Brand */}
      <div className="flex items-center justify-center h-16 px-5 border-b border-line">
        <Link
          to="/dashboard"
          className="focus-ring rounded-md transition-transform duration-200 hover:scale-[1.02]"
          aria-label="gVoice — Meeting Intelligence"
        >
          <BrandLogo height={28} />
        </Link>
      </div>

      {/* Search trigger */}
      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onOpenPalette}
          className="w-full group flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-bg hover:bg-surfaceHi hover:border-lineHi transition-colors focus-ring"
        >
          <Icon.Search size={14} className="text-inkMute" />
          <span className="text-[13px] text-inkMute">Search…</span>
          <span className="ml-auto flex items-center gap-0.5 text-[10.5px] font-mono text-inkFaint">
            <kbd className="px-1 py-0.5 rounded border border-line bg-surface">⌘</kbd>
            <kbd className="px-1 py-0.5 rounded border border-line bg-surface">K</kbd>
          </span>
        </button>
      </div>

      <nav className="flex-1 px-3 pt-4">
        <p className="px-2 mb-1.5 text-[10px] uppercase tracking-widest text-inkFaint">
          Workspace
        </p>
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavItemLink {...item} />
            </li>
          ))}
        </ul>
        <AdminNavSection />
      </nav>

      <div className="px-3 pb-3 pt-2 border-t border-line space-y-3">
        <div className="flex items-center justify-between px-2">
          <span className="text-[10px] uppercase tracking-widest text-inkFaint">
            Theme
          </span>
          <ThemeToggle />
        </div>
        <UserMenu />
      </div>
    </aside>
  );
}

// Admin entry-point — only rendered for admins. Lives in its own labelled group
// so it reads as a distinct, elevated area.
function AdminNavSection() {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;
  return (
    <>
      <p className="px-2 mt-5 mb-1.5 text-[10px] uppercase tracking-widest text-inkFaint">Admin</p>
      <ul className="space-y-0.5">
        <li>
          <NavItemLink to="/admin" label="Super Admin" icon={Icon.Users} />
        </li>
      </ul>
    </>
  );
}

function NavItemLink({
  to,
  label,
  icon: ItemIcon
}: {
  to: string;
  label: string;
  icon: typeof Icon.Dashboard;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] transition-colors focus-ring",
          isActive
            ? "text-ink bg-surfaceHi"
            : "text-inkSoft hover:text-ink hover-soft"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-brand-500" />
          )}
          <ItemIcon
            size={15}
            className={isActive ? "text-brand-500 dark:text-brand-400" : ""}
          />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  async function doLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const fullName = `${user.firstName} ${user.lastName}`.trim() || user.email;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover-soft focus-ring text-left"
      >
        <Avatar name={fullName} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-ink truncate">{fullName}</span>
          <span className="block text-[11px] text-inkMute truncate">{user.email}</span>
        </span>
        <Icon.ChevronDown
          size={14}
          className={clsx("text-inkMute transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 bottom-full mb-2 rounded-lg border border-line bg-surface shadow-pop overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/settings/profile");
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-inkSoft hover:text-ink hover-soft focus-ring"
          >
            <Icon.Cog size={14} />
            Profile settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/settings/calendars");
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-inkSoft hover:text-ink hover-soft focus-ring"
          >
            <Icon.Calendar size={14} />
            Calendars
          </button>
          <div className="border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmLogout(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-negative hover:bg-negative/5 focus-ring"
          >
            <Icon.ArrowRight size={14} />
            Log out
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        description={<>You'll need to sign in again to access your meetings and reports.</>}
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        tone="danger"
        loading={loggingOut}
        icon={<Icon.ArrowRight size={20} />}
        onConfirm={doLogout}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  );
}
