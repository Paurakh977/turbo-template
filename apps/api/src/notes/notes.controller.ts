import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, Session } from '@thallesp/nestjs-better-auth';

import { NotesService } from './notes.service';
import { CreateNoteDto, UpdateNoteDto } from './dto/note.dto';
import type { ServerSession } from '../common/session.utils';

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
 * Notes API - the single enforcement point for note RBAC (Architecture B).
 * The web tier consumes these endpoints via its auth-http gateway instead of
 * querying Postgres directly.
 */
@Controller('notes')
@UseGuards(AuthGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Session() session: ServerSession) {
    return this.notes.listForSession(session);
  }

  @Post()
  @HttpCode(201)
  create(
    @Session() session: ServerSession,
    @Body() dto: CreateNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.create(session, dto, extractClientMeta(req));
  }

  @Patch(':id')
  update(
    @Session() session: ServerSession,
    @Param('id') id: string,
    @Body() dto: UpdateNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.update(session, id, dto, extractClientMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Session() session: ServerSession,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notes.remove(session, id, extractClientMeta(req));
  }
}
