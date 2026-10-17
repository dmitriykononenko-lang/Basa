-- ============================================================================
-- fx_prototype.sql — ПРОТОТИП FX-слоя для проверки семантики до реализации.
-- Это НЕ миграция: файл живёт в scripts/, к production не применяется и в
-- PR #99 не входит. Цель — доказать на disposable-БД четыре вещи:
--   (1) выбирается официальный курс, ДЕЙСТВОВАВШИЙ на дату операции, а не
--       «ближайшая предыдущая строка нашего загрузчика»;
--   (2) planned получает ESTIMATED-прогноз, который может меняться, а после
--       проведения — immutable snapshot, который больше не меняется;
--   (3) два РАЗНЫХ ограничения для разнесений: по валюте операции и по валюте
--       обязательства;
--   (4) split делит base_amount до копейки.
-- ============================================================================

-- ─── 1. Котировки ───────────────────────────────────────────────────────────
create table if not exists fx_quotes (
  source          text not null default 'CBR',
  base_currency   text not null default 'RUB',
  quote_currency  text not null,
  rate_date       date not null,                      -- дата, на которую ЦБ установил курс
  rate            numeric(18,8) not null check (rate > 0),
  nominal         integer not null default 1 check (nominal > 0),
  rate_per_unit   numeric(18,8) generated always as (rate / nominal) stored,
  fetched_at      timestamptz not null default now(),
  source_url      text,
  raw             jsonb,
  primary key (source, base_currency, quote_currency, rate_date)
);

-- ─── 2. КАЛЕНДАРЬ ДЕЙСТВИЯ — ключевой объект ───────────────────────────────
-- Для КАЖДОЙ календарной даты хранится, какая котировка на неё действовала,
-- по утверждению самого источника (атрибут Date в ответе ЦБ на запрос за эту
-- дату). Это и отличает «официальный курс, действовавший на дату» от
-- «ближайшей предыдущей строки, которая у нас случайно есть».
--   derivation = 'SOURCE_DECLARED' — источник прямо ответил за эту дату;
--   derivation = 'CARRY_FORWARD'   — мы перенесли курс вперёд сами
--                                    (только при бэкофилле через XML_dynamic).
create table if not exists fx_calendar (
  source              text not null default 'CBR',
  base_currency       text not null default 'RUB',
  calendar_date       date not null,
  effective_rate_date date not null,
  derivation          text not null check (derivation in ('SOURCE_DECLARED','CARRY_FORWARD')),
  fetched_at          timestamptz not null default now(),
  source_url          text,
  primary key (source, base_currency, calendar_date)
);

-- ─── 3. Разрешение курса на дату ───────────────────────────────────────────
-- Пробел в загрузке НЕ замазывается: нет строки календаря → нет курса.
create or replace function fx_rate_on(_currency text, _date date, _base text default 'RUB')
returns table (rate_per_unit numeric, rate_date date, source text, derivation text)
language sql stable as $$
  select q.rate_per_unit, q.rate_date, q.source, c.derivation
    from fx_calendar c
    join fx_quotes q
      on q.source = c.source and q.base_currency = c.base_currency
     and q.rate_date = c.effective_rate_date and q.quote_currency = _currency
   where c.source = 'CBR' and c.base_currency = _base and c.calendar_date = _date
$$;

-- ─── 4. Бизнес-правило валюты → RUB ────────────────────────────────────────
create or replace function fx_resolve(_currency text, _date date)
returns table (fx_base_currency text, fx_rate numeric, fx_rate_date date,
               fx_source text, fx_method text, fx_status text)
language plpgsql stable as $$
declare _base text; _method text; r record;
begin
  if _currency = 'RUB' then
    return query select 'RUB', 1::numeric, _date, 'INTERNAL', 'IDENTITY', 'ok';
    return;
  elsif _currency = 'USDT' then
    _base := 'USD'; _method := 'USDT_USD_1_TO_1_CBR';
  elsif _currency in ('USD','EUR','CNY','GBP','KZT','UAH') then
    _base := _currency; _method := 'CBR_DIRECT';
  else
    return query select null::text, null::numeric, null::date, null::text, null::text, 'missing';
    return;
  end if;

  select * into r from fx_rate_on(_base, _date);
  if r.rate_per_unit is null then
    return query select _base, null::numeric, null::date, null::text, _method, 'missing';
  else
    return query select _base, r.rate_per_unit, r.rate_date, r.source, _method, 'ok';
  end if;
end $$;

-- ─── 5. Снимок на операции ─────────────────────────────────────────────────
do $$ begin
  alter table transactions
    add column fx_status        text not null default 'legacy'
      check (fx_status in ('ok','estimated','missing','legacy')),
    add column fx_base_currency text,
    add column fx_rate          numeric(18,8),
    add column fx_rate_date     date,
    add column fx_source        text,
    add column fx_method        text,
    add column base_amount      bigint,
    add column fx_pinned_at     timestamptz,
    add column fx_pinned_by     uuid;
exception when duplicate_column then null; end $$;

-- ok      — зафиксировано на фактической операции, immutable
-- estimated — прогноз для planned: пересчитывается, пока операция не проведена
-- missing — курс определить не удалось; base_amount IS NULL
-- legacy  — до cutover, не трогаем
create or replace function trg_pin_fx() returns trigger language plpgsql as $$
declare r record; _cutover date := coalesce(current_setting('app.fx_cutover_date', true)::date, '2026-08-20');
begin
  if new.occurred_on < _cutover then
    new.fx_status := 'legacy';
    return new;
  end if;

  -- ВАЖНОЕ ПРАВИЛО (поймано тестом FX15 на прототипе).
  -- Уже зафиксированный фактический снимок не пересчитывается сам по себе.
  -- Курс переопределяется ТОЛЬКО если изменилось то, что определяет курс:
  -- валюта или дата операции. Изменение СУММЫ курс не меняет — меняется
  -- только base_amount по уже зафиксированному курсу. Иначе правка суммы
  -- задним числом молча переоценила бы операцию по сегодняшней котировке.
  if tg_op = 'UPDATE' and old.fx_status = 'ok'
     and new.currency = old.currency and new.occurred_on = old.occurred_on then
    new.fx_status        := old.fx_status;
    new.fx_rate          := old.fx_rate;
    new.fx_rate_date     := old.fx_rate_date;
    new.fx_source        := old.fx_source;
    new.fx_method        := old.fx_method;
    new.fx_base_currency := old.fx_base_currency;
    new.fx_pinned_at     := old.fx_pinned_at;
    new.fx_pinned_by     := old.fx_pinned_by;
    new.base_amount      := round(new.amount * old.fx_rate)::bigint;  -- тот же курс
    return new;
  end if;

  select * into r from fx_resolve(new.currency, new.occurred_on);
  new.fx_base_currency := r.fx_base_currency;
  new.fx_rate          := r.fx_rate;
  new.fx_rate_date     := r.fx_rate_date;
  new.fx_source        := r.fx_source;
  new.fx_method        := r.fx_method;
  new.base_amount      := case when r.fx_status = 'ok' then round(new.amount * r.fx_rate)::bigint end;

  -- Плановая операция получает ПРОГНОЗ, а не фиксацию.
  if new.status = 'planned' then
    new.fx_status := case when r.fx_status = 'ok' then 'estimated' else 'missing' end;
    new.fx_pinned_at := null; new.fx_pinned_by := null;
  else
    new.fx_status := r.fx_status;
    if r.fx_status = 'ok' then
      new.fx_pinned_at := now(); new.fx_pinned_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists transactions_fx_pin on transactions;
create trigger transactions_fx_pin
  before insert or update of amount, currency, occurred_on, status on transactions
  for each row execute function trg_pin_fx();

-- Прогноз для planned обновляется отдельной командой (не автоматически при
-- изменении котировок): контролируемо и видно в аудите.
create or replace function fx_refresh_estimates(_team uuid) returns integer
language plpgsql as $$
declare n int;
begin
  with upd as (
    update transactions t set amount = t.amount   -- триггер пересчитает прогноз
     where t.team_id = _team and t.status = 'planned' and t.fx_status in ('estimated','missing')
    returning 1
  ) select count(*) into n from upd;
  return n;
end $$;

-- ─── 6. Аудит контролируемого пересчёта ────────────────────────────────────
create table if not exists fx_repin_audit (
  id          bigserial primary key,
  object_type text not null,          -- transaction | invoice | obligation | obligation_payment
  object_id   uuid not null,
  old_snapshot jsonb not null,
  new_snapshot jsonb not null,
  reason      text not null,
  actor       text not null,
  created_at  timestamptz not null default now()
);

-- ─── 7. FIN-02: два РАЗНЫХ ограничения ─────────────────────────────────────
do $$ begin
  alter table obligation_payments
    add column payment_amount   bigint,
    add column payment_currency text,
    add column fx_rate          numeric(18,8),
    add column fx_rate_date     date,
    add column fx_source        text,
    add column fx_method        text,
    add column fx_status        text not null default 'legacy',
    add column base_amount      bigint;
exception when duplicate_column then null; end $$;

-- (7a) КЭП ПО ОПЕРАЦИИ — в валюте ОПЕРАЦИИ
create or replace function assert_payment_not_over_allocated() returns trigger
language plpgsql as $$
declare _tx uuid; _used bigint; _amount bigint;
begin
  _tx := coalesce(new.transaction_id, old.transaction_id);
  if _tx is null then return null; end if;
  select amount into _amount from transactions where id = _tx;
  if _amount is null then return null; end if;
  select coalesce(sum(payment_amount), 0) into _used
    from obligation_payments where transaction_id = _tx;
  if _used > _amount then
    raise exception 'Разнесено % из операции на % (валюта операции) — превышение', _used, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

-- (7b) КЭП ПО ОБЯЗАТЕЛЬСТВУ — в валюте ОБЯЗАТЕЛЬСТВА (уже есть в 0086,
--      здесь повторён для полноты прототипа)
create or replace function assert_obligation_not_overpaid_proto() returns trigger
language plpgsql as $$
declare _obl uuid; _paid bigint; _amount bigint;
begin
  _obl := coalesce(new.obligation_id, old.obligation_id);
  select amount into _amount from obligations where id = _obl;
  if _amount is null then return null; end if;
  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = _obl;
  if _paid > _amount then
    raise exception 'Обязательство %: разнесено % при сумме % (валюта обязательства)', _obl, _paid, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists op_payment_cap_ck on obligation_payments;
create constraint trigger op_payment_cap_ck
  after insert or update on obligation_payments
  deferrable initially deferred for each row execute function assert_payment_not_over_allocated();

drop trigger if exists op_obligation_cap_ck on obligation_payments;
create constraint trigger op_obligation_cap_ck
  after insert or update on obligation_payments
  deferrable initially deferred for each row execute function assert_obligation_not_overpaid_proto();

-- ─── 8. Разнесение с явной валютной семантикой ─────────────────────────────
create or replace function obligation_allocate_fx(
  _obligation uuid, _transaction uuid, _payment_amount bigint)
returns jsonb language plpgsql as $$
declare _o obligations; _t transactions; rp record; ro record; _cross numeric; _amount bigint; _base bigint;
begin
  select * into _o from obligations where id = _obligation for update;
  select * into _t from transactions where id = _transaction;
  if _o.id is null or _t.id is null then raise exception 'not found'; end if;

  select * into rp from fx_resolve(_t.currency, _t.occurred_on);   -- платёж → RUB
  select * into ro from fx_resolve(_o.currency, _t.occurred_on);   -- обязательство → RUB на дату платежа
  if rp.fx_status <> 'ok' or ro.fx_status <> 'ok' then
    raise exception 'FX_RATE_MISSING: курс на % не определён', _t.occurred_on using errcode = '22023';
  end if;

  _cross  := rp.fx_rate / ro.fx_rate;                     -- валюта платежа → валюта обязательства
  _amount := round(_payment_amount * _cross)::bigint;     -- в валюте ОБЯЗАТЕЛЬСТВА
  _base   := round(_payment_amount * rp.fx_rate)::bigint; -- в RUB

  insert into obligation_payments (obligation_id, transaction_id, amount, paid_on,
                                   payment_amount, payment_currency,
                                   fx_rate, fx_rate_date, fx_source, fx_method, fx_status, base_amount)
  values (_obligation, _transaction, _amount, _t.occurred_on,
          _payment_amount, _t.currency,
          _cross, rp.fx_rate_date, rp.fx_source,
          case when _t.currency = _o.currency then 'IDENTITY' else 'CROSS_VIA_RUB' end,
          'ok', _base);

  return jsonb_build_object('ok', true, 'payment_amount', _payment_amount,
    'payment_currency', _t.currency, 'amount', _amount, 'obligation_currency', _o.currency,
    'fx_rate', _cross, 'base_amount', _base);
end $$;

-- ─── 9. Split: распределение base_amount до копейки ────────────────────────
create or replace view transaction_lines_fx as
with p as (
  select s.id split_id, s.transaction_id, s.amount, t.amount tx_amount, t.base_amount tx_base,
         floor(t.base_amount::numeric * s.amount / nullif(t.amount,0))::bigint lo,
         row_number() over (
           partition by s.transaction_id
           order by (t.base_amount::numeric * s.amount / nullif(t.amount,0))
                  - floor(t.base_amount::numeric * s.amount / nullif(t.amount,0)) desc, s.id
         ) rn
    from transaction_splits s join transactions t on t.id = s.transaction_id
   where t.base_amount is not null
), agg as (
  select transaction_id, sum(lo) lo_sum, max(tx_base) tx_base from p group by 1
)
select t.id transaction_id, s.id split_id, t.team_id, t.type, t.currency, t.status, t.occurred_on,
       coalesce(s.amount, t.amount) amount,
       coalesce(s.project_id, t.project_id) project_id,
       coalesce(s.counterparty_id, t.counterparty_id) counterparty_id,
       coalesce(s.category_id, t.category_id) category_id,
       case
         when t.base_amount is null then null
         when s.id is null then t.base_amount
         else (select p.lo + case when p.rn <= a.tx_base - a.lo_sum then 1 else 0 end
                 from p join agg a using (transaction_id) where p.split_id = s.id)
       end as base_amount,
       t.fx_rate, t.fx_rate_date, t.fx_source, t.fx_method, t.fx_status
  from transactions t
  left join transaction_splits s on s.transaction_id = t.id;
