import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, Session } from '@thallesp/nestjs-better-auth';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { AuditService } from './audit.service';
import type { ServerSession } from '../common/session.utils';

export class RecordAuditDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,64}$/i, {
    message: 'action must be 1-64 chars: letters, digits, underscore',
  })
  action!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ListAuditQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['all']) // extended by service; arbitrary actions allowed via passthrough
  action?: string;

  @IsOptional()
  page?: string | number;
}

function extractClientMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
    (typeof req.headers['x-real-ip'] === 'string'
      ? (req.headers['x-real-ip'] as string)
      : null) ||
    req.ip ||
    null;
  return { ip: ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

/**
 * Audit log API.
 * - POST /api/audit-logs        session-attributed write (web actions)
 * - GET  /api/admin/audit-logs  admin-only listing for the audit screen
 */
@Controller()
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post('audit-logs')
  record(
    @Session() session: ServerSession,
    @Body() dto: RecordAuditDto,
    @Req() req: Request,
  ) {
    return this.audit.recordFromSession(
      session,
      { action: dto.action, metadata: dto.note ? { note: dto.note } : undefined },
      extractClientMeta(req),
    );
  }

  @Get('admin/audit-logs')
  list(
    @Session() session: ServerSession,
    @Query('q') q?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
  ) {
    const parsedPage = page ? Number.parseInt(page, 10) : 1;
    return this.audit.listForAdmin(session, {
      q: q?.trim() || undefined,
      action: action || 'all',
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
    });
  }
}
