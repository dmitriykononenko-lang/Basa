# DEPLOY_STEP1B — инвентаризация sync/import entrypoints и попытка write freeze

Дата: **2026-09-23**. Разрешение №1B.
Миграции 0086–0092 **не применялись**. PR #99 **не merge/не deploy**.
`bank_connections` **не изменялся**. `CRON_SECRET` **не менялся**. pg_cron остаётся `active=false`.
FIN-03 / `opening_balance` / FX **не трогались**.

**Итог: `writers_frozen_at` НЕ зафиксирован.** Разрешённый механизм (Vercel/Firewall)
на этом проекте **недоступен** — подробности в §4. Изменений в production на этом шаге
не сделано вообще; всё ниже — инвентаризация и read-only зондирование.

Инвентаризация сверена с **развёрнутым** кодом, а не с деревом PR #99:
`git diff origin/main..HEAD` по `src/app/api/tochka/**`, `TochkaAutoSync.tsx`,
`(app)/layout.tsx` показывает расхождение только в `auto-sync/route.ts` и
`lib/tochka-import.ts` (внутренности). Состав и пути точек входа в проде и в ветке
идентичны.

---

## 1–2. Инвентаризация entrypoints + классификация READ / WRITE

### A. HTTP-маршруты приложения (Vercel, `basefinance.pro`)

| # | Entrypoint | Метод | Кто может вызвать | Класс | Инициирует импорт выписки? | Автоматический? |
|---|---|---|---|---|---|---|
| A1 | `/api/tochka/auto-sync` | POST | сессия + `canEditFinance` | **WRITE / SYNC** | **ДА** (`importTochkaStatement`, окно 10 дней) | **ДА** — `TochkaAutoSync` при каждом открытии приложения |
| A2 | `/api/tochka/cron` | GET | Bearer `CRON_SECRET` (без сессии, исключён в middleware) | **WRITE / SYNC** | **ДА** (окно 45 дней, все команды) | **ДА** — Vercel cron `0 5 * * *`; pg_cron (сейчас 401 + disabled) |
| A3 | `/api/tochka/import` | POST | сессия + `canEditFinance` | **WRITE / SYNC** | **ДА** | нет — кнопка в `BankConnection.tsx` |
| A4 | `/api/tochka/connect` | POST / DELETE | сессия | WRITE (`bank_connections`) | нет | нет |
| A5 | `/api/tochka/mapping` | GET / POST | сессия | GET **READ**; POST WRITE (`bank_account_links`) | нет | нет |
| A6 | `/api/tochka/suggest` | POST | сессия | **READ** — `fetchOperations` + подсчёт «фонд X», ни одной записи в БД | нет | нет |
| A7 | `/api/tochka/test` | GET | сессия | **READ** — `getAccounts` | нет | нет |
| A8 | `/api/invoices/[id]/issue` | POST | сессия | WRITE — создаёт счёт **в банке** + `invoices`; выписку не импортирует | нет | нет |
| A9 | `/api/invoices/[id]/tochka-status` | POST | сессия | WRITE — `invoices.status` по опросу банка; выписку не импортирует | нет | нет |
| A10 | `/api/invoices/reconcile` | POST | сессия | WRITE — только `invoices.status='paid'`; `transactions` не создаёт | нет | нет |
| A11 | `/api/cron/notifications` | GET | `CRON_SECRET` | WRITE — `notifications` | нет | ДА, но **не финансы** |
| A12 | `/api/cron/recurring` | GET | `CRON_SECRET` | WRITE — `academy_assignments` (`academy_reissue`) | нет | ДА, но **не финансы** |

Кандидаты на deny — только **A1, A2, A3**. A6 и A7 — чистый READ, их трогать нельзя.
A4/A5 — конфигурация подключения, импорт не инициируют. A8–A10 — инвойсы, не выписка.

### B. Supabase PostgREST (`kmvsjozxjosmkhvphzdz.supabase.co`) — **вне Vercel**

| # | Entrypoint | Кто может вызвать | Класс |
|---|---|---|---|
| B1 | `POST /rest/v1/rpc/bybit_sync_logged` | **`anon`, `authenticated`, `PUBLIC`** | **WRITE / SYNC** |

`public.bybit_sync_logged(integer)` — `SECURITY DEFINER`, `EXECUTE` выдан
`anon`, `authenticated` и `PUBLIC`:

```
acl: =X/postgres  postgres=X/postgres  anon=X/postgres  authenticated=X/postgres  service_role=X/postgres
```

Цепочка: `bybit_sync_logged` → `bybit_sync` → `bybit_fetch` (берёт `bybit_api_key`/
`bybit_api_secret` из `vault.decrypted_secrets`, ходит в `api.bybit.com` расширением
`http`) → `bybit_ingest` → **INSERT в `public.transactions`** (команда и счёт
захардкожены константами в теле функции).

Остальные `bybit_*` функции (`bybit_sync`, `bybit_fetch`, `bybit_ingest`,
`bybit_secrets`, `bybit_apply_parties`) выданы только `service_role`/`postgres` — они закрыты.
Открыт ровно один — верхний.

**Vercel Firewall этот путь закрыть не может в принципе**: запрос идёт на домен Supabase,
мимо Vercel. Подробности и оценка — §5, находка SEC-009.

### C. pg_cron (внутри БД)

| # | Задача | Команда | Статус |
|---|---|---|---|
| C1 | `tochka-autosync` | `net.http_get('…/api/tochka/cron', Bearer …)` → A2 | **disabled** |
| C2 | `bybit-sync-daily` | `select public.bybit_sync_logged(7)` → B1 | **disabled** |

### D. Supabase Edge Functions

`oceaniq-report`, `oceaniq-verify` — к Tochka/Bybit отношения не имеют. Других нет.

## 3. Client-mounted / background triggers

| Триггер | Где | Что делает |
|---|---|---|
| **`TochkaAutoSync`** | `src/components/TochkaAutoSync.tsx`, смонтирован в `src/app/(app)/layout.tsx:134` под условием `canEditFinance(current.role)` | `useEffect` → `POST /api/tochka/auto-sync` при **каждом** открытии приложения. Тротлинг: `sessionStorage` 30 мин на вкладку + сервер 120 мин на команду. **Единственный** автоматический client-side триггер импорта. |

Проверено дополнительно и **ничего больше не найдено**:

* компоненты с `useEffect` + `fetch` — только `TochkaAutoSync.tsx` и `vault/VaultManager.tsx` (сейф паролей, не финансы);
* `setInterval` — только `NotificationBell.tsx` (уведомления) и `tg/learning/page.tsx` (обучение);
* все прочие обращения к `/api/tochka/*` — в `BankConnection.tsx` (страница «Настройки → Банк») и все до одного по явному нажатию кнопки: `connect`, `test`, `mapping`, `suggest`, `import`, `import?debug=1`, `DELETE connect`.

## 4. Почему deny не поставлен: Vercel Firewall на этом проекте недоступен

| Вызов | Ответ |
|---|---|
| `GET` firewall config (`configVersion=active`) | `404 {"code":"not_found","message":"Seawall Config not found."}` |
| `PUT` firewall config (`firewallEnabled: true` + 1 правило deny на 3 пути) | `404 Seawall Config not found` |
| `PATCH` firewall config (`action: firewallEnabled`) | `404 Seawall Config not found` |

Конфигурации WAF у проекта нет, и создать её через API не удаётся. Наиболее вероятная
причина — тарифный план: пользовательские правила Vercel Firewall доступны начиная с Pro,
а команда `dmitriykononenko-lang's projects` выглядит личной (Hobby). Подтвердить план
из API не получилось: `get_auth_user` → `404 User not found`, `filter_project_envs` → `403`.
Это **предположение о причине**; факт — API отказывает.

Альтернатива внутри Vercel — Routing Config (`list_project_routes` / `add_route`,
правила применяются без деплоя). Вызов **заблокирован политикой разрешений сессии**
(`Modify Shared Resources`), нужно ваше явное подтверждение, и доступность самой фичи
на текущем плане тоже не проверена.

Остальные способы отпадают по вашим же ограничениям: снятие `crons` из `vercel.json`
требует деплоя; `ssoProtection: all` и `pause_project` кладут приложение целиком.

**Поэтому §«После блокировки доказать freeze» выполнить нельзя — блокировки нет.**

## 5. Зондирование entrypoints (read-only, «до»)

Прямой curl из среды аудита невозможен (сетевая политика контейнера режет
`basefinance.pro:443`). Зондировал через `pg_net` из Supabase — тем же механизмом,
которым ходит pg_cron. Ни один зонд не авторизован, ни один не импортирует.

| id | Запрос | Код | Тело / Location |
|---|---|---|---|
| 178 | `GET /api/tochka/cron` | **401** | `{"error":"Unauthorized"}` — обработчик достигнут, отбит по Bearer |
| 179 | `POST /api/tochka/auto-sync` | **405** | `Location: /login?next=%2Fapi%2Ftochka%2Fauto-sync` (редирект middleware) |
| 180 | `POST /api/tochka/import` | **405** | `Location: /login?next=%2Fapi%2Ftochka%2Fimport` |
| 181 | `GET /api/tochka/test` | 200 | HTML логина (контроль — READ, должен остаться) |
| 182 | `POST /api/tochka/suggest` | 405 | `Location: /login?…` (контроль — READ) |
| 183 | `GET /api/tochka/mapping` | 200 | HTML логина (контроль) |

Это эталон «до». После установки deny 178/179/180 обязаны стать **403 от edge Vercel**,
а 181/182/183 — остаться без изменений. Проверка готова к запуску, как только появится
механизм блокировки.

## 6. Что уже доказано без блокировки

| Требование | Статус | Доказательство |
|---|---|---|
| pg_cron остаётся disabled | **ДА** | `cron.job`: обе задачи `active=false`. **Эмпирически**: с момента остановки 07:24:20 прошли слоты **09:00 и 12:00 UTC** — `cron.job_run_details` после остановки = **0 прогонов** (последний 06:00:00), `bybit_sync_log` (453 строки, последняя 06:00:00) после остановки = **0 строк**. |
| Bybit не может инициировать **автоматическую** запись | **ДА** | Единственный автоматический путь — C2, disabled и эмпирически молчит. В коде приложения слова `bybit` нет вообще; edge-функций Bybit нет. Ручной путь B1 остаётся открытым — см. SEC-009. |
| Финансовый Vercel cron не сможет выполнить sync | **НЕТ** | Не отключён. Единственный финансовый — A2 `/api/tochka/cron`, `0 5 * * *`, ближайший запуск **2026-09-24 05:00 UTC**. |
| `TochkaAutoSync` не создаёт import batch | **НЕТ (не заблокирован)** | Наблюдение, не гарантия: `import_batches` = 269 и `bank_connections.last_synced_at` = 06:04:07 не двигались c 06:04, хотя серверный тротлинг 120 мин истёк в 08:04. Значит с 06:04 приложение не открывал никто с правом редактировать финансы. Откроет — импорт пойдёт. |
| active sync/import = 0 | **ДА** | `pg_stat_activity` (не-idle, кроме своего) = **0**. |

## 7. Повторная сверка frozen baseline — 12:17:32 UTC

| Показатель | Frozen | Сейчас | Δ |
|---|---|---|---|
| transactions | 7 959 | **7 959** | 0 |
| actual | 7 951 | **7 951** | 0 |
| planned | 8 | **8** | 0 |
| obligations | 190 | **190** | 0 |
| allocations | 96 | **96** | 0 |
| invoices | 25 | **25** | 0 |
| splits | 4 части / 2 операции | **4 / 2** | 0 |
| FIN-03 | 126 | **126** | 0 |
| duplicate auto-accrual | 1 | **1** | 0 |
| RUB flow | −10 198 192 | **−10 198 192** | 0 |
| USDT flow | 305 451 | **305 451** | 0 |
| Σ `opening_balance` | 61 904 483 | **61 904 483** | 0 |

Дополнительно: `import_batches` = 269 (без изменений), записей в `transactions`
после 07:24:20 — **0**, батчей после 07:24:20 — **0**, посторонних исходящих
HTTP из БД, кроме шести моих зондов, — **0**.

**Baseline не изменился. Дельты нет.** Шесть зондов §5 не создали ни одной финансовой записи.

## 8. Новая находка

**SEC-009 (CRITICAL, вне объёма PR #99).**
`public.bybit_sync_logged(integer)` — `SECURITY DEFINER` с `EXECUTE` для `anon`,
`authenticated` и `PUBLIC`. Публикуется PostgREST как
`POST /rest/v1/rpc/bybit_sync_logged`. Анонимный ключ Supabase по определению публичен
(он в клиентском бандле), поэтому **любой в интернете** может дёрнуть функцию, которая
достаёт боевые ключи Bybit из vault, ходит в Bybit API и **пишет строки в
`public.transactions`** — в жёстко зашитую команду и счёт, минуя RLS и минуя Vercel.

Проверено **по грантам, а не вызовом**: вызвать её означало бы совершить финансовую
запись в production. Эмпирически не проверялось намеренно.

Это не следствие PR #99 — состояние существующее. Ближайшие соседи по цепочке
(`bybit_sync`, `bybit_fetch`, `bybit_ingest`, `bybit_secrets`) закрыты корректно,
открыта только верхняя обёртка — похоже на недосмотр при её добавлении.

Исправление — один оператор, миграцией не является, обратимо:

```sql
revoke execute on function public.bybit_sync_logged(integer) from anon, authenticated, public;
```

**Не применял** — ждёт вашего разрешения.

---

## Варианты дальнейших действий

| # | Что | Механизм | Закрывает | Побочный эффект | Обратимость |
|---|---|---|---|---|---|
| 1 | Включить Vercel Firewall в дашборде и добавить deny на `/api/tochka/auto-sync`, `/api/tochka/cron`, `/api/tochka/import` | вручную, дашборд Vercel (нужен план с WAF) | A1, A2, A3 | нет | снять правило |
| 2 | Vercel Routing deny на те же 3 пути | `add_route` — нужно ваше разрешение в сессии | A1, A2, A3 | нет | удалить маршрут |
| 3 | `revoke execute … bybit_sync_logged` | SQL, один оператор | **B1** + чинит SEC-009 | нет | `grant` обратно (но `anon` возвращать не надо) |
| 4 | `revoke select on public.bank_connections from authenticated` | SQL, один оператор | A1 и A3 (маршрут выйдет на `not_connected` до любой записи) | на время заморозки «Настройки → Банк» покажет «не подключено» | `grant select` обратно. Данные `bank_connections` **не меняются** |
| 5 | Организационно: короткое окно + запрет открывать приложение, мониторинг `import_batches`/`transactions` каждые N минут с откатом при движении | — | A1 фактически | требует дисциплины | — |

Рекомендую: **3** (делать в любом случае — это дыра, а не мера заморозки) + **1**, а если
WAF на плане нет — **4** на время окна, либо **5**, если окно действительно короткое.

## Статус

* Инвентаризация (пп. 1–4 Разрешения №1B) выполнена.
* Блокировка не поставлена: авторизованный механизм недоступен.
* `writers_frozen_at` **не зафиксирован**.
* Frozen baseline подтверждён без изменений на 12:17:32 UTC.
* **STOP.** Жду решения по вариантам выше.
