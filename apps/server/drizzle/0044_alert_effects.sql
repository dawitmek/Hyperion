ALTER TABLE "actions" ADD COLUMN "alert_effect" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "alert_emoji" text DEFAULT '🎉' NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "alert_effect_amount" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "alert_effect_speed" integer DEFAULT 100 NOT NULL;