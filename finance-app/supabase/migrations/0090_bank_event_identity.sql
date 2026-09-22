-- ============================================================
-- 0090_bank_event_identity — шаг 5 REMEDIATION_PLAN
-- Закрывает T6, T7 и ПЕРВОПРИЧИНУ FIN-03.
--
-- Что было не так (см. FIN03_FORENSICS.md):
--   • импортёр Точки дедупил по (team_id, source='tochka', external_id);
--   • CSV-визарды не заполняли ни source, ни external_id — для дедупа их строки
--     были невидимы в принципе;
--   • перевод между своими счетами Точка писала одной строкой type='transfer',
--     а сводный CSV — двумя (expense+income).
--   => одно банковское событие попадало в систему дважды.
--
-- Каноническая модель идентичности банковского события:
--   origin          — откуда строка: bank | bank_csv | manual | manual_adjustment | system
--   bank_event_id   — идентификатор события у провайдера ('<provider>:<id>'),
--                     уникален внутри команды; есть только у origin='bank'
--   bank_event_fp   — канонический отпечаток события, ВЫЧИСЛЯЕМЫЙ В БД
--                     (generated column) из счёта, даты, суммы, валюты и
--                     направления. Оба импортёра физически не могут посчитать
--                     его по-разному.
-- Внутренний перевод канонически = ОДНА строка type='transfer'; отпечаток
-- берётся по дебетовой ноге (счёт списания, направление 'out').
-- Отпечаток НЕ уникален: два настоящих одинаковых платежа в один день
-- допустимы. Защита от повторного импорта — в правиле кратности внутри
-- bank_import_commit(): вставляется только «излишек» над уже имеющимся.
-- ============================================================

-- ─── 1. origin ──────────────────────────────────────────────────────────────
do $$ begin
  alter table public.transactions
    add column origin text not null default 'manual'
    check (origin in ('bank','bank_csv','manual','manual_adjustment','system'));
exception when duplicate_column then null; end $$;

-- ─── 2. идентификатор события у провайдера ──────────────────────────────────
do $$ begin
  alter table public.transactions add column bank_event_id text;
exception when duplicate_column then null; end $$;

-- ─── 3. backfill по существующим данным ─────────────────────────────────────
update public.transactions
   set origin = 'bank',
       bank_event_id = coalesce(bank_event_id, source || ':' || external_id)
 where origin = 'manual' and source in ('tochka','bybit') and external_id is not null;

update public.transactions
   set origin = 'bank_csv'
 where origin = 'manual' and source is null and import_batch_id is not null;

update public.transactions
   set origin = 'system'
 where origin = 'manual' and (recurring_rule_id is not null);

-- ─── 4. канонический отпечаток (generated, поэтому обойти его нельзя) ───────
do $$ begin
  alter table public.transactions add column bank_event_fp text
    generated always as (
      case when origin in ('bank','bank_csv') and account_id is not null then
        team_id::text || '|' || account_id::text || '|'
        || (occurred_on - date '2000-01-01')::text || '|'
        || amount::text || '|' || currency || '|'
        || case when type = 'income' then 'in' else 'out' end
      end
    ) stored;
exception when duplicate_column then null; end $$;

create unique index if not exists transactions_bank_event_id_uidx
  on public.transactions (team_id, bank_event_id) where bank_event_id is not null;

create index if not exists transactions_bank_event_fp_idx
  on public.transactions (team_id, bank_event_fp) where bank_event_fp is not null;

-- ─── 4b. Признак служебного вызова (cron идёт под service_role) ────────────
-- Внутри SECURITY DEFINER current_user — владелец функции, поэтому роль
-- вызывающего берём из проверенных PostgREST claim'ов JWT (клиент их подменить
-- не может). Нужно для Vercel-cron: он работает под service-role ключом, у него
-- нет auth.uid(), и can_edit_finance() для него неприменим.
create or replace function public.is_service_role() returns boolean
language sql stable set search_path = public as $$
  select coalesce(
           nullif(current_setting('request.jwt.claim.role', true), ''),
           nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
           ''
         ) = 'service_role'
$$;

-- ─── 5. T7: атомарный захват права на синхронизацию (CAS вместо TOCTOU) ─────
-- Было: прочитали last_synced_at → сравнили в JS → записали. Два запроса
-- проходили тротлинг одновременно (тест T7). Стало: один UPDATE с условием.
create or replace function public.bank_sync_claim(
  _team uuid, _provider text, _max_age interval default interval '2 hours')
returns boolean language plpgsql security definer set search_path = public as $$
declare _ok boolean;
begin
  if not (public.is_service_role() or coalesce(public.can_edit_finance(_team), false)) then
    return false;
  end if;
  update bank_connections
     set last_synced_at = now()
   where team_id = _team and provider = _provider
     and (last_synced_at is null or last_synced_at < now() - _max_age)
  returning true into _ok;
  return coalesce(_ok, false);
end $$;

-- ─── 6. T6 + FIN-03: импорт одной транзакцией с кросс-источниковым дедупом ──
-- p_batch: { file_name, bank, account_id?, note?, status? }
-- p_rows:  [ { type, amount, currency, account_id, transfer_account_id?,
--              category_id?, counterparty_key?, project_id?, occurred_on, note?,
--              external_id?, provider?, origin? } ]
-- p_counterparties: [ { key, name, inn?, kpp?, kind? } ] — создаются в этой же
--   транзакции, поэтому при ошибке вставки операций не остаётся «сирот».
create or replace function public.bank_import_commit(
  p_team uuid,
  p_batch jsonb,
  p_rows jsonb,
  p_counterparties jsonb default '[]'::jsonb,
  p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _dup jsonb; _batch uuid; _inserted int := 0; _skipped_id int := 0; _skipped_fp int := 0;
  _promoted int := 0; _cp_created int := 0; _total int;
begin
  if not (public.is_service_role() or coalesce(public.can_edit_finance(p_team), false)) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  _dup := public.op_begin(p_request_id, p_team, 'bank_import_commit');
  if _dup is not null then return _dup; end if;

  -- Сериализация импортов одной команды: исключает гонку двух импортёров и
  -- гонку при создании контрагентов.
  perform pg_advisory_xact_lock(hashtext('bank_import:' || p_team::text));

  select count(*) into _total from jsonb_array_elements(p_rows);

  -- 6.1 контрагенты: создаём отсутствующих (матч по ИНН, иначе по имени)
  create temporary table _cp (key text primary key, id uuid) on commit drop;
  insert into _cp (key, id)
  select c->>'key',
         coalesce(
           (select x.id from counterparties x where x.team_id = p_team
              and nullif(c->>'inn','') is not null and x.inn = c->>'inn' limit 1),
           (select x.id from counterparties x where x.team_id = p_team
              and lower(btrim(x.name)) = lower(btrim(c->>'name')) limit 1))
    from jsonb_array_elements(p_counterparties) c
   where nullif(c->>'key','') is not null
  on conflict (key) do nothing;

  with need as (
    select c->>'key' as key, btrim(c->>'name') as name, nullif(c->>'inn','') as inn,
           nullif(c->>'kpp','') as kpp, coalesce(nullif(c->>'kind',''),'other') as kind
      from jsonb_array_elements(p_counterparties) c
     where (select id from _cp where _cp.key = c->>'key') is null
       and nullif(c->>'key','') is not null
  ), ins as (
    insert into counterparties (team_id, name, inn, kpp, kind)
    select p_team, name, inn, kpp, kind::counterparty_kind from need
    returning id, name
  )
  update _cp set id = ins.id from ins, need
   where need.key = _cp.key and lower(btrim(ins.name)) = lower(btrim(need.name)) and _cp.id is null;
  select count(*) into _cp_created from _cp where id is not null
    and key in (select c->>'key' from jsonb_array_elements(p_counterparties) c);

  -- 6.2 кандидаты с вычисленными идентификаторами
  create temporary table _cand on commit drop as
  select (row_number() over ())::int as ord,
         (r->>'type')::tx_type as type,
         (r->>'amount')::bigint as amount,
         coalesce(nullif(r->>'currency',''),'RUB') as currency,
         nullif(r->>'account_id','')::uuid as account_id,
         nullif(r->>'transfer_account_id','')::uuid as transfer_account_id,
         nullif(r->>'category_id','')::uuid as category_id,
         (select id from _cp where _cp.key = r->>'counterparty_key') as counterparty_id,
         nullif(r->>'project_id','')::uuid as project_id,
         (r->>'occurred_on')::date as occurred_on,
         nullif(r->>'note','') as note,
         nullif(r->>'external_id','') as external_id,
         coalesce(nullif(r->>'origin',''),'bank') as origin,
         case when nullif(r->>'external_id','') is not null
              then coalesce(nullif(r->>'provider',''),'tochka') || ':' || (r->>'external_id') end as bank_event_id,
         case when nullif(r->>'account_id','') is not null then
           p_team::text || '|' || (r->>'account_id') || '|'
           || (((r->>'occurred_on')::date - date '2000-01-01'))::text || '|'
           || (r->>'amount') || '|' || coalesce(nullif(r->>'currency',''),'RUB') || '|'
           || case when (r->>'type') = 'income' then 'in' else 'out' end
         end as fp
    from jsonb_array_elements(p_rows) r;

  -- счета и справочники должны принадлежать этой же команде
  if exists (select 1 from _cand c where c.account_id is not null
               and not exists (select 1 from accounts a where a.id = c.account_id and a.team_id = p_team)) then
    raise exception 'Счёт из другой команды' using errcode = '42501';
  end if;
  if exists (select 1 from _cand c where c.transfer_account_id is not null
               and not exists (select 1 from accounts a where a.id = c.transfer_account_id and a.team_id = p_team)) then
    raise exception 'Счёт зачисления из другой команды' using errcode = '42501';
  end if;

  -- 6.3 уже импортированные по идентификатору провайдера
  create temporary table _dup_id on commit drop as
  select c.ord from _cand c join transactions t
    on t.team_id = p_team and t.bank_event_id = c.bank_event_id;
  select count(*) into _skipped_id from _dup_id;

  -- 6.4 кратность отпечатка: сколько таких событий уже есть и сколько пришло
  create temporary table _ranked on commit drop as
  select c.*, (row_number() over (partition by c.fp order by c.ord))::int as rn
    from _cand c where c.ord not in (select ord from _dup_id);

  create temporary table _exist on commit drop as
  select t.id, t.bank_event_fp as fp, t.bank_event_id,
         (row_number() over (partition by t.bank_event_fp order by t.created_at, t.id))::int as rn
    from transactions t
   where t.team_id = p_team and t.bank_event_fp in (select fp from _cand where fp is not null);

  -- 6.5 «Повышение» уже существующей строки до канонической банковской:
  -- событие пришло из CSV раньше, теперь пришёл банковский идентификатор —
  -- записываем его в существующую строку вместо создания второй.
  with pairs as (
    select e.id, r.bank_event_id
      from _ranked r join _exist e on e.fp = r.fp and e.rn = r.rn
     where r.bank_event_id is not null and e.bank_event_id is null
  ), upd as (
    update transactions t set bank_event_id = p.bank_event_id, origin = 'bank'
      from pairs p where t.id = p.id returning t.id
  ) select count(*) into _promoted from upd;

  -- 6.6 батч и вставка только «излишка»
  insert into import_batches (team_id, created_by, file_name, account_id, bank, row_count, status, note)
  values (p_team, auth.uid(), coalesce(p_batch->>'file_name','Импорт'),
          nullif(p_batch->>'account_id','')::uuid, nullif(p_batch->>'bank',''),
          0, coalesce(nullif(p_batch->>'status',''),'imported'), nullif(p_batch->>'note',''))
  returning id into _batch;

  with fresh as (
    select r.* from _ranked r
      left join (select fp, count(*) c from _exist group by fp) e on e.fp = r.fp
     where r.fp is null or r.rn > coalesce(e.c, 0)
  ), ins as (
    insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                              category_id, counterparty_id, project_id, occurred_on, note,
                              created_by, external_id, source, origin, bank_event_id, import_batch_id, status)
    select p_team, f.type, f.amount, f.currency, f.account_id, f.transfer_account_id,
           f.category_id, f.counterparty_id, f.project_id, f.occurred_on, f.note,
           auth.uid(), f.external_id,
           case when f.origin = 'bank' then coalesce(split_part(f.bank_event_id, ':', 1), 'tochka') else null end,
           f.origin, f.bank_event_id, _batch, 'actual'
      from fresh f
    on conflict do nothing
    returning id
  ) select count(*) into _inserted from ins;

  _skipped_fp := _total - _skipped_id - _inserted - _promoted;

  if _inserted = 0 then
    delete from import_batches where id = _batch;  -- пустой батч не остаётся
    _batch := null;
  else
    update import_batches set row_count = _inserted where id = _batch;
  end if;

  return public.op_finish(p_request_id, jsonb_build_object(
    'ok', true, 'batch_id', _batch, 'total', _total,
    'imported', _inserted, 'skipped_by_event_id', _skipped_id,
    'skipped_by_fingerprint', greatest(_skipped_fp, 0), 'promoted', _promoted,
    'counterparties', _cp_created));
end $$;

do $$ begin
  execute 'grant execute on function public.is_service_role() to authenticated, service_role';
  execute 'grant execute on function public.bank_sync_claim(uuid, text, interval) to authenticated';
  execute 'grant execute on function public.bank_import_commit(uuid, jsonb, jsonb, jsonb, uuid) to authenticated';
end $$;
