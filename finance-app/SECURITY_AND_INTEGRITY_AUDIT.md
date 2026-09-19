# SECURITY_AND_INTEGRITY_AUDIT.md — Basa (finance-app)

Date: 2026-09-19 · Method: read-only source + live DB (RLS/FK/policy) introspection + read-only data-integrity queries. Companion docs: `ARCHITECTURE_MAP.md`, `AUDIT_PLAN.md`, `scripts/db_integrity_audit.sql`. No files/data changed.

---

## 1. Executive Summary

**Overall posture: strong.** The core security guarantee — that one organization cannot read or modify another's data — is **enforced at the database layer (RLS) on 100% of public tables**, via `SECURITY DEFINER` helper functions (`is_team_member`, `can_edit_finance`, `can_write_tx`, `can_manage_team`, `current_team_role`) whose `search_path` is pinned to `public` (verified). Application routes add a second gate (`getCurrentTeam` + `canEditFinance`).

- **Verified proofs (the 11 required guarantees):** cross-tenant read/write is blocked by RLS on every financial table (policies quoted below); data integrity is clean (**18/18 checks = 0 bad rows**); authorization is on the backend (RLS, not just frontend); no IDOR/BOLA is exploitable (routes that query by client id are backed by `can_edit_finance(team_id)` policies); secrets are AES-256-GCM encrypted and never returned to clients; the bank integration is idempotent and pull-only.
- **Severity counts:** CRITICAL **0** · HIGH **0** · MEDIUM **2** · LOW **5** · INFO **2**.
- **Top risks (both are *disclosure*, not tenant-write):**
  - **SEC-001 (MEDIUM):** `tochka_sync_log` / `bybit_sync_log` are readable by *any* authenticated user (RLS `USING true`) → cross-tenant operational-log disclosure.
  - **SEC-002 (MEDIUM):** `kb-media` is a **public** storage bucket → KB images (possibly internal/financial) world-readable by URL.

No evidence of cross-tenant financial data access, privilege escalation, injection, or leaked secrets in source.

> ⚠ **Обновлено этапом 2 (см. §9).** Сводка выше относится к **безопасности и целостности данных
> в покое** и остаётся в силе. Но она **не** покрывает конкурентность и корректность расчётов.
> Этап 2 добавил **1 HIGH (FIN-03, задвоенные переводы в данных)**, 2 MEDIUM по валютной логике
> и 9 находок по конкурентности, из которых **9 из 9 воспроизведены исполняемым тестом**.
> Отдельно **отзывается** промежуточное утверждение первого этапа «конкурентность защищена
> уникальными индексами»: уникальный индекс доказывает идемпотентность по ключу, но не
> атомарность многошаговой записи. Итоговые статусы — в §9.

---

## 2. Architecture Map
See `ARCHITECTURE_MAP.md`. In one line: Next.js App Router on Vercel + Supabase Postgres (RLS); tenant = `team`; auth via Supabase (SSR anon+cookies = RLS; admin service-role for cron/tg/obsidian); integrations Tochka (pull), Telegram Mini App, Obsidian sync, CBR, email — no LLM, no inbound webhooks.

## 3. Data Relationship Map
See `ARCHITECTURE_MAP.md` §3. Financial spine: `teams → accounts → transactions → {categories, projects, counterparties, obligations→obligation_payments}`; `invoices→invoice_items`; `bank_connections/bank_account_links`; `vault_entries→vault_grants`. Org spine: `kb_departments (units) → counterparties (employees) → employee_positions/salaries`, `metrics→metric_values`. All child tables share `team_id` or scope via a parent join (verified by integrity sweep).

---

## 4. Findings

### SEC-001 — Cross-tenant read of sync logs
- **Severity:** MEDIUM · **Category:** Security / Authorization / Tenant isolation
- **Location:** DB policies `tochka_sync_log.tochka_sync_log_read`, `bybit_sync_log.bybit_sync_log_read`; writers `src/app/api/tochka/cron/route.ts:106-112`, error text `src/lib/tochka.ts` (`networkDetail`, ≤500-char API body).
- **Problem:** Both SELECT policies are `USING (true)` for role `authenticated` — any logged-in user of any team can read every team's sync log. `tochka_sync_log.detail.summary[]` includes `teamId`, import counts and **error strings** that may embed Tochka API response bodies (counterparty/account fragments).
- **Evidence:** `pg_policies` → `qual = "true"`, `roles = {authenticated}` for both tables (quoted during audit).
- **Reproduction (safe):** as any authenticated user run `select * from public.tochka_sync_log;` → rows for *all* teams return.
- **Impact:** Cross-tenant disclosure of operational metadata / possible counterparty PII. Bank token is **not** logged, so no secret leak.
- **Root cause:** Placeholder `true` read policy on tables created out-of-band (not in migrations).
- **Fix:** Drop the `authenticated` SELECT policy (leave service-role only — the app never reads these client-side), or add `team_id` + scope by `can_edit_finance(team_id)`.
- **Regression test:** policy test — user of team B selects these tables → 0 rows.
- **Status:** OPEN

### SEC-002 — `kb-media` is a public storage bucket
- **Severity:** MEDIUM · **Category:** Security / Data exposure
- **Location:** `supabase/migrations/0052_kb_media_storage.sql:7-8` (`public=true`); confirmed `0068_kb_media_no_listing.sql:4-6`. Producers: `src/components/kb/RichEditor.tsx:182,191`, `src/components/profile/ProfileForm.tsx:64,75`.
- **Problem:** All objects in `kb-media` are world-readable via `getPublicUrl` with no auth and no team RLS on read; KB article bodies can contain internal/financial screenshots. URLs use UUIDs (obscurity only), never expire, cross-tenant.
- **Evidence:** migration sets bucket `public=true`; `0068` comment states objects bypass RLS via public URL.
- **Reproduction:** copy any KB image URL → open in a logged-out browser / different tenant → loads.
- **Impact:** Leakage of embedded internal content to anyone who obtains a URL.
- **Root cause:** Bucket made public for convenience (`getPublicUrl`).
- **Fix:** Make `kb-media` private + serve via short-lived signed URLs (mirror `receipts`, `0007_attachments.sql`).
- **Regression test:** bucket `public=false`; unauthenticated GET of an object URL → 400/403; app still renders via signed URL.
- **Status:** OPEN

### SEC-003 — Write-by-client-id without an explicit `team_id` filter (defense-in-depth gap)
- **Severity:** LOW (not exploitable today) · **Category:** Authorization / Reliability
- **Location:** `src/app/api/vault/route.ts:70,122,137`; `src/app/api/invoices/route.ts:104,142,157`; `src/app/api/invoices/[id]/items/route.ts:15`.
- **Problem:** These UPDATE/DELETE/SELECT queries key off a client-supplied `id`/`invoice_id` with no `team_id` filter, relying solely on RLS. Also `/api/vault` and `/api/invoices` DELETE read `id` from the query string without UUID validation.
- **Evidence & why NOT exploitable:** verified RLS — `invoices_cud`/`invoice_items_cud`/`vault_entries_cud` all use `can_edit_finance(team_id)` (USING+WITH CHECK); `vault_entries_select` = `vault_can_reveal(id) OR can_edit_finance(team_id)`. A cross-tenant id therefore affects 0 rows.
- **Impact:** None today; becomes IDOR if any of those policies is ever removed/loosened (single line of defense).
- **Fix:** add `.eq("team_id", current.team.id)` to each; validate `id` with zod uuid on DELETE.
- **Regression test:** unit test asserting the query includes team scoping; a "policy-drop" integration test that must still 404 cross-tenant.
- **Status:** OPEN

### SEC-004 — Privileged routes delegate authorization entirely to RLS
- **Severity:** LOW (mitigated by RLS) · **Category:** Authorization
- **Location:** `src/app/api/invite/route.ts:29-39` (team_id from body, no `canManageTeam` in code); `src/app/api/assess/invite/route.ts:44-76` (no role gate).
- **Evidence & mitigation:** `invites` INSERT policy = `can_manage_team(team_id) AND invited_by = auth.uid()` (verified) → non-admin / cross-team invites are blocked by DB. `assessments` INSERT policy not fully confirmed in this pass.
- **Impact:** Low; add explicit server gates for clarity and to confirm `assessments` cannot be created by `viewer`.
- **Fix:** `if (!canManageTeam(current.role)) return 403` in `/api/invite`; add appropriate gate in `/api/assess/invite`; verify `assessments` INSERT policy.
- **Status:** OPEN

### SEC-005 — Obsidian sync tokens: no expiry, no rate limit
- **Severity:** LOW · **Category:** Auth / Reliability · **Location:** `src/lib/obsidian.ts:19-44`, `src/app/api/obsidian/pull|push`.
- **Problem:** A leaked `obsd_` bearer grants full team-KB read/write until manually re-issued; no TTL, no throttle.
- **Fix:** token expiry/rotation + rate limiting; optional per-request nonce. **Status:** OPEN

### SEC-006 — `/api/tg/link` has no rate limiting on code attempts
- **Severity:** LOW · **Category:** Auth · **Location:** `src/app/api/tg/link/route.ts:31-45`.
- **Problem:** 6-char code (15-min TTL) matched after email lookup, unthrottled. Brute force impractical but should be limited (linking Telegram to a victim account is the payoff).
- **Fix:** per-user/IP attempt limiter + lockout. **Status:** OPEN

### SEC-007 — `.env.local.example` commits real Supabase URL + anon key
- **Severity:** LOW · **Category:** Secrets hygiene · **Location:** `finance-app/.env.local.example`.
- **Problem:** Real prod project URL + publishable/anon key committed. These are public-by-design (RLS is the boundary; `SUPABASE_SERVICE_ROLE_KEY` is blank), but the project ref is exposed in git history.
- **Fix:** replace with placeholders. **Status:** OPEN

### INFO-01 — Single-team resolution
`getCurrentTeam()` / `tgUserTeam()` always use the earliest team (`src/lib/team.ts:10`, `src/lib/tg-session.ts:45-57`). Multi-team users can't act on other teams; `/api/tg/me` may summarize the wrong team. Add a team switcher if multi-team is needed. **Status:** INFO

### INFO-02 — DB/migration drift & hardening
Out-of-band tables exist in DB but not in migrations: `tochka_sync_log`, `bybit_sync_log`, `bybit_party_map`, `bybit_tx_party`, `report_verify`, plus many `_bak_*/_mrgbak_*/_audit_bak_*` backups (all have RLS **deny-all** → safe, but clutter). Supabase advisors also flag: `extension_in_public`, leaked-password protection **off**, and 3 non-critical functions with mutable `search_path` (the RLS-critical helpers ARE pinned — verified). **Fix:** codify or drop out-of-band/backup tables; enable leaked-password protection; pin remaining `search_path`s. **Status:** INFO

### Confirmed positives (evidence)
RLS on all public tables; tenant isolation predicates correct (quoted); transactions employee-scoping (`transactions_select/update/delete`); vault reveal gated by `vault_can_reveal` + `vault_access_log`; AES-256-GCM for bank & vault secrets, plaintext never returned; Telegram `initData` HMAC (constant-time + freshness); bank import idempotent (unique `transactions(team_id, source, external_id)`) & pull-only; cron fail-safe on missing `CRON_SECRET`; no mass-assignment; zod validation on the JSON API; no LLM / no inbound webhooks / no hardcoded secrets.

---

## 5. Data Integrity Results (read-only sweep, `scripts/db_integrity_audit.sql`)

| Class | Checks | Bad rows |
|---|---|---|
| Cross-tenant relations | 13 (tx→account/transfer/category/project/counterparty; invoice_items↔invoice; invoices→counterparty/project; obligations→counterparty; oblig_payments→tx; counterparty→unit; metrics→unit; bank_account_links→account) | **0** |
| Orphans / broken FKs | 4 (tx.account, invoice_items, oblig_payments→oblig, oblig_payments→tx) | **0** |
| Orphan membership | 1 (team_members→team) | **0** |
| **Total** | **18** | **0 → PASS** |

FK coverage: financial relations are FK-backed. On-delete: `team_id → teams` is `CASCADE` (deleting a team removes its data); most cross-entity FKs are `SET NULL`/`NO ACTION` (e.g. `transactions.account_id`, `.category_id`), so deleting a referenced account/category **nulls** the reference rather than orphaning — consistent with the 0 orphans found. `invoice_items→invoices`, `obligation_payments→obligations`, `transactions.import_batch_id` are `CASCADE`. Snapshot: tx=7905, invoices=25, tables-without-RLS=0.

---

## 6. Endpoint Security Matrix (31 route handlers)

Legend: Auth ✓ = session/HMAC/bearer required · Authz = server role gate · Tenant = team-scoped (code and/or RLS) · Val = input validation.

| Endpoint | Auth | Authz | Tenant | Val | Result |
|---|---|---|---|---|---|
| invoices POST/PATCH/DELETE | ✓ | canEditFinance | RLS (`invoices_cud`); code lacks team_id filter | zod (DELETE id unvalidated) | OK (SEC-003) |
| invoices/[id]/items GET | ✓ | canEditFinance | RLS (`invoice_items_select`) | — | OK (SEC-003) |
| invoices/[id]/issue, /tochka-status | ✓ | canEditFinance | ✓ team-scoped SELECT | path | OK |
| invoices/bulk, /reconcile | ✓ | canEditFinance | ✓ | zod / — | OK |
| vault POST/PATCH/DELETE | ✓ | canEditFinance | RLS (`vault_entries_cud`); code lacks team_id filter | zod (DELETE id unvalidated) | OK (SEC-003) |
| vault/[id]/reveal, /request-access | ✓ | `vault_can_reveal` RPC | RPC re-checks | path | OK (best) |
| tochka/* (connect/test/mapping/suggest/import/auto-sync) | ✓ | canEditFinance | ✓ | mixed | OK |
| tochka/cron, cron/notifications, cron/recurring | CRON_SECRET | secret | per-team loop (admin) | header | OK |
| tg/* (me/link/complete/lesson/course) | initData HMAC | user/link | ✓ user-scoped | zod | OK |
| tg/diag | none | — | — | — | INFO (beacon) |
| obsidian/pull, /push | bearer(token) | token→team | ✓ | push unbounded | OK (SEC-005) |
| obsidian/token, profile/telegram-code | ✓ session | canEditFinance / self | ✓ | — | OK |
| invite | ✓ session | RLS only (`can_manage_team`) | team_id from body → RLS | zod | OK (SEC-004) |
| assess/invite | ✓ session | none in code → RLS | ✓ | manual | LOW (SEC-004) |
| cbr | n/a | n/a | n/a | — | OK (public proxy) |

---

## 7. Test Coverage

**Done (automated, read-only):** RLS coverage scan (all tables), RLS predicate review for financial + child tables, SECURITY DEFINER `search_path` check, FK/on-delete review, 18-check data-integrity sweep (`scripts/db_integrity_audit.sql`), full endpoint auth/authz/validation inventory.

**Recommended to add (need a throwaway Supabase branch for live-exploit tests — do NOT run write-exploits in prod):**
- **Authorization/RLS regression** (pgTAP or API tests with two orgs A/B, roles owner/admin/manager/employee/viewer): assert User B cannot SELECT/UPDATE/DELETE A's invoices, vault, transactions, obligations by id; employee sees only own transactions; viewer cannot write. Regression for **SEC-001** (sync logs), **SEC-003**, **SEC-004**.
- **Storage**: SEC-002 — object in team A's `kb-media` path not fetchable by team B / anonymous after switching to private+signed.
- **Integration**: Tochka import idempotency (double-run → no duplicate transactions); obligation-settlement trigger.
- **API**: zod rejection cases; DELETE id validation.
- Wire `scripts/db_integrity_audit.sql` into CI/cron as a PASS/FAIL gate.

---

## 8. Priority Fix Plan

- **P0 (immediate):** — none (no CRITICAL/HIGH; no exploitable cross-tenant access found).
- **P1 (high):**
  - SEC-001 — restrict/scoped RLS on `tochka_sync_log` & `bybit_sync_log`.
  - SEC-002 — make `kb-media` private + signed URLs.
- **P2 (planned):**
  - SEC-003 — add explicit `team_id` filters + `id` validation on vault/invoices write routes.
  - SEC-004 — explicit server role gates on `/api/invite`, `/api/assess/invite`; confirm `assessments` INSERT policy.
  - SEC-005 — Obsidian token TTL + rate limit. SEC-006 — `/api/tg/link` rate limit.
- **P3 (hardening):**
  - SEC-007 — scrub `.env.local.example`. INFO-02 — drop/codify out-of-band & backup tables; enable Supabase leaked-password protection; pin remaining function `search_path`; add team switcher (INFO-01).

> Verification rule: after each fix, re-run the exact exploit query/test, confirm the vulnerability is gone, run the related regression suite, and confirm no feature broke — before marking any finding VERIFIED.

---

# 9. Этап 2 — функциональный аудит, конкурентность, расчёты

Полный разбор — в `E2E_AUDIT.md` (потоки и границы транзакций), `FEATURE_MATRIX.md` (функции),
`ROLE_PERMISSION_MATRIX.md` (права), `scripts/concurrency/` (исполняемые тесты).
Production не изменялся; ни одна находка не исправлялась.

## 9.1 Что отзывается из выводов этапа 1

| Утверждение этапа 1 | Итог перепроверки |
|---|---|
| «IDOR не воспроизводится» | **подтверждено** (политики `*_cud` = `can_edit_finance(team_id)`; чужой id затрагивает 0 строк) |
| «18/18 проверок целостности = 0» | **подтверждено на том же наборе**, но набор был неполным: добавлены 5 новых проверок, одна из них **провалена** (FIN-03) |
| «изоляция арендаторов подтверждена» | **подтверждено** (в т.ч. `account_balances` под service-role отдаёт 0 строк — вьюха сама требует `is_team_member` + `can_view_resource`) |
| «импорт идемпотентен» | **подтверждено для повторного запуска**, но **не для параллельного**: при одновременном прогоне падает весь батч (T6) |
| «секреты не отдаются клиенту» | **подтверждено** |
| «конкурентность защищена уникальными индексами» | **ОТОЗВАНО** — см. 9.2 |

## 9.2 Находки этапа 2

| ID | Severity | Класс | Суть | Доказательство |
|---|---|---|---|---|
| **FIN-03** | **HIGH** | Данные | **126 переводов учтены дважды** (строка `transfer` + ручная пара `expense`/`income` с той же датой/суммой/счетами/заметкой). Задвоено **1 205 497,09 ₽**, окно 2025-01-14…2025-03-16 | SQL к production; пример: `a77e40d1…` + `8e634c73…` + `c2e27f60…` |
| **FIN-01** | MEDIUM | Логика | Неизвестный курс валюты молча считается 1:1; `missingRates()` не вызывается нигде | `src/lib/fx.ts:24-27,30`; в БД 1 строка курса |
| **FIN-02** | MEDIUM | Логика | Конвертация по **последнему** курсу, а не на дату операции; истории курсов нет; у `obligation_payments` нет валюты | `src/lib/fx.ts:8-20`, `src/lib/unallocated.ts:83-85` |
| **CONC-01** | HIGH | Конкурентность | Сохранение инвойса = 3 отдельные записи без транзакции → `amount ≠ Σ позиций`; при сбое — инвойс без позиций | `api/invoices/route.ts:102-118`; тесты **T2, T3** |
| **CONC-02** | MEDIUM | Конкурентность | Номер инвойса: `max+1` без уникального индекса `(team_id, number)` → дубль номера документа | `invoiceNumber.ts:30-38`; тест **T5** |
| **CONC-03** | HIGH | Конкурентность | Разнесение выплаты: лимит считается в браузере, в БД нет ограничения `Σ payments ≤ amount` → переплата обязательства | `AllocatePaymentButton.tsx:51-98`; тест **T4** |
| **CONC-04** | MEDIUM | Конкурентность | Параллельный импорт Точки: дублей нет (уникальный индекс), но **падает весь батч**, часть выписки теряется до следующего прогона; ранее созданные контрагенты остаются | `tochka-import.ts:48-145`; тест **T6** |
| **CONC-05** | HIGH | Конкурентность | `materialize_auto_accruals()` (`if not exists → insert`, без уникального индекса) вызывается **при GET-рендере `/payroll`** → двойное начисление ЗП | `payroll/page.tsx:58`; тест **T1** |
| **CONC-06** | MEDIUM | Конкурентность | Тротлинг авто-синка — TOCTOU: читает `last_synced_at`, проверяет в JS, потом пишет; обе параллельные сессии проходят | `auto-sync/route.ts:32-38`; тест **T7** |
| **CONC-07** | HIGH | Конкурентность | Правка операции шлёт **всю строку** без версии/предусловия → lost update; части операции сохраняются отдельным запросом после | `OperationCard.tsx:131-152`; тест **T8** |
| **CONC-08** | MEDIUM | Конкурентность | Части операции: `delete` + `insert` без транзакции и без связи `Σ splits = amount` | `TransactionPartsEditor.tsx:82-93` |
| **CONC-09** | HIGH | Конкурентность | Разбиение операции и склейка перевода/план↔факт: `insert` новых строк, затем `delete` старых. Сбой между шагами → **деньги учтены дважды** | `SplitTransactionModal.tsx:66-73`, `OperationsTable.tsx:90-102,162-164`; тест **T9** |

Общая первопричина CONC-01…CONC-09 одна: **у Supabase JS нет клиентских транзакций**, а
финансовые операции собраны из нескольких независимо коммитящихся запросов. Атомарны только
триггеры и RPC-функции (`settle_obligation_on_tx`, `recompute_commission`, `accept_invite` —
они как раз **CONCURRENCY VERIFIED**).

## 9.3 Таблица бизнес-инвариантов

| BUSINESS INVARIANT | STATUS | EVIDENCE |
|---|---|---|
| Остаток счёта = `opening_balance` + Σ фактических операций | **LOGIC VERIFIED**, **DATA FAILED** | определение вьюхи `account_balances` + ручной пересчёт; но FIN-03 задваивает 126 переводов |
| Сумма инвойса = Σ его позиций | **DATA VERIFIED** (0/15 нарушений), **CONCURRENCY FAILED** | SQL к prod; тесты T2/T3 |
| НДС инвойса ≤ суммы инвойса | **DATA + LOGIC VERIFIED** | SQL: 0 нарушений; `lib/invoices.ts` |
| Номер документа уникален в команде | **DATA VERIFIED** (0 дублей), **CONCURRENCY FAILED** | SQL; тест T5; уникального индекса в БД **нет** |
| Обязательство не может быть переплачено | **DATA VERIFIED** (0/189), **CONCURRENCY FAILED** | SQL; тест T4; ограничения в БД **нет** |
| `outstanding = amount − paid` | **DATA + LOGIC VERIFIED** | вьюха `obligation_balances`, 0 нарушений |
| Одна транзакция гасит обязательство ровно один раз | **CONCURRENCY VERIFIED** | `settle_obligation_on_tx` + `unique(transaction_id, obligation_id)` + upsert |
| Импорт банка идемпотентен | **DATA VERIFIED**, **CONCURRENCY PARTIAL** | `unique(team_id, source, external_id)`; 0 дублей; тест T6 |
| Начисление ЗП за месяц создаётся один раз | **DATA VERIFIED** (дублей-гонок нет), **CONCURRENCY FAILED** | SQL; тест T1; уникального индекса **нет** |
| Агентская комиссия = одна строка на транзакцию | **DATA + LOGIC + CONCURRENCY VERIFIED** | `unique(source_transaction_id)` + upsert в `recompute_commission` |
| Σ частей операции = сумме операции | **DATA VERIFIED**, **CONCURRENCY FAILED** | SQL: 0 нарушений; CONC-08 |
| Данные одной команды не видны другой | **VERIFIED** | RLS на 100% таблиц; `account_balances` под service-role = 0 строк; кросс-тенантных связей 0 |
| Суммы в отчётах пересчитаны в базовую валюту корректно | **PARTIAL** | FIN-01 (молчаливый 1:1), FIN-02 (курс не на дату) |
| Секреты не покидают сервер | **VERIFIED** | AES-256-GCM; токен банка не логируется |
| Пользователь не может повысить себе роль | **VERIFIED** | `team_members` под `can_manage_team`; `accept_invite` сверяет email |

## 9.4 Ответы на пять вопросов

**1. Есть ли доказанные способы увидеть или изменить данные другой команды?**
**Изменить — нет.** Ни одного. RLS покрывает 100% публичных таблиц, политики записи опираются на
`can_edit_finance`/`can_write_tx`/`can_manage_team`, кросс-тенантных связей в данных 0.
**Увидеть — да, один доказанный случай, и он не финансовый:** `tochka_sync_log` / `bybit_sync_log`
с политикой `USING(true)` для `authenticated` (SEC-001) — любой залогиненный видит операционные
логи всех команд (`team_id`, счётчики, тексты ошибок API). Плюс потенциальный: публичный бакет
`kb-media` (SEC-002) — файл открывается по URL кем угодно, включая неаутентифицированных.
Миграция `0085_sec001_restrict_sync_log_read.sql` подготовлена, **но на production не применена**.

**2. Есть ли сценарии повреждения или рассинхронизации данных?**
**Да, и один уже реализовался.** В данных: **FIN-03** — 126 задвоенных переводов на 1 205 497,09 ₽
(остатки по затронутым счетам завышены/занижены). В коде: девять неатомарных потоков (CONC-01…09),
все девять воспроизведены тестом — от «инвойс без позиций» и «деньги учтены дважды при разбиении
операции» до «двойное начисление зарплаты при двух открытых вкладках `/payroll`».
Механизма отката нет нигде: единственная компенсация во всём коде — `delete import_batches`
в `tochka-import.ts:143`.

**3. Есть ли финансовые расчёты, дающие неправильный результат?**
**Сами формулы — верны** (баланс счёта, итоги инвойса, НДС, `outstanding`, агентская комиссия,
бонусы — пересчитаны и сошлись). **Неверна валютная часть:** неизвестный курс молча считается 1:1
(FIN-01) и конвертация идёт по последнему курсу, а не на дату операции (FIN-02) — из-за этого
исторические отчёты меняются задним числом, а остаток по «нераспределённым выплатам» плавает
вместе с курсом. Сегодня в БД одна валюта с курсом (USDT=80), поэтому цифры сходятся; любая
новая валюта без курса сломает отчёты молча.

**4. Есть ли функции интерфейса, работающие неправильно?**
Браузерного E2E не было (нет учётных данных, активные действия на production запрещены), поэтому
про «кнопки» утверждать нечего. По коду и данным: два параллельных мастера импорта
(`StatementImportWizard` и `ImportWizard`) с расходящейся логикой сверки; семь неиспользуемых
компонентов; `missingRates()` написан, но не вызывается — предупреждение о неизвестном курсе
пользователю не показывается никогда; `/payroll` **пишет в БД при обычном открытии страницы**;
роль `employee` по описанию «финансы скрыты», но раздел виден по умолчанию (PERM-03).

**5. Можно ли считать основные бизнес-процессы VERIFIED?**
**Частично — и только в разрезе «данные и логика», не «конкурентность».**
- **VERIFIED полностью (данные + логика + конкурентность):** агентские комиссии, погашение
обязательства транзакцией, приглашения в команду, изоляция арендаторов, хранение секретов.
- **VERIFIED по данным и логике, FAILED по конкурентности:** операции, инвойсы, обязательства и
разнесение выплат, зарплата, части операции.
- **FAILED по данным:** остатки по счетам (FIN-03).
- **PARTIAL:** импорт банка (идемпотентен, но не переживает параллельный запуск), мультивалютные отчёты.
- **NOT TESTED:** интерфейс в браузере, почтовые уведомления, фактические прогоны cron, Telegram Mini App, Storage.

Коротко: **сервис безопасен с точки зрения доступа и сегодня в основном консистентен, но он не
защищён от одновременной работы двух пользователей и содержит одну уже случившуюся ошибку в данных.**

## 9.5 Обновлённый план исправлений (ничего не исправлено — ждёт решения)

- **P0:** FIN-03 — подтвердить у владельца данных 126 задвоенных переводов и согласовать чистку
(до чистки остатки по счетам за период 2025-01…2025-03 недостоверны).
- **P1 (ограничения БД — дёшево и закрывает большинство гонок):**
  `unique(invoices.team_id, number)`; `unique(obligations.counterparty_id, type, pay_part, period_month)`;
  триггер-ограничение `Σ obligation_payments.amount ≤ obligations.amount`;
  перевод F1 (инвойс+позиции) и F9/F10 (split/merge) в одну `SECURITY DEFINER` RPC-функцию;
  `update … where id = ? and updated_at = ?` (оптимистичная блокировка) в `OperationCard`.
- **P2:** убрать запись из GET-рендера `/payroll` (кнопка или cron); условный `update … where last_synced_at < now() - interval '2 hours'` в авто-синке; `on conflict do nothing` для импорта Точки вместо падения батча.
- **P3:** FIN-01 (показывать предупреждение о неизвестном курсе, не считать 1:1), FIN-02 (история курсов + валюта в `obligation_payments`); SEC-001/SEC-002 по плану §8; автотесты (сейчас их 0) — начать с `scripts/db_integrity_audit.sql` и `scripts/concurrency/` в CI.
