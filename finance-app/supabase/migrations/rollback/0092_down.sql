-- Откат 0092. Возвращает public.transaction_lines в состояние production до 0092.
-- Представление существовало в production и раньше (из дампа 2026-10-16), поэтому
-- откат его НЕ удаляет, а восстанавливает прежнее определение, владельца и гранты.
-- Откат 0092 делается ТОЛЬКО вместе с откатом приложения (SPLIT-01).
-- Данные при этом не затрагиваются: представление не хранит строк.
begin;
drop view if exists public.transaction_lines;
create view public.transaction_lines with (security_invoker='on') as
 select t.id as transaction_id,
    t.team_id,
    t.type,
    t.currency,
    t.status,
    t.occurred_on,
    t.accrual_date,
    t.account_id,
    coalesce(s.amount, t.amount) as amount,
    coalesce(s.category_id, t.category_id) as category_id,
    coalesce(s.project_id, t.project_id) as project_id,
    coalesce(s.counterparty_id, t.counterparty_id) as counterparty_id,
    (s.id is not null) as is_split,
    coalesce(s.note, t.note) as note
   from (public.transactions t
     left join public.transaction_splits s on ((s.transaction_id = t.id)));
alter view public.transaction_lines owner to postgres;
grant all on table public.transaction_lines to anon;
grant all on table public.transaction_lines to authenticated;
grant all on table public.transaction_lines to service_role;
commit;
