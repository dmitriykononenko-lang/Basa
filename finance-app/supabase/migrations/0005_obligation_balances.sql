-- ============================================================
-- 0005_obligation_balances: остаток по обязательствам
-- (сумма обязательства минус погашения)
-- ============================================================

create or replace view public.obligation_balances as
select
  o.id,
  o.team_id,
  o.counterparty_id,
  o.type,
  o.amount,
  o.currency,
  o.project_id,
  o.due_date,
  o.status,
  o.note,
  o.created_at,
  coalesce(sum(p.amount), 0)::bigint               as paid,
  (o.amount - coalesce(sum(p.amount), 0))::bigint  as outstanding
from public.obligations o
left join public.obligation_payments p on p.obligation_id = o.id
where public.is_team_member(o.team_id)
group by o.id;

grant select on public.obligation_balances to authenticated;
