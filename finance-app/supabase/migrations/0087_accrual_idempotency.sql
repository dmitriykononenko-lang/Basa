-- ============================================================
-- 0087_accrual_idempotency — шаг 2 REMEDIATION_PLAN (T1, CRITICAL)
-- Проблема: materialize_auto_accruals()/materialize_support_cycles() вызывались
-- при GET-рендере /payroll и работали по схеме «if not exists → insert» без
-- уникального индекса. Два параллельных рендера давали двойное начисление ЗП
-- (доказано тестом T1).
-- Здесь — серверная часть: идемпотентность и сериализация.
-- Клиентская часть (страница становится read-only, начисление — только явной
-- командой POST /api/payroll/materialize) — в коде приложения.
-- ============================================================

-- ─── 1. Дискриминатор происхождения начисления ──────────────────────────────
-- Нужен, чтобы уникальный индекс защищал авто-начисления, не мешая законному
-- ручному начислению за тот же месяц (в проде такая пара уже есть).
do $$ begin
  alter table public.obligations
    add column origin text not null default 'manual'
    check (origin in ('manual','auto','system'));
exception when duplicate_column then null; end $$;

-- Backfill консервативный: 'auto' — только то, что создаёт сама функция
-- (маркер «(авто)» в note); 'system' — производные записи (комиссии, бонусы).
update public.obligations set origin = 'system'
 where origin = 'manual' and (source_transaction_id is not null or source_project_id is not null);
update public.obligations set origin = 'auto'
 where origin = 'manual' and coalesce(note,'') like '%(авто)%';

-- due_date входит в ключ намеренно: за текущий месяц функция создаёт ДВЕ
-- законные строки — аванс (25-е) и остаток (15-е следующего месяца). Без
-- due_date индекс склеил бы их в один ключ и «остаток» терялся бы.
create unique index if not exists obligations_auto_accrual_uniq
  on public.obligations (counterparty_id, type, pay_part, period_month, due_date)
  where origin = 'auto' and period_month is not null and pay_part is not null;

-- ─── 2. Идемпотентность и сериализация прогона ──────────────────────────────
-- На случай, если в окружении осталась перегрузка с дополнительным аргументом
-- (в production её нет; в тестовой схеме она используется для pre-режима):
-- иначе вызов с одним аргументом станет неоднозначным.
drop function if exists public.materialize_auto_accruals(uuid, int);
-- Бизнес-правило сохранено: если за месяц уже есть ЛЮБОЕ fixed-начисление
-- (в т.ч. ручное) — авто-начисление не создаётся. Изменилось то, как это
-- обеспечивается: advisory-lock на команду сериализует прогоны, insert
-- выполняется одним оператором с on conflict do nothing.
create or replace function public.materialize_auto_accruals(p_team uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_created int := 0;
  v_cur_month date := date_trunc('month', current_date)::date;
  v_last_month date;
  emp record;
  m date;
  rate record;
  v_adv bigint;
  v_fin bigint;
  v_adv_due date;
  v_fin_due date;
begin
  if not coalesce(public.can_edit_finance(p_team), false) then
    return 0;
  end if;

  -- Сериализация: второй одновременный прогон по этой же команде ждёт первый
  -- и затем видит его результат (лок держится до конца транзакции функции).
  perform pg_advisory_xact_lock(hashtext('accrual:' || p_team::text));

  for emp in
    select c.id, c.start_date, c.end_date, coalesce(c.advance_amount, 0) as advance_amount
    from public.counterparties c
    where c.team_id = p_team
      and c.auto_accrue = true
      and c.archived = false
      and exists (select 1 from public.employee_salaries s where s.counterparty_id = c.id)
  loop
    select greatest(
             date_trunc('month', coalesce(emp.start_date, '1900-01-01'::date)),
             (select date_trunc('month', min(s.effective_from)) from public.employee_salaries s where s.counterparty_id = emp.id)
           )::date
      into m;
    if m is null then continue; end if;

    v_last_month := least(v_cur_month, date_trunc('month', coalesce(emp.end_date, v_cur_month))::date);

    while m <= v_last_month loop
      select s.amount, s.currency into rate
      from public.employee_salaries s
      where s.counterparty_id = emp.id and s.effective_from <= m
      order by s.effective_from desc
      limit 1;

      if rate.amount is not null
         and not exists (
           select 1 from public.obligations o
           where o.counterparty_id = emp.id
             and o.type = 'payable'
             and o.pay_part = 'fixed'
             and o.period_month = m
         )
      then
        if m < v_cur_month then
          insert into public.obligations
            (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note, origin)
          values
            (p_team, emp.id, 'payable', rate.amount, rate.currency, m, m, 'fixed', 'open', 'Начисление ЗП (авто)', 'auto')
          on conflict do nothing;
          if found then v_created := v_created + 1; end if;
        else
          v_adv := least(emp.advance_amount, rate.amount);
          v_fin := rate.amount - v_adv;
          v_adv_due := make_date(extract(year from m)::int, extract(month from m)::int, 25);
          v_fin_due := make_date(extract(year from (m + interval '1 month'))::int,
                                 extract(month from (m + interval '1 month'))::int, 15);

          -- Аванс и остаток различаются по due_date — см. комментарий к индексу.
          if v_adv > 0 then
            insert into public.obligations
              (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note, origin)
            values
              (p_team, emp.id, 'payable', v_adv, rate.currency, v_adv_due, m, 'fixed', 'open', 'Начисление ЗП аванс (авто)', 'auto')
            on conflict do nothing;
            if found then v_created := v_created + 1; end if;
          end if;
          if v_fin > 0 then
            insert into public.obligations
              (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note, origin)
            values
              (p_team, emp.id, 'payable', v_fin, rate.currency, v_fin_due, m, 'fixed', 'open', 'Начисление ЗП остаток (авто)', 'auto')
            on conflict do nothing;
            if found then v_created := v_created + 1; end if;
          end if;
        end if;
      end if;

      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  return v_created;
end $$;

-- Тот же лок для материализации периодов поддержки (двойное открытие периода).
create or replace function public.materialize_support_cycles(p_team uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_created int := 0; pr record; v_last date; v_guard int;
begin
  if not coalesce(public.can_edit_finance(p_team), false) then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('support_cycles:' || p_team::text));

  for pr in
    select p.id
    from public.projects p
    where p.team_id = p_team
      and p.type = 'support'
      and p.status <> 'done'
      and p.archived = false
      and p.responsible_counterparty_id is not null
      and coalesce(p.bonus_amount, 0) > 0
      and exists (select 1 from public.project_periods pp where pp.project_id = p.id)
  loop
    v_guard := 0;
    loop
      select max(pp.period_end) into v_last
      from public.project_periods pp where pp.project_id = pr.id;
      exit when v_last is null or v_last >= current_date;
      exit when v_guard >= 24;
      perform public.support_open_period(pr.id);
      v_created := v_created + 1;
      v_guard := v_guard + 1;
    end loop;
  end loop;

  return v_created;
end $$;

-- Начисление вызывается только явной командой; анонимам не нужно.
revoke all on function public.materialize_auto_accruals(uuid) from public;
revoke all on function public.materialize_support_cycles(uuid) from public;
grant execute on function public.materialize_auto_accruals(uuid) to authenticated;
grant execute on function public.materialize_support_cycles(uuid) to authenticated;
