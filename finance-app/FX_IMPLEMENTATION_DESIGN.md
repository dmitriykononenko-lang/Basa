# FX_IMPLEMENTATION_DESIGN.md — дизайн реализации, FIN-02 и dry-run

Дата 2026-09-23. **Ничего не реализовано, production не изменён.**
Этот документ и `scripts/fx/*` — подготовка к **отдельному PR**; в PR #99 нет ни
одной FX-миграции и ни строчки FX-кода. Анализ, на котором всё основано, —
`FX_CUTOVER_ANALYSIS.md`.

Решения заказчика приняты как вход: cutover `2026-08-20`, backfill всех операций
после cutover, `USDT → 1 USD → CBR USD/RUB на дату операции`, `RUB = 1`,
без silent `1:1`, `fx_quotes` глобальная и недоступная пользователям на запись,
snapshot на объекте, без авто-re-fix, invoice фиксируется на дате выставления,
обязательство — на дате начисления, split наследует snapshot.

---

## 1. Модель данных

### 1.1 `fx_quotes` — история котировок (глобальная, только для доверенного механизма)

```sql
create table public.fx_quotes (
  source          text        not null default 'CBR',       -- CBR | CBR_MIRROR | MANUAL
  base_currency   text        not null default 'RUB',
  quote_currency  text        not null,                     -- USD, EUR, CNY, GBP, KZT, UAH
  rate_date       date        not null,                     -- дата, С КОТОРОЙ курс действует
  rate            numeric(18,8) not null check (rate > 0),  -- значение из выгрузки ЦБ (Value)
  nominal         integer     not null default 1 check (nominal > 0),
  rate_per_unit   numeric(18,8) generated always as (rate / nominal) stored,
  fetched_at      timestamptz not null default now(),
  source_url      text,
  raw             jsonb,                                    -- ответ источника как есть
  primary key (source, base_currency, quote_currency, rate_date)
);
```

* **Без `team_id`** — котировки ЦБ одинаковы для всех команд.
* `rate_per_unit` вычисляется в БД: номинал (KZT = 100, UAH = 10) нельзя потерять.
* `raw` + `source_url` + `fetched_at` — аудит происхождения котировки.

Права:

```sql
alter table public.fx_quotes enable row level security;
create policy fx_quotes_read on public.fx_quotes for select using (auth.uid() is not null);
revoke insert, update, delete, truncate on public.fx_quotes from authenticated, anon;
grant select on public.fx_quotes to authenticated;
-- запись только service_role (загрузчик), через SECURITY DEFINER RPC с проверкой is_service_role()
```

Таблица **append-only по смыслу**: загрузчик делает `insert ... on conflict do nothing`.
Изменение существующей котировки требует отдельной процедуры с записью в аудит
(см. §4.3) — молча переписать историю нельзя.

### 1.2 Разрешение курса «действующего на дату»

```sql
create function public.fx_rate_on(_currency text, _date date, _base text default 'RUB')
returns table (rate_per_unit numeric, rate_date date, source text)
language sql stable set search_path = public as $$
  select q.rate_per_unit, q.rate_date, q.source
    from fx_quotes q
   where q.quote_currency = _currency and q.base_currency = _base and q.source = 'CBR'
     and q.rate_date <= _date
   order by q.rate_date desc
   limit 1
$$;
```

Это и есть семантика выходных и праздников: ЦБ устанавливает курс, действующий
до следующей публикации, поэтому «курс на дату D» = котировка с максимальной
`rate_date <= D`. Правило работает офлайн и **воспроизводимо**: не зависит ни от
доступности внешнего API, ни от момента запроса.

Если строк нет (дата раньше загруженной истории) — функция возвращает 0 строк,
и вызывающий обязан поставить `FX_RATE_MISSING`. Брать «первую попавшуюся»
котировку запрещено.

### 1.3 Разрешение курса по бизнес-правилу (валюта → RUB)

```sql
create function public.fx_resolve(_currency text, _date date)
returns table (fx_base_currency text, fx_rate numeric, fx_rate_date date,
               fx_source text, fx_method text, fx_status text)
```

| Валюта | `fx_base_currency` | `fx_method` | Курс |
|---|---|---|---|
| `RUB` | `RUB` | `IDENTITY` | `1`, `fx_rate_date = _date`, `fx_source = 'INTERNAL'` |
| `USDT` | **`USD`** | **`USDT_USD_1_TO_1_CBR`** | `fx_rate_on('USD', _date)` |
| `USD, EUR, CNY, GBP, KZT, UAH` | сама валюта | `CBR_DIRECT` | `fx_rate_on(валюта, _date)` |
| прочее / нет котировки | `null` | `null` | `fx_status = 'missing'`, `fx_rate = null` |

`USDT_USD_1_TO_1_CBR` фиксируется явно: это **наше управленческое правило**, а не
утверждение, что ЦБ котирует USDT. Метод хранится на каждой операции, поэтому
позже видно, по какому правилу получена цифра.

### 1.4 Snapshot на финансовых объектах

Один и тот же набор полей на трёх сущностях (общий «FX-снимок»):

```sql
fx_status        text not null default 'legacy'  check (fx_status in ('ok','missing','legacy')),
fx_base_currency text,
fx_rate          numeric(18,8),
fx_rate_date     date,
fx_source        text,
fx_method        text,
base_amount      bigint,          -- сумма в базовой валюте команды (RUB), минорные
fx_pinned_at     timestamptz,
fx_pinned_by     uuid
```

| Сущность | Дата, по которой берётся курс | Комментарий |
|---|---|---|
| `transactions` | `occurred_on` | движение денег |
| `invoices` | `issue_date` | стоимость документа фиксируется при выставлении; оплата — **отдельное событие со своим курсом** |
| `obligations` | `coalesce(period_month, due_date, created_at::date)` | начисление |
| `obligation_payments` | `occurred_on` операции-платежа | см. FIN-02, §3 |

Инвариант (CHECK на каждой таблице):

```
(fx_status = 'ok'      and base_amount is not null and fx_rate is not null)
or (fx_status = 'missing' and base_amount is null)
or (fx_status = 'legacy')
```

`legacy` — всё, что до cutover: не трогаем, отчёты по нему работают по-старому.

### 1.5 Кто и когда ставит snapshot

**Триггер на таблице, а не вызовы из кода.** Пути записи в `transactions` мы уже
пересчитали в PR #99 (21 место в коде + 5 функций БД) — любой из них может
«забыть» FX. Триггер это исключает:

```sql
create trigger transactions_fx_pin
  before insert or update of amount, currency, occurred_on on public.transactions
  for each row execute function public.trg_pin_fx();
```

`trg_pin_fx()`:
1. если `occurred_on < FX_CUTOVER_DATE` → `fx_status='legacy'`, поля FX не заполняются;
2. иначе `fx_resolve(currency, occurred_on)`;
3. `base_amount = round(amount * fx_rate)` при `fx_status='ok'`, иначе `null`;
4. `fx_pinned_at/by` заполняются.

Пересчёт при изменении суммы/валюты/даты — да (это другое экономическое событие).
Пересчёт «потому что подгрузили котировки» — **нет**: изменение `fx_quotes`
никак не трогает уже зафиксированные строки. Это и есть требование
воспроизводимости: отчёт за 25.08.2026 через месяц даст тот же результат.

`FX_CUTOVER_DATE` хранится в таблице настроек (`app_settings`) или как
`current_setting('app.fx_cutover_date')` — не константой в коде функции, чтобы
дату можно было поменять контролируемо и с аудитом.

---

## 2. Split: FX применяется один раз

`transaction_lines` расширяется полями снимка и `base_amount`, но **не пересчитывает
курс**. Части наследуют снимок операции, суммы делятся пропорционально.

Простое `round(base * s.amount / t.amount)` по каждой части **не годится**:
1 000 USD × 78,4321 при делении 60/40 даёт расхождение в копейку. Нужен
детерминированный метод наибольших остатков:

```sql
-- в материализованной функции/вью с оконными функциями:
with p as (
  select s.id, s.transaction_id, s.amount, t.amount tx_amount, t.base_amount tx_base,
         (t.base_amount::numeric * s.amount / t.amount) exact,
         floor(t.base_amount::numeric * s.amount / t.amount)::bigint lo,
         row_number() over (
           partition by s.transaction_id
           order by (t.base_amount::numeric * s.amount / t.amount)
                    - floor(t.base_amount::numeric * s.amount / t.amount) desc,
                    s.id                      -- детерминированный тай-брейк
         ) rn
    from transaction_splits s join transactions t on t.id = s.transaction_id
   where t.base_amount is not null
), agg as (
  select transaction_id, sum(lo) lo_sum, max(tx_base) tx_base, count(*) n from p group by 1
)
select p.id, p.lo + case when p.rn <= a.tx_base - a.lo_sum then 1 else 0 end as base_amount
  from p join agg a using (transaction_id);
```

Свойства: сумма частей **ровно** равна `transactions.base_amount`; распределение
детерминировано (тай-брейк по `id`), то есть повторный расчёт даёт тот же ответ;
ни копейки не теряется и не создаётся.

Инвариант-тест: `Σ base_amount строк = transactions.base_amount` для каждой операции.

Если `fx_status='missing'` — у всех строк `base_amount = null` (не 0).

---

## 3. FIN-02 / R7 — cross-currency allocation

### 3.1 Что реально происходит сейчас (исследовано на production)

Запрос по всем разнесениям, где валюта операции ≠ валюте обязательства, даёт
**20 случаев**, и картина однозначная:

| Операция | Дата | Платёж | Обязательство | `obligation_payments.amount` | Неявный курс |
|---|---|---|---|---|---|
| `1ba26cda…` | **21.09.2026** (после cutover) | 350,00 USDT | 40 000,00 ₽ «Начисление ЗП остаток (авто)» | **28 000,00** | **80,0000** |
| `57edd8b6…` | 19.08.2026 | 300,00 USDT | 25 000,00 ₽ | 24 000,00 | 80,0000 |
| `aaadbdeb…` | 03.08.2026 | 500,00 USDT | три RUB-обязательства | 8 000 + 1 600 + 30 400 = 40 000,00 | 80,0000 |
| `c8ba98a1…` | 07.08.2026 | 38,00 USDT | 3 000,00 ₽ «Агентская комиссия» | 3 000,00 | 78,9474 (частичное разнесение) |

Вывод: `obligation_payments.amount` **уже хранится в валюте обязательства**,
а конвертация делается в браузере по **текущей карте курсов** (`toBase`,
единственный курс 80,00) в момент разнесения. Использованный курс **нигде не
записан** — его можно только угадать делением. Если завтра поменять `fx_rates`,
новые разнесения той же операции пойдут по другому курсу, а старые останутся со
старым — и отличить одно от другого будет нечем.

Именно это и есть запрещённый заказчиком случай: `100 USDT transaction → payment
amount = 100 → RUB obligation` отличается от текущего поведения только тем, что
сейчас туда попадает `100 × 80`, а не `100`. Но **триггер** `settle_obligation_on_tx`
делает ровно запрещённое: он кладёт `new.amount` (сумму **в валюте операции**) в
`obligation_payments.amount` без какой-либо конвертации. Сегодня это не
проявилось только потому, что операции с прямым `obligation_id` были рублёвыми.

### 3.2 Предлагаемая модель

`obligation_payments` получает явную валютную семантику (существующая колонка
`amount` сохраняет смысл «сумма в валюте обязательства», данные не переносятся):

```sql
alter table public.obligation_payments
  add column payment_amount   bigint,        -- сколько ушло из платежа, в ВАЛЮТЕ ПЛАТЕЖА
  add column payment_currency text,          -- валюта платежа (= transactions.currency)
  add column fx_rate          numeric(18,8), -- курс платёж→обязательство (cross rate)
  add column fx_rate_date     date,
  add column fx_source        text,
  add column fx_method        text,          -- CROSS_VIA_RUB | IDENTITY | USDT_USD_1_TO_1_CBR
  add column fx_status        text not null default 'legacy',
  add column base_amount      bigint;        -- стоимость зачёта в RUB (управленческая)
```

Ответы на четыре обязательных вопроса — по одной колонке на каждый:

| Вопрос | Поле |
|---|---|
| payment original amount / currency | `payment_amount`, `payment_currency` |
| allocated amount in obligation currency | `amount` (существующая) |
| FX rate / method | `fx_rate`, `fx_rate_date`, `fx_source`, `fx_method` |
| base RUB amount | `base_amount` |

**Правило конвертации** (курс берётся на дату **операции-платежа**, по решению §9
заказчика — «фактическая операция оплаты получает собственный FX по `occurred_on`»):

```
rate_pay = fx_rate_on(payment_currency, payment_date)     -- RUB за единицу валюты платежа
rate_obl = fx_rate_on(obligation_currency, payment_date)  -- RUB за единицу валюты обязательства
cross    = rate_pay / rate_obl

amount        = round(payment_amount * cross)      -- в валюте обязательства
base_amount   = round(payment_amount * rate_pay)   -- в RUB
```

Для RUB-обязательства `rate_obl = 1`, и `amount = base_amount` — то есть текущая
форма данных сохраняется, но теперь она **выведена явно и записана**.

**Инварианты**:

* `Σ payment_amount по одной операции ≤ transactions.amount` (нельзя разнести
  больше, чем ушло) — сейчас такого ограничения нет вообще, есть только
  «не больше суммы обязательства»;
* `Σ amount по обязательству ≤ obligations.amount` — уже есть (0086);
* `amount = round(payment_amount × fx_rate)` — проверяемо;
* `fx_status='ok' ⟺ base_amount is not null`.

**Курсовая разница** (то, что заказчик просит «уметь учитывать в дальнейшем»)
становится вычислимой без дополнительных полей:

```
fx_difference(obligation) = obligation.base_amount − Σ(payments.base_amount)
```

то есть «рублёвая стоимость начисления по курсу даты начисления» минус
«рублёвая стоимость фактически уплаченного по курсам дат платежей». Аналогично
для инвойса: `invoice.base_amount − Σ(base_amount платежей по нему)`.

### 3.3 Что придётся поменять в коде

| Место | Изменение |
|---|---|
| `settle_obligation_on_tx` (триггер) | сейчас кладёт `new.amount` в `obligation_payments.amount` без конвертации. Должен класть `payment_amount = new.amount`, `payment_currency = new.currency` и считать `amount` через cross-rate. **Обязательно до FX-rollout** |
| `obligation_allocate` (RPC, 0088) | принимает `p_amount` — надо определить, в какой валюте. Предложение: принимать `p_payment_amount` в валюте платежа и считать `amount` внутри; старую сигнатуру оставить как deprecated-обёртку |
| `obligation_pay` (RPC, 0091) | то же |
| `AllocatePaymentButton` | лимит считает в браузере через `toBase`; должен спрашивать у RPC допустимый остаток в валюте платежа и показывать обе суммы |
| `unallocated.ts` | `remainingBase` считает текущим курсом; должен использовать `base_amount` операции и `Σ base_amount` разнесений |
| `obligation_balances` (вью) | добавить `base_amount`, `paid_base`, `outstanding_base` |

### 3.4 Существующие данные

Ничего не чиним вручную. 20 исторических cross-currency разнесений получают
`fx_status='legacy'`; **одно** из них (`1ba26cda…`, 21.09.2026) попадает в
cutover-период и войдёт в backfill вместе со своей операцией.

---

## 4. План миграций (отдельный PR, отдельный деплой)

| # | Миграция | Содержание | Блокировки / риск |
|---|---|---|---|
| **0093** | `fx_quotes` | таблица, индексы, RLS, гранты, `fx_rate_on()`, `fx_resolve()` | только новые объекты |
| **0094** | загрузчик котировок | RPC `fx_quotes_upsert(jsonb)` (только `is_service_role()`), роут `/api/cron/fx-quotes`, запись в Vercel-cron | без изменения данных |
| **0095** | snapshot на `transactions` | 9 колонок + CHECK + `trg_pin_fx()` + `app_settings.fx_cutover_date` | `ADD COLUMN` с дефолтом, без перезаписи |
| **0096** | `transaction_lines` + `base_amount` | распределение остатка методом наибольших остатков | правило округления — ключевой тест |
| **0097** | snapshot на `invoices` и `obligations` | те же поля, свои даты | аналогично |
| **0098** | **FIN-02**: `obligation_payments` + переписанный `settle_obligation_on_tx` + RPC | см. §3 | **самая рискованная**: меняет путь погашения обязательств |
| **0099** | потребители отчётности | чтение `base_amount` для post-cutover, старый путь для legacy, строка «не пересчитано» | UI |
| **B1** | **backfill** `occurred_on >= 2026-08-20` | отдельный шаг с dry-run и подтверждением | **меняет исторические цифры** |

Порядок обязателен: 0093 → 0094 (загрузить котировки) → 0095 … → B1.
Backfill **невозможен** до загрузки котировок: без них всё встанет в
`FX_RATE_MISSING`, что корректно, но бесполезно.

### 4.1 Загрузчик котировок и сетевое ограничение

Из среды аудита внешний доступ к `cbr.ru` и `cbr-xml-daily.ru` **закрыт политикой
сети** (`CONNECT → 403`, подтверждено `/__agentproxy/status`). Приложение на
Vercel эти хосты уже вызывает (`/api/cbr`, страница «Операции»), то есть в
production доступ есть. Следствия для дизайна:

* загрузчик работает **на стороне Vercel/Supabase**, а не из CI и не локально;
* для разового бэкофилла истории (с 01.08.2026) используется
  `XML_dynamic.asp?date_req1=01/08/2026&date_req2=<сегодня>&VAL_NM_RQ=R01235` (USD) —
  один запрос на всю историю вместо запроса на каждую дату;
* ежедневный догруз — `XML_daily.asp` (первоисточник), зеркало
  `cbr-xml-daily.ru` — резерв, с пометкой `source='CBR_MIRROR'`;
* если оба источника недоступны — новые операции получают `FX_RATE_MISSING`,
  импорт и работа приложения **не блокируются**.

### 4.2 Откат

Все миграции 0093–0099 аддитивные → схема совместима со старым кодом;
откат приложения достаточен. `*_down.sql` пишутся по той же схеме, что для
0086–0092. Backfill B1 откатывается из архивной таблицы
`fx_backfill_audit(transaction_id, before jsonb, after jsonb, applied_at, applied_by)`,
которая заполняется **в той же транзакции**, что и сам UPDATE.

### 4.3 Контролируемый пересчёт (re-pricing)

Автоматического пересчёта нет. Если котировку исправили (ЦБ публикует
уточнения редко, но это возможно), пересчёт выполняется явной операцией:

```sql
select fx_repin(_from date, _to date, _reason text);  -- только service_role
```

с записью каждого изменения в `fx_backfill_audit` и обязательным dry-run.

---

## 5. Тест-план (серия FX, добавляется к T1–T14 / S1–S11 / AUTHZ)

| # | Сценарий | Ожидание |
|---|---|---|
| FX1 | операция 1 000 USDT на дату с котировкой | `fx_method=USDT_USD_1_TO_1_CBR`, `fx_base_currency=USD`, `base_amount = round(1000 × rate)` |
| FX2 | операция в RUB | `fx_method=IDENTITY`, `fx_rate=1`, `base_amount = amount` |
| FX3 | операция в валюте без котировки | `fx_status='missing'`, `base_amount is null`, операция создаётся и видна |
| FX4 | `base_amount is null` в отчётах | не превращается в 0, попадает в строку «не пересчитано» |
| FX5 | **выходной**: операция 23.08 (вс) | применён курс ближайшей предшествующей котировки, `fx_rate_date < occurred_on` |
| FX6 | операция ровно на дату публикации | `fx_rate_date = occurred_on` |
| FX7 | **воспроизводимость**: посчитали, затем добавили новую котировку позже | `base_amount` операции **не изменился** |
| FX8 | **воспроизводимость 2**: изменили котировку задним числом | `base_amount` не изменился; изменить можно только через `fx_repin` с аудитом |
| FX9 | смена даты операции | FX перефиксирован, `fx_pinned_at` обновлён |
| FX10 | смена суммы операции | `base_amount` пересчитан по **тому же** курсу |
| FX11 | **split**: 1 000 USD → 60/40 | Σ `base_amount` частей = `base_amount` операции **до копейки**; курс у частей тот же |
| FX12 | split с «неудобным» курсом (78,4321) и делением 1/3–2/3 | остаток распределён детерминированно, повторный расчёт даёт тот же результат |
| FX13 | split при `fx_status='missing'` | у всех частей `base_amount is null` |
| FX14 | **FIN-02**: 350 USDT → RUB-обязательство | `payment_amount=35000 USDT`, `amount` в рублях по курсу даты платежа, `base_amount` заполнен, `fx_method` записан |
| FX15 | FIN-02: `settle_obligation_on_tx` для валютной операции | в `obligation_payments` **не** попадает сумма в валюте операции без конвертации |
| FX16 | FIN-02: `Σ payment_amount ≤ transactions.amount` | переразнесение платежа отклоняется |
| FX17 | курсовая разница | `obligation.base_amount − Σ payments.base_amount` считается и не равна нулю при разных курсах |
| FX18 | invoice 1 000 USDT от 25.08, оплата 10.09 | у инвойса курс 25.08, у платежа — 10.09; стоимость инвойса не переписывается |
| FX19 | нет доступа к источнику котировок | импорт и создание операций работают; новые операции — `FX_RATE_MISSING` |
| FX20 | права | `authenticated` не может писать в `fx_quotes`; `fx_quotes_upsert` требует `is_service_role()` |

Плюс регрессия: весь набор T1–T14, AUTHZ (21), SPLIT (36) должен остаться зелёным.

---

## 6. DRY-RUN backfill (34 USDT-операции)

Скрипт: `scripts/fx/dry_run_backfill.sql` — **только SELECT**, запускается на
production, ничего не меняет. Котировки берёт из `fx_quotes`; пока таблицы нет —
из staging-CTE в шапке скрипта.

### 6.1 Что показывает

По каждой операции: `transaction_id`, дата, тип, валюта, сумма, старая рублёвая
оценка (по единственному курсу 80,00), применённая котировка ЦБ и её дата, новая
`base_amount`, дельта, проект / сотрудник / контрагент / статья, признаки
«есть части» и «есть разнесения». Плюс агрегаты по потребителям.

### 6.2 Прогон на реальных данных (котировки — сценарий, не ЦБ)

Внешний доступ к ЦБ из среды аудита закрыт, поэтому вместо реальных котировок
подставлен **сценарный** набор 79,50 … 83,60 ₽. Все остальные данные — настоящие,
из production. Реальные цифры дельты будут получены после загрузки котировок;
структура и механика проверены.

| Показатель | Значение |
|---|---|
| Операций в cutover-периоде в USDT | **34** (33 `actual` + **1 `planned`**) |
| Строк управленческой аналитики | **35** (одна операция разнесена на 2 части) |
| Оборот | 12 068,00 USDT |
| Текущая оценка (курс 80,00) | 965 440,00 ₽ |
| Оценка по сценарию | 978 223,65 ₽ |
| **Дельта (сценарий)** | **+12 783,65 ₽ (+1,3 %)** |
| `FX_RATE_MISSING` | 0 |
| **Операций, где применён курс предыдущей публикации** | **26 из 33** |
| Затронуто проектов / контрагентов / статей | **5 / 2 / 8** |

Разрез по типам (сценарий):

| Срез | Кол-во | USDT | Было ₽ | Стало ₽ | Дельта ₽ |
|---|---:|---:|---:|---:|---:|
| `actual` расход | 27 | 4 736,00 | 378 880,00 | 386 232,80 | **+7 352,80** |
| `actual` доход | 7 | 6 982,00 | 558 560,00 | 562 905,85 | **+4 345,85** |
| `planned` расход | 1 | 350,00 | 28 000,00 | 29 085,00 | +1 085,00 |

Первые строки построчного прогона (данные операций — настоящие, курс — сценарный):

| Дата | Тип | USDT | Было ₽ | Курс | Дата курса | Пред. публ. | Стало ₽ | Дельта ₽ | Разрез |
|---|---|---:|---:|---:|---|:-:|---:|---:|---|
| 21.08 | доход | 4 000,00 | 320 000,00 | 79,80 | 21.08 | нет | 319 200,00 | −800,00 | проект [129] Garant exchange |
| 21.08 | расход | 100,00 | 8 000,00 | 79,80 | 21.08 | нет | 7 980,00 | −20,00 | Станислав Кутишко |
| **23.08 (вс)** | расход | 50,00 | 4 000,00 | 79,80 | **21.08** | **да** | 3 990,00 | −10,00 | — |
| 24.08 | расход | 300,00 | 24 000,00 | 79,80 | **21.08** | **да** | 23 940,00 | −60,00 | Дмитрий Кононенко |
| 25.08 | расход | 125,00 | 10 000,00 | 80,40 | 25.08 | нет | 10 050,00 | +50,00 | Дмитрий Кононенко |
| 26.08 | расход | 410,00 | 32 800,00 | 80,40 | **25.08** | **да** | 32 964,00 | +164,00 | — |
| 28.08 | доход | 1 300,00 | 104 000,00 | 81,10 | **27.08** | **да** | 105 430,00 | +1 430,00 | — |
| 29.08 | расход | 310,00 | 24 800,00 | 81,10 | **27.08** | **да** | 25 141,00 | +341,00 | Дмитрий Кононенко |

Видно главное: дельта у каждой операции своя и по знаку тоже разная — это не
«сдвиг всего на один коэффициент», а пересчёт по фактической дате.

### 6.3 Что из этого следует для плана

1. **26 из 33 операций** получат курс не своей даты, а предыдущей публикации —
   то есть правило «последняя котировка с `rate_date <= дата`» это не крайний
   случай, а основной путь. Оно должно быть покрыто тестом FX5 и явно видно в
   `fx_rate_date` на операции.
2. **Плановая операция** (`status='planned'`) в cutover-периоде одна. Нужно ваше
   решение: фиксировать ли FX на плановых. Предложение: **да**, по той же дате,
   с перефиксацией при проведении (смена `status`/`occurred_on` и так триггерит
   перефиксацию).
3. Влияние несимметрично: доход и расход двигаются в одну сторону, поэтому
   на прибыль влияет **разница** (+4 345,85 − 7 352,80 = −3 007 ₽ по сценарию),
   а на обороты — полная величина. В отчётах это разные строки.
4. Затронуты 5 проектов, 2 контрагента, 8 статей — то есть backfill меняет не
   только сводные цифры, но и карточки. Их надо перечислить пофамильно в
   финальном dry-run перед подтверждением.

### 6.4 Чего в dry-run ещё нет и нужно добавить до backfill

* реальные котировки ЦБ (требуется прогон загрузчика на Vercel);
* пересчёт `obligation_payments` для операции `1ba26cda…` (FIN-02, §3);
* пересчёт `invoices`/`obligations` в USDT после cutover (4 и 5 документов);
* BEFORE/AFTER по каждому затронутому проекту/сотруднику/контрагенту/статье
  (структура готова, нужны реальные курсы).

---

## 7. Открытые вопросы к вам

1. **Плановые операции** (`status='planned'`): фиксировать FX или оставлять
   `legacy` до проведения? В cutover-периоде такая одна.
2. **Инвойсы и обязательства после cutover** (4 инвойса и 5 обязательств в USDT):
   включать в backfill B1 вместе с операциями или отдельным шагом?
3. **Курсовая разница**: выводить её сейчас отдельной строкой в отчётах или
   пока только хранить данные, достаточные для расчёта (моё предложение —
   второе, чтобы не расширять объём).
4. Подтвердить, что `fx_repin` (контролируемый пересчёт) нужен уже в первом PR,
   а не позже.
