ALTER TABLE "profiles" ADD COLUMN "games" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "profiles" SET "games" = jsonb_build_array(jsonb_build_object('process', "game_process", 'icon', null)) WHERE "game_process" IS NOT NULL;
