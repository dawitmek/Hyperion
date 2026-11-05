ALTER TABLE "viewer_stats" ADD COLUMN "coins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- XP has always been 1 per command plus each gift's coins, so what XP the commands don't explain came from gifts.
UPDATE "viewer_stats" SET "coins" = GREATEST(0, "xp" - "commands");