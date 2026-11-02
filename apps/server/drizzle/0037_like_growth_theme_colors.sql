ALTER TABLE "hosts" ALTER COLUMN "ui_theme_style" SET DEFAULT 'colors';--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "like_growth" real;
--> statement-breakpoint
UPDATE "hosts" SET "ui_theme_style" = 'colors' WHERE "ui_theme" = 'default';