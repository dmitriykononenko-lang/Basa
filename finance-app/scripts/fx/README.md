# scripts/fx — подготовка FX-перехода

Материалы к отдельному PR по FIN-01/FIN-02. **Ничего из этого не применяется
к production.** Дизайн — `../../FX_IMPLEMENTATION_DESIGN.md`, анализ —
`../../FX_CUTOVER_ANALYSIS.md`.

## Состав

| Файл | Что это |
|---|---|
| `fx_prototype.sql` | **прототип** FX-слоя (не миграция): `fx_quotes`, `fx_calendar`, `fx_rate_on`, `fx_resolve`, триггер снимка, кэпы FIN-02, распределение split |
| `fx_test.sh` | 20 тестов семантики: выходные/праздники, пробел загрузки, номинал, planned→actual, immutability, split до копейки, два кэпа |
| `dry_run_backfill.sql` | dry-run пересчёта операций после cutover (только SELECT) |

```bash
bash scripts/concurrency/run.sh                      # создаёт t_post
psql -d t_fx -f scripts/fx/fx_prototype.sql          # t_fx = копия t_post
DB=t_fx bash scripts/fx/fx_test.sh                   # ожидается 20/20 PASS
```

## dry_run_backfill.sql

Только `SELECT`. Показывает по каждой операции после cutover: старую рублёвую
оценку, применённый курс ЦБ и его дату, новую `base_amount`, дельту и затронутые
разрезы. Запускается на production без риска.

```bash
psql "$DATABASE_URL" -f scripts/fx/dry_run_backfill.sql
```

## Где взять котировки ЦБ

Из среды аудита внешний доступ к ЦБ **закрыт политикой сети** (`CONNECT → 403`
для `www.cbr.ru` и `www.cbr-xml-daily.ru`). Приложение на Vercel эти хосты уже
вызывает, поэтому загрузчик должен работать там, а не из CI.

| Задача | Endpoint |
|---|---|
| Разовый бэкофилл истории USD | `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/08/2026&date_req2=<сегодня>&VAL_NM_RQ=R01235` |
| Курсы на дату (все валюты) | `https://www.cbr.ru/scripts/XML_daily.asp?date_req=DD/MM/YYYY` |
| Зеркало (резерв, JSON) | `https://www.cbr-xml-daily.ru/archive/YYYY/MM/DD/daily_json.js` |

Коды валют ЦБ: USD = `R01235`, EUR = `R01239`, CNY = `R01375`, GBP = `R01035`,
KZT = `R01335`, UAH = `R01720`.

**Номинал обязателен**: курс за единицу = `Value / Nominal` (KZT — 100, UAH — 10).

## Правило «курс, действующий на дату»

ЦБ публикует курс, который действует до следующей публикации. Но резолвинг
`max(rate_date) <= D` сам по себе недостаточен: при пробеле загрузки он молча
вернёт более старый курс. Поэтому источником истины служит таблица
`fx_calendar` — что сам ЦБ ответил про **каждую календарную дату**
(`derivation='SOURCE_DECLARED'`). Нет строки календаря → `FX_RATE_MISSING`,
а не «возьмём предыдущую».

На реальных данных cutover-периода курс предыдущей публикации применяется в
**26 случаях из 33** — это основной путь, а не крайний случай.
