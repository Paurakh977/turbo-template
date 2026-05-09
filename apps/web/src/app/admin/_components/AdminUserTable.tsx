'use client';

import { useState } from 'react';
import { authClient } from '../../../lib/auth-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
  actorId: string;       // current admin's own user id
  actorRole: string;     // current admin's role
  isSuperAdmin: boolean;
};

// ---------------------------------------------------------------------------
// Role hierarchy — mirrors the server-side ROLE_WEIGHT in auth.ts
// Client-side checks are UX only; the server enforces the real constraint.
// ---------------------------------------------------------------------------
const ROLE_WEIGHT: Record<string, number> = {
  user:       0,
  operator:   1,
  admin:      2,
  superAdmin: 3,
};

const SETTINGS_THEME_GRANT_ROLE = 'settingsThemeGrant';
const SETTINGS_LABS_GRANT_ROLE = 'settingsLabsGrant';

function parseRoleTokens(role: string | null | undefined): string[] {
  if (!role) return ['user'];
  const tokens = role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : ['user'];
}

function getBaseRole(role: string | null | undefined): string {
  const tokens = parseRoleTokens(role);
  if (tokens.includes('superAdmin')) return 'superAdmin';
  if (tokens.includes('admin')) return 'admin';
  if (tokens.includes('operator')) return 'operator';
  return 'user';
}

function getRoleWeight(role: string | null | undefined) {
  return ROLE_WEIGHT[getBaseRole(role)] ?? 0;
}

function hasGrantRole(role: string | null | undefined, grantRole: string): boolean {
  return parseRoleTokens(role).includes(grantRole);
}

function buildRoleSet(
  currentRole: string | null | undefined,
  nextBaseRole: string,
  grants: { theme: boolean; labs: boolean },
): string[] {
  const out = [nextBaseRole];
  if (grants.theme) out.push(SETTINGS_THEME_GRANT_ROLE);
  if (grants.labs) out.push(SETTINGS_LABS_GRANT_ROLE);
  return out;
}

/**
 * Returns true when the actor is allowed to perform a privileged action on
 * the target.  Actor must have STRICTLY higher weight than the target, and
 * must not be acting on themselves.
 */
function canActOn(actorRole: string, actorId: string, target: User): boolean {
  if (target.id === actorId) return false; // never self-modify
  return getRoleWeight(actorRole) > getRoleWeight(target.role);
}

/**
 * Returns the set of roles the actor is allowed to ASSIGN.
 *  - admin      → can assign user or operator (not admin / superAdmin)
 *  - superAdmin → can assign user, operator, or admin  (not superAdmin)
 */
function assignableRoles(actorRole: string): string[] {
  if (actorRole === 'superAdmin') return ['user', 'operator', 'admin'];
  if (actorRole === 'admin')      return ['user', 'operator'];
  return [];
}

// ---------------------------------------------------------------------------
// Badge styling
// ---------------------------------------------------------------------------
const ROLE_BADGE: Record<string, string> = {
  superAdmin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin:      'bg-blue-500/10   text-blue-400   border-blue-500/20',
  operator:   'bg-amber-500/10  text-amber-400  border-amber-500/20',
  user:       'bg-muted text-muted-foreground border-border/50',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AdminUserTable({ users, actorId, actorRole, isSuperAdmin }: Props) {
  const [list, setList] = useState(users);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const clearError = () => setError(null);

  const handleError = (msg: string | undefined) =>
    setError(msg ?? 'An unexpected error occurred.');

  const refresh = () => window.location.reload();

  // ── actions ──────────────────────────────────────────────────────────────

  const setRole = async (userId: string, role: string | string[]) => {
    clearError();
    setLoading(userId);
    const { error } = await authClient.admin.setRole({
      userId,
      role: role as any,
    });
    if (error) handleError(error.message);
    else refresh();
    setLoading(null);
  };

  const ban = async (userId: string) => {
    clearError();
    const reason = prompt('Ban reason (optional):') ?? 'Violated terms of service';
    setLoading(userId);
    const { error } = await authClient.admin.banUser({ userId, banReason: reason });
    if (error) handleError(error.message);
    else setList(prev => prev.map(u => u.id === userId ? { ...u, banned: true, banReason: reason } : u));
    setLoading(null);
  };

  const unban = async (userId: string) => {
    clearError();
    setLoading(userId);
    const { error } = await authClient.admin.unbanUser({ userId });
    if (error) handleError(error.message);
    else setList(prev => prev.map(u => u.id === userId ? { ...u, banned: false, banReason: null } : u));
    setLoading(null);
  };

  const revokeSessions = async (userId: string) => {
    clearError();
    if (!confirm('Revoke ALL active sessions for this user? They will be signed out immediately.')) return;
    setLoading(userId);
    const { error } = await authClient.admin.revokeUserSessions({ userId });
    if (error) handleError(error.message);
    else alert('All sessions revoked.');
    setLoading(null);
  };

  const impersonate = async (userId: string, name: string) => {
    clearError();
    if (!confirm(`Impersonate "${name}"? You will be redirected to their dashboard.`)) return;
    const { error } = await authClient.admin.impersonateUser({ userId });
    if (error) handleError(error.message);
    else window.location.href = '/dashboard';
  };

  const removeUser = async (userId: string, email: string) => {
    clearError();
    if (!confirm(`Permanently delete "${email}"? This cannot be undone.`)) return;
    setLoading(userId);
    const { error } = await authClient.admin.removeUser({ userId });
    if (error) handleError(error.message);
    else setList(prev => prev.filter(u => u.id !== userId));
    setLoading(null);
  };

  const allowed = assignableRoles(actorRole);

  return (
    <div className="space-y-4">
      {/* Global error banner */}
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="text-red-400/60 hover:text-red-400">✕</button>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((user) => {
              const canAct    = canActOn(actorRole, actorId, user);
              const isSelf    = user.id === actorId;
              const baseRole = getBaseRole(user.role);
              const userRoleBadge = ROLE_BADGE[baseRole] ?? ROLE_BADGE.user;
              const hasThemeGrant = hasGrantRole(user.role, SETTINGS_THEME_GRANT_ROLE);
              const hasLabsGrant = hasGrantRole(user.role, SETTINGS_LABS_GRANT_ROLE);

              return (
                <tr key={user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  {/* User info */}
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-2">
                      {user.name}
                      {isSelf && (
                        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-semibold">You</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                    {!user.emailVerified && (
                      <span className="text-[10px] text-yellow-500">⚠ unverified</span>
                    )}
                  </td>

                  {/* Role badge */}
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${userRoleBadge}`}>
                      {baseRole}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {user.banned ? (
                      <span className="text-xs text-red-400" title={user.banReason ?? ''}>
                        🚫 Banned{user.banReason ? `: ${user.banReason.slice(0, 28)}…` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-green-400">● Active</span>
                    )}
                  </td>

                  {/* Joined */}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {loading === user.id ? (
                        <span className="text-xs text-muted-foreground animate-pulse">Working…</span>
                      ) : canAct ? (
                        <>
                          {/* ── Role selector ── */}
                          {allowed.length > 0 && (
                            <select
                              value={baseRole}
                              onChange={e =>
                                setRole(
                                  user.id,
                                  buildRoleSet(user.role, e.target.value, {
                                    theme: hasThemeGrant,
                                    labs: hasLabsGrant,
                                  }),
                                )
                              }
                              className="text-xs px-2 py-1 rounded-md bg-background border border-border/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                              title="Change role"
                            >
                              {/* Always show current base role even if not in allowed list */}
                              {!allowed.includes(baseRole) && (
                                <option value={baseRole} disabled>
                                  {baseRole}
                                </option>
                              )}
                              {allowed.map(r => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          )}

                          <button
                            onClick={() =>
                              setRole(
                                user.id,
                                buildRoleSet(user.role, baseRole, {
                                  theme: !hasThemeGrant,
                                  labs: hasLabsGrant,
                                }),
                              )
                            }
                            className="text-xs px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                            title="Grant settings theme toggle without changing base role"
                          >
                            {hasThemeGrant ? 'Revoke Theme Grant' : 'Grant Theme'}
                          </button>

                          <button
                            onClick={() =>
                              setRole(
                                user.id,
                                buildRoleSet(user.role, baseRole, {
                                  theme: hasThemeGrant,
                                  labs: !hasLabsGrant,
                                }),
                              )
                            }
                            className="text-xs px-2 py-1 rounded-md bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20 hover:bg-fuchsia-500/20 transition-colors"
                            title="Grant Labs settings access without changing base role"
                          >
                            {hasLabsGrant ? 'Revoke Labs Grant' : 'Grant Labs'}
                          </button>

                          {/* ── Ban / Unban ── */}
                          {user.banned ? (
                            <button
                              onClick={() => unban(user.id)}
                              className="text-xs px-2 py-1 rounded-md bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              onClick={() => ban(user.id)}
                              className="text-xs px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                            >
                              Ban
                            </button>
                          )}

                          {/* ── Revoke Sessions ── */}
                          <button
                            onClick={() => revokeSessions(user.id)}
                            className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 transition-colors"
                          >
                            Revoke Sessions
                          </button>

                          {/* ── Impersonate ── */}
                          <button
                            onClick={() => impersonate(user.id, user.name)}
                            className="text-xs px-2 py-1 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                          >
                            Impersonate
                          </button>

                          {/* ── Delete ── */}
                          <button
                            onClick={() => removeUser(user.id, user.email)}
                            className="text-xs px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        /* Protected row — show a lock hint */
                        !isSelf && (
                          <span
                            className="text-xs text-muted-foreground/50 select-none"
                            title="You cannot modify a user with equal or higher privileges"
                          >
                            🔒 Protected
                          </span>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Hint for superAdmin-only actions */}
      {!isSuperAdmin && (
        <p className="text-xs text-muted-foreground/60 text-right">
          🔒 Admin accounts are protected. Only a superAdmin can modify them.
        </p>
      )}
    </div>
  );
}
