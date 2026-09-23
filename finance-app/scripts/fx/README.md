# scripts/fx — подготовка FX-перехода

Материалы к отдельному PR по FIN-01/FIN-02. **Ничего из этого не применяется
к production.** Дизайн — `../../FX_IMPLEMENTATION_DESIGN.md`, анализ —
`../../FX_CUTOVER_ANALYSIS.md`.

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

ЦБ публикует курс, который действует до следующей публикации. Поэтому курс на
дату `D` = котировка с максимальной `rate_date <= D`. На реальных данных
cutover-периода этим правилом определяется **26 из 33** операций — то есть это
основной путь, а не крайний случай.
