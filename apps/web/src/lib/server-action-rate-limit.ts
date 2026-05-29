import 'server-only';

import { db } from '@repo/database';
import { randomUUID } from 'node:crypto';

type ServerActionRateLimitInput = {
  scope: string;
  identifier: string;
  windowMs: number;
  max: number;
  failOpen?: boolean;
};

type ServerActionRateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

const MAX_CONFLICT_RETRIES = 5;

function createRateLimitKey(scope: string, identifier: string) {
  return `server-action:${scope}:${identifier}`;
}

export function getServerActionRateLimitMessage(retryAfterMs: number): string {
  const waitSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many requests. Please wait ${waitSeconds}s and try again.`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function checkServerActionRateLimit({
  scope,
  identifier,
  windowMs,
  max,
  failOpen = false,
}: ServerActionRateLimitInput): Promise<ServerActionRateLimitResult> {
  const key = createRateLimitKey(scope, identifier);

  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
    const nowMs = Date.now();

    const current = await db.rateLimit.findUnique({
      where: { key },
      select: { count: true, lastRequest: true },
    });

    if (!current) {
      try {
        await db.rateLimit.create({
          data: {
            id: randomUUID(),
            key,
            count: 1,
            lastRequest: BigInt(nowMs),
          },
        });
        return { allowed: true, retryAfterMs: 0 };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue;
        }
        console.error('[RateLimit] failed to create key:', { key, error });
        return {
          allowed: failOpen,
          retryAfterMs: failOpen ? 0 : windowMs,
        };
      }
    }

    const elapsedMs = nowMs - Number(current.lastRequest);
    if (elapsedMs >= windowMs) {
      const rotated = await db.rateLimit.updateMany({
        where: { key, lastRequest: current.lastRequest },
        data: { count: 1, lastRequest: BigInt(nowMs) },
      });
      if (rotated.count === 1) {
        return { allowed: true, retryAfterMs: 0 };
      }
      continue;
    }

    if (current.count >= max) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1000, windowMs - elapsedMs),
      };
    }

    const incremented = await db.rateLimit.updateMany({
      where: {
        key,
        count: current.count,
        lastRequest: current.lastRequest,
      },
      data: {
        count: { increment: 1 },
      },
    });

    if (incremented.count === 1) {
      return { allowed: true, retryAfterMs: 0 };
    }
  }

  console.error('[RateLimit] contention retries exceeded for key:', key);
  return {
    allowed: failOpen,
    retryAfterMs: failOpen ? 0 : windowMs,
  };
}
