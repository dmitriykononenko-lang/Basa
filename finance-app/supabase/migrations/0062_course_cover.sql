-- 0062_course_cover: обложка курса (Академия/Обучение).
-- Картинка хранится в Storage-бакете kb-media (public), здесь — только URL.

alter table public.academy_courses
  add column if not exists cover_url text;
