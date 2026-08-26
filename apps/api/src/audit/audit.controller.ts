import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Session } from '@thallesp/nestjs-better-auth';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

import { AuditService } from './audit.service';
import { extractClientMeta } from '../common/client-meta';
import type { ServerSession } from '../common/session.utils';

/**
 * Only actions the web tier legitimately writes through this endpoint.
 * System rows (auth events, note mutations) are written inside the API
 * process via database hooks / services and never arrive over HTTP. Without
 * this allowlist any authenticated user could forge arbitrary audit rows
 * ("super_admin_action", etc.) into the admin trail.
 */
const CLIENT_AUDIT_ACTIONS = [
  'profile_updated',
  'theme_changed',
  'labs_toggled',
] as const;

/**
 * Metadata cap in JSON characters (UTF-16 code units, not bytes). Keeps one
 * request from bloating a row; the request body itself is capped at 2 MB
 * upstream.
 */
const MAX_METADATA_CHARS = 4096;

export class RecordAuditDto {
  @IsIn(CLIENT_AUDIT_ACTIONS)
  action!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListAuditQuery {
  /** Truncated, never rejected - long bookmarks degrade to a shorter search. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.slice(0, 100) : value,
  )
  @IsString()
  q?: string;

  /** Truncated, never rejected - filtering is a parameterized equality. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.slice(0, 64) : value,
  )
  @IsString()
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

/**
 * Audit log API.
 * - POST /api/audit-logs        session-attributed write (web actions)
 * - GET  /api/admin/audit-logs  admin-only listing for the audit screen
 *
 * NOTE: no @UseGuards(AuthGuard) - the global APP_GUARD already resolves the
 * session for every non-public route.
 */
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post('audit-logs')
  record(
    @Session() session: ServerSession,
    @Body() dto: RecordAuditDto,
    @Req() req: Request,
  ) {
    if (
      dto.metadata &&
      JSON.stringify(dto.metadata).length > MAX_METADATA_CHARS
    ) {
      throw new BadRequestException('metadata too large');
    }
    return this.audit.recordFromSession(
      session,
      { action: dto.action, metadata: dto.metadata },
      extractClientMeta(req),
    );
  }

  @Get('admin/audit-logs')
  list(
    @Session() session: ServerSession,
    @Query() query: ListAuditQuery,
  ) {
    return this.audit.listForAdmin(session, {
      q: query.q?.trim() || undefined,
      action: query.action || 'all',
      page: query.page ?? 1,
    });
  }
}
