-- ============================================================================
-- FIN-03 forensics — READ ONLY. Не изменяет ничего. Только SELECT.
-- Задвоенные внутренние переводы: одна строка type='transfer' из импорта Точки
-- + пара expense/income из импорта CSV-сводной выписки = одно событие, две проводки.
-- Отчёт: finance-app/FIN03_FORENSICS.md
-- Запуск: psql "$DATABASE_URL" -f scripts/fin03/forensics.sql
-- ============================================================================

-- Кандидаты и их 1:1:1 соответствие. Признак связи: одинаковые сумма, валюта,
-- дата, счёт-источник/счёт-получатель и первые 40 символов назначения платежа.
create temporary view fin03_cases as
with cand as (
  select tr.id tr_id, tr.team_id, tr.amount, tr.currency, tr.occurred_on,
         tr.account_id, tr.transfer_account_id, left(coalesce(tr.note,''),40) np
  from transactions tr
  where tr.type='transfer' and tr.account_id is not null and tr.transfer_account_id is not null
    and coalesce(tr.note,'')<>'' and tr.source='tochka' and tr.external_id is not null
)
select c.*,
  (select e.id from transactions e
     where e.team_id=c.team_id and e.type='expense' and e.account_id=c.account_id
       and e.amount=c.amount and e.currency=c.currency and e.occurred_on=c.occurred_on
       and e.id<>c.tr_id and left(coalesce(e.note,''),40)=c.np limit 1) e_id,
  (select i.id from transactions i
     where i.team_id=c.team_id and i.type='income' and i.account_id=c.transfer_account_id
       and i.amount=c.amount and i.currency=c.currency and i.occurred_on=c.occurred_on
       and left(coalesce(i.note,''),40)=c.np limit 1) i_id
from cand c
where exists (select 1 from transactions e
     where e.team_id=c.team_id and e.type='expense' and e.account_id=c.account_id
       and e.amount=c.amount and e.currency=c.currency and e.occurred_on=c.occurred_on
       and e.id<>c.tr_id and left(coalesce(e.note,''),40)=c.np)
  and exists (select 1 from transactions i
     where i.team_id=c.team_id and i.type='income' and i.account_id=c.transfer_account_id
       and i.amount=c.amount and i.currency=c.currency and i.occurred_on=c.occurred_on
       and left(coalesce(i.note,''),40)=c.np);

\echo '== 1. ПОЛНАЯ ВЫГРУЗКА ПО КАЖДОМУ СЛУЧАЮ (все запрошенные поля) =========='
-- По три строки на случай: A = банковский transfer, B = CSV-расход, C = CSV-доход.
select q.tr_id as case_id,
       r.role,
       t.id                          as transaction_id,
       t.team_id,
       t.type,
       t.amount,
       t.currency,
       src.name                      as source_account,
       dst.name                      as destination_account,
       t.occurred_on                 as transaction_date,
       t.created_at,
       t.status,
       t.source,
       t.external_id,
       t.import_batch_id,
       b.file_name                   as import_file,
       b.bank                        as import_bank,
       b.created_at                  as import_at,
       t.created_by,
       cat.name                      as article,
       cat.cf_activity, cat.pnl_treatment,
       t.note,
       -- связанные записи (для безопасности удаления)
       (select count(*) from obligation_payments op where op.transaction_id=t.id)      as oblig_payments,
       (select count(*) from obligations o where o.source_transaction_id=t.id)         as obligations_sourced,
       (select count(*) from invoices v where v.paid_transaction_id=t.id)              as invoices_paid_by,
       (select count(*) from attachments a  where a.transaction_id=t.id)               as attachments,
       (select count(*) from transaction_splits s where s.transaction_id=t.id)         as splits,
       (select count(*) from transaction_history h where h.transaction_id=t.id)        as history_rows,
       -- какой механизм приложения создал запись
       case
         when t.source='tochka' and t.external_id is not null then 'tochka-import.ts (склеивает перевод в 1 строку)'
         when t.import_batch_id is not null and t.source is null then 'StatementImportWizard.tsx (перевод = 2 строки, source/external_id не заполняются)'
         when t.import_batch_id is null and t.source is null then 'ручной ввод в интерфейсе'
         else 'прочее: ' || coalesce(t.source,'(null)')
       end as created_by_mechanism
from fin03_cases q
cross join lateral (values (q.tr_id,'A_tochka_transfer'), (q.e_id,'B_csv_expense'), (q.i_id,'C_csv_income')) r(id, role)
join transactions t on t.id = r.id
left join accounts src on src.id = t.account_id
left join accounts dst on dst.id = t.transfer_account_id
left join import_batches b on b.id = t.import_batch_id
left join categories cat on cat.id = t.category_id
order by q.occurred_on, q.tr_id, r.role;

\echo '== 2. EVIDENCE PROFILE: нулевая дисперсия признаков => однородная классификация =='
-- Если во всех строках count = 126, классификация CONFIRMED_DUPLICATE применима ко всем.
select (select count(*) from fin03_cases)                                                     as cases,
       (select count(distinct external_id) from fin03_cases)                                  as distinct_bank_event_ids,
       (select count(distinct e_id) from fin03_cases)                                         as distinct_csv_expenses,
       (select count(distinct i_id) from fin03_cases)                                         as distinct_csv_incomes,
       (select count(*) from (select e_id from fin03_cases group by 1 having count(*)>1) z)    as expense_claimed_twice,
       (select count(*) from (select i_id from fin03_cases group by 1 having count(*)>1) z)    as income_claimed_twice,
       (select count(*) from fin03_cases q join transactions e on e.id=q.e_id
          where e.source is not null or e.external_id is not null)                             as csv_expense_with_source,
       (select count(*) from fin03_cases q join transactions i on i.id=q.i_id
          where i.source is not null or i.external_id is not null)                            as csv_income_with_source,
       (select count(distinct e.import_batch_id) from fin03_cases q join transactions e on e.id=q.e_id) as csv_expense_batches,
       (select count(distinct i.import_batch_id) from fin03_cases q join transactions i on i.id=q.i_id) as csv_income_batches,
       (select count(*) from fin03_cases q join transactions e on e.id=q.e_id join transactions tr on tr.id=q.tr_id
          where e.created_at >= tr.created_at)                                                 as csv_not_before_bank;

\echo '== 3. ЭКОНОМИЧЕСКИЙ ЭФФЕКТ: искажение по счетам (сумма по всем счетам = 0) =='
with legs as (
  select account_id acc, -amount delta, 1 n_exp, 0 n_inc from fin03_cases
  union all
  select transfer_account_id, amount, 0, 1 from fin03_cases
)
select a.name as account, a.currency,
       sum(l.delta) as distortion_minor,
       sum(n_exp) as duplicated_expense_legs,
       sum(n_inc) as duplicated_income_legs,
       a.opening_balance,
       round(abs(a.opening_balance)::numeric / nullif(abs(sum(l.delta)),0), 2) as opening_vs_distortion
from legs l join accounts a on a.id = l.acc
group by a.name, a.currency, a.opening_balance
union all
select '== ИТОГО (общий cash balance) ==', null, sum(delta), null, null, null, null
from legs
order by 3;

\echo '== 4. ВЛИЯНИЕ НА ОТЧЁТЫ: по месяцам и по типу ноги =========================='
select to_char(t.occurred_on,'YYYY-MM') as month, t.type,
       coalesce(cat.name,'(без статьи)') as article,
       coalesce(cat.cf_activity,'operating (по умолчанию)') as cf_activity,
       count(*) as legs, sum(t.amount) as sum_minor,
       case when t.type='income'  and coalesce(cat.cf_activity,'operating')='operating'
              then 'ЗАВЫШАЕТ выручку в ОПиУ'
            when t.type='expense' and coalesce(cat.cf_activity,'operating')<>'operating'
              then 'в ОПиУ не входит (не operating); завышает отток в ДДС'
            else 'проверить' end as report_effect
from (select e_id id from fin03_cases union all select i_id from fin03_cases) u
join transactions t on t.id=u.id
left join categories cat on cat.id=t.category_id
group by 1,2,3,4 order by 2,1;

\echo '== 5. КОНТРОЛЬ: нет ли задвоения обычных (не переводных) операций ==========' 
-- 0 в same_type_same_acct => задвоены только переводы.
with csv as (
  select t.* from transactions t
  where t.import_batch_id in (select distinct e.import_batch_id from fin03_cases q join transactions e on e.id=q.e_id)
)
select c.type, count(*) as csv_rows,
  count(*) filter (where exists (
     select 1 from transactions x where x.team_id=c.team_id and x.source='tochka'
       and x.amount=c.amount and x.currency=c.currency and x.occurred_on=c.occurred_on
       and x.account_id is not distinct from c.account_id and x.type=c.type)) as same_type_same_acct
from csv c group by c.type;
