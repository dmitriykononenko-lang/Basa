-- ============================================================
-- 0071_invite_counterparty: приглашение из карточки сотрудника + автопривязка.
--
-- Приглашение можно привязать к карточке сотрудника (counterparty). Когда
-- человек примет приглашение и войдёт, его учётка автоматически привяжется к
-- этой карточке (counterparties.user_id) — не нужно линковать вручную.
-- ============================================================

alter table public.invites
  add column if not exists counterparty_id uuid references public.counterparties (id) on delete set null;

create or replace function public.accept_invite(_invite_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _inv public.invites;
begin
  select * into _inv from public.invites where id = _invite_id;
  if _inv.id is null or _inv.status <> 'pending' then
    raise exception 'Приглашение недействительно';
  end if;
  if lower(_inv.email) <> public.auth_email() then
    raise exception 'Приглашение оформлено на другой email';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (_inv.team_id, auth.uid(), _inv.role)
  on conflict (team_id, user_id) do update set role = excluded.role;

  -- Автопривязка учётки к карточке сотрудника (если приглашали из неё и она свободна).
  if _inv.counterparty_id is not null then
    update public.counterparties
      set user_id = auth.uid()
      where id = _inv.counterparty_id and team_id = _inv.team_id and user_id is null;
  end if;

  update public.invites set status = 'accepted' where id = _invite_id;
end;
$function$;
