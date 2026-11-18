# SEC-009 hotfix + инвентаризация SECURITY DEFINER

Дата: **2026-09-23**. Разрешение №1C.
PR #99 и миграции 0086–0092 **не применялись**. Тело функции **не менялось**.
Функция **не запускалась**. Bybit API / Vault secrets **не трогались**.
Другие функции **не менялись**. `bank_connections` **не трогался**.
Массового REVOKE **не делалось**.

Единственное изменение в production за этот шаг — один оператор REVOKE.

---

## 1. Состояние ДО изменения (снято с production)

```
func             : public.bybit_sync_logged(integer)
owner            : postgres
security mode    : SECURITY DEFINER
language         : plpgsql, volatile, not leakproof
proconfig        : {search_path=public, extensions}
proacl           : {=X/postgres,postgres=X/postgres,anon=X/postgres,
                    authenticated=X/postgres,service_role=X/postgres}

has_function_privilege:
  anon           = true
  authenticated  = true
  PUBLIC         = true
  service_role   = true
  postgres       = true
```

Обратите внимание: право было выдано **дважды** — и явно ролям `anon`/`authenticated`,
и через `PUBLIC` (запись `=X/postgres`). Снятия только одного из них было бы
недостаточно, поэтому в одном операторе сняты все три.

## 2. Какая роль реально вызывает функцию

`cron.job` jobid=1 `bybit-sync-daily`:

```
username = postgres    database = postgres    active = false
command  = select public.bybit_sync_logged(7)
```

pg_cron исполняет задание от роли **`postgres`** — она же владелец функции.
Серверный путь приложения (admin-клиент Supabase) работает от **`service_role`**.
Обе роли имеют собственные записи в ACL и REVOKE их не затрагивает,
поэтому контролируемый вызов после развёртывания сохраняется. Проверено после
изменения — см. §4.

## 3. Выполненное изменение

```sql
revoke execute on function public.bybit_sync_logged(integer) from anon, authenticated, public;
```

Ничего другого не выполнялось.

Артефакт отката (точный GRANT, выведенный из **фактического** ACL, а не из
предположения): `supabase/migrations/rollback/SEC009_bybit_sync_logged_acl_before.sql`.
Выполнять от роли `postgres` — она владелец и грантор всех исходных записей
(суффикс `/postgres`), поэтому ACL восстановится байт-в-байт. В самом файле
предупреждение: восстанавливать `anon` и `PUBLIC` не следует, это и есть уязвимость.

## 4. Доказательство — проверено по каталогам, 12:26:10 UTC

```
proacl : {postgres=X/postgres,service_role=X/postgres}

has_function_privilege:
  anon           = false     ✅ требование выполнено
  authenticated  = false     ✅ требование выполнено
  PUBLIC         = false     ✅ требование выполнено
  service_role   = true      ✅ серверный вызов сохранён
  postgres       = true      ✅ вызов pg_cron сохранён
```

`information_schema.role_routine_grants` для `bybit_sync_logged` — ровно две строки:
`postgres` и `service_role`.

Неизменность прочих атрибутов подтверждена тем же запросом:
`owner = postgres`, `security_definer = true`, `proconfig = {search_path=public, extensions}`.
Контрольная сумма тела после изменения: `md5(pg_get_functiondef) = 3e7f3ce153e12fb1c13888d87ac8cd85`.

**Тестовых вызовов `bybit_sync_logged()` на production не делалось** — у функции
побочные эффекты (обращение к Bybit API и запись в `transactions`).

## 5. Baseline после hotfix

| Показатель | Frozen | После REVOKE | Δ |
|---|---|---|---|
| transactions | 7 959 | **7 959** | 0 |
| actual / planned | 7 951 / 8 | **7 951 / 8** | 0 |
| obligations / allocations | 190 / 96 | **190 / 96** | 0 |
| invoices | 25 | **25** | 0 |
| splits | 4 | **4** | 0 |
| **FIN-03** | 126 | **126** | 0 |
| duplicate auto-accrual | 1 | **1** | 0 |
| **import_batches** | 269 | **269** | 0 |
| RUB flow | −10 198 192 | **−10 198 192** | 0 |
| USDT flow | 305 451 | **305 451** | 0 |
| Σ `opening_balance` | 61 904 483 | **61 904 483** | 0 |

**Bybit sync log новых записей не получил**: `bybit_sync_log` = 453 строки,
последняя `2026-09-23 06:00:00.253165+00`, записей после остановки cron
(07:24:20) — **0**. `transactions` после 07:24:20 — 0, `import_batches` — 0.
Активных сессий (не-idle) — 0.

Ни одно финансовое значение не изменилось.

---

# Инвентаризация SECURITY DEFINER (read-only, без исправлений)

Схемы с функциями `prosecdef`: `public` — **48**, `vault` — 2 (системные Supabase),
`pgbouncer` — 1. Клиентски исполнимы (`anon`/`authenticated`/`PUBLIC`) только
функции `public`: **27** из 48. Из них доступны `anon` или через `PUBLIC` — **9**
(до hotfix было 10).

Остальные 21 функции `public` закрыты (`{postgres,service_role}`): триггеры
(`accrue_agent_commission`, `settle_obligation_on_tx`, `trg_project_bonus`,
`log_transaction_change`, `handle_new_user`, `vault_log_*` и др.), пересчёты
(`recompute_*`, `accrue_project_bonus`, `academy_reissue`) и вся цепочка Bybit
(`bybit_sync`, `bybit_fetch`, `bybit_ingest`, `bybit_secrets`, `bybit_apply_parties`
и теперь `bybit_sync_logged`).

## 9 функций, доступных `anon` / через `PUBLIC`

| Функция | Owner | EXECUTE (ACL) | anon | auth | PUBLIC | search_path | Пишет | Vault / HTTP | Ожидаемый вызывающий | Оценка |
|---|---|---|---|---|---|---|---|---|---|---|
| `support_open_period(uuid,bigint,uuid,uuid)` | postgres | `=X`, postgres, anon, authenticated, service_role | **да** | да | **да** | `public` | **ДА** — `project_periods`, `obligations`, **`transactions`** | нет | участник команды с правом финансов | **SEC-010 (HIGH)** |
| `support_delete_period(uuid)` | postgres | `=X`, postgres, anon, authenticated, service_role | **да** | да | **да** | `public` | **ДА** — **DELETE** `obligations`, **`transactions`**, `project_periods` | нет | то же | **SEC-010 (HIGH)** |
| `next_document_number(uuid,text,text)` | postgres | `=X`, postgres, anon, authenticated, service_role | да | да | да | **НЕ ЗАДАН** | нет | нет | сервер/приложение | **SEC-011 (MEDIUM)** |
| `next_project_code(uuid)` | postgres | `=X`, postgres, anon, authenticated, service_role | да | да | да | **НЕ ЗАДАН** | нет | нет | сервер/приложение | **SEC-011 (MEDIUM)** |
| `assess_public_submit(text,jsonb)` | postgres | `=X`, postgres, anon, authenticated, service_role | да | да | да | `public` | да — `assess_answers/scores` | нет | **аноним по share-токену — так задумано** | ОК by design |
| `assess_public_load(text)` | postgres | `=X`, postgres, anon, authenticated, service_role | да | да | да | `public` | нет | нет | **аноним по share-токену — так задумано** | ОК by design |
| `vault_request_access(uuid)` | postgres | `=X`, postgres, authenticated, service_role | да (через PUBLIC) | да | да | `public` | да — `notifications` | упоминает `vault_entries`, не секреты | участник команды | защита держится, грант избыточен |
| `vault_directory(uuid)` | postgres | `=X`, postgres, authenticated, service_role | да (через PUBLIC) | да | да | `public` | нет | читает `vault_entries`, **шифротекст не отдаёт** | участник команды | защита держится, грант избыточен |
| `can_view_resource(uuid,text)` | postgres | postgres, anon, authenticated, service_role | да | да | нет | `public` | нет | нет | RLS-хелпер | низкий риск |

## SEC-010 — найден аналог SEC-009. **STOP.**

`support_open_period` и `support_delete_period` — `SECURITY DEFINER`, исполнимы
**`anon` и через `PUBLIC`**, публикуются PostgREST как
`POST /rest/v1/rpc/support_open_period` и `…/support_delete_period`,
и **пишут и удаляют финансовые данные** (`transactions`, `obligations`).

Их единственная защита — строка вида

```sql
if not public.can_edit_finance(pr.team_id) then raise exception 'forbidden'; end if;
```

и она **неисправна**. Это уже зафиксированный SEC-008, и он **жив в production**
(проверено прямо сейчас, read-only, на несуществующей команде):

```
can_edit_finance('0000…0001') -> NULL     (is null = true)
is_team_member  ('0000…0001') -> false
```

`can_edit_finance` = `select current_team_role(_team_id) in ('owner','admin','manager')`.
Для не-участника `current_team_role` возвращает NULL, а `NULL in (…)` — тоже NULL.
В RLS-политике NULL трактуется как «запретить», и там защита работает; в plpgsql
`if not NULL then raise` **не срабатывает** — выполнение идёт дальше. Для участника
команды с низкой ролью роль не NULL, функция вернёт `false`, и `raise` сработает,
поэтому свои сотрудники с ограниченными правами заблокированы корректно.
Уязвимы именно **не-участники**, включая `anon`.

Отличие от SEC-009 по практической эксплуатируемости, и поэтому HIGH, а не CRITICAL:
`bybit_sync_logged(7)` вызывался **без аргументов** и с захардкоженными командой и
счётом — знать было нечего. Здесь нужен действительный UUID проекта либо периода, а
RLS не даёт чужой стороне их увидеть. Но это препятствие к эксплуатации, а не защита:
обход авторизации существует, и нужен он ровно тот же — `SECURITY DEFINER` +
клиентский доступ + финансовая запись.

`is_team_member` реализован через `exists(...)` и возвращает `false` — функции,
защищённые им (`vault_request_access`, `vault_directory`), не затронуты.

**Согласно вашему условию — останавливаюсь и к развёртыванию не перехожу.**
Массового REVOKE не делал. Ничего не исправлял.

Возможные варианты (ни один не применён, требуется отдельное разрешение):

| # | Действие | Комментарий |
|---|---|---|
| 1 | `revoke execute on function public.support_open_period(uuid,bigint,uuid,uuid), public.support_delete_period(uuid) from anon, public;` | минимальный аналог hotfix SEC-009; `authenticated` оставить — функции нужны приложению. Закрывает анонимный доступ, но **не** закрывает кросс-командный: аутентифицированный чужак остаётся вне защиты, пока не починен SEC-008 |
| 2 | Починить SEC-008 точечно: переписать `can_edit_finance`/`can_write_tx`/`can_manage_team` через `exists(...)` | это ровно то, что делает миграция **0091** в PR #99. Можно вынести в отдельный hotfix до развёртывания |
| 3 | 1 + 2 вместе | закрывает и анонимный, и кросс-командный путь |

## SEC-011 (MEDIUM)

`next_document_number(uuid,text,text)` и `next_project_code(uuid)` — `SECURITY DEFINER`
**без закреплённого `search_path`** (`proconfig` пуст), при этом исполнимы `anon`/`PUBLIC`.
Это классический вектор подмены объектов через `search_path` вызывающего. Обе функции
только читают, поэтому MEDIUM. Исправление — `alter function … set search_path = public`
плюс снятие лишних грантов. **Не применял.**

---

## Статус

* SEC-009 закрыт и доказан по каталогам: `anon`/`authenticated`/`PUBLIC` = false, `postgres`/`service_role` = true.
* Тело функции, owner, security mode, `search_path` не менялись; функция не запускалась.
* Frozen baseline не изменился ни в одной позиции; `bybit_sync_log` новых строк не получил.
* Инвентаризация SECURITY DEFINER выполнена: 48 функций в `public`, 27 клиентски исполнимых, 9 доступных `anon`/`PUBLIC`.
* **Найден аналог SEC-009 — SEC-010** (`support_open_period`, `support_delete_period`) плюс SEC-011.
* **STOP. К развёртыванию не перехожу. 0086–0092 не применены.**
