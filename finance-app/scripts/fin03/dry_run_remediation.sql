-- ============================================================================
-- FIN-03 — DRY RUN remediation. НИ ОДНОГО DML. Только SELECT.
-- Показывает: BEFORE -> предлагаемое изменение -> AFTER + контрольные суммы.
-- Реальные DELETE/UPDATE лежат ниже, ЗАКОММЕНТИРОВАНЫ, и применяются только
-- после отдельного письменного подтверждения владельца данных.
--
-- Предлагаемое решение: удалить CSV-ноги (expense+income из svodnaya_vypiska_2025.csv),
-- оставив банковскую строку type='transfer'. Обратный вариант (удалить банковскую
-- строку) НЕДОПУСТИМ: дедуп Точки работает по (team_id, source, external_id) —
-- удалённая строка вернётся при следующем синке того же периода.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------- 0. набор
create temporary view fin03 as
with cand as (
  select tr.id tr_id, tr.team_id, tr.amount, tr.currency, tr.occurred_on,
         tr.account_id, tr.transfer_account_id, left(coalesce(tr.note,''),40) np
  from transactions tr
  where tr.type='transfer' and tr.account_id is not null and tr.transfer_account_id is not null
    and coalesce(tr.note,'')<>'' and tr.source='tochka' and tr.external_id is not null
)
select c.*,
  (select e.id from transactions e where e.team_id=c.team_id and e.type='expense' and e.account_id=c.account_id
     and e.amount=c.amount and e.currency=c.currency and e.occurred_on=c.occurred_on and e.id<>c.tr_id
     and left(coalesce(e.note,''),40)=c.np limit 1) e_id,
  (select i.id from transactions i where i.team_id=c.team_id and i.type='income' and i.account_id=c.transfer_account_id
     and i.amount=c.amount and i.currency=c.currency and i.occurred_on=c.occurred_on
     and left(coalesce(i.note,''),40)=c.np limit 1) i_id
from cand c
where exists (select 1 from transactions e where e.team_id=c.team_id and e.type='expense' and e.account_id=c.account_id
     and e.amount=c.amount and e.currency=c.currency and e.occurred_on=c.occurred_on and e.id<>c.tr_id
     and left(coalesce(e.note,''),40)=c.np)
  and exists (select 1 from transactions i where i.team_id=c.team_id and i.type='income' and i.account_id=c.transfer_account_id
     and i.amount=c.amount and i.currency=c.currency and i.occurred_on=c.occurred_on
     and left(coalesce(i.note,''),40)=c.np);

-- строки, предлагаемые к удалению (только CSV-ноги)
create temporary view fin03_to_remove as
  select e_id id, 'csv_expense' role from fin03
  union all
  select i_id, 'csv_income' from fin03;

\echo ''
\echo '########## GUARD: остановись, если набор не тот, что в отчёте ##############'
-- Ожидается: cases = 126, rows_to_remove = 252, зависимостей = 0, всё из одного CSV-батча.
select (select count(*) from fin03)                                            as cases,
       (select count(*) from fin03_to_remove)                                  as rows_to_remove,
       (select count(distinct t.import_batch_id) from fin03_to_remove r join transactions t on t.id=r.id) as csv_batches,
       (select count(*) from fin03_to_remove r join transactions t on t.id=r.id
          where t.source is not null or t.external_id is not null)             as must_be_zero_bank_rows,
       (select count(*) from fin03_to_remove r where exists(select 1 from obligation_payments op where op.transaction_id=r.id)
           or exists(select 1 from obligations o where o.source_transaction_id=r.id)
           or exists(select 1 from invoices v where v.paid_transaction_id=r.id)
           or exists(select 1 from attachments a where a.transaction_id=r.id)
           or exists(select 1 from transaction_splits s where s.transaction_id=r.id)) as must_be_zero_dependencies;

\echo ''
\echo '########## 1. BEFORE ######################################################'
create temporary view bal_now as
select a.id, a.name, a.currency, a.opening_balance,
       a.opening_balance
       + coalesce((select sum(case when t.type='income' then t.amount
                                   when t.type='expense' then -t.amount
                                   when t.type='transfer' then -t.amount else 0 end)
                   from transactions t where t.status='actual' and t.account_id=a.id),0)
       + coalesce((select sum(coalesce(t.transfer_amount,t.amount)) from transactions t
                   where t.status='actual' and t.type='transfer' and t.transfer_account_id=a.id),0) as balance
from accounts a;

select name as account, currency, opening_balance, balance as balance_before
from bal_now
where id in (select account_id from fin03 union select transfer_account_id from fin03)
order by name;

select 'ИТОГО cash (RUB), BEFORE' as metric, sum(balance) as value from bal_now where currency='RUB'
union all
select 'Операций всего, BEFORE', count(*) from transactions
union all
select 'Выручка ОПиУ янв-мар 2025 (operating), BEFORE',
       coalesce(sum(t.amount),0) from transactions t left join categories c on c.id=t.category_id
 where t.status='actual' and t.type='income' and t.occurred_on between '2025-01-01' and '2025-03-31'
   and coalesce(c.cf_activity,'operating')='operating' and coalesce(c.pnl_treatment,'auto')<>'excluded';

\echo ''
\echo '########## 2. PROPOSED CHANGE #############################################'
\echo '-- 2a. строки к удалению (252): по одной строке на запись'
select r.role, t.id, t.occurred_on, t.type, t.amount, t.currency,
       a.name as account, coalesce(c.name,'(без статьи)') as article, left(coalesce(t.note,''),60) as note
from fin03_to_remove r join transactions t on t.id=r.id
left join accounts a on a.id=t.account_id left join categories c on c.id=t.category_id
order by t.occurred_on, r.role;

\echo '-- 2b. предлагаемая корректировка opening_balance (чтобы видимые остатки не поехали)'
-- Отрицательные opening_balance «Фондов» ~= минус искажение: они компенсируют дубли.
-- Если снять дубли, компенсацию надо снять тем же движением. Ниже — ровно та поправка,
-- при которой остаток счёта останется прежним; она НЕ является бухгалтерской истиной
-- и требует отдельной сверки с банком по состоянию на 2025-01-01.
with legs as (
  select account_id acc, -amount d from fin03 union all select transfer_account_id, amount from fin03
), dist as (select acc, sum(d) distortion from legs group by acc)
select b.name as account, b.opening_balance as opening_before,
       d.distortion, (b.opening_balance + d.distortion) as opening_after_proposed,
       b.balance as balance_before, b.balance as balance_after_if_compensated
from bal_now b join dist d on d.acc=b.id order by b.name;

\echo ''
\echo '########## 3. AFTER (смоделировано, ничего не изменено) ###################'
create temporary view bal_after as
select a.id, a.name, a.currency,
       a.opening_balance
       + coalesce((select sum(case when t.type='income' then t.amount
                                   when t.type='expense' then -t.amount
                                   when t.type='transfer' then -t.amount else 0 end)
                   from transactions t where t.status='actual' and t.account_id=a.id
                     and t.id not in (select id from fin03_to_remove)),0)
       + coalesce((select sum(coalesce(t.transfer_amount,t.amount)) from transactions t
                   where t.status='actual' and t.type='transfer' and t.transfer_account_id=a.id
                     and t.id not in (select id from fin03_to_remove)),0) as balance
from accounts a;

select n.name as account, n.currency, n.balance as before,
       af.balance as after_without_opening_fix,
       (af.balance - n.balance) as delta_if_opening_untouched,
       n.balance as after_with_opening_fix
from bal_now n join bal_after af on af.id=n.id
where n.id in (select account_id from fin03 union select transfer_account_id from fin03)
order by n.name;

\echo ''
\echo '########## 4. КОНТРОЛЬНЫЕ СУММЫ ##########################################'
select 'Удаляется строк' as check, (select count(*) from fin03_to_remove)::text as value,
       'ожидается 252' as expected
union all
select 'Объём удаляемых проводок (minor)', (select sum(t.amount)::text from fin03_to_remove r join transactions t on t.id=r.id),
       'ожидается 241 099 418 = 2 x 120 549 709 (проверено)'
union all
select 'ИТОГО cash RUB, BEFORE', (select sum(balance)::text from bal_now where currency='RUB'), '—'
union all
select 'ИТОГО cash RUB, AFTER без правки opening', (select sum(balance)::text from bal_after where currency='RUB'),
       'меняется на 0: искажения по счетам взаимно гасятся'
union all
select 'ИТОГО cash RUB, AFTER с правкой opening', (select sum(n.balance)::text from bal_now n where n.currency='RUB'),
       'не меняется'
union all
select 'Выручка ОПиУ янв-мар 2025, AFTER',
       (select coalesce(sum(t.amount),0)::text from transactions t left join categories c on c.id=t.category_id
         where t.status='actual' and t.type='income' and t.occurred_on between '2025-01-01' and '2025-03-31'
           and coalesce(c.cf_activity,'operating')='operating' and coalesce(c.pnl_treatment,'auto')<>'excluded'
           and t.id not in (select id from fin03_to_remove)),
       'проверено: 175 193 002 -> 54 643 293, т.е. -120 549 709'
union all
select 'Детектор FIN-03, AFTER', '0', 'db_integrity_audit.sql: double-counted transfers = 0';

-- ============================================================================
-- 5. РЕАЛЬНОЕ ИСПРАВЛЕНИЕ — ЗАКОММЕНТИРОВАНО. Применять только после:
--    (а) письменного подтверждения владельца данных по списку из блока 2a;
--    (б) свежего бэкапа/PITR-точки Supabase;
--    (в) решения по opening_balance (блок 2b) — сверка с банком на 2025-01-01.
--    Порядок внутри одной транзакции обязателен: архив -> удаление -> opening.
-- ============================================================================
-- begin;
--
-- -- 5.1 архив (страховка и основа rollback). Полная копия строк.
-- create table if not exists fin03_removed_transactions as
--   select t.*, now() as archived_at, 'FIN-03 CONFIRMED_DUPLICATE' as reason
--     from transactions t where false;
-- insert into fin03_removed_transactions
--   select t.*, now(), 'FIN-03 CONFIRMED_DUPLICATE'
--     from transactions t where t.id in (select id from fin03_to_remove);
--
-- -- 5.2 guard: ровно 252 строки, ни одной банковской, ни одной зависимости
-- do $$
-- declare n int; bad int;
-- begin
--   select count(*) into n from fin03_removed_transactions where archived_at > now() - interval '1 minute';
--   if n <> 252 then raise exception 'FIN-03: ожидалось 252 строки, получено %', n; end if;
--   select count(*) into bad from fin03_removed_transactions
--     where archived_at > now() - interval '1 minute' and (source is not null or external_id is not null);
--   if bad > 0 then raise exception 'FIN-03: в наборе % банковских строк — прервано', bad; end if;
-- end $$;
--
-- -- 5.3 удаление CSV-ног
-- delete from transactions where id in (select id from fin03_to_remove);
--
-- -- 5.4 снятие компенсации в opening_balance (значения из блока 2b)
-- --     ВНИМАНИЕ: применять только если владелец подтвердил, что отрицательные
-- --     opening_balance «Фондов» были плагом под FIN-03, а не реальным сальдо.
-- -- update accounts a set opening_balance = a.opening_balance + d.distortion
-- --   from (…значения из блока 2b…) d(acc, distortion) where a.id = d.acc;
--
-- -- 5.5 проверка перед фиксацией: детектор должен дать 0
-- --     (запустить scripts/db_integrity_audit.sql в этой же транзакции)
--
-- rollback;  -- заменить на commit ТОЛЬКО после проверки всех сумм выше
-- ============================================================================
