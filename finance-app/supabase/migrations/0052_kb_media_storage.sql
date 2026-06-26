-- ============================================================
-- 0052_kb_media_storage: бакет для медиа базы знаний (картинки, GIF, видео).
-- Путь объекта: {team_id}/{uuid}.{ext}. Чтение — публичное (public bucket),
-- запись/удаление — членам соответствующей команды.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('kb-media', 'kb-media', true)
on conflict (id) do update set public = true;

-- INSERT: загружать может член команды в префикс своей команды
drop policy if exists kb_media_insert on storage.objects;
create policy kb_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'kb-media'
  and public.is_team_member( ((storage.foldername(name))[1])::uuid )
);

-- UPDATE: член команды в своём префиксе
drop policy if exists kb_media_update on storage.objects;
create policy kb_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'kb-media'
  and public.is_team_member( ((storage.foldername(name))[1])::uuid )
)
with check (
  bucket_id = 'kb-media'
  and public.is_team_member( ((storage.foldername(name))[1])::uuid )
);

-- DELETE: член команды в своём префиксе
drop policy if exists kb_media_delete on storage.objects;
create policy kb_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'kb-media'
  and public.is_team_member( ((storage.foldername(name))[1])::uuid )
);

-- SELECT: членам команды (контент при этом публично доступен по public-URL бакета)
drop policy if exists kb_media_select on storage.objects;
create policy kb_media_select on storage.objects for select to authenticated
using ( bucket_id = 'kb-media' );
