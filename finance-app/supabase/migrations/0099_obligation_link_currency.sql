-- ============================================================
-- 0099_obligation_link_currency — BASA:Q-09
--
-- ЧТО. obligation_payments.amount — всегда сумма в валюте НАЧИСЛЕНИЯ (так её уже
-- читают obligation_balances, карточка сотрудника, /debts и кэп 0086). Сколько ушло
-- из операции — в новых колонках в валюте ОПЕРАЦИИ:
--   payment_amount (>0), payment_currency (= transactions.currency),
--   fx_rate (единиц валюты начисления за 1 единицу валюты операции; IDENTITY = 1),
--   fx_rate_date, fx_method in ('IDENTITY','CBR','MANUAL','LEGACY').
-- Для строк без операции (transaction_id null) все пять колонок null.
--
-- ЗАЧЕМ. Решения владельца 22.10 (Д1–Д4, q09_decisions_for_owner.md, контракт q09_contract.md):
--   Д1 amount — в валюте начисления + сумма/курс в валюте операции;
--   Д2 курс ЦБ на дату операции подставляет UI как подсказку; RPC принимает обе суммы,
--      fx_rates не читается и не меняется;
--   Д3 строгие проверки: команда, контрагент (с учётом частей), тип, статус actual,
--      не перевод; привязанную операцию нельзя сделать плановой/переводом, сменить
--      валюту или уменьшить ниже привязанного;
--   Д4 существующие amount не меняются; 34 кросс-валютные строки — fx_method LEGACY,
--      payment_amount = round(amount / курс, реально применённый при привязке):
--      80 — для привязок по курсу 80 (включая урезанные Белая/Жилинс Хом),
--      курс ЦБ на дату выплаты — для 6 операций, пересчитанных партией 25 (basa_sync_log).
--
-- СОСТАВ.
--   0. Guard: текущие привязки не нарушают правил Д3 (иначе миграция падает, данные не чинит).
--   1. Колонки и CHECK-и (без default — мгновенно, старый код их не замечает).
--   2. Заполнение: IDENTITY (та же валюта) и LEGACY (по явному списку 19 операций с
--      ожидаемыми суммами). amount не меняется; сверка count/Σamount до и после.
--   3. BEFORE-триггер obligation_payments_fill_fx: для ЛЮБОГО пути записи проверяет команду,
--      тип, статус и контрагента операции (с частями; кроме собственной привязки settle) и
--      заполняет IDENTITY; разные валюты — только из obligation_link.
--   4. Инварианты операции (assert_tx_allocation): Σ payment_amount ≤ t.amount; по каждому
--      контрагенту Σ ≤ его доля в операции (части); валюта, команда, статус, тип. Проверяются
--      отложенными constraint-триггерами на obligation_payments, transactions (amount, currency,
--      type, status, team_id, counterparty_id) и transaction_splits, с блокировкой строки операции.
--   4b. Инварианты начисления: при привязках к операциям нельзя менять currency/type/team_id;
--      смена counterparty_id допустима только если все привязанные операции остаются согласованы
--      (так работает merge_counterparties); amount не ниже Σ привязок. Кэп 0086 блокирует строку
--      начисления (FOR NO KEY UPDATE).
--   5. settle_obligation_on_tx (0079) и obligation_pay — при разных валютах понятная ошибка.
--   6. RPC obligation_link (контракт q09_contract.md, правка после ревью: p_fx_rate);
--      obligation_allocate — тонкая обёртка.
--   7. op_begin: повтор ключа возвращает результат только той же команде и тому же пользователю.
--   8. Политика obligation_payments_insert — плюс проверка команды операции.
--   9. Гранты и самопроверка.
-- Прямой insert в obligation_payments остаётся (старый фронт до деплоя) — закрывается в 0100.
--
-- КАК ПРОВЕРИТЬ.
--   select count(*) from obligation_payments where transaction_id is not null and fx_method is null; -- 0
--   select fx_method, count(*), sum(amount), sum(payment_amount) from obligation_payments group by 1;
--     -- IDENTITY 72, LEGACY 34 (на 22.10); Σ amount = как до миграции
--   has_function_privilege('anon', 'public.obligation_link(uuid,uuid,bigint,bigint,text,date,uuid,numeric)', 'execute') = false
--   psql -f scripts/db_integrity_audit.sql — 0 FAIL (новые проверки Q-09).
--
-- КАК ОТКАТИТЬ. Сначала откатить код приложения (новый фронт зовёт obligation_link и читает
-- payment_amount), затем rollback/0099_down.sql: тела функций/политики/триггера — из production
-- до 0099; колонки сохраняются в архив obligation_payments_fx_0099_archive и удаляются;
-- amount не трогается ни миграцией, ни откатом.
-- ============================================================

-- ─── 0. Guard: привязки соответствуют правилам Д3 ───────────────────────────
do $$
declare _n int;
begin
  select count(*) into _n
    from obligation_payments p
    join obligations o on o.id = p.obligation_id
    join transactions t on t.id = p.transaction_id
   where t.team_id <> o.team_id
      or t.status <> 'actual'
      or t.type = 'transfer'
      or not ((o.type = 'payable' and t.type = 'expense') or (o.type = 'receivable' and t.type = 'income'));
  if _n > 0 then
    raise exception '0099 guard: % привязок к операциям другой команды / плановым / переводам / не того типа — разберите до миграции', _n;
  end if;
end $$;

-- ─── 1. Колонки ─────────────────────────────────────────────────────────────
alter table public.obligation_payments
  add column if not exists payment_amount   bigint,
  add column if not exists payment_currency varchar(8),
  add column if not exists fx_rate          numeric(20,10),
  add column if not exists fx_rate_date     date,
  add column if not exists fx_method        text;

comment on column public.obligation_payments.amount is
  'Сумма погашения в валюте НАЧИСЛЕНИЯ (obligations.currency), минорные единицы';
comment on column public.obligation_payments.payment_amount is
  'Сколько ушло из операции, в валюте ОПЕРАЦИИ (transactions.currency), минорные единицы; null без операции';
comment on column public.obligation_payments.fx_rate is
  'Единиц валюты начисления за 1 единицу валюты операции (amount / payment_amount); IDENTITY = 1; LEGACY — курс, применённый при исторической привязке';
comment on column public.obligation_payments.fx_method is
  'IDENTITY — одна валюта; CBR — курс ЦБ из подсказки; MANUAL — суммы введены/поправлены вручную; LEGACY — история до 0099';

do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_payment_amount_ck
    check (payment_amount is null or payment_amount > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_fx_rate_ck
    check (fx_rate is null or fx_rate > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_fx_method_ck
    check (fx_method is null or fx_method in ('IDENTITY','CBR','MANUAL','LEGACY'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_identity_ck
    check (fx_method is distinct from 'IDENTITY' or (payment_amount = amount and fx_rate = 1));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_payment_currency_fkey
    foreign key (payment_currency) references public.currencies(code);
exception when duplicate_object then null; end $$;

-- ─── 2. Заполнение (до создания триггеров; amount не меняется) ──────────────
-- Кэп 0086 (отложенный) проверяем сразу после каждого UPDATE: иначе его отложенные события
-- остаются в очереди и следующий ALTER TABLE падает «pending trigger events» (55006).
set constraints public.obligation_payments_cap_ck immediate;
do $$
declare
  _cnt0 bigint; _sum0 numeric; _cnt1 bigint; _sum1 numeric; _n int; _pending int;
  -- 19 кросс-валютных операций: курс, реально применённый при привязке, дата курса
  -- (null — курс 80 из fx_rates, дата неизвестна), ожидаемые число строк и Σ amount (₽, коп.)
  _map constant jsonb := '[
    {"tx":"152b388a-e726-48d3-929e-cddcae2fb635","rate":80,"rate_date":null,"n":2,"rub":1200000},
    {"tx":"62616bd8-f0ba-4d2b-a1af-09040593a82d","rate":80,"rate_date":null,"n":1,"rub":10000000},
    {"tx":"cdc94149-400b-404c-bff5-16ef2edd7140","rate":80,"rate_date":null,"n":1,"rub":2560000},
    {"tx":"dce31397-aee3-4bf5-a878-a5b00d88e113","rate":80,"rate_date":null,"n":3,"rub":2000000},
    {"tx":"d3ccbe2e-3490-444f-acd7-5f83cfff36d6","rate":80,"rate_date":null,"n":2,"rub":800000},
    {"tx":"a62390e5-f93f-4457-9f46-b55a103ca01a","rate":80,"rate_date":null,"n":1,"rub":800000},
    {"tx":"f625b115-6d31-4688-8c31-7626958fce86","rate":80,"rate_date":null,"n":3,"rub":4000000},
    {"tx":"fcf1e664-f9b5-42eb-a5e6-92e3cb7ea5a6","rate":80,"rate_date":null,"n":1,"rub":1600000},
    {"tx":"9530b123-14cd-407b-a7a6-5bb9aa208362","rate":80,"rate_date":null,"n":1,"rub":1200000},
    {"tx":"dad37f8a-90b5-4bb4-a71c-67d80f71c602","rate":80,"rate_date":null,"n":2,"rub":1200000},
    {"tx":"ba097076-f759-4290-ab7f-318a17807f82","rate":80,"rate_date":null,"n":1,"rub":800000},
    {"tx":"1e26e319-9c2f-4bb3-a989-c0e0670bd874","rate":80,"rate_date":null,"n":1,"rub":800000},
    {"tx":"c8ba98a1-a0cd-437d-aea7-549925f55263","rate":80,"rate_date":null,"n":1,"rub":300000},
    {"tx":"aaadbdeb-af34-49f4-a1de-4f60b94056ac","rate":79.4637,"rate_date":"2026-08-03","n":3,"rub":3973185},
    {"tx":"f4bb2c8e-34d5-47bb-a820-242224eaac1d","rate":82.606,"rate_date":"2026-08-11","n":2,"rub":826060},
    {"tx":"57edd8b6-285b-4d99-ab2c-fa657cd6434c","rate":85.1645,"rate_date":"2026-08-19","n":3,"rub":2554935},
    {"tx":"6984b503-86be-423c-a683-dd4e8f486b63","rate":82.9211,"rate_date":"2026-08-25","n":3,"rub":1243817},
    {"tx":"1ba26cda-147f-4ae9-8849-986b053c5d1f","rate":84.1975,"rate_date":"2026-09-21","n":1,"rub":2946913},
    {"tx":"b7457804-2622-474d-af32-29bb80bc81cb","rate":84.0954,"rate_date":"2026-09-22","n":2,"rub":1681908}
  ]'::jsonb;
begin
  select count(*), coalesce(sum(amount), 0) into _cnt0, _sum0 from obligation_payments;

  -- 2.1 та же валюта → IDENTITY
  update obligation_payments p
     set payment_amount = p.amount, payment_currency = t.currency,
         fx_rate = 1, fx_rate_date = t.occurred_on, fx_method = 'IDENTITY'
    from obligations o, transactions t
   where o.id = p.obligation_id and t.id = p.transaction_id
     and t.currency = o.currency and p.fx_method is null;

  -- 2.2 разные валюты → LEGACY по явному списку
  select count(*) into _pending
    from obligation_payments p join obligations o on o.id = p.obligation_id
    join transactions t on t.id = p.transaction_id
   where t.currency <> o.currency and p.fx_method is null;

  if _pending > 0 then
    if _pending <> 34 then
      raise exception '0099 guard: кросс-валютных привязок без fx_method % (ожидалось 34) — список устарел', _pending;
    end if;
    -- каждая такая привязка — к операции из списка
    select count(*) into _n
      from obligation_payments p join obligations o on o.id = p.obligation_id
      join transactions t on t.id = p.transaction_id
     where t.currency <> o.currency
       and not exists (select 1 from jsonb_to_recordset(_map) m(tx uuid) where m.tx = t.id);
    if _n > 0 then raise exception '0099 guard: % кросс-валютных привязок к операциям вне списка', _n; end if;
    -- по каждой операции из списка — ожидаемое число строк и Σ amount
    select count(*) into _n
      from jsonb_to_recordset(_map) m(tx uuid, n int, rub bigint)
     where (select count(*) from obligation_payments p where p.transaction_id = m.tx) <> m.n
        or (select coalesce(sum(p.amount), 0) from obligation_payments p where p.transaction_id = m.tx) <> m.rub;
    if _n > 0 then raise exception '0099 guard: у % операций из списка изменились привязки', _n; end if;

    -- payment_amount = round(amount / rate); если по операции Σ переваливает t.amount —
    -- хвост снимается с последней строки (по created_at, id)
    with r as (
      select p.id, t.id as tx, t.amount as tx_amount, m.rate, m.rate_date,
             round(p.amount / m.rate)::bigint as pa0,
             row_number() over (partition by t.id order by p.created_at desc, p.id desc) as rn_desc
        from obligation_payments p
        join obligations o on o.id = p.obligation_id
        join transactions t on t.id = p.transaction_id
        join jsonb_to_recordset(_map) m(tx uuid, rate numeric, rate_date date) on m.tx = t.id
       where t.currency <> o.currency and p.fx_method is null
    ), s as (
      select r.*, sum(pa0) over (partition by tx) as s0 from r
    ), f as (
      select s.id, s.rate, s.rate_date,
             case when rn_desc = 1 then pa0 - greatest(s0 - tx_amount, 0) else pa0 end as pa
        from s
    )
    update obligation_payments p
       set payment_amount = f.pa, payment_currency = t.currency,
           fx_rate = f.rate, fx_rate_date = f.rate_date, fx_method = 'LEGACY'
      from f, transactions t
     where p.id = f.id and t.id = p.transaction_id and p.fx_method is null;
    get diagnostics _n = row_count;
    if _n <> 34 then raise exception '0099 guard: LEGACY заполнено % строк, ожидалось 34', _n; end if;
  end if;

  -- 2.3 итоговые проверки
  select count(*) into _n from obligation_payments where transaction_id is not null and fx_method is null;
  if _n > 0 then raise exception '0099 guard: % привязок к операциям остались без fx_method', _n; end if;
  select count(*) into _n from obligation_payments where transaction_id is null and payment_amount is not null;
  if _n > 0 then raise exception '0099 guard: % привязок без операции с payment_amount', _n; end if;
  select count(*) into _n from obligation_payments p join transactions t on t.id = p.transaction_id
   where p.payment_currency is distinct from t.currency or p.payment_amount is null or p.payment_amount <= 0;
  if _n > 0 then raise exception '0099 guard: % привязок с неверной payment_currency/payment_amount', _n; end if;
  select count(*) into _n from (
    select t.id from obligation_payments p join transactions t on t.id = p.transaction_id
     group by t.id, t.amount having sum(p.payment_amount) > t.amount) x;
  if _n > 0 then raise exception '0099 guard: у % операций Σ payment_amount больше суммы операции', _n; end if;
  -- доля контрагента: Σ payment_amount привязок к начислениям контрагента X ≤ доля X в операции (с частями)
  select count(*) into _n from (
    select p.transaction_id, o.counterparty_id, sum(p.payment_amount) s
      from obligation_payments p join obligations o on o.id = p.obligation_id
      join transactions t on t.id = p.transaction_id
     where t.obligation_id is distinct from p.obligation_id
     group by 1, 2) x
   where x.s > (select case when exists (select 1 from transaction_splits s where s.transaction_id = t.id)
                            then (select coalesce(sum(s.amount), 0) from transaction_splits s
                                   where s.transaction_id = t.id and coalesce(s.counterparty_id, t.counterparty_id) = x.counterparty_id)
                            when t.counterparty_id = x.counterparty_id then t.amount else 0 end
                  from transactions t where t.id = x.transaction_id);
  if _n > 0 then raise exception '0099 guard: у % пар (операция, контрагент) привязано больше доли контрагента', _n; end if;

  select count(*), coalesce(sum(amount), 0) into _cnt1, _sum1 from obligation_payments;
  if _cnt1 <> _cnt0 or _sum1 <> _sum0 then
    raise exception '0099 guard: obligation_payments изменились (count % → %, Σamount % → %)', _cnt0, _cnt1, _sum0, _sum1;
  end if;
end $$;
set constraints public.obligation_payments_cap_ck deferred;

-- после заполнения: у строки с операцией все поля заполнены, без операции — пусты
do $$ begin
  alter table public.obligation_payments add constraint obligation_payments_fx_filled_ck
    check (
      (transaction_id is null and payment_amount is null and payment_currency is null
         and fx_rate is null and fx_method is null)
      or
      (transaction_id is not null and payment_amount is not null and payment_currency is not null
         and fx_rate is not null and fx_method is not null));
exception when duplicate_object then null; end $$;

-- ─── 3. Доля контрагента в операции (с учётом частей) ───────────────────────
-- Части есть — сумма частей контрагента _cp (контрагент части по умолчанию = контрагент
-- операции, как в transaction_lines); частей нет — вся сумма, если контрагент операции = _cp.
create or replace function public.tx_counterparty_share(_tx uuid, _cp uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare _t record; _share bigint;
begin
  select id, amount, counterparty_id into _t from transactions where id = _tx;
  if not found or _cp is null then return 0; end if;
  if exists (select 1 from transaction_splits where transaction_id = _tx) then
    select coalesce(sum(s.amount), 0) into _share from transaction_splits s
     where s.transaction_id = _tx and coalesce(s.counterparty_id, _t.counterparty_id) = _cp;
    return _share;
  end if;
  return case when _t.counterparty_id = _cp then _t.amount else 0 end;
end $$;

-- ─── 3b. BEFORE-триггер: проверка операции и заполнение валюты для всех путей ─
create or replace function public.obligation_payments_fill_fx()
returns trigger language plpgsql security definer set search_path = public as $$
declare _t record; _o record;
begin
  if new.transaction_id is null then
    -- погашение без операции (или операция удалена: FK on delete set null)
    new.payment_amount := null; new.payment_currency := null; new.fx_rate := null;
    new.fx_rate_date := null; new.fx_method := null;
    return new;
  end if;

  -- UPDATE без изменения сути привязки (paid_on, повтор той же суммы из settle) не перепроверяется
  if tg_op = 'UPDATE'
     and new.transaction_id   is not distinct from old.transaction_id
     and new.obligation_id    is not distinct from old.obligation_id
     and new.amount           is not distinct from old.amount
     and new.payment_amount   is not distinct from old.payment_amount
     and new.payment_currency is not distinct from old.payment_currency
     and new.fx_rate          is not distinct from old.fx_rate
     and new.fx_rate_date     is not distinct from old.fx_rate_date
     and new.fx_method        is not distinct from old.fx_method then
    return new;
  end if;

  select team_id, type, status, currency, occurred_on, obligation_id into _t from transactions where id = new.transaction_id;
  if not found then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  select team_id, type, currency, counterparty_id into _o from obligations where id = new.obligation_id;
  if not found then raise exception 'Начисление не найдено' using errcode = '42704'; end if;

  if _t.team_id <> _o.team_id then
    raise exception 'Операция не найдена' using errcode = '42704';   -- чужая команда = «не найдено»
  end if;
  if _t.status <> 'actual' then
    raise exception 'Плановую операцию привязать к начислению нельзя — сначала проведите её' using errcode = '22023';
  end if;
  if _t.type = 'transfer' then
    raise exception 'Перевод между своими счетами нельзя привязать к начислению' using errcode = '22023';
  end if;
  if not ((_o.type = 'payable' and _t.type = 'expense') or (_o.type = 'receivable' and _t.type = 'income')) then
    raise exception 'Начисление к выплате закрывается расходом, к получению — приходом' using errcode = '22023';
  end if;
  -- контрагент: кроме собственной привязки settle (операция создана под это начисление)
  if _t.obligation_id is distinct from new.obligation_id
     and public.tx_counterparty_share(new.transaction_id, _o.counterparty_id) <= 0 then
    raise exception 'Операция другого контрагента — привязать её к этому начислению нельзя' using errcode = '22023';
  end if;

  if _t.currency = _o.currency then
    new.payment_amount := new.amount; new.payment_currency := _t.currency;
    new.fx_rate := 1; new.fx_rate_date := _t.occurred_on; new.fx_method := 'IDENTITY';
    return new;
  end if;

  -- разные валюты: только из obligation_link (метка транзакции ставится внутри RPC)
  if coalesce(current_setting('basa.obligation_link', true), '')
       <> new.transaction_id::text || ':' || new.obligation_id::text then
    raise exception 'Операция в %, начисление в %: привязка между валютами — только через «Привязать оплату» с суммами в обеих валютах',
      _t.currency, _o.currency using errcode = '22023';
  end if;
  if coalesce(new.fx_method, '') not in ('CBR','MANUAL') or new.payment_amount is null or new.payment_amount <= 0 then
    raise exception 'Привязка между валютами: нужны сумма в валюте операции и способ курса (CBR/MANUAL)' using errcode = '22023';
  end if;
  new.payment_currency := _t.currency;
  if new.fx_method = 'MANUAL' or new.fx_rate is null then
    new.fx_rate := round(new.amount::numeric / new.payment_amount, 10);
  end if;
  if new.fx_rate < 0.000001 or new.fx_rate > 1000000 then
    raise exception 'Курс % вне допустимого диапазона (0,000001 … 1 000 000) — проверьте суммы', new.fx_rate using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists obligation_payments_fill_fx on public.obligation_payments;
create trigger obligation_payments_fill_fx before insert or update on public.obligation_payments
  for each row execute function public.obligation_payments_fill_fx();

-- ─── 4. Инварианты операции (отложенно, с блокировкой строки операции) ──────
-- FOR NO KEY UPDATE сериализует параллельные привязки к одной операции (второй коммит
-- ждёт первый и видит его строку) и не конфликтует с KEY SHARE от внешних ключей.
create or replace function public.assert_tx_allocation(_tx uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _t record; _sum bigint; _bad int; _r record;
begin
  if _tx is null then return; end if;
  select id, team_id, type, status, currency, amount, obligation_id into _t
    from transactions where id = _tx for no key update;
  if not found then return; end if;                       -- операция удалена в этой же транзакции
  if not exists (select 1 from obligation_payments where transaction_id = _tx) then return; end if;

  if _t.status <> 'actual' then
    raise exception 'Операция привязана к начислению — сделать её плановой нельзя, сначала отвяжите' using errcode = '23514';
  end if;
  if _t.type = 'transfer' then
    raise exception 'Операция привязана к начислению — сделать её переводом нельзя, сначала отвяжите' using errcode = '23514';
  end if;
  select count(*) into _bad from obligation_payments p join obligations o on o.id = p.obligation_id
   where p.transaction_id = _tx and o.team_id <> _t.team_id;
  if _bad > 0 then
    raise exception 'Операция привязана к начислению другой команды — сначала отвяжите' using errcode = '23514';
  end if;
  select count(*) into _bad from obligation_payments p join obligations o on o.id = p.obligation_id
   where p.transaction_id = _tx
     and not ((o.type = 'payable' and _t.type = 'expense') or (o.type = 'receivable' and _t.type = 'income'));
  if _bad > 0 then
    raise exception 'Тип операции не соответствует привязанным начислениям — сначала отвяжите' using errcode = '23514';
  end if;
  select count(*) into _bad from obligation_payments where transaction_id = _tx and payment_currency is distinct from _t.currency;
  if _bad > 0 then
    raise exception 'Операция привязана к начислению — сменить её валюту нельзя, сначала отвяжите' using errcode = '23514';
  end if;
  select coalesce(sum(payment_amount), 0) into _sum from obligation_payments where transaction_id = _tx;
  if _sum > _t.amount then
    raise exception 'К начислениям привязано % %, а сумма операции % % — уменьшить нельзя, сначала отвяжите лишнее',
      to_char(_sum / 100.0, 'FM999999999990.00'), _t.currency,
      to_char(_t.amount / 100.0, 'FM999999999990.00'), _t.currency using errcode = '23514';
  end if;
  -- по каждому контрагенту начислений: Σ ≤ его доля в операции (собственная привязка settle —
  -- к начислению из transactions.obligation_id — не проверяется, её контрагент задаёт операция)
  for _r in
    select o.counterparty_id cp, sum(p.payment_amount) s
      from obligation_payments p join obligations o on o.id = p.obligation_id
     where p.transaction_id = _tx and p.obligation_id is distinct from _t.obligation_id
     group by o.counterparty_id
  loop
    if _r.s > public.tx_counterparty_share(_tx, _r.cp) then
      raise exception 'К начислениям контрагента привязано % %, а его доля в операции % % — сначала отвяжите',
        to_char(_r.s / 100.0, 'FM999999999990.00'), _t.currency,
        to_char(public.tx_counterparty_share(_tx, _r.cp) / 100.0, 'FM999999999990.00'), _t.currency
        using errcode = '23514';
    end if;
  end loop;
end $$;

create or replace function public.obligation_payments_tx_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.transaction_id is distinct from new.transaction_id then
    perform public.assert_tx_allocation(old.transaction_id);
  end if;
  perform public.assert_tx_allocation(new.transaction_id);
  return null;
end $$;

create or replace function public.transactions_alloc_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_tx_allocation(new.id);
  return null;
end $$;

create or replace function public.transaction_splits_alloc_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.assert_tx_allocation(old.transaction_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op = 'INSERT' or new.transaction_id is distinct from old.transaction_id) then
    perform public.assert_tx_allocation(new.transaction_id);
  end if;
  return null;
end $$;

drop trigger if exists obligation_payments_tx_cap_ck on public.obligation_payments;
create constraint trigger obligation_payments_tx_cap_ck
  after insert or update on public.obligation_payments
  deferrable initially deferred
  for each row execute function public.obligation_payments_tx_cap();

drop trigger if exists transactions_alloc_ck on public.transactions;
create constraint trigger transactions_alloc_ck
  after update of amount, currency, type, status, team_id, counterparty_id on public.transactions
  deferrable initially deferred
  for each row
  when (old.amount is distinct from new.amount or old.currency is distinct from new.currency
        or old.type is distinct from new.type or old.status is distinct from new.status
        or old.team_id is distinct from new.team_id or old.counterparty_id is distinct from new.counterparty_id)
  execute function public.transactions_alloc_guard();

drop trigger if exists transaction_splits_alloc_ck on public.transaction_splits;
create constraint trigger transaction_splits_alloc_ck
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.transaction_splits_alloc_guard();

-- ─── 4b. Инварианты начисления ──────────────────────────────────────────────
create or replace function public.obligations_alloc_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare _o record; _paid bigint; _tx uuid;
begin
  select id, amount, counterparty_id into _o from obligations where id = new.id for no key update;
  if not found then return null; end if;                  -- начисление удалено в этой же транзакции
  if not exists (select 1 from obligation_payments where obligation_id = new.id) then return null; end if;

  if exists (select 1 from obligation_payments where obligation_id = new.id and transaction_id is not null) then
    if old.currency is distinct from new.currency then
      raise exception 'Начисление оплачено операциями — сменить валюту нельзя, сначала отвяжите оплаты' using errcode = '23514';
    end if;
    if old.type is distinct from new.type then
      raise exception 'Начисление оплачено операциями — сменить тип нельзя, сначала отвяжите оплаты' using errcode = '23514';
    end if;
    if old.team_id is distinct from new.team_id then
      raise exception 'Начисление оплачено операциями — перенести в другую команду нельзя, сначала отвяжите оплаты' using errcode = '23514';
    end if;
    if old.counterparty_id is distinct from new.counterparty_id then
      -- допустимо, только если операции остаются согласованы (merge_counterparties переносит
      -- и операции, и начисления); иначе assert_tx_allocation даёт 23514
      for _tx in select distinct transaction_id from obligation_payments
                  where obligation_id = new.id and transaction_id is not null loop
        perform public.assert_tx_allocation(_tx);
      end loop;
    end if;
  end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = new.id;
  if _o.amount < _paid then
    raise exception 'По начислению уже погашено % — уменьшить сумму до % нельзя, сначала отвяжите оплаты',
      to_char(_paid / 100.0, 'FM999999999990.00'), to_char(_o.amount / 100.0, 'FM999999999990.00')
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists obligations_alloc_ck on public.obligations;
create constraint trigger obligations_alloc_ck
  after update of currency, type, counterparty_id, team_id, amount on public.obligations
  deferrable initially deferred
  for each row
  when (old.currency is distinct from new.currency or old.type is distinct from new.type
        or old.counterparty_id is distinct from new.counterparty_id or old.team_id is distinct from new.team_id
        or old.amount is distinct from new.amount)
  execute function public.obligations_alloc_guard();

-- кэп 0086 (тело production) + блокировка строки начисления: параллельные прямые insert
-- на одно начисление выстраиваются, второй видит строку первого
create or replace function public.assert_obligation_not_overpaid()
returns trigger language plpgsql security definer set search_path = public as $$
declare _obl uuid; _paid bigint; _amount bigint;
begin
  _obl := coalesce(new.obligation_id, old.obligation_id);
  select amount into _amount from obligations where id = _obl for no key update;
  if _amount is null then return null; end if;
  select coalesce(sum(amount),0) into _paid from obligation_payments where obligation_id = _obl;
  if _paid > _amount then
    raise exception 'Обязательство %: разнесено % при сумме % — переплата', _obl, _paid, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

-- ─── 5a. settle_obligation_on_tx (тело production + отказ при разных валютах) ─
create or replace function public.settle_obligation_on_tx()
returns trigger language plpgsql security definer set search_path = public as $$
declare _ocur text;
begin
  if tg_op = 'UPDATE' and old.obligation_id is not null
     and (new.obligation_id is distinct from old.obligation_id
          or new.status <> 'actual'
          or new.type = 'transfer') then
    delete from public.obligation_payments
      where transaction_id = new.id and obligation_id = old.obligation_id;
  end if;

  if new.obligation_id is not null and new.status = 'actual' and new.type <> 'transfer' then
    select currency into _ocur from public.obligations where id = new.obligation_id;
    if _ocur is not null and _ocur <> new.currency then
      raise exception 'Операция в % не может сама погасить начисление в %: сохраните её без начисления и привяжите через «Привязать оплату»',
        new.currency, _ocur using errcode = '22023';
    end if;
    insert into public.obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
    values (new.obligation_id, new.amount, new.occurred_on, new.id, new.created_by)
    on conflict (transaction_id, obligation_id) where transaction_id is not null
    do update set amount  = excluded.amount,
                  paid_on = excluded.paid_on;
  end if;

  return new;
end;
$$;

-- currency добавлена в список колонок: смена валюты операции с начислением сразу даёт понятную ошибку
drop trigger if exists trg_settle_obligation on public.transactions;
create trigger trg_settle_obligation
  after insert or update of status, amount, currency, occurred_on, obligation_id, type on public.transactions
  for each row execute function public.settle_obligation_on_tx();

-- ─── 5b. obligation_pay (тело production + coalesce + отказ при счёте другой валюты) ─
create or replace function public.obligation_pay(p_obligation uuid, p_account uuid, p_amount bigint,
  p_occurred_on date default null, p_note text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o obligations; _dup jsonb; _paid bigint; _tx uuid; _type tx_type; _cur text; _day date;
begin
  select * into _o from obligations where id = p_obligation for update;
  if _o.id is null then raise exception 'Обязательство не найдено' using errcode = '42704'; end if;
  if not coalesce(public.can_edit_finance(_o.team_id), false) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Сумма должна быть больше нуля' using errcode = '22023'; end if;
  if p_account is not null and not exists (select 1 from accounts where id = p_account and team_id = _o.team_id) then
    raise exception 'Счёт не найден' using errcode = '42704';
  end if;
  _cur := coalesce((select currency from accounts where id = p_account), _o.currency);
  if _cur <> _o.currency then
    raise exception 'Счёт в %, начисление в %: выплатите со счёта в валюте начисления или проведите операцию и привяжите её через «Привязать оплату»',
      _cur, _o.currency using errcode = '22023';
  end if;

  _dup := public.op_begin(p_request_id, _o.team_id, 'obligation_pay');
  if _dup is not null then return _dup; end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = p_obligation;
  if _paid + p_amount > _o.amount then
    raise exception 'Переплата: уже разнесено %, сумма обязательства %', _paid, _o.amount using errcode = '23514';
  end if;

  -- payable закрывается расходом, receivable — приходом
  _type := case when _o.type = 'payable' then 'expense' else 'income' end::tx_type;
  _day  := coalesce(p_occurred_on, current_date);

  if p_account is not null then
    insert into transactions (team_id, type, amount, currency, account_id, counterparty_id,
                              occurred_on, note, status, created_by, origin)
    values (_o.team_id, _type, p_amount, _cur, p_account, _o.counterparty_id,
            _day, coalesce(p_note, _o.note), 'actual', auth.uid(), 'manual')
    returning id into _tx;
  end if;

  -- payment_* (IDENTITY) заполняет триггер obligation_payments_fill_fx
  insert into obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
  values (p_obligation, p_amount, _day, _tx, auth.uid());

  return public.op_finish(p_request_id, jsonb_build_object(
    'ok', true, 'transaction_id', _tx, 'paid', _paid + p_amount, 'amount', _o.amount,
    'outstanding', _o.amount - (_paid + p_amount)));
end $$;

-- ─── 6a. obligation_link — единственный путь привязки операции к начислению ──
-- p_amount         — в валюте НАЧИСЛЕНИЯ; null = максимум (только при одной валюте)
-- p_payment_amount — в валюте ОПЕРАЦИИ; обязателен при разных валютах
-- p_fx_method      — 'CBR' (курс ЦБ из подсказки) | 'MANUAL' (по умолчанию); только при разных валютах
-- p_fx_rate_date   — дата курса ЦБ (для CBR обязательна, от occurred_on − 15 дней до occurred_on)
-- p_fx_rate        — курс ЦБ (для CBR обязателен; единиц валюты начисления за 1 единицу валюты операции)
drop function if exists public.obligation_link(uuid, uuid, bigint, bigint, text, date, uuid);
create or replace function public.obligation_link(
  p_obligation uuid,
  p_transaction uuid,
  p_amount bigint default null,
  p_payment_amount bigint default null,
  p_fx_method text default null,
  p_fx_rate_date date default null,
  p_request_id uuid default null,
  p_fx_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _team uuid; _o obligations; _t transactions; _dup jsonb; _id uuid;
  _cp_share bigint; _tx_used bigint; _cp_used bigint; _rem bigint; _paid bigint; _out bigint;
  _amt bigint; _pay bigint; _method text; _rate numeric; _rate_date date;
begin
  if p_obligation is null or p_transaction is null then
    raise exception 'Укажите начисление и операцию' using errcode = '22023';
  end if;
  select team_id into _team from obligations where id = p_obligation;
  -- не участник команды — «не найдено» (существование чужих строк не раскрывается)
  if _team is null or not coalesce(public.is_team_member(_team), false) then
    raise exception 'Начисление не найдено' using errcode = '42704';
  end if;
  if not coalesce(public.can_edit_finance(_team), false) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  -- порядок блокировок: операция → начисление; FOR NO KEY UPDATE не конфликтует с KEY SHARE
  -- внешних ключей и сериализует привязки к одной операции/начислению
  select * into _t from transactions where id = p_transaction and team_id = _team for no key update;
  if _t.id is null then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  select * into _o from obligations where id = p_obligation and team_id = _team for no key update;
  if _o.id is null then raise exception 'Начисление не найдено' using errcode = '42704'; end if;

  _dup := public.op_begin(p_request_id, _team, 'obligation_link');
  if _dup is not null then return _dup; end if;

  if _t.status <> 'actual' then
    raise exception 'Плановую операцию привязать к начислению нельзя — сначала проведите её' using errcode = '22023';
  end if;
  if _t.type = 'transfer' then
    raise exception 'Перевод между своими счетами нельзя привязать к начислению' using errcode = '22023';
  end if;
  if not ((_o.type = 'payable' and _t.type = 'expense') or (_o.type = 'receivable' and _t.type = 'income')) then
    raise exception 'Начисление к выплате закрывается расходом, к получению — приходом' using errcode = '22023';
  end if;

  _cp_share := public.tx_counterparty_share(_t.id, _o.counterparty_id);
  if coalesce(_cp_share, 0) <= 0 then
    raise exception 'Операция другого контрагента — привязать её к этому начислению нельзя' using errcode = '22023';
  end if;

  if exists (select 1 from obligation_payments where transaction_id = _t.id and obligation_id = _o.id) then
    raise exception 'Эта операция уже привязана к начислению' using errcode = '23505';
  end if;

  -- остаток операции в её валюте (LEGACY-строки учитываются своим payment_amount)
  select coalesce(sum(p.payment_amount), 0),
         coalesce(sum(p.payment_amount) filter (where o2.counterparty_id = _o.counterparty_id), 0)
    into _tx_used, _cp_used
    from obligation_payments p join obligations o2 on o2.id = p.obligation_id
   where p.transaction_id = _t.id;
  _rem := least(_t.amount - _tx_used, _cp_share - _cp_used);
  if _rem <= 0 then
    raise exception 'У операции не осталось нераспределённой суммы' using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = _o.id;
  _out := _o.amount - _paid;
  if _out <= 0 then
    raise exception 'Начисление уже погашено' using errcode = '23514';
  end if;

  if _t.currency = _o.currency then
    if p_amount is not null and p_payment_amount is not null and p_amount <> p_payment_amount then
      raise exception 'Валюта операции и начисления одна (%): суммы должны совпадать', _t.currency using errcode = '22023';
    end if;
    _amt := coalesce(p_amount, p_payment_amount, least(_rem, _out));
    if _amt <= 0 then raise exception 'Сумма должна быть больше нуля' using errcode = '22023'; end if;
    if _amt > _out then
      raise exception 'Сумма % % больше долга по начислению % %',
        to_char(_amt / 100.0, 'FM999999999990.00'), _o.currency,
        to_char(_out / 100.0, 'FM999999999990.00'), _o.currency using errcode = '23514';
    end if;
    if _amt > _rem then
      raise exception 'Сумма % % больше нераспределённого остатка операции % %',
        to_char(_amt / 100.0, 'FM999999999990.00'), _t.currency,
        to_char(_rem / 100.0, 'FM999999999990.00'), _t.currency using errcode = '23514';
    end if;
    _pay := _amt; _method := 'IDENTITY'; _rate := 1; _rate_date := _t.occurred_on;
  else
    if p_amount is null or p_payment_amount is null then
      raise exception 'Операция в %, начисление в %: укажите обе суммы — сколько % ушло и сколько % долга закрыто',
        _t.currency, _o.currency, _t.currency, _o.currency using errcode = '22023';
    end if;
    if p_amount <= 0 or p_payment_amount <= 0 then
      raise exception 'Суммы должны быть больше нуля' using errcode = '22023';
    end if;
    _method := upper(coalesce(nullif(btrim(p_fx_method), ''), 'MANUAL'));
    if _method not in ('CBR','MANUAL') then
      raise exception 'Способ курса: CBR (курс ЦБ) или MANUAL (суммы вручную)' using errcode = '22023';
    end if;
    if _method = 'CBR' then
      if p_fx_rate is null or p_fx_rate_date is null then
        raise exception 'Для курса ЦБ укажите курс и его дату' using errcode = '22023';
      end if;
      if p_fx_rate < 0.000001 or p_fx_rate > 1000000 then
        raise exception 'Курс % вне допустимого диапазона (0,000001 … 1 000 000)', p_fx_rate using errcode = '22023';
      end if;
      if p_fx_rate_date < _t.occurred_on - 15 or p_fx_rate_date > _t.occurred_on then
        raise exception 'Дата курса ЦБ % должна быть не позже даты операции % и не раньше чем за 15 дней до неё',
          to_char(p_fx_rate_date, 'DD.MM.YYYY'), to_char(_t.occurred_on, 'DD.MM.YYYY') using errcode = '22023';
      end if;
      -- согласованность: суммы расходятся с курсом не больше чем на одну минорную единицу платежа
      if abs(p_amount - p_payment_amount * p_fx_rate) > greatest(p_fx_rate, 1) then
        raise exception 'Суммы не соответствуют курсу ЦБ %: % × курс ≠ % — пересчитайте или выберите «вручную»',
          p_fx_rate, to_char(p_payment_amount / 100.0, 'FM999999999990.00'),
          to_char(p_amount / 100.0, 'FM999999999990.00') using errcode = '22023';
      end if;
      _rate := p_fx_rate;
      _rate_date := p_fx_rate_date;
    else
      _rate := round(p_amount::numeric / p_payment_amount, 10);
      if _rate < 0.000001 or _rate > 1000000 then
        raise exception 'Неявный курс % вне допустимого диапазона (0,000001 … 1 000 000) — проверьте суммы', _rate using errcode = '22023';
      end if;
      _rate_date := coalesce(p_fx_rate_date, _t.occurred_on);
    end if;
    if p_payment_amount > _rem then
      raise exception 'Сумма % % больше нераспределённого остатка операции % %',
        to_char(p_payment_amount / 100.0, 'FM999999999990.00'), _t.currency,
        to_char(_rem / 100.0, 'FM999999999990.00'), _t.currency using errcode = '23514';
    end if;
    if p_amount > _out then
      raise exception 'Сумма % % больше долга по начислению % %',
        to_char(p_amount / 100.0, 'FM999999999990.00'), _o.currency,
        to_char(_out / 100.0, 'FM999999999990.00'), _o.currency using errcode = '23514';
    end if;
    _amt := p_amount; _pay := p_payment_amount;
  end if;

  -- метка для obligation_payments_fill_fx: кросс-валютная строка пришла из этого RPC
  perform set_config('basa.obligation_link', _t.id::text || ':' || _o.id::text, true);
  insert into obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by,
                                   payment_amount, payment_currency, fx_rate, fx_rate_date, fx_method)
  values (_o.id, _amt, _t.occurred_on, _t.id, auth.uid(),
          _pay, _t.currency, _rate, _rate_date, _method)
  returning id into _id;
  perform set_config('basa.obligation_link', '', true);

  return public.op_finish(p_request_id, jsonb_build_object(
    'ok', true, 'id', _id, 'obligation_id', _o.id, 'transaction_id', _t.id,
    'amount', _amt, 'currency', _o.currency,
    'payment_amount', _pay, 'payment_currency', _t.currency,
    'fx_rate', _rate, 'fx_rate_date', _rate_date, 'fx_method', _method,
    'obligation_outstanding', _out - _amt,
    'transaction_remaining', _rem - _pay,
    'outstanding', _out - _amt));   -- совместимость со старым ответом obligation_allocate
end $$;

-- ─── 6b. obligation_allocate — тонкая обёртка (сигнатура прежняя) ───────────
-- С операцией — obligation_link (p_amount — в валюте начисления; p_paid_on игнорируется:
-- дата погашения = дата операции). Без операции — прежнее «погашено вручную».
create or replace function public.obligation_allocate(p_obligation uuid, p_transaction uuid, p_amount bigint,
  p_paid_on date default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _team uuid; _amount bigint; _paid bigint; _dup jsonb; _id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Сумма должна быть больше нуля' using errcode = '22023';
  end if;

  if p_transaction is not null then
    return public.obligation_link(p_obligation => p_obligation, p_transaction => p_transaction,
                                  p_amount => p_amount, p_request_id => p_request_id);
  end if;

  select team_id, amount into _team, _amount from obligations where id = p_obligation for update;
  if _team is null then raise exception 'Обязательство не найдено' using errcode = '42704'; end if;
  if not coalesce(public.can_edit_finance(_team), false) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;

  _dup := public.op_begin(p_request_id, _team, 'obligation_allocate');
  if _dup is not null then return _dup; end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = p_obligation;
  if _paid + p_amount > _amount then
    raise exception 'Переплата: уже разнесено %, сумма обязательства %, попытка добавить %',
      _paid, _amount, p_amount using errcode = '23514';
  end if;

  insert into obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
  values (p_obligation, p_amount, coalesce(p_paid_on, current_date), null, auth.uid())
  returning id into _id;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'id', _id, 'paid', _paid + p_amount, 'amount', _amount,
                       'outstanding', _amount - (_paid + p_amount)));
end $$;

-- ─── 7. op_begin: повтор ключа — только той же команде и тому же пользователю ─
-- Раньше любой вызов с чужим request_id получал сохранённый результат чужой команды/пользователя.
-- Повтор от того же пользователя той же команды (AgentPayouts/PayrollRowActions с id начисления
-- как ключом, банковский импорт от service_role с created_by = null) работает как раньше.
create or replace function public.op_begin(_request_id uuid, _team uuid, _command text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _res jsonb; _r_team uuid; _r_by uuid;
begin
  if _request_id is null then
    return null; -- вызов без ключа идемпотентности (обратная совместимость)
  end if;
  begin
    insert into operation_requests (request_id, team_id, command, created_by)
    values (_request_id, _team, _command, auth.uid());
    return null;
  exception when unique_violation then
    -- Параллельный/повторный вызов: INSERT ждал первую транзакцию, она
    -- закоммитилась — возвращаем её результат, ничего не выполняя.
    select team_id, created_by, result into _r_team, _r_by, _res
      from operation_requests where request_id = _request_id;
    if _r_team is distinct from _team or _r_by is distinct from auth.uid() then
      raise exception 'Ключ запроса уже использован другим пользователем или командой' using errcode = '23505';
    end if;
    return coalesce(_res, jsonb_build_object('ok', true, 'duplicate', true));
  end;
end $$;

-- ─── 8. Политика прямого insert: + команда операции = команда начисления ────
-- Тип/статус/валюта/контрагент операции проверяет obligation_payments_fill_fx (для всех путей).
-- Полностью прямой insert закрывается в 0100 после деплоя нового фронта.
drop policy if exists obligation_payments_insert on public.obligation_payments;
create policy obligation_payments_insert on public.obligation_payments
  for insert with check (
    exists (select 1 from public.obligations o
             where o.id = obligation_payments.obligation_id
               and public.can_edit_finance(o.team_id)
               and (obligation_payments.transaction_id is null
                    or exists (select 1 from public.transactions t
                                where t.id = obligation_payments.transaction_id
                                  and t.team_id = o.team_id))));

-- ─── 9. Гранты ──────────────────────────────────────────────────────────────
revoke all on function public.obligation_link(uuid, uuid, bigint, bigint, text, date, uuid, numeric) from public, anon;
grant execute on function public.obligation_link(uuid, uuid, bigint, bigint, text, date, uuid, numeric) to authenticated, service_role;

revoke all on function public.obligation_allocate(uuid, uuid, bigint, date, uuid) from public, anon;
grant execute on function public.obligation_allocate(uuid, uuid, bigint, date, uuid) to authenticated, service_role;
revoke all on function public.obligation_pay(uuid, uuid, bigint, date, text, uuid) from public, anon;
grant execute on function public.obligation_pay(uuid, uuid, bigint, date, text, uuid) to authenticated, service_role;

-- триггерные и внутренние — без EXECUTE у клиентских ролей (триггерам EXECUTE не нужен)
do $$
declare f text;
begin
  foreach f in array array[
    'public.obligation_payments_fill_fx()', 'public.obligation_payments_tx_cap()',
    'public.transactions_alloc_guard()', 'public.transaction_splits_alloc_guard()',
    'public.obligations_alloc_guard()', 'public.assert_tx_allocation(uuid)',
    'public.tx_counterparty_share(uuid, uuid)', 'public.settle_obligation_on_tx()',
    'public.assert_obligation_not_overpaid()', 'public.op_begin(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ─── Самопроверка ───────────────────────────────────────────────────────────
do $$
declare f text; _n int;
begin
  if to_regprocedure('public.obligation_link(uuid,uuid,bigint,bigint,text,date,uuid)') is not null then
    raise exception '0099 self-check: осталась старая сигнатура obligation_link';
  end if;
  foreach f in array array[
    'public.obligation_link(uuid,uuid,bigint,bigint,text,date,uuid,numeric)',
    'public.obligation_allocate(uuid,uuid,bigint,date,uuid)',
    'public.obligation_pay(uuid,uuid,bigint,date,text,uuid)',
    'public.obligation_payments_fill_fx()', 'public.obligation_payments_tx_cap()',
    'public.transactions_alloc_guard()', 'public.transaction_splits_alloc_guard()',
    'public.obligations_alloc_guard()', 'public.assert_tx_allocation(uuid)',
    'public.tx_counterparty_share(uuid,uuid)', 'public.settle_obligation_on_tx()',
    'public.assert_obligation_not_overpaid()', 'public.op_begin(uuid,uuid,text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0099 self-check: у anon есть EXECUTE на %', f;
    end if;
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef
                     and proconfig @> array['search_path=public']) then
      raise exception '0099 self-check: % не SECURITY DEFINER или без search_path=public', f;
    end if;
  end loop;
  foreach f in array array[
    'public.obligation_payments_fill_fx()', 'public.obligation_payments_tx_cap()',
    'public.transactions_alloc_guard()', 'public.transaction_splits_alloc_guard()',
    'public.obligations_alloc_guard()', 'public.assert_tx_allocation(uuid)',
    'public.tx_counterparty_share(uuid,uuid)', 'public.settle_obligation_on_tx()',
    'public.assert_obligation_not_overpaid()', 'public.op_begin(uuid,uuid,text)'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '0099 self-check: у authenticated есть EXECUTE на внутреннюю %', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.obligation_link(uuid,uuid,bigint,bigint,text,date,uuid,numeric)', 'execute') then
    raise exception '0099 self-check: у authenticated нет EXECUTE на obligation_link';
  end if;
  select count(*) into _n from obligation_payments where transaction_id is not null and fx_method is null;
  if _n > 0 then raise exception '0099 self-check: % привязок без fx_method', _n; end if;
end $$;
