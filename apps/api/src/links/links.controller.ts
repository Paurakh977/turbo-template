import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { Link } from '@repo/api';

import { LinksService } from './links.service';

/**
 * Anonymous READ-ONLY link directory consumed by the public landing page
 * (unauthenticated browser fetch, no credentials sent).
 *
 * The create/update/delete mutations this template once shipped let any
 * visitor create, deface, or wipe entries and grow the in-memory store
 * unboundedly - they are gone. If you need mutable links, add an
 * authenticated, admin-gated module backed by Postgres instead of process
 * memory.
 */
@Controller('links')
@AllowAnonymous()
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get()
  findAll(): Link[] {
    return this.linksService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Link {
    return this.linksService.findOne(id);
  }
}
