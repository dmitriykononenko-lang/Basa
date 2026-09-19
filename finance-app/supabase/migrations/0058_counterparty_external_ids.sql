-- ============================================================
-- 0058_counterparty_external_ids: внешние ID контрагентов
-- (amoCRM account ID / Radist ID / Wazzap ID) для автопривязки
-- входящих платежей к проектам. У клиента может быть несколько ID
-- (one-to-many). Опциональная привязка ID к конкретному проекту даёт
-- точную подсказку при распределении; иначе — fallback по «один
-- активный проект у клиента».
-- ============================================================

create table if not exists public.counterparty_external_ids (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  system          text not null check (system in ('amocrm','radist','wazzap','other')),
  external_id     text not null,
  project_id      uuid references public.projects(id) on delete set null,
  label           text,
  created_at      timestamptz not null default now(),
  unique (counterparty_id, system, external_id)
);

create index if not exists cei_lookup_idx on public.counterparty_external_ids(team_id, system, external_id);
create index if not exists cei_cp_idx on public.counterparty_external_ids(counterparty_id);

alter table public.counterparty_external_ids enable row level security;
drop policy if exists cei_select on public.counterparty_external_ids;
drop policy if exists cei_insert on public.counterparty_external_ids;
drop policy if exists cei_update on public.counterparty_external_ids;
drop policy if exists cei_delete on public.counterparty_external_ids;
create policy cei_select on public.counterparty_external_ids for select using (public.is_team_member(team_id));
create policy cei_insert on public.counterparty_external_ids for insert with check (public.can_edit_finance(team_id));
create policy cei_update on public.counterparty_external_ids for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy cei_delete on public.counterparty_external_ids for delete using (public.can_edit_finance(team_id));
