-- Откат 0097: вернуть начисление b6bf091e из архива с тем же id.
do $$
declare cols text; n int;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema='public' and table_name='obligations' and is_generated='NEVER';
  execute format('insert into public.obligations (%s) select %s from public.obligations_removed
                  where id = %L on conflict (id) do nothing', cols, cols, 'b6bf091e-9263-4de8-b3e0-ed7477ac5064');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'откат 0097: возвращено % строк вместо 1', n; end if;
end $$;
