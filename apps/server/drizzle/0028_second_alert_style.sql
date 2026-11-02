ALTER TABLE "actions" ADD COLUMN "use_alert_style_2" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "alert_style_2" jsonb;