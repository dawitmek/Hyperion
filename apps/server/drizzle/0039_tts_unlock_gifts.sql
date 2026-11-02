ALTER TABLE "hosts" ADD COLUMN "tts_unlock_gifts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "tts_unlock_minutes" integer DEFAULT 0 NOT NULL;