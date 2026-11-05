-- The gift animation widget is gone: big gifts play a screen animation through an action instead. Each screen's widget
-- becomes a gift action for any gift worth at least its amount, with the same animation and speed, on that screen and
-- with every game profile. It shows no alert, only the animation.
INSERT INTO "actions" ("host_id", "name", "trigger", "min_diamonds", "effect", "effect_speed", "screen_id")
SELECT s."host_id", 'Gift screen animation', 'gift', COALESCE((w->>'minDiamonds')::int, 100), COALESCE(w->>'effect', 'fireworks'), COALESCE((w->>'effectSpeed')::int, 100), s."id"
FROM "overlay_screens" s, jsonb_array_elements(s."widgets") w
WHERE w->>'type' = 'firework';
--> statement-breakpoint
UPDATE "overlay_screens" SET "widgets" = (
  SELECT COALESCE(jsonb_agg(w ORDER BY i), '[]'::jsonb) FROM jsonb_array_elements("widgets") WITH ORDINALITY AS t(w, i) WHERE w->>'type' <> 'firework'
)
WHERE "widgets" @> '[{"type": "firework"}]';
