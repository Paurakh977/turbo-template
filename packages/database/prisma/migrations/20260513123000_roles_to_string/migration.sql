-- Normalize user.role to Better Auth canonical string format.
-- Supports legacy values from prior Json/Text role implementations.

ALTER TABLE "user" ADD COLUMN "role_v2" TEXT NOT NULL DEFAULT 'user';

UPDATE "user"
SET "role_v2" = trim(
  BOTH ',' FROM regexp_replace(
    CASE
      WHEN "role" IS NULL THEN 'user'
      WHEN jsonb_typeof("role") = 'array' THEN (
        SELECT string_agg(value, ',')
        FROM jsonb_array_elements_text("role") AS value
      )
      WHEN jsonb_typeof("role") = 'string' THEN replace(trim(BOTH '"' FROM "role"::text), ' ', '')
      ELSE 'user'
    END,
    '\\s*,\\s*',
    ',',
    'g'
  )
);

UPDATE "user"
SET "role_v2" = 'user'
WHERE "role_v2" IS NULL OR "role_v2" = '';

ALTER TABLE "user" DROP COLUMN "role";
ALTER TABLE "user" RENAME COLUMN "role_v2" TO "role";
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'user';
