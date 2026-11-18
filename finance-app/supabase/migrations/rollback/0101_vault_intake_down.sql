-- ============================================================
-- Откат 0101_vault_intake. ВНИМАНИЕ: удаляет запросы клиентам, ключ команды
-- и привязку записей к контрагенту. Принятые записи парольницы остаются.
-- Перед применением сверить с текущим production (уроки: откат пишется против прода).
-- ============================================================
begin;

drop function if exists public.vault_intake_load(text, jsonb);
drop function if exists public.vault_intake_submit(text, text, boolean, boolean, jsonb, integer);
drop function if exists public.vault_intake_accept(uuid, text, text, text, text, text, text, jsonb);
drop function if exists public.vault_intake_revoke(uuid);
drop function if exists public.vault_intake_create(uuid, text, text, uuid, uuid, text, integer);
drop function if exists public.vault_intake_expire();
drop function if exists public.vault_team_has_key(uuid);
drop function if exists public.vault_team_key_set(uuid, text, jsonb);
drop function if exists public.vault_intake_notify(public.vault_intake_requests, text, text);
drop function if exists public.vault_intake_log(public.vault_intake_requests, text, jsonb);
drop function if exists public.vault_intake_service_title(text, text);
drop function if exists public.vault_intake_hash(text);

drop table if exists public.vault_intake_requests;
drop table if exists public.vault_team_keys;

delete from public.notifications where type = 'vault_intake';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'cash_gap','debt_overdue','budget_over','transfer_short',
    'training_due','metric_missing','metric_below_plan',
    'vault_access_request'
  ));

-- журнал неизменяемый по смыслу, но старое ограничение не допускает intake_* —
-- такие строки удаляются (их суть сохранена в принятых записях)
delete from public.vault_access_log where action like 'intake_%';
alter table public.vault_access_log drop constraint if exists vault_access_log_action_check;
alter table public.vault_access_log add constraint vault_access_log_action_check
  check (action in ('reveal','create','update','delete','grant','revoke'));

drop function if exists public.vault_directory(uuid);
create function public.vault_directory(_team_id uuid)
returns table (
  id           uuid,
  title        text,
  login        text,
  url          text,
  note         text,
  group_name   text,
  project_id   uuid,
  project_name text,
  has_secret   boolean,
  can_reveal   boolean,
  can_manage   boolean,
  created_by   uuid,
  updated_at   timestamptz
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
    (e.secret_cipher is not null),
    f.rv,
    f.mg,
    case when f.rv or f.mg then e.created_by else null end,
    e.updated_at
  from public.vault_entries e
  left join public.projects p on p.id = e.project_id
  cross join lateral (
    select public.vault_can_reveal(e.id) as rv,
           public.can_edit_finance(e.team_id) as mg
  ) f
  where e.team_id = _team_id
    and public.is_team_member(_team_id)
  order by (nullif(e.group_name, '') is null), lower(e.group_name), lower(e.title);
$$;
revoke execute on function public.vault_directory(uuid) from public, anon;
grant execute on function public.vault_directory(uuid) to authenticated;

drop index if exists public.vault_entries_counterparty_idx;
alter table public.vault_entries drop column if exists counterparty_id;

commit;
