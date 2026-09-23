# FINAL PRE-MIGRATION GATE — Разрешение №2A

Дата: **2026-09-23**. Миграции 0086–0092 **не применены**. PR #99 **не merge/не deploy**.
В production за этот шаг **не изменено ничего**: все запросы только на чтение.
Единственное изменение в репозитории — исправление одной сигнатуры в `0091`
(файл ещё нигде не применён), см. §4.

---

## 1. FINAL baseline — 2026-09-23 **16:06:15 UTC**

| Показатель | Ожидалось | Факт | Δ |
|---|---|---|---|
| transactions | 7 959 | **7 959** | 0 |
| actual / planned | 7 951 / 8 | **7 951 / 8** | 0 |
| FIN-03 | 126 | **126** | 0 |
| import_batches | 269 | **269** | 0 |
| obligations | 190 | **190** | 0 |
| allocations | 96 | **96** | 0 |
| invoices | 25 | **25** | 0 |
| splits | 4 | **4** | 0 |
| duplicate auto-accrual | 1 | **1** | 0 |
| RUB flow | −10 198 192 | **−10 198 192** | 0 |
| USDT flow | 305 451 | **305 451** | 0 |
| Σ `opening_balance` | 61 904 483 | **61 904 483** | 0 |

Справочные значения, зафиксированные тем же срезом: `invoice_items` 22,
`accounts` 24, `counterparties` 158, `project_periods` 3.

**Совпадение по всем двенадцати позициям. FINAL baseline = frozen baseline.**

## 2. Новых финансовых записей после остановки cron нет

Отсчёт от `stopped_at_utc = 2026-09-23 07:24:20.625417+00`:

| Проверка | Значение |
|---|---|
| `transactions` создано после остановки | **0** |
| `import_batches` создано после остановки | **0** |
| `obligations` создано после остановки | **0** |
| `bybit_sync_log` строк после остановки | **0** |
| `cron.job_run_details` прогонов после остановки | **0** |
| последняя `transactions.created_at` | 2026-09-23 06:04:03.962+00 |
| последний `import_batches.created_at` | 2026-09-23 06:04:03.838+00 |
| последний `bank_connections.last_synced_at` | 2026-09-23 06:04:07.772+00 |
| последний прогон Bybit | 2026-09-23 06:00:00.253+00 |

Последняя финансовая запись — **06:04 UTC**, то есть **более 10 часов** назад и до
остановки планировщиков. Серверный тротлинг авто-синка (120 минут) истёк ещё в 08:04,
и с тех пор ни одного импорта не было: приложение в этот период не открывал никто
с правом редактировать финансы.

## 3. Планировщики и активные сессии

```
cron.job: 1:bybit-sync-daily active=false | 2:tochka-autosync active=false
```

* прогонов после остановки — 0; пропущены слоты **09:00, 12:00 и 15:00 UTC**;
* активных backend'ов (не-idle, кроме собственного) — **0**;
* активных сессий PostgREST — **0**;
* активного sync/import — **нет**.

Vercel cron `/api/tochka/cron` — единственный финансовый, ближайший запуск
**2026-09-24 05:00 UTC**, в сегодняшнее окно не попадает.

### Организационная заморозка на время окна

Технически заблокировать `TochkaAutoSync` нечем (Vercel WAF на проекте не провижен,
Routing Config закрыт политикой разрешений, `bank_connections` трогать запрещено),
поэтому на время окна действует договорённость «никто не работает в `basefinance.pro`».
Контроль — повторяемый запрос, его надо прогнать **непосредственно перед 0086** и
после каждого этапа; все пять чисел обязаны остаться нулями:

```sql
select
  (select count(*) from transactions   where created_at > :final_baseline) as tx_new,
  (select count(*) from import_batches where created_at > :final_baseline) as batches_new,
  (select count(*) from obligations    where created_at > :final_baseline) as obl_new,
  (select count(*) from bybit_sync_log where ran_at     > :final_baseline) as bybit_new,
  (select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid()) as active;
```

## 4. ACL после SEC-008 / SEC-009 / SEC-010 — часть deployment baseline

| Функция | ACL | anon | authenticated | PUBLIC | service_role | md5 тела |
|---|---|---|---|---|---|---|
| `bybit_sync_logged(integer)` | `{postgres=X,service_role=X}` | **false** | **false** | **false** | true | `3e7f3ce153e12fb1c13888d87ac8cd85` |
| `support_open_period(uuid,bigint,uuid,uuid)` | `{postgres=X,authenticated=X,service_role=X}` | **false** | true | **false** | true | `b332a171dd6d16f7487656bddb04d5e9` |
| `support_delete_period(uuid)` | `{postgres=X,authenticated=X,service_role=X}` | **false** | true | **false** | true | `4d87c771bb5247159b1099b08ff7f23d` |
| `can_edit_finance(uuid)` | `{postgres=X,authenticated=X,service_role=X}` | false | true | false | true | `0ff8b18bf0651455d30161c2cfee7548` |
| `can_write_tx(uuid)` | `{postgres=X,authenticated=X,service_role=X}` | false | true | false | true | `addf136b5875129e41e039568060e4af` |
| `can_manage_team(uuid)` | `{postgres=X,authenticated=X,service_role=X}` | false | true | false | true | `6faebe15486a4d16f6257a7806e428f0` |

Это состояние — часть deployment baseline; после 0086–0092 оно обязано сохраниться.

## 5. Recovery point

| Показатель | Значение |
|---|---|
| `archive_mode` | **on** |
| `wal_level` | logical |
| архивных WAL накоплено | **7 066+** |
| ошибок архивации (`failed_count`) | **0** |
| `last_archived_wal` | `000000010000001B00000082` |
| `last_archived_time` | **2026-09-23 16:06:50 UTC** |
| версия Postgres | 17.6 (`17.6.1.127`, release channel `ga`) |
| статус проекта | `ACTIVE_HEALTHY`, регион `eu-central-1` |
| **предлагаемый `recovery_point_utc`** | **2026-09-23 16:06:15 UTC** (момент FINAL baseline) |

Непрерывная архивация WAL включена и работает без единой ошибки, WAL за момент
FINAL baseline уже уехал в архив (архивирован в 16:06:50, через 35 секунд).
Это **необходимое условие** PITR.

**Чего я подтвердить не могу.** Включён ли на проекте сам add-on PITR и какое у него
recovery window — доступным инструментарием не видно: `get_project` возвращает только
статус, регион и версию, отдельного инструмента по бэкапам в Supabase MCP нет, а
Management API по бэкапам мне недоступен. `archive_mode = on` — не доказательство
add-on'а. Восстановление, разумеется, не запускал.

**Требуется ваше подтверждение в Dashboard:** проект `basa-finance`
(`kmvsjozxjosmkhvphzdz`) → **Database → Backups**. Если вкладка *Point in Time*
активна — убедитесь, что **2026-09-23 16:06:15 UTC** попадает в доступное окно, и это
и есть `recovery_point_utc`. Если PITR выключен — там же указан последний
ежедневный бэкап и его timestamp; в этом случае, по вашему же правилу, **0086 не
применяем**, и решение за вами.

Я 0086 самостоятельно не применяю в любом случае — жду Разрешения №2B.

## 6. Migration drift

### 6.1. 0091 после hotfix остаётся безопасно идемпотентной — доказано исполнением

`scripts/concurrency/sec010_test.sh`: hotfix → повторный hotfix → 0091.
Поведение всех пяти вызывающих (`anon`, authenticated не-участник, viewer,
участник с правом финансов, service_role) после каждого шага идентично.

```
SEC-008/010: PASS=25 FAIL=0
AUTHZ MODE=post: PASS=21 FAIL=0
regression: MODE=pre PASS=2 FAIL=12 (воспроизводится, как и ожидалось) · MODE=post PASS=14 FAIL=0
```

ЧАСТЬ A 0091 — `create or replace` с дословно тем же телом, что уже в production
(hotfix брал её один-в-один) → no-op. ЧАСТЬ B — `revoke` уже снятых грантов → no-op,
плюс `grant execute … support_delete_period to authenticated`, который уже есть.

### 6.2. SEC-009 не будет случайно отменён последующей миграцией

Проверено по всему репозиторию миграций:

* ни одной конструкции `grant … on all functions` / `on all routines` — **нет вообще**;
* во всём диапазоне 0085–0092 нет ни одного `grant` роли `anon` или `PUBLIC`; все гранты адресованы только `authenticated` (и это существующие функции приложения);
* `bybit_sync_logged` встречается в 0086–0092 ровно один раз — в **списке revoke** 0091. Пропущенный revoke не может вернуть снятый грант.

**Вывод: ACL `bybit_sync_logged(integer)` после 0086–0092 останется
`{postgres, service_role}`.**

### 6.3. Ошибочная сигнатура `bybit_sync_logged()` в 0091 — исправлена в репозитории

Для **production** она была безобидна (пропущенный revoke ничего не возвращает), но
создавала настоящий drift: **пересборка с нуля из репозитория не закрывала SEC-009** —
функция создавалась с грантом `anon`/`PUBLIC`, а 0091 её пропускал.

В `0091_write_paths_and_authz.sql` исправлено: `'public.bybit_sync_logged()'` →
`'public.bybit_sync_logged(integer)'`. Файл нигде не применён, поведение на production
не меняется (revoke уже снятого гранта — no-op).

Добавлена регрессия, которая это доказывает: в одноразовой БД создаётся
`bybit_sync_logged(integer)` с уязвимым ACL, затем применяется 0091 из репозитория.

```
drift bybit ACL до 0091     PASS  уязвимое состояние воспроизведено      (anon=true,  PUBLIC=true)
drift bybit ACL после 0091  PASS  0091 из репозитория закрывает SEC-009  (anon=false, PUBLIC=false)
drift support_open ACL      PASS  anon/PUBLIC закрыты, authenticated сохранён
drift support_delete ACL    PASS  anon/PUBLIC закрыты, authenticated сохранён
```

Вторую ошибочную сигнатуру — `next_document_number(uuid, text)` вместо фактической
`(uuid, text, text)` — **намеренно не трогал**, чтобы не менять поведение миграции
перед окном: это SEC-011, вынесенный в post-deploy hardening. В файле поставлен
комментарий с фактической сигнатурой.

Дефект самого теста, найденный по ходу: сравнение ожидало `t/f`, а `||` над boolean
даёт `true/false` — первый прогон дал 4 ложных FAIL при верных фактических значениях.
Исправлено, цифры выше сняты после исправления.

### 6.4. Соответствие migration history репозиторию — расхождение есть, и оно не от hotfix'ов

Последняя запись в `supabase_migrations.schema_migrations` —
`20260918141630 fix_inv06_dates`; записей 0086+ нет. Но история **уже** не совпадает
с репозиторием, и это состояние до нас:

| Расхождение | Что именно |
|---|---|
| только в репозитории (не применено) | `0085_sec001_restrict_sync_log_read.sql` |
| только в production (нет в репозитории) | `enable_rls_orphan_public_tables`, `add_apacific_counterparty_and_obligations`, `split_inv01_apacific_by_line_items`, `reclassify_radist_288_to_licenses`, `fix_apacific_obligations_scale_x100`, `add_apacific_invoices_ko127`, `add_maison_invoices_04_05_06`, `fix_inv06_dates` |
| именование | после `0082` записи в production названы по смыслу (`bank_connections`, `vault`, `notifications`, …), а не по номерам файлов |
| применено, но не записано | оба SEC-hotfix'а (SEC-009 и SEC-008/010) выполнены обычным SQL и в `schema_migrations` не попали |

После 0086–0092 история получит эти семь записей; перечисленные выше расхождения
останутся. Схемно production и репозиторий сойдутся (тела и гранты хелперов и
`support_*` совпадают с тем, что делает 0091), но **формально `schema_migrations`
репозиторию не равна и до развёртывания не была**.

Чтобы убрать расхождение по hotfix'ам, предлагаю (не делал, требует разрешения):
оформить их как `0093_sec_hotfixes.sql` с тем же содержимым — в production это
полный no-op, зато репозиторий станет воспроизводимым. Решение за вами в 2B.

---

## Итог гейта

| Пункт | Статус |
|---|---|
| FINAL baseline | ✅ совпал по всем 12 позициям, 16:06:15 UTC |
| Новых transactions / import_batches / Bybit events | ✅ ноль с 07:24:20 UTC; последняя запись 06:04 UTC |
| pg_cron | ✅ обе задачи `active=false`, пропущены слоты 09:00 / 12:00 / 15:00 UTC |
| Активные сессии и sync | ✅ 0 backend'ов, 0 PostgREST, импорт не идёт |
| ACL после SEC-008/009/010 | ✅ зафиксирован, входит в deployment baseline |
| 0091 идемпотентна после hotfix | ✅ доказано исполнением, 25/0 + 21/0 + 14/0 |
| SEC-009 переживает 0086–0092 | ✅ доказано анализом всех миграций и тестом |
| Ошибочная сигнатура `bybit_sync_logged()` | ✅ исправлена в репозитории, на production не влияет |
| Migration history == repository | ⚠️ **нет** — расхождение существует и до развёртывания, состав перечислен в §6.4 |
| Recovery point | ⚠️ **требует вашего подтверждения в Dashboard** — WAL-архивация on и здорова, но наличие add-on PITR из доступного инструментария не видно |

**STOP.** Больше ничего не менял. Жду Разрешения №2B на 0086–0092.
