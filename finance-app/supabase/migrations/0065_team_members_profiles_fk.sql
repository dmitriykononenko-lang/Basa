-- ============================================================
-- 0065_team_members_profiles_fk: восстановить связь team_members → profiles
-- для PostgREST-embed `profiles(full_name)`.
--
-- Баг: team_members.user_id имел FK только на auth.users, поэтому запросы
-- вида team_members.select("user_id, profiles(full_name)") не могли связать
-- таблицы (PGRST200) и молча возвращали пустой список аккаунтов. Из-за этого
-- пустовали пикеры «учётная запись»/«ответственный»/«кому доступно» в
-- Оргструктуре, Показателях, Академии и Паролях.
--
-- profiles.id = auth.users.id, все team_members имеют строку profiles (проверено),
-- поэтому прямой FK на profiles безопасен и включает embed во всех этих экранах.
-- ============================================================

alter table public.team_members
  add constraint team_members_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- Перечитать схему PostgREST, чтобы связь заработала сразу.
notify pgrst, 'reload schema';
