-- ============================================================
-- 0039_fix_project_bonus_trigger_secdef: фикс прав на начисление бонуса
-- ============================================================
-- trg_project_bonus зовёт SECURITY DEFINER функцию accrue_project_bonus, у которой
-- EXECUTE отозван у public/anon/authenticated (0038). Сама обёртка-триггер была
-- SECURITY INVOKER → при INSERT/UPDATE проекта пользователь (authenticated) получал
-- "permission denied for function accrue_project_bonus".
--
-- Делаем обёртку SECURITY DEFINER (выполняется от владельца, у него EXECUTE есть),
-- сохраняя revoke прямого вызова accrue_project_bonus пользователями — функция
-- по-прежнему недоступна для прямого RPC.

create or replace function public.trg_project_bonus()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.accrue_project_bonus(new.id);
  return new;
end;
$$;
