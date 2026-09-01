-- ============================================================
-- 0002_finance_core: счета, категории, контрагенты, проекты,
-- операции, обязательства (долги), бюджеты, валюты, RLS
-- ============================================================

-- ---------- Enum-типы ----------
do $$ begin create type public.tx_type        as enum ('income', 'expense', 'transfer');           exception when duplicate_object then null; end $$;
do $$ begin create type public.category_kind  as enum ('income', 'expense');                        exception when duplicate_object then null; end $$;
do $$ begin create type public.counterparty_kind as enum ('client', 'supplier', 'partner', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.obligation_type as enum ('receivable', 'payable');                    exception when duplicate_object then null; end $$;
do $$ begin create type public.obligation_status as enum ('open', 'partial', 'closed');              exception when duplicate_object then null; end $$;
do $$ begin create type public.budget_period   as enum ('month', 'quarter', 'year');                 exception when duplicate_object then null; end $$;

-- ---------- Справочник валют ----------
create table if not exists public.currencies (
  code       char(3) primary key,
  name       text not null,
  symbol     text,
  minor_unit smallint not null default 2
);

insert into public.currencies (code, name, symbol, minor_unit) values
  ('RUB', 'Российский рубль', '₽', 2),
  ('USD', 'Доллар США',       '$', 2),
  ('EUR', 'Евро',             '€', 2),
  ('KZT', 'Тенге',            '₸', 2),
  ('UAH', 'Гривна',           '₴', 2),
  ('GBP', 'Фунт стерлингов',  '£', 2),
  ('CNY', 'Юань',             '¥', 2)
on conflict (code) do nothing;

-- ---------- Курсы валют (к базовой валюте команды) ----------
create table if not exists public.fx_rates (
  team_id   uuid not null references public.teams (id) on delete cascade,
  currency  char(3) not null references public.currencies (code),
  rate      numeric(18,8) not null,         -- 1 единица currency = rate базовой валюты
  rate_date date not null default current_date,
  primary key (team_id, currency, rate_date)
);

-- ---------- Счета / кассы ----------
create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  currency   char(3) not null references public.currencies (code),
  kind       text not null default 'bank',  -- bank | cash | card | other
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists accounts_team_idx on public.accounts (team_id);

-- ---------- Категории доходов/расходов (дерево) ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  kind       public.category_kind not null,
  parent_id  uuid references public.categories (id) on delete set null,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists categories_team_idx on public.categories (team_id);

-- ---------- Контрагенты ----------
create table if not exists public.counterparties (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  kind       public.counterparty_kind not null default 'other',
  note       text,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists counterparties_team_idx on public.counterparties (team_id);

-- ---------- Проекты ----------
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  status     text not null default 'active', -- active | done | archived
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists projects_team_idx on public.projects (team_id);

-- ---------- Операции (доход / расход / перевод) ----------
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams (id) on delete cascade,
  type              public.tx_type not null,
  amount            bigint not null check (amount > 0),  -- в минорных единицах (копейках)
  currency          char(3) not null references public.currencies (code),
  account_id        uuid references public.accounts (id) on delete set null,
  transfer_account_id uuid references public.accounts (id) on delete set null, -- для переводов
  category_id       uuid references public.categories (id) on delete set null,
  counterparty_id   uuid references public.counterparties (id) on delete set null,
  project_id        uuid references public.projects (id) on delete set null,
  occurred_on       date not null default current_date,
  note              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index if not exists transactions_team_idx    on public.transactions (team_id, occurred_on desc);
create index if not exists transactions_account_idx on public.transactions (account_id);
create index if not exists transactions_author_idx  on public.transactions (created_by);

-- ---------- Обязательства / долги (дебиторка / кредиторка) ----------
create table if not exists public.obligations (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams (id) on delete cascade,
  counterparty_id uuid not null references public.counterparties (id) on delete cascade,
  type            public.obligation_type not null,       -- receivable=нам должны, payable=мы должны
  amount          bigint not null check (amount > 0),     -- сумма обязательства, минорные единицы
  currency        char(3) not null references public.currencies (code),
  project_id      uuid references public.projects (id) on delete set null,
  due_date        date,
  status          public.obligation_status not null default 'open',
  note            text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index if not exists obligations_team_idx on public.obligations (team_id);
create index if not exists obligations_cp_idx   on public.obligations (counterparty_id);

-- ---------- Погашения обязательств ----------
create table if not exists public.obligation_payments (
  id             uuid primary key default gen_random_uuid(),
  obligation_id  uuid not null references public.obligations (id) on delete cascade,
  amount         bigint not null check (amount > 0),
  paid_on        date not null default current_date,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index if not exists obligation_payments_idx on public.obligation_payments (obligation_id);

-- ---------- Бюджеты ----------
create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete cascade,
  amount       bigint not null check (amount > 0),
  currency     char(3) not null references public.currencies (code),
  period       public.budget_period not null default 'month',
  period_start date not null default date_trunc('month', current_date)::date,
  created_at   timestamptz not null default now()
);
create index if not exists budgets_team_idx on public.budgets (team_id);

-- ============================================================
-- RLS-политики
-- ============================================================

-- helper: может ли текущий пользователь редактировать финансы команды
create or replace function public.can_edit_finance(_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_team_role(_team_id) in ('owner', 'admin', 'manager');
$$;

-- helper: может ли заводить операции (всё кроме наблюдателя)
create or replace function public.can_write_tx(_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_team_role(_team_id) in ('owner', 'admin', 'manager', 'employee');
$$;

-- currencies — публичный справочник, только чтение
alter table public.currencies enable row level security;
drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies for select using (true);

-- Универсальные политики для справочных таблиц команды
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','counterparties','projects','budgets','fx_rates'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('create policy %I_select on public.%I for select using (public.is_team_member(team_id));', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (public.can_edit_finance(team_id));', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete using (public.can_edit_finance(team_id));', t, t);
  end loop;
end $$;

-- transactions — сотрудник видит/правит только свои, остальные роли — все
alter table public.transactions enable row level security;

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select
  using (
    public.is_team_member(team_id)
    and (public.current_team_role(team_id) <> 'employee' or created_by = auth.uid())
  );

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert
  with check (public.can_write_tx(team_id) and created_by = auth.uid());

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update
  using (
    public.can_edit_finance(team_id)
    or (public.current_team_role(team_id) = 'employee' and created_by = auth.uid())
  )
  with check (
    public.can_edit_finance(team_id)
    or (public.current_team_role(team_id) = 'employee' and created_by = auth.uid())
  );

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete
  using (
    public.can_edit_finance(team_id)
    or (public.current_team_role(team_id) = 'employee' and created_by = auth.uid())
  );

-- obligations — видят все участники, правят owner/admin/manager
alter table public.obligations enable row level security;
drop policy if exists obligations_select on public.obligations;
create policy obligations_select on public.obligations for select using (public.is_team_member(team_id));
drop policy if exists obligations_insert on public.obligations;
create policy obligations_insert on public.obligations for insert with check (public.can_edit_finance(team_id));
drop policy if exists obligations_update on public.obligations;
create policy obligations_update on public.obligations for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists obligations_delete on public.obligations;
create policy obligations_delete on public.obligations for delete using (public.can_edit_finance(team_id));

-- obligation_payments — через родительское обязательство
alter table public.obligation_payments enable row level security;
drop policy if exists obligation_payments_select on public.obligation_payments;
create policy obligation_payments_select on public.obligation_payments for select
  using (exists (select 1 from public.obligations o where o.id = obligation_id and public.is_team_member(o.team_id)));
drop policy if exists obligation_payments_insert on public.obligation_payments;
create policy obligation_payments_insert on public.obligation_payments for insert
  with check (exists (select 1 from public.obligations o where o.id = obligation_id and public.can_edit_finance(o.team_id)));
drop policy if exists obligation_payments_delete on public.obligation_payments;
create policy obligation_payments_delete on public.obligation_payments for delete
  using (exists (select 1 from public.obligations o where o.id = obligation_id and public.can_edit_finance(o.team_id)));
