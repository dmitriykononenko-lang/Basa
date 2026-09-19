-- ============================================================
-- 0049_bank_account_links: сопоставление счетов банка (Точка) со счетами Basa.
-- Номер счёта в банке → счёт в Basa. Нужен, чтобы импортировать операции на
-- правильный счёт и заполнять оба конца переводов между своими счетами.
-- ============================================================

create table if not exists public.bank_account_links (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams(id) on delete cascade,
  provider         text not null default 'tochka',
  external_account text not null,                 -- номер счёта в банке (без БИК)
  account_id       uuid references public.accounts(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (team_id, provider, external_account)
);

create index if not exists bank_account_links_team_idx on public.bank_account_links(team_id, provider);

alter table public.bank_account_links enable row level security;
drop policy if exists bal_select on public.bank_account_links;
drop policy if exists bal_insert on public.bank_account_links;
drop policy if exists bal_update on public.bank_account_links;
drop policy if exists bal_delete on public.bank_account_links;
create policy bal_select on public.bank_account_links for select using (public.can_edit_finance(team_id));
create policy bal_insert on public.bank_account_links for insert with check (public.can_edit_finance(team_id));
create policy bal_update on public.bank_account_links for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy bal_delete on public.bank_account_links for delete using (public.can_edit_finance(team_id));
