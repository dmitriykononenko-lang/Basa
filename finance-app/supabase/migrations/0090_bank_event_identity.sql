-- ============================================================
-- 0090_bank_event_identity — шаг 5 REMEDIATION_PLAN
-- Закрывает T6, T7 и ПЕРВОПРИЧИНУ FIN-03.
--
-- ВЕРСИЯ 2 (после pre-production collision analysis на всей истории проде).
-- Первая версия дедуплицировала по одному отпечатку
-- (счёт|дата|сумма|валюта|направление) с правилом кратности. Замер показал,
-- что так нельзя:
--   • 537 групп отпечатков из 6 931 коллизируют (1 164 строки, 627 «лишних»);
--   • 446 из этих групп содержат ДВА И БОЛЕЕ РАЗНЫХ provider transaction id,
--     то есть это заведомо разные реальные операции;
--   • даже с контрагентом и ПОЛНЫМ назначением платежа остаются 75 таких групп
--     (пример: два вывода Bybit одного дня на одну сумму с одинаковым описанием
--     и разными id — bybit-wd-226074267 и bybit-wd-226100544).
-- Вывод: инъективного отпечатка на этих данных не существует, поэтому
-- отпечаток НЕ МОЖЕТ быть основанием для автоматического удаления/пропуска
-- операции, у которой есть идентификатор провайдера.
--
-- Приоритет идентичности (реализован ниже):
--   1. bank_event_id = provider : provider account : provider transaction id
--      — единственный авторитетный признак «то же самое событие».
--   2. Отпечаток — только для кросс-импортной сверки, когда стабильного id
--      провайдера ещё нет (CSV-выписка).
--   3. Любая неоднозначность => операция СОХРАНЯЕТСЯ и заводится
--      reconciliation conflict. Silent drop невозможен.
--
-- Модель:
--   origin                — bank | bank_csv | manual | manual_adjustment | system
--   bank_provider         — 'tochka' | 'bybit' | …
--   bank_provider_account — счёт у провайдера (номер счёта/UID), если известен
--   bank_provider_tx_id   — идентификатор операции у провайдера
--   bank_event_id         — generated из трёх полей выше; уникален в команде
--   bank_event_fp         — слабый отпечаток (счёт|дата|сумма|валюта|направление)
--   bank_event_fp_strong  — слабый + контрагент + НОРМАЛИЗОВАННОЕ назначение
--                           (до первого '·', только буквы и цифры, lower).
--                           Замер: совпадает у 130 из 130 известных кросс-
--                           импортных пар FIN-03 — то есть достаточен для
--                           сверки, но НЕ используется для дропа.
-- Внутренний перевод канонически = ОДНА строка type='transfer'; отпечаток
-- берётся по дебетовой ноге (счёт списания, направление 'out').
-- ============================================================

-- ─── 1. origin и поля идентичности провайдера ───────────────────────────────
do $$ begin
  alter table public.transactions
    add column origin text not null default 'manual'
    check (origin in ('bank','bank_csv','manual','manual_adjustment','system'));
exception when duplicate_column then null; end $$;

do $$ begin alter table public.transactions add column bank_provider text;
exception when duplicate_column then null; end $$;
do $$ begin alter table public.transactions add column bank_provider_account text;
exception when duplicate_column then null; end $$;
do $$ begin alter table public.transactions add column bank_provider_tx_id text;
exception when duplicate_column then null; end $$;

-- ─── 2. backfill по существующим данным ─────────────────────────────────────
update public.transactions
   set origin = 'bank',
       bank_provider = source,
       bank_provider_tx_id = external_id
 where origin = 'manual' and source in ('tochka','bybit') and external_id is not null;

update public.transactions
   set origin = 'bank_csv'
 where origin = 'manual' and source is null and import_batch_id is not null;

update public.transactions
   set origin = 'system'
 where origin = 'manual' and recurring_rule_id is not null;

-- ─── 3. нормализация назначения платежа (IMMUTABLE — нужна для generated) ───
-- Отрезает служебный хвост после '·' («Платежное поручение №…», «Банковский
-- ордер №…»), оставляет только буквы и цифры в нижнем регистре. Именно эта
-- нормализация даёт совпадение 130/130 на известных парах CSV↔банк.
create or replace function public.bank_note_norm(_note text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(split_part(coalesce(_note, ''), '·', 1), '[^[:alnum:]]+', '', 'g'))
$$;

-- ─── 4. вычисляемые идентификаторы ──────────────────────────────────────────
do $$ begin
  alter table public.transactions add column bank_event_id text
    generated always as (
      case when bank_provider is not null and bank_provider_tx_id is not null
        then bank_provider || ':' || coalesce(bank_provider_account, '-') || ':' || bank_provider_tx_id
      end
    ) stored;
exception when duplicate_column then null; end $$;

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

do $$ begin
  alter table public.transactions add column bank_event_fp_strong text
    generated always as (
      case when origin in ('bank','bank_csv') and account_id is not null then
        team_id::text || '|' || account_id::text || '|'
        || (occurred_on - date '2000-01-01')::text || '|'
        || amount::text || '|' || currency || '|'
        || case when type = 'income' then 'in' else 'out' end || '|'
        || coalesce(counterparty_id::text, '-') || '|'
        || public.bank_note_norm(note)
      end
    ) stored;
exception when duplicate_column then null; end $$;

-- Авторитетная уникальность: одно событие провайдера — одна строка.
create unique index if not exists transactions_bank_event_id_uidx
  on public.transactions (team_id, bank_event_id) where bank_event_id is not null;

create index if not exists transactions_bank_event_fp_idx
  on public.transactions (team_id, bank_event_fp) where bank_event_fp is not null;
create index if not exists transactions_bank_event_fp_strong_idx
  on public.transactions (team_id, bank_event_fp_strong) where bank_event_fp_strong is not null;

-- ─── 5. Журнал неоднозначностей сверки ──────────────────────────────────────
-- Сюда попадает всё, что импортёр НЕ стал дедуплицировать автоматически.
-- Операция при этом сохраняется — потерять её нельзя; разбирается человеком.
create table if not exists public.bank_reconciliation_conflicts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  detected_at timestamptz not null default now(),
  kind text not null check (kind in ('ambiguous_match','ambiguous_duplicate','auto_merged')),
  fp_strong text,
  import_batch_id uuid,
  transaction_id uuid,
  candidate jsonb,
  existing_ids uuid[],
  note text,
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists bank_recon_conflicts_team_idx
  on public.bank_reconciliation_conflicts (team_id, detected_at desc) where resolved_at is null;
alter table public.bank_reconciliation_conflicts enable row level security;
do $$ begin
  create policy bank_recon_conflicts_select on public.bank_reconciliation_conflicts
    for select using (public.is_team_member(team_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy bank_recon_conflicts_resolve on public.bank_reconciliation_conflicts
    for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
exception when duplicate_object then null; end $$;

-- ─── 6. Признак служебного вызова (cron идёт под service_role) ─────────────
-- Внутри SECURITY DEFINER current_user — владелец функции, поэтому роль
-- вызывающего берём из проверенных PostgREST claim'ов JWT (клиент их подменить
-- не может).
create or replace function public.is_service_role() returns boolean
language sql stable set search_path = public as $$
  select coalesce(
           nullif(current_setting('request.jwt.claim.role', true), ''),
           nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
           ''
         ) = 'service_role'
$$;

-- ─── 7. T7: атомарный захват права на синхронизацию (CAS вместо TOCTOU) ────
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

-- ─── 8. T6 + FIN-03: импорт одной транзакцией ──────────────────────────────
-- p_batch: { file_name, bank, account_id?, note?, status? }
-- p_rows:  [ { type, amount, currency, account_id, transfer_account_id?,
--              category_id?, counterparty_key?, counterparty_id?, project_id?,
--              occurred_on, note?, provider?, provider_account?, external_id?,
--              origin? } ]
-- p_counterparties: [ { key, name, inn?, kpp?, kind? } ]
--
-- Правила (в этом порядке):
--   1. есть bank_event_id и такой уже есть в БД        → пропуск (дубль по id провайдера)
--   2. есть bank_event_id, ровно один кандидат и ровно
--      одна существующая строка без id провайдера с тем
--      же сильным отпечатком                           → ПОВЫШЕНИЕ существующей строки
--   3. есть bank_event_id, но сопоставление не 1:1     → ВСТАВКА + conflict
--   4. нет bank_event_id (CSV), ровно один кандидат и
--      ровно одна существующая строка с тем же сильным
--      отпечатком                                      → пропуск (событие уже учтено)
--   5. нет bank_event_id, совпадений нет               → вставка
--   6. нет bank_event_id, сопоставление не 1:1         → ВСТАВКА + conflict
-- Пропуск операции возможен ТОЛЬКО по правилам 1 и 4. Пропуск по правилу 4
-- (у кандидата нет id провайдера) дополнительно журналируется как
-- kind='auto_merged' с полным payload кандидата: у CSV-выписки нет
-- информации, позволяющей отличить «то же событие» от «второй такой же
-- операции», поэтому решение должно быть видимым и обратимым, а не молчаливым.
create or replace function public.bank_import_commit(
  p_team uuid,
  p_batch jsonb,
  p_rows jsonb,
  p_counterparties jsonb default '[]'::jsonb,
  p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _dup jsonb; _batch uuid; _total int;
  _inserted int := 0; _skipped_id int := 0; _skipped_fp int := 0;
  _promoted int := 0; _conflicts int := 0; _cp_created int := 0;
begin
  if not (public.is_service_role() or coalesce(public.can_edit_finance(p_team), false)) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  _dup := public.op_begin(p_request_id, p_team, 'bank_import_commit');
  if _dup is not null then return _dup; end if;

  perform pg_advisory_xact_lock(hashtext('bank_import:' || p_team::text));
  select count(*) into _total from jsonb_array_elements(p_rows);

  -- 8.1 контрагенты: матч по ИНН, иначе по имени; отсутствующие создаём здесь же
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
     where nullif(c->>'key','') is not null
       and (select id from _cp where _cp.key = c->>'key') is null
  ), ins as (
    insert into counterparties (team_id, name, inn, kpp, kind)
    select p_team, name, inn, kpp, kind::counterparty_kind from need
    returning id, name
  )
  update _cp set id = ins.id
    from ins, need
   where need.key = _cp.key
     and lower(btrim(ins.name)) = lower(btrim(need.name))
     and _cp.id is null;
  select count(*) into _cp_created from _cp where id is not null;

  -- 8.2 кандидаты с вычисленными идентификаторами (те же формулы, что в generated)
  create temporary table _cand on commit drop as
  select (row_number() over ())::int as ord,
         (r->>'type')::tx_type as type,
         (r->>'amount')::bigint as amount,
         coalesce(nullif(r->>'currency',''),'RUB') as currency,
         nullif(r->>'account_id','')::uuid as account_id,
         nullif(r->>'transfer_account_id','')::uuid as transfer_account_id,
         nullif(r->>'category_id','')::uuid as category_id,
         coalesce(nullif(r->>'counterparty_id','')::uuid,
                  (select id from _cp where _cp.key = r->>'counterparty_key')) as counterparty_id,
         nullif(r->>'project_id','')::uuid as project_id,
         (r->>'occurred_on')::date as occurred_on,
         nullif(r->>'note','') as note,
         nullif(r->>'external_id','') as provider_tx_id,
         nullif(r->>'provider','') as provider,
         nullif(r->>'provider_account','') as provider_account,
         coalesce(nullif(r->>'origin',''),'bank') as origin,
         case when nullif(r->>'external_id','') is not null and nullif(r->>'provider','') is not null
              then (r->>'provider') || ':' || coalesce(nullif(r->>'provider_account','') , '-') || ':' || (r->>'external_id')
         end as event_id,
         r as raw
    from jsonb_array_elements(p_rows) r;

  alter table _cand add column fp_strong text;
  update _cand c set fp_strong =
    case when c.account_id is not null then
      p_team::text || '|' || c.account_id::text || '|'
      || (c.occurred_on - date '2000-01-01')::text || '|'
      || c.amount::text || '|' || c.currency || '|'
      || case when c.type = 'income' then 'in' else 'out' end || '|'
      || coalesce(c.counterparty_id::text, '-') || '|'
      || public.bank_note_norm(c.note)
    end;

  if exists (select 1 from _cand c where c.account_id is not null
               and not exists (select 1 from accounts a where a.id = c.account_id and a.team_id = p_team)) then
    raise exception 'Счёт из другой команды' using errcode = '42501';
  end if;
  if exists (select 1 from _cand c where c.transfer_account_id is not null
               and not exists (select 1 from accounts a where a.id = c.transfer_account_id and a.team_id = p_team)) then
    raise exception 'Счёт зачисления из другой команды' using errcode = '42501';
  end if;

  -- 8.3 правило 1: событие провайдера уже импортировано
  create temporary table _dup_id on commit drop as
  select c.ord from _cand c
   where c.event_id is not null
     and exists (select 1 from transactions t where t.team_id = p_team and t.bank_event_id = c.event_id);
  select count(*) into _skipped_id from _dup_id;

  create temporary table _live on commit drop as
  select * from _cand where ord not in (select ord from _dup_id);

  -- 8.4 счётчики для проверки «сопоставление ровно 1:1»
  create temporary table _fp_stats on commit drop as
  select l.fp_strong,
         count(*)                                              as n_cand,
         count(*) filter (where l.event_id is not null)         as n_cand_with_id,
         (select count(*) from transactions t
            where t.team_id = p_team and t.bank_event_fp_strong = l.fp_strong)          as n_exist,
         (select count(*) from transactions t
            where t.team_id = p_team and t.bank_event_fp_strong = l.fp_strong
              and t.bank_event_id is null)                                             as n_exist_unidentified
    from _live l where l.fp_strong is not null
   group by l.fp_strong;

  -- 8.5 правило 2: повышение существующей CSV-строки до канонической банковской
  create temporary table _promote on commit drop as
  select l.ord, l.provider, l.provider_account, l.provider_tx_id,
         (select t.id from transactions t
           where t.team_id = p_team and t.bank_event_fp_strong = l.fp_strong
             and t.bank_event_id is null limit 1) as target
    from _live l join _fp_stats s on s.fp_strong = l.fp_strong
   where l.event_id is not null
     and s.n_cand_with_id = 1 and s.n_exist_unidentified = 1 and s.n_exist = 1;

  update transactions t
     set bank_provider = p.provider,
         bank_provider_account = p.provider_account,
         bank_provider_tx_id = p.provider_tx_id,
         origin = 'bank'
    from _promote p where t.id = p.target;
  select count(*) into _promoted from _promote;

  -- 8.6 правило 4: CSV-кандидат, событие уже учтено — единственное совпадение 1:1
  create temporary table _skip_fp on commit drop as
  select l.ord from _live l join _fp_stats s on s.fp_strong = l.fp_strong
   where l.event_id is null and s.n_cand = 1 and s.n_exist = 1;
  select count(*) into _skipped_fp from _skip_fp;

  -- журнал автоматических склеек: пропуск по отпечатку не должен быть молчаливым
  insert into bank_reconciliation_conflicts
    (team_id, kind, fp_strong, transaction_id, candidate, existing_ids, note, resolved_at)
  select p_team, 'auto_merged', l.fp_strong,
         (select t.id from transactions t
           where t.team_id = p_team and t.bank_event_fp_strong = l.fp_strong limit 1),
         l.raw,
         array(select t.id from transactions t
                where t.team_id = p_team and t.bank_event_fp_strong = l.fp_strong),
         'Кандидат без идентификатора провайдера совпал 1:1 с уже учтённым событием и не вставлялся',
         now()
    from _live l join _skip_fp k on k.ord = l.ord;

  -- 8.7 всё остальное вставляем; неоднозначные помечаем conflict
  insert into import_batches (team_id, created_by, file_name, account_id, bank, row_count, status, note)
  values (p_team, auth.uid(), coalesce(p_batch->>'file_name','Импорт'),
          nullif(p_batch->>'account_id','')::uuid, nullif(p_batch->>'bank',''),
          0, coalesce(nullif(p_batch->>'status',''),'imported'), nullif(p_batch->>'note',''))
  returning id into _batch;

  create temporary table _inserted_map on commit drop as
  with fresh as (
    select l.* from _live l
     where l.ord not in (select ord from _promote)
       and l.ord not in (select ord from _skip_fp)
  ), ins as (
    insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                              category_id, counterparty_id, project_id, occurred_on, note,
                              created_by, external_id, source, origin,
                              bank_provider, bank_provider_account, bank_provider_tx_id,
                              import_batch_id, status)
    select p_team, f.type, f.amount, f.currency, f.account_id, f.transfer_account_id,
           f.category_id, f.counterparty_id, f.project_id, f.occurred_on, f.note,
           auth.uid(), f.provider_tx_id, f.provider, f.origin,
           f.provider, f.provider_account, f.provider_tx_id,
           _batch, 'actual'
      from fresh f
    returning id, bank_event_fp_strong
  ) select id, bank_event_fp_strong as fp_strong from ins;
  select count(*) into _inserted from _inserted_map;

  -- conflict'ы: вставили, хотя совпадение по отпечатку было — но не 1:1
  with amb as (
    select l.ord, l.fp_strong, l.event_id, l.raw, s.n_cand, s.n_exist, s.n_exist_unidentified
      from _live l join _fp_stats s on s.fp_strong = l.fp_strong
     where l.ord not in (select ord from _promote)
       and l.ord not in (select ord from _skip_fp)
       and s.n_exist > 0
  ), ins as (
    insert into bank_reconciliation_conflicts
      (team_id, kind, fp_strong, import_batch_id, transaction_id, candidate, existing_ids, note)
    select p_team,
           case when a.event_id is not null then 'ambiguous_match' else 'ambiguous_duplicate' end,
           a.fp_strong, _batch,
           (select m.id from _inserted_map m where m.fp_strong = a.fp_strong limit 1),
           a.raw,
           array(select t.id from transactions t
                  where t.team_id = p_team and t.bank_event_fp_strong = a.fp_strong
                    and t.import_batch_id is distinct from _batch),
           'Совпадение по отпечатку не однозначно (кандидатов ' || a.n_cand
             || ', уже в базе ' || a.n_exist || '); операция сохранена, требуется сверка'
      from amb a
    returning id
  ) select count(*) into _conflicts from ins;

  if _inserted = 0 then
    delete from import_batches where id = _batch;
    _batch := null;
  else
    update import_batches set row_count = _inserted where id = _batch;
  end if;

  return public.op_finish(p_request_id, jsonb_build_object(
    'ok', true, 'batch_id', _batch, 'total', _total,
    'imported', _inserted,
    'skipped_by_event_id', _skipped_id,
    'skipped_by_fingerprint', _skipped_fp,
    'promoted', _promoted,
    'conflicts', _conflicts,
    'counterparties', _cp_created));
end $$;

do $$ begin
  execute 'grant execute on function public.bank_note_norm(text) to authenticated';
  execute 'grant execute on function public.is_service_role() to authenticated';
  execute 'grant execute on function public.bank_sync_claim(uuid, text, interval) to authenticated';
  execute 'grant execute on function public.bank_import_commit(uuid, jsonb, jsonb, jsonb, uuid) to authenticated';
end $$;
