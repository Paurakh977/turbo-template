'use client';

import { useState } from 'react';
import { authClient } from '../../../lib/auth-client';

type User = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
  emailVerified: boolean;
  createdAt: Date;
};

const ROLE_BADGE: Record<string, string> = {
  superAdmin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  user: 'bg-muted text-muted-foreground border-border/50',
};

export function AdminUserTable({ users, total }: { users: User[]; total: number }) {
  const [list, setList] = useState(users);
  const [loading, setLoading] = useState<string | null>(null);

  const refresh = async () => {
    // Simple: reload the page to get fresh server data
    window.location.reload();
  };

  const setRole = async (userId: string, role: string) => {
    setLoading(userId);
    const { error } = await authClient.admin.setRole({ userId, role });
    if (error) alert(error.message);
    else await refresh();
    setLoading(null);
  };

  const ban = async (userId: string) => {
    const reason = prompt('Ban reason (optional):') ?? 'Violated terms of service';
    setLoading(userId);
    const { error } = await authClient.admin.banUser({ userId, banReason: reason });
    if (error) alert(error.message);
    else setList((prev) => prev.map((u) => u.id === userId ? { ...u, banned: true, banReason: reason } : u));
    setLoading(null);
  };

  const unban = async (userId: string) => {
    setLoading(userId);
    const { error } = await authClient.admin.unbanUser({ userId });
    if (error) alert(error.message);
    else setList((prev) => prev.map((u) => u.id === userId ? { ...u, banned: false, banReason: null } : u));
    setLoading(null);
  };

  const revokeSessions = async (userId: string) => {
    if (!confirm('Revoke ALL sessions for this user?')) return;
    setLoading(userId);
    const { error } = await authClient.admin.revokeUserSessions({ userId });
    if (error) alert(error.message);
    else alert('All sessions revoked.');
    setLoading(null);
  };

  const impersonate = async (userId: string) => {
    if (!confirm('Impersonate this user? You will be redirected to their dashboard.')) return;
    const { error } = await authClient.admin.impersonateUser({ userId });
    if (error) alert(error.message);
    else window.location.href = '/dashboard';
  };

  const removeUser = async (userId: string, email: string) => {
    if (!confirm(`Permanently delete user "${email}"? This cannot be undone.`)) return;
    setLoading(userId);
    const { error } = await authClient.admin.removeUser({ userId });
    if (error) alert(error.message);
    else setList((prev) => prev.filter((u) => u.id !== userId));
    setLoading(null);
  };

  return (
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
          {list.map((user) => (
            <tr key={user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
              <td className="px-4 py-3">
                <div className="font-medium">{user.name}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
                {!user.emailVerified && (
                  <span className="text-xs text-yellow-500">unverified</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${ROLE_BADGE[user.role ?? 'user'] ?? ROLE_BADGE.user}`}>
                  {user.role ?? 'user'}
                </span>
              </td>
              <td className="px-4 py-3">
                {user.banned ? (
                  <span className="text-xs text-red-400" title={user.banReason ?? ''}>
                    Banned{user.banReason ? `: ${user.banReason.slice(0, 30)}` : ''}
                  </span>
                ) : (
                  <span className="text-xs text-green-400">Active</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  {loading === user.id ? (
                    <span className="text-xs text-muted-foreground">Working…</span>
                  ) : (
                    <>
                      {/* Role controls */}
                      {user.role !== 'admin' && user.role !== 'superAdmin' && (
                        <button
                          onClick={() => setRole(user.id, 'admin')}
                          className="text-xs px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                        >
                          Make Admin
                        </button>
                      )}
                      {user.role === 'admin' && (
                        <button
                          onClick={() => setRole(user.id, 'user')}
                          className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 transition-colors"
                        >
                          Demote
                        </button>
                      )}

                      {/* Ban controls */}
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

                      {/* Session + impersonation */}
                      <button
                        onClick={() => revokeSessions(user.id)}
                        className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 transition-colors"
                      >
                        Revoke Sessions
                      </button>
                      <button
                        onClick={() => impersonate(user.id)}
                        className="text-xs px-2 py-1 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                      >
                        Impersonate
                      </button>
                      <button
                        onClick={() => removeUser(user.id, user.email)}
                        className="text-xs px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}