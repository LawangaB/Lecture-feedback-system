# Testing

## Backend (`cd backend`)

Tests use a **real PostgreSQL database** (not mocks) because uniqueness, composite foreign keys, advisory locks and transactions are part of what is being tested.

```bash
createdb lecture_feedback_test            # or via psql / Docker
DATABASE_URL=postgresql://USER:PASS@localhost:5432/lecture_feedback_test?schema=public npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/lecture_feedback_test?schema=public npm test
```

`TEST_LOG_LEVEL=error npm test` re-enables server logging when debugging. **Never point `TEST_DATABASE_URL` at real data**: each test file truncates the tables.

| File | Covers |
|---|---|
| `unit.test.ts` | CSV escaping, join-code generation/hash/encrypt, poll schema rules, result-visibility rules |
| `auth.test.ts` | register/login/logout, hashes, cookie flags, session fixation, generic errors, CSRF (missing/wrong token, foreign origin), headers, body limits, reset flow, login rate limit |
| `polls.test.ts` | join flow & generic errors, attendance, lifecycle + one-active-poll, deadlines, answer validation, cross-poll injection, idempotent retries, concurrent duplicate submits, aggregates, visibility, **anonymity isolation**, CSV injection |
| `permissions.test.ts` | IDOR/BOLA across 16 routes, student/lecturer/admin boundaries, admin management + session revocation, audit log, enrolment rules, validation hygiene |
| `feedback.test.ts` | anonymous vs identified feedback, one-per-student, denominators/filters, moderation, XSS payload stored inertly |
| `realtime.test.ts` | socket auth, Origin check, room authorization, schema validation, audience-specific snapshots/events, **no leakage of hidden results or identities**, timer close, reconnection, revocation, flood control |

## Frontend (`cd frontend`)

`npm test` runs Vitest + Testing Library (jsdom): API client (CSRF fetch/retry, error mapping, 401 handling), login/register validation, the student poll interface (server-confirmed submission, retry with the same idempotency key, multi-select limits, paused/offline states, result visibility), the poll builder (duplicate options, anonymity rules, preview, payload).

## End-to-end and accessibility (`npm run e2e`) — written, not yet run

`frontend/e2e/*.spec.ts` drive two real browser contexts (lecturer + mobile student): join → build/launch poll → answer → live count → confirmed close; hidden→revealed results; outsider blocked; admin account lifecycle; mobile overflow; axe WCAG 2.2 AA scans and keyboard checks. They need the seeded dev database and both dev servers (Playwright starts them if not running) and `npx playwright install chromium`. Automated axe checks find only a fraction of accessibility problems; a manual keyboard and screen-reader pass is still required.

## Not covered yet

Load testing (target: 300 concurrent participants, p95 < 300 ms reads, results < 2 s), multi-instance Socket.IO behaviour, backup/restore drills, real-device mobile testing, penetration testing.
