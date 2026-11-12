ALTER TABLE "hosts" ADD COLUMN "onboarding" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "onboarding_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;