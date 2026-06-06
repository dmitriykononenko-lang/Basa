-- ============================================================
-- 0021_import_batches: батчи импорта выписок + отмена импорта
-- ============================================================

create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  file_name   text not null,
  account_id  uuid references public.accounts (id) on delete set null,
  bank        text,
  row_count   int not null default 0,
  status      text not null default 'imported',
  note        text
);
create index if not exists import_batches_team_created_idx
  on public.import_batches (team_id, created_at desc);

-- Привязка операций к батчу. Отмена импорта = удалить батч → операции уйдут каскадом.
alter table public.transactions
  add column if not exists import_batch_id uuid
  references public.import_batches (id) on delete cascade;
create index if not exists transactions_import_batch_idx
  on public.transactions (import_batch_id);

alter table public.import_batches enable row level security;
drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select using (public.is_team_member(team_id));
drop policy if exists import_batches_insert on public.import_batches;
create policy import_batches_insert on public.import_batches for insert with check (public.can_write_tx(team_id));
drop policy if exists import_batches_update on public.import_batches;
create policy import_batches_update on public.import_batches for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists import_batches_delete on public.import_batches;
create policy import_batches_delete on public.import_batches for delete using (public.can_edit_finance(team_id));
