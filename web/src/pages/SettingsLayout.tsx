import { NavLink, Outlet } from "react-router-dom";
import { Icon } from "../components/Icon";

const TABS = [
  { to: "/settings/profile", label: "Profile", icon: Icon.User },
  { to: "/settings/calendars", label: "Calendars", icon: Icon.Calendar }
] as const;

// Shared chrome for every settings screen: one header + a tab strip, with the
// active screen rendered through <Outlet/>. Kept to a readable column width —
// settings are forms, not dashboards, so they don't use the full page-shell.
export function SettingsLayout() {
  return (
    <div className="page-enter mx-auto w-full max-w-3xl px-5 lg:px-8 py-8 lg:py-10">
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-widest text-inkFaint">Account</p>
        <h1 className="text-2xl font-semibold tracking-tighter2 text-ink">Settings</h1>
        <p className="text-[13.5px] text-inkMute">Manage your profile, security and connected calendars.</p>
      </header>

      <nav aria-label="Settings sections" className="mt-6 flex items-center gap-1 border-b border-line">
        {TABS.map(({ to, label, icon: TabIcon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium -mb-px border-b-2 transition-colors focus-ring rounded-t ${
                isActive
                  ? "border-brand-500 text-ink"
                  : "border-transparent text-inkMute hover:text-ink"
              }`
            }
          >
            <TabIcon size={14} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
