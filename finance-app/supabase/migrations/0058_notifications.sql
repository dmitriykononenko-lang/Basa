-- ============================================================
-- 0058_notifications: центр уведомлений (колокольчик) + настройки email-дайджеста.
--
-- notifications — персональные уведомления пользователя. Пишет ТОЛЬКО крон через
-- service_role (insert-политики нет → клиент вставлять не может). Пользователь
-- видит/отмечает прочитанным/скрывает только свои строки. dedupe_key обеспечивает
-- идемпотентность повторных прогонов крона (unique по user_id+dedupe_key).
--
-- notification_prefs — персональные настройки рассылки (email-дайджест вкл/выкл).
-- Отсутствие строки трактуется кодом как «включено».
-- ============================================================

-- ---- Уведомления ----
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null check (type in
                ('cash_gap','debt_overdue','budget_over','transfer_short','training_due')),
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create unique index if not exists notifications_user_dedupe_uniq
  on public.notifications (user_id, dedupe_key);
create index if not exists notifications_user_read_idx
  on public.notifications (user_id, read_at);
create index if not exists notifications_team_idx
  on public.notifications (team_id);

alter table public.notifications enable row level security;
-- Свои строки: видеть, отмечать прочитанным (update read_at), скрывать (delete).
-- Insert-политики НЕТ — записывает только крон через service_role (в обход RLS).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete
  using (user_id = auth.uid());

-- ---- Настройки рассылки ----
create table if not exists public.notification_prefs (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  email_digest  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists notification_prefs_team_user_uniq
  on public.notification_prefs (team_id, user_id);

drop trigger if exists notification_prefs_touch on public.notification_prefs;
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.kb_touch_updated_at();

alter table public.notification_prefs enable row level security;
-- Свои строки целиком (select/insert/update). Удаление не нужно.
drop policy if exists notification_prefs_select on public.notification_prefs;
create policy notification_prefs_select on public.notification_prefs for select
  using (user_id = auth.uid());
drop policy if exists notification_prefs_insert on public.notification_prefs;
create policy notification_prefs_insert on public.notification_prefs for insert
  with check (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists notification_prefs_update on public.notification_prefs;
create policy notification_prefs_update on public.notification_prefs for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
