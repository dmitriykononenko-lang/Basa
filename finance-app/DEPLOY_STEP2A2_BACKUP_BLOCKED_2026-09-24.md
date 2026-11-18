# Разрешение №2A.2 — STOP на шаге 2: backup из этой сессии снять нельзя

Дата: **2026-09-24**. Backup **не снят**, restore и репетиция **не выполнялись**.
0086–0092 **не применены**, PR #99 **не merge/deploy**, maintenance lock **не снят**,
pg_cron **не включался**. FIN-03 cleanup, `opening_balance`, FX, SEC-011 не тронуты.
Production **не изменялся**: только SELECT.

---

## Шаг 1 — предполётные проверки: всё сходится

| Проверка | Значение |
|---|---|
| deployment | `dpl_GSoPbNicTYUKDAoMdzALdw1pMCRp` → `githubCommitSha` **67e9a79**, READY, alias `basefinance.pro` |
| `LOCK_DEFAULT` | `true` (`src/lib/maintenance.ts:26` в развёрнутой ветке) |
| `GET /api/tochka/cron` | **503** `{"ok":false,"locked":true,…}` |
| pg_cron | `1:bybit-sync-daily active=false \| 2:tochka-autosync active=false` |
| active sync/import | **0** |

Финансовый baseline на **13:33:59 UTC** — **совпадает с принятым 13:28:53 полностью**:

```
transactions 7 970 · actual/planned 7 962 / 8 · import_batches 275
obligations 190 · allocations 97 · invoices 25 · invoice_items 22 · splits 4
dup auto-accrual 1 · RUB −11 398 192 · USDT 305 451
opening_balance 61 904 483 · accounts 24 · counterparties 159
последняя операция 2026-09-23 16:56:36 · last_synced_at 2026-09-24 08:26:54
```

Дельты нет — STOP по причине «baseline изменился» не наступил.

## Шаг 2 — backup снять невозможно. Проверено заново сегодня

| Что нужно | Состояние в этой сессии |
|---|---|
| `pg_dump` ≥ 17 (сервер 17.6) | есть только **16.13** → «server version mismatch» |
| `postgresql-client-17` через apt | `apt.postgresql.org` → **HTTP 000**, режет сетевая политика |
| docker | CLI есть, **демон не запущен** (`/var/run/docker.sock` отсутствует) |
| Supabase CLI | не установлен (npm доступен, поставить можно — но см. строку ниже) |
| сеть до `db.<ref>.supabase.co:5432` | хост резолвится **только в IPv6**, соединения нет |
| сеть до `aws-0/aws-1-eu-central-1.pooler.supabase.com:5432` | IPv4 резолвится, **TCP-соединение не устанавливается** |
| `https://<ref>.supabase.co` | **HTTP 000** |

Решающий блокер — **сеть**: без TCP-доступа к БД не поможет никакой клиент.
MCP-инструменты Supabase ходят отдельным маршрутом и протокол `pg_dump` не несут.
Заменять `pg_dump` самописным SQL-экспортом не стал: это прямо против условия
«стандартный PostgreSQL/Supabase-supported механизм».

### Что удалось продвинуть

Нашёл способ получить **сервер PostgreSQL 17.6 без docker и без apt** — из npm,
который в этой сессии доступен:

```
npm i @embedded-postgres/linux-x64@17.6.0-beta.15
→ native/bin/{initdb, pg_ctl, postgres}   (проверено: initdb/postgres 17.6)
```

Это снимает зависимость от docker для **цели восстановления**. Но
`pg_dump`/`pg_restore`/`psql` этот пакет не содержит, а главное — сеть до
production всё равно закрыта. Поэтому шаг 2 остаётся невыполнимым здесь.

## Шаги 3–5 — не выполнялись

Restore, сверка по 27 показателям, репетиция 0086–0092 и проверка отката требуют
дампа, снятого **сейчас**. Дампа нет. Подменять его старой тестовой БД я не стал —
вы это прямо запретили, и это было бы выдачей синтетической фикстуры за
восстановленную копию production.

## Что сделано взамен: скрипт доведён до полного объёма 2A.2

`scripts/backup/backup_and_verify.sh` (248 строк) теперь закрывает пункты 2–5
целиком, одной командой с вашей машины:

1. **предполётная проверка** — активные сессии, pg_cron, счётчики;
2. **снимок 27 ожидаемых показателей с живого production** (не зашиты в код);
3. **`pg_dump -Fc --compress=9`** по `public` + `supabase_migrations`, метаданные:
   start/end UTC, размер, SHA-256, sanitized source (пароль затёрт), версии
   сервера и `pg_dump`, **оглавление дампа** (`pg_restore --list`) с разбивкой по
   типам объектов, плюс `SHA256SUMS`;
4. **дополнительные артефакты**: роли через `supabase db dump --role-only`,
   определения `cron.job` **без поля `command`** (оно содержит секрет, OPS-01);
5. **restore** в одноразовый PostgreSQL 17 с ролями Supabase и заглушкой `auth.uid()`;
6. **сверка 27 показателей**: структура (tables, views, functions, triggers,
   indexes, constraints, **таблицы с RLS**, policies, sequences, migration
   metadata), финансы (counts/sums, FIN-03, `opening_balance`, **инвариант
   split‑сумм**), security (ACL шести функций + `md5(pg_get_functiondef)`);
7. **явный отчёт о непокрытом** — `vault.secrets`, `cron.job`, `net.*`,
   `auth.users`, `storage.*`, файлы Storage; с прямой строкой «это НЕ полный
   disaster-recovery restore, восстановлены только `public` и
   `supabase_migrations`». Успехом это не маскируется;
8. **репетиция 0086→0092** в production-порядке, с временем каждой миграции и
   счётчиком notices/warnings; остановка на первой ошибке;
9. **integrity audit** на копии с явным ожиданием двух известных findings
   (FIN-03 = 126, duplicate auto-accrual = 1 — миграции по дизайну их не правят);
10. **наборы T1–T14 / AUTHZ / SPLIT / SEC-008-010** — помечены как прогон на
    синтетической фикстуре, а не на копии production;
11. **откат `0092_down → … → 0086_down`** с `0087_functions_before.sql` перед
    `0087_down`, и **построчный diff** состояния после отката против состояния
    сразу после restore. Расхождение печатается с явным «production migrations
    не разрешать до разбора».

### Исправлен мой собственный дефект

Правило `backup/` в `.gitignore`, которое я добавил вместе с планом бэкапа, молча
поглощало каталог `finance-app/scripts/backup/` — из-за этого скрипт в прошлый раз
**не попал в коммит**, хотя я о нём отчитался. Правило заменено на якорное
`/backup/` в обоих `.gitignore`; скрипт теперь отслеживается. Прошу прощения за
неверный отчёт в прошлый раз.

## Что нужно, чтобы шаг 2 выполнил я, а не вы

Оба условия одновременно:

1. **Сеть.** Расширить Network access окружения сессии: меню облачного окружения
   в заголовке сессии → Edit → Network access. Нужен исходящий TCP на
   `aws-0-eu-central-1.pooler.supabase.com:5432` (или IPv6 к
   `db.kmvsjozxjosmkhvphzdz.supabase.co:5432`). Уровни доступа описаны в
   https://code.claude.com/docs/en/claude-code-on-the-web — обратите внимание, что
   для сырого TCP, скорее всего, потребуется самый широкий уровень, а не
   добавление домена в список.
2. **Клиент.** Разрешить `apt.postgresql.org` (тогда встанет
   `postgresql-client-17`) либо поднять docker-демон.

Плюс сам пароль БД — его я не запрашиваю и в отчёт не выводил бы.

Если проще запустить у себя — команда в начале скрипта, всё остальное он сделает
сам и сложит артефакты в `~/basa-backup-<TS>/` вне репозитория.

---

## Статус

* Шаг 1 пройден, baseline не изменился.
* Шаг 2 невозможен из этой сессии — блокер сетевой, не обходится.
* Шаги 3–5 не начинались; подмены восстановленной копии синтетической БД не было.
* Скрипт доведён до полного объёма 2A.2, включая проверку отката.
* Production не тронут, замок на месте, pg_cron disabled.

**STOP.** Жду вашего решения: расширять доступ сессии или запускать скрипт у себя.
