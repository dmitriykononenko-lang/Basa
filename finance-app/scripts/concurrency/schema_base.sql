-- ============================================================================
-- schema_base.sql — воспроизведение боевой схемы Basa в части, затрагиваемой
-- финансовыми write-flow. Состояние = production ДО ремедиации (шаги 0–5):
-- набор таблиц, типов, CHECK-ограничений и уникальных индексов скопирован с
-- production (information_schema / pg_indexes / pg_constraint / pg_enum),
-- включая ОТСУТСТВУЮЩИЕ ограничения — именно их отсутствие и проверяют тесты.
--
-- Поверх этой схемы прогоняются миграции 0086–0090 (режим post) — так же, как
-- они будут применяться к production.
-- ============================================================================

create extension if not exists pgcrypto;

-- роли Supabase (нужны для GRANT в миграциях); роли кластерные, создаются один раз
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

-- ─── эмуляция окружения Supabase ────────────────────────────────────────────
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- ─── типы (значения 1:1 с production pg_enum) ───────────────────────────────
do $$ begin
  create type tx_type as enum ('income','expense','transfer');
  create type app_role as enum ('owner','admin','manager','employee','viewer');
  create type obligation_type as enum ('receivable','payable');
  create type obligation_status as enum ('open','partial','closed');
  create type accrual_kind as enum ('fixed','variable');
  create type category_kind as enum ('income','expense');
  create type cf_activity as enum ('operating','investing','financial');
  create type pnl_treatment as enum ('auto','direct','indirect','other','excluded');
  create type counterparty_kind as enum ('client','supplier','partner','other','employee','agent');
exception when duplicate_object then null; end $$;

-- ─── арендаторы и роли ──────────────────────────────────────────────────────
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Team',
  base_currency text not null default 'RUB');

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null,
  role app_role not null,
  primary key (team_id, user_id));

-- helper-функции ролей: те же имена и семантика, что в production
create or replace function public.is_team_member(_team uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id=_team and user_id=auth.uid()) $$;

create or replace function public.current_team_role(_team uuid) returns app_role
  language sql stable security definer set search_path = public as $$
  select role from team_members where team_id=_team and user_id=auth.uid() $$;

create or replace function public.can_edit_finance(_team uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team) in ('owner','admin','manager') $$;

create or replace function public.can_write_tx(_team uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team) in ('owner','admin','manager','employee') $$;

create or replace function public.can_manage_team(_team uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team) in ('owner','admin') $$;

-- ─── справочники ────────────────────────────────────────────────────────────
create table accounts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  currency text not null default 'RUB',
  opening_balance bigint not null default 0,
  archived boolean not null default false);

create table categories (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  kind category_kind not null,
  cf_activity cf_activity not null default 'operating',
  pnl_treatment pnl_treatment not null default 'auto',
  archived boolean not null default false);

create table counterparties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  inn text, kpp text,
  kind counterparty_kind not null default 'other',
  auto_accrue boolean not null default false,
  advance_amount bigint,
  start_date date, end_date date,
  archived boolean not null default false);

create table projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  type text not null default 'project',
  status text not null default 'active',
  archived boolean not null default false,
  responsible_counterparty_id uuid,
  bonus_amount bigint, bonus_currency text);

create table project_periods (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  period_start date not null, period_end date not null);

create table employee_salaries (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references counterparties(id) on delete cascade,
  amount bigint not null, currency text not null default 'RUB',
  effective_from date not null);

-- ─── банк ───────────────────────────────────────────────────────────────────
create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  provider text not null,
  token_cipher text,
  api_version text not null default 'v2',
  default_account_id uuid,
  default_income_category_id uuid,
  default_expense_category_id uuid,
  last_synced_at timestamptz,
  unique (team_id, provider));                       -- как в production

create table bank_account_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  provider text not null, external_account text not null, account_id uuid);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  file_name text not null,
  account_id uuid,
  bank text,
  row_count integer not null default 0,
  status text not null default 'imported',
  note text);

-- ─── операции ───────────────────────────────────────────────────────────────
create table transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  type tx_type not null,
  amount bigint not null check (amount > 0),         -- transactions_amount_check
  currency text not null default 'RUB',
  account_id uuid references accounts(id),
  transfer_account_id uuid references accounts(id),
  category_id uuid references categories(id),
  counterparty_id uuid references counterparties(id),
  project_id uuid references projects(id),
  occurred_on date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  status text not null default 'actual',
  import_batch_id uuid references import_batches(id) on delete set null,
  accrual_date date,
  recurring_rule_id uuid,
  obligation_id uuid,
  external_id text,
  source text,
  transfer_amount bigint,
  transfer_currency text);

-- уникальные индексы — ровно как в production
create unique index transactions_source_external_uidx
  on transactions (team_id, source, external_id) where external_id is not null;
create unique index transactions_bybit_extid_uidx
  on transactions (team_id, external_id) where source='bybit' and external_id is not null;
create unique index transactions_obl_planned_uniq
  on transactions (obligation_id) where obligation_id is not null and status='planned';

create table transaction_splits (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  amount bigint not null,
  category_id uuid, project_id uuid, counterparty_id uuid,
  is_obligation boolean not null default false,
  note text,
  created_at timestamptz not null default now());

create table attachments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  storage_path text not null, file_name text not null,
  created_by uuid, created_at timestamptz not null default now());

-- ─── инвойсы ────────────────────────────────────────────────────────────────
create table invoices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  number text not null default '',
  counterparty_id uuid, buyer_name text not null default '',
  buyer_inn text not null default '', buyer_kpp text not null default '',
  project_id uuid,
  currency text not null default 'RUB',
  amount bigint not null default 0,
  vat_amount bigint not null default 0,
  purpose text not null default '',
  issue_date date not null default current_date,
  payment_expiry_date date,
  status text not null default 'draft'
    check (status in ('draft','payment_waiting','paid','payment_expired','cancelled')),
  tochka_document_id text, tochka_account_id text,
  paid_on date, note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_transaction_id uuid);
-- ВНИМАНИЕ (факт production): уникального индекса (team_id, number) НЕТ.

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  name text not null default '',
  quantity numeric not null default 1,
  unit text not null default 'шт',
  price bigint not null default 0,
  vat_rate text not null default 'none' check (vat_rate in ('none','0','10','20')),
  amount bigint not null default 0,
  sort integer not null default 0);

-- ─── обязательства ──────────────────────────────────────────────────────────
create table obligations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  counterparty_id uuid not null references counterparties(id),
  type obligation_type not null,
  amount bigint not null check (amount > 0),
  currency text not null,
  project_id uuid, due_date date,
  status obligation_status not null default 'open',
  note text, created_by uuid,
  created_at timestamptz not null default now(),
  pay_part accrual_kind, period_month date, category_id uuid,
  source_transaction_id uuid unique,
  source_project_id uuid);
create unique index obligations_source_project_key
  on obligations (source_project_id) where source_project_id is not null;
-- ВНИМАНИЕ (факт production): индекса (counterparty_id,type,pay_part,period_month) НЕТ.

create table obligation_payments (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id) on delete cascade,
  amount bigint not null check (amount > 0),
  paid_on date not null default current_date,
  transaction_id uuid,
  created_by uuid,
  created_at timestamptz not null default now());
create unique index obligation_payments_tx_obl_uniq
  on obligation_payments (transaction_id, obligation_id) where transaction_id is not null;
-- ВНИМАНИЕ (факт production): ограничения Σ payments ≤ obligations.amount НЕТ.

create view obligation_balances as
  select o.id, o.team_id, o.counterparty_id, o.type, o.amount, o.currency, o.due_date, o.note,
         coalesce((select sum(p.amount) from obligation_payments p where p.obligation_id=o.id),0) as paid,
         o.amount - coalesce((select sum(p.amount) from obligation_payments p where p.obligation_id=o.id),0) as outstanding
  from obligations o;

create view account_balances as
  select a.id as account_id, a.team_id, a.currency,
    a.opening_balance
    + coalesce((select sum(case when t.type='income' then t.amount
                                when t.type='expense' then -t.amount
                                when t.type='transfer' then -t.amount end)
                from transactions t where t.status='actual' and t.account_id=a.id),0)
    + coalesce((select sum(coalesce(t.transfer_amount,t.amount)) from transactions t
                where t.status='actual' and t.type='transfer' and t.transfer_account_id=a.id),0) as balance
  from accounts a;

-- ─── production-версии функций, которые правит ремедиация ───────────────────
-- materialize_auto_accruals: тело сокращено до проверяемой сути (guard
-- «if not exists → insert» и окно между проверкой и вставкой), остальное
-- (цикл по месяцам/сотрудникам) даёт только длину окна.
create or replace function public.materialize_auto_accruals(p_team uuid, p_window_ms int default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare v_created int := 0; emp record; m date; amt bigint; cur text;
begin
  if not public.can_edit_finance(p_team) then return 0; end if;
  for emp in select c.id from counterparties c
             where c.team_id=p_team and c.auto_accrue and not c.archived
               and exists (select 1 from employee_salaries s where s.counterparty_id=c.id)
  loop
    for m in select period_month from (select date_trunc('month', current_date)::date as period_month) x
    loop
      if not exists (select 1 from obligations o
                     where o.counterparty_id=emp.id and o.type='payable'
                       and o.pay_part='fixed' and o.period_month=m) then
        if p_window_ms > 0 then perform pg_sleep(p_window_ms/1000.0); end if;
        select s.amount, s.currency into amt, cur from employee_salaries s
          where s.counterparty_id=emp.id and s.effective_from<=m order by s.effective_from desc limit 1;
        if amt is not null then
          insert into obligations (team_id, counterparty_id, type, amount, currency, due_date,
                                   period_month, pay_part, status, note)
          values (p_team, emp.id, 'payable', amt, cur, m, m, 'fixed', 'open', 'Начисление ЗП (авто)');
          v_created := v_created + 1;
        end if;
      end if;
    end loop;
  end loop;
  return v_created;
end $$;

-- заглушка production-функции (нужна materialize_support_cycles)
create or replace function public.support_open_period(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into project_periods (project_id, period_start, period_end)
  select p_project, coalesce(max(period_end), current_date) + 1,
                    coalesce(max(period_end), current_date) + 30
    from project_periods where project_id = p_project;
end $$;

-- ─── сид ────────────────────────────────────────────────────────────────────
insert into teams (id, name) values ('11111111-1111-1111-1111-111111111111','KO');
insert into team_members values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','owner');
insert into team_members values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','manager');
insert into accounts (id, team_id, name, currency) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Счет Услуги','RUB'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Фонд Прибыль','RUB');
insert into categories (id, team_id, name, kind, cf_activity) values
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Вывод средств собственнику','expense','financial'),
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Прочие расходы','expense','operating');
-- start_date/effective_from = начало текущего месяца: авто-начисление создаёт
-- ровно одну строку, чтобы тест T1 сравнивал детерминированные числа.
insert into counterparties (id, team_id, name, kind, auto_accrue, start_date, advance_amount) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Сотрудник','employee',true,
   date_trunc('month', current_date)::date, 0);
insert into employee_salaries (counterparty_id, amount, currency, effective_from)
  values ('22222222-2222-2222-2222-222222222222', 2500000, 'RUB', date_trunc('month', current_date)::date);
insert into projects (id, team_id, name) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','[126] Проект');
insert into bank_connections (team_id, provider, last_synced_at)
  values ('11111111-1111-1111-1111-111111111111','tochka', now() - interval '5 hours');
