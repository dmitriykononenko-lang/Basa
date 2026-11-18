-- ============================================================================
-- dry_run_backfill.sql — DRY-RUN пересчёта операций после FX-cutover.
-- ТОЛЬКО SELECT. Ничего не меняет. Безопасно запускать на production.
--
-- Что делает: для каждой операции с occurred_on >= FX_CUTOVER_DATE и валютой,
-- отличной от базовой, показывает старую рублёвую оценку (по действующей сейчас
-- карте курсов), курс ЦБ, действующий на дату операции, новую base_amount,
-- дельту и затронутые аналитические разрезы.
--
-- ИСТОЧНИК КОТИРОВОК:
--   • если таблица fx_quotes уже создана (миграция 0093) — раскомментируй
--     блок «QUOTES FROM fx_quotes» и закомментируй staging-CTE;
--   • пока её нет — заполни staging-CTE реальными котировками ЦБ
--     (см. scripts/fx/README.md, как их получить).
-- ВНИМАНИЕ: значения в staging-CTE ниже — СЦЕНАРИЙ для проверки механики,
-- а НЕ реальные котировки ЦБ.
-- ============================================================================

\set cutover '2026-08-20'
\set base_ccy 'RUB'
\set legacy_rate 80.0   -- единственный курс, по которому система считает сейчас

with
-- ── источник котировок ──────────────────────────────────────────────────────
quotes(quote_currency, rate_date, rate_per_unit, source) as (
  -- >>> STAGING (заменить реальными котировками USD/RUB ЦБ) <<<
  values
    ('USD', '2026-08-19'::date, 79.50::numeric, 'SCENARIO'),
    ('USD', '2026-08-21'::date, 79.80::numeric, 'SCENARIO'),
    ('USD', '2026-08-25'::date, 80.40::numeric, 'SCENARIO'),
    ('USD', '2026-08-27'::date, 81.10::numeric, 'SCENARIO'),
    ('USD', '2026-09-01'::date, 81.75::numeric, 'SCENARIO'),
    ('USD', '2026-09-04'::date, 82.30::numeric, 'SCENARIO'),
    ('USD', '2026-09-09'::date, 82.05::numeric, 'SCENARIO'),
    ('USD', '2026-09-15'::date, 83.10::numeric, 'SCENARIO'),
    ('USD', '2026-09-18'::date, 83.60::numeric, 'SCENARIO')
  -- >>> QUOTES FROM fx_quotes (после миграции 0093) <<<
  -- select quote_currency, rate_date, rate_per_unit, source
  --   from public.fx_quotes where base_currency = :'base_ccy' and source = 'CBR'
),
-- ── бизнес-правило: какая котировка нужна для валюты операции ───────────────
ccy_map(currency, fx_base_currency, fx_method) as (
  values ('USDT','USD','USDT_USD_1_TO_1_CBR'),
         ('USD','USD','CBR_DIRECT'), ('EUR','EUR','CBR_DIRECT'),
         ('CNY','CNY','CBR_DIRECT'), ('GBP','GBP','CBR_DIRECT'),
         ('KZT','KZT','CBR_DIRECT'), ('UAH','UAH','CBR_DIRECT')
),
ops as (
  select t.id, t.team_id, t.occurred_on, t.type::text as tp, t.status,
         t.amount, t.currency, t.project_id, t.counterparty_id, t.category_id,
         m.fx_base_currency, m.fx_method,
         exists (select 1 from transaction_splits s where s.transaction_id = t.id) as has_splits,
         exists (select 1 from obligation_payments p where p.transaction_id = t.id) as has_alloc
    from transactions t
    join ccy_map m on m.currency = t.currency
   where t.occurred_on >= :'cutover'::date
     and t.currency <> :'base_ccy'
),
priced as (
  select o.*,
         q.rate_per_unit as fx_rate,
         q.rate_date     as fx_rate_date,
         q.source        as fx_source,
         case when q.rate_per_unit is null then 'missing' else 'ok' end as fx_status,
         round(o.amount * :legacy_rate)::bigint            as old_base_amount,
         case when q.rate_per_unit is not null
              then round(o.amount * q.rate_per_unit)::bigint end as new_base_amount
    from ops o
    left join lateral (
      select qq.rate_per_unit, qq.rate_date, qq.source
        from quotes qq
       where qq.quote_currency = o.fx_base_currency
         and qq.rate_date <= o.occurred_on
       order by qq.rate_date desc
       limit 1
    ) q on true
)
-- ── 1. Построчный dry-run ──────────────────────────────────────────────────
select p.id as transaction_id,
       p.occurred_on, p.tp as type, p.status, p.currency,
       p.amount                                   as original_amount_minor,
       :legacy_rate                               as old_rate,
       p.old_base_amount                          as old_base_rub_minor,
       p.fx_method, p.fx_base_currency,
       p.fx_rate, p.fx_rate_date, p.fx_source, p.fx_status,
       p.new_base_amount                          as new_base_rub_minor,
       coalesce(p.new_base_amount, 0) - p.old_base_amount as delta_rub_minor,
       (p.fx_rate_date is distinct from p.occurred_on)    as used_previous_publication,
       pr.name  as project,
       cp.name  as counterparty,
       cat.name as category,
       p.has_splits, p.has_alloc
  from priced p
  left join projects pr       on pr.id  = p.project_id
  left join counterparties cp on cp.id  = p.counterparty_id
  left join categories cat    on cat.id = p.category_id
 order by p.occurred_on, p.id;

-- ── 2. Сводка ──────────────────────────────────────────────────────────────
-- (повторяет CTE: psql не переносит WITH между запросами)
