# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

An AmoCRM widget that automatically distributes incoming deals between managers using configurable rules. It has two parts:

- **Widget frontend** (`widget.js`, `css/`, `i18n/`, `manifest.json`) — an AMD JavaScript module loaded inside AmoCRM.
- **Backend service** (`server/`) — a PHP 8.1+ Slim 4 API that executes distribution logic and stores state.

---

## Commands

### Backend (from `server/`)

```bash
composer install                          # install dependencies
composer start                            # dev server on :8080
./vendor/bin/phpunit                      # run all tests
./vendor/bin/phpunit --filter ClassName   # run a single test class
./vendor/bin/phpunit --testdox            # verbose output (used in CI)
```

### Widget ZIP (from repo root)

```bash
./build.sh                   # build dist/deal-distribution-widget-vX.Y.Z.zip
./build.sh --bump patch      # bump patch version, then build
./build.sh --version         # print current version from manifest.json
```

### Docker

```bash
docker compose up -d          # start app + nginx + certbot
docker compose build app      # rebuild PHP image
docker compose logs -f        # tail logs
```

---

## Architecture

### Frontend — AMD module (`widget.js`)

`widget.js` is an AMD module (`define(['jquery', 'underscore'], ...)`) loaded by AmoCRM's internal module system. It must not use ES modules, `require()`, or bundlers. AmoCRM injects pipeline/stage/user data via `AMOCRM.data.pipelines`, `AMOCRM.data.users`, etc.

**AmoCRM widget lifecycle hooks** (all must return `true`):
- `self.render` / `self.init` / `self.bind` / `self.bind_actions` — standard lifecycle
- `self.settings($container)` — renders the config UI into AmoCRM's settings panel
- `self.onSave()` — collects form values into `self.params` before AmoCRM saves them
- `self.dpSettings()` — renders and collects per-stage Digital Pipeline settings
- `self.dpInit(pipeline, status, lead)` — triggered on lead events in Digital Pipeline

Settings (`self.params`) are persisted by AmoCRM; the widget also syncs them to the backend via `PUT /api/settings`.

### Backend — Slim 4 PHP app

Entry point: `server/public/index.php` → `AppFactory::create()` in `server/src/App/AppFactory.php`.

All routes are registered in `AppFactory`. The DI container (PHP-DI) currently only wires `Logger`; all other services (`ApiClient`, `QueueStorage`, `ScheduleChecker`, `DistributionLog`, `DistributionService`) are instantiated directly inside controllers.

**Namespace root:** `DealDist\` → `server/src/`

### Distribution decision flow (`DistributionService::distribute`)

1. Load full lead from AmoCRM API (`?with=tags,contacts,companies`)
2. Find first matching rule: `dpSettings` (Digital Pipeline) takes priority over `rules[]`. A rule matches when `pipeline_id` and `stage_id` match (null = wildcard) and `DealFilter::matches()` passes.
3. If `check_history`: look for an existing responsible on the contact/company's other deals. If found and in the rule's manager list, assign immediately.
4. If `check_schedule`: filter manager list to those currently within working hours via `ScheduleChecker`.
5. Pick manager by strategy: `round_robin` (via `QueueStorage`) or `workload` (fewest open leads via AmoCRM API).
6. PATCH the lead's `responsible_user_id` via AmoCRM API.
7. Write a line to the NDJSON distribution log.

Outcomes logged as `reason`: `assigned`, `history_match`, `skipped_no_rule`, `skipped_schedule`, `skipped_no_managers`.

### Two trigger paths

| Path | How | Auth |
|---|---|---|
| Digital Pipeline | AmoCRM calls `dpInit()` → widget POSTs to `/api/distribute` with `dp_settings` | `X-Widget-Version` header |
| Webhook | AmoCRM POSTs form-encoded to `/webhook/leads?account_id=XXX` | `X-Widget-Secret` header (HMAC) |

### Filesystem storage layout (`STORAGE_PATH`)

All persistence is flat JSON/NDJSON files — no database.

```
STORAGE_PATH/
├── tokens/{accountId}.json          # OAuth access + refresh tokens per account
├── settings/{accountId}.json        # Widget settings (rules, method)
├── queues/{accountId}/{ruleHash}.json  # Round-robin pointer; ruleHash = md5(pipeline_id+stage_id)
├── schedules/{accountId}/{userId}.json # Manager work schedule
└── logs/{accountId}.ndjson          # Append-only distribution log (max 10k lines)
```

`QueueStorage` uses `LOCK_EX` on writes. `DistributionLog` is append-only; call `rotate()` periodically to trim to 10,000 lines.

### OAuth flow

AmoCRM redirects users to `GET /oauth/callback` after granting access. `OAuthController` exchanges the code for tokens via AmoCRM's OAuth2 endpoint and saves them to `STORAGE_PATH/tokens/{accountId}.json`. `ApiClient` auto-refreshes the access token on 401 responses and persists the new tokens.

---

## CI/CD

CI (`ci.yml`) runs on every push: PHPUnit → widget ZIP build → deploy to `dist.koagency.me` (on `main` only via SSH). Deployment pulls `main` and runs `docker compose build && up -d`.

## Environment variables

See `server/.env.example`. Required: `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`, `AMO_REDIRECT_URI`, `STORAGE_PATH`. Optional: `LOG_LEVEL` (default `INFO`), `WIDGET_SECRET` (enables webhook auth).
