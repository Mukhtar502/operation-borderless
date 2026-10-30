# CurrencyMesh

CurrencyMesh is a REST API sandbox for cross-border stablecoin payments. It
connects five stablecoins (cNGN, cGHS, cXAF, USDx and EURx) into one mesh,
where any currency can be swapped or sent into any other at live FX rates.

Built with Node.js, TypeScript, Express and PostgreSQL, it shows how to move
money safely:

- Balances can never go negative, and every transaction is recorded in a
  double-entry ledger that must balance.
- Retrying a request with the same Idempotency-Key never charges twice.
- FX rates fall back to cached or static rates when the live provider is down.

> Status: work in progress. See [Progress](#progress) below.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

```bash
docker compose up --build
```

This starts PostgreSQL, runs the database migrations, then starts the API on
<http://localhost:3000>. Check it is up:

```bash
curl http://localhost:3000/health   # {"status":"ok"}
curl http://localhost:3000/ready    # {"status":"ready"} once the database is reachable
```

Postgres is exposed on host port **5433** (not 5432) so it does not clash with a
local Postgres install. Change it with `DB_HOST_PORT=5434 docker compose up`.

### Running without Docker

Requires Node.js 22 LTS and Yarn 1.

```bash
cp .env.example .env
docker compose up -d db   # or point DATABASE_URL at your own Postgres
yarn install
yarn db:migrate
yarn dev
```

## Running tests

```bash
yarn install
yarn test
```

`yarn test` starts a throwaway PostgreSQL container with
[Testcontainers](https://testcontainers.com/), applies the migrations and runs
the full suite against the real database, so Docker is the only requirement.
To use an existing database instead, set `TEST_DATABASE_URL`.

| Command                 | What it runs                         |
| ----------------------- | ------------------------------------ |
| `yarn test`             | All tests                            |
| `yarn test:unit`        | Unit tests only (no database needed) |
| `yarn test:integration` | API and database tests               |
| `yarn test:coverage`    | All tests with a coverage report     |
| `yarn lint`             | ESLint with type-aware rules         |
| `yarn typecheck`        | TypeScript in strict mode            |
| `yarn format:check`     | Prettier                             |

## Tech stack

| Area      | Choice                                   |
| --------- | ---------------------------------------- |
| Runtime   | Node.js 22 LTS, TypeScript (strict mode) |
| Framework | Express 5                                |
| Database  | PostgreSQL 16, Kysely query builder      |
| Money     | decimal.js, NUMERIC(38,6) columns        |
| Tests     | Vitest, Supertest, Testcontainers        |
| Tooling   | Yarn, ESLint, Prettier, Docker Compose   |

## FX rates

`GET /v1/rates` returns the rate for every pair of different currencies
(5 × 4 = 20), each with the time it was last refreshed. `source` tells you how
fresh the rates are:

| `source` | Meaning                                                          |
| -------- | ---------------------------------------------------------------- |
| `live`   | Fetched from the provider within the last 5 minutes              |
| `stale`  | Provider is failing; the last good live rates are being reused   |
| `static` | Provider has not answered since start-up; built-in table is used |

The API keeps working when the FX provider is down. It waits 30 seconds before
retrying a failed provider, and concurrent requests share one provider call.

## Progress

- [x] Project setup, Docker Compose and migrations
- [x] Database schema with a double-entry ledger
- [x] Create and fetch wallets (unique email or phone)
- [x] FX rate service with live provider and fallback
- [x] Current FX rates endpoint
- [x] Wallet balances with total in USD
- [x] Deposits
- [x] Swaps
- [ ] Transfers
- [ ] Transaction history with pagination and filters
- [ ] OpenAPI documentation
- [ ] CI pipeline

## Acknowledgements

Live FX rates are provided by [Exchange Rate API](https://www.exchangerate-api.com).
