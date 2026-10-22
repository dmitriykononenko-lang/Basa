-- ============================================================
-- 0057_fix_duplicate_project_bonus: убираем задвоение бонуса по проекту.
--
-- Проблема: у части проектов бонус заведён вручную/импортом как обязательство
-- «Бонус за проект» (pay_part='variable', source_project_id IS NULL) и уже выплачен.
-- При переводе проекта в «Сдан» триггер accrue_project_bonus() дополнительно
-- создавал авто-бонус «Бонус за сдачу проекта» (source_project_id = проект,
-- сумма с учётом мотивации) — идемпотентность 0038 ловила дубль только по
-- source_project_id и «ручной» бонус (NULL) не видела. Итог: два начисления на
-- один проект (полная сумма + урезанная мотивацией).
--
-- Политика: ручной бонус по проекту — единственный источник истины. Если он есть,
-- авто-бонус «за сдачу» не создаётся, а ранее созданный неоплаченный авто-дубль
-- удаляется. Авто-механизм с мотивацией продолжает работать для проектов БЕЗ
-- ручного бонуса (новые проекты/сотрудники) — без изменений в поведении.
-- Авто-строки — производные данные: при необходимости пересоздаются вызовом
-- accrue_project_bonus(project_id), поэтому удаление неоплаченных дублей обратимо.
-- ============================================================

create or replace function public.accrue_project_bonus(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pr record; eff_due date; overrun int; pct numeric; amt bigint;
  has_manual_bonus boolean;
begin
  select * into pr from public.projects where id = p_project;
  if not found then return; end if;

  -- Уже есть «ручной» бонус по проекту (импорт/ввод вручную, без source_project_id)?
  select exists(
    select 1 from public.obligations o
    where o.project_id = p_project
      and o.type = 'payable'
      and o.pay_part = 'variable'
      and o.source_project_id is null
      and (o.note ilike '%бонус%' or o.note ilike '%преми%')
  ) into has_manual_bonus;

  -- Если ручной бонус есть — он единственный источник истины: авто-бонус не заводим
  -- и убираем ранее созданный авто-дубль (только неоплаченный, чтобы не трогать выплаты).
  if has_manual_bonus then
    delete from public.obligations o
    where o.source_project_id = p_project
      and not exists (
        select 1 from public.obligation_payments op where op.obligation_id = o.id
      );
    return;
  end if;

  if pr.status = 'done' and pr.responsible_counterparty_id is not null and pr.bonus_amount > 0 then
    eff_due := coalesce(pr.due_date, public.business_day_add(pr.start_date, pr.plan_work_days));
    if eff_due is null or pr.completed_on is null then
      overrun := 0;
    else
      overrun := greatest(0, public.business_days(eff_due, pr.completed_on));
    end if;
    select percent into pct from public.project_bonus_tiers
      where team_id = pr.team_id and max_overrun_wd >= overrun
      order by max_overrun_wd asc limit 1;
    if pct is null then pct := 100; end if;
    amt := round(pr.bonus_amount * pct / 100.0);

    if amt <= 0 then
      delete from public.obligations where source_project_id = p_project;
    else
      insert into public.obligations(team_id, counterparty_id, type, amount, currency, project_id,
        due_date, period_month, pay_part, status, note, source_project_id)
      values (pr.team_id, pr.responsible_counterparty_id, 'payable', amt, pr.bonus_currency, pr.id,
        pr.completed_on, date_trunc('month', coalesce(pr.completed_on, current_date))::date,
        'variable', 'open', 'Бонус за сдачу проекта', pr.id)
      on conflict (source_project_id) where source_project_id is not null
      do update set counterparty_id = excluded.counterparty_id,
                    amount = excluded.amount,
                    currency = excluded.currency,
                    project_id = excluded.project_id,
                    due_date = excluded.due_date,
                    period_month = excluded.period_month,
                    note = excluded.note;
    end if;
  else
    delete from public.obligations where source_project_id = p_project;
  end if;
end;
$$;

revoke all on function public.accrue_project_bonus(uuid) from public, anon, authenticated;

-- ── Разовая чистка уже образовавшихся авто-дублей ──
-- Удаляем авто-бонусы «за сдачу» (source_project_id задан, без выплат) по проектам,
-- где уже есть ручной бонус. Так на проекте остаётся ровно одно начисление.
delete from public.obligations a
where a.source_project_id is not null
  and not exists (
    select 1 from public.obligation_payments op where op.obligation_id = a.id
  )
  and exists (
    select 1 from public.obligations m
    where m.project_id = a.project_id
      and m.type = 'payable'
      and m.pay_part = 'variable'
      and m.source_project_id is null
      and (m.note ilike '%бонус%' or m.note ilike '%преми%')
  );
