# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **AmoCRM Deal Distribution Widget** — a PHP/Slim 4 backend service paired with an AMD JavaScript frontend that automatically distributes incoming deals among managers using configurable rules (round-robin, workload-based, history, schedule, and field-based filtering).

## Commands

### Backend (PHP/Slim 4)

```bash
cd server

# Install dependencies
composer install

# Run all tests
./vendor/bin/phpunit --testdox

# Run a single test file
./vendor/bin/phpunit --testdox tests/Unit/Distribution/DistributionServiceTest.php

# Run a single test method
./vendor/bin/phpunit --testdox --filter testRoundRobinAssignsManager

# Start dev server (port 8080)
composer start
```

### Build & Deploy

```bash
# Package widget into a versioned ZIP (for uploading to AmoCRM)
./build.sh

# Bump version and build
./build.sh --bump patch   # or minor / major

# Full server deployment (Ubuntu 22.04, first-time setup)
./deploy.sh
```

### Docker

```bash
# Start all services (PHP-FPM, Nginx, Certbot)
docker compose up -d

# Rebuild after code changes
docker compose build && docker compose up -d
```

## Architecture

### Repository Layout

```
/
├── widget.js          — Frontend widget (AMD module, 862 lines)
├── manifest.json      — AmoCRM widget metadata
├── css/widget.css     — Widget styling
├── i18n/             — Russian/English translations
├── server/           — PHP backend (Slim 4)
│   ├── public/index.php          — Entry point
│   ├── src/
│   │   ├── App/AppFactory.php    — Bootstrap: DI, middleware, routes
│   │   ├── AmoCRM/ApiClient.php  — AmoCRM REST API v4 wrapper
│   │   ├── Config/SettingsStorage.php
│   │   └── Distribution/        — Core domain logic
│   └── tests/Unit/Distribution/
├── docker/nginx/      — Nginx config (TLS, FastCGI)
├── docker-compose.yml
└── .github/workflows/ci.yml
```

### Backend Layer Responsibilities

- **`AppFactory`** — Loads `.env`, wires PHP-DI container, registers all Slim routes and middleware.
- **`ApiClient`** — All AmoCRM API v4 calls; handles OAuth2 token refresh automatically on 401.
- **`DistributionService`** — Orchestrates lead assignment: selects strategy via `match()`, applies `DealFilter`, checks `ScheduleChecker`, persists to `QueueStorage`, writes to `DistributionLog`.
- **`DealFilter`** — Filters rules against lead fields (budget_min/max, pipeline, stage, custom fields).
- **`QueueStorage`** — Persists round-robin queue state per rule hash.
- **`ScheduleChecker`** — Validates manager availability against work-hour schedules.

### Data Storage (file-based, no database)

All data lives in `STORAGE_PATH/` (set in `.env`):

| Path | Contents |
|------|----------|
| `tokens/{accountId}.json` | OAuth2 access + refresh tokens |
| `settings/{accountId}.json` | Widget configuration per account |
| `queues/{ruleHash}.json` | Round-robin queue state |
| `schedules/{accountId}/{userId}.json` | Manager work schedules |
| `logs/{date}.json` | Distribution audit trail |

### API Routes

```
POST   /api/distribute              — Assign lead to manager (called from widget)
GET    /api/settings                — Fetch widget settings
PUT    /api/settings                — Save widget settings
GET|PUT|DELETE /api/schedules/{userId}  — Manager schedule CRUD
GET    /api/queue                   — Round-robin queue state
POST   /api/queue/{ruleHash}/reset  — Reset a queue
GET    /api/log                     — Distribution log
POST   /webhook/leads               — Legacy webhook fallback
GET    /oauth/callback              — OAuth2 callback
```

### Frontend (`widget.js`)

AMD module pattern: `define(['jquery', 'underscore'], ...)`. Integrates with AmoCRM's native JS API. Makes AJAX requests to the backend using `system.account_id` for multi-tenancy. Uses `self.i18n('key')` for all user-facing strings (backed by `i18n/` files).

### CI/CD (`.github/workflows/ci.yml`)

Three jobs: **test** (PHPUnit) → **build** (runs `build.sh`, uploads ZIP artifact) → **deploy** (SSH to production, `git pull` + `docker compose up`, only on push to `main`).

## Key Conventions

- Every PHP file starts with `declare(strict_types=1)` and uses explicit return types.
- PSR-4 autoloading under the `DealDist\` namespace.
- Constants: `SCREAMING_SNAKE_CASE`. Methods: `camelCase`.
- Environment variables accessed directly via `$_ENV[]`; no config wrapper classes.
- Logging via Monolog to stderr (Docker-friendly); log level set by `LOG_LEVEL` env var.
- Tests use mocks for `ApiClient` and `QueueStorage`; private helpers (`payload()`, `rule()`, `leadData()`) build test data.

## Environment Variables (`.env`)

```
AMO_CLIENT_ID=
AMO_CLIENT_SECRET=
AMO_REDIRECT_URI=
STORAGE_PATH=/var/www/html/storage
LOG_LEVEL=debug
```
