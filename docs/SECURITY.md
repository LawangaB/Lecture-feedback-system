# Security & privacy

A control listed here is **implemented**, and where marked ✔ **covered by an automated test that was run**. Controls that are not built are listed under [Known limitations](#known-limitations) rather than implied.

## Release checklist

| ✔/☐ | Item | Where / how |
|---|---|---|
| ✔ | Argon2id password hashing (19 MiB, t=2, p=1); timing-equalised login | `utils/password.ts`; auth tests |
| ✔ | Server-side sessions in PostgreSQL; `HttpOnly`, `SameSite=Lax`, `Secure` in production; idle (8 h rolling) + absolute (24 h) expiry | `middleware/session.ts`, `auth.ts` |
| ✔ | Session id rotated on login, register, password change; sessions revoked on logout, password reset/change, deactivation, role change | auth + admin tests |
| ✔ | CSRF: synchroniser token in the session + `Origin` check on every state-changing request | `middleware/csrf.ts`; tests for missing/wrong token and foreign origin |
| ✔ | Generic login errors; reset emails never reveal account existence; reset tokens random, single-use, 30 min, stored hashed | auth tests |
| ✔ | Zod validation on every body/query/param; unknown fields rejected; 50 kB body limit | `middleware/validate.ts` |
| ✔ | Deny-by-default, resource-level authorization (course/session/poll), 404 for unrelated users (IDOR/BOLA) | `services/permissions.ts`; 16-route probe test |
| ✔ | Poll integrity: state/deadline re-checked in the transaction, option ownership (also a composite FK), selection/rating bounds, unique one-response, idempotency keys, concurrency test (8 parallel submissions → 1 row) | polls tests |
| ✔ | Anonymous answers: no user id, no timestamp; absent from results, snapshots, events, reports, CSV (tested with ids/emails/names) | polls/feedback/realtime tests |
| ✔ | Socket.IO: cookie-session auth, Origin allowlist, server-chosen rooms, per-event authorization, payload schemas, rate limit + disconnect, revocation disconnects | realtime tests |
| ✔ | Join codes: CSPRNG, HMAC at rest, TTL, rotation, rate limit, one generic failure | session tests |
| ✔ | CSV formula-injection escaping + quoting; exports audited and aggregate-only | unit + export tests |
| ✔ | Helmet; API CSP `default-src 'none'`; SPA CSP `script-src 'self'` when served by the API; HSTS in production; `Cache-Control: no-store` on the API; no stack traces | header tests; production boot check |
| ✔ | Structured logs (pino) with redaction of cookies, passwords, tokens, comments; query strings never logged | `utils/logger.ts` |
| ✔ | Audit log: sign-ins, failures, role/status changes, enrol/unenrol, session/poll controls, exports, moderation | admin tests |
| ✔ | Placeholder-secret guard; env validated at start; `.env.example` has placeholders only; seed refuses production | `config/env.ts`, `seed.ts` |
| ✔ | `npm audit --omit=dev` = 0 vulnerabilities (backend and frontend) | CI step |
| ☐ | HTTPS/TLS at your reverse proxy, `TRUST_PROXY` set correctly, WebSocket upgrade enabled | **deployment task** |
| ☐ | Strong production secrets (`openssl rand -base64 48`) in a secret manager | **deployment task** |
| ☐ | Least-privilege DB role (not superuser), private network, encrypted backups, **tested restore** | **deployment task** |
| ☐ | Run Playwright + axe specs, manual keyboard/screen-reader review, load test at your target concurrency | **not yet done** |
| ☐ | Define retention periods and add the purge job; publish privacy notice and incident process | **not yet done** |

## Known limitations

1. **No MFA for administrators.** The brief asks for it "where feasible"; it was not implemented. Treat admin accounts as high risk (strong passwords, restrict network access) until TOTP/OIDC is added.
2. **No email transport.** `services/mail.ts` has a dev outbox/console mailer; production uses a mailer that drops messages (and never logs the token), so **password reset does not work in production** until you implement `Mailer` (SMTP/provider).
3. **No email verification**; `POST /auth/register` reveals whether an email is taken (409). It is rate-limited. Add verification or invitation-only registration if enumeration matters.
4. **Single-instance state.** Rate limits, socket rooms and presence are in memory. Multiple API instances need a Redis rate-limit store and the Socket.IO Redis adapter (not included).
5. **Anonymity is application-level** (see ARCHITECTURE.md): database administrators, tiny groups and infrastructure logs can still narrow identities.
6. **No automated retention/deletion**, no data-export/deletion request tooling.
7. **Session lifecycle:** ended sessions are final (no reopen). Join code TTL is fixed by config (default 180 min).
8. **Hand-written migration SQL** (Prisma schema engine was unreachable in the build environment). Verify drift once with `prisma migrate diff` before the first production deploy.
9. **Spec items not built:** Q&A queue and voting, announcements, persistent notifications, institutional SSO, user-selectable timezone/notification preferences, in-app QR camera scanning, OpenAPI document.
10. **Not executed:** E2E/axe specs, Docker build, CI run, load test, manual accessibility audit.
11. `'unsafe-inline'` is allowed for **styles only** in the SPA CSP because Radix and Recharts set inline style attributes; scripts remain `'self'`.

## Reporting a vulnerability

Add a contact address and process here before launch (`SECURITY.md` in the repository root is the conventional place).
