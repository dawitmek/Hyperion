ALTER TABLE "hosts" ADD COLUMN "hidden_sounds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "sound_volumes" jsonb DEFAULT '{}'::jsonb NOT NULL;