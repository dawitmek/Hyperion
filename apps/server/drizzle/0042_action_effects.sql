ALTER TABLE "actions" ADD COLUMN "effect" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effect_amount" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effect_color" text;