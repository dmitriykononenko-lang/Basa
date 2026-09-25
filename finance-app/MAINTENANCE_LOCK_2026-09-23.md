# Управляемый maintenance lock банковского импорта — подготовлено, не развёрнуто

Дата: **2026-09-23**. Это **не** Разрешение №2B.
Backup **не снимался**, 0086–0092 **не применены**, PR #99 **не merge/не deploy**.
Production **не изменялся**: за этот шаг только SELECT и локальная сборка.
pg_cron остаётся `active=false`. FIN-03 cleanup, `opening_balance`, FX, SEC-011 не тронуты.

---

## Требование 9 — готового механизма, закрывающего все три пути, нет

| Кандидат | Закрывает `/auto-sync` | Закрывает `/cron` | Закрывает `/import` | Вывод |
|---|---|---|---|---|
| `CRON_SECRET` («рубильник» в коде маршрута) | нет — маршрут его не проверяет | да | нет — маршрут его не проверяет | покрывает 1 из 3 |
| pg_cron `active=false` | нет — вызов идёт из браузера | нет — расписание в `vercel.json` | нет | покрывает 0 из 3 |
| Vercel Firewall | — | — | — | на проекте не провижен (`404 Seawall Config not found` на GET/PUT/PATCH) |
| Vercel Routing Config | — | — | — | вызов закрыт политикой разрешений сессии |
| revoke `select` на `bank_connections` | да | нет (service_role) | да | **запрещено требованием 4** |

Поэтому — новый серверный guard, ровно как в требовании 5.

## Механика

Новый файл `src/lib/maintenance.ts`:

```ts
const OFF = new Set(["false", "0", "no", "off"]);

export function financialImportsLocked(): boolean {
  const raw = (process.env.FINANCIAL_IMPORTS_DISABLED ?? "").trim().toLowerCase();
  if (raw === "") return false;
  return !OFF.has(raw);
}
```

Семантика намеренно fail-closed **в сторону «заблокировано»**: переменной нет —
обычный режим; явные `false/0/no/off` — обычный режим; **любое другое значение,
включая опечатку вроде `ture`, означает заморозку.** Опечатка не должна тихо
открыть импорт.

Ответ — `503` с `Retry-After: 3600` и `Cache-Control: no-store`:

```json
{"ok":false,"locked":true,"error":"Импорт банковских операций временно приостановлен на время технических работ"}
```

Guard вставлен **первым оператором** каждого из трёх обработчиков:

* `POST /api/tochka/auto-sync` — до `getCurrentTeam()`, то есть до чтения cookie и до любого запроса к БД;
* `GET /api/tochka/cron` — **раньше проверки `CRON_SECRET`**, чтобы не записывалась даже строка `skipped_no_secret` в `tochka_sync_log`;
* `POST /api/tochka/import` — до разбора `?debug=1`. `?debug=1` тоже блокируется: это маршрут импорта, а не read-only endpoint из требования 2.

Требование 6 выполняется по построению: до guard'а не происходит ни обращения к
API Точки, ни создания `import_batches`, ни сдвига `bank_connections.last_synced_at`,
ни единой записи в `transactions`.

Требование 7: `TochkaAutoSync` не трогался. Он продолжит звать endpoint, получит
503 и молча его проглотит (`r.ok ? r.json() : null`) — интерфейс не сломается,
а записи не произойдёт. Защита целиком серверная.

Требования 2 и 3: read-only маршруты (`/test`, `/suggest`, `GET /mapping`) не
изменены ни одной строкой; Bybit pg_cron остаётся `active=false`.

## Diff

```
 finance-app/src/app/api/tochka/auto-sync/route.ts |  3 ++
 finance-app/src/app/api/tochka/cron/route.ts      |  4 +++
 finance-app/src/app/api/tochka/import/route.ts    |  4 +++
 finance-app/src/lib/maintenance.ts                | 36 +++++++++++++++++++++++
 4 files changed, 47 insertions(+)
```

Пример вставки (`auto-sync`):

```diff
 export async function POST() {
+  // Техническая заморозка импорта — до любых обращений к БД и к API Точки.
+  if (financialImportsLocked()) return financialImportsLockedResponse();
   const current = await getCurrentTeam();
```

Готовый патч **против `origin/main`** — `finance-app/maintenance-lock.patch`.
Проверено: `git apply --check` на чистом `origin/main` проходит без конфликтов.

## Локальные доказательства (production не затронут)

`next build` прошёл, `tsc --noEmit` без ошибок.

### Слой 1 — собранное приложение, `next start` на 127.0.0.1:3111

| Запрос | без флага | `FINANCIAL_IMPORTS_DISABLED=true` |
|---|---|---|
| `GET /api/tochka/cron` | **401** `{"error":"Unauthorized"}` | **503** `{"ok":false,"locked":true,…}` |
| `POST /api/tochka/auto-sync` | 307 → `/login` | 307 → `/login` |
| `POST /api/tochka/import` | 307 → `/login` | 307 → `/login` |
| `GET /api/tochka/test` | 307 → `/login` | 307 → `/login` |
| `POST /api/tochka/suggest` | 307 → `/login` | 307 → `/login` |
| `GET /api/tochka/mapping` | 307 → `/login` | 307 → `/login` |

`/cron` исключён из middleware, поэтому по нему виден чистый переход 401 → 503.
Остальные маршруты без сессии до обработчика не доходят — их 307 одинаков в обоих
режимах, что заодно показывает: **read-only endpoints guard не задел**.

### Слой 2 — прямой вызов обработчиков в обход middleware

| Значение переменной | `/auto-sync` | `/import` | `/cron` |
|---|---|---|---|
| не задана | прошёл guard, упал на `cookies()` | прошёл guard, упал на `cookies()` | 401 |
| `true` | **503** | **503** | **503** |
| `ture` (опечатка) | **503** | **503** | **503** |
| `false` | прошёл guard, упал на `cookies()` | прошёл guard, упал на `cookies()` | 401 |

Падение на `cookies() was called outside a request scope` — это и есть
доказательство места guard'а: без заморозки исполнение доходит до самого первого
обращения к сессии БД, а с заморозкой не доходит.

## Требование 8 — для включения нужен деплой, и он не должен быть PR #99

Две вещи требуют деплоя: сам код guard'а и переменная окружения — Vercel
применяет изменения env только к новым деплоям, на уже развёрнутые функции они
не действуют. Значит и включение, и выключение замка — это деплой.

**Важно:** текущая ветка `claude/intelligent-ramanujan-Jdbbu` содержит весь PR #99,
её деплоить нельзя. Из трёх маршрутов от `main` отличается только
`auto-sync/route.ts` (изменения PR #99), поэтому патч подготовлен именно против
`main` и применяется к нему чисто. Отдельную ветку я не создавал и не пушил —
это требует вашего разрешения.

Порядок, когда разрешите:

```bash
git fetch origin main
git checkout -b maintenance-lock origin/main
git apply finance-app/maintenance-lock.patch
git commit -am "maintenance lock: серверный стоп банковского импорта"
git push -u origin maintenance-lock
```

Затем в Vercel: `FINANCIAL_IMPORTS_DISABLED=true` в Production и деплой ветки
`maintenance-lock`. Снятие замка происходит следующим деплоем — им и будет
развёртывание PR #99 (в нём переменную не задаём либо ставим `false`).

Альтернатива, если не нравится «два деплоя»: держать флаг в БД и переключать
его SQL-запросом без деплоя. Это потребует маленькой новой таблицы, то есть
schema change — предлагать её перед окном не стал.

## Требование 10 — что предстоит доказать после деплоя

До деплоя эти проверки невыполнимы. Команды готовы:

```bash
for p in auto-sync import; do curl -si -X POST https://basefinance.pro/api/tochka/$p | head -1; done
curl -si https://basefinance.pro/api/tochka/cron | head -1          # ожидание: 503
curl -si https://basefinance.pro/api/tochka/test | head -1          # ожидание: 307 → /login, НЕ 503
curl -si -X POST https://basefinance.pro/api/tochka/suggest | head -1
curl -si https://basefinance.pro/api/tochka/mapping | head -1
```

Дополнительно с живым сеансом сотрудника: открыть `basefinance.pro`, дождаться
срабатывания `TochkaAutoSync` и убедиться, что `import_batches` и `transactions`
не выросли, а `bank_connections.last_synced_at` не сдвинулся. Плюс контрольный
запрос из FINAL GATE и статус pg_cron.

## Состояние production на 19:14:11 UTC

Замок не развёрнут, поэтому технической заморозки ещё нет. Но с момента принятого
вами baseline (16:59:28 UTC) ничего не изменилось:

| Проверка | Значение |
|---|---|
| новых `transactions` | **0** |
| новых `import_batches` | **0** |
| новых строк `bybit_sync_log` | **0** |
| прогонов pg_cron | **0** |
| активных backend'ов | **0** |
| pg_cron | `1:bybit-sync-daily active=false \| 2:tochka-autosync active=false` |

Baseline держится: transactions **7 970**, actual/planned **7 962 / 8**,
import_batches **275**, obligations 190, allocations 96, invoices 25, splits 4,
dup auto-accrual 1, RUB flow **−11 398 192**, USDT **305 451**,
Σ `opening_balance` **61 904 483**. Последняя запись — 16:56:36 UTC.

Пересниматъ FINAL baseline как «замороженный» не стал: замка нет, гарантии нет.
Это будет корректно сделать сразу после доказанного включения замка.

---

## Что нужно от вас

1. Разрешение создать и запушить ветку `maintenance-lock` от `main`.
2. Разрешение на деплой этой ветки с `FINANCIAL_IMPORTS_DISABLED=true`.

Дедлайн прежний: Vercel cron `/api/tochka/cron` сработает **2026-09-24 в 05:00 UTC**.
После деплоя замка он тоже будет получать 503 и импорт не выполнит.

`scripts/backup/backup_and_verify.sh` сохранён и станет следующим шагом.

**STOP.**
