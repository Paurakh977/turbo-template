'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '../../../lib/auth-client';
import {
  getPrimaryRole,
  hasGrantRole,
  canActOn,
  type BaseRole,
} from '@repo/auth/roles';
import { THEME_GRANT_NAME, LABS_GRANT_NAME } from '@repo/auth/permissions';
import { ActionDialog } from '../../_components/ActionDialog';
import {
  ToastRegion,
  type ToastItem,
  type ToastKind,
} from '../../_components/ToastRegion';

type User = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned: boolean | null;
  banReason?: string | null;
  emailVerified: boolean;
  createdAt: Date;
};

type Props = {
  users: User[];
  total: number;
  actorId: string;
  actorRole: string;
  isSuperAdmin: boolean;
};

const SETTINGS_THEME_GRANT_ROLE = THEME_GRANT_NAME;
const SETTINGS_LABS_GRANT_ROLE = LABS_GRANT_NAME;
type RoleToken =
  | BaseRole
  | typeof SETTINGS_THEME_GRANT_ROLE
  | typeof SETTINGS_LABS_GRANT_ROLE;

function buildRoleSet(
  nextBaseRole: BaseRole,
  grants: { theme: boolean; labs: boolean },
): RoleToken[] {
  const out: RoleToken[] = [nextBaseRole];
  if (grants.theme) out.push(SETTINGS_THEME_GRANT_ROLE);
  if (grants.labs) out.push(SETTINGS_LABS_GRANT_ROLE);
  return out;
}

function assignableRoles(actorRole: string): BaseRole[] {
  if (actorRole === 'superAdmin') return ['user', 'operator', 'admin'];
  if (actorRole === 'admin') return ['user', 'operator'];
  return [];
}

const ROLE_BADGE: Record<string, string> = {
  superAdmin: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  admin: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  operator: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  user: 'bg-muted/50 text-muted-foreground border-border/70',
};

export function AdminUserTable({
  users,
  total,
  actorId,
  actorRole,
  isSuperAdmin,
}: Props) {
  const router = useRouter();
  const [list, setList] = useState(users);
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const [banDialog, setBanDialog] = useState<{
    open: boolean;
    userId: string;
    name: string;
    reason: string;
  }>({
    open: false,
    userId: '',
    name: '',
    reason: 'Violated terms of service',
  });

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    kind: 'revoke' | 'impersonate' | 'delete' | null;
    userId: string;
    name: string;
    email: string;
  }>({
    open: false,
    kind: null,
    userId: '',
    name: '',
    email: '',
  });

  const pushToast = (kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, message }]);
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  useEffect(() => {
    setList(users);
  }, [users]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), 3500),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts]);

  const handleError = (msg: string | undefined) =>
    pushToast('error', msg ?? 'An unexpected error occurred.');

  const setRole = async (userId: string, role: RoleToken[]) => {
    setLoading(userId);
    const { error } = await authClient.admin.setRole({ userId, role });
    if (error) {
      handleError(error.message);
    } else {
      pushToast('success', 'Role updated.');
      router.refresh();
    }
    setLoading(null);
  };

  const ban = async () => {
    setLoading(banDialog.userId);
    const { error } = await authClient.admin.banUser({
      userId: banDialog.userId,
      banReason: banDialog.reason.trim() || 'Violated terms of service',
    });
    if (error) {
      handleError(error.message);
    } else {
      setList((prev) =>
        prev.map((u) =>
          u.id === banDialog.userId
            ? {
                ...u,
                banned: true,
                banReason:
                  banDialog.reason.trim() || 'Violated terms of service',
              }
            : u,
        ),
      );
      pushToast('success', 'User banned.');
      setBanDialog({
        open: false,
        userId: '',
        name: '',
        reason: 'Violated terms of service',
      });
    }
    setLoading(null);
  };

  const unban = async (userId: string) => {
    setLoading(userId);
    const { error } = await authClient.admin.unbanUser({ userId });
    if (error) {
      handleError(error.message);
    } else {
      setList((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, banned: false, banReason: null } : u,
        ),
      );
      pushToast('success', 'User unbanned.');
    }
    setLoading(null);
  };

  const revokeSessions = async () => {
    setLoading(confirmDialog.userId);
    const { error } = await authClient.admin.revokeUserSessions({
      userId: confirmDialog.userId,
    });
    if (error) {
      handleError(error.message);
    } else {
      pushToast('success', 'All active sessions revoked.');
      setConfirmDialog({
        open: false,
        kind: null,
        userId: '',
        name: '',
        email: '',
      });
    }
    setLoading(null);
  };

  const impersonate = async () => {
    setLoading(confirmDialog.userId);
    const { error } = await authClient.admin.impersonateUser({
      userId: confirmDialog.userId,
    });
    if (error) {
      handleError(error.message);
      setLoading(null);
      return;
    }

    pushToast('success', `Now impersonating ${confirmDialog.name}.`);
    setLoading(null);
    window.location.href = '/dashboard';
  };

  const removeUser = async () => {
    setLoading(confirmDialog.userId);
    const { error } = await authClient.admin.removeUser({
      userId: confirmDialog.userId,
    });
    if (error) {
      handleError(error.message);
    } else {
      setList((prev) => prev.filter((u) => u.id !== confirmDialog.userId));
      pushToast('success', 'User removed.');
      setConfirmDialog({
        open: false,
        kind: null,
        userId: '',
        name: '',
        email: '',
      });
    }
    setLoading(null);
  };

  const allowed = assignableRoles(actorRole);
  const actorCanManageTheme =
    authClient.admin.checkRolePermission({
      permissions: { settings: ['theme'] },
      role: actorRole as never,
    }) ?? false;
  const actorCanManageLabs =
    authClient.admin.checkRolePermission({
      permissions: { settings: ['labs'] },
      role: actorRole as never,
    }) ?? false;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((user) => {
      const role = getPrimaryRole(user.role ?? 'user');
      return (
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        role.toLowerCase().includes(query)
      );
    });
  }, [list, search]);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Manage roles, grants, status, and account security actions. Showing{' '}
            {filtered.length} of {total} users.
          </p>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users"
            className="w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/50 sm:w-56"
          />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/70">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Joined
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No users found for this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const canAct =
                    user.id !== actorId &&
                    canActOn(actorRole, user.role ?? 'user');
                  const isSelf = user.id === actorId;
                  const baseRole = getPrimaryRole(user.role ?? 'user');
                  const userRoleBadge = ROLE_BADGE[baseRole] ?? ROLE_BADGE.user;
                  const hasThemeGrant = hasGrantRole(
                    user.role ?? 'user',
                    SETTINGS_THEME_GRANT_ROLE,
                  );
                  const hasLabsGrant = hasGrantRole(
                    user.role ?? 'user',
                    SETTINGS_LABS_GRANT_ROLE,
                  );

                  return (
                    <tr
                      key={user.id}
                      className="border-b border-border/40 align-top last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {user.name}
                          </p>
                          {isSelf ? (
                            <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              You
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                        {!user.emailVerified ? (
                          <span className="mt-1 inline-block text-[10px] text-amber-300">
                            Email not verified
                          </span>
                        ) : null}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${userRoleBadge}`}
                        >
                          {baseRole}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {user.banned ? (
                          <span className="text-xs text-red-300">
                            Banned
                            {user.banReason
                              ? `: ${user.banReason.slice(0, 32)}`
                              : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-300">
                            Active
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {loading === user.id ? (
                            <span className="text-xs text-muted-foreground">
                              Working...
                            </span>
                          ) : canAct ? (
                            <>
                              {allowed.length > 0 ? (
                                <select
                                  value={baseRole}
                                  onChange={(e) =>
                                    setRole(
                                      user.id,
                                      buildRoleSet(e.target.value as BaseRole, {
                                        theme: hasThemeGrant,
                                        labs: hasLabsGrant,
                                      }),
                                    )
                                  }
                                  className="cursor-pointer rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
                                  title="Change role"
                                >
                                  {!allowed.includes(baseRole) ? (
                                    <option value={baseRole} disabled>
                                      {baseRole}
                                    </option>
                                  ) : null}
                                  {allowed.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              ) : null}

                              {actorCanManageTheme ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRole(
                                      user.id,
                                      buildRoleSet(baseRole as BaseRole, {
                                        theme: !hasThemeGrant,
                                        labs: hasLabsGrant,
                                      }),
                                    )
                                  }
                                  className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
                                >
                                  {hasThemeGrant
                                    ? 'Revoke Theme'
                                    : 'Grant Theme'}
                                </button>
                              ) : null}

                              {actorCanManageLabs ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRole(
                                      user.id,
                                      buildRoleSet(baseRole as BaseRole, {
                                        theme: hasThemeGrant,
                                        labs: !hasLabsGrant,
                                      }),
                                    )
                                  }
                                  className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-xs font-medium text-fuchsia-300 hover:bg-fuchsia-500/20"
                                >
                                  {hasLabsGrant ? 'Revoke Labs' : 'Grant Labs'}
                                </button>
                              ) : null}

                              {user.banned ? (
                                <button
                                  type="button"
                                  onClick={() => unban(user.id)}
                                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBanDialog({
                                      open: true,
                                      userId: user.id,
                                      name: user.name,
                                      reason: 'Violated terms of service',
                                    })
                                  }
                                  className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
                                >
                                  Ban
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDialog({
                                    open: true,
                                    kind: 'revoke',
                                    userId: user.id,
                                    name: user.name,
                                    email: user.email,
                                  })
                                }
                                className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                              >
                                Revoke
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDialog({
                                    open: true,
                                    kind: 'impersonate',
                                    userId: user.id,
                                    name: user.name,
                                    email: user.email,
                                  })
                                }
                                className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-300 hover:bg-yellow-500/20"
                              >
                                Impersonate
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDialog({
                                    open: true,
                                    kind: 'delete',
                                    userId: user.id,
                                    name: user.name,
                                    email: user.email,
                                  })
                                }
                                className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20"
                              >
                                Delete
                              </button>
                            </>
                          ) : !isSelf ? (
                            <span
                              className="text-xs text-muted-foreground/70"
                              title="You cannot modify a user with equal or higher privileges"
                            >
                              Protected
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isSuperAdmin ? (
          <p className="text-right text-xs text-muted-foreground/80">
            Admin accounts are protected. Only a super admin can modify them.
          </p>
        ) : null}
      </div>

      <ActionDialog
        open={banDialog.open}
        title={`Ban ${banDialog.name}`}
        description="Provide a reason shown in admin records."
        confirmLabel="Ban user"
        destructive
        pending={loading === banDialog.userId}
        onClose={() => {
          if (loading === banDialog.userId) return;
          setBanDialog({
            open: false,
            userId: '',
            name: '',
            reason: 'Violated terms of service',
          });
        }}
        onConfirm={ban}
      >
        <input
          value={banDialog.reason}
          onChange={(event) =>
            setBanDialog((prev) => ({ ...prev, reason: event.target.value }))
          }
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          placeholder="Ban reason"
        />
      </ActionDialog>

      <ActionDialog
        open={confirmDialog.open}
        title={
          confirmDialog.kind === 'revoke'
            ? `Revoke sessions for ${confirmDialog.name}?`
            : confirmDialog.kind === 'impersonate'
              ? `Impersonate ${confirmDialog.name}?`
              : `Delete ${confirmDialog.email}?`
        }
        description={
          confirmDialog.kind === 'revoke'
            ? 'All active sessions will be terminated immediately.'
            : confirmDialog.kind === 'impersonate'
              ? 'You will be redirected to the user dashboard.'
              : 'This action is permanent and cannot be undone.'
        }
        confirmLabel={
          confirmDialog.kind === 'revoke'
            ? 'Revoke sessions'
            : confirmDialog.kind === 'impersonate'
              ? 'Impersonate'
              : 'Delete user'
        }
        destructive={confirmDialog.kind === 'delete'}
        pending={loading === confirmDialog.userId}
        onClose={() => {
          if (loading === confirmDialog.userId) return;
          setConfirmDialog({
            open: false,
            kind: null,
            userId: '',
            name: '',
            email: '',
          });
        }}
        onConfirm={() => {
          if (confirmDialog.kind === 'revoke') {
            void revokeSessions();
            return;
          }
          if (confirmDialog.kind === 'impersonate') {
            void impersonate();
            return;
          }
          if (confirmDialog.kind === 'delete') {
            void removeUser();
          }
        }}
      />

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
