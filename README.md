# Real-Time Lecture Feedback & Polling System

Lecturers run live polls and collect feedback; students join from any device with a code or QR link; results stream to the lecturer in real time. React + TypeScript SPA, Express + Socket.IO API, PostgreSQL via Prisma.

> **Status:** a coherent, working vertical slice covering authentication, courses, sessions, polls (single / multiple / rating), real-time delivery, feedback, reports/exports and administration. See [Implementation status](#implementation-status) for exactly what was verified and what was **not** — please read it before deploying.

## Quick start (local development)

Prerequisites: Node.js 22 LTS, Docker (or any PostgreSQL 16).

```bash
# 1. Secrets and database
cp .env.example .env                      # used by docker compose; set POSTGRES_PASSWORD
cp .env.example backend/.env              # used by the API; set SESSION_SECRET, JOIN_CODE_KEY, DATABASE_URL
#    Generate secrets with:  openssl rand -base64 48
#    DATABASE_URL must use the same user/password/db as POSTGRES_* in .env
docker compose up -d postgres

# 2. Backend (http://localhost:4000)
cd backend
npm ci
npx prisma migrate deploy                 # applies prisma/migrations
npm run db:seed                           # DEV ONLY: labelled test accounts + sample data
npm run dev

# 3. Frontend (http://localhost:5173) — in a second terminal
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` and `/socket.io` to the API so cookies, CSRF and the WebSocket Origin check behave exactly as in production.

### Seeded development accounts (dev only)

Password for every seeded account: `DevPassword!2026`

| Role | Email |
|---|---|
| Administrator | `admin@lectures.test` |
| Lecturer | `lecturer@lectures.test` |
| Students | `student1@lectures.test` … `student6@lectures.test` |

The seed prints a live demo join code (`DEMO42`); join codes expire (default 3 h; the seeded one 6 h), so create a fresh session or press **New code** once it lapses. The seed script refuses to run when `NODE_ENV=production`.

## Everyday commands

| Where | Command | Purpose |
|---|---|---|
| `backend` | `npm run dev` / `npm run build && npm start` | Run / build the API |
| `backend` | `npm test` | 93 Vitest + Supertest + Socket.IO tests (needs a migrated test database, see [docs/TESTING.md](docs/TESTING.md)) |
| `backend` | `npm run typecheck`, `npm run lint` | Static checks |
| `frontend` | `npm run dev` / `npm run build` | Dev server / production bundle |
| `frontend` | `npm test` | 21 Vitest + Testing Library tests |
| `frontend` | `npm run e2e` | Playwright specs (see status: not yet executed) |

## Production

A multi-stage `Dockerfile` builds the SPA and API into one non-root image (the API serves the SPA with a strict CSP). `docker compose --profile app up --build` runs postgres → one-shot `migrate` job → `app`. Production mode requires `FRONTEND_ORIGIN` to be an `https://` URL and uses `Secure` cookies, so it cannot be exercised over plain HTTP — use `npm run dev` locally. Put a TLS-terminating reverse proxy in front (enable WebSocket upgrade and sticky routing if you ever run several instances). **Migrations are a separate step and never run on app start.** Read [docs/SECURITY.md](docs/SECURITY.md) (checklist and known limitations) before going live.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data model, permission matrix, anonymity design
- [docs/API.md](docs/API.md) — every REST endpoint: auth, role, validation, status codes, error format
- [docs/REALTIME_EVENTS.md](docs/REALTIME_EVENTS.md) — Socket.IO contract and room authorization
- [docs/SECURITY.md](docs/SECURITY.md) — controls, release checklist, **known limitations**
- [docs/TESTING.md](docs/TESTING.md) — test strategy, how to run, what is and is not covered

## Implementation status

**Verified by running it in the build environment (Node 22, PostgreSQL 16):**

- Backend: `tsc` clean, ESLint clean, **93/93 tests pass** against a real PostgreSQL database (auth/CSRF/session security, IDOR/BOLA and role boundaries, poll lifecycle, validation, idempotency and concurrency, anonymity isolation, exports/CSV injection, feedback, administration, Socket.IO authentication/room authorization/leakage/reconnection).
- Frontend: `tsc` clean, ESLint clean, **21/21 component and client tests pass**, production build succeeds.
- The compiled API boots with a production-only dependency install, serves the built SPA with the production CSP/HSTS, and a scripted lecturer + student journey over REST and WebSocket completed (login → join → open poll → answer → live results → close) with zero server errors.
- `npm audit --omit=dev`: 0 vulnerabilities in both projects (transitive Prisma-CLI advisories pinned via `overrides`).

**Written but NOT executed (no browser / Docker was available in the build environment):**

- Playwright E2E and axe accessibility specs in `frontend/e2e` (type-checked and linted only). Expect to adjust selectors on first run.
- `Dockerfile`, `docker-compose.yml`, and the CI workflow were not built or run. The runtime image's key assumption (production-only install boots and serves) was simulated locally.
- No manual accessibility review (screen reader, zoom/reflow), no real-device mobile testing, and no load test (the spec's 300-concurrent-user target) was performed.

**Deliberately different from, or missing relative to, the brief** — details in [docs/SECURITY.md](docs/SECURITY.md#known-limitations):

- **Migration SQL is hand-written.** Prisma's schema engine could not be downloaded in the build sandbox, so `prisma/migrations/20261011000000_init/migration.sql` was written by hand to mirror `schema.prisma`, applied to PostgreSQL 16, and exercised by all 93 tests. `prisma migrate deploy` just applies it, but run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (needs a shadow DB) once on your machine to confirm there is no drift.
- **shadcn/ui** components are hand-written in the shadcn style on Radix primitives (the shadcn CLI registry was unreachable). There is no `components.json`.
- **Administrator MFA is not implemented.** Admin accounts rely on password + rate limiting.
- **No email transport.** Password-reset emails go to a dev outbox/console only; in production the reset flow does not deliver mail until you supply a `Mailer`.
- **Rate limiting, Socket.IO fan-out and presence are single-instance** (in memory). Redis is not wired in; add it before running more than one API instance.
- Q&A queue, announcements, and a persistent notifications table (in the supplied spec package) are **not built**; "notifications" in the UI is a live-now list. In-app camera QR scanning is not built (the QR encodes a link that the phone camera opens).
- Data-retention/purge jobs are **not automated** (deletion behaviour is defined by foreign keys; see ARCHITECTURE).
- No OpenAPI document; see `docs/API.md`.
