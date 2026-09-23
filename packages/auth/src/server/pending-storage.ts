import { db } from '@repo/database';
import { createLogger } from '@repo/observability';
import { redis } from './infra/redis';

const logger = createLogger('auth:pending-storage');

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
 */
const pendingUserUpdates = new Map<string, { data: UserData; ts: number }>();
const pendingDeletions = new Map<
  string,
  { meta: PendingDeletionMeta; ts: number }
>();
const pendingStopImpersonations = new Map<string, number>();

function storePendingInMemory(userId: string, data: UserData) {
  pendingUserUpdates.set(userId, { data, ts: Date.now() });
}

function popPendingFromMemory<T>(userId: string): T | undefined {
  const entry = pendingUserUpdates.get(userId);
  if (!entry) return undefined;
  pendingUserUpdates.delete(userId);
  if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined;
  return entry.data as unknown as T;
}

function storePendingDeletionInMemory(
  userId: string,
  meta: PendingDeletionMeta,
) {
  pendingDeletions.set(userId, { meta, ts: Date.now() });
}

function popPendingDeletionFromMemory(
  userId: string,
): PendingDeletionMeta | undefined {
  const entry = pendingDeletions.get(userId);
  if (!entry) return undefined;
  pendingDeletions.delete(userId);
  if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined;
  return entry.meta;
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
        logger.error({ err: e, msg: '[Redis Error] storePendingDeletion' });
        storePendingDeletionInMemory(userId, meta);
      });
  } else {
    storePendingDeletionInMemory(userId, meta);
  }
}

/**
 * Atomic pop: GETDEL in ONE round trip instead of GET + DEL in two.
 * GETDEL needs Redis >= 6.2; older servers/proxies fall back to the same Lua
 * GET+DEL used by secondaryStorage.getAndDelete. Atomicity also fixes a
 * latent double-consume: the old code parsed the value even when the
 * follow-up DEL failed, so a retrying hook could consume the stash twice.
 */
async function popRedisKey(key: string, op: string): Promise<string | null> {
  if (!redis) return null;
  try {
    return await redis.getdel(key);
  } catch {
    try {
      const raw = await redis.eval(
        "local v=redis.call('GET',KEYS[1]) if v then redis.call('DEL',KEYS[1]) end return v",
        1,
        key,
      );
      return typeof raw === 'string' ? raw : null;
    } catch (e) {
      logger.error({ err: e, msg: `[Redis Error] ${op}` });
      return null;
    }
  }
}

export async function popPendingDeletion(
  userId: string,
): Promise<PendingDeletionMeta | undefined> {
  if (redis) {
    let parsed: PendingDeletionMeta | undefined;
    const raw = await popRedisKey(
      `pending_deletion:${userId}`,
      'popPendingDeletion',
    ).catch((e) => {
      logger.error({ err: e, msg: '[Redis Error] popPendingDeletion' });
      return null;
    });
    if (raw) {
      try {
        parsed = JSON.parse(raw) as PendingDeletionMeta;
      } catch {
        logger.error({
          msg: '[Redis Error] popPendingDeletion: invalid payload',
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
        logger.error({ err: e, msg: '[Redis Error] storePendingUser' });
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
    const raw = await popRedisKey(
      `pending_user_update:${userId}`,
      'popPendingUser',
    ).catch((e) => {
      logger.error({ err: e, msg: '[Redis Error]' });
      return null;
    });
    if (raw) {
      try {
        parsed = JSON.parse(raw) as UserData;
      } catch (e) {
        logger.error({
          msg: '[Redis Error] popPendingUser: invalid payload',
          userId,
          err: e,
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
        logger.error({ err: e, msg: '[Redis Error] storePendingStopImpersonation' });
        storePendingStopImpersonationInMemory(userId);
      });
    return;
  }

  storePendingStopImpersonationInMemory(userId);
}

export async function popPendingStopImpersonation(userId: string): Promise<boolean> {
  if (redis) {
    const raw = await popRedisKey(
      `pending_stop_impersonation:${userId}`,
      'popPendingStopImpersonation',
    ).catch((e) => {
      logger.error({ err: e, msg: '[Redis Error] popPendingStopImpersonation' });
      return null;
    });

    if (raw) {
      return true;
    }

    return popPendingStopImpersonationFromMemory(userId);
  }

  return popPendingStopImpersonationFromMemory(userId);
}

// ---------------------------------------------------------------------------
// Cache invalidation.
//
// Redis key inventory (verified against better-auth@1.6.29 secondaryStorage,
// shipped internal-adapter.mjs, + full codebase grep — every written key has
// a creation/read/invalidation path, no dead namespaces):
//   <sessionToken> (bare)  — WRITTEN by secondaryStorage.set on sign-in,
//     READ by secondaryStorage.get on every getSession, DELETED here + by
//     secondaryStorage.delete on sign-out/revoke. TTL = SESSION_EXPIRES_IN 7d.
//   active-sessions-<userId> — CORRECTION: Better Auth DOES write
//     this session-id list (internal-adapter createSession/deleteSession/
//     deleteSessions/listSessions). The old comment claiming "no such key"
//     was wrong — it read app code but not the shipped adapter. The framework
//     filters expired/missing entries on read, so a stale list is tolerated,
//     but we now DEL it here anyway so revocation is complete immediately.
//     There is still NO `session:<token>` prefix and NO `user:<id>` row cache
//     (verified zero writers) — do NOT re-add those deletes.
//   verification:*          — short-lived OTP/reset/email keys, consumed
//     atomically via getAndDelete (GETDEL + Lua fallback). No app-level
//     invalidation needed (1h reset, 24h verification, OTP minutes).
//   rate-limit counters     — Better Auth internal INCR+EXPIRE, expire
//     naturally per window. Never explicitly deleted.
//   server-action:<scope>:<id> — API-tier fixed-window limiter (Lua
//     INCR+EXPIRE+PTTL, single round trip), expires per scope window. Scope
//     allowlisted, no delete.
//   throttle:{<tracker>:<name>}:hits|:blocked — Nest global throttler via
//     @nest-lab/throttler-storage-redis. Disjoint by construction.
//   pending_deletion/user_update/stop_impersonation:<userId> — 15-30s stash
//     consumed atomically via GETDEL (+ Lua fallback) in hooks. Redis TTL
//     native, in-memory sweep else.
//
// Freshness: role/ban/delete/revoke call this BEFORE/AFTER the mutation so
// the next getSession misses Redis and hits PostgreSQL instantly. Password
// reset revocation is native (`revokeSessionsOnPasswordReset`) + session
// delete hooks — no extra work needed here.
// ---------------------------------------------------------------------------
export async function invalidateUserCache(
  userId: string,
  options?: { sessionToken?: string | null; sessionId?: string | null },
) {
  if (!redis) return;
  try {
    // Select token only — full rows wasted PG payload.
    const userSessions = await db.session.findMany({
      where: { userId },
      select: { token: true },
    });
    const pipeline = redis.pipeline();
    for (const session of userSessions) {
      // Bare token = the exact secondaryStorage key shape in this version.
      if (session.token) pipeline.del(session.token);
    }
    // Framework-owned session-id list (see inventory above): stale entries
    // are tolerated on read, but deleting completes revocation immediately.
    pipeline.del(`active-sessions-${userId}`);

    // Self-delete path: sessions are already gone from PG by the time
    // delete.after runs, so findMany returns []. The stashed token from the
    // /delete-user before hook covers that window.
    if (options?.sessionToken) {
      pipeline.del(options.sessionToken);
    }
    // sessionId is never a Redis key (key = token); kept only to document
    // the intentional omission — do NOT re-add `session:<id>` deletes.

    await pipeline.exec();
  } catch (e) {
    logger.error({ err: e, msg: '[Cache Error] Failed to invalidate user cache' });
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