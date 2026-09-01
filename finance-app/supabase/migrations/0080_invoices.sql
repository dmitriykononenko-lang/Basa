-- ============================================================
-- 0080_invoices: счета на оплату (инвойсы).
--
-- Выставление счёта клиенту в ₽ из платформы: позиции с НДС, плательщик из
-- контрагентов ИЛИ вручную (название + ИНН), привязка к проекту, статус оплаты
-- (в т.ч. синхронизируемый с Точкой: tochka_document_id + статус). Видят/ведут —
-- финансовые роли (owner/admin/manager) через can_edit_finance.
-- ============================================================

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams (id) on delete cascade,
  number              text not null default '',
  counterparty_id     uuid references public.counterparties (id) on delete set null,
  buyer_name          text not null default '',
  buyer_inn           text not null default '',
  buyer_kpp           text not null default '',
  project_id          uuid references public.projects (id) on delete set null,
  currency            varchar(8) not null default 'RUB',
  amount              bigint not null default 0,   -- итог (минорные единицы) = сумма позиций
  vat_amount          bigint not null default 0,   -- итог НДС (минорные единицы)
  purpose             text not null default '',    -- назначение платежа
  issue_date          date not null default current_date,
  payment_expiry_date date,
  status              text not null default 'draft'
                        check (status in ('draft', 'payment_waiting', 'paid', 'payment_expired', 'cancelled')),
  tochka_document_id  text,
  tochka_account_id   text,
  paid_on             date,
  note                text not null default '',
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists invoices_team_idx on public.invoices (team_id);
create index if not exists invoices_status_idx on public.invoices (team_id, status);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null default '',
  quantity    numeric not null default 1,
  unit        text not null default 'шт',
  price       bigint not null default 0,     -- цена за единицу, минорные, с НДС
  vat_rate    text not null default 'none' check (vat_rate in ('none', '0', '10', '20')),
  amount      bigint not null default 0,     -- quantity * price (минорные)
  sort        int not null default 0
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices
  for each row execute function public.kb_touch_updated_at();

-- ---- RLS ----
alter table public.invoices enable row level security;
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select using (public.can_edit_finance(team_id));
drop policy if exists invoices_cud on public.invoices;
create policy invoices_cud on public.invoices for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

alter table public.invoice_items enable row level security;
drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items for select using (public.can_edit_finance(team_id));
drop policy if exists invoice_items_cud on public.invoice_items;
create policy invoice_items_cud on public.invoice_items for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
