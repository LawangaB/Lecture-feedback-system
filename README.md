# Real-Time Lecture Feedback & Polling System

A web application for lecturers to organise courses, run interactive lecture sessions, create live polls, and collect feedback. Students join a session with a code or QR link and participate from their own devices. Poll activity and attendance update live for the lecturer.

## What the application does

- **Authentication and roles:** account registration and login, profile and password management, and separate Student, Lecturer, and Administrator capabilities.
- **Courses and enrolments:** create and update courses, archive them, add existing student or lecturer accounts by email, and remove students from a course.
- **Lecture sessions:** schedule sessions, configure who can join and whether feedback is enabled, then start, pause, resume, or end a session. Share a time-limited join code or QR link and rotate a code when needed.
- **Live polls:** build single-choice, multiple-choice, and rating polls. Configure response limits, anonymity, answer changes, duration, and results visibility. Manage draft polls and control the open, paused, closed, and results-revealed states.
- **Participation and feedback:** students submit poll answers and rate lecture clarity, pace, engagement, and materials, with an optional comment. Lecturers see live participation and feedback summaries; individual comments can be hidden.
- **Reports and administration:** review session reports, export poll results or feedback as CSV, manage user roles and account activation, and inspect audit events.

The frontend is a React + TypeScript single-page application. The backend is an Express + Socket.IO API with PostgreSQL and Prisma.

## CRUD and lifecycle guide

CRUD actions depend on the resource and the user's role. Some records are deliberately managed through lifecycle actions instead of hard deletion.

| Resource | Create | Read | Update | Delete or lifecycle |
|---|---|---|---|---|
| Courses | Lecturer or administrator creates a course; creator becomes a lecturer on it. | Course list, details, sessions, and (for managers) roster. | Managers update course details or archive/unarchive through the API. | No permanent course-delete action. Managers can add people by email or remove a student enrolment. |
| Sessions | Lecturer creates a session inside a course. | Course session list, session view, attendance, and report. | Update session details and join settings. | No delete action. Start, pause, resume, and end the session instead. Join codes can be rotated. |
| Polls | Lecturer creates a poll in a session. | Read poll details and, according to poll settings and role, results. | Edit a draft poll. | Delete draft polls only. Open, pause, resume, close, and reveal results for a poll as its lifecycle actions. Submitted answers are responses, not poll records. |
| Users | Administrator creates accounts; users can register themselves. | Users see and update their own account; administrators can search and list accounts. | Users update their own profile/password. Administrators can change a display name, role, or active status. | No hard-delete action. Administrators deactivate accounts instead. |
| Feedback | Student submits feedback once for a session. | Student can check whether they submitted; lecturers can view session feedback and summaries. | Lecturer can hide or unhide a comment. | No individual feedback delete action is exposed in the app. |

### Typical workflows

**Lecturer:** create a course, add existing accounts from the course's **People** tab, schedule a session, and start it when ready. Create polls in the session control room, open them for responses, and monitor results as they arrive. End the session to make a report available, then export results or feedback as CSV.

**Student:** sign in, open **Join a lecture**, and enter the code shown by the lecturer (or open the QR link). Answer open polls, optionally update an answer when the poll permits it, and submit session feedback. The dashboard shows live sessions and participation history.

**Administrator:** use **Admin → Users** to create accounts, search and filter the user list, update roles, and activate or deactivate accounts. **Admin → Audit** shows recorded administrative and application events.

## API examples

The API is rooted at `/api/v1`. These examples show the resource routes; write requests require an authenticated session and the CSRF token supplied by `GET /api/v1/auth/csrf`. The browser client handles session cookies and CSRF tokens automatically. Role and ownership checks are enforced by the API.

| Action | Method and path |
|---|---|
| List or create courses | `GET` / `POST /api/v1/courses` |
| Read or update a course | `GET` / `PATCH /api/v1/courses/:courseId` |
| Add or remove course enrolments | `POST /api/v1/courses/:courseId/enrolments` / `DELETE /api/v1/courses/:courseId/enrolments/:userId` |
| Create a session in a course | `POST /api/v1/courses/:courseId/sessions` |
| Update a session or change its status | `PATCH /api/v1/sessions/:sessionId`; `POST /api/v1/sessions/:sessionId/{start,pause,resume,end}` |
| List, create, or update session polls | `GET` / `POST /api/v1/sessions/:sessionId/polls`; `PUT /api/v1/polls/:pollId` |
| Delete a draft poll or submit a response | `DELETE /api/v1/polls/:pollId`; `POST /api/v1/polls/:pollId/responses` |
| Read report or export CSV | `GET /api/v1/sessions/:sessionId/report`; `GET /api/v1/sessions/:sessionId/export.csv?type=results` (or `type=feedback`) |

## Local development

Prerequisites: Node.js 22 or newer and a running PostgreSQL database. The repository does not include a Docker Compose file; configure the database yourself and set `DATABASE_URL` in the backend environment file.

1. Copy the root `.env.example` to `backend/.env`.
2. Set `DATABASE_URL` to your PostgreSQL database. Replace the placeholder `SESSION_SECRET` and `JOIN_CODE_KEY` with independent random values of at least 32 characters. For example, generate each with `openssl rand -base64 48`.
3. In a terminal, install backend dependencies, apply migrations, optionally seed development data, and start the API:

```bash
cd backend
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

4. In a second terminal, start the frontend:

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies API and Socket.IO requests to the backend at `http://localhost:4000`.

### Development seed accounts

Run `npm run db:seed` from `backend` to create sample data. The password for all seeded accounts is `DevPassword!2026`.

| Role | Email |
|---|---|
| Administrator | `admin@lectures.test` |
| Lecturer | `lecturer@lectures.test` |
| Students | `student1@lectures.test` through `student6@lectures.test` |

The seed creates a sample course, a past session with poll responses and feedback, a live session, and an upcoming session. Its live join code is `DEMO42`; it expires after six hours. Seed data and the shared password are for local development only. The seed refuses to run when `NODE_ENV=production`.

## Useful commands

| Directory | Command | Purpose |
|---|---|---|
| `backend` | `npm run dev` | Run API in watch mode |
| `backend` | `npm run db:migrate` | Apply database migrations |
| `backend` | `npm run db:seed` | Add development demo accounts and sample data |
| `backend` | `npm test` | Run backend tests |
| `backend` | `npm run typecheck` / `npm run lint` | Type-check / lint backend and tests |
| `frontend` | `npm run dev` | Run Vite development server |
| `frontend` | `npm test` | Run frontend tests |
| `frontend` | `npm run e2e` | Run Playwright end-to-end tests |
| `frontend` | `npm run build` | Type-check and build the frontend |

## Production notes

Production requires valid, private secrets, an HTTPS `FRONTEND_ORIGIN`, and a secure deployment for PostgreSQL. Apply migrations as a deployment step; the API does not migrate the database on startup. The API can serve a built frontend when `SERVE_STATIC_DIR` is configured. Configure your hosting or reverse proxy for Socket.IO/WebSocket traffic. Password-reset delivery requires a mail transport to be configured; the repository does not include a production email provider.
