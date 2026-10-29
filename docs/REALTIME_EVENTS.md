# Real-time contract (Socket.IO)

PostgreSQL is the source of truth. Events are **notifications**: every state change is committed first, then broadcast. Clients must tolerate duplicates and out-of-order delivery (every event carries a unique `eventId`), and a fresh authoritative **snapshot** is sent on every (re)subscribe.

## Connection and authorization

- Endpoint `/socket.io`. The handshake uses the **same session cookie** as the REST API. No cookie / invalid session / deactivated account → `connect_error: UNAUTHENTICATED`.
- Cross-site WebSocket hijacking is blocked: if an `Origin` header is present it must equal `FRONTEND_ORIGIN`.
- Max payload 8 kB. Each socket may send 30 events / 10 s; excess gets `RATE_LIMITED`, persistent flooding is disconnected.
- Logout, password change/reset, deactivation, role change and removal from a course **disconnect the user's sockets**; sensitive events re-read the account from the database.

## Client → server (validated with strict Zod schemas; acknowledgement returns `{ ok: true }` or `{ ok: false, code, message }`)

| Event | Payload | Effect |
|---|---|---|
| `session.subscribe` | `{ sessionId }` | Server resolves the user's access and joins them to **its own** room. Clients never name rooms. 404 if no access; 403 for administrators. Then sends `session.snapshot` |
| `session.unsubscribe` | `{ sessionId }` | Leaves the room |
| `session.request_snapshot` | `{ sessionId }` | Requires an existing subscription |

## Rooms

- `session:<id>:staff` — course lecturers
- `session:<id>:students` — students with access
- `user:<id>` — used only to disconnect a user's sockets

## Server → client (all include `{ eventId, sessionId, occurredAt }`)

| Event | Audience | Extra payload |
|---|---|---|
| `session.snapshot` | requester | `{ snapshot }` — same shape as `GET /sessions/:id` (role-filtered; students never get drafts, the join code, or hidden results) |
| `session.state_changed` | both | staff: `{ status, session }` (includes join code); students: `{ status }` |
| `poll.created` / `poll.deleted` | staff | `{ poll }` / `{ pollId }` |
| `poll.opened` / `poll.updated` / `poll.closed` | both | staff: staff DTO (settings, counts); students: student DTO (`resultsVisible`, no per-user data) |
| `poll.results_updated` | staff always; students **only when** the poll's visibility rules allow | `{ pollId, results }` — aggregates only; recomputed at most once per 250 ms per poll |
| `participants.updated` | staff | `{ joined, connected }` — `joined` = attendance records; `connected` = open connections (never used as attendance) |
| `feedback.received` | staff | `{ total }` (no content) |

No event ever contains an individual response, a respondent's identity, an idempotency key, or an anonymous participant mapping (asserted by tests).
