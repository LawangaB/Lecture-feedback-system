import { Router } from 'express';
import { prisma } from '../../db.ts';
import { currentUser, requireRole } from '../../middleware/auth.ts';
import { listMySessions } from '../lecture-sessions/session.service.ts';

export function usersRouter() {
  const r = Router();

  /** Participation history: THAT the student took part — never what an anonymous answer was. */
  r.get('/users/me/participation', requireRole('STUDENT'), async (req, res) => {
    const rows = await prisma.pollParticipation.findMany({
      where: { userId: currentUser(req).id },
      include: { poll: { select: { id: true, question: true, isAnonymous: true, session: { select: { id: true, title: true, course: { select: { code: true } } } } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({
      items: rows.map((p) => ({
        pollId: p.poll.id, question: p.poll.question, isAnonymous: p.poll.isAnonymous,
        sessionId: p.poll.session.id, sessionTitle: p.poll.session.title, courseCode: p.poll.session.course.code, at: p.createdAt.toISOString(),
      })),
    });
  });

  r.get('/dashboard/student', requireRole('STUDENT'), async (req, res) => {
    const user = currentUser(req);
    const [sessions, participation, feedbackGiven, courses] = await Promise.all([
      listMySessions(user),
      prisma.pollParticipation.count({ where: { userId: user.id } }),
      prisma.feedbackParticipation.findMany({
        where: { userId: user.id },
        include: { session: { select: { id: true, title: true, course: { select: { code: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.enrolment.findMany({
        where: { userId: user.id, role: 'STUDENT' },
        include: { course: { select: { id: true, code: true, title: true, isArchived: true, owner: { select: { displayName: true } } } } },
        orderBy: { course: { title: 'asc' } },
      }),
    ]);
    res.json({
      sessions,
      pollsAnswered: participation,
      recentFeedback: feedbackGiven.map((f) => ({ sessionId: f.session.id, sessionTitle: f.session.title, courseCode: f.session.course.code, at: f.createdAt.toISOString() })),
      courses: courses.filter((c) => !c.course.isArchived).map((c) => ({ id: c.course.id, code: c.course.code, title: c.course.title, lecturer: c.course.owner.displayName })),
    });
  });

  return r;
}
