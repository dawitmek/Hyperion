-- A widget on a screen has a size of its own now, apart from its look, so resizing it doesn't need custom colors. A size
-- set in a widget's look moves to the widget, and the look goes back to 100%.
UPDATE "overlay_screens" SET "widgets" = (
  SELECT jsonb_agg(
    CASE WHEN (w->'style'->>'size')::int <> 100
      THEN jsonb_set(w || jsonb_build_object('size', (w->'style'->>'size')::int), '{style,size}', '100')
      ELSE w END
    ORDER BY i)
  FROM jsonb_array_elements("widgets") WITH ORDINALITY AS t(w, i)
)
WHERE jsonb_array_length("widgets") > 0;
