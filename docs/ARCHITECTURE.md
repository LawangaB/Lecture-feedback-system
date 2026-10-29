# Architecture notes

```
Browser (Student / Lecturer / Admin)
   │ HTTPS REST + WebSocket (same origin in dev via the Vite proxy)
   ▼
React + TypeScript SPA  (TanStack Query = server state, Socket.IO client, RHF + Zod, Recharts)
   ▼
Express API ──────────── Socket.IO gateway (shares the cookie session)
   │  middleware: request-id → helmet → CORS → rate limit → JSON(50 kB) → session → CSRF → auth
   │  modules: auth · courses · lecture-sessions · polls · feedback · analytics · users · admin
   ▼
PostgreSQL (Prisma 7 + driver adapter) — source of truth, also stores sessions (`user_sessions`)
```

Layout: `backend/src/{config,middleware,modules/*,realtime,services,utils}`, `backend/prisma/{schema.prisma,migrations,seed.ts}`, `frontend/src/{components,features,hooks,lib,routes,pages,styles,types}`. Business rules live in `*.service.ts` files; routes only validate, call a service and shape the response. Authorization is centralised in `services/permissions.ts` and reused by REST and Socket.IO.

## Data model (Prisma)

Distinct concepts are stored separately on purpose:

| Concept | Tables | Holds |
|---|---|---|
| Identity | `User`, `PasswordResetToken`, `user_sessions` | Argon2id hash, role, active flag |
| Membership | `Course`, `Enrolment` | who teaches / is enrolled |
| Attendance | `AttendanceRecord` | *that* a student joined/opened a live session — never linked to answers |
| Poll participation | `PollParticipation` | *that* a student answered (enforces one response per student, stores the idempotency key) |
| Poll answers | `PollResponse`, `PollResponseOption` | *what* was answered; multi-select is a join table, not a text blob |
| Feedback | `FeedbackParticipation` / `FeedbackEntry` / `FeedbackRating` | same participation-vs-content split |
| Audit | `AuditLog` | actor, action, target, small metadata (never answers, passwords or free text) |

Integrity enforced by the database: unique `(pollId, userId)` participation; composite foreign keys `(optionId, pollId)` and `(responseId, pollId)` so a selected option **must belong to the same poll** (cross-poll injection is impossible even if app code were wrong); `CHECK` constraints for rating range, selection bounds, non-blank text. Deletion: course/session/poll deletion cascades; deleting a user sets `PollResponse.userId` / `FeedbackEntry.userId` to null (answers are kept, identity removed); `Course.ownerId` and `createdById` are `RESTRICT`.

## Anonymity design (and its limits)

For `isAnonymous` polls and anonymous feedback the answer row has **no user id, no timestamp, and a random UUID key**. The only per-student record is the separate `PollParticipation` / `FeedbackParticipation` row ("this student answered"), which carries no answer data. Anonymous polls therefore cannot allow answer changes (nothing links the student to the answer to update). Aggregates, snapshots, socket events, reports and exports are tested to contain no student id, email or name for anonymous data.

What this does **not** protect against (stated honestly in the UI copy and here): a person with direct database access can still infer links from physical row order or from tiny groups (e.g. a poll with one respondent); infrastructure/network logs; the lecturer recognising a very small class. "Anonymous" means *not linked to a student in application data and instructor-facing views*.

## Permission matrix (enforced in the API; the UI mirrors it only for convenience)

| Action | Student (enrolled) | Course lecturer | Other lecturer | Admin |
|---|---|---|---|---|
| See course / sessions | ✓ | ✓ | ✗ (404) | ✓ course, session metadata |
| Roster, enrol/remove | ✗ (403) | ✓ | ✗ | ✓ |
| Create/edit/start/end session, rotate code | ✗ | ✓ | ✗ | ✗ |
| Create/launch/close polls, reveal results | ✗ | ✓ | ✗ | ✗ |
| Answer polls, send feedback, join | ✓ | ✗ | ✗ | ✗ |
| Live results | only if allowed | ✓ | ✗ | ✗ (by design) |
| Feedback list, reports, CSV export | ✗ | ✓ | ✗ | ✗ |
| Users, roles, deactivate, audit log | ✗ | ✗ | ✗ | ✓ |

## Poll lifecycle

`DRAFT → OPEN ⇄ PAUSED → CLOSED` (closed is final). One active (open/paused) poll per session, guarded by a transaction-scoped PostgreSQL advisory lock. Timed polls store `closesAt`; a 1-second server sweeper closes expired polls and broadcasts, and submissions past the deadline are refused regardless of any client timer. Pausing the session pauses the open poll; ending it closes polls and disables the join code.

## Scaling notes

Single API instance is supported out of the box. For several instances you must add: a Socket.IO Redis adapter, a shared rate-limit store, shared presence, and sticky routing for the polling transport (see SECURITY.md → Known limitations). Result broadcasts are coalesced (≤1 recompute / 250 ms / poll) to keep 300-student bursts cheap; this has **not** been load-tested.

## Retention

Defined by foreign keys (above) but **no automated purge job exists**. Before production decide retention periods for sessions/responses/feedback/audit logs and add a scheduled job; the schema is ready for per-course or time-based deletion.
