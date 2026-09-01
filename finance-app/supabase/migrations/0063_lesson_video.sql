-- 0063_lesson_video: видео урока (Loom) + тайм-коды.
-- video_url — нормализованный embed-URL Loom; timecodes — [{ t:"1:12", label:"…" }].
-- Урок = kb_articles; видео и тайм-коды задаются в редакторе и рендерятся
-- отдельным блоком над телом урока с возможностью перемотки.

alter table public.kb_articles
  add column if not exists video_url text,
  add column if not exists timecodes jsonb not null default '[]'::jsonb;
