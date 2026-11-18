# ROLE_PERMISSION_MATRIX.md — Basa (finance-app)

Date 2026-09-19. Roles: `owner > admin > manager > employee > viewer`. Compiled from `src/lib/team.ts`, `src/lib/visibility.ts`, page/component guards, API route gates, and live RLS policies (`pg_policies`).

## Key architectural fact (read this first)
For **core finance entities there are no API routes and no server actions** — mutations run **client → Supabase directly** (verified: `"use server"` = 0 hits; no `actions.ts`). Therefore **the only server-side authorization for most writes is RLS.** Frontend role checks (`canEditFinance`, `canWriteTx`, `canManageTeam`) only decide whether a control renders; they are **not** a security boundary. The security of the app rests on RLS — which was independently verified correct (see `SECURITY_AND_INTEGRITY_AUDIT.md` §4/§RLS). This is not a vulnerability, but it is a **single line of enforcement**: any table whose RLS is wrong is immediately exploitable client-side.

## Role capabilities (`src/lib/team.ts:28-44`)
| Helper | owner | admin | manager | employee | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| canEditFinance / canViewFinance | ✅ | ✅ | ✅ | ❌ | ❌ |
| canWriteTx | ✅ | ✅ | ✅ | ✅ | ❌ |
| canManageTeam | ✅ | ✅ | ❌ | ❌ | ❌ |

## Three-layer matrix (Frontend gate · Backend gate · RLS)
Legend R/C/U/D/E. "RLS-only" = no API/server-action; write goes client→DB.

| Feature | Frontend (who sees controls) | Backend gate | RLS (server truth) |
|---|---|---|---|
| **Transactions/Operations** | RCUD owner/admin/manager; employee RC + U/D own; viewer R (`transactions/page.tsx:145,289`) | **RLS-only** (client writes) | SELECT `is_team_member` (employee→own); INSERT `can_write_tx AND created_by=uid`; UPDATE/DELETE `can_edit_finance OR (employee AND own)` — **verified** |
| **Invoices / items** | RCUD owner/admin/manager; employee/viewer ❌ (`invoices/page.tsx:26`) | `canEditFinance` 403 (`api/invoices/*`) | `invoices_cud`/`invoice_items_cud` = `can_edit_finance(team_id)` — **verified** |
| **Vault** | RCUD finance; reveal/request all members; grant = manageTeam (`vault/page.tsx:9,51,52`) | `canEditFinance` (CUD); reveal via `vault_can_reveal` RPC | `vault_entries_cud`=`can_edit_finance`; SELECT `vault_can_reveal(id) OR can_edit_finance`; `vault_grants`=`can_manage_team` — **verified** |
| **Obligations / payments** | via Employees/Debts, finance roles | **RLS-only** | `obligations` team-scoped; `obligation_payments` via obligation join `can_edit_finance`(CUD)/`is_team_member`(read) — **verified** |
| **Accounts/Categories/Counterparties/Projects/Budgets/FX/Recurring/Agents/Licenses/Debts/Calendar** | RCUD finance; others R (recurring ❌) | **RLS-only** | team-scoped, 4 policies each `is_team_member`/`can_edit_finance` (per `pg_policies`) |
| **Payroll / Employees / employee_salaries·positions** | RCU finance; others R | **RLS-only** | team-scoped `can_edit_finance` |
| **Metrics / metric_values** | RCUD finance (`metrics/page.tsx:21`) | **RLS-only** | team-scoped |
| **Org-structure (kb_departments)** | RCUD finance | **RLS-only** | team-scoped `can_edit_finance` |
| **Bank / Tochka settings** | finance only (`settings/bank/page.tsx:39`) | `canEditFinance` 403 (`api/tochka/*`) | `bank_connections`/`bank_account_links` `can_edit_finance` |
| **Team / members / invites** | manage = owner/admin (`team/page.tsx:26`) | invite route: **no code gate → RLS** | `invites` INSERT `can_manage_team AND invited_by=uid`; team update owner/admin — **verified** |
| **Visibility settings** | manageTeam (`settings/visibility/page.tsx:14`) | **RLS-only** | `member_visibility`/`team_visibility` team-scoped |
| **Academy / Knowledge base** | manage finance; contribute `canWriteTx`; employee take/own | **RLS-only** (Telegram side: initData) | team-scoped |
| **Reports (cashflow/pnl/expense/team/academy)** | finance; team/academy → `canEditFinance` redirect | read-only pages | data via RLS-scoped tables/views |

## Additional access layer: resource visibility
Beyond roles, a per-team/per-member **section visibility** system exists (`visibility.ts`, `member_visibility`/`team_visibility`/`scope_templates`, RPC `can_view_resource(team_id, resource)`), resources: `finance`, `balances`, `metrics`, `learning`, `vault`. The `account_balances` view itself enforces `can_view_resource(team_id,'balances')` (verified in view def) — a real server-side gate. Default is **allow** when unconfigured.

## Mismatch findings
- **PERM-01 (INFO/architectural):** UI hides finance controls for employee/viewer, but for most features **no server role gate exists — enforcement is RLS-only** (dominant pattern; not exploitable because RLS verified correct, but it is the single enforcement point). Evidence: no `actions.ts`; client writers (`OperationsTable.tsx`, `MetricEditor.tsx`, `org/OrgUnitManager.tsx`, `SalaryEditor.tsx`, …) import no role helper.
- **PERM-02 (LOW):** `/api/invite`, `/api/assess/invite` have **no server role check**, deferring to RLS (`invites` INSERT policy = `can_manage_team` — verified blocks it; assess policy not fully verified). = SEC-004.
- **PERM-03 (LOW/UX):** `finance` section is **not hidden by default** for employee/viewer (default-allow `can_view_resource`; no `ensureVisible("finance")` on finance pages), although `ROLE_DESCRIPTIONS.employee` says "финансы скрыты". Data stays protected (RLS + `canEditFinance` controls), but the nav/pages are visible unless an admin configures visibility. Evidence: finance pages lack `ensureVisible`; `visibility.ts:59-70` default true.
- **(b) API-blocks-but-UI-shows:** none found (server-gated features render controls under the same conditions).

## Verdict
Authorization is **coherent and correct at the layer that matters (RLS)**; frontend and RLS agree on *who can write*. The structural risk is that RLS is the sole server gate for most writes — mitigated today by verified-correct policies, but it raises the importance of the RLS regression tests proposed in the audit.
