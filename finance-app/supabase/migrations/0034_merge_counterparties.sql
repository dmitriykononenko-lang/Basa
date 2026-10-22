-- ============================================================
-- 0034_merge_counterparties: объединение карточек контрагентов
-- ============================================================
-- Переносит все ссылки с дубля на основную карточку и удаляет дубль.

create or replace function public.merge_counterparties(p_target uuid, p_dup uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_team uuid; v_team_dup uuid;
begin
  if p_target = p_dup then return; end if;
  select team_id into v_team from public.counterparties where id = p_target;
  select team_id into v_team_dup from public.counterparties where id = p_dup;
  if v_team is null or v_team_dup is null then raise exception 'Контрагент не найден'; end if;
  if v_team <> v_team_dup then raise exception 'Разные команды'; end if;
  if not public.can_edit_finance(v_team) then raise exception 'Недостаточно прав'; end if;

  update public.transactions          set counterparty_id = p_target where counterparty_id = p_dup;
  update public.obligations           set counterparty_id = p_target where counterparty_id = p_dup;
  update public.agent_commission_rules set agent_id       = p_target where agent_id       = p_dup;
  update public.counterparties        set agent_id        = p_target where agent_id       = p_dup;
  update public.projects              set responsible_counterparty_id = p_target where responsible_counterparty_id = p_dup;
  update public.employee_salaries     set counterparty_id = p_target where counterparty_id = p_dup;
  update public.employee_positions    set counterparty_id = p_target where counterparty_id = p_dup;
  update public.recurring_rules       set counterparty_id = p_target where counterparty_id = p_dup;

  -- объединить статусы, заполнить пустые поля из дубля
  update public.counterparties t set
    kinds = (select array(select distinct e from unnest(coalesce(t.kinds,'{}') || coalesce(d.kinds,'{}')) e where e is not null and e <> '')
             from public.counterparties d where d.id = p_dup),
    inn = coalesce(t.inn, (select inn from public.counterparties where id = p_dup)),
    agent_id = coalesce(t.agent_id, (select agent_id from public.counterparties where id = p_dup))
  where t.id = p_target;

  delete from public.counterparties where id = p_dup;
end;
$$;
revoke all on function public.merge_counterparties(uuid, uuid) from public, anon;
grant execute on function public.merge_counterparties(uuid, uuid) to authenticated;
