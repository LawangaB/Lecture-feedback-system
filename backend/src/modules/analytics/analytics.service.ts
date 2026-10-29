import { prisma } from '../../db.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import { audit } from '../../services/audit.ts';
import { loadSessionAsLecturer } from '../../services/permissions.ts';
import { toCsv } from '../../utils/csv.ts';
import { computeResults } from '../polls/poll.results.ts';
import { feedbackSummary, DIMENSIONS } from '../feedback/feedback.service.ts';
import { toSessionDto } from '../lecture-sessions/session.service.ts';

export async function sessionReport(user: AuthUser, sessionId: string) {
  const session = await loadSessionAsLecturer(user, sessionId);
  const full = await prisma.lectureSession.findUniqueOrThrow({ where: { id: sessionId }, include: { course: { select: { id: true, code: true, title: true } } } });
  const polls = await prisma.poll.findMany({ where: { sessionId, status: { not: 'DRAFT' } }, include: { options: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } });
  const results = await Promise.all(polls.map((p) => computeResults(p.id)));
  const attendance = await prisma.attendanceRecord.count({ where: { sessionId, user: { role: 'STUDENT' } } });
  return {
    session: toSessionDto(full, 'LECTURER'),
    attendanceCount: attendance,
    polls: polls.map((p, i) => ({
      id: p.id, question: p.question, type: p.type, status: p.status, isAnonymous: p.isAnonymous, results: results[i],
    })),
    feedback: await feedbackSummary(session.id),
    // Denominators are explicit; non-response is never counted as a negative answer.
    notes: ['Percentages use respondents as the denominator; response rates use students who joined the session.'],
  };
}

export async function exportCsv(user: AuthUser, sessionId: string, type: 'results' | 'feedback'): Promise<{ filename: string; body: string }> {
  const session = await loadSessionAsLecturer(user, sessionId);
  await audit(user.id, `export.${type}`, { type: 'LectureSession', id: sessionId });
  if (type === 'results') {
    const polls = await prisma.poll.findMany({ where: { sessionId, status: { not: 'DRAFT' } }, include: { options: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } });
    const rows: unknown[][] = [['Poll', 'Type', 'Anonymous', 'Answer', 'Count', 'Percent of respondents', 'Total respondents', 'Students joined']];
    for (const p of polls) {
      const r = await computeResults(p.id);
      if (r.rating) {
        for (const d of r.rating.distribution) rows.push([p.question, p.type, p.isAnonymous, `Rating ${d.value}`, d.count, r.totalResponses ? Math.round((d.count / r.totalResponses) * 1000) / 10 : 0, r.totalResponses, r.joinedParticipants]);
      } else {
        for (const o of r.options) rows.push([p.question, p.type, p.isAnonymous, o.label, o.count, o.percentOfRespondents, r.totalResponses, r.joinedParticipants]);
      }
    }
    // Aggregate-only by design: no per-student rows, so anonymous polls cannot leak identity through exports.
    return { filename: `results-${session.id}.csv`, body: toCsv(rows) };
  }
  const entries = await prisma.feedbackEntry.findMany({ where: { sessionId }, include: { ratings: true, user: { select: { displayName: true } } }, orderBy: [{ createdAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] });
  const rows: unknown[][] = [['Author', ...DIMENSIONS, 'Comment']];
  for (const e of entries) {
    const byDim = new Map(e.ratings.map((r) => [r.dimension, r.value]));
    rows.push([e.userId && e.user ? e.user.displayName : 'Anonymous', ...DIMENSIONS.map((d) => byDim.get(d) ?? ''), e.isHidden ? '' : (e.comment ?? '')]);
  }
  return { filename: `feedback-${session.id}.csv`, body: toCsv(rows) };
}

export async function lecturerOverview(user: AuthUser) {
  const courseWhere = { OR: [{ ownerId: user.id }, { enrolments: { some: { userId: user.id, role: 'LECTURER' as const } } }] };
  const [courses, students, sessions] = await Promise.all([
    prisma.course.count({ where: { ...courseWhere, isArchived: false } }),
    prisma.enrolment.findMany({ where: { role: 'STUDENT', course: courseWhere }, distinct: ['userId'], select: { userId: true } }),
    prisma.lectureSession.findMany({
      where: { course: courseWhere, status: { in: ['LIVE', 'PAUSED', 'ENDED'] } },
      include: { course: { select: { code: true, title: true } }, _count: { select: { attendance: true } } },
      orderBy: { startedAt: 'desc' },
      take: 8,
    }),
  ]);
  const trend = await Promise.all(
    sessions.map(async (s) => {
      const [polls, responses] = await Promise.all([
        prisma.poll.count({ where: { sessionId: s.id, status: { not: 'DRAFT' } } }),
        prisma.pollResponse.count({ where: { poll: { sessionId: s.id } } }),
      ]);
      const denom = s._count.attendance * polls;
      return {
        sessionId: s.id, title: s.title, courseCode: s.course.code, startedAt: s.startedAt?.toISOString() ?? null,
        attendance: s._count.attendance, polls, responses, responseRate: denom > 0 ? Math.min(1, responses / denom) : null,
      };
    }),
  );
  const rated = trend.filter((t) => t.responseRate !== null);
  return {
    courseCount: courses,
    studentCount: students.length,
    averageResponseRate: rated.length ? rated.reduce((s, t) => s + (t.responseRate ?? 0), 0) / rated.length : null,
    trend: trend.reverse(),
  };
}
