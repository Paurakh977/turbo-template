import { Controller, Get, Session, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import { db } from '@repo/database';

import type { ServerSession } from '../common/session.utils';

/**
 * Fresh-role lookup for the dashboard's cache-invalidation action: returns the
 * CURRENT role from the primary store so a stale session snapshot can never
 * keep elevated UI alive after an admin demotes the user.
 */
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  @Get('me/role')
  async myRole(@Session() session: ServerSession) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    return {
      role: (user?.role as string | null | undefined) ?? 'user',
    };
  }
}
