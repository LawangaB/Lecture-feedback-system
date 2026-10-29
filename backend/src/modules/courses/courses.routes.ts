import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.ts';
import { currentUser, requireRole } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import { requireCourseManager, requireCourseMember } from '../../services/permissions.ts';
import { audit } from '../../services/audit.ts';
import { hub } from '../../realtime/hub.ts';
import { conflict, forbidden, notFound } from '../../utils/errors.ts';
import { emailSchema } from '../auth/auth.schemas.ts';

const idParams = z.object({ courseId: z.string().uuid() });
const courseBody = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Use 2–32 letters, numbers or dashes.'),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
const courseUpdate = courseBody.partial().extend({ isArchived: z.boolean().optional() }).strict();
const enrolBody = z.object({ emails: z.array(emailSchema).min(1).max(200), role: z.enum(['STUDENT', 'LECTURER']).default('STUDENT') }).strict();

const courseSelect = {
  id: true, code: true, title: true, description: true, isArchived: true, ownerId: true, createdAt: true,
  owner: { select: { displayName: true } },
  _count: { select: { enrolments: { where: { role: 'STUDENT' as const } }, sessions: true } },
};

function toDto(c: Awaited<ReturnType<typeof prisma.course.findFirstOrThrow<{ select: typeof courseSelect }>>>) {
  return {
    id: c.id, code: c.code, title: c.title, description: c.description, isArchived: c.isArchived,
    ownerName: c.owner.displayName, studentCount: c._count.enrolments, sessionCount: c._count.sessions, createdAt: c.createdAt,
  };
}

export function coursesRouter() {
  const r = Router();

  r.get('/', async (req, res) => {
    const user = currentUser(req);
    const where =
      user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { enrolments: { some: { userId: user.id } } }] };
    const courses = await prisma.course.findMany({ where, select: courseSelect, orderBy: [{ isArchived: 'asc' }, { title: 'asc' }], take: 200 });
    res.json({ items: courses.map(toDto) });
  });

  r.post('/', requireRole('LECTURER', 'ADMIN'), validate({ body: courseBody }), async (req, res) => {
    const user = currentUser(req);
    if (await prisma.course.findUnique({ where: { code: req.body.code } })) throw conflict('COURSE_CODE_TAKEN', 'A course with this code already exists.');
    const course = await prisma.course.create({
      data: { ...req.body, ownerId: user.id, enrolments: { create: { userId: user.id, role: 'LECTURER' } } },
      select: courseSelect,
    });
    await audit(user.id, 'course.create', { type: 'Course', id: course.id });
    res.status(201).json({ course: toDto(course) });
  });

  r.get('/:courseId', validate({ params: idParams }), async (req, res) => {
    const user = currentUser(req);
    await requireCourseMember(user, req.params.courseId as string);
    const course = await prisma.course.findUnique({ where: { id: req.params.courseId as string }, select: courseSelect });
    if (!course) throw notFound('Course');
    res.json({ course: toDto(course) });
  });

  r.patch('/:courseId', validate({ params: idParams, body: courseUpdate }), async (req, res) => {
    const user = currentUser(req);
    const courseId = req.params.courseId as string;
    await requireCourseManager(user, courseId);
    if (req.body.code) {
      const clash = await prisma.course.findFirst({ where: { code: req.body.code, NOT: { id: courseId } } });
      if (clash) throw conflict('COURSE_CODE_TAKEN', 'A course with this code already exists.');
    }
    const course = await prisma.course.update({ where: { id: courseId }, data: req.body, select: courseSelect });
    await audit(user.id, 'course.update', { type: 'Course', id: courseId });
    res.json({ course: toDto(course) });
  });

  // Roster is visible to the course's lecturers and administrators only.
  r.get('/:courseId/enrolments', validate({ params: idParams }), async (req, res) => {
    const user = currentUser(req);
    const courseId = req.params.courseId as string;
    await requireCourseManager(user, courseId);
    const rows = await prisma.enrolment.findMany({
      where: { courseId },
      include: { user: { select: { id: true, displayName: true, email: true, isActive: true } } },
      orderBy: [{ role: 'asc' }, { user: { displayName: 'asc' } }],
      take: 1000,
    });
    res.json({ items: rows.map((e) => ({ userId: e.userId, role: e.role, displayName: e.user.displayName, email: e.user.email, isActive: e.user.isActive, enrolledAt: e.createdAt })) });
  });

  r.post('/:courseId/enrolments', validate({ params: idParams, body: enrolBody }), async (req, res) => {
    const user = currentUser(req);
    const courseId = req.params.courseId as string;
    await requireCourseManager(user, courseId);
    const { emails, role } = req.body as z.infer<typeof enrolBody>;
    const users = await prisma.user.findMany({ where: { email: { in: emails }, isActive: true }, select: { id: true, email: true, role: true } });
    const eligible = users.filter((u) => (role === 'LECTURER' ? u.role !== 'STUDENT' : true));
    const found = new Set(eligible.map((u) => u.email));
    const created = await prisma.enrolment.createMany({
      data: eligible.map((u) => ({ courseId, userId: u.id, role })),
      skipDuplicates: true,
    });
    await audit(user.id, 'course.enrol', { type: 'Course', id: courseId }, { added: created.count, role });
    res.status(201).json({ added: created.count, notAdded: emails.filter((e) => !found.has(e)) });
  });

  r.delete('/:courseId/enrolments/:userId', validate({ params: idParams.extend({ userId: z.string().uuid() }) }), async (req, res) => {
    const user = currentUser(req);
    const { courseId, userId } = req.params as unknown as { courseId: string; userId: string };
    await requireCourseManager(user, courseId);
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { ownerId: true } });
    if (course.ownerId === userId) throw forbidden('The course owner cannot be removed.');
    await prisma.enrolment.deleteMany({ where: { courseId, userId } });
    hub.disconnectUser(userId); // drop live subscriptions; the client reconnects and is re-authorised
    await audit(user.id, 'course.unenrol', { type: 'Course', id: courseId }, { removedUser: userId });
    res.status(204).end();
  });

  return r;
}
