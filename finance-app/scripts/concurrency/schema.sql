-- Minimal replica of the Basa write-flows under audit (structure copied from prod:
-- constraints/indexes exactly as pg_indexes/pg_constraint report for the real DB).
create table teams(id uuid primary key default gen_random_uuid());
create table counterparties(id uuid primary key default gen_random_uuid(), team_id uuid, name text, inn text);
create table projects(id uuid primary key default gen_random_uuid(), team_id uuid, name text);

create table invoices(
  id uuid primary key default gen_random_uuid(), team_id uuid, number text,
  project_id uuid, amount bigint default 0, status text default 'payment_waiting');
-- NOTE (prod fact): NO unique index on (team_id, number).
create table invoice_items(
  id uuid primary key default gen_random_uuid(), team_id uuid, invoice_id uuid references invoices(id) on delete cascade,
  name text, amount bigint, sort int,
  vat_rate text default 'none' check (vat_rate in ('none','0','10','20')));

create table obligations(
  id uuid primary key default gen_random_uuid(), team_id uuid, counterparty_id uuid,
  type text, pay_part text, period_month date, amount bigint check(amount>0), currency text,
  due_date date, status text default 'open', note text,
  source_transaction_id uuid unique, created_at timestamptz default now());
-- NOTE (prod fact): NO unique index on (counterparty_id,type,pay_part,period_month).

create table transactions(
  id uuid primary key default gen_random_uuid(), team_id uuid, amount bigint check(amount>0),
  currency text, source text, external_id text, occurred_on date, status text default 'actual',
  note text, category_id uuid);
create unique index transactions_source_external_uidx on transactions(team_id, source, external_id) where external_id is not null;

create table obligation_payments(
  id uuid primary key default gen_random_uuid(), obligation_id uuid references obligations(id),
  amount bigint check(amount>0), paid_on date, transaction_id uuid);
create unique index obligation_payments_tx_obl_uniq on obligation_payments(transaction_id, obligation_id) where transaction_id is not null;
-- NOTE (prod fact): NO constraint tying sum(obligation_payments.amount) to obligations.amount.

create view obligation_balances as
  select o.id, o.team_id, o.counterparty_id, o.type, o.amount, o.currency,
         coalesce((select sum(p.amount) from obligation_payments p where p.obligation_id=o.id),0) as paid,
         o.amount - coalesce((select sum(p.amount) from obligation_payments p where p.obligation_id=o.id),0) as outstanding
  from obligations o;

create table bank_connections(
  team_id uuid, provider text, last_synced_at timestamptz,
  unique(team_id, provider));

create table employee_salaries(counterparty_id uuid, amount bigint, currency text, effective_from date);

insert into teams(id) values ('11111111-1111-1111-1111-111111111111');
insert into counterparties(id, team_id, name) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Сотрудник');
insert into projects(id, team_id, name) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','[126] Проект');
insert into employee_salaries values ('22222222-2222-2222-2222-222222222222', 2500000, 'RUB', '2026-01-01');
