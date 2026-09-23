#!/usr/bin/env bash
# ============================================================================
# sec010_test.sh — регрессия SEC-008 + SEC-010 на одноразовой БД.
# Production не используется. Функции support_* воспроизведены с production-
# сигнатурами и с тем же guard'ом `if not public.can_edit_finance(...)`.
# Прогон: BEFORE (ACL и хелперы как в production до hotfix) → применяем
# supabase/migrations/hotfix/SEC008_SEC010_hotfix.sql → AFTER.
# Пять вызывающих: anon, authenticated не-участник, authenticated участник без
# права финансов (viewer), участник с правом финансов, service_role.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
HERE="$(cd "$(dirname "$0")" && pwd)"
DB=t_sec010
S="psql -h $BASE -p 5433 -U audit -d postgres -qtA"
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then printf '  %-34s PASS  %s\n' "$1" "$4"; pass=$((pass+1));
         else printf '  %-34s FAIL  %s — ожидалось [%s], получено [%s]\n' "$1" "$4" "$2" "$3"; fail=$((fail+1)); fi; }

$S -c "drop database if exists $DB;" >/dev/null
$S -c "create database $DB template t_base;" >/dev/null

# ── production-образные функции и production ACL «до hotfix» ────────────────
$P -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
grant usage on schema public, auth to anon, authenticated, service_role;

create or replace function public.support_open_period(
  p_project uuid, p_prepay_amount bigint default 0,
  p_account uuid default null, p_income_tx uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr record; pid uuid;
begin
  select * into pr from public.projects where id = p_project;
  if not found then raise exception 'project not found'; end if;
  -- ровно тот guard, что стоит в production
  if not public.can_edit_finance(pr.team_id) then raise exception 'forbidden'; end if;
  insert into public.project_periods(project_id, period_month, period_start, period_end)
  values (p_project, date_trunc('month', current_date)::date, current_date, current_date + 29)
  returning id into pid;
  insert into public.obligations(team_id, counterparty_id, type, amount, currency, status)
  values (pr.team_id, pr.responsible_counterparty_id, 'payable', coalesce(pr.bonus_amount,0), 'RUB', 'open');
  return jsonb_build_object('period', pid);
end $$;

create or replace function public.support_delete_period(p_period uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pe record; t uuid;
begin
  select pp.*, p.team_id as team_id into pe
    from public.project_periods pp join public.projects p on p.id = pp.project_id
   where pp.id = p_period;
  if not found then return; end if;
  if not public.can_edit_finance(pe.team_id) then raise exception 'forbidden'; end if;
  delete from public.project_periods where id = p_period;
end $$;

-- ACL как в production до hotfix
grant execute on function public.support_open_period(uuid, bigint, uuid, uuid) to public, anon, authenticated, service_role;
grant execute on function public.support_delete_period(uuid) to public, anon, authenticated, service_role;
SQL

TB=$($P -c "insert into teams(name) values('Команда SEC') returning id;")
UOWN=aaaa0000-0000-0000-0000-00000000000f
UVIEW=cccc0000-0000-0000-0000-00000000000f
UOUT=0000ffff-0000-0000-0000-0000000000ff
$P -c "insert into team_members values('$TB','$UOWN','owner'),('$TB','$UVIEW','viewer');" >/dev/null
CP=$($P -c "insert into counterparties(team_id,name,kind) values('$TB','Ответственный','employee') returning id;")
PRJ=$($P -c "insert into projects(team_id,name,type,status,bonus_amount,bonus_currency,responsible_counterparty_id) values('$TB','[901] Поддержка','support','active',50000,'RUB','$CP') returning id;")

periods(){ $P -c "select count(*) from project_periods where project_id='$PRJ';"; }
obls(){    $P -c "select count(*) from obligations where team_id='$TB';"; }

# call ROLE UID -> печатает allowed | forbidden | denied_privilege | other:…
call(){
  local role="$1" uid="$2"
  local out
  out=$(psql -h "$BASE" -p 5433 -U audit -d "$DB" -qtA \
        -c "set role $role; set test.uid='$uid'; select public.support_open_period('$PRJ',0,null,null);" 2>&1 | head -2)
  # ВАЖНО: ошибки разбираем раньше успеха. Имя индекса
  # project_periods_project_month_uniq содержит подстроку "period", и наивная
  # проверка на неё принимала unique-violation за успешный вызов.
  case "$out" in
    *"permission denied for function"*) echo denied_privilege ;;
    *forbidden*)                        echo forbidden ;;
    *ERROR*)                            echo "other: $(echo "$out" | tr '\n' ' ' | cut -c1-90)" ;;
    *'{"period":'*)                     echo allowed ;;
    *)                                  echo "other: $(echo "$out" | tr '\n' ' ' | cut -c1-90)" ;;
  esac
}

phase(){ # $1 = метка фазы, $2..$6 = ожидания C1..C5
  local tag="$1"; shift
  local p0 o0 p1 o1
  p0=$(periods); o0=$(obls)
  check "$tag C1 anon"                  "$1" "$(call anon          '')"      "аноним"
  check "$tag C2 authenticated чужой"   "$2" "$(call authenticated "$UOUT")" "аутентифицирован, не участник"
  check "$tag C3 authenticated viewer"  "$3" "$(call authenticated "$UVIEW")" "участник без права финансов"
  check "$tag C4 authenticated owner"   "$4" "$(call authenticated "$UOWN")"  "участник с правом финансов"
  check "$tag C5 service_role"          "$5" "$(call service_role  '')"      "серверная роль без пользователя"
  p1=$(periods); o1=$(obls)
  printf '  %-34s ----  периодов %s→%s, обязательств %s→%s\n' "$tag данные" "$p0" "$p1" "$o0" "$o1"
}

echo "=============== SEC-008 / SEC-010 (db=$DB) ==============="
echo "--- BEFORE hotfix (состояние production до изменения) ---"
check "BEFORE can_edit_finance(чужой)" "NULL" "$($P -c "set test.uid='$UOUT'; select coalesce(public.can_edit_finance('$TB')::text,'NULL');")" "хелпер возвращает NULL"
phase "BEFORE" allowed allowed forbidden allowed allowed

echo "--- применяю hotfix ---"
psql -h "$BASE" -p 5433 -U audit -d "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/../../supabase/migrations/hotfix/SEC008_SEC010_hotfix.sql" 2>&1 | grep -v NOTICE

echo "--- AFTER hotfix ---"
for h in can_edit_finance can_write_tx can_manage_team; do
  check "AFTER $h(чужой)" "false" "$($P -c "set test.uid='$UOUT'; select coalesce(public.$h('$TB')::text,'NULL');")" "не-участник → false, не NULL"
done
check "AFTER can_edit_finance(owner)" "true" "$($P -c "set test.uid='$UOWN'; select coalesce(public.can_edit_finance('$TB')::text,'NULL');")" "участник с правом → true"
check "AFTER can_edit_finance(viewer)" "false" "$($P -c "set test.uid='$UVIEW'; select coalesce(public.can_edit_finance('$TB')::text,'NULL');")" "viewer → false"
phase "AFTER" denied_privilege forbidden forbidden allowed forbidden

echo "--- идемпотентность: применяю hotfix повторно, затем 0091 ---"
# Тестовые фазы выше создали несколько периодов одного месяца — это артефакт
# упрощённой тестовой функции. 0091 ставит unique (project_id, period_month),
# поэтому дубли снимаем: в production их 0 (db_integrity_audit.sql).
# Периоды прошлых фаз мешают дважды: они дублируют (project_id, period_month),
# на который 0091 ставит unique, и не дают C4 вставить новый период.
# Чистим полностью; в production дублей 0 (db_integrity_audit.sql).
$P -c "delete from project_periods where project_id='$PRJ';" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/../../supabase/migrations/hotfix/SEC008_SEC010_hotfix.sql" 2>&1 | grep -v NOTICE
psql -h "$BASE" -p 5433 -U audit -d "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/../../supabase/migrations/0091_write_paths_and_authz.sql" 2>&1 | grep -viE 'notice|skipping' | head -5
phase "IDEMP" denied_privilege forbidden forbidden allowed forbidden

echo "---------------------------------------------------"
echo "SEC-008/010: PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
