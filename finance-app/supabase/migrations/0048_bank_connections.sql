-- ============================================================
-- 0048_bank_connections: подключение банка (Точка) по API.
-- Храним зашифрованный JWT-токен по команде + параметры импорта.
-- Дедуп операций по внешнему id (external_id + source).
-- ============================================================

create table if not exists public.bank_connections (
  id                          uuid primary key default gen_random_uuid(),
  team_id                     uuid not null references public.teams(id) on delete cascade,
  provider                    text not null default 'tochka',
  token_cipher                text not null,                -- AES-256-GCM, base64(iv).base64(tag).base64(data)
  api_version                 text not null default 'v1.0',
  default_account_id          uuid references public.accounts(id) on delete set null,
  default_income_category_id  uuid references public.categories(id) on delete set null,
  default_expense_category_id uuid references public.categories(id) on delete set null,
  last_synced_at              timestamptz,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (team_id, provider)
);

alter table public.bank_connections enable row level security;
drop policy if exists bc_select on public.bank_connections;
drop policy if exists bc_insert on public.bank_connections;
drop policy if exists bc_update on public.bank_connections;
drop policy if exists bc_delete on public.bank_connections;
create policy bc_select on public.bank_connections for select using (public.can_edit_finance(team_id));
create policy bc_insert on public.bank_connections for insert with check (public.can_edit_finance(team_id));
create policy bc_update on public.bank_connections for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy bc_delete on public.bank_connections for delete using (public.can_edit_finance(team_id));

-- Дедуп импортированных операций: внешний идентификатор из банка.
alter table public.transactions add column if not exists external_id text;
alter table public.transactions add column if not exists source text;
create unique index if not exists transactions_source_external_uidx
  on public.transactions(team_id, source, external_id)
  where external_id is not null;
