-- ============================================================
-- 0018_unify_employees: сотрудник = контрагент (kind='employee'),
-- зарплата = обязательства (кредиторка). Перенос данных и удаление
-- отдельных таблиц employees / payroll_accruals.
-- ============================================================

-- payroll/реквизиты на контрагентах
alter table public.counterparties add column if not exists employment_type public.employment_type;
alter table public.counterparties add column if not exists start_date      date;
alter table public.counterparties add column if not exists payout_currency varchar(8) references public.currencies (code);
alter table public.counterparties add column if not exists payment_method  text;
alter table public.counterparties add column if not exists legal_status    text;
alter table public.counterparties add column if not exists payee_name      text;
alter table public.counterparties add column if not exists bank_account    text;
alter table public.counterparties add column if not exists bank_name       text;
alter table public.counterparties add column if not exists bik             text;
alter table public.counterparties add column if not exists wallet_address  text;
alter table public.counterparties add column if not exists wallet_network  text;
alter table public.counterparties add column if not exists legacy_employee_id uuid;

-- payroll-признаки на обязательствах
alter table public.obligations add column if not exists pay_part     public.accrual_kind;
alter table public.obligations add column if not exists period_month date;

-- employees -> counterparties (kind='employee')
insert into public.counterparties
  (team_id, name, kind, note, inn, employment_type, start_date, payout_currency,
   payment_method, legal_status, payee_name, bank_account, bank_name, bik,
   wallet_address, wallet_network, legacy_employee_id)
select e.team_id, e.name, 'employee', e.note, e.inn, e.employment_type, e.start_date, e.payout_currency,
   e.payment_method, e.legal_status, e.payee_name, e.bank_account, e.bank_name, e.bik,
   e.wallet_address, e.wallet_network, e.id
from public.employees e;

-- начисления -> кредиторские обязательства
insert into public.obligations
  (team_id, counterparty_id, type, amount, currency, project_id, due_date, period_month, pay_part, status, note, created_by, created_at)
select pa.team_id, c.id, 'payable', pa.amount, pa.currency, pa.project_id, pa.period_month, pa.period_month, pa.kind, 'open', 'Начисление ЗП', pa.created_by, pa.created_at
from public.payroll_accruals pa
join public.counterparties c on c.legacy_employee_id = pa.employee_id;

-- выплаты сотрудникам -> привязать к контрагенту-сотруднику
update public.transactions t
set counterparty_id = c.id
from public.counterparties c
where c.legacy_employee_id = t.employee_id
  and t.employee_id is not null
  and t.counterparty_id is null;

-- удаляем старые структуры
alter table public.transactions drop column if exists employee_id;
alter table public.transactions drop column if exists pay_part;
drop table if exists public.payroll_accruals cascade;
drop table if exists public.employees cascade;

alter table public.counterparties drop column if exists legacy_employee_id;
