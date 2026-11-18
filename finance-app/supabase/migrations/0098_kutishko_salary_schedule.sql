-- ============================================================
-- 0098_kutishko_salary_schedule — схема оплаты Станислава Кутишко: аванс + остаток
-- Решение Дмитрия 2026-10-22 («Да, применить»; по августу — «Начислить аванс, долг»).
-- Оклад 40 000,00 ₽/мес = аванс 15 000,00 (срок 25-е месяца) + остаток 25 000,00
-- (срок 15-е следующего месяца). Сотрудник: counterparty e922a1ca.
--
-- Что меняется (одна транзакция, guard на каждую строку):
--  1. counterparties e922a1ca: advance_amount 0 -> 1 500 000 (чтобы автоначисление
--     ноября создало аванс + остаток, а не одну строку 40 000).
--  2. employee_salaries: удалён дубль ставки 463145f8 (40 000 с 2025-11-17, создан 30.06);
--     остаётся 79cc4665 с той же ставкой.
--  3. Июль 2026: 44ea039e (15 000, manual) -> due 2026-07-25, «Начисление ЗП аванс»;
--     6d788d66 (25 000, auto) -> due 2026-08-15, «Начисление ЗП остаток (авто)».
--  4. Август 2026: c1133a2a (25 000, manual) -> due 2026-09-15, «Начисление ЗП остаток»;
--     новый аванс 439b8fd4 15 000, due 2026-08-25 (остаётся к выплате).
--  5. Октябрь 2026: 2d7408b1 (auto) 40 000 -> 25 000, «Начисление ЗП остаток (авто)»;
--     новый аванс 852da6f7 15 000, due 2026-10-25; погашение a0c85ef5 (15 000,
--     операция 853b635a от 08.10) перенесено с 2d7408b1 на новый аванс.
-- Итоги сотрудника: начислено 605 000,00 -> 620 000,00 (+15 000 за август),
-- погашено 571 868,18 без изменений, остаток 33 131,82 -> 48 131,82.
--
-- Триггеры: на obligations пользовательских триггеров нет; на counterparties —
-- только trg_client_agent_changed (UPDATE OF agent_id, здесь не срабатывает);
-- на obligation_payments — отложенный obligation_payments_cap_ck (проверит переплату
-- нового аванса на COMMIT). Уменьшение amount у 2d7408b1 этот триггер не проверяет —
-- переплату проверяем сами.
--
-- Архив до правок: obligations_removed (reason '0098 …', изменённые начисления),
-- employee_salaries_before_0098, obligation_payments_before_0098, counterparties_before_0098.
-- Проверка: select из obligations по counterparty e922a1ca, period_month 2026-07/08/10.
-- Откат: rollback/0098_down.sql (возвращает поля из архивов, удаляет авансы по id).
-- ============================================================

create table if not exists public.obligations_removed as
  select o.*, now() as archived_at, ''::text as reason from public.obligations o where false;
alter table public.obligations_removed enable row level security;
revoke all on public.obligations_removed from anon, authenticated, public;

create table if not exists public.employee_salaries_before_0098 as
  select s.*, now() as archived_at from public.employee_salaries s where false;
alter table public.employee_salaries_before_0098 enable row level security;
revoke all on public.employee_salaries_before_0098 from anon, authenticated, public;

create table if not exists public.obligation_payments_before_0098 as
  select p.*, now() as archived_at from public.obligation_payments p where false;
alter table public.obligation_payments_before_0098 enable row level security;
revoke all on public.obligation_payments_before_0098 from anon, authenticated, public;

create table if not exists public.counterparties_before_0098 as
  select c.*, now() as archived_at from public.counterparties c where false;
alter table public.counterparties_before_0098 enable row level security;
revoke all on public.counterparties_before_0098 from anon, authenticated, public;

do $$
declare
  cp   constant uuid := 'e922a1ca-3828-420a-99cf-b44e0169d249';
  team constant uuid := '468b62b2-227e-4021-9e56-379e4b9ca6de';
  o_jul_adv constant uuid := '44ea039e-dff9-4fda-816b-bf0ce97610bc';
  o_jul_fin constant uuid := '6d788d66-efd4-443f-9973-85ce93d4f61f';
  o_aug_fin constant uuid := 'c1133a2a-6462-4551-b788-a7f3992a0402';
  o_oct_fin constant uuid := '2d7408b1-1eba-4619-8236-762c22af43ea';
  o_aug_adv constant uuid := '439b8fd4-7791-4bbd-b6b8-985f511bf82b';  -- новый
  o_oct_adv constant uuid := '852da6f7-233b-4395-adc3-76bef8519abc';  -- новый
  sal_dup   constant uuid := '463145f8-7118-42f1-9365-3412f8a5cdba';
  sal_keep  constant uuid := '79cc4665-132d-4c7d-b15f-6e81854a6377';
  pay_mv    constant uuid := 'a0c85ef5-f3e2-4df1-bc8c-a389203e0c0f';
  n int;
  acc0 bigint; paid0 bigint; acc1 bigint; paid1 bigint;
  r record;
begin
  -- ---------- guards: исходное состояние ----------
  select count(*) into n from counterparties
   where id = cp and team_id = team and kind = 'employee' and auto_accrue
     and coalesce(advance_amount, 0) = 0;
  if n <> 1 then raise exception '0098: сотрудник не в ожидаемом состоянии (%)', n; end if;

  select count(*) into n from employee_salaries
   where counterparty_id = cp and id in (sal_dup, sal_keep)
     and effective_from = '2025-11-17' and amount = 4000000 and currency = 'RUB';
  if n <> 2 then raise exception '0098: ставки не в ожидаемом состоянии (%)', n; end if;
  if (select count(*) from employee_salaries where counterparty_id = cp) <> 2 then
    raise exception '0098: у сотрудника не 2 строки ставок';
  end if;

  select count(*) into n from obligations
   where counterparty_id = cp and team_id = team and type = 'payable' and currency = 'RUB'
     and pay_part = 'fixed' and status = 'open' and (
          (id = o_jul_adv and amount = 1500000 and due_date = '2026-07-01' and period_month = '2026-07-01' and origin = 'manual')
       or (id = o_jul_fin and amount = 2500000 and due_date = '2026-07-01' and period_month = '2026-07-01' and origin = 'auto')
       or (id = o_aug_fin and amount = 2500000 and due_date = '2026-08-01' and period_month = '2026-08-01' and origin = 'manual')
       or (id = o_oct_fin and amount = 4000000 and due_date = '2026-11-15' and period_month = '2026-10-01' and origin = 'auto'));
  if n <> 4 then raise exception '0098: начисления не в ожидаемом состоянии (% из 4)', n; end if;

  -- в этих месяцах других fixed-строк нет
  if (select count(*) from obligations where counterparty_id = cp and pay_part = 'fixed'
        and period_month in ('2026-07-01','2026-08-01','2026-10-01')) <> 4 then
    raise exception '0098: в 07/08/10 лишние fixed-начисления';
  end if;
  if exists (select 1 from obligations where id in (o_aug_adv, o_oct_adv)) then
    raise exception '0098: авансы уже вставлены';
  end if;

  select count(*) into n from obligation_payments
   where id = pay_mv and obligation_id = o_oct_fin and amount = 1500000
     and paid_on = '2026-10-08' and transaction_id = '853b635a-14f3-4d1d-8106-821c53ffa628';
  if n <> 1 then raise exception '0098: погашение a0c85ef5 не в ожидаемом состоянии (%)', n; end if;
  if (select coalesce(sum(amount),0) from obligation_payments where obligation_id = o_oct_fin) <> 2186818 then
    raise exception '0098: погашено по 2d7408b1 не 21 868,18';
  end if;

  select sum(amount) into acc0 from obligations where counterparty_id = cp;
  select coalesce(sum(p.amount),0) into paid0
    from obligation_payments p join obligations o on o.id = p.obligation_id where o.counterparty_id = cp;
  if acc0 <> 60500000 or paid0 <> 57186818 then
    raise exception '0098: итоги ДО не совпали: начислено %, погашено %', acc0, paid0;
  end if;

  -- ---------- архив ----------
  insert into counterparties_before_0098 select c.*, now() from counterparties c where c.id = cp;
  insert into employee_salaries_before_0098 select s.*, now() from employee_salaries s where s.id = sal_dup;
  insert into obligation_payments_before_0098 select p.*, now() from obligation_payments p where p.id = pay_mv;
  insert into obligations_removed
    select o.*, now(), '0098 до правки срока/суммы (схема аванс+остаток, решение Дмитрия 2026-10-22)'
      from obligations o where o.id in (o_jul_adv, o_jul_fin, o_aug_fin, o_oct_fin);
  get diagnostics n = row_count;
  if n <> 4 then raise exception '0098: в архив начислений записано %', n; end if;

  -- ---------- 1. аванс в карточке ----------
  update counterparties set advance_amount = 1500000 where id = cp and coalesce(advance_amount, 0) = 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0098: advance_amount обновлён у % строк', n; end if;

  -- ---------- 2. дубль ставки ----------
  delete from employee_salaries where id = sal_dup and counterparty_id = cp;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0098: удалено % ставок', n; end if;

  -- ---------- 3. июль ----------
  update obligations set due_date = '2026-07-25', note = 'Начисление ЗП аванс' where id = o_jul_adv;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: июль аванс %', n; end if;
  update obligations set due_date = '2026-08-15', note = 'Начисление ЗП остаток (авто)' where id = o_jul_fin;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: июль остаток %', n; end if;

  -- ---------- 4. август ----------
  update obligations set due_date = '2026-09-15', note = 'Начисление ЗП остаток' where id = o_aug_fin;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: август остаток %', n; end if;
  insert into obligations (id, team_id, counterparty_id, type, amount, currency, category_id, project_id,
                           due_date, period_month, pay_part, origin, status, note)
    select o_aug_adv, o.team_id, o.counterparty_id, o.type, 1500000, o.currency, o.category_id, o.project_id,
           '2026-08-25', '2026-08-01', 'fixed', 'manual', 'open', 'Начисление ЗП аванс'
      from obligations o where o.id = o_aug_fin;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: август аванс вставлен %', n; end if;

  -- ---------- 5. октябрь ----------
  insert into obligations (id, team_id, counterparty_id, type, amount, currency, category_id, project_id,
                           due_date, period_month, pay_part, origin, status, note)
    select o_oct_adv, o.team_id, o.counterparty_id, o.type, 1500000, o.currency, o.category_id, o.project_id,
           '2026-10-25', '2026-10-01', 'fixed', 'manual', 'open', 'Начисление ЗП аванс'
      from obligations o where o.id = o_oct_fin;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: октябрь аванс вставлен %', n; end if;
  update obligation_payments set obligation_id = o_oct_adv where id = pay_mv and obligation_id = o_oct_fin;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: перенос погашения %', n; end if;
  update obligations set amount = 2500000, note = 'Начисление ЗП остаток (авто)'
   where id = o_oct_fin and amount = 4000000;
  get diagnostics n = row_count; if n <> 1 then raise exception '0098: октябрь остаток %', n; end if;

  -- ---------- проверки после ----------
  -- погашено не больше суммы — по всем начислениям сотрудника
  for r in select o.id, o.amount, coalesce(sum(p.amount),0) paid
             from obligations o left join obligation_payments p on p.obligation_id = o.id
            where o.counterparty_id = cp group by o.id, o.amount loop
    if r.paid > r.amount then
      raise exception '0098: переплата по %: % > %', r.id, r.paid, r.amount;
    end if;
  end loop;
  if (select coalesce(sum(amount),0) from obligation_payments where obligation_id = o_oct_fin) <> 686818
     or (select coalesce(sum(amount),0) from obligation_payments where obligation_id = o_oct_adv) <> 1500000
     or exists (select 1 from obligation_payments where obligation_id = o_aug_adv) then
    raise exception '0098: погашения октября/августа не как ожидалось';
  end if;

  -- за 07, 08, 10 ровно аванс (15 000, 25-е) + остаток (25 000, 15-е след. месяца)
  for r in select m::date m from unnest(array['2026-07-01','2026-08-01','2026-10-01']) m loop
    if (select count(*) from obligations where counterparty_id = cp and pay_part = 'fixed' and period_month = r.m) <> 2
       or (select count(*) from obligations where counterparty_id = cp and pay_part = 'fixed' and period_month = r.m
             and amount = 1500000 and due_date = r.m + 24) <> 1
       or (select count(*) from obligations where counterparty_id = cp and pay_part = 'fixed' and period_month = r.m
             and amount = 2500000 and due_date = (r.m + interval '1 month')::date + 14) <> 1 then
      raise exception '0098: месяц % не в схеме аванс+остаток', r.m;
    end if;
  end loop;

  select sum(amount) into acc1 from obligations where counterparty_id = cp;
  select coalesce(sum(p.amount),0) into paid1
    from obligation_payments p join obligations o on o.id = p.obligation_id where o.counterparty_id = cp;
  if acc1 <> 62000000 or paid1 <> 57186818 then
    raise exception '0098: итоги ПОСЛЕ не совпали: начислено %, погашено %', acc1, paid1;
  end if;
  if (select advance_amount from counterparties where id = cp) <> 1500000
     or (select count(*) from employee_salaries where counterparty_id = cp) <> 1 then
    raise exception '0098: карточка/ставка не в ожидаемом состоянии';
  end if;

  if current_setting('fin.rehearsal', true) = 'on' then
    raise exception 'REHEARSAL OK — начислено % -> %, погашено % -> %, остаток % -> %',
      acc0, acc1, paid0, paid1, acc0 - paid0, acc1 - paid1;
  end if;
end $$;
