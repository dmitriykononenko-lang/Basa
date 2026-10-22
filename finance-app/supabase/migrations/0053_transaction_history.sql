-- ============================================================
-- 0050_transaction_history: история изменений операций.
-- Триггер на public.transactions фиксирует создание и каждое
-- изменение отслеживаемых полей (сумма, счёт, статья, проект,
-- контрагент, даты, статус, описание, тип) с автором и временем.
-- Запись идёт через SECURITY DEFINER, чтение — участникам команды.
-- ============================================================

create table if not exists public.transaction_history (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  action         text not null check (action in ('create','update')),
  changed_by     uuid references auth.users(id) on delete set null,
  changed_at     timestamptz not null default now(),
  changes        jsonb not null default '[]'::jsonb,
  source         text
);

create index if not exists transaction_history_tx_idx
  on public.transaction_history(transaction_id, changed_at desc);

alter table public.transaction_history enable row level security;
-- Читают участники команды. Пишет только триггер (SECURITY DEFINER),
-- поэтому клиентских политик insert/update/delete нет — записи неизменяемы.
drop policy if exists th_select on public.transaction_history;
create policy th_select on public.transaction_history
  for select using (public.is_team_member(team_id));

create or replace function public.log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  diffs jsonb := '[]'::jsonb;
  uid uuid := auth.uid();
begin
  if (tg_op = 'INSERT') then
    insert into public.transaction_history(transaction_id, team_id, action, changed_by, changes, source)
    values (new.id, new.team_id, 'create', uid, '[]'::jsonb, new.source);
    return new;
  end if;

  -- UPDATE: собираем дельты только по отслеживаемым полям
  if new.amount is distinct from old.amount then
    diffs := diffs || jsonb_build_object('field','amount','old',old.amount,'new',new.amount);
  end if;
  if new.currency is distinct from old.currency then
    diffs := diffs || jsonb_build_object('field','currency','old',old.currency,'new',new.currency);
  end if;
  if new.type is distinct from old.type then
    diffs := diffs || jsonb_build_object('field','type','old',old.type::text,'new',new.type::text);
  end if;
  if new.account_id is distinct from old.account_id then
    diffs := diffs || jsonb_build_object('field','account_id','old',old.account_id,'new',new.account_id);
  end if;
  if new.transfer_account_id is distinct from old.transfer_account_id then
    diffs := diffs || jsonb_build_object('field','transfer_account_id','old',old.transfer_account_id,'new',new.transfer_account_id);
  end if;
  if new.category_id is distinct from old.category_id then
    diffs := diffs || jsonb_build_object('field','category_id','old',old.category_id,'new',new.category_id);
  end if;
  if new.counterparty_id is distinct from old.counterparty_id then
    diffs := diffs || jsonb_build_object('field','counterparty_id','old',old.counterparty_id,'new',new.counterparty_id);
  end if;
  if new.project_id is distinct from old.project_id then
    diffs := diffs || jsonb_build_object('field','project_id','old',old.project_id,'new',new.project_id);
  end if;
  if new.occurred_on is distinct from old.occurred_on then
    diffs := diffs || jsonb_build_object('field','occurred_on','old',old.occurred_on,'new',new.occurred_on);
  end if;
  if new.accrual_date is distinct from old.accrual_date then
    diffs := diffs || jsonb_build_object('field','accrual_date','old',old.accrual_date,'new',new.accrual_date);
  end if;
  if new.note is distinct from old.note then
    diffs := diffs || jsonb_build_object('field','note','old',old.note,'new',new.note);
  end if;
  if new.status is distinct from old.status then
    diffs := diffs || jsonb_build_object('field','status','old',old.status,'new',new.status);
  end if;

  if jsonb_array_length(diffs) > 0 then
    insert into public.transaction_history(transaction_id, team_id, action, changed_by, changes, source)
    values (new.id, new.team_id, 'update', uid, diffs, new.source);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_transaction_change on public.transactions;
create trigger trg_log_transaction_change
  after insert or update on public.transactions
  for each row execute function public.log_transaction_change();
