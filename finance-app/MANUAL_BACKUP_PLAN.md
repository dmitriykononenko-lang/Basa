# План ручного pre-deployment backup production DB

Статус: **план, ничего не выполнено.** Ни одного экспорта не делалось, production не менялся,
pg_cron остаётся `active=false`, 0086–0092 не применены.

Контекст: проект `basa-finance` (`kmvsjozxjosmkhvphzdz`) на Free Plan — бэкапов и PITR нет,
поэтому `recovery_point_utc = 2026-09-23 16:06:15 UTC` точкой восстановления считать нельзя.
Ручной дамп — замена этой точки.

---

## 0. Два ограничения, из-за которых снимать дамп надо НЕ из этой сессии

1. **Версия клиента.** Сервер — PostgreSQL **17.6**. В этом контейнере доступен только
   клиент **16.13** (`/usr/lib/postgresql/16/bin`), Supabase CLI отсутствует.
   `pg_dump 16` откажется работать с сервером 17 («aborting because of server version mismatch»).
   Нужен `pg_dump` **≥ 17**.
2. **Сеть.** Из контейнера `https://kmvsjozxjosmkhvphzdz.supabase.co` недоступен
   (сетевая политика, `curl` → код 000), а `db.kmvsjozxjosmkhvphzdz.supabase.co`
   резолвится только в IPv6 («Address family not supported»). MCP-инструменты Supabase
   ходят другим маршрутом и для `pg_dump` не годятся.

**Вывод: команды ниже выполняются с вашей машины.** Если IPv6 нет — берите строку
подключения **Session pooler** (IPv4): Dashboard → Project Settings → Database →
Connection string → *Session pooler*. Не транзакционный (порт 6543) — `pg_dump`
требует session-режим.

Если `pg_dump 17` ставить не хочется, самый надёжный вариант — Docker:

```bash
docker run --rm -v "$PWD:/out" -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_dump "<DB_URL>" ...
```

---

## 1. Точная команда backup

Подготовка (пароль в переменной окружения, не в истории команд):

```bash
export TS=$(date -u +%Y%m%dT%H%M%SZ)
export OUT="$HOME/basa-backup-$TS"        # ВНЕ репозитория
mkdir -p "$OUT" && chmod 700 "$OUT"
read -rsp 'DB password: ' PGPASSWORD; export PGPASSWORD; echo
export DB_URL='postgresql://postgres.kmvsjozxjosmkhvphzdz@<POOLER_HOST>:5432/postgres?sslmode=require'
```

`<POOLER_HOST>` скопируйте из Dashboard — угадывать имя хоста не нужно.

### 1A. Основной артефакт — точка восстановления для 0086–0092

Миграции 0086–0092 трогают **только схему `public`**, поэтому именно этот дамп и есть
рабочая точка возврата. Привилегии и владельцев сохраняем намеренно (`--no-owner`
и `--no-privileges` НЕ передаём — иначе потеряются grants/ACL, а они часть baseline).

```bash
pg_dump "$DB_URL" \
  --format=custom --compress=9 --verbose \
  --schema=public --schema=supabase_migrations \
  --file="$OUT/basa_public_$TS.dump" 2> "$OUT/basa_public_$TS.log"
```

### 1B. Полная копия базы — на всякий случай

```bash
pg_dump "$DB_URL" \
  --format=custom --compress=9 --verbose \
  --file="$OUT/basa_full_$TS.dump" 2> "$OUT/basa_full_$TS.log"
```

### 1C. Роли

`pg_dumpall --globals-only` на Supabase недоступен (нужен superuser). Роли снимает CLI:

```bash
supabase db dump --db-url "$DB_URL" --role-only -f "$OUT/basa_roles_$TS.sql"
```

### 1D. То, чего в дампе заведомо не будет — снять отдельно

```bash
# файлы в Storage (в БД лежат только строки метаданных)
supabase storage cp -r "ss:///receipts" "$OUT/storage/receipts" --experimental
supabase storage cp -r "ss:///kb-media" "$OUT/storage/kb-media" --experimental

# определения задач pg_cron (таблицы принадлежат расширению)
psql "$DB_URL" -At -c "select jobid, jobname, schedule, active, command from cron.job order by jobid" \
  > "$OUT/cron_jobs_$TS.txt"   # ВНИМАНИЕ: содержит plaintext CRON_SECRET (OPS-01)
```

### 1E. Контрольная сумма и опись

```bash
cd "$OUT" && sha256sum *.dump *.sql *.txt > SHA256SUMS && cat SHA256SUMS
```

## 2. Точная команда restore

Три уровня, от наименее разрушительного к наиболее. **Сначала всегда пробуем уровень 1.**

### Уровень 1 — штатный откат миграции (основной путь)

Уже подготовлен и отрепетирован: `supabase/migrations/rollback/0086_down.sql … 0092_down.sql`,
плюс `0087_functions_before.sql` (тела функций, снятые с прода) — применять **перед**
`0087_down.sql`. Порядок отката — обратный порядку применения: 0092 → 0086.
Дамп при этом не нужен.

### Уровень 2 — точечное восстановление таблицы из дампа

```bash
pg_restore --data-only --disable-triggers \
  --table=transactions --table=transaction_splits \
  --dbname="$DB_URL" "$OUT/basa_public_$TS.dump"
```

Перед этим целевые таблицы надо очистить, иначе получите дубли:
`truncate public.transactions cascade;` — только под окном обслуживания и осознанно.

### Уровень 3 — полная замена схемы `public` (крайняя мера, приложение должно быть недоступно)

```bash
psql "$DB_URL" -c 'drop schema public cascade; create schema public;'
pg_restore --exit-on-error --no-owner=false \
  --dbname="$DB_URL" "$OUT/basa_public_$TS.dump"
```

Последствия, которые надо принять заранее: удаляются **все** объекты `public`, включая
созданные после снятия дампа; расширение `pg_net` установлено в `public` — после
`drop schema public cascade` его придётся переустановить (`create extension pg_net`);
гранты ролям `anon`/`authenticated`/`service_role` восстановятся из дампа, но роли должны
существовать (в том же проекте существуют).

## 3. Что backup НЕ покрывает

| Не попадает в дамп | Почему | Что делать |
|---|---|---|
| Файлы в Storage (`receipts`, `kb-media`) | лежат в объектном хранилище, в БД только строки `storage.objects` | шаг 1D; объектов сейчас 2, вложений 1 |
| `vault.secrets` (3 секрета: `bybit_api_key`, `bybit_api_secret`, `bybit_sync_secret`) | таблица принадлежит расширению `supabase_vault 0.3.1`; корневой ключ шифрования управляется Supabase и в БД не хранится | восстановление **в тот же проект** — секреты читаются как прежде; в **другой** проект — расшифровать нельзя, значения вводятся заново. Попадают ли строки в дамп физически — проверяется шагом 6 |
| `cron.job`, `cron.job_run_details` | таблицы расширения `pg_cron` | шаг 1D |
| `net.http_request_queue`, `net._http_response` | таблицы расширения `pg_net` | не нужны, это очередь |
| Пароли ролей | `pg_dumpall --globals-only` требует superuser | 1C снимает роли без паролей |
| Конфигурация Auth (JWT secret, провайдеры, SMTP), API-ключи, настройки проекта | вне БД | зафиксировать вручную в менеджере паролей |
| Исходники Edge Functions (`oceaniq-report`, `oceaniq-verify`) | вне БД | `supabase functions download` |
| Vercel: env vars (в т.ч. `CRON_SECRET`, `TOCHKA_TOKEN_KEY`), `vercel.json`, деплои | вне БД | отдельно |
| Всё, что записано **после** момента дампа | дамп — снимок одного мгновения, не непрерывность | поэтому дамп снимается под заморозкой, непосредственно перед 0086 |
| `pg_stat_statements`, статистика планировщика | не дампится | после restore выполнить `analyze` |

Отдельно: `vault_entries.secret_cipher` и `bank_connections.token_cipher` **попадут** в дамп,
но это шифротекст AES-256-GCM; ключи (`VAULT_KEY`, `TOCHKA_TOKEN_KEY`) живут в env Vercel.
Без них дамп эти значения не раскрывает — но и восстановление без ключей их не вернёт.

## 4. Ожидаемый размер

Фактические размеры на 2026-09-23:

| Схема | Размер (с индексами) |
|---|---|
| `public` | 26 MB |
| `auth` | 3 912 kB |
| `storage` | 576 kB |
| `cron` | 312 kB |
| `supabase_migrations` | 288 kB |
| `net` | 208 kB |
| `realtime` | 96 kB |
| `vault` | 80 kB |
| **вся БД** | **35 MB** |

В `-Fc --compress=9` индексы не хранятся (только их определения), данные жмутся:

* **1A (`public` + `supabase_migrations`) — ориентировочно 3–8 MB**;
* **1B (вся БД) — ориентировочно 5–12 MB**;
* 1C, 1D, 1E — десятки килобайт.

Это оценка от размера кучи, а не замер: снять реальный не могу, см. §0.

## 5. Ожидаемое время

При 35 MB и работе через pooler:

* backup 1A — **10–40 с**; 1B — **20–60 с**;
* restore в одноразовый локальный PG 17 — **20–90 с** (основное время на 194 индекса и 585 ограничений);
* restore уровня 3 в production — **1–3 мин** плюс `analyze`.

Ориентир из репетиции: сами миграции 0086–0092 на объёме прода отработали за 0,27–0,7 с,
так что дамп и его проверка — самая долгая часть окна.

## 6. Проверка дампа на одноразовой БД до 0086

Локальный кластер аудита сейчас PostgreSQL **16** — для достоверной проверки нужен **17**
(дамп из 17 в 16 не восстановится). Проще всего контейнером:

```bash
docker run -d --name basa-verify -e POSTGRES_PASSWORD=x -p 5455:5432 postgres:17
V='postgresql://postgres:x@localhost:5455/postgres'

# пролог: роли и расширения, на которые ссылаются владельцы и гранты в дампе
psql "$V" -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create role authenticator nologin; create role supabase_admin superuser nologin;
create role supabase_auth_admin nologin; create role supabase_storage_admin nologin;
create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
SQL

pg_restore --dbname="$V" --no-owner --verbose "$OUT/basa_public_$TS.dump" 2>&1 | tail -30
```

Приёмка — три группы проверок, все числа уже зафиксированы в `DEPLOY_FINAL_GATE_2026-09-23.md`:

**(а) структура**

```sql
select
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,      -- 110
  (select count(*) from information_schema.views  where table_schema='public') as views,                                   -- 3
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,       -- 54
  (select count(*) from pg_trigger where not tgisinternal) as triggers,                                                    -- 33
  (select count(*) from pg_indexes where schemaname='public') as indexes,                                                  -- 194
  (select count(*) from pg_policies where schemaname='public') as policies,                                                -- 194
  (select count(*) from pg_class where relkind='S') as sequences,                                                          -- 8
  (select count(*) from supabase_migrations.schema_migrations) as migrations;                                              -- 123
```

**(б) финансовый baseline** — тот же запрос, что снимал FINAL baseline:
7 959 / 7 951 / 8 · FIN-03 126 · import_batches 269 · obligations 190 · allocations 96 ·
invoices 25 · splits 4 · dup auto-accrual 1 · RUB −10 198 192 · USDT 305 451 ·
Σ `opening_balance` 61 904 483.

**(в) ACL** — таблица из §4 FINAL GATE: `bybit_sync_logged(integer)` = `{postgres, service_role}`;
`support_open_period`/`support_delete_period` и три хелпера = `{postgres, authenticated, service_role}`;
`anon` и `PUBLIC` — везде `false`. Плюс `md5(pg_get_functiondef(...))` шести функций.

**(г) отдельно проверить неопределённость из §3**: попали ли в дамп строки
`vault.secrets` и `cron.job` (таблицы расширений). `select count(*) from vault.secrets;` —
если 0, значит их надо восстанавливать шагом 1D, и это надо знать заранее, а не в момент аварии.

**(д) генеральная репетиция**: на этой же восстановленной копии прогнать 0086–0092 и
`scripts/db_integrity_audit.sql`. Это будет репетиция на настоящих данных, а не на фикстуре.

Дамп считается пригодным только если (а), (б) и (в) сошлись полностью.

## 7. Можно ли снять backup без остановки production

**Технически — да.** `pg_dump` открывает одну транзакцию `REPEATABLE READ` и берёт
`ACCESS SHARE`: он не блокирует `INSERT/UPDATE/DELETE` и даёт согласованный снимок на
момент старта. На 35 MB транзакция живёт секунды, тормоза автовакууму не создаёт.

**По процедуре — нет.** Чтобы дамп был корректной точкой возврата перед 0086, после него
не должно быть ни одной записи. Поэтому порядок такой:

1. pg_cron уже `active=false`;
2. организационная заморозка (никто не работает в `basefinance.pro`);
3. контрольный запрос из §3 FINAL GATE — все пять чисел нули;
4. **снять дамп**;
5. повторить контрольный запрос — числа по-прежнему нули (значит за время дампа никто не писал);
6. только теперь 0086.

И жёсткий дедлайн: Vercel cron `/api/tochka/cron` сработает **2026-09-24 в 05:00 UTC**.
Дамп, снятый до этого момента, после 05:00 перестаёт быть актуальной точкой возврата.

## 8. Хранение и защита от попадания в Git

**Что внутри дампа:** полная финансовая история, персональные данные 158 контрагентов и
сотрудников, `auth.users` (3 записи, e-mail и хеши паролей), шифротексты
`vault_entries.secret_cipher` и `bank_connections.token_cipher`. Файл `cron_jobs_*.txt`
из шага 1D содержит **`CRON_SECRET` открытым текстом** (OPS-01). Это не артефакт для
репозитория и не вложение в PR.

**Git.** Каталог `$OUT` намеренно вне репозитория. Дополнительно в `finance-app/.gitignore`
и корневой `.gitignore` добавлены защитные правила (единственное, что я поменял на этом шаге —
в репозитории, не в production):

```
*.dump
*.dump.age
*.sql.gz
basa-backup-*/
backup/
cron_jobs_*.txt
```

Перед коммитом проверяйте `git status --porcelain` и `git diff --cached --stat`.

**Шифрование при хранении.** Открытым дамп не хранить и не пересылать:

```bash
age -p -o "$OUT/basa_public_$TS.dump.age" "$OUT/basa_public_$TS.dump" && \
  shred -u "$OUT/basa_public_$TS.dump"
# либо: gpg --symmetric --cipher-algo AES256 "$OUT/basa_public_$TS.dump"
```

Парольную фразу — в менеджер паролей, не в переписку и не рядом с файлом.

**Правила хранения:** минимум две копии (рабочая машина + зашифрованный внешний носитель
или приватное объектное хранилище с шифрованием); никаких общих дисков и мессенджеров;
`chmod 700` на каталог, `chmod 600` на файлы; сверять `SHA256SUMS` после каждого переноса;
удалить (`shred -u`) после того, как развёртывание признано стабильным, по вашему решению
о сроке хранения.

**Пароль БД** передавать только через `PGPASSWORD`/`read -rs` или `~/.pgpass` с `chmod 600`;
в `$DB_URL` его не вписывать, иначе он останется в истории оболочки и в `ps`.

---

## Рекомендация

Ручной дамп закрывает окно развёртывания, но он — снимок одного мгновения, а не PITR:
любая запись между дампом и аварией теряется безвозвратно. Для боевой финансовой базы
без бэкапов на плане это отдельный постоянный риск, шире темы PR #99. Переход на план
с PITR стоит решить до развёртывания — тогда ручной дамп становится дублирующей
подстраховкой, а не единственной.

**STOP.** Ничего не выполнено, production не изменён.
