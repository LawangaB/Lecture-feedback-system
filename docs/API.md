# REST API reference

Base path `/api/v1`. JSON in, JSON out. Authentication is a server-side session in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Every **state-changing** request (`POST/PUT/PATCH/DELETE`) must send the header `X-CSRF-Token` with the token from `GET /auth/csrf` (or from the login/register response). Unknown body fields are rejected (`400`) — this is deliberate mass-assignment protection.

**Roles:** `S` student · `L` lecturer · `A` administrator · "course lecturer" = owner/lecturer-enrolled in that course. Resource checks are enforced per course/session/poll, not just by role. Unrelated users receive `404` (not `403`) so ids cannot be probed.

## Error format

```json
{ "error": { "code": "POLL_NOT_OPEN", "message": "This poll is not accepting responses.", "requestId": "…", "details": { "fields": [{ "path": "options.1", "message": "…" }] } } }
```

| Status | Typical codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_ANSWER`, `INVALID_JSON`, `INVALID_RESET_TOKEN`, `INVALID_CURRENT_PASSWORD`, `EMPTY_FEEDBACK` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `CSRF_TOKEN_INVALID`, `CSRF_ORIGIN`, `RESULTS_HIDDEN` |
| 404 | `NOT_FOUND`, `INVALID_JOIN_CODE` (one generic code for wrong/expired/rotated/ended/not-eligible) |
| 409 | `ALREADY_RESPONDED`, `ALREADY_SUBMITTED`, `POLL_NOT_OPEN`, `SESSION_NOT_LIVE`, `POLL_ALREADY_ACTIVE`, `INVALID_POLL_STATE`, `INVALID_SESSION_STATE`, `POLL_NOT_EDITABLE`, `SESSION_ENDED`, `EMAIL_IN_USE`, `COURSE_CODE_TAKEN`, `FEEDBACK_DISABLED`, `SESSION_NOT_STARTED` |
| 413 | `PAYLOAD_TOO_LARGE` (body limit 50 kB) |
| 429 | `RATE_LIMITED` |

Pagination: admin tables and the feedback list use `page` / `pageSize` (≤100) and return `{ items, total, page, pageSize }`.

## Authentication

| Method & path | Auth | Notes |
|---|---|---|
| `GET /auth/csrf` | public | Creates the session cookie and returns `{ csrfToken }` |
| `POST /auth/register` | public, rate-limited | `{ email, password(10–128), displayName }` → always creates a **student**. 201 `{ user, csrfToken }` |
| `POST /auth/login` | public, rate-limited per IP+email | Rotates the session id. Same 401 for unknown email, bad password, disabled account |
| `POST /auth/logout` | session | Destroys the session, drops sockets. 204 |
| `POST /auth/forgot-password` | public, rate-limited | Always `202` with the same body (no account enumeration). Token: random, single-use, 30 min, stored hashed |
| `POST /auth/reset-password` | public | `{ token, newPassword }`; revokes all sessions |
| `GET/PATCH /auth/me` | session | PATCH only `displayName` |
| `POST /auth/change-password` | session | Revokes other sessions, rotates this one, returns new `csrfToken` |

## Courses

| Method & path | Who | Notes |
|---|---|---|
| `GET /courses` | any | Courses the user teaches/is enrolled in (admin: all) |
| `POST /courses` | L, A | `{ code, title, description? }`; 409 on duplicate code |
| `GET /courses/:courseId` | member, A | |
| `PATCH /courses/:courseId` | course lecturer, A | partial; `isArchived` allowed |
| `GET /courses/:courseId/enrolments` | course lecturer, A | Roster is never visible to students |
| `POST /courses/:courseId/enrolments` | course lecturer, A | `{ emails[1..200], role: STUDENT\|LECTURER }` → `{ added, notAdded[] }`; students cannot be enrolled as lecturers |
| `DELETE /courses/:courseId/enrolments/:userId` | course lecturer, A | Owner cannot be removed; drops that user's sockets |

## Lecture sessions

| Method & path | Who | Notes |
|---|---|---|
| `GET /sessions` | any | `{ live, upcoming, recent }` for the current user |
| `POST /sessions/join` | S, rate-limited | `{ code }`; records attendance; returns a limited session (no join code) |
| `POST /sessions/:id/attend` | S | Idempotent; live/paused sessions only; for students who open a session without the code |
| `GET /courses/:courseId/sessions`, `POST …` | member / course lecturer | create: `{ title, description?, scheduledFor?, accessPolicy, feedbackEnabled }` |
| `GET /sessions/:id` | session participant | **Snapshot**: `{ session, access, polls, results, participants?, serverTime }`, filtered by audience |
| `PATCH /sessions/:id` | course lecturer | not after `ENDED` |
| `POST /sessions/:id/start\|pause\|resume\|end` | course lecturer | State machine: `SCHEDULED→LIVE⇄PAUSED→ENDED`. Pause pauses the open poll; end closes it and disables the join code |
| `POST /sessions/:id/join-code/rotate` | course lecturer | Old code stops working immediately |

Join codes: 6 characters from an unambiguous alphabet via `crypto.randomInt`; stored as an HMAC for lookup plus an AES-GCM copy so lecturers can re-display it; default TTL 180 min; rate-limited.

## Polls

| Method & path | Who | Notes |
|---|---|---|
| `GET /sessions/:id/polls` | participant | Students never see drafts; staff get `responseCount` |
| `POST /sessions/:id/polls` | course lecturer | See schema below |
| `GET /polls/:id` | participant | Students also get `hasResponded`, and `myResponse` for identified polls only |
| `PUT /polls/:id`, `DELETE /polls/:id` | course lecturer | Draft only (`409 POLL_NOT_EDITABLE` otherwise) |
| `POST /polls/:id/open\|pause\|resume\|close\|reveal-results` | course lecturer | One active poll per session (advisory-locked). Timed polls are closed by a server sweeper |
| `POST /polls/:id/responses` | S, rate-limited | `{ optionIds? , ratingValue?, idempotencyKey }` → `201 created`, `200 updated`/`duplicate` |
| `GET /polls/:id/results` | staff always; students only if visible | Aggregates only. Admins get 403 |

Poll body: `{ question(3–500), type: SINGLE_CHOICE\|MULTIPLE_CHOICE\|RATING, options[2..10] (choice types), minSelections?, maxSelections?, ratingMin?, ratingMax?, durationSeconds(5–86400)?, isAnonymous=true, allowResponseUpdate=false, isRequired=false, resultsVisibility: HIDDEN\|LIVE\|AFTER_CLOSE (=AFTER_CLOSE) }`. Duplicate options are rejected case-insensitively; anonymous polls cannot allow answer changes.

Response rules enforced server-side inside one transaction: session is `LIVE`, poll is `OPEN` and not past `closesAt`, option ids belong to *this* poll, selection counts / rating range, one response per student (unique constraint), idempotent retries by key. Client timers, user ids and counts are never trusted.

## Feedback

| Method & path | Who | Notes |
|---|---|---|
| `POST /sessions/:id/feedback` | S, rate-limited | `{ ratings: {CLARITY?,PACE?,ENGAGEMENT?,MATERIALS? : 1–5}, comment?(≤2000), anonymous }` — one per student per session |
| `GET /sessions/:id/feedback/mine` | S | `{ submitted }` |
| `GET /sessions/:id/feedback`, `/feedback/summary` | course lecturer | Filters: `dimension, minRating, maxRating, anonymous, hasComment, includeHidden, page, pageSize`. Denominators included |
| `PATCH /feedback/:id` | course lecturer | `{ isHidden }` hides the comment from lists/exports; ratings still count. Audited |

## Reports, analytics, dashboards

| Method & path | Who |
|---|---|
| `GET /sessions/:id/report` | course lecturer |
| `GET /sessions/:id/export.csv?type=results\|feedback` | course lecturer, rate-limited, audited. Aggregates only; CSV cells starting `= + - @ \t \r` are neutralised and fields quoted |
| `GET /analytics/lecturer/overview` | L |
| `GET /dashboard/student`, `GET /users/me/participation` | S (participation shows *that* they answered, never an anonymous answer) |

## Administration (role `ADMIN` only)

`GET /admin/overview` · `GET|POST /admin/users` · `PATCH /admin/users/:id` (`role`, `isActive`, `displayName`; cannot demote/deactivate yourself; role change or deactivation revokes sessions and disconnects sockets) · `GET /admin/audit-events` (`action` prefix, `actorId`, paging).

Health (unauthenticated): `GET /health/live`, `GET /health/ready` (checks the database).
