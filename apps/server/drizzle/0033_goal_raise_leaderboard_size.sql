ALTER TABLE "goals" ADD COLUMN "raise" jsonb;--> statement-breakpoint
ALTER TABLE "overlay_screens" ADD COLUMN "leaderboard_size" integer DEFAULT 5 NOT NULL;