import { db } from '@repo/database';
import { redis } from './redis';

// Better Auth types `data` / `oldData` in databaseHooks as `{}` — this
// interface lets us safely cast to the actual shape without losing type
// safety everywhere else.
export interface UserData {
  id: string;
  email: string;
  name?: string;
  role?: string;
  banned?: boolean;
  banReason?: string | null;
}

export interface SessionData {
  userId: string;
  impersonatedBy?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Deletion request context
// Stashed in the before hook (where headers are available) and consumed in
// databaseHooks.user.delete.after (where headers are not).
export interface PendingDeletionMeta {
  ipAddress: string | null;
  userAgent: string | null;
  email: string | null;
  sessionToken: string | null;
  sessionId: string | null;
}

export const PENDING_TTL_MS = 30_000;
const STOP_IMPERSONATION_TTL_MS = 15_000;

/**
 * In-process stash for user updates and deletion requests.
 *
 * IMPORTANT: These maps are intentionally in-process only, and are SEPARATE
 * stores — user-update stashes and deletion stashes can never overwrite each
 * other, even when both land within the same TTL window.
 *
 * - pendingUserUpdates: old user state before an update (diff in after hook).
 *   Admin plugin operations bypass databaseHooks and are handled at the HTTP
 *   layer by `auditLogPlugin`; the only updates reaching databaseHooks are
 *   normal user-initiated ones which complete in the same request.
 * - pendingDeletions: self-deletion context (IP, UA, session ids) captured in
 *   the `/delete-user` before hook for the audit log in delete.after.
 *
 * Guard: entries older than 30 s are pruned (see sweep below) so a failed
 * `after` hook (e.g. adapter error) can never leak stale data.
 */
const pendingUserUpdates = new Map<string, { data: UserData; ts: number }>();
const pendingDeletions = new Map<string, { data: PendingDeletionMeta; ts: number }>();
const pendingStopImpersonations = new Map<string, number>();

function storePendingInMemory(key: string, data: UserData) {
  pendingUserUpdates.set(key, { data, ts: Date.now() });
}

function popPendingFromMemory<T>(key: string): T | undefined {
  const entry = pendingUserUpdates.get(key);
  pendingUserUpdates.delete(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined;
  return entry.data as unknown as T;
}

function storePendingDeletionInMemory(userId: string, meta: PendingDeletionMeta) {
  pendingDeletions.set(userId, { data: meta, ts: Date.now() });
}

function popPendingDeletionFromMemory(
  userId: string,
): PendingDeletionMeta | undefined {
  const entry = pendingDeletions.get(userId);
  pendingDeletions.delete(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined;
  return entry.data;
}

function storePendingStopImpersonationInMemory(userId: string) {
  pendingStopImpersonations.set(userId, Date.now());
}

function popPendingStopImpersonationFromMemory(userId: string): boolean {
  const ts = pendingStopImpersonations.get(userId);
  pendingStopImpersonations.delete(userId);
  if (!ts) return false;
  return Date.now() - ts <= STOP_IMPERSONATION_TTL_MS;
}

export async function storePendingDeletion(
  userId: string,
  meta: PendingDeletionMeta,
) {
  if (redis) {
    await redis
      .set(`pending_deletion:${userId}`, JSON.stringify(meta), 'PX', PENDING_TTL_MS)
      .catch((e) => {
        console.error('[Redis Error] storePendingDeletion:', e);
        storePendingDeletionInMemory(userId, meta);
      });
  } else {
    storePendingDeletionInMemory(userId, meta);
  }
}

export async function popPendingDeletion(
  userId: string,
): Promise<PendingDeletionMeta | undefined> {
  if (redis) {
    let parsed: PendingDeletionMeta | undefined;
    const raw = await redis.get(`pending_deletion:${userId}`).catch((e) => {
      console.error('[Redis Error] popPendingDeletion:', e);
      return null;
    });
    if (raw) {
      await redis
        .del(`pending_deletion:${userId}`)
        .catch((e) => console.error('[Redis Error]', e));
      try {
        parsed = JSON.parse(raw) as PendingDeletionMeta;
      } catch {
        console.error('[Redis Error] popPendingDeletion: invalid payload', {
          userId,
        });
      }
    }

    return parsed ?? popPendingDeletionFromMemory(userId);
  } else {
    return popPendingDeletionFromMemory(userId);
  }
}

export async function storePendingUser(userId: string, data: UserData) {
  if (redis) {
    await redis
      .set(`pending_user_update:${userId}`, JSON.stringify(data), 'PX', PENDING_TTL_MS)
      .catch((e) => {
        console.error('[Redis Error] storePendingUser:', e);
        storePendingInMemory(userId, data);
      });
  } else {
    storePendingInMemory(userId, data);
  }
}

export async function popPendingUser(
  userId: string,
): Promise<UserData | undefined> {
  if (redis) {
    let parsed: UserData | undefined;
    const raw = await redis.get(`pending_user_update:${userId}`).catch((e) => {
      console.error('[Redis Error]', e);
      return null;
    });
    if (raw) {
      await redis
        .del(`pending_user_update:${userId}`)
        .catch((e) => console.error('[Redis Error]', e));
      try {
        parsed = JSON.parse(raw) as UserData;
      } catch (e) {
        console.error('[Redis Error] popPendingUser: invalid payload', {
          userId,
          error: e,
        });
      }
    }

    return parsed ?? popPendingFromMemory<UserData>(userId);
  } else {
    return popPendingFromMemory<UserData>(userId);
  }
}

export async function storePendingStopImpersonation(userId: string) {
  if (redis) {
    await redis
      .set(`pending_stop_impersonation:${userId}`, '1', 'PX', STOP_IMPERSONATION_TTL_MS)
      .catch((e) => {
        console.error('[Redis Error] storePendingStopImpersonation:', e);
        storePendingStopImpersonationInMemory(userId);
      });
    return;
  }

  storePendingStopImpersonationInMemory(userId);
}

export async function popPendingStopImpersonation(userId: string): Promise<boolean> {
  if (redis) {
    const key = `pending_stop_impersonation:${userId}`;
    const raw = await redis.get(key).catch((e) => {
      console.error('[Redis Error] popPendingStopImpersonation:', e);
      return null;
    });

    if (raw) {
      await redis
        .del(key)
        .catch((e) =>
          console.error('[Redis Error] popPendingStopImpersonation.del:', e),
        );
      return true;
    }

    return popPendingStopImpersonationFromMemory(userId);
  }

  return popPendingStopImpersonationFromMemory(userId);
}

// ---------------------------------------------------------------------------
// Cache invalidation
// Destroys the user's secondary storage cache in Redis (if enabled) so that
// the next request misses the cache, hits the DB, and fetches the fresh data
// (like new roles, ban status, etc) instantly.
// ---------------------------------------------------------------------------
export async function invalidateUserCache(
  userId: string,
  options?: { sessionToken?: string | null; sessionId?: string | null },
) {
  if (!redis) return;
  try {
    const userSessions = await db.session.findMany({ where: { userId } });
    const pipeline = redis.pipeline();
    for (const session of userSessions) {
      // Better Auth usually caches the session using its token as the key
      pipeline.del(session.token);
      // Just in case it uses variations in newer versions
      pipeline.del(`session:${session.token}`);
      pipeline.del(`session:${session.id}`);
    }
    // Also delete any cached user record directly
    pipeline.del(userId);
    pipeline.del(`user:${userId}`);

    if (options?.sessionToken) {
      pipeline.del(options.sessionToken);
      pipeline.del(`session:${options.sessionToken}`);
    }
    if (options?.sessionId) {
      pipeline.del(`session:${options.sessionId}`);
    }

    await pipeline.exec();
  } catch (e) {
    console.error('[Cache Error] Failed to invalidate user cache:', e);
  }
}

// Sweep stale entries every 5 minutes so the maps can't grow unbounded.
setInterval(() => {
  if (redis) return; // Redis handles TTL natively
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pendingUserUpdates) {
    if (entry.ts < cutoff) pendingUserUpdates.delete(id);
  }
  for (const [userId, entry] of pendingDeletions) {
    if (entry.ts < cutoff) pendingDeletions.delete(userId);
  }

  const stopCutoff = Date.now() - STOP_IMPERSONATION_TTL_MS;
  for (const [userId, ts] of pendingStopImpersonations) {
    if (ts < stopCutoff) pendingStopImpersonations.delete(userId);
  }
}, 5 * 60_000).unref();