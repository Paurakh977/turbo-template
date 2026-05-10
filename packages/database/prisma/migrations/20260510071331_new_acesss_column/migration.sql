/*
  Warnings:

  - The `role` column on the `user` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "user" DROP COLUMN "role",
ADD COLUMN     "role" JSONB DEFAULT '["user"]';

-- CreateIndex
CREATE INDEX "audit_log_actor_idx" ON "audit_log"("actor");

-- CreateIndex
CREATE INDEX "audit_log_userId_action_createdAt_idx" ON "audit_log"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "user_banned_idx" ON "user"("banned");
