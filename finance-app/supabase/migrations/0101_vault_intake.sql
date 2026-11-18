-- ============================================================
-- 0101_vault_intake: «Запросить доступ у клиента».
--
-- Клиент получает одноразовую ссылку (по умолчанию 48 ч) и сам передаёт доступ.
-- Браузер клиента шифрует данные ОТКРЫТЫМ ключом команды (ECDH P-256 + AES-GCM),
-- сервер хранит только шифртекст. Закрытый ключ команды лежит в БД только
-- зашифрованным паролем владельца (PBKDF2 + AES-GCM, расшифровка в браузере).
-- Принять запрос (расшифровать и сохранить как обычную запись парольницы) может
-- владелец/админ, знающий пароль ключа.
--
-- Токен ссылки: 32 случайных байта; в БД — только SHA-256. Публичные функции
-- (intake_load / intake_submit) доступны anon и работают только по токену.
-- Журнал — в vault_access_log (новые действия intake_*), уведомления — в notifications.
-- ============================================================

-- ---- Запись парольницы получает привязку к контрагенту-клиенту ----
alter table public.vault_entries
  add column if not exists counterparty_id uuid references public.counterparties (id) on delete set null;
create index if not exists vault_entries_counterparty_idx on public.vault_entries (counterparty_id);

-- ---- Новые действия журнала и тип уведомления ----
alter table public.vault_access_log drop constraint if exists vault_access_log_action_check;
alter table public.vault_access_log add constraint vault_access_log_action_check
  check (action in ('reveal','create','update','delete','grant','revoke',
                    'intake_key','intake_create','intake_open','intake_submit',
                    'intake_revoke','intake_expire','intake_accept'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'cash_gap','debt_overdue','budget_over','transfer_short',
    'training_due','metric_missing','metric_below_plan',
    'vault_access_request','vault_intake'
  ));

-- ---- Ключ команды ----
create table if not exists public.vault_team_keys (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams (id) on delete cascade,
  public_key          text not null,   -- base64url, raw P-256 (65 байт)
  wrapped_private_key jsonb not null,  -- {v,kdf,hash,iter,salt,iv,ct}: pkcs8 под паролем
  active              boolean not null default true,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  check (length(public_key) between 80 and 100)
);
create unique index if not exists vault_team_keys_one_active
  on public.vault_team_keys (team_id) where active;

-- ---- Запросы клиентам ----
create table if not exists public.vault_intake_requests (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  counterparty_id uuid references public.counterparties (id) on delete set null,
  service_kind    text not null check (service_kind in ('amocrm','kommo','meta','google_ads','other')),
  service_label   text not null default '',
  client_name     text not null default '',
  requested_by    uuid references auth.users (id) on delete set null,
  requester_name  text not null default '',
  token_hash      bytea not null unique,
  key_id          uuid not null references public.vault_team_keys (id),
  status          text not null default 'pending'
                  check (status in ('pending','opened','submitted','accepted','revoked','expired')),
  expires_at      timestamptz not null,
  open_count      integer not null default 0,
  opened_at       timestamptz,
  submitted_at    timestamptz,
  payload_cipher  text,
  user_added      boolean not null default false,
  fallback_used   boolean not null default false,
  extras_count    integer not null default 0 check (extras_count between 0 and 10),
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  entry_id        uuid references public.vault_entries (id) on delete set null,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  check (length(service_label) <= 120 and length(client_name) <= 120)
);
create index if not exists vault_intake_team_idx on public.vault_intake_requests (team_id, created_at desc);
create index if not exists vault_intake_open_idx on public.vault_intake_requests (expires_at)
  where status in ('pending','opened','submitted');

-- ============================================================
-- RLS: таблицы читаются напрямую только участниками с правами;
-- все изменения — только через функции ниже (политик на запись нет).
-- ============================================================
alter table public.vault_team_keys enable row level security;
drop policy if exists vault_team_keys_select on public.vault_team_keys;
-- обёрнутый закрытый ключ читают только владелец/админ (менеджеру он не нужен, а перебор
-- пароля офлайн — лишний риск); менеджеру — только факт наличия ключа (vault_team_has_key)
create policy vault_team_keys_select on public.vault_team_keys for select
  using (public.can_manage_team(team_id));

alter table public.vault_intake_requests enable row level security;
drop policy if exists vault_intake_select on public.vault_intake_requests;
create policy vault_intake_select on public.vault_intake_requests for select
  using (public.can_edit_finance(team_id));

-- Только чтение и только нужных колонок: шифртекст и хеш токена напрямую не отдаются никому
-- (шифртекст владельцу/админу — через vault_intake_payload). TRUNCATE/REFERENCES/TRIGGER — нет.
revoke all on public.vault_team_keys, public.vault_intake_requests from public, anon, authenticated;
grant select on public.vault_team_keys to authenticated;
grant select (id, team_id, project_id, counterparty_id, service_kind, service_label, client_name,
              requested_by, requester_name, key_id, status, expires_at, open_count, opened_at,
              submitted_at, user_added, fallback_used, extras_count, accepted_at, accepted_by,
              entry_id, closed_at, created_at)
  on public.vault_intake_requests to authenticated;

-- ============================================================
-- Внутренние помощники (не вызываются клиентом).
-- ============================================================
create or replace function public.vault_intake_hash(_token text)
returns bytea
language sql immutable set search_path = public, extensions
as $$ select extensions.digest(convert_to(_token, 'UTF8'), 'sha256') $$;

-- Уведомление: автору запроса + владельцам/админам команды.
create or replace function public.vault_intake_notify(_req public.vault_intake_requests, _event text, _body text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (team_id, user_id, type, severity, title, body, link, dedupe_key)
  select _req.team_id, u.user_id, 'vault_intake',
         case when _event = 'submit' then 'warning' else 'info' end,
         case _event when 'submit' then 'Клиент передал доступ'
                     when 'open'   then 'Клиент открыл ссылку на передачу доступа'
                     else 'Запрос доступа у клиента' end,
         _body, '/vault?tab=intake',
         'vault_intake:' || _req.id::text || ':' || _event
  from (
    select tm.user_id from public.team_members tm
     where tm.team_id = _req.team_id and tm.role in ('owner','admin')
    union
    select _req.requested_by where _req.requested_by is not null
  ) u
  where exists (select 1 from public.team_members m where m.team_id = _req.team_id and m.user_id = u.user_id)
  on conflict (user_id, dedupe_key)
  do update set read_at = null, created_at = now(), body = excluded.body;
end;
$$;

create or replace function public.vault_intake_log(_req public.vault_intake_requests, _action text, _extra jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
  values (_req.team_id, _req.entry_id, auth.uid(), _action,
          jsonb_build_object('request_id', _req.id, 'service', _req.service_kind,
                             'label', _req.service_label, 'client', _req.client_name) || _extra);
$$;

create or replace function public.vault_intake_service_title(_kind text, _label text)
returns text
language sql immutable
as $$
  select case
    when nullif(trim(_label), '') is not null then trim(_label)
    when _kind = 'amocrm' then 'amoCRM'
    when _kind = 'kommo' then 'Kommo'
    when _kind = 'meta' then 'Meta Business'
    when _kind = 'google_ads' then 'Google Ads'
    else 'Сервис' end
$$;

-- ============================================================
-- Ключ команды: создать/заменить (владелец/админ). Старый ключ остаётся
-- для расшифровки уже отправленных запросов, новые запросы — на новом.
-- ============================================================
create or replace function public.vault_team_key_set(_team_id uuid, _public_key text, _wrapped jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _id uuid;
begin
  if not coalesce(public.can_manage_team(_team_id), false) then
    raise exception 'Нет доступа';
  end if;
  if _public_key !~ '^[A-Za-z0-9_-]{80,100}$' then
    raise exception 'Неверный открытый ключ';
  end if;
  if coalesce(_wrapped ->> 'v', '') <> '1' or (_wrapped ->> 'ct') is null
     or (_wrapped ->> 'salt') is null or (_wrapped ->> 'iv') is null
     or coalesce((_wrapped ->> 'iter')::int, 0) < 310000 then
    raise exception 'Неверный формат закрытого ключа';
  end if;

  update public.vault_team_keys set active = false where team_id = _team_id and active;
  insert into public.vault_team_keys (team_id, public_key, wrapped_private_key, created_by)
  values (_team_id, _public_key, _wrapped, auth.uid())
  returning id into _id;

  insert into public.vault_access_log (team_id, user_id, action, details)
  values (_team_id, auth.uid(), 'intake_key', jsonb_build_object('key_id', _id));
  return _id;
end;
$$;

-- Есть ли у команды активный ключ (для кнопки «Запросить доступ» у менеджеров).
create or replace function public.vault_team_has_key(_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.can_edit_finance(_team_id), false)
     and exists (select 1 from public.vault_team_keys k where k.team_id = _team_id and k.active)
$$;

-- ============================================================
-- Создать запрос (менеджер+). Возвращает токен ОДИН раз.
-- ============================================================
create or replace function public.vault_intake_create(
  _team_id uuid, _service_kind text, _service_label text,
  _project_id uuid, _counterparty_id uuid, _client_name text, _ttl_hours integer default 48)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  _key   uuid;
  _tok   text;
  _who   text;
  _req   public.vault_intake_requests;
  _cname text := left(trim(coalesce(_client_name, '')), 120);
begin
  if not coalesce(public.can_edit_finance(_team_id), false) then
    raise exception 'Нет доступа';
  end if;
  if _ttl_hours is null or _ttl_hours < 1 or _ttl_hours > 168 then
    raise exception 'Срок ссылки — от 1 до 168 часов';
  end if;
  select k.id into _key from public.vault_team_keys k where k.team_id = _team_id and k.active;
  if _key is null then
    raise exception 'Сначала владелец должен создать ключ команды';
  end if;
  if _project_id is not null and not exists (
       select 1 from public.projects p where p.id = _project_id and p.team_id = _team_id) then
    raise exception 'Проект не найден';
  end if;
  if _counterparty_id is not null then
    if not exists (select 1 from public.counterparties c where c.id = _counterparty_id and c.team_id = _team_id) then
      raise exception 'Контрагент не найден';
    end if;
    if _cname = '' then
      select left(c.name, 120) into _cname from public.counterparties c where c.id = _counterparty_id;
    end if;
  end if;
  if _cname = '' and _project_id is not null then
    select left(p.name, 120) into _cname from public.projects p where p.id = _project_id;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'Менеджер KO') into _who
  from public.profiles p where p.id = auth.uid();

  -- 32 байта → base64url без «=» (43 символа)
  _tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.vault_intake_requests (
    team_id, project_id, counterparty_id, service_kind, service_label, client_name,
    requested_by, requester_name, token_hash, key_id, expires_at)
  values (
    _team_id, _project_id, _counterparty_id, _service_kind, left(trim(coalesce(_service_label, '')), 120),
    _cname, auth.uid(), coalesce(_who, 'Менеджер KO'), public.vault_intake_hash(_tok), _key,
    now() + make_interval(hours => _ttl_hours))
  returning * into _req;

  perform public.vault_intake_log(_req, 'intake_create', jsonb_build_object('expires_at', _req.expires_at));

  id := _req.id; token := _tok; expires_at := _req.expires_at;
  return next;
end;
$$;

-- ============================================================
-- Отозвать запрос (менеджер+). Отправленный, но не принятый — тоже можно
-- (шифртекст удаляется).
-- ============================================================
create or replace function public.vault_intake_revoke(_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  _req public.vault_intake_requests;
begin
  select * into _req from public.vault_intake_requests r where r.id = _id for update;
  if _req.id is null or not coalesce(public.can_edit_finance(_req.team_id), false) then
    raise exception 'Запрос не найден';
  end if;
  if _req.status not in ('pending','opened','submitted') then
    raise exception 'Запрос уже закрыт';
  end if;
  update public.vault_intake_requests
     set status = 'revoked', payload_cipher = null, closed_at = now()
   where vault_intake_requests.id = _id
  returning * into _req;
  perform public.vault_intake_log(_req, 'intake_revoke');
end;
$$;

-- ============================================================
-- Истечение: открытые ссылки после срока; отправленные, но не принятые
-- за 7 дней — шифртекст удаляется. Вызывается кроном (service_role)
-- и лениво из публичных функций.
-- ============================================================
create or replace function public.vault_intake_expire()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  _req public.vault_intake_requests;
  _n   integer := 0;
begin
  for _req in
    update public.vault_intake_requests
       set status = 'expired', payload_cipher = null, closed_at = now()
     where (status in ('pending','opened') and expires_at < now())
        or (status = 'submitted' and submitted_at < now() - interval '7 days')
    returning *
  loop
    perform public.vault_intake_log(_req, 'intake_expire');
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

-- ============================================================
-- Публично: открыть ссылку. Возвращает только то, что нужно странице.
-- ============================================================
create or replace function public.vault_intake_load(_token text, _client jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  _req  public.vault_intake_requests;
  _pub  text;
  _team text;
  _first boolean;
begin
  if _token is null or _token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into _req from public.vault_intake_requests r
   where r.token_hash = public.vault_intake_hash(_token) for update;
  if _req.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if _req.status in ('pending','opened') and _req.expires_at < now() then
    update public.vault_intake_requests
       set status = 'expired', closed_at = now()
     where id = _req.id returning * into _req;
    perform public.vault_intake_log(_req, 'intake_expire');
  end if;
  if _req.status in ('submitted','accepted') then
    return jsonb_build_object('status', 'used');
  elsif _req.status in ('revoked','expired') then
    return jsonb_build_object('status', _req.status);
  end if;

  _first := _req.open_count = 0;
  update public.vault_intake_requests
     set status = 'opened', open_count = open_count + 1, opened_at = coalesce(opened_at, now())
   where id = _req.id returning * into _req;
  -- журнал: первые 20 открытий (счётчик растёт дальше) — чтобы ссылку нельзя было накрутить
  if _req.open_count <= 20 then
  perform public.vault_intake_log(_req, 'intake_open',
    jsonb_build_object('n', _req.open_count,
                       'ip_hash', left(coalesce(_client ->> 'ip_hash', ''), 64),
                       'ua', left(coalesce(_client ->> 'ua', ''), 160)));
  end if;
  if _first then
    perform public.vault_intake_notify(_req, 'open',
      coalesce(nullif(_req.client_name, ''), 'Клиент') || ' открыл ссылку: ' ||
      public.vault_intake_service_title(_req.service_kind, _req.service_label));
  end if;

  select k.public_key into _pub from public.vault_team_keys k where k.id = _req.key_id;
  select t.name into _team from public.teams t where t.id = _req.team_id;

  return jsonb_build_object(
    'status', 'ok',
    'request_id', _req.id,
    'first_open', _first,
    'service_kind', _req.service_kind,
    'service_label', _req.service_label,
    'client_name', _req.client_name,
    'requester_name', _req.requester_name,
    'team_name', _team,
    'expires_at', _req.expires_at,
    'key_id', _req.key_id,
    'public_key', _pub);
end;
$$;

-- ============================================================
-- Публично: отправить шифртекст. Только один раз, только до срока.
-- ============================================================
create or replace function public.vault_intake_submit(
  _token text, _payload text, _user_added boolean, _fallback boolean, _client jsonb default '{}'::jsonb,
  _extras_count integer default 0)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  _req public.vault_intake_requests;
  _p   jsonb;
begin
  if _token is null or _token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into _req from public.vault_intake_requests r
   where r.token_hash = public.vault_intake_hash(_token) for update;
  if _req.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if _req.status in ('submitted','accepted') then
    return jsonb_build_object('status', 'used');
  elsif _req.status in ('revoked','expired') then
    return jsonb_build_object('status', _req.status);
  elsif _req.expires_at < now() then
    update public.vault_intake_requests set status = 'expired', closed_at = now()
     where id = _req.id returning * into _req;
    perform public.vault_intake_log(_req, 'intake_expire');
    return jsonb_build_object('status', 'expired');
  end if;

  -- Формат шифртекста: {"v":1,"kid":"<key_id>","epk":…,"iv":…,"ct":…}
  if _payload is null or length(_payload) < 100 or length(_payload) > 80000
     or coalesce(_extras_count, 0) not between 0 and 10 then
    return jsonb_build_object('status', 'bad_payload');
  end if;
  begin
    _p := _payload::jsonb;
  exception when others then
    return jsonb_build_object('status', 'bad_payload');
  end;
  if coalesce(_p ->> 'v', '') <> '1' or coalesce(_p ->> 'kid', '') <> _req.key_id::text
     or (_p ->> 'epk') is null or (_p ->> 'iv') is null or (_p ->> 'ct') is null then
    return jsonb_build_object('status', 'bad_payload');
  end if;

  update public.vault_intake_requests
     set status = 'submitted', submitted_at = now(), payload_cipher = _payload,
         user_added = coalesce(_user_added, false), fallback_used = coalesce(_fallback, false),
         extras_count = coalesce(_extras_count, 0)
   where id = _req.id returning * into _req;
  perform public.vault_intake_log(_req, 'intake_submit',
    jsonb_build_object('user_added', _req.user_added, 'fallback', _req.fallback_used, 'extras', _req.extras_count,
                       'ip_hash', left(coalesce(_client ->> 'ip_hash', ''), 64)));
  perform public.vault_intake_notify(_req, 'submit',
    coalesce(nullif(_req.client_name, ''), 'Клиент') || ' передал доступ: ' ||
    public.vault_intake_service_title(_req.service_kind, _req.service_label) ||
    case when _req.user_added and not _req.fallback_used then ' (добавил нас пользователем)' else '' end ||
    case when _req.extras_count > 0 then ' и ещё ' || _req.extras_count || ' доступ(а) сам' else '' end ||
    '. Примите запись в разделе «Пароли».');

  return jsonb_build_object('status', 'ok', 'request_id', _req.id);
end;
$$;

-- ============================================================
-- Принять (владелец/админ): браузер расшифровал данные; секрет уже
-- зашифрован сервером ключом VAULT_KEY (как при обычном создании записи).
-- Создаёт запись парольницы, привязанную к проекту и контрагенту.
-- ============================================================
create or replace function public.vault_intake_accept(
  _id uuid, _title text, _login text, _url text, _note text, _secret_cipher text, _group_name text,
  _extra jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _req   public.vault_intake_requests;
  _entry uuid;
  _x     jsonb;
  _n     integer := 0;
begin
  select * into _req from public.vault_intake_requests r where r.id = _id for update;
  if _req.id is null or not coalesce(public.can_manage_team(_req.team_id), false) then
    raise exception 'Запрос не найден';
  end if;
  if _req.status <> 'submitted' then
    raise exception 'Запрос не ожидает приёма';
  end if;
  if nullif(trim(coalesce(_title, '')), '') is null then
    raise exception 'Укажите название';
  end if;
  if jsonb_typeof(coalesce(_extra, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(_extra, '[]'::jsonb)) > 10 then
    raise exception 'Дополнительных доступов — не больше 10';
  end if;

  insert into public.vault_entries (team_id, title, login, url, note, secret_cipher, group_name,
                                    project_id, counterparty_id, created_by)
  values (_req.team_id, trim(_title), trim(coalesce(_login, '')), trim(coalesce(_url, '')),
          trim(coalesce(_note, '')), nullif(_secret_cipher, ''), trim(coalesce(_group_name, '')),
          _req.project_id, _req.counterparty_id, auth.uid())
  returning id into _entry;

  -- дополнительные доступы, которые клиент добавил сам: отдельные записи с той же привязкой
  for _x in select value from jsonb_array_elements(coalesce(_extra, '[]'::jsonb))
  loop
    if nullif(trim(coalesce(_x ->> 'title', '')), '') is null then
      raise exception 'Укажите название для каждого дополнительного доступа';
    end if;
    insert into public.vault_entries (team_id, title, login, url, note, secret_cipher, group_name,
                                      project_id, counterparty_id, created_by)
    values (_req.team_id, left(trim(_x ->> 'title'), 200), left(trim(coalesce(_x ->> 'login', '')), 300),
            left(trim(coalesce(_x ->> 'url', '')), 300), left(trim(coalesce(_x ->> 'note', '')), 4000),
            nullif(_x ->> 'secret_cipher', ''), trim(coalesce(_group_name, '')),
            _req.project_id, _req.counterparty_id, auth.uid());
    _n := _n + 1;
  end loop;

  update public.vault_intake_requests
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(),
         entry_id = _entry, payload_cipher = null, closed_at = now()
   where id = _id returning * into _req;
  perform public.vault_intake_log(_req, 'intake_accept', jsonb_build_object('extra_entries', _n));

  -- уведомления «клиент передал доступ» по этому запросу больше не актуальны
  update public.notifications set read_at = coalesce(read_at, now())
   where dedupe_key in ('vault_intake:' || _id::text || ':submit', 'vault_intake:' || _id::text || ':open');
  return _entry;
end;
$$;

-- Шифртекст запроса — только владельцу/админу (тем, кто может принять).
create or replace function public.vault_intake_payload(_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select r.payload_cipher from public.vault_intake_requests r
   where r.id = _id and r.status = 'submitted'
     and coalesce(public.can_manage_team(r.team_id), false)
$$;

-- ============================================================
-- Справочник записей: + контрагент. Тип результата меняется → drop/create.
-- ============================================================
drop function if exists public.vault_directory(uuid);
create function public.vault_directory(_team_id uuid)
returns table (
  id                uuid,
  title             text,
  login             text,
  url               text,
  note              text,
  group_name        text,
  project_id        uuid,
  project_name      text,
  counterparty_id   uuid,
  counterparty_name text,
  has_secret        boolean,
  can_reveal        boolean,
  can_manage        boolean,
  created_by        uuid,
  updated_at        timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    e.id,
    e.title,
    case when f.rv or f.mg then e.login else '' end,
    case when f.rv or f.mg then e.url   else '' end,
    case when f.rv or f.mg then e.note  else '' end,
    e.group_name,
    e.project_id,
    p.name,
    e.counterparty_id,
    c.name,
    (e.secret_cipher is not null),
    f.rv,
    f.mg,
    case when f.rv or f.mg then e.created_by else null end,
    e.updated_at
  from public.vault_entries e
  left join public.projects p on p.id = e.project_id
  left join public.counterparties c on c.id = e.counterparty_id
  cross join lateral (
    select public.vault_can_reveal(e.id) as rv,
           public.can_edit_finance(e.team_id) as mg
  ) f
  where e.team_id = _team_id
    and public.is_team_member(_team_id)
  order by (nullif(e.group_name, '') is null), lower(e.group_name), lower(e.title);
$$;

-- ============================================================
-- Права на функции. Новые функции по умолчанию исполняемы PUBLIC/anon —
-- закрываем всё и открываем точечно.
-- ============================================================
revoke execute on function public.vault_intake_hash(text) from public, anon, authenticated;
revoke execute on function public.vault_intake_notify(public.vault_intake_requests, text, text) from public, anon, authenticated;
revoke execute on function public.vault_intake_log(public.vault_intake_requests, text, jsonb) from public, anon, authenticated;
revoke execute on function public.vault_intake_service_title(text, text) from public, anon, authenticated;
revoke execute on function public.vault_intake_expire() from public, anon, authenticated;
grant  execute on function public.vault_intake_expire() to service_role;

revoke execute on function public.vault_team_key_set(uuid, text, jsonb) from public, anon;
revoke execute on function public.vault_team_has_key(uuid) from public, anon;
revoke execute on function public.vault_intake_payload(uuid) from public, anon;
grant  execute on function public.vault_intake_payload(uuid) to authenticated;
grant  execute on function public.vault_team_has_key(uuid) to authenticated;
revoke execute on function public.vault_intake_create(uuid, text, text, uuid, uuid, text, integer) from public, anon;
revoke execute on function public.vault_intake_revoke(uuid) from public, anon;
revoke execute on function public.vault_intake_accept(uuid, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.vault_directory(uuid) from public, anon;
grant  execute on function public.vault_team_key_set(uuid, text, jsonb) to authenticated;
grant  execute on function public.vault_intake_create(uuid, text, text, uuid, uuid, text, integer) to authenticated;
grant  execute on function public.vault_intake_revoke(uuid) to authenticated;
grant  execute on function public.vault_intake_accept(uuid, text, text, text, text, text, text, jsonb) to authenticated;
grant  execute on function public.vault_directory(uuid) to authenticated;

-- Публичные — только эти две, работают исключительно по токену.
revoke execute on function public.vault_intake_load(text, jsonb) from public;
revoke execute on function public.vault_intake_submit(text, text, boolean, boolean, jsonb, integer) from public;
grant  execute on function public.vault_intake_load(text, jsonb) to anon, authenticated;
grant  execute on function public.vault_intake_submit(text, text, boolean, boolean, jsonb, integer) to anon, authenticated;
