-- Откат 0091. Возвращает NULL-семантику хелперов прав (то есть ВОЗВРАЩАЕТ
-- уязвимость SEC-008) — делать только вместе с отказом от 0091 целиком.
begin;

drop function if exists public.obligation_pay(uuid, uuid, bigint, date, text, uuid);
drop function if exists public.transaction_insert(jsonb, uuid);
drop function if exists public.transaction_delete(uuid, integer, uuid);
drop function if exists public.transactions_convert_to_transfer(uuid[], uuid, uuid, uuid);
drop function if exists public.transactions_bulk_patch(uuid[], jsonb, uuid);

drop index if exists public.transactions_recurring_slot_uniq;
drop index if exists public.project_periods_project_month_uniq;

-- ВНИМАНИЕ: возвращается прежнее (уязвимое) поведение — NULL для не-участника.
create or replace function public.can_edit_finance(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team_id) in ('owner','admin','manager') $$;
create or replace function public.can_write_tx(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team_id) in ('owner','admin','manager','employee') $$;
create or replace function public.can_manage_team(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.current_team_role(_team_id) in ('owner','admin') $$;

-- Снятые гранты anon/PUBLIC НЕ восстанавливаются намеренно: приложение их не
-- использует (проверено grep'ом), а возвращать их — значит возвращать риск.
commit;
