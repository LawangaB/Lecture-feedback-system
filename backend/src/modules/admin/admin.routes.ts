import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '../../db.ts';
import { currentUser, requireRole } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import { audit } from '../../services/audit.ts';
import { revokeUserSessions } from '../../middleware/session.ts';
import { hub } from '../../realtime/hub.ts';
import { conflict, forbidden, notFound } from '../../utils/errors.ts';
import { hashPassword } from '../../utils/password.ts';
import { emailSchema, passwordSchema } from '../auth/auth.schemas.ts';

const roleEnum = z.enum(['STUDENT', 'LECTURER', 'ADMIN']);
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const userDto = (u: { id: string; email: string; displayName: string; role: string; isActive: boolean; createdAt: Date }) => ({
  id: u.id, email: u.email, displayName: u.displayName, role: u.role, isActive: u.isActive, createdAt: u.createdAt.toISOString(),
});

export function adminRouter() {
  const r = Router();
  r.use('/admin', requireRole('ADMIN'));

  r.get('/admin/overview', async (_req, res) => {
    const [byRole, inactive, courses, sessions, live, recent] = await Promise.all([
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.course.count(),
      prisma.lectureSession.count(),
      prisma.lectureSession.count({ where: { status: { in: ['LIVE', 'PAUSED'] } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { actor: { select: { displayName: true } } } }),
    ]);
    const counts = Object.fromEntries(byRole.map((b) => [b.role, b._count._all]));
    res.json({
      users: { total: byRole.reduce((s, b) => s + b._count._all, 0), students: counts.STUDENT ?? 0, lecturers: counts.LECTURER ?? 0, admins: counts.ADMIN ?? 0, inactive },
      courses, sessions: { total: sessions, live },
      recentAudit: recent.map((a) => ({ id: a.id, action: a.action, actor: a.actor?.displayName ?? null, at: a.createdAt.toISOString() })),
    });
  });

  r.get('/admin/users', validate({ query: z.object({ ...page, search: z.string().trim().max(100).optional(), role: roleEnum.optional(), status: z.enum(['active', 'inactive']).optional() }).strict() }), async (req, res) => {
    const q = req.query as unknown as { page: number; pageSize: number; search?: string; role?: 'STUDENT' | 'LECTURER' | 'ADMIN'; status?: 'active' | 'inactive' };
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { isActive: q.status === 'active' } : {}),
      ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { displayName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, items: rows.map(userDto) });
  });

  r.post('/admin/users', validate({ body: z.object({ email: emailSchema, displayName: z.string().trim().min(1).max(100), role: roleEnum, password: passwordSchema }).strict() }), async (req, res) => {
    const actor = currentUser(req);
    if (await prisma.user.findUnique({ where: { email: req.body.email } })) throw conflict('EMAIL_IN_USE', 'An account with this email already exists.');
    const user = await prisma.user.create({ data: { email: req.body.email, displayName: req.body.displayName, role: req.body.role, passwordHash: await hashPassword(req.body.password) } });
    await audit(actor.id, 'admin.user_create', { type: 'User', id: user.id }, { role: user.role });
    res.status(201).json({ user: userDto(user) });
  });

  r.patch('/admin/users/:userId', validate({ params: z.object({ userId: z.string().uuid() }), body: z.object({ role: roleEnum.optional(), isActive: z.boolean().optional(), displayName: z.string().trim().min(1).max(100).optional() }).strict() }), async (req, res) => {
    const actor = currentUser(req);
    const userId = req.params.userId as string;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw notFound('User');
    if (userId === actor.id && (req.body.isActive === false || (req.body.role && req.body.role !== 'ADMIN'))) {
      throw forbidden('You cannot deactivate or demote your own account.');
    }
    const updated = await prisma.user.update({ where: { id: userId }, data: req.body });
    // Privilege or status changes end every existing session and live connection immediately.
    if ((req.body.role && req.body.role !== target.role) || req.body.isActive === false) {
      await revokeUserSessions(userId);
      hub.disconnectUser(userId);
    }
    if (req.body.role && req.body.role !== target.role) await audit(actor.id, 'admin.role_change', { type: 'User', id: userId }, { from: target.role, to: req.body.role });
    if (req.body.isActive !== undefined && req.body.isActive !== target.isActive) await audit(actor.id, req.body.isActive ? 'admin.user_activate' : 'admin.user_deactivate', { type: 'User', id: userId });
    res.json({ user: userDto(updated) });
  });

  r.get('/admin/audit-events', validate({ query: z.object({ ...page, action: z.string().trim().max(100).optional(), actorId: z.string().uuid().optional() }).strict() }), async (req, res) => {
    const q = req.query as unknown as { page: number; pageSize: number; action?: string; actorId?: string };
    const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: { displayName: true, email: true } } } }),
    ]);
    res.json({
      total, page: q.page, pageSize: q.pageSize,
      items: rows.map((a) => ({ id: a.id, action: a.action, actor: a.actor ? { displayName: a.actor.displayName, email: a.actor.email } : null, targetType: a.targetType, targetId: a.targetId, metadata: a.metadata, at: a.createdAt.toISOString() })),
    });
  });

  return r;
}
