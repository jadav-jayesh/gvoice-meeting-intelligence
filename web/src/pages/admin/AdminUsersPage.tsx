import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/Icon";
import { useAuth } from "../../auth/AuthProvider";
import { adminListUsers, adminSetUserRole, type AdminUser, type AdminUsersParams } from "../../lib/api";
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
                  <div className="flex justify-end">
                    <Button
                      variant={isAdmin ? "ghost" : "secondary"}
                      disabled={isSelf || busyId === u.id}
                      title={isSelf ? "You can't change your own role" : undefined}
                      onClick={() => {
                        const next: UserRole = isAdmin ? "user" : "admin";
                        if (window.confirm(`${isAdmin ? "Demote" : "Promote"} ${fullName} ${isAdmin ? "to user" : "to admin"}?`)) {
                          void changeRole(u, next);
                        }
                      }}
                    >
                      {busyId === u.id ? "…" : isAdmin ? "Demote" : "Make admin"}
                    </Button>
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
    </div>
  );
}
