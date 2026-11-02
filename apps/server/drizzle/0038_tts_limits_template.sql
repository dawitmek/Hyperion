ALTER TABLE "hosts" ADD COLUMN "tts_max_words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "tts_min_coins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "tts_template" text DEFAULT '{viewer} says {text}' NOT NULL;