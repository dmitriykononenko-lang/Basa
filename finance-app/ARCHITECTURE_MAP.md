# ARCHITECTURE_MAP.md — Basa (finance-app)

> Read-only technical map. Compiled 2026-09-19 from source (`finance-app/`), DB (Supabase `kmvsjozxjosmkhvphzdz`), migrations and live schema (RLS/FK). Every claim is backed by a file, migration, table or policy.

## 1. Stack & components

| Layer | Tech | Where |
|---|---|---|
| Frontend + Backend | **Next.js App Router** (React server/client components + route handlers) | `finance-app/src/app/**` |
| Hosting | **Vercel** project `basa-16bf` → `basefinance.pro` | `vercel.json` |
| Database | **Supabase Postgres** (`kmvsjozxjosmkhvphzdz`, eu-central-1), **RLS on all public tables** | `supabase/migrations/**` |
| Auth | **Supabase Auth** (email). SSR client = anon key + session cookies (**RLS enforced**); admin client = `SUPABASE_SERVICE_ROLE_KEY` (**bypasses RLS**) | `src/lib/supabase/{server,client,middleware,admin}.ts` |
| Secrets | AES-256-GCM at rest for bank tokens & vault | `src/lib/crypto.ts`, `src/lib/vault-crypto.ts` |

There are **no Server Actions** (`"use server"` matches nothing); all mutations go through `src/app/api/**/route.ts` (31 handlers) or direct Supabase client calls from components (RLS-guarded).

## 2. Tenancy model (the core of isolation)

```
auth.users ──1:1── profiles
     │
     └──< team_members (user_id, team_id, role) >── teams        ← team = ORGANIZATION = TENANT
                                     │
                                     └── team_id stamped on ~60 business tables
```

- **Tenant = `team`.** Almost every business row carries `team_id` (verified: of 74 public base tables, all business tables have `team_id`; child tables scope via a parent join).
- **Roles** (`AppRole`, `src/lib/team.ts`): `owner`, `admin`, `manager`, `employee`, `viewer`.
- **Server role gates** (`src/lib/team.ts:28-44`):
  - `canEditFinance` = owner/admin/manager
  - `canViewFinance` = owner/admin/manager
  - `canWriteTx` = owner/admin/manager/employee
  - `canManageTeam` = owner/admin
- **DB role gates** = SECURITY DEFINER functions, all pinned `search_path=public` (verified via `pg_proc.proconfig`): `is_team_member(team_id)`, `current_team_role(team_id)`, `can_edit_finance(team_id)`, `can_write_tx(team_id)`, `can_manage_team(team_id)`, `vault_can_reveal(id)`, `auth_email()`. These are the primitives every RLS policy calls.
- `getCurrentTeam()` (`src/lib/team.ts:10`) returns the user's **earliest-joined** team (no team switcher) — see AUDIT finding INFO-01.

### Middleware (attack surface)
`src/middleware.ts` → `updateSession` (`src/lib/supabase/middleware.ts`) only checks a **session exists**; it does *not* verify team membership (that's each route's / RLS's job). Unauthenticated requests are redirected to `/login`, **except** these bypass prefixes, each with its own auth:
- `/tg`, `/api/tg` → Telegram **initData HMAC** (`src/lib/telegram.ts`, constant-time compare + 24h freshness).
- `/t`, `/t/*` → public assessment via unguessable `share_token` (RPC).
- `/api/obsidian/pull|push` → **Bearer sync token** (SHA-256 hashed lookup).
- `/api/cron/*`, `/api/tochka/cron` → **`CRON_SECRET`** bearer.

## 3. Entity map — creation / storage / relations / access

```
USER (auth.users + profiles)
  ↓ team_members(role)
ORGANIZATION = TEAM
  ↓
├─ accounts ──< transactions >── categories / projects / counterparties
│                   ├─ transaction_splits, transaction_history
│                   ├─ import_batches (bank/CSV import)
│                   └─ obligations ──< obligation_payments >── transactions
├─ invoices ──< invoice_items ; invoice_documents ; paid_transaction_id → transactions
├─ recurring_rules → transactions ; budgets ; fx_rates
├─ bank_connections (Tochka token, encrypted) ; bank_account_links (Tochka acct → Basa acct)
├─ vault_entries ──< vault_grants ; vault_access_log        (passwords, VAULT_KEY-encrypted)
├─ kb_departments (= ORG-STRUCTURE units) ; kb_articles/quiz ; counterparties.unit_id
├─ metrics ──< metric_values (KPI, metrics.unit_id → kb_departments)
├─ projects ──< project_periods, project_bonus_tiers ; responsible_counterparty_id
├─ employee_positions / employee_salaries (counterparty = employee)
├─ academy_courses/items/assignments/progress ; assessments/scores/answers
├─ license_deals/items/purchases/payments ; agent_commission_rules
├─ notifications / notification_prefs ; member_visibility / team_visibility / scope_templates
└─ telegram_links/codes ; obsidian_connection ; product_catalog
```

Per-entity access (who can read/change/delete) is enforced by RLS; see the **Endpoint Security Matrix** and **RLS** section of `SECURITY_AND_INTEGRITY_AUDIT.md`. Summary:
- **Financial rows** (accounts, transactions, invoices, obligations, budgets, fx_rates, bank_connections, vault): read = team member (finance roles); create/update/delete = `can_edit_finance`; vault reveal = `vault_can_reveal` RPC + audit log.
- **transactions** special-cases `employee`: an employee sees/edits only rows they created (`transactions_select/update/delete` policies).
- **Team management** (invites, vault_grants): `can_manage_team` (owner/admin).
- **Per-user** (profiles, telegram_links, notifications): `user_id = auth.uid()`.

## 4. Integrations, jobs, storage, secrets

**External integrations**
- **Tochka Bank** (`src/lib/tochka.ts`, `src/app/api/tochka/**`): outbound JWT bearer, **pull/poll only** (no inbound webhook). TLS trusts Russian Trusted CA *on top of* system roots (`src/lib/russianTrustedCa.ts`) — verification not disabled. Import dedup via unique `transactions(team_id, source, external_id)`; POST (invoice create) not retried.
- **Telegram Mini App** (`src/app/api/tg/**`): `initData` HMAC verified per request; runs under service_role with manual `user_id`/`team_id` scoping; account link via one-time hashed code (15-min TTL).
- **Obsidian sync** (`src/app/api/obsidian/**`): bearer token (`obsd_…`, stored hashed), team-scoped KB read/write. No expiry / no rate limit (hardening item).
- **CBR FX** (`src/lib/cbr.ts`): public outbound GET, no secrets.
- **Email**: Resend (`RESEND_API_KEY`) + Supabase `inviteUserByEmail`.
- **No LLM/AI, no amoCRM/Kommo, no Bybit API, no inbound webhooks** (verified by grep).

**Cron / jobs**
- Vercel crons (`vercel.json`): `tochka/cron` (05:00), `cron/notifications?mode=refresh` (08:00) & `?mode=digest` (06:00), `cron/recurring` (07:00). All gated by `CRON_SECRET` (no-op if unset), run under service_role, loop per-team.
- Supabase **pg_cron** job `tochka-autosync` (every 3h) → HTTP GET `/api/tochka/cron` (added this session; awaits `CRON_SECRET` in Vercel to actually import).
- `/api/tochka/auto-sync` — user-session endpoint, on-app-open, throttled ≤ once/2h.

**File storage** (Supabase Storage)
- `receipts` — **private**, 60s signed URLs, RLS keys off `{team_id}/…` path (`0007_attachments.sql`). ✅
- `kb-media` — **PUBLIC bucket** (`0052_kb_media_storage.sql`); world-readable by URL, no read-RLS. ⚠ (finding SEC-002)

**Secrets (env, server-only)**: `SUPABASE_SERVICE_ROLE_KEY`, `TOCHKA_TOKEN_KEY`, `VAULT_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`. Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. No hardcoded secrets in source (only public CA certs); `.env.local.example` commits public project URL+anon key only (low).

**Logging/monitoring**: `tochka_sync_log` / `bybit_sync_log` (operational). One benign `console.log` (`/api/tg/diag`). Vault reveal audited in `vault_access_log` (no plaintext).

## 5. Data-flow (bank import, the critical automation)
```
Vercel cron / pg_cron / app-open → /api/tochka/cron|auto-sync
  → decrypt bank JWT (TOCHKA_TOKEN_KEY) → Tochka statements API (Минцифра CA)
  → map Tochka account → Basa account (bank_account_links / default)
  → dedup by (team_id, source, external_id) → insert transactions (team-scoped)
  → detect internal transfers, obligation settlement triggers
```
Idempotent (dedup index) and team-scoped at every step (`src/lib/tochka-import.ts`, `src/app/api/tochka/cron/route.ts`).
