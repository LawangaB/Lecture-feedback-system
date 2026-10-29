import { prisma, type LectureSession, type Poll } from '../db.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { forbidden, notFound } from '../utils/errors.ts';

export type SessionAccess = 'LECTURER' | 'STUDENT' | 'ADMIN';

/** True when the user teaches the course (owner or LECTURER enrolment). Admins are NOT lecturers by default. */
export async function isCourseLecturer(user: AuthUser, courseId: string): Promise<boolean> {
  if (user.role === 'STUDENT') return false;
  const [course, enrolment] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { ownerId: true } }),
    prisma.enrolment.findUnique({ where: { courseId_userId: { courseId, userId: user.id } }, select: { role: true } }),
  ]);
  if (!course) return false;
  return course.ownerId === user.id || enrolment?.role === 'LECTURER';
}

export async function isCourseStudent(user: AuthUser, courseId: string): Promise<boolean> {
  const enrolment = await prisma.enrolment.findUnique({
    where: { courseId_userId: { courseId, userId: user.id } },
    select: { role: true },
  });
  return enrolment?.role === 'STUDENT';
}

/** Course management (settings, enrolments): the course's lecturers, or any administrator. */
export async function requireCourseManager(user: AuthUser, courseId: string): Promise<void> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw notFound('Course');
  if (user.role === 'ADMIN') return;
  if (await isCourseLecturer(user, courseId)) return;
  // Enrolled students may know the course exists, but not manage it; everyone else gets a 404.
  if (await isCourseStudent(user, courseId)) throw forbidden();
  throw notFound('Course');
}

export async function requireCourseMember(user: AuthUser, courseId: string): Promise<void> {
  if (user.role === 'ADMIN') return;
  const enrolment = await prisma.enrolment.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } });
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { ownerId: true } });
  if (!enrolment && course?.ownerId !== user.id) throw notFound('Course');
}

export async function requireCourseLecturer(user: AuthUser, courseId: string): Promise<void> {
  if (await isCourseLecturer(user, courseId)) return;
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw notFound('Course');
  // Students/admins who can see the course get 403; unrelated users get 404 so ids cannot be probed.
  if (user.role === 'ADMIN' || (await isCourseStudent(user, courseId))) throw forbidden();
  throw notFound('Course');
}

/** Resolve how (if at all) a user may access a session. Returns null when they may not see it at all. */
export async function resolveSessionAccess(user: AuthUser, session: Pick<LectureSession, 'id' | 'courseId' | 'accessPolicy'>): Promise<SessionAccess | null> {
  if (await isCourseLecturer(user, session.courseId)) return 'LECTURER';
  if (user.role === 'ADMIN') return 'ADMIN';
  if (await isCourseStudent(user, session.courseId)) return 'STUDENT';
  if (session.accessPolicy === 'ANY_SIGNED_IN') {
    const attended = await prisma.attendanceRecord.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
      select: { userId: true },
    });
    if (attended) return 'STUDENT';
  }
  return null;
}

export async function loadSessionWithAccess(user: AuthUser, sessionId: string) {
  const session = await prisma.lectureSession.findUnique({ where: { id: sessionId }, include: { course: { select: { id: true, code: true, title: true } } } });
  if (!session) throw notFound('Session');
  const access = await resolveSessionAccess(user, session);
  if (!access) throw notFound('Session');
  return { session, access };
}

export async function loadSessionAsLecturer(user: AuthUser, sessionId: string) {
  const loaded = await loadSessionWithAccess(user, sessionId);
  if (loaded.access !== 'LECTURER') throw forbidden('Only the course lecturer can do that.');
  return loaded.session;
}

export async function loadPollWithAccess(user: AuthUser, pollId: string) {
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: { orderBy: { position: 'asc' } }, session: true } });
  if (!poll) throw notFound('Poll');
  const access = await resolveSessionAccess(user, poll.session);
  if (!access) throw notFound('Poll');
  // Students never see drafts, and never learn they exist.
  if (access === 'STUDENT' && poll.status === 'DRAFT') throw notFound('Poll');
  return { poll, access };
}

export type PollWithOptions = Poll & { options: { id: string; label: string; position: number }[] };
