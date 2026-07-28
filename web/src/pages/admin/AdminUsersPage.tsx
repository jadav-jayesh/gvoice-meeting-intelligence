import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/Icon";
import { useAuth } from "../../auth/AuthProvider";
import { FormField } from "../../auth/FormField";
import { PasswordRequirements } from "../../auth/PasswordRequirements";
import { adminListUsers, adminSetUserRole, adminSetUserPassword, type AdminUser, type AdminUsersParams } from "../../lib/api";
import type { UserRole } from "../../lib/types";

const PAGE_SIZE = 20;

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetValue, setResetValue] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  const resetStrong = useMemo(
    () => resetValue.length >= 8 && /[A-Z]/.test(resetValue) && /[a-z]/.test(resetValue) && /\d/.test(resetValue) && /[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(resetValue),
    [resetValue]
  );

  const load = useCallback(() => {
    setLoading(true);
    const params: AdminUsersParams = { page, pageSize: PAGE_SIZE };
    if (search.trim()) params.search = search.trim();
    if (roleFilter) params.role = roleFilter;
    adminListUsers(params)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setHasMore(res.hasMore);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }, [page, search, roleFilter]);

  useEffect(() => {
    // Debounce search; refire immediately for page/role changes.
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function changeRole(target: AdminUser, role: UserRole) {
    setBusyId(target.id);
    setError(null);
    try {
      await adminSetUserRole(target.id, role);
      setItems((prev) => prev.map((u) => (u.id === target.id ? { ...u, role } : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+ [^—]*— ?/, "") : "Role change failed");
    } finally {
      setBusyId(null);
    }
  }

  function openReset(user: AdminUser) {
    setResetTarget(user);
    setResetValue("");
    setResetError(null);
    setResetDone(false);
    setResetting(false);
  }

  async function submitReset() {
    if (!resetTarget || !resetStrong) return;
    setResetting(true);
    setResetError(null);
    try {
      await adminSetUserPassword(resetTarget.id, resetValue);
      setResetDone(true);
    } catch (e) {
      setResetError(e instanceof Error ? e.message.replace(/^\d+ [^—]*— ?/, "") : "Couldn't reset the password.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="page-shell py-10 lg:py-14 page-enter">
      <header className="mb-9">
        <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">Admin</p>
        <h1 className="text-[34px] lg:text-[40px] font-semibold tracking-tightest text-ink leading-none">Users</h1>
        <p className="text-inkMute text-[15px] mt-3 max-w-2xl leading-relaxed">
          Everyone registered on gVoice. Promote a teammate to admin or review their usage.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Icon.Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-inkMute" />
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search by name or email…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-bg text-[13px] text-ink placeholder:text-inkMute focus-ring"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-bg p-0.5">
          {(["", "user", "admin"] as const).map((r) => (
            <button
              key={r || "all"}
              type="button"
              onClick={() => {
                setPage(1);
                setRoleFilter(r);
              }}
              className={
                "px-3 h-8 rounded-md text-[12.5px] transition-colors " +
                (roleFilter === r ? "bg-surfaceHi text-ink" : "text-inkMute hover:text-ink")
              }
            >
              {r === "" ? "All" : r === "admin" ? "Admins" : "Users"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-[13px] text-negative">
          {error}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(0,1fr)_128px_104px_104px_148px] gap-4 px-6 py-3 border-b border-line text-[11px] uppercase tracking-widest text-inkFaint">
              <span>User</span>
              <span className="text-center">Role</span>
              <span className="text-right">Meetings</span>
              <span className="text-right">Minutes</span>
              <span className="text-right">Action</span>
            </div>

            {loading ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-6 py-4">
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-10">
            <EmptyState title="No users found" description="Try a different search or filter." />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((u) => {
              const fullName = `${u.firstName} ${u.lastName}`.trim() || u.email;
              const isSelf = me?.id === u.id;
              const isAdmin = u.role === "admin";
              return (
                <li
                  key={u.id}
                  className="grid grid-cols-[minmax(0,1fr)_128px_104px_104px_148px] gap-4 items-center px-6 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink truncate">
                      {fullName}
                      {isSelf && <span className="ml-2 text-[11px] text-inkFaint">(you)</span>}
                    </div>
                    <div className="text-[12px] text-inkMute truncate">{u.email}</div>
                  </div>
                  <div className="flex justify-center">
                    <Badge tone={isAdmin ? "brand" : "neutral"}>{isAdmin ? "Admin" : "User"}</Badge>
                  </div>
                  <div className="text-right text-[13px] text-inkSoft tabular-nums">{u.meetingCount}</div>
                  <div className="text-right text-[13px] text-inkSoft tabular-nums">{u.minutes}</div>
                  <div className="flex items-center justify-end gap-1">
                    {!isSelf && (
                      <button
                        type="button"
                        title="Reset password"
                        onClick={() => openReset(u)}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-inkMute hover:text-ink hover:bg-surfaceHi focus-ring"
                      >
                        <Icon.LockSparkle size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={isSelf ? "You can't change your own role" : isAdmin ? "Demote to user" : "Promote to admin"}
                      disabled={isSelf || busyId === u.id}
                      onClick={() => {
                        const next: UserRole = isAdmin ? "user" : "admin";
                        if (window.confirm(`${isAdmin ? "Demote" : "Promote"} ${fullName} ${isAdmin ? "to user" : "to admin"}?`)) {
                          void changeRole(u, next);
                        }
                      }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-inkMute hover:text-ink hover:bg-surfaceHi focus-ring"
                    >
                      {busyId === u.id ? <span className="text-[11px]">…</span> : <Icon.User size={15} />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between mt-5 text-[13px] text-inkMute">
        <span>
          {total} user{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="px-2 tabular-nums">Page {page}</span>
          <Button variant="secondary" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      <ResetPasswordDialog
        target={resetTarget}
        value={resetValue}
        onValueChange={setResetValue}
        strong={resetStrong}
        busy={resetting}
        error={resetError}
        done={resetDone}
        onClose={() => setResetTarget(null)}
        onSubmit={submitReset}
      />
    </div>
  );
}

function ResetPasswordDialog({
  target,
  value,
  onValueChange,
  strong,
  busy,
  error,
  done,
  onClose,
  onSubmit
}: {
  target: AdminUser | null;
  value: string;
  onValueChange: (v: string) => void;
  strong: boolean;
  busy: boolean;
  error: string | null;
  done: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const name = target ? `${target.firstName} ${target.lastName}`.trim() || target.email : "";

  useEffect(() => {
    if (!done) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onClose]);

  if (!target || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-scrim animate-fade-in"
      />
      <div className="relative w-full max-w-[420px] glass-card rounded-2xl p-6 animate-fade-scale">
        {done ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="grid place-items-center w-12 h-12 rounded-2xl text-positive bg-positive/10">
                <Icon.CheckCircle size={22} />
              </div>
              <h2 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">Password updated</h2>
              <p className="mt-2 text-[13px] text-inkMute leading-relaxed">
                Password updated for <span className="font-semibold text-inkSoft">{name}</span>.
                Share the new password with them securely — they can sign in with it right away.
              </p>
            </div>
            <Button variant="primary" size="md" className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">Reset password</h2>
              <p className="mt-1.5 text-[13px] text-inkMute leading-relaxed">
                Set a new password for <span className="font-semibold text-inkSoft">{name}</span>.
                No email is sent — you'll need to share it with them.
              </p>
            </div>

            <div className="space-y-3">
              <FormField
                label="New password"
                type="password"
                name="newPassword"
                autoComplete="new-password"
                placeholder="Create a strong password"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                showPasswordToggle
                required
              />
              <PasswordRequirements value={value} />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
              >
                <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2.5">
              <Button variant="ghost" size="md" className="flex-1" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="md" className="flex-1" disabled={!strong || busy} loading={busy} onClick={onSubmit}>
                Reset password
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
