-- Откат 0098: вернуть схему Кутишко к состоянию до миграции из архивов.
--  - погашение a0c85ef5 -> обратно на 2d7408b1;
--  - amount/due_date/note четырёх начислений -> из obligations_removed (reason '0098 …');
--  - удалить вставленные авансы 439b8fd4 (август) и 852da6f7 (октябрь), если на них
--    нет погашений (иначе — стоп: сначала разобраться с новыми погашениями);
--  - вернуть ставку 463145f8 и advance_amount сотрудника.
-- Архивные таблицы *_before_0098 не удаляются.
do $$
declare
  cp constant uuid := 'e922a1ca-3828-420a-99cf-b44e0169d249';
  o_aug_adv constant uuid := '439b8fd4-7791-4bbd-b6b8-985f511bf82b';
  o_oct_adv constant uuid := '852da6f7-233b-4395-adc3-76bef8519abc';
  pay_mv    constant uuid := 'a0c85ef5-f3e2-4df1-bc8c-a389203e0c0f';
  n int; cols text; acc0 bigint;
begin
  select sum(amount) into acc0 from public.obligations where counterparty_id = cp;
  -- 1. погашение обратно
  update public.obligation_payments p set obligation_id = a.obligation_id
    from public.obligation_payments_before_0098 a
   where p.id = a.id and a.id = pay_mv;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'откат 0098: погашение возвращено % раз', n; end if;

  -- 2. авансы удалить (только если погашений на них нет)
  if exists (select 1 from public.obligation_payments where obligation_id in (o_aug_adv, o_oct_adv))
     or exists (select 1 from public.transactions where obligation_id in (o_aug_adv, o_oct_adv)) then
    raise exception 'откат 0098: на вставленные авансы есть погашения/операции — разобрать вручную';
  end if;
  delete from public.obligations where id in (o_aug_adv, o_oct_adv) and counterparty_id = cp;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'откат 0098: удалено % авансов вместо 2', n; end if;

  -- 3. поля начислений из архива
  update public.obligations o
     set amount = a.amount, due_date = a.due_date, note = a.note
    from public.obligations_removed a
   where a.id = o.id and a.reason like '0098 %' and o.counterparty_id = cp;
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'откат 0098: восстановлено % начислений вместо 4', n; end if;

  -- 4. ставка
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employee_salaries' and is_generated = 'NEVER';
  execute format('insert into public.employee_salaries (%s) select %s from public.employee_salaries_before_0098
                  on conflict (id) do nothing', cols, cols);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'откат 0098: возвращено % ставок вместо 1', n; end if;

  -- 5. аванс в карточке
  update public.counterparties c set advance_amount = a.advance_amount
    from public.counterparties_before_0098 a
   where c.id = a.id and a.id = cp;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'откат 0098: карточка обновлена % раз', n; end if;

  -- минус 15 000 (август-аванс), октябрь: 15 000 + 25 000 -> 40 000
  if (select sum(amount) from public.obligations where counterparty_id = cp) <> acc0 - 1500000 then
    raise exception 'откат 0098: начислено изменилось не на -15 000,00';
  end if;
end $$;
