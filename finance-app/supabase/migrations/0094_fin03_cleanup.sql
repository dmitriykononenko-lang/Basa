-- ============================================================
-- 0094_fin03_cleanup — историческая чистка FIN-03 (вариант А, решение владельца 2026-10-17)
--
-- Удаляет 252 CSV-ноги (126 expense + 126 income из svodnaya_vypiska_2025.csv),
-- которые задваивали 126 банковских переводов Точки (FIN03_FORENSICS.md), и тем же
-- движением снимает их компенсацию из opening_balance 9 счетов. Остаток КАЖДОГО
-- счёта до и после обязан совпасть до копейки — это проверяется ниже, иначе откат.
-- Банковские строки type='transfer' не трогаются (их удаление вернул бы синк).
--
-- Весь файл — один DO-блок, то есть одна транзакция: любая проверка, которая не
-- сошлась, бросает исключение и откатывает всё, включая архив.
-- Репетиция без изменений: перед блоком выполнить
--   select set_config('fin03.rehearsal', 'on', false);
-- тогда в самом конце блок бросит исключение с итогами и всё откатится.
-- Откат после фиксации: rollback/0094_down.sql.
-- ============================================================

-- архивы: только для postgres/service_role (RLS без политик, гранты сняты)
create table if not exists public.fin03_removed_transactions as
  select t.*, now() as archived_at, ''::text as reason from public.transactions t where false;
create table if not exists public.fin03_opening_balance_before (
  account_id uuid primary key, account_name text, opening_before bigint not null,
  delta bigint not null, opening_after bigint not null, archived_at timestamptz not null default now());
alter table public.fin03_removed_transactions enable row level security;
alter table public.fin03_opening_balance_before enable row level security;
revoke all on public.fin03_removed_transactions from anon, authenticated, public;
revoke all on public.fin03_opening_balance_before from anon, authenticated, public;

do $$
declare
  n_cases int; n_rm int; n_bad int; vol bigint; r_d record; cash_before bigint; cash_after bigint;
  rev_before bigint; rev_after bigint; fin03_after int;
  -- ожидаемые значения из dry-run 2026-10-16/17; любое отличие = набор поехал = стоп
  expected jsonb := '{"Счет Лицензии":-88956480,"Счет Услуги":-31593229,"Фонд Налоги":8882609,
    "Фонд Обучение":2537887,"Фонд Прибыль":38068332,"Фонд Продвижение":19034165,
    "Фонд Развитие":5075776,"Фонд Резерв":2537887,"Фонд ФОТ Команда":44413053}';
begin
  -- 1. набор: банковский перевод + CSV-расход + CSV-приход, строго 1:1:1
  create temporary table _f on commit drop as
  with cand as (
    select tr.id tr_id, tr.team_id, tr.amount, tr.currency, tr.occurred_on,
           tr.account_id, tr.transfer_account_id, left(coalesce(tr.note,''),40) np
      from transactions tr
     where tr.type='transfer' and tr.account_id is not null and tr.transfer_account_id is not null
       and coalesce(tr.note,'')<>'' and tr.source='tochka' and tr.external_id is not null)
  select c.*,
    (select e.id from transactions e where e.team_id=c.team_id and e.type='expense' and e.account_id=c.account_id
       and e.amount=c.amount and e.currency=c.currency and e.occurred_on=c.occurred_on and e.id<>c.tr_id
       and left(coalesce(e.note,''),40)=c.np limit 1) e_id,
    (select i.id from transactions i where i.team_id=c.team_id and i.type='income' and i.account_id=c.transfer_account_id
       and i.amount=c.amount and i.currency=c.currency and i.occurred_on=c.occurred_on
       and left(coalesce(i.note,''),40)=c.np limit 1) i_id
    from cand c;
  delete from _f where e_id is null or i_id is null;

  create temporary table _rm on commit drop as
    select e_id id, account_id acc, -amount eff from _f
    union all select i_id, transfer_account_id, amount from _f;

  -- 2. guards
  select count(*) into n_cases from _f;
  select count(distinct id), sum(abs(eff)) into n_rm, vol from _rm;
  if n_cases <> 126 or n_rm <> 252 or (select count(*) from _rm) <> 252 or vol <> 241099418 then
    raise exception 'FIN-03: набор не совпал (cases %, rows %, volume %)', n_cases, n_rm, vol;
  end if;
  select count(*) into n_bad from _rm r join transactions t on t.id=r.id left join import_batches b on b.id=t.import_batch_id
   where t.source is not null or t.external_id is not null or t.bank_event_id is not null
      or t.origin <> 'bank_csv' or t.obligation_id is not null or t.status <> 'actual' or t.currency <> 'RUB'
      or coalesce(b.file_name,'') <> 'svodnaya_vypiska_2025.csv';
  if n_bad > 0 then raise exception 'FIN-03: % строк не похожи на CSV-дубль — прервано', n_bad; end if;
  select count(*) into n_bad from _rm r
   where exists (select 1 from obligation_payments x where x.transaction_id=r.id)
      or exists (select 1 from obligations x where x.source_transaction_id=r.id)
      or exists (select 1 from invoices x where x.paid_transaction_id=r.id)
      or exists (select 1 from attachments x where x.transaction_id=r.id)
      or exists (select 1 from transaction_splits x where x.transaction_id=r.id)
      or exists (select 1 from license_deals x where x.income_transaction_id=r.id)
      or exists (select 1 from license_purchases x where x.expense_transaction_id=r.id)
      or exists (select 1 from license_payments x where x.income_transaction_id=r.id)
      or exists (select 1 from transaction_history x where x.transaction_id=r.id);
  if n_bad > 0 then raise exception 'FIN-03: у % строк есть зависимости — прервано', n_bad; end if;

  create temporary table _delta on commit drop as
    select r.acc, a.name, sum(r.eff)::bigint delta from _rm r join accounts a on a.id=r.acc group by r.acc, a.name;
  for r_d in select * from _delta loop
    if (expected ->> r_d.name) is null or (expected ->> r_d.name)::bigint <> r_d.delta then
      raise exception 'FIN-03: поправка по «%» = %, ожидалось %', r_d.name, r_d.delta, expected ->> r_d.name;
    end if;
  end loop;
  if (select count(*) from _delta) <> 9 then raise exception 'FIN-03: затронуто не 9 счетов'; end if;

  -- 3. снимок «до»: остатки всех счетов, cash, выручка I кв. 2025
  create temporary table _bal_before on commit drop as
  select a.id, a.currency,
         a.opening_balance
         + coalesce((select sum(case when t.type='income' then t.amount when t.type='expense' then -t.amount
                                     when t.type='transfer' then -t.amount else 0 end)
                       from transactions t where t.status='actual' and t.account_id=a.id),0)
         + coalesce((select sum(coalesce(t.transfer_amount,t.amount)) from transactions t
                      where t.status='actual' and t.type='transfer' and t.transfer_account_id=a.id),0) bal
    from accounts a;
  select sum(bal) into cash_before from _bal_before where currency='RUB';
  select coalesce(sum(t.amount),0) into rev_before from transactions t left join categories c on c.id=t.category_id
   where t.status='actual' and t.type='income' and t.occurred_on between '2025-01-01' and '2025-03-31'
     and coalesce(c.cf_activity,'operating')='operating' and coalesce(c.pnl_treatment,'auto')<>'excluded';

  -- 4. архив → удаление → снятие компенсации
  insert into fin03_removed_transactions
    select t.*, now(), 'FIN-03 CONFIRMED_DUPLICATE (CSV leg), 0094' from transactions t where t.id in (select id from _rm);
  insert into fin03_opening_balance_before (account_id, account_name, opening_before, delta, opening_after)
    select a.id, a.name, a.opening_balance, d.delta, a.opening_balance + d.delta
      from accounts a join _delta d on d.acc=a.id;

  delete from transactions where id in (select id from _rm);
  get diagnostics n_rm = row_count;
  if n_rm <> 252 then raise exception 'FIN-03: удалено % строк вместо 252', n_rm; end if;

  update accounts a set opening_balance = a.opening_balance + d.delta from _delta d where a.id = d.acc;

  -- 5. проверки «после»: каждый остаток прежний, cash прежний, выручка −120 549 709, детектор 0
  select count(*) into n_bad from _bal_before b join accounts a on a.id=b.id
   where b.bal <> a.opening_balance
         + coalesce((select sum(case when t.type='income' then t.amount when t.type='expense' then -t.amount
                                     when t.type='transfer' then -t.amount else 0 end)
                       from transactions t where t.status='actual' and t.account_id=a.id),0)
         + coalesce((select sum(coalesce(t.transfer_amount,t.amount)) from transactions t
                      where t.status='actual' and t.type='transfer' and t.transfer_account_id=a.id),0);
  if n_bad > 0 then raise exception 'FIN-03: у % счетов изменился остаток — откат', n_bad; end if;

  select coalesce(sum(t.amount),0) into rev_after from transactions t left join categories c on c.id=t.category_id
   where t.status='actual' and t.type='income' and t.occurred_on between '2025-01-01' and '2025-03-31'
     and coalesce(c.cf_activity,'operating')='operating' and coalesce(c.pnl_treatment,'auto')<>'excluded';
  if rev_before - rev_after <> 120549709 then
    raise exception 'FIN-03: выручка I кв. 2025 изменилась на %, ожидалось 120549709', rev_before - rev_after;
  end if;

  select count(*) into fin03_after from transactions tr
   where tr.type='transfer' and tr.account_id is not null and tr.transfer_account_id is not null and coalesce(tr.note,'')<>''
     and exists (select 1 from transactions e where e.team_id=tr.team_id and e.type='expense' and e.account_id=tr.account_id
                  and e.amount=tr.amount and e.currency=tr.currency and e.occurred_on=tr.occurred_on and e.id<>tr.id
                  and left(coalesce(e.note,''),40)=left(coalesce(tr.note,''),40))
     and exists (select 1 from transactions i where i.team_id=tr.team_id and i.type='income' and i.account_id=tr.transfer_account_id
                  and i.amount=tr.amount and i.currency=tr.currency and i.occurred_on=tr.occurred_on
                  and left(coalesce(i.note,''),40)=left(coalesce(tr.note,''),40));
  if fin03_after <> 0 then raise exception 'FIN-03: детектор после чистки = %, ожидался 0', fin03_after; end if;

  raise notice 'FIN-03: удалено 252, счетов 9, остатки и cash без изменений (cash %), выручка I кв. 2025 % -> %',
    cash_before, rev_before, rev_after;

  if current_setting('fin03.rehearsal', true) = 'on' then
    raise exception 'REHEARSAL OK — всё откатывается: rows 252, accounts 9, cash %, revenue % -> %, detector 0',
      cash_before, rev_before, rev_after;
  end if;
end $$;
