import { prisma, Prisma, type LectureSession } from '../../db.ts';
import { env } from '../../config/env.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import { audit } from '../../services/audit.ts';
import { loadSessionAsLecturer, loadSessionWithAccess, requireCourseLecturer, requireCourseMember, isCourseLecturer, type SessionAccess } from '../../services/permissions.ts';
import { hub } from '../../realtime/hub.ts';
import { connectedCount } from '../../realtime/presence.ts';
import { AppError, conflict, forbidden } from '../../utils/errors.ts';
import { decryptText, encryptText, generateJoinCode, hashJoinCode } from '../../utils/crypto.ts';
import { closeActivePolls, listPolls, pauseActivePolls } from '../polls/poll.service.ts';
import { resultsVisibleToStudents } from '../polls/poll.dto.ts';
import { computeResults } from '../polls/poll.results.ts';
import type { z } from 'zod';
import type { createSessionBody, updateSessionBody } from './session.schemas.ts';

type SessionRow = LectureSession & { course: { id: string; code: string; title: string } };

export function toSessionDto(s: SessionRow, access: SessionAccess) {
  const staff = access === 'LECTURER';
  const code = staff && s.joinCodeEnc ? decryptText(s.joinCodeEnc) : null;
  return {
    id: s.id,
    course: s.course,
    title: s.title,
    description: s.description,
    status: s.status,
    accessPolicy: s.accessPolicy,
    feedbackEnabled: s.feedbackEnabled,
    scheduledFor: s.scheduledFor?.toISOString() ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    // The join code and its expiry are lecturer-only.
    ...(staff ? { joinCode: code, joinCodeExpiresAt: s.joinCodeExpiresAt?.toISOString() ?? null } : {}),
  };
}

async function reload(id: string): Promise<SessionRow> {
  return prisma.lectureSession.findUniqueOrThrow({ where: { id }, include: { course: { select: { id: true, code: true, title: true } } } });
}

async function broadcastState(id: string) {
  const s = await reload(id);
  hub.toAudiences(id, 'session.state_changed', { status: s.status, session: toSessionDto(s, 'LECTURER') }, { status: s.status });
  return s;
}

export async function createSession(user: AuthUser, courseId: string, input: z.infer<typeof createSessionBody>) {
  await requireCourseLecturer(user, courseId);
  const created = await prisma.lectureSession.create({
    data: { courseId, createdById: user.id, title: input.title, description: input.description, scheduledFor: input.scheduledFor, accessPolicy: input.accessPolicy, feedbackEnabled: input.feedbackEnabled },
  });
  await audit(user.id, 'session.create', { type: 'LectureSession', id: created.id });
  return toSessionDto(await reload(created.id), 'LECTURER');
}

export async function updateSession(user: AuthUser, sessionId: string, input: z.infer<typeof updateSessionBody>) {
  const session = await loadSessionAsLecturer(user, sessionId);
  if (session.status === 'ENDED') throw conflict('SESSION_ENDED', 'Ended sessions are read-only.');
  await prisma.lectureSession.update({ where: { id: sessionId }, data: input });
  return toSessionDto(await broadcastState(sessionId), 'LECTURER');
}

async function issueJoinCode(sessionId: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = generateJoinCode();
    try {
      await prisma.lectureSession.update({
        where: { id: sessionId },
        data: { joinCodeHash: hashJoinCode(code), joinCodeEnc: encryptText(code), joinCodeExpiresAt: new Date(Date.now() + env.JOIN_CODE_TTL_MINUTES * 60_000) },
      });
      return code;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err; // collision → retry
    }
  }
  throw new AppError(500, 'JOIN_CODE_FAILED', 'Could not generate a join code.');
}

export async function rotateJoinCode(user: AuthUser, sessionId: string) {
  const session = await loadSessionAsLecturer(user, sessionId);
  if (session.status === 'ENDED') throw conflict('SESSION_ENDED', 'This session has ended.');
  await issueJoinCode(sessionId);
  await audit(user.id, 'session.rotate_code', { type: 'LectureSession', id: sessionId });
  return toSessionDto(await broadcastState(sessionId), 'LECTURER');
}

type Transition = { from: LectureSession['status'][]; to: LectureSession['status'] };
const TRANSITIONS: Record<'start' | 'pause' | 'resume' | 'end', Transition> = {
  start: { from: ['SCHEDULED'], to: 'LIVE' },
  pause: { from: ['LIVE'], to: 'PAUSED' },
  resume: { from: ['PAUSED'], to: 'LIVE' },
  end: { from: ['LIVE', 'PAUSED'], to: 'ENDED' },
};

export async function transitionSession(user: AuthUser, sessionId: string, action: keyof typeof TRANSITIONS) {
  const session = await loadSessionAsLecturer(user, sessionId);
  const t = TRANSITIONS[action];
  const now = new Date();
  const data: Prisma.LectureSessionUpdateManyMutationInput = { status: t.to };
  if (action === 'start') data.startedAt = now;
  if (action === 'end') {
    data.endedAt = now;
    data.joinCodeHash = null; // an ended session can no longer be joined
    data.joinCodeEnc = null;
    data.joinCodeExpiresAt = null;
  }
  const res = await prisma.lectureSession.updateMany({ where: { id: sessionId, status: { in: t.from } }, data });
  if (res.count !== 1) throw conflict('INVALID_SESSION_STATE', `A ${session.status.toLowerCase()} session cannot be ${action === 'end' ? 'ended' : action === 'start' ? 'started' : action + 'd'}.`);
  if (action === 'start' && !session.joinCodeHash) await issueJoinCode(sessionId);
  if (action === 'pause') await pauseActivePolls(sessionId);
  if (action === 'end') await closeActivePolls(sessionId, user.id);
  await audit(user.id, `session.${action}`, { type: 'LectureSession', id: sessionId });
  return toSessionDto(await broadcastState(sessionId), 'LECTURER');
}

/** Generic failure for every bad-code case, so codes cannot be probed for validity. */
const BAD_CODE = () => new AppError(404, 'INVALID_JOIN_CODE', 'That code is invalid or has expired.');

export async function joinWithCode(user: AuthUser, code: string) {
  if (user.role !== 'STUDENT') throw forbidden('Only student accounts join sessions with a code.');
  const session = await prisma.lectureSession.findUnique({ where: { joinCodeHash: hashJoinCode(code) }, include: { course: { select: { id: true, code: true, title: true } } } });
  if (!session || session.status === 'ENDED' || !session.joinCodeExpiresAt || session.joinCodeExpiresAt < new Date()) throw BAD_CODE();
  if (session.accessPolicy === 'ENROLLED_ONLY') {
    const enrolment = await prisma.enrolment.findUnique({ where: { courseId_userId: { courseId: session.courseId, userId: user.id } } });
    if (enrolment?.role !== 'STUDENT') throw BAD_CODE();
  }
  const rec = await prisma.attendanceRecord.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
    create: { sessionId: session.id, userId: user.id },
    update: {},
  });
  hub.toStaff(session.id, 'participants.updated', { joined: await prisma.attendanceRecord.count({ where: { sessionId: session.id } }), connected: connectedCount(session.id) });
  void rec;
  return toSessionDto(session, 'STUDENT');
}

/**
 * Records that a student explicitly opened a live session (e.g. from their dashboard rather than via the code).
 * This is an HTTP action by the student's own client — an open socket connection alone never counts as attendance.
 */
export async function recordAttendance(user: AuthUser, sessionId: string) {
  const { session, access } = await loadSessionWithAccess(user, sessionId);
  if (access !== 'STUDENT') throw forbidden('Only students are recorded as attending.');
  if (session.status !== 'LIVE' && session.status !== 'PAUSED') throw conflict('SESSION_NOT_LIVE', 'This session is not live.');
  await prisma.attendanceRecord.upsert({ where: { sessionId_userId: { sessionId, userId: user.id } }, create: { sessionId, userId: user.id }, update: {} });
  hub.toStaff(sessionId, 'participants.updated', { joined: await prisma.attendanceRecord.count({ where: { sessionId, user: { role: 'STUDENT' } } }), connected: connectedCount(sessionId) });
}

export async function getSnapshot(user: AuthUser, sessionId: string) {
  const { session, access } = await loadSessionWithAccess(user, sessionId);
  const full = await reload(session.id);
  const polls = access === 'ADMIN' ? [] : await listPolls(user, sessionId);
  const results: Record<string, Awaited<ReturnType<typeof computeResults>>> = {};
  await Promise.all(
    polls
      .filter((p) => p.status !== 'DRAFT' && (access === 'LECTURER' || p.resultsVisible))
      .map(async (p) => {
        results[p.id] = await computeResults(p.id);
      }),
  );
  const joined = await prisma.attendanceRecord.count({ where: { sessionId, user: { role: 'STUDENT' } } });
  return {
    session: toSessionDto(full, access),
    access,
    polls,
    results,
    participants: access === 'LECTURER' ? { joined, connected: connectedCount(sessionId) } : undefined,
    serverTime: new Date().toISOString(),
  };
}

export async function listCourseSessions(user: AuthUser, courseId: string) {
  await requireCourseMember(user, courseId);
  const isLecturer = await isCourseLecturer(user, courseId);
  const rows = await prisma.lectureSession.findMany({
    where: { courseId },
    include: { course: { select: { id: true, code: true, title: true } }, _count: { select: { attendance: true, polls: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  });
  return rows.map((s) => ({ ...toSessionDto(s, isLecturer ? 'LECTURER' : 'STUDENT'), attendanceCount: s._count.attendance, pollCount: s._count.polls }));
}

/** Dashboard feed: sessions the user teaches or can attend, grouped by urgency. */
export async function listMySessions(user: AuthUser) {
  const where: Prisma.LectureSessionWhereInput =
    user.role === 'ADMIN'
      ? {}
      : user.role === 'LECTURER'
        ? { course: { OR: [{ ownerId: user.id }, { enrolments: { some: { userId: user.id, role: 'LECTURER' } } }] } }
        : { OR: [{ course: { enrolments: { some: { userId: user.id, role: 'STUDENT' } } } }, { attendance: { some: { userId: user.id } } }] };
  const rows = await prisma.lectureSession.findMany({
    where,
    include: { course: { select: { id: true, code: true, title: true } }, _count: { select: { attendance: true, polls: true } } },
    orderBy: [{ startedAt: 'desc' }, { scheduledFor: 'asc' }, { createdAt: 'desc' }],
    take: 60,
  });
  const access: SessionAccess = user.role === 'LECTURER' ? 'LECTURER' : user.role === 'ADMIN' ? 'ADMIN' : 'STUDENT';
  const dto = rows.map((s) => ({ ...toSessionDto(s, access), attendanceCount: s._count.attendance, pollCount: s._count.polls }));
  return {
    live: dto.filter((s) => s.status === 'LIVE' || s.status === 'PAUSED'),
    upcoming: dto.filter((s) => s.status === 'SCHEDULED'),
    recent: dto.filter((s) => s.status === 'ENDED').slice(0, 10),
  };
}

export { resultsVisibleToStudents };
