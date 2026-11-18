-- ============================================================
-- 0064_telegram_links: привязка Telegram-аккаунта к учётке сотрудника
-- для Mini App «Обучение».
--
-- Поток привязки (email + одноразовый код):
--   1) Сотрудник в веб-приложении (профиль) генерирует код — строка в
--      telegram_link_codes (email из auth.users + хеш кода + срок 10 мин).
--   2) В Telegram Mini App вводит рабочий email и этот код.
--   3) Сервер (service_role) проверяет код по (email, code_hash, expires_at),
--      создаёт telegram_links и удаляет код.
--
-- telegram_user_id уникален: один Telegram-аккаунт ↔ одна учётка.
-- Запись в обе таблицы из TG-роутов идёт под service_role (в обход RLS),
-- т.к. в Telegram нет supabase-сессии. Генерация кода — под сессией веба.
-- ============================================================

create table if not exists public.telegram_links (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  telegram_user_id  bigint not null unique,
  telegram_username text,
  telegram_name     text,
  photo_url         text,
  linked_at         timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
-- Свою привязку видно (профиль показывает статус) и можно отвязать.
drop policy if exists telegram_links_select on public.telegram_links;
create policy telegram_links_select on public.telegram_links for select
  using (user_id = auth.uid());
drop policy if exists telegram_links_delete on public.telegram_links;
create policy telegram_links_delete on public.telegram_links for delete
  using (user_id = auth.uid());
-- INSERT/UPDATE-политик нет: пишет только TG-роут через service_role.

create table if not exists public.telegram_link_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  code_hash  text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists telegram_link_codes_email_idx on public.telegram_link_codes (lower(email));

alter table public.telegram_link_codes enable row level security;
-- Пользователь управляет только своим кодом привязки (генерация из профиля).
drop policy if exists telegram_link_codes_own on public.telegram_link_codes;
create policy telegram_link_codes_own on public.telegram_link_codes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Проверка/потребление кода — в TG-роуте под service_role (в обход RLS).
