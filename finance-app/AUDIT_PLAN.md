# AUDIT_PLAN.md — Security & Data-Integrity Audit (Basa / finance-app)

> Roles assumed: Senior Security Engineer + Backend Architect + QA. Scope: `finance-app/` + Supabase `kmvsjozxjosmkhvphzdz`. Constraints: **read-only by default; no destructive changes; no production data modified; no active exploit-writes in prod.** Every finding must cite a file/function/endpoint/table/policy or a reproducible query.

## Environments
- **Prod DB (Supabase `kmvsjozxjosmkhvphzdz`)** — used **read-only** (SELECT + `pg_policies`/`pg_constraint` introspection). No writes, no test users created here.
- **Code** — full read access to repo.
- **No isolated staging/test tenant exists.** Therefore active cross-tenant *exploit* tests (logging in as User B and calling User A's ids) are **not executed against prod**; instead tenant isolation is proven by (a) auditing the RLS policy predicates that back every route, and (b) read-only data-integrity queries. A disposable Supabase branch is recommended for live exploit regression tests (see Test Coverage in the report).

## Method (maps to the 14-point brief)
1. **System map** → `ARCHITECTURE_MAP.md` (done): components, tenancy, entities, integrations, jobs, storage, secrets, data-flow.
2. **Data integrity** → read-only SQL sweep for orphans / broken FKs / cross-tenant links / duplicates + FK on-delete review. Reusable script: `scripts/db_integrity_audit.sql` (READ ONLY, prints PASS/WARN/FAIL).
3. **Authentication** → review Supabase Auth usage, session/cookie handling, middleware, Telegram initData HMAC, Obsidian/cron bearer tokens, token lifecycle & rate-limiting.
4. **Authorization** → for every endpoint: auth + role gate + tenant scope; and for every table: RLS USING/WITH CHECK predicates. Focus: IDOR/BOLA, horizontal/vertical escalation, org bypass.
5. **API security** → enumerate all `route.ts`; validation (zod), mass-assignment, pagination, error/info disclosure.
6. **Injection** → SQL (parameterized via Supabase client / policies), path traversal, SSRF (outbound URLs), XSS/CSRF, file upload, open redirect; LLM — N/A (no LLM).
7. **Secrets** → env inventory, hardcoded-secret scan, encryption design, committed env files. (Values never printed.)
8. **Database security** → RLS coverage, FKs, unique constraints, indexes, SECURITY DEFINER `search_path`, migration/DB drift.
9. **Integrations & webhooks** → Tochka/Telegram/Obsidian/CBR/email: auth, signature, replay, idempotency, correct-tenant routing.
10. **Business logic** → key flows (bank import, obligation settlement, invoice issue/reconcile, vault reveal, payroll) end-to-end incl. edge cases (double-submit, deleted parent, expired session, webhook/timeout).
11. **Automated relation checker** → `scripts/db_integrity_audit.sql` (read-only, PASS/WARNING/FAIL).
12. **Automated tests** → propose unit/integration/API/authorization/DB-integrity/E2E; regression test per confirmed finding.
13. **Post-fix verification** → re-run exploit/query, confirm fixed, run regressions, confirm no breakage. Never mark FIXED on "code looks right" alone.
14. **Final report** → `SECURITY_AND_INTEGRITY_AUDIT.md` (Exec summary, arch map, data-relationship map, findings SEC-xxx, data-integrity results, endpoint matrix, test coverage, priority fix plan).

## Deliverables
- `ARCHITECTURE_MAP.md` ✅
- `AUDIT_PLAN.md` ✅ (this file)
- `SECURITY_AND_INTEGRITY_AUDIT.md` ✅ (findings + matrix + integrity results)
- `scripts/db_integrity_audit.sql` ✅ (read-only integrity checker)

## Out of scope / assumptions
- Penetration of Supabase/Vercel infra itself.
- Load/DoS testing.
- Live exploit writes (need a throwaway branch) — provided as ready-to-run tests instead.
