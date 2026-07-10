import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "../Icon";
import { BrandLogo } from "../BrandLogo";
import { Avatar } from "../ui/Avatar";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { useAuth } from "../../auth/AuthProvider";

interface Props {
  onOpenPalette: () => void;
}

const items = [
  { to: "/dashboard", label: "Dashboard", icon: Icon.Dashboard },
  { to: "/meetings", label: "Meetings", icon: Icon.Meetings },
  { to: "/calendar", label: "Calendar", icon: Icon.Calendar },
  { to: "/insights", label: "Insights", icon: Icon.Insights }
];

export function MobileNav({ onOpenPalette }: Props) {
  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 bg-overlay backdrop-blur-md border-b border-line">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <Link
            to="/dashboard"
            aria-label="gVoice"
            className="focus-ring rounded-md"
          >
            <BrandLogo height={22} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={onOpenPalette}
              aria-label="Open command palette"
              className="w-9 h-9 rounded-lg border border-line bg-surface hover:bg-surfaceHi flex items-center justify-center text-inkMute hover:text-ink transition-colors focus-ring"
            >
              <Icon.Search size={15} />
            </button>
            <MobileUserMenu />
          </div>
        </div>
      </header>

      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-overlay backdrop-blur-md border-t border-line"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <ul className="grid grid-cols-4">
          {items.map(({ to, label, icon: ItemIcon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  clsx(
                    "relative flex flex-col items-center justify-center gap-0.5 h-14 transition-colors focus-ring",
                    isActive ? "text-ink" : "text-inkMute"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full bg-brand-500" />
                    )}
                    <ItemIcon
                      size={19}
                      className={clsx(
                        "transition-transform",
                        isActive ? "text-brand-500 dark:text-brand-400 -translate-y-px scale-105" : ""
                      )}
                    />
                    <span
                      className={clsx(
                        "text-[10px] leading-none tracking-tight",
                        isActive ? "font-semibold text-brand-500 dark:text-brand-400" : "font-medium"
                      )}
                    >
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function MobileUserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full focus-ring flex items-center justify-center"
      >
        <Avatar name={fullName} size={32} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-line bg-surface shadow-pop overflow-hidden"
        >
          <div className="flex items-center gap-2.5 px-3 py-3 border-b border-line">
            <Avatar name={fullName} size={36} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink truncate">{fullName}</p>
              <p className="text-[11.5px] text-inkMute truncate">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/settings/profile");
            }}
            className="w-full flex items-center gap-2.5 px-3 py-3 text-[13px] text-inkSoft hover:text-ink hover-soft focus-ring"
          >
            <Icon.Cog size={15} />
            Profile settings
          </button>
          <div className="border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate("/login", { replace: true });
            }}
            className="w-full flex items-center gap-2.5 px-3 py-3 text-[13px] text-negative hover:bg-negative/5 focus-ring"
          >
            <Icon.ArrowRight size={15} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
