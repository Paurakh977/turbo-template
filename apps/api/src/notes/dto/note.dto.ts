import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content?: string;
}

/** Hard ceiling keeps GET /api/notes a bounded payload as the table grows. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export { DEFAULT_LIMIT, MAX_LIMIT };

/**
 * Coerces a query-string boolean (`?withTotal=false`) to a real boolean.
 * `class-transformer`'s `@Type(() => Boolean)` would map ANY non-empty string
 * (including "false") to `true`, so explicit coercion is required. `undefined`
 * (param absent) falls through to the DTO default.
 */
function parseBooleanQuery(
  value: unknown,
  defaultValue: boolean,
): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return defaultValue;
}

export class ListNotesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;

  /**
   * P2 read-amplification opt-out. When `false`, the `COUNT(*)` total probe
   * is skipped (`total` returns `null`) and the response carries `hasMore`
   * derived from a +1 over-fetch instead — saving 1 of the 2 PG data queries
   * on the notes list path (40% of k6 traffic, 1 of 3 PG queries per GET).
   *
   * SAFE because no consumer renders totals: the web notes UI types only
   * `{notes, viewerRole}` and renders `notes.length` (page.tsx), and k6
   * asserts only `body.notes`. Default `true` keeps the contract (and the
   * existing `total` integration assertions) backwards compatible.
   * The audit-log list keeps its COUNT — its footer/pager consume totals.
   */
  @IsOptional()
  @Transform(({ value }) => parseBooleanQuery(value, true))
  @IsBoolean()
  withTotal?: boolean;
}
